import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12

export function issueAdminToken(): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const payload = `admin:${exp}`
  const sig = createHmac('sha256', config.adminTokenSecret)
    .update(payload)
    .digest('hex')
  return Buffer.from(`${payload}:${sig}`).toString('base64url')
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const [role, expStr, sig] = raw.split(':')
    if (role !== 'admin' || !expStr || !sig) return false
    const exp = Number(expStr)
    if (!Number.isFinite(exp) || Date.now() > exp) return false
    const payload = `${role}:${expStr}`
    const expected = createHmac('sha256', config.adminTokenSecret)
      .update(payload)
      .digest('hex')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function getBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null
  return value
}
