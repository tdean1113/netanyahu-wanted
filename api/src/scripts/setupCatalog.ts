/**
 * One-time Square catalog bootstrap:
 * - Medal item (inventory tracked) with variation priced at A$140
 * - Five donation items (untracked) at A$140 each
 * - Initialise medal IN_STOCK to 1000 at the configured location
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=... SQUARE_LOCATION_ID=... npm run setup:catalog
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { SquareClient, SquareEnvironment } from 'square'
import { DONATION_ORGS, EDITION_SIZE, HALF_PRICE_CENTS, ORG_IDS } from '../config.js'

const token = process.env.SQUARE_ACCESS_TOKEN
const locationId = process.env.SQUARE_LOCATION_ID
const environment = process.env.SQUARE_ENVIRONMENT ?? 'sandbox'

if (!token || !locationId) {
  console.error('SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID are required')
  process.exit(1)
}

const client = new SquareClient({
  token,
  environment:
    environment === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
})

async function upsertItem(input: {
  name: string
  description: string
  sku: string
  trackInventory: boolean
}) {
  const itemId = `#${input.sku}`
  const variationId = `#${input.sku}-var`

  const response = await client.catalog.object.upsert({
    idempotencyKey: randomUUID(),
    object: {
      type: 'ITEM',
      id: itemId,
      itemData: {
        name: input.name,
        description: input.description,
        productType: 'REGULAR',
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: variationId,
            itemVariationData: {
              name: 'Regular',
              sku: input.sku,
              pricingType: 'FIXED_PRICING',
              priceMoney: {
                amount: BigInt(HALF_PRICE_CENTS),
                currency: 'AUD',
              },
              trackInventory: input.trackInventory,
            },
          },
        ],
      },
    },
  })

  const created = response.catalogObject
  const itemData =
    created && 'itemData' in created
      ? (created.itemData as { variations?: Array<{ id?: string }> } | undefined)
      : undefined
  const variation = itemData?.variations?.[0]
  return {
    itemId: created?.id,
    variationId: variation?.id,
    sku: input.sku,
  }
}

async function main() {
  console.log('Creating medal catalog item…')
  const medal = await upsertItem({
    name: 'ICC Arrest Warrant Medal',
    description:
      'Limited-edition fine art medal. Production / GST / postage half of A$280 sale.',
    sku: 'MAM-ICC-MEDAL',
    trackInventory: true,
  })
  console.log('Medal variation:', medal.variationId)

  if (medal.variationId) {
    console.log(`Setting IN_STOCK to ${EDITION_SIZE}…`)
    await client.inventory.batchCreateChanges({
      idempotencyKey: randomUUID(),
      changes: [
        {
          type: 'PHYSICAL_COUNT',
          physicalCount: {
            catalogObjectId: medal.variationId,
            locationId,
            state: 'IN_STOCK',
            quantity: String(EDITION_SIZE),
            occurredAt: new Date().toISOString(),
          },
        },
      ],
    })
  }

  const donationIds: Record<string, string | undefined> = {}
  for (const orgId of ORG_IDS) {
    const org = DONATION_ORGS[orgId]
    console.log(`Creating donation item for ${org.registerLabel}…`)
    const created = await upsertItem({
      name: `Donation — ${org.name}`,
      description: `Donation component directed to ${org.registerLabel}`,
      sku: `MAM-DONATION-${org.registerLabel.replace(/\s+/g, '-')}`,
      trackInventory: false,
    })
    donationIds[orgId] = created.variationId
  }

  console.log('\nAdd these to api/.env:\n')
  console.log(`SQUARE_MEDAL_VARIATION_ID=${medal.variationId ?? ''}`)
  console.log(`SQUARE_DONATION_APAN_VARIATION_ID=${donationIds.apan ?? ''}`)
  console.log(`SQUARE_DONATION_ACIJ_VARIATION_ID=${donationIds.acij ?? ''}`)
  console.log(
    `SQUARE_DONATION_OLIVE_KIDS_VARIATION_ID=${donationIds['olive-kids'] ?? ''}`,
  )
  console.log(`SQUARE_DONATION_PARA_VARIATION_ID=${donationIds.para ?? ''}`)
  console.log(`SQUARE_DONATION_PANZMA_VARIATION_ID=${donationIds.panzma ?? ''}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
