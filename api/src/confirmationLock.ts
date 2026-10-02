import { config } from './config.js'

const COLLECTION = 'orderEmailLocks'

const memoryHeld = new Set<string>()
let firestoreUnavailableLogged = false

type RemoteClaim = 'acquired' | 'held' | 'unavailable'

interface GcpIdentity {
  token: string
  projectId: string
}

async function readMetadata(path: string): Promise<string | null> {
  try {
    const response = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/${path}`,
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(2000),
      },
    )
    if (!response.ok) return null
    return (await response.text()).trim()
  } catch {
    return null
  }
}

async function getGcpIdentity(): Promise<GcpIdentity | null> {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    (await readMetadata('project/project-id'))
  if (!projectId) return null

  const raw = await readMetadata('instance/service-accounts/default/token')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { access_token?: string }
    if (!parsed.access_token) return null
    return { token: parsed.access_token, projectId }
  } catch {
    return null
  }
}

function collectionUrl(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/databases/(default)/documents/${COLLECTION}`
}

async function firestoreDocUrl(
  identity: GcpIdentity,
  orderId: string,
): Promise<string> {
  return `${collectionUrl(identity.projectId)}/${encodeURIComponent(orderId)}`
}

async function isStaleLock(
  identity: GcpIdentity,
  orderId: string,
): Promise<boolean> {
  try {
    const response = await fetch(await firestoreDocUrl(identity, orderId), {
      headers: { Authorization: `Bearer ${identity.token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return false
    const body = (await response.json()) as {
      fields?: { claimedAt?: { timestampValue?: string } }
    }
    const claimedAt = body.fields?.claimedAt?.timestampValue
    if (!claimedAt) return false
    const ageMs = Date.now() - Date.parse(claimedAt)
    return Number.isFinite(ageMs) && ageMs > 2 * 60_000
  } catch {
    return false
  }
}

async function claimFirestore(
  identity: GcpIdentity,
  orderId: string,
): Promise<RemoteClaim> {
  const url = `${collectionUrl(identity.projectId)}?documentId=${encodeURIComponent(
    orderId,
  )}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          claimedAt: { timestampValue: new Date().toISOString() },
        },
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (response.ok) return 'acquired'
    if (response.status === 409) {
      if (await isStaleLock(identity, orderId)) {
        await fetch(await firestoreDocUrl(identity, orderId), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${identity.token}` },
          signal: AbortSignal.timeout(8000),
        })
        const retry = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${identity.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              claimedAt: { timestampValue: new Date().toISOString() },
            },
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (retry.ok) return 'acquired'
        if (retry.status === 409) return 'held'
      }
      return 'held'
    }

    const body = await response.text()
    if (!firestoreUnavailableLogged) {
      firestoreUnavailableLogged = true
      console.error('Confirmation lock Firestore unavailable', {
        status: response.status,
        body: body.slice(0, 500),
      })
    }
    return 'unavailable'
  } catch (err) {
    if (!firestoreUnavailableLogged) {
      firestoreUnavailableLogged = true
      console.error('Confirmation lock Firestore error', err)
    }
    return 'unavailable'
  }
}

async function releaseFirestore(orderId: string): Promise<void> {
  const identity = await getGcpIdentity()
  if (!identity) return

  const url = await firestoreDocUrl(identity, orderId)
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${identity.token}` },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    console.error('Confirmation lock release failed', err)
  }
}

/** Returns true if this caller may send the confirmation for this order. */
export async function claimConfirmationLock(orderId: string): Promise<boolean> {
  if (memoryHeld.has(orderId)) return false

  if (config.mockMode) {
    memoryHeld.add(orderId)
    return true
  }

  const identity = await getGcpIdentity()
  if (!identity) {
    memoryHeld.add(orderId)
    return true
  }

  const remote = await claimFirestore(identity, orderId)
  if (remote === 'held') {
    memoryHeld.add(orderId)
    return false
  }
  if (remote === 'acquired') {
    memoryHeld.add(orderId)
    return true
  }

  // Prefer sending once over blocking fulfilment mail if Firestore is down.
  console.error(
    'Confirmation lock unavailable; sending with in-memory lock only',
  )
  memoryHeld.add(orderId)
  return true
}

export async function releaseConfirmationLock(orderId: string): Promise<void> {
  memoryHeld.delete(orderId)
  if (!config.mockMode) {
    await releaseFirestore(orderId)
  }
}
