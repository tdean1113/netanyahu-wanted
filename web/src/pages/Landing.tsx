import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { applySeo } from '../lib/seo'

export default function Landing() {
  useEffect(() => {
    applySeo({
      title: 'Medal Art Mint — ICC Arrest Warrant Medal | Netanyahu Wanted',
      description:
        'Limited edition ICC Arrest Warrant Issued commemorative medal by Medal Art Mint. A$280 including A$140 donation to humanitarian organisations. Free postage. Edition of 1000.',
      path: '/',
    })
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 py-12">
      <div className="w-full max-w-md text-center">
        <img
          src="/images/obverse.png"
          alt="Bronze ICC Arrest Warrant Issued commemorative medal, obverse — Medal Art Mint Netanyahu Wanted edition"
          className="mx-auto w-full max-w-sm rounded-md"
        />
        <h1
          className="mt-8 text-center text-2xl font-semibold tracking-wide md:text-3xl font-futura-black"
          style={{ color: '#a45d2f' }}
        >
          NETANYAHU WANTED
        </h1>
        <p className="mt-3 text-sm text-white/70">
          ICC Arrest Warrant Issued commemorative medal — limited edition of
          1000
        </p>
        <Link
          to="/shop"
          className="mt-6 inline-flex items-center justify-center rounded-md px-8 py-4 text-sm font-semibold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#a45d2f' }}
        >
          Enter Here
        </Link>
        <p className="mt-8 text-sm text-white/60">
          Contact{' '}
          <a
            href="mailto:info@netanyahuwanted.com"
            className="underline-offset-2 hover:underline"
            style={{ color: '#a45d2f' }}
          >
            info@netanyahuwanted.com
          </a>
        </p>
      </div>
    </main>
  )
}
