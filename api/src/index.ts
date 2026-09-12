import cors from 'cors'
import express from 'express'
import {
  getBearerToken,
  issueAdminToken,
  verifyAdminToken,
} from './auth.js'
import {
  MAX_QTY,
  config,
} from './config.js'
import { buildRegisterWorkbook } from './exportRegister.js'
import {
  createCheckoutLink,
  getDonationSummary,
  getInventory,
  isDonationOrgId,
  parseAndValidateDonations,
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
app.use(express.json({ limit: '100kb' }))

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mockMode: config.mockMode,
    environment: config.square.environment,
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
    `Medal API listening on :${config.port} (mockMode=${config.mockMode})`,
  )
})
