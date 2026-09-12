import type { DonationOrgId } from './donations'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export interface InventoryResponse {
  sold: number
  remaining: number
  edition: number
}

export interface CheckoutResponse {
  url: string
}

export interface AdminSummaryOrg {
  orgId: DonationOrgId | string
  label: string
  medals: number
  donationAud: number
  productionAud: number
}

export interface AdminSummaryResponse {
  inventory: InventoryResponse
  byOrg: AdminSummaryOrg[]
  totalMedalsSold: number
  totalDonationAud: number
  totalProductionAud: number
}

export function getInventory() {
  return request<InventoryResponse>('/api/inventory')
}

export function createCheckout(
  quantity: number,
  donations: Partial<Record<DonationOrgId, number>>,
) {
  return request<CheckoutResponse>('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({ quantity, donations }),
  })
}

export function adminLogin(password: string) {
  return request<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function getAdminSummary(token: string) {
  return request<AdminSummaryResponse>('/api/admin/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getExportUrl(token: string) {
  const base = import.meta.env.VITE_API_BASE_URL ?? ''
  return `${base}/api/admin/export?token=${encodeURIComponent(token)}`
}
