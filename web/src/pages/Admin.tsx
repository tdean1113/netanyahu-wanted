import { useEffect, useMemo, useState } from 'react'
import {
  adminLogin,
  getAdminSummary,
  getExportUrl,
  type AdminSummaryResponse,
} from '../lib/api'
import { formatAud } from '../lib/donations'
import { Link } from 'react-router-dom'

const TOKEN_KEY = 'mam_admin_token'

export default function Admin() {
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    getAdminSummary(token)
      .then((data) => {
        if (!cancelled) {
          setSummary(data)
          setError(null)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message)
          setToken('')
          sessionStorage.removeItem(TOKEN_KEY)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const exportHref = useMemo(() => (token ? getExportUrl(token) : ''), [token])

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { token: next } = await adminLogin(password)
      sessionStorage.setItem(TOKEN_KEY, next)
      setToken(next)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setSummary(null)
  }

  useEffect(() => {
    document.title = 'Gift Register — Medal Art Mint'
  }, [])

  if (!token) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center px-6 py-16">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-md border border-line rounded-2xl p-8 shadow-sm"
        >
          <h1 className="text-2xl font-semibold mb-2">Gift register</h1>
          <p className="text-muted mb-6">
            Enter the admin password to record gifted medals, view stock and
            donation totals, and download the medal register.
          </p>
          <label className="block text-sm font-medium mb-2" htmlFor="admin-password">
            Admin password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full border border-line rounded-xl px-4 py-3 mb-4 outline-none focus:border-ink"
            required
          />
          {error ? <p className="text-red-600 text-sm mb-4">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-navy text-white rounded-xl py-3 font-medium hover:bg-ink disabled:opacity-60"
          >
            {loading ? 'Unlocking…' : 'Unlock'}
          </button>
          <div className="text-center mt-4">
            <Link to="/shop" className="text-link hover:underline">
              Back to the store
            </Link>
          </div>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-semibold mb-2">Admin</h1>
            <p className="text-muted">
              Stock is held in Square. Update inventory there when you give medals
              away. Download the register sheet for serials and donation splits.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-muted hover:text-ink shrink-0"
          >
            Lock
          </button>
        </div>

        {loading && !summary ? (
          <p className="text-muted">Loading…</p>
        ) : null}
        {error ? <p className="text-red-600 mb-4">{error}</p> : null}

        {summary ? (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <Stat label="Edition" value={String(summary.inventory.edition)} />
              <Stat label="Sold (paid)" value={String(summary.totalMedalsSold)} />
              <Stat
                label="Remaining (Square)"
                value={String(summary.inventory.remaining)}
              />
              <Stat
                label="Donations directed"
                value={formatAud(summary.totalDonationAud)}
              />
            </section>

            <section className="border border-line rounded-2xl overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-line bg-panel">
                <h2 className="font-semibold">Donation allocation</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="px-5 py-3 font-medium">Organisation</th>
                    <th className="px-5 py-3 font-medium">Medals</th>
                    <th className="px-5 py-3 font-medium">Donation</th>
                    <th className="px-5 py-3 font-medium">Production</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byOrg.map((row) => (
                    <tr key={row.orgId} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">{row.label}</td>
                      <td className="px-5 py-3">{row.medals}</td>
                      <td className="px-5 py-3">{formatAud(row.donationAud)}</td>
                      <td className="px-5 py-3">{formatAud(row.productionAud)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <a
              href={exportHref}
              className="inline-flex items-center justify-center bg-navy text-white rounded-xl px-6 py-3 font-medium hover:bg-ink"
            >
              Download sheet
            </a>
            <p className="text-sm text-muted mt-3">
              Downloads the ICC Netanyahu Medal Register (.xlsx) with paid orders
              filled as Sold (S) rows. Mark Donation Sent and gifts in the sheet
              or Square Dashboard as needed.
            </p>
          </>
        ) : null}

        <div className="mt-10">
          <Link to="/shop" className="text-link hover:underline">
            Back to the store
          </Link>
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line rounded-2xl p-4 bg-panel">
      <div className="text-xs uppercase tracking-wide text-muted mb-1">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}
