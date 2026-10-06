import { describe, expect, it } from 'vitest'
import {
  assertTransition, buildChequeBounceEntry, buildChequeCancelEntry, buildChequeClearEntry,
  buildChequeCollectEntry, buildChequeIssueEntry, buildChequeReceiveEntry, chequePortfolio,
  dueCheques, isFinalStatus, validateCheque, type Cheque, type ChequeStatus,
} from '../src/core/cheques.ts'

const mk = (over: Partial<Cheque>): Cheque => ({
  id: 1, chequeNumber: 'CH-1', direction: 'incoming', partyId: null, partyName: 'ط', counterAccount: '1104',
  bankName: 'بنك', amountMinor: 100000, dueDate: '2026-11-01', status: 'held', notes: '',
  createdAt: '2026-09-01T00:00:00Z', receiveEntryId: 1, settleEntryId: null, reverseEntryId: null,
  depositedAt: null, settledAt: null, ...over,
})

describe('الشيكات (أوراق القبض والدفع)', () => {
  it('يرفض تواريخ استحقاق ليست يوماً حقيقياً بالتقويم (§78)', () => {
    for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00']) {
      expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 1000, dueDate: bad, partyId: null, partyName: 'ط' })).toThrow('التقويم')
    }
    for (const good of ['2024-02-29', '2026-12-31', '2028-02-29']) {
      expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 1000, dueDate: good, partyId: null, partyName: 'ط' })).not.toThrow()
    }
  })

  it('يرفض رقماً فارغاً ومبلغاً غير موجب وطرفاً بلا اسم', () => {
    expect(() => validateCheque({ chequeNumber: ' ', amountMinor: 1000, dueDate: '2026-11-01', partyId: null, partyName: 'ط' })).toThrow('رقم الشيك')
    expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 0, dueDate: '2026-11-01', partyId: null, partyName: 'ط' })).toThrow('موجباً')
    expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 500.5, dueDate: '2026-11-01', partyId: null, partyName: 'ط' })).toThrow('موجباً')
    expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 1000, dueDate: '2026-11-01', partyId: null, partyName: ' ' })).toThrow('اسم الطرف')
    expect(() => validateCheque({ chequeNumber: 'X', amountMinor: 1000, dueDate: '2026-11-01', partyId: 0, partyName: 'ط' })).toThrow('الطرف')
  })

  it('القيود الست متوازنة بالاتجاه المحاسبي الصحيح', () => {
    const recv = buildChequeReceiveEntry(5000, 'استلام')
    expect(recv[0]).toMatchObject({ accountCode: '1106', debit: 5000 })
    expect(recv[1]).toMatchObject({ accountCode: '1104', credit: 5000 })
    const collect = buildChequeCollectEntry(5000, 'تحصيل', '1101')
    expect(collect[0]).toMatchObject({ accountCode: '1101', debit: 5000 })
    expect(collect[1]).toMatchObject({ accountCode: '1106', credit: 5000 })
    const bounce = buildChequeBounceEntry(5000, 'ارتداد')
    expect(bounce[0]).toMatchObject({ accountCode: '1104', debit: 5000 })
    expect(bounce[1]).toMatchObject({ accountCode: '1106', credit: 5000 })
    const issue = buildChequeIssueEntry(7000, 'تحرير')
    expect(issue[0]).toMatchObject({ accountCode: '2101', debit: 7000 })
    expect(issue[1]).toMatchObject({ accountCode: '2106', credit: 7000 })
    const clear = buildChequeClearEntry(7000, 'صرف', '1102')
    expect(clear[0]).toMatchObject({ accountCode: '2106', debit: 7000 })
    expect(clear[1]).toMatchObject({ accountCode: '1102', credit: 7000 })
    const cancel = buildChequeCancelEntry(7000, 'إلغاء')
    expect(cancel[0]).toMatchObject({ accountCode: '2106', debit: 7000 })
    expect(cancel[1]).toMatchObject({ accountCode: '2101', credit: 7000 })
  })

  it('آلة الحالات: المسموح يمضي والممنوع يُرفض والنهائيات مقفلة', () => {
    const allowed: Array<[ChequeStatus, ChequeStatus]> = [
      ['held', 'deposited'], ['held', 'collected'], ['held', 'bounced'],
      ['deposited', 'collected'], ['deposited', 'bounced'],
      ['issued', 'cleared'], ['issued', 'cancelled'],
    ]
    for (const [from, to] of allowed) expect(() => assertTransition(from, to)).not.toThrow()
    const statuses: ChequeStatus[] = ['held', 'deposited', 'collected', 'bounced', 'issued', 'cleared', 'cancelled']
    for (const from of statuses) for (const to of statuses) {
      const isAllowed = allowed.some(([f, t]) => f === from && t === to)
      if (isAllowed) continue
      expect(() => assertTransition(from, to)).toThrow('لا يمكن نقل الشيك')
    }
    for (const s of statuses) expect(isFinalStatus(s)).toBe(['collected', 'bounced', 'cleared', 'cancelled'].includes(s))
  })

  it('تنبيهات الاستحقاق: المتأخر أولاً والمستقبلي البعيد يستثنى', () => {
    const alerts = dueCheques([
      mk({ id: 1, dueDate: '2026-10-01' }),
      mk({ id: 2, dueDate: '2026-10-05' }),
      mk({ id: 3, dueDate: '2026-12-01' }),
      mk({ id: 4, status: 'collected', dueDate: '2026-10-01' }),
      mk({ id: 5, status: 'cleared', dueDate: '2026-10-01' }),
    ], '2026-10-02', 7)
    expect(alerts.map((a) => a.cheque.id)).toEqual([1, 2])
    expect(alerts[0].daysLeft).toBe(-1)
  })

  it('محفظة الشيكات: المفتوح بكل اتجاه والمنتهي مستثنى والمرتد معدود', () => {
    const portfolio = chequePortfolio([
      mk({ id: 1, amountMinor: 100 }),
      mk({ id: 2, status: 'deposited', amountMinor: 200 }),
      mk({ id: 3, status: 'collected', amountMinor: 999 }),
      mk({ id: 4, status: 'bounced', amountMinor: 50 }),
      mk({ id: 5, direction: 'outgoing', status: 'issued', amountMinor: 400 }),
      mk({ id: 6, direction: 'outgoing', status: 'cleared', amountMinor: 888 }),
    ])
    expect(portfolio).toEqual({ incomingOpenMinor: 300, incomingOpenCount: 2, outgoingOpenMinor: 400, outgoingOpenCount: 1, bouncedCount: 1 })
  })
})
