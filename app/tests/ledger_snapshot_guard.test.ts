import { describe, expect, it } from 'vitest'
import { assertJournalSnapshotSafe } from '../src/core/ledgerSnapshotGuard.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'

const entry = (sourceType: JournalEntry['sourceType'], sourceId: number | null, options: Partial<JournalEntry> = {}): JournalEntry => ({
  id: options.id ?? 1,
  entryNumber: options.entryNumber ?? options.id ?? 1,
  date: options.date ?? '2026-10-01',
  description: 'لقطة اختبار',
  sourceType,
  sourceId,
  ...(options.sourceCollection ? { sourceCollection: options.sourceCollection } : {}),
  lines: options.lines ?? [
    { accountCode: '1101', debit: 100, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 100 },
  ],
  createdBy: 'test',
  createdAt: options.createdAt ?? '2026-10-24T10:00:00+03:00',
  reversedByEntryId: null,
  reversesEntryId: null,
  ...options,
})

const snapshot = (journal: JournalEntry[], extra: Record<string, unknown> = {}) => ({
  journal,
  treasuries: [],
  sales: [],
  vouchers: [],
  ...extra,
})

describe('حارس دفتر النسخ/المزامنة', () => {
  it('يقبل مرجع البيع السليم ويرفض اليتيم والمرجع التابع لفرع آخر', () => {
    const valid = entry('sale', 7, { branchId: 2 })
    expect(() => assertJournalSnapshotSafe(snapshot([valid], { sales: [{ id: 7, branchId: 2 }] }))).not.toThrow()
    expect(() => assertJournalSnapshotSafe(snapshot([valid], { sales: [{ id: 8, branchId: 2 }] }))).toThrow('غير موجود')
    expect(() => assertJournalSnapshotSafe(snapshot([valid], { sales: [{ id: 7, branchId: 3 }] }))).toThrow('فرع آخر')
  })

  it('يحترم discriminator للمصدر المختلط ولا يخمن المجموعة من تصادم المعرّف', () => {
    const tagged = entry('receipt_voucher', 7, { sourceCollection: 'vouchers' })
    expect(() => assertJournalSnapshotSafe(snapshot([tagged], {
      vouchers: [{ id: 7, branchId: 1 }],
      advanceRepayments: [{ id: 7, branchId: 1 }],
    }))).not.toThrow()
    expect(() => assertJournalSnapshotSafe(snapshot([tagged], {
      vouchers: [{ id: 8, branchId: 1 }],
      advanceRepayments: [{ id: 7, branchId: 1 }],
    }))).toThrow('غير موجود')
  })

  it('يتحقق من مرجع إقفال السنة مقابل السنوات المالية داخل اللقطة الواردة لا الحالة المحلية', () => {
    const closing = entry('year_closing', 4, { sourceCollection: 'fiscalYears', branchId: 2 })
    const incomingYears: FiscalYear[] = [{ id: 4, branchId: 2, status: 'closed', startDate: '2025-01-01', endDate: '2025-12-31', nameAr: '2025' }]
    const incoming = snapshot([closing], { fiscalYears: incomingYears })
    expect(() => assertJournalSnapshotSafe(incoming)).not.toThrow()
    // Sync snapshots may not carry app settings; then use the separately supplied local fiscal years.
    expect(() => assertJournalSnapshotSafe(snapshot([closing]), incomingYears)).not.toThrow()
    expect(() => assertJournalSnapshotSafe(snapshot([closing], { fiscalYears: [{ ...incomingYears[0], id: 5 }] }))).toThrow('غير موجود')
    expect(() => assertJournalSnapshotSafe(snapshot([closing], { fiscalYears: [{ ...incomingYears[0], branchId: 7 }] }))).toThrow('فرع آخر')
  })

  it('يرفض القيد الحديث المختلط بلا مجموعة، ويحافظ على اللقطات التاريخية بلا تخمين', () => {
    const recent = entry('receipt_voucher', 7)
    expect(() => assertJournalSnapshotSafe(snapshot([recent], { vouchers: [{ id: 7 }] }))).toThrow('بلا مجموعة مصدر صريحة')
    const legacy = entry('receipt_voucher', 7, { createdAt: '2025-10-01T10:00:00Z' })
    expect(() => assertJournalSnapshotSafe(snapshot([legacy], { vouchers: [{ id: 7 }] }))).not.toThrow()
  })

  it('يفحص توازن كل القيد ويمنع القيد الجديد في سنة مغلقة عند وجود دفتر محلي مرجعي', () => {
    const unbalanced = entry('sale', 7, { lines: [
      { accountCode: '1101', debit: 101, credit: 0 },
      { accountCode: '4101', debit: 0, credit: 100 },
    ] })
    expect(() => assertJournalSnapshotSafe(snapshot([unbalanced], { sales: [{ id: 7 }] }))).toThrow('غير متزن')

    const prior = entry('manual', null, { id: 1, entryNumber: 1, date: '2026-10-01', createdAt: '2026-10-01T10:00:00Z' })
    const closed = entry('sale', 7, { id: 2, entryNumber: 2, date: '2025-06-01', branchId: 1 })
    expect(() => assertJournalSnapshotSafe(snapshot([prior, closed], { sales: [{ id: 7 }] }), [
      { id: 4, branchId: 1, status: 'closed', startDate: '2025-01-01', endDate: '2025-12-31', nameAr: 'سنة 2025' },
    ], '2026-10-24', [prior])).toThrow('السنة المالية المقفلة')
    // A full backup has no trusted local baseline; historical closed-year entries remain restorable.
    expect(() => assertJournalSnapshotSafe(snapshot([closed], { sales: [{ id: 7 }] }), [
      { id: 4, branchId: 1, status: 'closed', startDate: '2025-01-01', endDate: '2025-12-31', nameAr: 'سنة 2025' },
    ])).not.toThrow()
  })
})
