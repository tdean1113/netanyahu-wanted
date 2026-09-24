import { randomUUID } from 'node:crypto'
import { SquareClient, SquareEnvironment } from 'square'
import {
  claimConfirmationLock,
  releaseConfirmationLock,
} from './confirmationLock.js'
import {
  DONATION_ORGS,
  EDITION_SIZE,
  HALF_PRICE_CENTS,
  MAX_QTY,
  ORG_IDS,
  UNIT_PRICE_CENTS,
  config,
  type DonationOrgId,
} from './config.js'

export interface InventorySnapshot {
  sold: number
  remaining: number
  edition: number
}

export type DonationSplit = Partial<Record<DonationOrgId, number>>

export interface PaidMedalOrder {
  orderId: string
  createdAt: Date
  quantity: number
  /** Per-org medal counts for this order. */
  donations: DonationSplit
  /** Flattened org list, one entry per medal, for register rows. */
  medalOrgs: DonationOrgId[]
  buyerName: string
  donationAud: number
  productionAud: number
  totalAud: number
}

let client: SquareClient | null = null

function getClient(): SquareClient {
  if (!client) {
    client = new SquareClient({
      token: config.square.accessToken,
      environment:
        config.square.environment === 'production'
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    })
  }
  return client
}

export function isDonationOrgId(value: string): value is DonationOrgId {
  return (ORG_IDS as string[]).includes(value)
}

export function parseAndValidateDonations(
  quantity: number,
  raw: unknown,
): DonationSplit {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Select a donation recipient for each medal')
  }

  const donations: DonationSplit = {}
  let sum = 0

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDonationOrgId(key)) {
      throw new Error(`Unknown donation organisation: ${key}`)
    }
    const count = Number(value)
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Donation counts must be non-negative integers')
    }
    if (count > 0) {
      donations[key] = count
      sum += count
    }
  }

  if (sum !== quantity) {
    throw new Error(
      `Select a donation recipient for each medal (${sum} of ${quantity} assigned)`,
    )
  }

  return donations
}

/** Expand a donations map into one org id per medal (stable org order). */
export function expandMedalOrgs(donations: DonationSplit): DonationOrgId[] {
  const list: DonationOrgId[] = []
  for (const id of ORG_IDS) {
    const n = donations[id] ?? 0
    for (let i = 0; i < n; i++) list.push(id)
  }
  return list
}

export function splitSummaryLabel(donations: DonationSplit): string {
  return ORG_IDS.filter((id) => (donations[id] ?? 0) > 0)
    .map((id) => `${donations[id]}× ${DONATION_ORGS[id].registerLabel}`)
    .join(' · ')
}

export async function getInventory(): Promise<InventorySnapshot> {
  if (config.mockMode) {
    return { sold: 0, remaining: EDITION_SIZE, edition: EDITION_SIZE }
  }

  const variationId = config.square.medalVariationId
  if (!variationId) {
    throw new Error('SQUARE_MEDAL_VARIATION_ID is not configured')
  }

  const page = await getClient().inventory.get({
    catalogObjectId: variationId,
    locationIds: config.square.locationId,
  })

  let inStock = 0
  for await (const count of page) {
    if (count.state === 'IN_STOCK') {
      inStock += Number(count.quantity ?? 0)
    }
  }

  const remaining = Math.max(0, Math.min(EDITION_SIZE, inStock))
  return {
    remaining,
    sold: EDITION_SIZE - remaining,
    edition: EDITION_SIZE,
  }
}

export async function createCheckoutLink(input: {
  quantity: number
  donations: DonationSplit
}): Promise<{ url: string }> {
  const { quantity, donations } = input
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    throw new Error(`Quantity must be between 1 and ${MAX_QTY}`)
  }
  parseAndValidateDonations(quantity, donations)

  if (config.mockMode) {
    const url = new URL(config.frontendUrl('/success'))
    url.searchParams.set('mock', '1')
    url.searchParams.set('qty', String(quantity))
    url.searchParams.set('donations', JSON.stringify(donations))
    return { url: url.toString() }
  }

  if (!config.square.locationId || !config.square.medalVariationId) {
    throw new Error(
      'Square is not fully configured. Set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, and catalog variation IDs.',
    )
  }

  const inventory = await getInventory()
  if (quantity > inventory.remaining) {
    throw new Error(
      `Only ${inventory.remaining} medal${inventory.remaining === 1 ? '' : 's'} remaining`,
    )
  }

  const summary = splitSummaryLabel(donations)
  const response = await getClient().checkout.paymentLinks.create({
    idempotencyKey: randomUUID(),
    description: `ICC Arrest Warrant Medal × ${quantity} · ${summary}`,
    order: {
      locationId: config.square.locationId,
      lineItems: [
        {
          name: 'ICC Arrest Warrant Medal',
          quantity: String(quantity),
          catalogObjectId: config.square.medalVariationId,
          basePriceMoney: {
            amount: BigInt(UNIT_PRICE_CENTS),
            currency: 'AUD',
          },
          note: `Includes A$140 production/postage and A$140 donation (${summary}). Edition of ${EDITION_SIZE}.`,
        },
      ],
      metadata: {
        donation_split: JSON.stringify(donations),
        medal_qty: String(quantity),
        product: 'icc-arrest-warrant-medal',
        // Keep first org for older tooling / display
        donation_org: expandMedalOrgs(donations)[0] ?? '',
        donation_label: summary,
      },
    },
    checkoutOptions: {
      redirectUrl: config.frontendUrl('/success'),
      askForShippingAddress: true,
      allowTipping: false,
      enableCoupon: false,
      merchantSupportEmail: config.merchant.supportEmail,
    },
    paymentNote: `donations=${JSON.stringify(donations)};qty=${quantity}`,
  })

  const url = response.paymentLink?.url
  if (!url) {
    throw new Error('Square did not return a payment link URL')
  }
  return { url }
}

function parseDonationsFromOrder(order: {
  metadata?: Record<string, string | null> | null
  lineItems?: Array<{
    name?: string | null
    note?: string | null
    quantity?: string | null
  }> | null
}): DonationSplit | null {
  const rawSplit = order.metadata?.donation_split
  if (rawSplit) {
    try {
      const parsed = JSON.parse(rawSplit) as Record<string, unknown>
      const donations: DonationSplit = {}
      let sum = 0
      for (const [key, value] of Object.entries(parsed)) {
        if (!isDonationOrgId(key)) continue
        const n = Number(value)
        if (Number.isInteger(n) && n > 0) {
          donations[key] = n
          sum += n
        }
      }
      if (sum > 0) return donations
    } catch {
      /* fall through */
    }
  }

  // Legacy single-org metadata
  const meta = order.metadata?.donation_org
  const qty = Number(order.metadata?.medal_qty ?? 0)
  if (meta && isDonationOrgId(meta) && qty > 0) {
    return { [meta]: qty }
  }

  // Infer from donation line items
  const donations: DonationSplit = {}
  let found = false
  for (const item of order.lineItems ?? []) {
    const name = (item.name ?? '').toLowerCase()
    if (!name.includes('donation')) continue
    const qtyLine = Number(item.quantity ?? 0)
    if (!qtyLine) continue
    for (const id of ORG_IDS) {
      const label = DONATION_ORGS[id].registerLabel.toLowerCase()
      const orgName = DONATION_ORGS[id].name.toLowerCase()
      if (name.includes(label) || name.includes(orgName) || name.includes(id)) {
        donations[id] = (donations[id] ?? 0) + qtyLine
        found = true
        break
      }
    }
  }
  return found ? donations : null
}

function buyerNameFromOrder(order: {
  fulfillments?: Array<{
    shipmentDetails?: {
      recipient?: { displayName?: string | null } | null
    } | null
  }> | null
}): string {
  for (const f of order.fulfillments ?? []) {
    const name = f.shipmentDetails?.recipient?.displayName
    if (name) return name
  }
  return ''
}

export interface OrderConfirmationDetails {
  orderId: string
  quantity: number
  donationSummary: string
  totalCents: number
  buyerName: string
  buyerEmail: string
  buyerPhone: string
  deliveryAddress: {
    addressLine1?: string | null
    addressLine2?: string | null
    addressLine3?: string | null
    locality?: string | null
    administrativeDistrictLevel1?: string | null
    postalCode?: string | null
    country?: string | null
  } | null
  receiptUrl: string
}

const confirmationInFlight = new Map<
  string,
  Promise<{ sent: boolean; reason?: string }>
>()

function recipientFromOrder(order: {
  fulfillments?: Array<{
    shipmentDetails?: {
      recipient?: {
        displayName?: string | null
        emailAddress?: string | null
        phoneNumber?: string | null
        address?: {
          addressLine1?: string | null
          addressLine2?: string | null
          addressLine3?: string | null
          locality?: string | null
          administrativeDistrictLevel1?: string | null
          postalCode?: string | null
          country?: string | null
        } | null
      } | null
    } | null
  }> | null
}) {
  for (const f of order.fulfillments ?? []) {
    const recipient = f.shipmentDetails?.recipient
    if (recipient) return recipient
  }
  return null
}

export async function getOrderConfirmationDetails(
  orderId: string,
): Promise<OrderConfirmationDetails | null> {
  if (config.mockMode) return null

  const response = await getClient().orders.get({ orderId })
  const order = response.order
  if (!order?.id) return null

  const looksLikeMedal =
    order.metadata?.product === 'icc-arrest-warrant-medal' ||
    (order.lineItems ?? []).some((li) =>
      (li.name ?? '').toLowerCase().includes('arrest warrant medal'),
    )
  const paid = (order.tenders ?? []).length > 0 || order.state === 'COMPLETED'
  if (!looksLikeMedal && !paid) return null

  if (order.state !== 'COMPLETED' && order.state !== 'OPEN') {
    // Payment-link orders often move OPEN → COMPLETED; allow both once paid.
    // Unpaid drafts are DRAFT.
  }
  if (order.state === 'DRAFT' || order.state === 'CANCELED') return null
  if (!paid && order.state === 'OPEN') return null

  const donations = parseDonationsFromOrder({
    metadata: order.metadata ?? null,
    lineItems: order.lineItems ?? null,
  })
  const medalOrgs = donations ? expandMedalOrgs(donations) : []
  const quantity =
    Number(order.metadata?.medal_qty ?? 0) ||
    medalOrgs.length ||
    Number(
      (order.lineItems ?? []).find((li) =>
        (li.name ?? '').toLowerCase().includes('arrest warrant medal'),
      )?.quantity ?? 0,
    )

  const recipient = recipientFromOrder(order)
  let receiptUrl = ''

  const tenderIds = (order.tenders ?? [])
    .map((t) => t.paymentId)
    .filter((id): id is string => Boolean(id))
  for (const paymentId of tenderIds) {
    try {
      const payment = await getClient().payments.get({ paymentId })
      if (payment.payment?.receiptUrl) {
        receiptUrl = payment.payment.receiptUrl
        break
      }
    } catch {
      /* ignore missing payment */
    }
  }

  return {
    orderId: order.id,
    quantity: quantity || 1,
    donationSummary: donations ? splitSummaryLabel(donations) : '',
    totalCents: Number(order.totalMoney?.amount ?? UNIT_PRICE_CENTS),
    buyerName: recipient?.displayName?.trim() || buyerNameFromOrder(order),
    buyerEmail: recipient?.emailAddress?.trim() || '',
    buyerPhone: recipient?.phoneNumber?.trim() || '',
    deliveryAddress: recipient?.address
      ? {
          addressLine1: recipient.address.addressLine1,
          addressLine2: recipient.address.addressLine2,
          addressLine3: recipient.address.addressLine3,
          locality: recipient.address.locality,
          administrativeDistrictLevel1:
            recipient.address.administrativeDistrictLevel1,
          postalCode: recipient.address.postalCode,
          country: recipient.address.country ?? null,
        }
      : null,
    receiptUrl,
  }
}

async function sendOrderConfirmationOnce(
  orderId: string,
  opts?: { force?: boolean },
): Promise<{ sent: boolean; reason?: string }> {
  const details = await getOrderConfirmationDetails(orderId)
  if (!details) {
    return { sent: false, reason: 'order_not_found_or_not_medal' }
  }

  if (opts?.force) {
    await releaseConfirmationLock(orderId)
  }

  const claimed = await claimConfirmationLock(orderId)
  if (!claimed) {
    return { sent: false, reason: 'already_sent' }
  }

  try {
    const { sendBuyerOrderConfirmation } = await import('./email.js')
    const result = await sendBuyerOrderConfirmation(details, {
      force: opts?.force,
    })
    if (!result.sent) {
      await releaseConfirmationLock(orderId)
    }
    return result
  } catch (err) {
    await releaseConfirmationLock(orderId)
    throw err
  }
}

export async function sendOrderConfirmationIfNeeded(
  orderId: string,
  opts?: { force?: boolean },
): Promise<{ sent: boolean; reason?: string }> {
  if (!opts?.force) {
    const pending = confirmationInFlight.get(orderId)
    if (pending) {
      await pending
      return { sent: false, reason: 'already_sent' }
    }
  }

  let work!: Promise<{ sent: boolean; reason?: string }>
  work = sendOrderConfirmationOnce(orderId, opts).finally(() => {
    if (confirmationInFlight.get(orderId) === work) {
      confirmationInFlight.delete(orderId)
    }
  })
  confirmationInFlight.set(orderId, work)
  return work
}

function normalizeReceiptNumber(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

export async function findOrderIdByReceiptNumber(
  receiptNumber: string,
): Promise<string | null> {
  if (config.mockMode) return null
  const needle = normalizeReceiptNumber(receiptNumber)
  if (!needle) return null

  const beginTime = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  const page = await getClient().payments.list({
    locationId: config.square.locationId,
    beginTime,
    sortOrder: 'DESC',
  })

  for await (const payment of page) {
    const receipt = String(payment.receiptNumber ?? '').toLowerCase()
    if (receipt === needle && payment.orderId) {
      return payment.orderId
    }
  }
  return null
}

export async function findOrderIdByBuyerName(
  buyerName: string,
): Promise<string | null> {
  if (config.mockMode) return null
  const needle = buyerName.trim().toLowerCase()
  if (needle.length < 3) return null

  const locationId = config.square.locationId
  let cursor: string | undefined
  let best: { orderId: string; createdAt: string } | null = null

  do {
    const page = await getClient().orders.search({
      locationIds: [locationId],
      query: {
        filter: {
          stateFilter: { states: ['OPEN', 'COMPLETED'] },
        },
        sort: { sortField: 'CREATED_AT', sortOrder: 'DESC' },
      },
      cursor,
      limit: 100,
    })

    for (const order of page.orders ?? []) {
      if (!order.id) continue
      const name = buyerNameFromOrder(order).toLowerCase()
      if (name.length < 3) continue
      if (!name.includes(needle) && !needle.includes(name)) continue
      const createdAt = order.createdAt ?? ''
      if (!best || createdAt > best.createdAt) {
        best = { orderId: order.id, createdAt }
      }
    }
    cursor = page.cursor
  } while (cursor)

  return best?.orderId ?? null
}

export async function listPaidMedalOrders(): Promise<PaidMedalOrder[]> {
  if (config.mockMode) {
    return []
  }

  const locationId = config.square.locationId
  const orders: PaidMedalOrder[] = []
  let cursor: string | undefined

  do {
    const page = await getClient().orders.search({
      locationIds: [locationId],
      query: {
        filter: {
          stateFilter: { states: ['COMPLETED'] },
        },
        sort: { sortField: 'CREATED_AT', sortOrder: 'ASC' },
      },
      cursor,
      limit: 100,
    })

    for (const order of page.orders ?? []) {
      const looksLikeMedal =
        order.metadata?.product === 'icc-arrest-warrant-medal' ||
        (order.lineItems ?? []).some((li) =>
          (li.name ?? '').toLowerCase().includes('arrest warrant medal'),
        )
      if (!looksLikeMedal) continue

      const donations = parseDonationsFromOrder({
        metadata: order.metadata ?? null,
        lineItems: order.lineItems ?? null,
      })
      if (!donations) continue

      const medalOrgs = expandMedalOrgs(donations)
      const qty =
        Number(order.metadata?.medal_qty ?? 0) ||
        medalOrgs.length ||
        Math.max(
          0,
          ...(order.lineItems ?? [])
            .filter((li) =>
              (li.name ?? '').toLowerCase().includes('arrest warrant medal'),
            )
            .map((li) => Number(li.quantity ?? 0)),
        )

      if (!qty || medalOrgs.length === 0) continue

      orders.push({
        orderId: order.id ?? randomUUID(),
        createdAt: new Date(order.createdAt ?? Date.now()),
        quantity: qty,
        donations,
        medalOrgs,
        buyerName: buyerNameFromOrder(order),
        donationAud: (qty * HALF_PRICE_CENTS) / 100,
        productionAud: (qty * HALF_PRICE_CENTS) / 100,
        totalAud: (qty * UNIT_PRICE_CENTS) / 100,
      })
    }

    cursor = page.cursor
  } while (cursor)

  return orders
}

export async function getDonationSummary() {
  const inventory = await getInventory()
  const orders = await listPaidMedalOrders()

  const byOrg = ORG_IDS.map((orgId) => {
    const medals = orders.reduce(
      (sum, o) => sum + (o.donations[orgId] ?? 0),
      0,
    )
    return {
      orgId,
      label: DONATION_ORGS[orgId].name,
      medals,
      donationAud: medals * (HALF_PRICE_CENTS / 100),
      productionAud: medals * (HALF_PRICE_CENTS / 100),
    }
  })

  return {
    inventory,
    byOrg,
    totalMedalsSold: orders.reduce((sum, o) => sum + o.quantity, 0),
    totalDonationAud: byOrg.reduce((sum, o) => sum + o.donationAud, 0),
    totalProductionAud: byOrg.reduce((sum, o) => sum + o.productionAud, 0),
  }
}
