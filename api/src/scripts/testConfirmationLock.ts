import {
  claimConfirmationLock,
  releaseConfirmationLock,
} from '../confirmationLock.js'

async function run() {
  const orderId = `lock-test-${Date.now()}`
  const results = await Promise.all([
    claimConfirmationLock(orderId),
    claimConfirmationLock(orderId),
    claimConfirmationLock(orderId),
  ])
  const acquired = results.filter(Boolean).length
  if (acquired !== 1) {
    throw new Error(
      `Expected exactly one lock holder, got ${acquired}: ${JSON.stringify(results)}`,
    )
  }

  const after = await claimConfirmationLock(orderId)
  if (after) {
    throw new Error('Lock was granted again before release')
  }

  await releaseConfirmationLock(orderId)
  const reclaimed = await claimConfirmationLock(orderId)
  if (!reclaimed) {
    throw new Error('Lock was not reusable after release')
  }

  console.log('confirmation lock: 3 concurrent claims → 1 holder, release works')
}

void run()
