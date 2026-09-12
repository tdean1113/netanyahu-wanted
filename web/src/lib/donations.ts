export type DonationOrgId =
  | 'apan'
  | 'acij'
  | 'olive-kids'
  | 'para'
  | 'panzma'

export interface DonationOrg {
  id: DonationOrgId
  registerLabel: string
  name: string
  description: string
  website: string
}

export const DONATION_ORGS: DonationOrg[] = [
  {
    id: 'apan',
    registerLabel: 'APAN',
    name: 'Australian Palestine Advocacy Network',
    description:
      'Advocacy for Palestinian rights and self-determination in Australia.',
    website: 'https://apan.org.au/',
  },
  {
    id: 'acij',
    registerLabel: 'ACIJ',
    name: 'Australian Centre for International Justice',
    description:
      'Legal accountability for international crimes and human rights abuses.',
    website: 'https://acij.org.au/get-involved/donate/',
  },
  {
    id: 'olive-kids',
    registerLabel: 'OLIVE KIDS',
    name: 'Olive Kids Australia',
    description:
      'Australian-based humanitarian support for children and communities.',
    website: 'https://olivekids.org.au/about-us/',
  },
  {
    id: 'para',
    registerLabel: 'PARA',
    name: 'Palestine Action and Relief Australia',
    description: 'Grassroots Australian support and relief for Palestine.',
    website: 'https://para.org.au/give-support/',
  },
  {
    id: 'panzma',
    registerLabel: 'PANZMA',
    name: 'PANZMA — Palestinian Australian New Zealand Medical Association',
    description:
      'Medical professionals supporting Palestinian health and wellbeing.',
    website: 'https://panzma.org/',
  },
]

export const EDITION_SIZE = 1000
export const UNIT_PRICE_AUD = 280
export const DONATION_PER_MEDAL_AUD = 140
export const MAX_QTY = 10

export type DonationAllocations = Record<DonationOrgId, number>

export function emptyAllocations(): DonationAllocations {
  return {
    apan: 0,
    acij: 0,
    'olive-kids': 0,
    para: 0,
    panzma: 0,
  }
}

export function sumAllocations(allocations: DonationAllocations): number {
  return DONATION_ORGS.reduce((sum, org) => sum + (allocations[org.id] ?? 0), 0)
}

/** Compact map of orgs with count > 0, for the API. */
export function donationsPayload(
  allocations: DonationAllocations,
): Partial<Record<DonationOrgId, number>> {
  const out: Partial<Record<DonationOrgId, number>> = {}
  for (const org of DONATION_ORGS) {
    const n = allocations[org.id]
    if (n > 0) out[org.id] = n
  }
  return out
}

export function formatAud(amount: number): string {
  return `A$${amount.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
