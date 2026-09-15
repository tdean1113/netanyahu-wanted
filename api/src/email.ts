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

function buildBodies(details: OrderConfirmationDetails): {
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
    details.donationSummary ? `Donation recipient(s): ${details.donationSummary}` : '',
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

async function sendViaResend(to: string, subject: string, text: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      ...(config.email.bcc ? { bcc: [config.email.bcc] } : {}),
      subject,
      text,
      html,
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend failed (${response.status}): ${body}`)
  }
}

async function sendViaSmtp(to: string, subject: string, text: string, html: string) {
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
    to,
    bcc: config.email.bcc || undefined,
    subject,
    text,
    html,
  })
}

export async function sendBuyerOrderConfirmation(
  details: OrderConfirmationDetails,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) {
    return {
      sent: false,
      reason: 'Email is not configured (set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS)',
    }
  }
  if (!details.buyerEmail) {
    return { sent: false, reason: 'Order has no buyer email' }
  }

  const { text, html } = buildBodies(details)
  const subject = `Order confirmation — ICC Arrest Warrant Medal`

  if (config.email.resendApiKey) {
    await sendViaResend(details.buyerEmail, subject, text, html)
  } else {
    await sendViaSmtp(details.buyerEmail, subject, text, html)
  }

  return { sent: true }
}
