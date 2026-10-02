import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { WebhooksHelper } from 'square'
import {
  getBearerToken,
  issueAdminToken,
  verifyAdminToken,
} from './auth.js'
import {
  MAX_QTY,
  config,
} from './config.js'
import { isEmailConfigured } from './email.js'
import { buildRegisterWorkbook } from './exportRegister.js'
import {
  assertProductionSecrets,
  adminApiLimiter,
  adminLoginLimiter,
  checkoutLimiter,
  confirmationLimiter,
  generalLimiter,
  isAllowedCheckoutRedirect,
  isAllowedSquareOrderId,
  noStore,
  publicErrorMessage,
  safeEqual,
} from './security.js'
import {
  createCheckoutLink,
  getDonationSummary,
  getInventory,
  isDonationOrgId,
  parseAndValidateDonations,
  sendOrderConfirmationIfNeeded,
  findOrderIdByReceiptNumber,
  findOrderIdByBuyerName,
} from './square.js'

assertProductionSecrets()

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)
app.use(noStore)
app.use(generalLimiter)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      try {
        const frontendOrigin = new URL(config.frontendBaseUrl).origin
        if (origin === frontendOrigin) {
          callback(null, true)
          return
        }
      } catch {
        /* ignore invalid FRONTEND_BASE_URL */
      }
      // Do not throw — that becomes a 500 for form POSTs (e.g. Instagram checkout).
      callback(null, false)
    },
  }),
)

type RequestWithRawBody = express.Request & { rawBody?: string }

app.use(
  express.json({
    limit: '32kb',
    verify: (req, _res, buf) => {
      ;(req as RequestWithRawBody).rawBody = buf.toString('utf8')
    },
  }),
)
app.use(express.urlencoded({ extended: false, limit: '32kb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/inventory', async (_req, res) => {
  try {
    const inventory = await getInventory()
    res.json(inventory)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: publicErrorMessage(err, 'Inventory lookup failed'),
    })
  }
})

function parseCheckoutInput(body: {
  quantity?: unknown
  donations?: unknown
  donationOrg?: unknown
}): { quantity: number; donations: ReturnType<typeof parseAndValidateDonations> } {
  const quantity = Number(body?.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    throw new Error(`Quantity must be an integer from 1 to ${MAX_QTY}`)
  }

  let donations: unknown = body?.donations
  if (typeof donations === 'string') {
    try {
      donations = JSON.parse(donations)
    } catch {
      throw new Error('Invalid donation selection')
    }
  }
  if ((!donations || typeof donations !== 'object') && body?.donationOrg) {
    const org = String(body.donationOrg)
    if (!isDonationOrgId(org)) {
      throw new Error('Please choose a donation recipient')
    }
    donations = { [org]: quantity }
  }

  return {
    quantity,
    donations: parseAndValidateDonations(quantity, donations),
  }
}

app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  try {
    const input = parseCheckoutInput(req.body ?? {})
    const { url } = await createCheckoutLink(input)
    if (!isAllowedCheckoutRedirect(url)) {
      throw new Error('Checkout failed')
    }
    res.json({ url })
  } catch (err) {
    console.error(err)
    res.status(400).json({
      error: publicErrorMessage(err, 'Checkout failed'),
    })
  }
})

/**
 * Full-page form POST → redirect to Square.
 * Needed for Instagram / in-app browsers that block cross-origin fetch ("Load failed").
 */
app.post('/api/checkout/start', checkoutLimiter, async (req, res) => {
  try {
    const input = parseCheckoutInput(req.body ?? {})
    const { url } = await createCheckoutLink(input)
    if (!isAllowedCheckoutRedirect(url)) {
      throw new Error('Checkout failed')
    }
    res.redirect(303, url)
  } catch (err) {
    console.error(err)
    const message = publicErrorMessage(err, 'Checkout failed')
    res.redirect(
      303,
      config.frontendUrl(`/shop?checkoutError=${encodeURIComponent(message)}`),
    )
  }
})

app.post(
  '/api/orders/:orderId/send-confirmation',
  confirmationLimiter,
  async (req, res) => {
    try {
      const orderId = String(req.params.orderId ?? '')
      if (!isAllowedSquareOrderId(orderId)) {
        res.status(400).json({ error: 'Invalid order id' })
        return
      }
      const result = await sendOrderConfirmationIfNeeded(orderId)
      res.json({ ok: true, sent: result.sent, reason: result.reason })
    } catch (err) {
      console.error(err)
      const detail = err instanceof Error ? err.message : 'Confirmation email failed'
      res.status(500).json({ error: 'Confirmation email failed', detail })
    }
  },
)

app.get('/api/webhooks/square', (_req, res) => {
  res.status(200).end()
})

app.post('/api/webhooks/square', async (req, res) => {
  try {
    const signature = String(
      req.header('x-square-hmacsha256-signature') ?? '',
    )
    const rawBody = (req as RequestWithRawBody).rawBody ?? ''

    if (!config.square.webhookSignatureKey) {
      console.error('SQUARE_WEBHOOK_SIGNATURE_KEY is not set')
      res.status(503).json({ error: 'Webhook not configured' })
      return
    }

    const valid = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader: signature,
      signatureKey: config.square.webhookSignatureKey,
      notificationUrl: config.square.webhookNotificationUrl,
    })
    if (!valid) {
      res.status(403).json({ error: 'Invalid signature' })
      return
    }

    const event = req.body as {
      type?: string
      data?: { object?: Record<string, unknown> }
    }
    const type = event.type ?? ''
    const obj = (event.data?.object ?? {}) as Record<string, unknown>
    const nested = (key: string) =>
      obj[key] && typeof obj[key] === 'object'
        ? (obj[key] as Record<string, unknown>)
        : undefined
    const payment =
      nested('payment') ??
      (typeof obj.status === 'string' && (obj.orderId || obj.order_id)
        ? obj
        : undefined)
    const orderUpdated = nested('orderUpdated') ?? nested('order_updated')
    const order = nested('order')
    const candidates = [
      payment?.orderId,
      payment?.order_id,
      orderUpdated?.orderId,
      orderUpdated?.order_id,
      order?.id,
      obj.orderId,
      obj.order_id,
    ]
    const orderId = candidates.find(
      (value): value is string =>
        typeof value === 'string' && isAllowedSquareOrderId(value),
    )
    const status = [payment?.status, orderUpdated?.state, order?.state].find(
      (value): value is string => typeof value === 'string',
    )

    console.log('Square webhook', {
      type,
      status: status ?? null,
      orderId: orderId ? `${orderId.slice(0, 8)}…` : null,
    })

    // Payment links often stay OPEN after the card is charged. Do not wait
    // for COMPLETED — getOrderConfirmationDetails still requires a payment.
    const fromPayment =
      (type === 'payment.updated' || type === 'payment.created') &&
      (status === 'COMPLETED' || status === 'APPROVED' || !status)
    const fromOrder =
      type === 'order.updated' ||
      type === 'order.created' ||
      type === 'order.fulfillment.updated'
    const orderLooksSendable =
      !status ||
      status === 'OPEN' ||
      status === 'COMPLETED' ||
      status === 'APPROVED'

    if (
      (fromPayment || (fromOrder && orderLooksSendable)) &&
      orderId
    ) {
      const result = await sendOrderConfirmationIfNeeded(orderId)
      console.log('Order confirmation email', {
        orderId: `${orderId.slice(0, 8)}…`,
        sent: result.sent,
        reason: result.reason,
      })
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false })
  }
})

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const password = String(req.body?.password ?? '')
  if (!password || !safeEqual(password, config.adminPassword)) {
    res.status(401).json({ error: 'Invalid admin password' })
    return
  }
  res.json({ token: issueAdminToken() })
})

function requireAdmin(
  req: express.Request,
  res: express.Response,
): string | null {
  const token = getBearerToken(req.header('authorization') ?? undefined)
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return token
}

app.get('/api/admin/summary', adminApiLimiter, async (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    const summary = await getDonationSummary()
    res.json(summary)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: publicErrorMessage(err, 'Summary failed'),
    })
  }
})

app.get('/api/admin/export', adminApiLimiter, async (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    const buffer = await buildRegisterWorkbook()
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ICC-Netanyahu-Medal-Register-${stamp}.xlsx"`,
    )
    res.send(Buffer.from(buffer))
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: publicErrorMessage(err, 'Export failed'),
    })
  }
})

app.post(
  '/api/admin/resend-confirmation',
  adminApiLimiter,
  async (req, res) => {
    if (!requireAdmin(req, res)) return
    try {
      const receiptNumber = String(req.body?.receiptNumber ?? '').trim()
      const buyerName = String(req.body?.buyerName ?? '').trim()
      let orderId = String(req.body?.orderId ?? '').trim()

      if (!orderId && receiptNumber) {
        orderId = (await findOrderIdByReceiptNumber(receiptNumber)) ?? ''
      }
      if (!orderId && buyerName) {
        orderId = (await findOrderIdByBuyerName(buyerName)) ?? ''
      }
      if (!orderId || !isAllowedSquareOrderId(orderId)) {
        res.status(404).json({
          error:
            'Could not find that Square receipt or buyer name. Try the receipt number (e.g. 35tx) exactly as shown in Square.',
        })
        return
      }

      const result = await sendOrderConfirmationIfNeeded(orderId, {
        force: true,
      })
      res.json({ ok: true, orderId, ...result })
    } catch (err) {
      console.error(err)
      res.status(500).json({
        error: publicErrorMessage(err, 'Resend failed'),
      })
    }
  },
)

app.listen(config.port, () => {
  console.log(
    `Medal API listening on :${config.port} (mockMode=${config.mockMode}, emailConfigured=${isEmailConfigured()})`,
  )
})
