import { useRawDataStore } from '../../src/data/repo.ts'
import { buildServiceRefundEntry } from '../../src/core/serviceRefund.ts'
import { buildTerminalRefund } from '../../src/core/paymentTerminalRefund.ts'

/** يبني سجلاً تاريخياً في بيانات الاختبار فقط؛ لا يتيح إصدار إشعار جديد في التطبيق. */
export function seedLegacyProjectCredit(args: { extractId: number; amountMinor: number; mode: 'cash' | 'customer_credit'; treasury?: string; reason: string; terminalRefund?: { originalTransactionId: string; providerReference: string } }) {
  const state = useRawDataStore.getState()
  const extract = state.projectExtracts.find(row => row.id === args.extractId)
  if (!extract) throw new Error('مستخلص اختبار غير موجود')
  const built = buildServiceRefundEntry({ refundValueMinor: args.amountMinor, deliveredGrandMinor: extract.totals.dueMinor, deliveredTaxMinor: extract.totals.vatMinor, priorRefundedMinor: extract.refundedMinor ?? 0, priorRefundedTaxMinor: extract.refundedTaxMinor ?? 0, mode: args.mode, treasury: args.treasury, note: 'إشعار تاريخي للاختبار' })
  const id = Math.max(0, ...state.journal.map(row => row.id)) + 1
  const now = new Date().toISOString(), date = now.slice(0, 10)
  const entry = { id, entryNumber: id, date, description: 'إشعار تاريخي للاختبار', sourceType: 'project_extract' as const, sourceId: extract.id, lines: built.lines, createdBy: 'اختبار', createdAt: now, reversedByEntryId: null, reversesEntryId: null }
  const updated = { ...extract, refundedMinor: (extract.refundedMinor ?? 0) + args.amountMinor, refundedTaxMinor: (extract.refundedTaxMinor ?? 0) + built.taxShareMinor, refunds: [...(extract.refunds ?? []), { date, amountMinor: args.amountMinor, taxShareMinor: built.taxShareMinor, mode: args.mode, reason: args.reason, journalEntryId: id }] }
  const original = args.terminalRefund && state.paymentTerminalTransactions.find(row => row.id === args.terminalRefund!.originalTransactionId)
  if (args.terminalRefund && !original) throw new Error('تحصيل اختبار غير موجود')
  const terminalRefund = original && args.terminalRefund ? buildTerminalRefund(original, state.paymentTerminalTransactions, { documentId: `${extract.id}:refund:${id}`, amountMinor: args.amountMinor, providerReference: args.terminalRefund.providerReference, occurredAt: now, userId: 0 }) : null
  useRawDataStore.setState({ projectExtracts: state.projectExtracts.map(row => row.id === extract.id ? updated : row), journal: [...state.journal, entry], ...(terminalRefund ? { paymentTerminalTransactions: [...state.paymentTerminalTransactions, terminalRefund] } : {}) })
  return updated
}
