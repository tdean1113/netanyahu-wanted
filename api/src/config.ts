import 'dotenv/config'

export type DonationOrgId =
  | 'apan'
  | 'acij'
  | 'olive-kids'
  | 'para'
  | 'panzma'

export const DONATION_ORGS: Record<
  DonationOrgId,
  { registerLabel: string; name: string }
> = {
  apan: {
    registerLabel: 'APAN',
    name: 'Australian Palestine Advocacy Network',
  },
  acij: {
    registerLabel: 'ACIJ',
    name: 'Australian Centre for International Justice',
  },
  'olive-kids': {
    registerLabel: 'OLIVE KIDS',
    name: 'Olive Kids Australia',
  },
  para: {
    registerLabel: 'PARA',
    name: 'Palestine Action and Relief Australia',
  },
  panzma: {
    registerLabel: 'PANZMA',
    name: 'PANZMA — Palestinian Australian New Zealand Medical Association',
  },
}

export const ORG_IDS = Object.keys(DONATION_ORGS) as DonationOrgId[]

export const EDITION_SIZE = 1000
export const UNIT_PRICE_CENTS = 28_000
export const HALF_PRICE_CENTS = 14_000
export const MAX_QTY = 10

function required(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  adminPassword: required('ADMIN_PASSWORD', 'changeme'),
  adminTokenSecret: required('ADMIN_TOKEN_SECRET', 'dev-admin-secret'),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  frontendBaseUrl: required('FRONTEND_BASE_URL', 'http://localhost:5173'),
  /** Join a path onto FRONTEND_BASE_URL without dropping any base path segment. */
  frontendUrl(path: string): string {
    const base = this.frontendBaseUrl.replace(/\/$/, '')
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${base}${suffix}`
  },
  square: {
    accessToken: required('SQUARE_ACCESS_TOKEN'),
    locationId: required('SQUARE_LOCATION_ID'),
    environment: (process.env.SQUARE_ENVIRONMENT ?? 'sandbox') as
      | 'sandbox'
      | 'production',
    medalVariationId: required('SQUARE_MEDAL_VARIATION_ID'),
    donationVariationIds: {
      apan: required('SQUARE_DONATION_APAN_VARIATION_ID'),
      acij: required('SQUARE_DONATION_ACIJ_VARIATION_ID'),
      'olive-kids': required('SQUARE_DONATION_OLIVE_KIDS_VARIATION_ID'),
      para: required('SQUARE_DONATION_PARA_VARIATION_ID'),
      panzma: required('SQUARE_DONATION_PANZMA_VARIATION_ID'),
    } as Record<DonationOrgId, string>,
    webhookSignatureKey: required('SQUARE_WEBHOOK_SIGNATURE_KEY'),
    webhookNotificationUrl: required(
      'SQUARE_WEBHOOK_NOTIFICATION_URL',
      'https://mam-medal-api-151658014953.australia-southeast1.run.app/api/webhooks/square',
    ),
  },
  merchant: {
    supportEmail: required(
      'MERCHANT_SUPPORT_EMAIL',
      'info@netanyahuwanted.com',
    ),
    name: required('MERCHANT_NAME', 'Medal Art Mint'),
  },
  email: {
    from: required(
      'EMAIL_FROM',
      'Medal Art Mint <info@netanyahuwanted.com>',
    ),
    /** Optional BCC so you also get a copy of each buyer confirmation. */
    bcc: required('EMAIL_BCC', 'tdean1113@gmail.com'),
    resendApiKey: required('RESEND_API_KEY'),
    smtp: {
      host: required('SMTP_HOST'),
      port: Number(process.env.SMTP_PORT ?? 587),
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS'),
    },
  },
  mockMode: process.env.MOCK_SQUARE === '1' || !process.env.SQUARE_ACCESS_TOKEN,
}
