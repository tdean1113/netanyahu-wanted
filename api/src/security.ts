import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { config } from './config.js'

export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return

  const weakPassword =
    !config.adminPassword ||
    config.adminPassword === 'changeme' ||
    config.adminPassword.length < 16

  const weakTokenSecret =
    !config.adminTokenSecret ||
    config.adminTokenSecret === 'dev-admin-secret' ||
    config.adminTokenSecret.length < 32

  if (weakPassword || weakTokenSecret) {
    throw new Error(
      'Refusing to start: set a strong ADMIN_PASSWORD (16+ chars) and ADMIN_TOKEN_SECRET (32+ random chars) in production.',
    )
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

export function isAllowedSquareOrderId(orderId: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(orderId)
}

export function publicErrorMessage(err: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== 'production' && err instanceof Error && err.message) {
    return err.message
  }
  if (err instanceof Error) {
    const msg = err.message
    const safePrefixes = [
      'Quantity must',
      'Select a donation',
      'Unknown donation',
      'Donation counts',
      'Only ',
      'Please choose',
      'Invalid donation',
      'Checkout failed',
    ]
    if (safePrefixes.some((prefix) => msg.startsWith(prefix))) return msg
  }
  return fallback
}

export function isAllowedCheckoutRedirect(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      host === 'squareup.com' ||
      host.endsWith('.squareup.com') ||
      host === 'square.link' ||
      host.endsWith('.square.link') ||
      host === 'squareupsandbox.com' ||
      host.endsWith('.squareupsandbox.com') ||
      host === 'checkout.square.site' ||
      host.endsWith('.square.site')
    )
  } catch {
    return false
  }
}

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  skip: (req) => req.path === '/health' || req.path === '/api/webhooks/square',
})

export const checkoutLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
})

export const confirmationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
})

export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
})

export const adminApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
})
