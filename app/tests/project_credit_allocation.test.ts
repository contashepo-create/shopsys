import { describe, expect, it } from 'vitest'
import { planProjectCreditAmounts, type ProjectCreditEvidence, type ProjectCreditLine } from '../src/core/projectCreditAllocation.ts'

const lines: ProjectCreditLine[] = [{ boqItemId: 1, prevExecutedQty: 200, newExecutedQty: 203, lineValueMinor: 100 }]
const totals = { grossMinor: 100, vatMinor: 15, retentionMinor: 10, dueMinor: 105 }
const plan = (selected: { boqItemId: number; qty: number }[], refunds: ProjectCreditEvidence[] = [], refundedMinor = 0, refundedTaxMinor = 0) => planProjectCreditAmounts({ lines, totals, refunds, refundedMinor, refundedTaxMinor, selected })

describe('توزيع نظري لقيمة الإشعار على كمية شريحة المستخلص', () => {
 it('يحافظ على كسور القيمة والضريبة والمحتجز عبر ثلاث دفعات حتى تطابق الإصدار', () => {
  const q = [{ boqItemId: 1, qty: 1 }]
  const a = plan(q)
  expect(a).toEqual({ grossMinor: 33, taxShareMinor: 5, retentionMinor: 3, amountMinor: 35 })
  const first = [{ ...a, quantities: q }]
  const b = plan(q, first, 35, 5)
  expect(b).toEqual({ grossMinor: 34, taxShareMinor: 5, retentionMinor: 4, amountMinor: 35 })
  const second = [...first, { ...b, quantities: q }]
  const c = plan(q, second, 70, 10)
  expect(c).toEqual({ grossMinor: 33, taxShareMinor: 5, retentionMinor: 3, amountMinor: 35 })
  expect(() => plan(q, [...second, { ...c, quantities: q }], 105, 15)).toThrow(/تتجاوز/)
 })
 it('يخصم جزءاً من البند المختار وحده ويعيد ضريبته ومحتجزه التراكميين', () => {
  const r = planProjectCreditAmounts({ lines: [lines[0], { boqItemId: 2, prevExecutedQty: 0, newExecutedQty: 2, lineValueMinor: 200 }], totals: { grossMinor: 300, vatMinor: 45, retentionMinor: 30, dueMinor: 315 }, refunds: [], refundedMinor: 0, refundedTaxMinor: 0, selected: [{ boqItemId: 2, qty: 1 }] })
  expect(r).toEqual({ grossMinor: 100, taxShareMinor: 15, retentionMinor: 10, amountMinor: 105 })
 })
 it('يرفض تلف أدلة المبلغ أو الضريبة أو المحتجز أو الإجماليات قبل الحساب', () => {
  const quantities = [{ boqItemId: 1, qty: 1 }], good = { ...plan(quantities), quantities }
  for (const patch of [{ grossMinor: 34 }, { taxShareMinor: 6 }, { retentionMinor: 4 }, { amountMinor: 36 }]) {
   const bad = { ...good, ...patch }
   expect(() => plan(quantities, [bad], bad.amountMinor, 5)).toThrow(/لا يطابق/)
  }
  expect(() => plan(quantities, [good], good.amountMinor, 0)).toThrow(/لا تطابق/)
  expect(() => planProjectCreditAmounts({ lines, totals: { ...totals, grossMinor: 101, dueMinor: 106 }, refunds: [], refundedMinor: 0, refundedTaxMinor: 0, selected: quantities })).toThrow(/مجموع بنود/)
  expect(() => planProjectCreditAmounts({ lines, totals: { ...totals, dueMinor: 106 }, refunds: [], refundedMinor: 0, refundedTaxMinor: 0, selected: quantities })).toThrow(/إجماليات/)
 })
 it('يرفض شريحة ضئيلة لا تنتج قيمة موجبة ومقداراً قديماً بلا كميات', () => {
  expect(() => plan([{ boqItemId: 1, qty: 0.001 }])).toThrow(/قيمة موجبة/)
  expect(() => plan([{ boqItemId: 1, qty: 1 }], [{ amountMinor: 35 } as ProjectCreditEvidence], 35, 5)).toThrow(/بلا كميات/)
 })
})

it('توزيع أجزاء مختلفة يعيد الإجماليات إلى آخر قرش مهما تغير ترتيب الكميات', () => {
 for (let gross = 10000; gross < 10030; gross++) {
  const source = [{ boqItemId: 7, prevExecutedQty: 5, newExecutedQty: 105, lineValueMinor: gross }]
  const totals = { grossMinor: gross, vatMinor: Math.round(gross * 0.15), retentionMinor: Math.round(gross * 0.10), dueMinor: gross + Math.round(gross * 0.15) - Math.round(gross * 0.10) }
  const history: ProjectCreditEvidence[] = []
  let amount = 0, tax = 0, creditedGross = 0, retention = 0
  for (const qty of [13, 1, 19, 7, 23, 37]) {
   const selected = [{ boqItemId: 7, qty }]
   const result = planProjectCreditAmounts({ lines: source, totals, refunds: history, refundedMinor: amount, refundedTaxMinor: tax, selected })
   amount += result.amountMinor; tax += result.taxShareMinor; creditedGross += result.grossMinor; retention += result.retentionMinor
   history.push({ ...result, quantities: selected })
  }
  expect({ amount, tax, creditedGross, retention }).toEqual({ amount: totals.dueMinor, tax: totals.vatMinor, creditedGross: totals.grossMinor, retention: totals.retentionMinor })
 }
})

it('دمج التخزين يرفض إشعار كميات تزامن مع تغيير أساس المشروع أو حركة مالية في الاتجاهين', async () => {
 const { mergeConcurrentSnapshots } = await import('../src/data/persistentStorage.ts')
 const snap = (state: object) => JSON.stringify({ state })
 const base = { projects: [{ id: 1 }], boqItems: [{ id: 1, projectId: 1 }], projectExtracts: [{ id: 1, projectId: 1, refunds: [] }], journal: [{ id: 1 }], vouchers: [] }
 for (const version of [1, 2]) {
  const issue = { ...base, projectExtracts: [{ id: 1, projectId: 1, quantityCreditVersion: version, refunds: [{ amountMinor: 10 }] }], journal: [{ id: 1 }, { id: 2 }] }
  for (const other of [
   { ...base, boqItems: [{ id: 1, projectId: 1, qty: 5 }] },
   { ...base, retentionReleases: [{ id: 1, projectId: 1, amountMinor: 5 }] },
   { ...base, vouchers: [{ id: 1, amount: 10 }] },
   { ...base, journal: [{ id: 1 }, { id: 3 }] },
   { ...base, treasuries: [{ code: '1101', branchId: 2 }] },
   { ...base, paymentTerminals: [{ id: 'terminal', settlementAccountCode: '1102' }] },
   { ...base, customers: [{ id: 1, branchId: 2 }] },
   { ...base, branches: [{ id: 2 }] },
   { ...base, activeBranchId: 2 },
   { ...base, appUsers: [{ id: 1, treasuryAccess: [] }] },
   { ...base, currentUserId: 3 },
  ]) {
   expect(() => mergeConcurrentSnapshots(snap(base), snap(issue), snap(other))).toThrow(/تعارض/)
   expect(() => mergeConcurrentSnapshots(snap(base), snap(other), snap(issue))).toThrow(/تعارض/)
  }
 }
})
