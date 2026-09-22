import { describe, expect, it } from 'vitest'
import { buildTerminalCharge } from '../src/core/paymentTerminalCharge.ts'

const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '1', settlementAccountCode: '1102', terminalId: 'P1', status: 'active' as const }
describe('مصنع تحصيل الماكينة', () => {
  it('يبني هوية مستقرة مرتبطة بنوع المستند', () => expect(buildTerminalCharge({ terminal, documentType: 'installment', documentId: 7, amountMinor: 1000, providerReference: ' R1 ', occurredAt: '2026-09-22T10:00:00Z', userId: 3, id: 'x' })).toMatchObject({ idempotencyKey: 'installment:7:terminal:t1', documentType: 'installment', documentId: '7', providerReference: 'R1' }))
  it('يرفض المبلغ أو المرجع غير الصالح', () => expect(() => buildTerminalCharge({ terminal, documentType: 'rental', documentId: 1, amountMinor: 0, providerReference: '', occurredAt: '2026-09-22T10:00:00Z', userId: 3 })).toThrow())
})
