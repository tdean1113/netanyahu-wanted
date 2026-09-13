import { useEffect, useMemo, useState } from 'react'
import SiteFooter from '../components/SiteFooter'
import { createCheckout, getInventory } from '../lib/api'
import {
  DONATION_ORGS,
  DONATION_PER_MEDAL_AUD,
  EDITION_SIZE,
  MAX_QTY,
  UNIT_PRICE_AUD,
  emptyAllocations,
  formatAud,
  type DonationAllocations,
  type DonationOrgId,
} from '../lib/donations'

/** Large tilted hero — always shown in the main slot; also first gallery slide. */
const HERO = {
  src: '/images/tilted.png',
  alt: 'Bronze ICC Arrest Warrant Issued commemorative medal, obverse, tilted',
}

/** Thumbnail strip — three images below the hero. */
const THUMBS = [
  { src: '/images/obverse.png', alt: 'Medal obverse' },
  {
    src: '/images/reverse.png',
    alt: 'Medal reverse with case details',
  },
  {
    src: '/images/in-case.png',
    alt: 'Medal in presentation case',
  },
]

/** Fullscreen gallery order: hero + strip. */
const GALLERY = [HERO, ...THUMBS]

const SPECS = [
  ['Size', '60mm'],
  ['Weight', '100gms (+/- 2gms)'],
  ['Metal', '99.9% Copper'],
  ['Finish', 'Antique Patina'],
  ['Packaging', 'Leather-like presentation case'],
] as const

function resizeRecipients(
  current: Array<DonationOrgId | null>,
  nextQty: number,
): Array<DonationOrgId | null> {
  if (nextQty === current.length) return current
  if (nextQty > current.length) {
    return [
      ...current,
      ...Array.from({ length: nextQty - current.length }, () => null),
    ]
  }
  return current.slice(0, nextQty)
}

function recipientsToDonations(
  recipients: Array<DonationOrgId | null>,
): DonationAllocations {
  const donations = emptyAllocations()
  for (const id of recipients) {
    if (id) donations[id] += 1
  }
  return donations
}

export default function Shop() {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  const [recipients, setRecipients] = useState<Array<DonationOrgId | null>>([
    null,
  ])
  const [sold, setSold] = useState(0)
  const [remaining, setRemaining] = useState(EDITION_SIZE)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const checkoutLive = import.meta.env.VITE_SQUARE_LIVE === 'true'
  const galleryOpen = galleryIndex != null
  const galleryImage =
    galleryIndex == null ? null : GALLERY[galleryIndex] ?? null

  useEffect(() => {
    document.title = 'ICC Arrest Warrant Medal — A$280 with A$140 Donation'
  }, [])

  useEffect(() => {
    getInventory()
      .then((data) => {
        setSold(data.sold)
        setRemaining(data.remaining)
      })
      .catch(() => {
        /* keep defaults when API offline */
      })
  }, [])

  useEffect(() => {
    if (!galleryOpen) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setGalleryIndex(null)
        return
      }
      if (e.key === 'ArrowLeft') {
        setGalleryIndex((i) =>
          i == null ? i : (i - 1 + GALLERY.length) % GALLERY.length,
        )
        return
      }
      if (e.key === 'ArrowRight') {
        setGalleryIndex((i) =>
          i == null ? i : (i + 1) % GALLERY.length,
        )
      }
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [galleryOpen])

  const missingCount = useMemo(
    () => recipients.filter((r) => r == null).length,
    [recipients],
  )
  const allSelected = missingCount === 0
  const donations = useMemo(
    () => recipientsToDonations(recipients),
    [recipients],
  )
  const donationTotal = qty * DONATION_PER_MEDAL_AUD
  const orderTotal = qty * UNIT_PRICE_AUD
  const soldPct = useMemo(
    () => Math.min(100, (sold / EDITION_SIZE) * 100),
    [sold],
  )

  const splitSummary = useMemo(() => {
    return DONATION_ORGS.filter((o) => donations[o.id] > 0)
      .map((o) => `${donations[o.id]}× ${o.registerLabel}`)
      .join(' · ')
  }, [donations])

  function setQuantity(next: number) {
    const clamped = Math.min(MAX_QTY, Math.max(1, next))
    setQty(clamped)
    setRecipients((prev) => resizeRecipients(prev, clamped))
    setError(null)
  }

  function setRecipientAt(index: number, orgId: DonationOrgId | null) {
    setRecipients((prev) => {
      const next = [...prev]
      next[index] = orgId
      return next
    })
    setError(null)
  }

  function applyAllTo(orgId: DonationOrgId) {
    setRecipients(Array.from({ length: qty }, () => orgId))
    setError(null)
  }

  async function handleBuy() {
    if (!allSelected) {
      setError(
        `Select a donation recipient for each medal (${missingCount} remaining).`,
      )
      return
    }
    setError(null)
    setBusy(true)
    try {
      const payload: Partial<Record<DonationOrgId, number>> = {}
      for (const org of DONATION_ORGS) {
        if (donations[org.id] > 0) payload[org.id] = donations[org.id]
      }
      const { url } = await createCheckout(qty, payload)
      window.location.href = url
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Checkout is unavailable right now.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-5">
          <h1 className="text-center text-3xl font-semibold tracking-wide md:text-4xl">
            NETANYAHU WANTED MEDALLION
          </h1>
          <div className="mt-2 flex w-full items-center justify-between">
            <span className="text-sm font-semibold uppercase tracking-[0.2em]">
              Medal Art Mint
            </span>
            <span className="text-xs text-muted">Limited to {EDITION_SIZE}</span>
          </div>
        </div>
      </header>

      <main className="min-h-screen bg-white">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 py-12 md:grid-cols-2 md:py-16">
          <section>
            <button
              type="button"
              className="mb-4 w-full rounded-2xl border border-line bg-panel p-6"
              onClick={() => setGalleryIndex(0)}
              aria-label="Open image gallery"
            >
              <img
                src={HERO.src}
                alt={HERO.alt}
                className="mx-auto w-full max-w-md"
              />
            </button>
            <div className="grid grid-cols-3 gap-3">
              {THUMBS.map((image, thumbIndex) => (
                <button
                  key={image.src}
                  type="button"
                  onClick={() => setGalleryIndex(thumbIndex + 1)}
                  className="rounded-xl border border-line bg-panel p-2"
                  aria-label={`Open gallery at ${image.alt}`}
                >
                  <img src={image.src} alt={image.alt} />
                </button>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-line bg-panel p-5">
              <h2 className="mb-4 text-sm font-semibold tracking-[0.14em] uppercase">
                Medal Specifications
              </h2>
              <dl className="space-y-3">
                {SPECS.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[120px_1fr] gap-3 text-sm"
                  >
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section>
            <h1 className="mb-5 text-3xl leading-tight font-semibold md:text-4xl">
              <span className="block">
                Netanyahu <span className="text-[1.5em]">WANTED</span>
              </span>
              <span className="block">ICC Arrest Warrant Issued</span>
            </h1>

            <div className="mb-6 space-y-4 text-[15px] leading-7 text-ink/90">
              <p>
                This limited-edition fine art medal documents the International
                Criminal Court&apos;s issuance of an arrest warrant for Benjamin
                Netanyahu, together with the official allegations of war crimes
                and crimes against humanity arising from the conflict in Gaza. The
                medal has been created as a permanent archival record, preserving
                one of the defining legal and humanitarian events of the
                twenty-first century.
              </p>
              <p>
                The medal also acknowledges the broader historical context of the
                immense suffering experienced by the Palestinian people and the
                continuing international legal proceedings and investigations
                concerning allegations of genocide and other serious violations of
                international law. It is intended not as a celebration, but as a
                documentary artefact that records a moment of profound historical
                significance.
              </p>
              <p>
                For over two thousand years, coins and medals have survived as
                some of humanity&apos;s most enduring historical records,
                preserving the actions of governments, leaders and pivotal events
                long after written and digital records have disappeared. Following
                this tradition, this medal has been created to endure as a
                tangible historical witness, allowing future generations to
                examine and reflect upon this period of history through one of
                civilisation&apos;s oldest and most permanent artistic media.
              </p>
              <p className="text-sm text-muted italic">
                The medal is not licensed or endorsed by the ICC and is published
                by Medal Art Mint as a record of fact.
              </p>
              <p className="text-sm text-muted">
                The struck medal is published by Medal Art Mint Australia and
                supplied in a presentation case and individually numbered from an
                edition of {EDITION_SIZE}.
              </p>
            </div>

            <div className="space-y-6 rounded-2xl border border-line bg-panel p-5 sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div className="text-3xl font-semibold">
                  {formatAud(UNIT_PRICE_AUD)}
                </div>
                <div className="text-sm text-muted">
                  incl. {formatAud(DONATION_PER_MEDAL_AUD)} donation
                </div>
              </div>

              <p className="text-sm leading-6 text-ink/80">
                Medal Art Mint donates half of every sale to a humanitarian
                organisation working directly in Palestine. You must choose a
                donation recipient for each medal. The remaining half covers
                producing the medal, GST in Australia and postage to anywhere in
                the world.
              </p>

              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>
                    {sold} of {EDITION_SIZE} sold
                  </span>
                  <span>{remaining} remaining</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-navy transition-all"
                    style={{ width: `${soldPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  The tally count does not reflect the serial-numbered medal that
                  you will receive. An actual serial number cannot be requested
                  and will be issued as available basis.
                </p>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold tracking-[0.14em] uppercase">
                  Quantity
                </div>
                <div className="mb-3 text-sm text-muted">
                  Up to {MAX_QTY} per order
                </div>
                <div className="inline-flex items-center overflow-hidden rounded-xl border border-line bg-white">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={qty <= 1}
                    onClick={() => setQuantity(qty - 1)}
                    className="h-11 w-11 disabled:opacity-40"
                  >
                    −
                  </button>
                  <div className="w-12 text-center font-medium">{qty}</div>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={qty >= MAX_QTY}
                    onClick={() => setQuantity(qty + 1)}
                    className="h-11 w-11 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold tracking-[0.14em] uppercase">
                  Donation recipient for each medal
                </div>
                <div className="mb-3 text-sm text-muted">
                  Required — {formatAud(DONATION_PER_MEDAL_AUD)} from each medal sold
                  goes to the organisation you select
                </div>

                <div className="mb-4 space-y-2">
                  {recipients.map((selected, index) => {
                    const missing = selected == null
                    return (
                      <div
                        key={`medal-${index}`}
                        className={`flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row sm:items-center sm:justify-between ${
                          missing
                            ? 'border-amber-400'
                            : 'border-link ring-1 ring-link/20'
                        }`}
                      >
                        <label
                          className="text-sm font-medium shrink-0"
                          htmlFor={`medal-recipient-${index}`}
                        >
                          Medal {index + 1}
                        </label>
                        <select
                          id={`medal-recipient-${index}`}
                          required
                          value={selected ?? ''}
                          onChange={(e) => {
                            const value = e.target.value
                            setRecipientAt(
                              index,
                              value === ''
                                ? null
                                : (value as DonationOrgId),
                            )
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-ink sm:max-w-md ${
                            missing ? 'border-amber-400' : 'border-line'
                          }`}
                        >
                          <option value="">
                            Choose a donation recipient…
                          </option>
                          {DONATION_ORGS.map((org) => (
                            <option key={org.id} value={org.id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>

                {qty > 1 ? (
                  <div className="mb-4 rounded-xl border border-line bg-white p-4">
                    <div className="text-sm font-medium text-ink">
                      Use the same organisation for every medal
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      Sets the donation recipient on all {qty} medals at once.
                      You can still change any medal individually afterwards.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="sr-only" htmlFor="apply-all-org">
                        Organisation for all medals
                      </label>
                      <select
                        id="apply-all-org"
                        defaultValue=""
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink sm:flex-1"
                        onChange={(e) => {
                          const value = e.target.value
                          if (!value) return
                          applyAllTo(value as DonationOrgId)
                          e.currentTarget.value = ''
                        }}
                      >
                        <option value="" disabled>
                          Choose organisation…
                        </option>
                        {DONATION_ORGS.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2 rounded-xl border border-line bg-white p-4">
                  <div className="text-xs font-semibold tracking-[0.14em] uppercase text-muted">
                    About the donation recipient organisations
                  </div>
                  {DONATION_ORGS.map((option) => (
                    <div key={option.id} className="text-sm">
                      <span className="font-medium">{option.name}</span>
                      <span className="text-muted"> — {option.description} </span>
                      <a
                        href={option.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link hover:underline"
                      >
                        Visit website
                      </a>
                    </div>
                  ))}
                </div>

                <p
                  className={`mt-3 text-sm ${
                    allSelected ? 'text-muted' : 'text-amber-700'
                  }`}
                >
                  {allSelected
                    ? `Recipient selected for every medal${splitSummary ? ` · ${splitSummary}` : ''}`
                    : 'Select a donation recipient for each medal'}
                </p>
              </div>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <div className="flex items-end justify-between gap-4 pt-2">
                <div className="text-sm text-muted">
                  {qty} medal{qty === 1 ? '' : 's'} · {formatAud(donationTotal)}{' '}
                  donated
                </div>
                <div className="text-2xl font-semibold">
                  {formatAud(orderTotal)}
                </div>
              </div>

              <button
                type="button"
                onClick={handleBuy}
                disabled={busy || !allSelected}
                className="w-full rounded-lg bg-navy py-3.5 font-semibold text-white hover:bg-ink disabled:opacity-70"
              >
                {busy
                  ? 'Redirecting to secure checkout…'
                  : !allSelected
                    ? 'Select a donation recipient for each medal purchased'
                    : checkoutLive
                      ? `Buy now — ${formatAud(orderTotal)}`
                      : `Testing Purchase Only — ${formatAud(orderTotal)}`}
              </button>

              <p className="text-center text-xs text-muted">
                {checkoutLive
                  ? 'Secure payment by Square. Your donation choices are recorded with your order.'
                  : 'Sandbox / test mode — set VITE_SQUARE_LIVE=true when your production Square key is ready. Donation choices are still recorded.'}
              </p>
            </div>
          </section>
        </div>
      </main>

      <div className="mx-auto max-w-3xl px-6 pt-10 pb-4 text-sm text-muted">
        <p>
          Contact:{' '}
          <a
            href="mailto:info@netanyahuwanted.com"
            className="text-link hover:underline"
          >
            info@netanyahuwanted.com
          </a>
        </p>
      </div>
      <SiteFooter />

      {galleryOpen && galleryImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
          onClick={() => setGalleryIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Medal image gallery"
        >
          <button
            type="button"
            className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
            onClick={() => setGalleryIndex(null)}
            aria-label="Close gallery"
          >
            Close
          </button>

          <button
            type="button"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 px-3 py-3 text-xl text-white hover:bg-white/20 sm:left-6"
            onClick={(e) => {
              e.stopPropagation()
              setGalleryIndex(
                (i) =>
                  i == null ? i : (i - 1 + GALLERY.length) % GALLERY.length,
              )
            }}
            aria-label="Previous image"
          >
            ‹
          </button>

          <figure
            className="flex max-h-full max-w-full flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={galleryImage.src}
              alt={galleryImage.alt}
              className="max-h-[80vh] max-w-[90vw] object-contain"
            />
            <figcaption className="text-center text-sm text-white/80">
              {galleryImage.alt}
              <span className="mt-1 block text-xs text-white/50">
                {(galleryIndex ?? 0) + 1} / {GALLERY.length}
              </span>
            </figcaption>
          </figure>

          <button
            type="button"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 px-3 py-3 text-xl text-white hover:bg-white/20 sm:right-6"
            onClick={(e) => {
              e.stopPropagation()
              setGalleryIndex(
                (i) => (i == null ? i : (i + 1) % GALLERY.length),
              )
            }}
            aria-label="Next image"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  )
}
