import { describe, expect, it } from 'vitest'
import { validateProjectRefundQuantities } from '../src/core/projectRefundQuantities.ts'

const lines = [
 { boqItemId: 1, prevExecutedQty: 200, newExecutedQty: 856 },
 { boqItemId: 2, prevExecutedQty: 0, newExecutedQty: 3.333 },
]
const compute = (selected: { boqItemId: number; qty: number }[], refunds: { amountMinor: number; quantities?: { boqItemId: number; qty: number }[] }[] = [], refundedMinor = 0) => validateProjectRefundQuantities({ lines, selected, refunds, refundedMinor })

describe('كميات إشعار مستخلص المشروع — نواة تحقق مستقلة', () => {
 it('يستخدم شريحة المستخلص لا حصر المشروع ويحفظ المتبقي الدقيق عبر إشعارات متكررة', () => {
  const prior = [{ amountMinor: 100, quantities: [{ boqItemId: 1, qty: 5.123 }, { boqItemId: 2, qty: 1.111 }] }]
  expect(compute([{ boqItemId: 1, qty: 650.877 }, { boqItemId: 2, qty: 2.222 }], prior, 100)).toEqual([
   { boqItemId: 1, issuedQty: 656, alreadyReturnedQty: 5.123, requestedQty: 650.877, remainingQty: 0 },
   { boqItemId: 2, issuedQty: 3.333, alreadyReturnedQty: 1.111, requestedQty: 2.222, remainingQty: 0 },
  ])
  expect(() => compute([{ boqItemId: 1, qty: 650.878 }], prior, 100)).toThrow(/تتجاوز/)
 })
 it('يرفض تكرار البنود أو اختيار بند مختلف أو كمية غير صالحة', () => {
  expect(() => compute([])).toThrow(/تحديد/)
  expect(() => compute([{ boqItemId: 1, qty: 1 }, { boqItemId: 1, qty: 1 }])).toThrow(/مكرر/)
  expect(() => compute([{ boqItemId: 3, qty: 1 }])).toThrow(/غير موجود/)
  for (const qty of [0, -1, 0.0001, Number.NaN, Infinity]) expect(() => compute([{ boqItemId: 1, qty }])).toThrow()
 })
 it('يرفض إشعاراً قديماً بلا إثبات كميات أو مجموعاً مالياً غير مطابق بدلاً من التخمين', () => {
  expect(() => compute([{ boqItemId: 1, qty: 1 }], [{ amountMinor: 100 }], 100)).toThrow(/بلا كميات/)
  expect(() => compute([{ boqItemId: 1, qty: 1 }], [], 100)).toThrow(/لا يطابق/)
  expect(() => compute([{ boqItemId: 1, qty: 1 }], [{ amountMinor: 100, quantities: [{ boqItemId: 1, qty: 657 }] }], 100)).toThrow(/تتجاوز/)
 })
 it('يرفض المستخلص الإجمالي أو النسب التقديرية أو شرائح التاريخ الفاسدة', () => {
  const selected = [{ boqItemId: 1, qty: 1 }]
  for (const source of [undefined, [], [{ boqItemId: 1 }], [{ ...lines[0], previousQtyEstimated: true }], [{ ...lines[0], newExecutedQty: 200 }], [lines[0], lines[0]]]) {
   expect(() => validateProjectRefundQuantities({ lines: source, selected, refunds: [], refundedMinor: 0 })).toThrow()
  }
 })
})
