import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { sendOrderConfirmation } from '../lib/api'
import { applySeo } from '../lib/seo'

export default function Success() {
  const [params] = useSearchParams()

  useEffect(() => {
    applySeo({
      title: 'Order Confirmed — ICC Arrest Warrant Medal',
      description:
        'Thank you for your order of the ICC Arrest Warrant Issued medal.',
      path: '/success',
      noIndex: true,
    })
  }, [])

  useEffect(() => {
    const orderId = params.get('orderId') ?? params.get('order_id')
    if (!orderId) return
    void sendOrderConfirmation(orderId).catch((err) => {
      console.warn('Confirmation email trigger failed', err)
    })
  }, [params])

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16">
      <div className="max-w-lg text-center">
        <h1 className="mb-4 text-4xl font-semibold text-ink">Thank you</h1>
        <p className="mb-8 text-lg leading-relaxed text-muted">
          Your order for the ICC Arrest Warrant Issued medal has been received.
          A confirmation email with your contact details and delivery address
          will be sent to the address you provided at checkout.
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
