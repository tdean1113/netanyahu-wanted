import { randomUUID } from 'node:crypto'
import { SquareClient, SquareEnvironment } from 'square'
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

  const donationLineItems = ORG_IDS.filter((id) => (donations[id] ?? 0) > 0).map(
    (orgId) => {
      const count = donations[orgId]!
      const orgMeta = DONATION_ORGS[orgId]
      const variationId = config.square.donationVariationIds[orgId]
      if (!variationId) {
        throw new Error(`Missing donation catalog variation for ${orgId}`)
      }
      return {
        name: `Donation — ${orgMeta.name}`,
        quantity: String(count),
        catalogObjectId: variationId,
        basePriceMoney: {
          amount: BigInt(HALF_PRICE_CENTS),
          currency: 'AUD' as const,
        },
        note: `Buyer-selected donation recipient: ${orgMeta.registerLabel} × ${count}`,
      }
    },
  )

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
            amount: BigInt(HALF_PRICE_CENTS),
            currency: 'AUD',
          },
          note: `Production / GST / postage. Edition of ${EDITION_SIZE}.`,
        },
        ...donationLineItems,
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
