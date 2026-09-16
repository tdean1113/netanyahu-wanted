const SITE_ORIGIN = 'https://netanyahuwanted.com'
const DEFAULT_IMAGE = `${SITE_ORIGIN}/images/obverse.png`
const SITE_NAME = 'Medal Art Mint'

export type SeoProps = {
  title: string
  description: string
  path?: string
  image?: string
  type?: 'website' | 'product'
  noIndex?: boolean
}

function upsertMeta(
  attr: 'name' | 'property',
  key: string,
  content: string,
) {
  const selector = `meta[${attr}="${key}"]`
  let el = document.head.querySelector(selector) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(
    `link[rel="${rel}"]`,
  ) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

function upsertJsonLd(id: string, data: Record<string, unknown>) {
  let el = document.getElementById(id) as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.id = id
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

export function applySeo({
  title,
  description,
  path = '/',
  image = DEFAULT_IMAGE,
  type = 'website',
  noIndex = false,
}: SeoProps) {
  const url = `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`

  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow')
  upsertMeta(
    'name',
    'google-site-verification',
    'f_KQT4ZQaGUwCYVknSrCZxCYZOXKoe_7nJoCZi3M0X4',
  )
  upsertLink('canonical', url)

  upsertMeta('property', 'og:site_name', SITE_NAME)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:type', type === 'product' ? 'product' : 'website')
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:image', image)
  upsertMeta('property', 'og:locale', 'en_AU')

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', image)
}

export function applyProductJsonLd(opts: {
  name: string
  description: string
  image?: string
  priceAud: number
  remaining: number
  editionSize: number
}) {
  const available =
    opts.remaining > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/SoldOut'

  upsertJsonLd('seo-product-jsonld', {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: opts.name,
    description: opts.description,
    image: [opts.image ?? DEFAULT_IMAGE],
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    offers: {
      '@type': 'Offer',
      url: `${SITE_ORIGIN}/shop`,
      priceCurrency: 'AUD',
      price: opts.priceAud.toFixed(2),
      availability: available,
      itemCondition: 'https://schema.org/NewCondition',
    },
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Edition size',
        value: String(opts.editionSize),
      },
      {
        '@type': 'PropertyValue',
        name: 'Remaining',
        value: String(opts.remaining),
      },
    ],
  })
}

export function removeProductJsonLd() {
  document.getElementById('seo-product-jsonld')?.remove()
}

export { SITE_ORIGIN, SITE_NAME, DEFAULT_IMAGE }
