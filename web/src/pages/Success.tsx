import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function Success() {
  useEffect(() => {
    document.title = 'Order Confirmed — ICC Arrest Warrant Medal'
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16">
      <div className="max-w-lg text-center">
        <h1 className="mb-4 text-4xl font-semibold text-ink">Thank you</h1>
        <p className="mb-8 text-lg leading-relaxed text-muted">
          Your order for the ICC Arrest Warrant Issued medal has been received.
        </p>
        <Link to="/shop" className="text-link hover:underline">
          Back to the medal
        </Link>
        <p className="mt-8 text-sm text-muted">
          Questions?{' '}
          <a
            href="mailto:info@netanyahuwanted.com"
            className="text-link hover:underline"
          >
            info@netanyahuwanted.com
          </a>
        </p>
      </div>
    </main>
  )
}
