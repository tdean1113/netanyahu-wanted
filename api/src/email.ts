import nodemailer from 'nodemailer'
import { config } from './config.js'
import type { OrderConfirmationDetails } from './square.js'

export function isEmailConfigured(): boolean {
  if (config.email.resendApiKey) return true
  const { host, user, pass } = config.email.smtp
  return Boolean(host && user && pass)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatAddressLines(details: OrderConfirmationDetails): string[] {
  const a = details.deliveryAddress
  if (!a) return []
  return [
    a.addressLine1,
    a.addressLine2,
    a.addressLine3,
    [a.locality, a.administrativeDistrictLevel1, a.postalCode]
      .filter(Boolean)
      .join(' '),
    a.country,
  ].filter((line): line is string => Boolean(line && line.trim()))
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((value) => value.trim())
    .filter((value) => value.includes('@'))
}

/** Fulfilment copy goes only to Tony — not the public shop inboxes. */
function merchantNotifyAddresses(): string[] {
  return ['tdean1113@gmail.com']
}

function buildBuyerBodies(details: OrderConfirmationDetails): {
  text: string
  html: string
} {
  const addressLines = formatAddressLines(details)
  const total = `A$${(details.totalCents / 100).toFixed(2)}`
  const merchant = config.merchant.name
  const support = config.merchant.supportEmail

  const text = [
    `Thank you for your order with ${merchant}.`,
    '',
    `Order: ${details.quantity} × ICC Arrest Warrant Medal`,
    `Total paid: ${total}`,
    details.donationSummary
      ? `Donation recipient(s): ${details.donationSummary}`
      : '',
    '',
    'Your contact details',
    details.buyerName ? `Name: ${details.buyerName}` : '',
    details.buyerEmail ? `Email: ${details.buyerEmail}` : '',
    '',
    'Delivery address',
    ...(addressLines.length ? addressLines : ['(No delivery address on file)']),
    '',
    details.receiptUrl ? `Square payment receipt: ${details.receiptUrl}` : '',
    '',
    `Questions? Contact ${support}`,
    '',
    merchant,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
    <div style="font-family: Georgia, serif; color: #1a1a1a; line-height: 1.5; max-width: 560px;">
      <p>Thank you for your order with <strong>${escapeHtml(merchant)}</strong>.</p>
      <p>
        <strong>Order:</strong> ${details.quantity} × ICC Arrest Warrant Medal<br/>
        <strong>Total paid:</strong> ${escapeHtml(total)}
        ${
          details.donationSummary
            ? `<br/><strong>Donation recipient(s):</strong> ${escapeHtml(details.donationSummary)}`
            : ''
        }
      </p>
      <h2 style="font-size: 1.1rem; margin-bottom: 0.35rem;">Your contact details</h2>
      <p style="margin-top: 0;">
        ${details.buyerName ? `Name: ${escapeHtml(details.buyerName)}<br/>` : ''}
        ${details.buyerEmail ? `Email: ${escapeHtml(details.buyerEmail)}` : ''}
      </p>
      <h2 style="font-size: 1.1rem; margin-bottom: 0.35rem;">Delivery address</h2>
      <p style="margin-top: 0;">
        ${
          addressLines.length
            ? addressLines.map(escapeHtml).join('<br/>')
            : '(No delivery address on file)'
        }
      </p>
      ${
        details.receiptUrl
          ? `<p><a href="${escapeHtml(details.receiptUrl)}">View Square payment receipt</a></p>`
          : ''
      }
      <p>Questions? Contact <a href="mailto:${escapeHtml(support)}">${escapeHtml(support)}</a></p>
      <p>${escapeHtml(merchant)}</p>
    </div>
  `.trim()

  return { text, html }
}

function buildMerchantBodies(details: OrderConfirmationDetails): {
  text: string
  html: string
} {
  const addressLines = formatAddressLines(details)
  const total = `A$${(details.totalCents / 100).toFixed(2)}`
  const shipName = details.buyerName || 'Buyer'

  const text = [
    `New medal order — please ship.`,
    '',
    `Order ID: ${details.orderId}`,
    `Item: ${details.quantity} × ICC Arrest Warrant Medal`,
    `Total paid: ${total}`,
    details.donationSummary
      ? `Donation recipient(s): ${details.donationSummary}`
      : '',
    '',
    'Ship to',
    `Name: ${shipName}`,
    details.buyerEmail ? `Email: ${details.buyerEmail}` : '',
    ...(addressLines.length ? addressLines : ['(No delivery address on file)']),
    '',
    details.receiptUrl ? `Square receipt: ${details.receiptUrl}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
    <div style="font-family: Georgia, serif; color: #1a1a1a; line-height: 1.5; max-width: 560px;">
      <p><strong>New medal order — please ship.</strong></p>
      <p>
        <strong>Order ID:</strong> ${escapeHtml(details.orderId)}<br/>
        <strong>Item:</strong> ${details.quantity} × ICC Arrest Warrant Medal<br/>
        <strong>Total paid:</strong> ${escapeHtml(total)}
        ${
          details.donationSummary
            ? `<br/><strong>Donation recipient(s):</strong> ${escapeHtml(details.donationSummary)}`
            : ''
        }
      </p>
      <h2 style="font-size: 1.1rem; margin-bottom: 0.35rem;">Ship to</h2>
      <p style="margin-top: 0;">
        Name: ${escapeHtml(shipName)}<br/>
        ${details.buyerEmail ? `Email: ${escapeHtml(details.buyerEmail)}<br/>` : ''}
        ${
          addressLines.length
            ? addressLines.map(escapeHtml).join('<br/>')
            : '(No delivery address on file)'
        }
      </p>
      ${
        details.receiptUrl
          ? `<p><a href="${escapeHtml(details.receiptUrl)}">View Square payment receipt</a></p>`
          : ''
      }
    </div>
  `.trim()

  return { text, html }
}

async function sendViaResend(opts: {
  to: string
  subject: string
  text: string
  html: string
  bcc?: string
  idempotencyKey?: string
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
      ...(opts.idempotencyKey
        ? { 'Idempotency-Key': opts.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: config.email.from,
      to: parseEmailList(opts.to),
      ...(opts.bcc ? { bcc: parseEmailList(opts.bcc) } : {}),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    }),
  })
  if (response.status === 409) {
    return
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend failed (${response.status}): ${body}`)
  }
}

async function sendViaSmtp(opts: {
  to: string
  subject: string
  text: string
  html: string
  bcc?: string
}) {
  const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.port === 465,
    auth: {
      user: config.email.smtp.user,
      pass: config.email.smtp.pass,
    },
  })

  await transporter.sendMail({
    from: config.email.from,
    to: opts.to,
    bcc: opts.bcc || undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
}

async function sendMail(opts: {
  to: string
  subject: string
  text: string
  html: string
  bcc?: string
  idempotencyKey?: string
}) {
  if (config.email.resendApiKey) {
    await sendViaResend(opts)
  } else {
    await sendViaSmtp(opts)
  }
}

/** Buyer thank-you + merchant ship-to notice (address for fulfillment). */
export async function sendBuyerOrderConfirmation(
  details: OrderConfirmationDetails,
  opts?: { force?: boolean },
): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) {
    return {
      sent: false,
      reason:
        'Email is not configured (set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS)',
    }
  }

  const merchantTo = merchantNotifyAddresses()
  if (merchantTo.length === 0 && !details.buyerEmail) {
    return { sent: false, reason: 'No merchant or buyer email to notify' }
  }

  const idempotencySuffix = opts?.force ? `-${Date.now()}` : ''

  // Merchant fulfillment email first — this is the address you need to ship.
  if (merchantTo.length > 0) {
    const merchant = buildMerchantBodies(details)
    const who = details.buyerName || 'buyer'
    await sendMail({
      to: merchantTo.join(','),
      subject: `New medal order — ship to ${who}`,
      text: merchant.text,
      html: merchant.html,
      idempotencyKey: `medal-merchant-${details.orderId}${idempotencySuffix}`.slice(
        0,
        256,
      ),
    })
  }

  if (details.buyerEmail) {
    const buyer = buildBuyerBodies(details)
    await sendMail({
      to: details.buyerEmail,
      subject: `Order confirmation — ICC Arrest Warrant Medal`,
      text: buyer.text,
      html: buyer.html,
      idempotencyKey: `medal-buyer-${details.orderId}${idempotencySuffix}`.slice(
        0,
        256,
      ),
    })
  }

  return { sent: true }
}
