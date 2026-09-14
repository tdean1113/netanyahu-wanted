import cors from 'cors'
import express from 'express'
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
  createCheckoutLink,
  getDonationSummary,
  getInventory,
  getOrderConfirmationDetails,
  isDonationOrgId,
  parseAndValidateDonations,
  sendOrderConfirmationIfNeeded,
} from './square.js'

const app = express()
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`CORS blocked for origin ${origin}`))
    },
  }),
)

type RequestWithRawBody = express.Request & { rawBody?: string }

app.use(
  express.json({
    limit: '100kb',
    verify: (req, _res, buf) => {
      ;(req as RequestWithRawBody).rawBody = buf.toString('utf8')
    },
  }),
)

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mockMode: config.mockMode,
    environment: config.square.environment,
    emailConfigured: isEmailConfigured(),
  })
})

app.get('/api/inventory', async (_req, res) => {
  try {
    const inventory = await getInventory()
    res.json(inventory)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Inventory lookup failed',
    })
  }
})

app.post('/api/checkout', async (req, res) => {
  try {
    const quantity = Number(req.body?.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      res.status(400).json({
        error: `Quantity must be an integer from 1 to ${MAX_QTY}`,
      })
      return
    }

    // Prefer donations map; accept legacy single donationOrg
    let donations = req.body?.donations
    if ((!donations || typeof donations !== 'object') && req.body?.donationOrg) {
      const org = String(req.body.donationOrg)
      if (!isDonationOrgId(org)) {
        res.status(400).json({ error: 'Please choose a donation recipient' })
        return
      }
      donations = { [org]: quantity }
    }

    const { url } = await createCheckoutLink({
      quantity,
      donations: parseAndValidateDonations(quantity, donations),
    })
    res.json({ url })
  } catch (err) {
    console.error(err)
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Checkout failed',
    })
  }
})

app.get('/api/orders/:orderId/confirmation', async (req, res) => {
  try {
    const orderId = String(req.params.orderId ?? '')
    if (!orderId) {
      res.status(400).json({ error: 'Missing order id' })
      return
    }
    const details = await getOrderConfirmationDetails(orderId)
    if (!details) {
      res.status(404).json({ error: 'Order not found' })
      return
    }
    res.json(details)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Order lookup failed',
    })
  }
})

app.post('/api/orders/:orderId/send-confirmation', async (req, res) => {
  try {
    const orderId = String(req.params.orderId ?? '')
    if (!orderId) {
      res.status(400).json({ error: 'Missing order id' })
      return
    }
    const result = await sendOrderConfirmationIfNeeded(orderId)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Confirmation email failed',
    })
  }
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
      data?: { object?: { payment?: { status?: string; orderId?: string } } }
    }
    const type = event.type ?? ''
    const payment = event.data?.object?.payment
    const orderId = payment?.orderId

    if (
      (type === 'payment.updated' || type === 'payment.created') &&
      payment?.status === 'COMPLETED' &&
      orderId
    ) {
      const result = await sendOrderConfirmationIfNeeded(orderId)
      console.log('Order confirmation email', { orderId, ...result })
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false })
  }
})

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password ?? '')
  if (!password || password !== config.adminPassword) {
    res.status(401).json({ error: 'Invalid admin password' })
    return
  }
  res.json({ token: issueAdminToken() })
})

function requireAdmin(
  req: express.Request,
  res: express.Response,
): string | null {
  const token =
    getBearerToken(req.header('authorization') ?? undefined) ??
    (typeof req.query.token === 'string' ? req.query.token : null)
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return token
}

app.get('/api/admin/summary', async (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    const summary = await getDonationSummary()
    res.json(summary)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Summary failed',
    })
  }
})

app.get('/api/admin/export', async (req, res) => {
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
      error: err instanceof Error ? err.message : 'Export failed',
    })
  }
})

app.listen(config.port, () => {
  console.log(
    `Medal API listening on :${config.port} (mockMode=${config.mockMode}, emailConfigured=${isEmailConfigured()})`,
  )
})
