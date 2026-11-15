import { isValidExpiryDate } from './batches.ts'
import type { JournalEntry } from './ledger.ts'
import type { StaffCommission } from './staffCommissions.ts'

type Row = { date: string; ref: string; description: string; debitMinor: number; creditMinor: number }

/** يعيد الحركة الزمنية فقط عندما تثبت القيود هوية الأصل والتسوية ومبلغها. */
export function commissionStatementRows(commission: StaffCommission, journal: JournalEntry[]): Row[] | null {
  if (!Number.isSafeInteger(commission.amountMinor) || commission.amountMinor < 0 || !isValidExpiryDate(commission.date)) return null
  if (commission.status === 'paid' && commission.payoutMode !== 'voucher') return null // قيد المسير مجمّع بلا تخصيص مستقل مثبت هنا
  if (!['accrued', 'paid', 'cancelled'].includes(commission.status)) return null
  const entries = journal.filter(e => e.sourceType === 'staff_commission' && e.sourceId === commission.id)
  const origin = entries.filter(e => e.id === commission.accrualEntryId)
  if (origin.length !== 1 || journal.filter(e => e.id === commission.accrualEntryId).length !== 1 || origin[0].date !== commission.date) return null
  const movements: Row[] = []
  let balance = 0
  const add = (e: JournalEntry, label: string) => {
    if (!isValidExpiryDate(e.date) || e.date < commission.date || e.reversedByEntryId != null || !Array.isArray(e.lines) || journal.filter(row => row.id === e.id).length !== 1) return false
    let debit = 0, credit = 0
    for (const l of e.lines.filter(line => line.accountCode === '2116')) {
      if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) return false
      debit += l.debit; credit += l.credit
    }
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || (debit === 0) === (credit === 0)) return false
    balance += credit - debit
    if (!Number.isSafeInteger(balance)) return false
    movements.push({ date: e.date, ref: commission.code, description: `${label} — ${commission.description}`, debitMinor: debit, creditMinor: credit })
    return true
  }
  if (!add(origin[0], 'استحقاق عمولة') || movements[0].debitMinor !== 0) return null
  for (const e of entries.filter(e => e.id !== origin[0].id)) {
    if (!add(e, 'تسوية عمولة') || movements.at(-1)!.creditMinor !== 0) return null
  }
  if (commission.status === 'cancelled') {
    if (commission.cancelEntryId == null) return null
    if (!entries.some(e => e.id === commission.cancelEntryId)) {
      const cancels = journal.filter(e => e.id === commission.cancelEntryId && e.sourceType === 'staff_commission_cancel' && e.sourceId === commission.id)
      if (cancels.length !== 1 || !add(cancels[0], 'إلغاء عمولة') || movements.at(-1)!.creditMinor !== 0) return null
    }
    if (balance !== 0) return null
  } else if (balance !== commission.amountMinor) return null
  if (commission.status === 'paid') {
    const payout = journal.filter(e => e.id === commission.payoutEntryId && e.sourceType === 'staff_commission_payout' && e.sourceId === commission.id)
    if (payout.length !== 1 || (commission.payoutDate != null && payout[0].date !== commission.payoutDate) || movements.some(row => row.date > payout[0].date) || !add(payout[0], 'صرف عمولة') || movements.at(-1)!.debitMinor !== commission.amountMinor || balance !== 0) return null
  }
  let running = 0
  for (const row of [...movements].sort((a, b) => a.date.localeCompare(b.date))) { running += row.creditMinor - row.debitMinor; if (!Number.isSafeInteger(running) || running < 0) return null }
  return movements
}
