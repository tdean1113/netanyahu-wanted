import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { DONATION_ORGS } from './config.js'
import {
  expandMedalOrgs,
  listPaidMedalOrders,
  type PaidMedalOrder,
} from './square.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const TEMPLATE_PATH = path.resolve(
  __dirname,
  '../templates/ICC-Netanyahu-Medal-Register.xlsx',
)

/** Excel serial date for a JS Date (local calendar day). */
function toExcelDate(date: Date): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return utc / 86_400_000 + 25569
}

function serialCellValue(value: ExcelJS.CellValue): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as ExcelJS.CellFormulaValue).result
    if (typeof result === 'number') return result
    if (typeof result === 'string') {
      const n = Number(result)
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join('')
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text
    }
    if ('result' in value) {
      return String(value.result ?? '')
    }
  }
  return ''
}

/**
 * Fill the Medal Sales Register template:
 * - Preserve existing gift (G) and manually filled rows
 * - Write one Sold (S) row per medal from Square paid orders
 * - Assign next free serials in payment-date order
 */
export async function buildRegisterWorkbook(
  orders?: PaidMedalOrder[],
): Promise<ExcelJS.Buffer> {
  const paid = orders ?? (await listPaidMedalOrders())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(TEMPLATE_PATH)

  const sheet = workbook.getWorksheet('Medal Sales Register')
  if (!sheet) {
    throw new Error('Template missing "Medal Sales Register" sheet')
  }

  const occupied = new Set<number>()
  for (let row = 3; row <= 1002; row++) {
    const soldOrGifted = cellText(sheet.getCell(row, 3).value).trim().toUpperCase()
    const hasDate = Boolean(sheet.getCell(row, 2).value)
    const hasOrg = Boolean(cellText(sheet.getCell(row, 5).value).trim())
    const hasName = Boolean(cellText(sheet.getCell(row, 7).value).trim())
    const hasComment = Boolean(cellText(sheet.getCell(row, 8).value).trim())
    if (soldOrGifted || hasDate || hasOrg || hasName || hasComment) {
      const serial =
        serialCellValue(sheet.getCell(row, 1).value) ?? row - 2
      occupied.add(serial)
    }
  }

  const freeSerials: number[] = []
  for (let serial = 1; serial <= 1000; serial++) {
    if (!occupied.has(serial)) freeSerials.push(serial)
  }

  let freeIndex = 0
  for (const order of paid) {
    const orgs =
      order.medalOrgs.length > 0
        ? order.medalOrgs
        : expandMedalOrgs(order.donations)

    for (let i = 0; i < order.quantity; i++) {
      if (freeIndex >= freeSerials.length) {
        throw new Error('Register has no free serials left for paid orders')
      }
      const serial = freeSerials[freeIndex++]
      const row = serial + 2
      const orgId = orgs[i] ?? orgs[orgs.length - 1]
      if (!orgId) {
        throw new Error(`Order ${order.orderId} has no donation organisations`)
      }
      const orgLabel = DONATION_ORGS[orgId].registerLabel

      sheet.getCell(row, 2).value = toExcelDate(order.createdAt)
      sheet.getCell(row, 2).numFmt = 'dd/mm/yyyy'
      sheet.getCell(row, 3).value = 'S'
      // D Donation Sent Y/N left blank for Tony
      sheet.getCell(row, 5).value = orgLabel
      // F receipt blank
      sheet.getCell(row, 7).value = order.buyerName || ''
      sheet.getCell(row, 8).value =
        order.quantity > 1
          ? `Square order ${order.orderId} (${i + 1} of ${order.quantity})`
          : `Square order ${order.orderId}`
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ExcelJS.Buffer
}
