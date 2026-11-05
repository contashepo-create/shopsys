import { describe, expect, it } from 'vitest'
import { splitCoverage } from '../src/core/insurance.ts'

describe('دقة تقسيم التأمين بالقرش', () => {
 it('يقسم النسب العشرية بدقة دون إنقاص قرش صحيح بسبب تقريب الحاسوب', () => {
  expect(splitCoverage(375, 18.4)).toEqual({ providerShareMinor: 69, patientShareMinor: 306 })
  expect(splitCoverage(10000, 0.07)).toEqual({ providerShareMinor: 7, patientShareMinor: 9993 })
  expect(splitCoverage(Number.MAX_SAFE_INTEGER, 100)).toEqual({ providerShareMinor: Number.MAX_SAFE_INTEGER, patientShareMinor: 0 })
 })
 it('يرفض الإجمالي والنسبة التالفة قبل تكوين المطالبة', () => {
  for (const total of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 0, -1]) expect(() => splitCoverage(total, 70)).toThrow()
  for (const percent of [NaN, Infinity, -1, 0, 101]) expect(() => splitCoverage(1000, percent)).toThrow()
 })
})

import { computeInsuredVisitTotals, computeVisitTotals } from '../src/core/clinic.ts'
import { computeLabTotals } from '../src/core/lab.ts'
it('يحافظ على تقريب الضريبة والخصم العشري للخدمات عند نصف قرش', () => {
 expect(computeInsuredVisitTotals(250, 64.6)).toMatchObject({ vatMinor: 162, totalMinor: 412 })
 expect(computeVisitTotals({ kind: 'checkup', feeMinor: 250, paidMinor: 0, vatPercent: 64.6 })).toMatchObject({ vatMinor: 162, totalMinor: 412 })
 expect(computeLabTotals([250], 64.6, 0)).toMatchObject({ discountMinor: 162, totalMinor: 88 })
 expect(computeLabTotals([250], 0, 64.6)).toMatchObject({ vatMinor: 162, totalMinor: 412 })
})
it('يرفض نسب الخدمة غير المنتهية والمبالغ خارج النطاق قبل إنشاء مستند', () => {
 for (const pct of [NaN, Infinity, -1, 101]) {
  expect(() => computeInsuredVisitTotals(250, pct)).toThrow()
  expect(() => computeVisitTotals({ kind: 'checkup', feeMinor: 250, paidMinor: 0, vatPercent: pct })).toThrow()
  expect(() => computeLabTotals([250], pct, 0)).toThrow()
  expect(() => computeLabTotals([250], 0, pct)).toThrow()
 }
 expect(() => computeInsuredVisitTotals(Number.MAX_SAFE_INTEGER, 1)).toThrow()
 expect(() => computeLabTotals([Number.MAX_SAFE_INTEGER, 1], 0, 0)).toThrow()
})

import { buildServiceRefundEntry } from '../src/core/serviceRefund.ts'
it('يحسب ضريبة المرتجع التراكمية بدقة حتى عندما يتجاوز حاصل الضرب المجال الآمن', () => {
 const refund = buildServiceRefundEntry({ refundValueMinor: 100000001, deliveredGrandMinor: 200000002, deliveredTaxMinor: 100000001, priorRefundedMinor: 0, priorRefundedTaxMinor: 0, mode: 'cash', note: 'رد' })
 expect(refund.taxShareMinor).toBe(50000001)
 expect(refund.baseMinor).toBe(50000000)
})
it('لا يغيّر مرتجعاً تاريخياً ناقص التقريب ويكمل ضريبته عند رد الباقي', () => {
 const refund = buildServiceRefundEntry({ refundValueMinor: 100000001, deliveredGrandMinor: 200000002, deliveredTaxMinor: 100000001, priorRefundedMinor: 100000001, priorRefundedTaxMinor: 50000000, mode: 'cash', note: 'باقي الرد' })
 expect(refund.taxShareMinor).toBe(50000001)
 expect(refund.baseMinor).toBe(50000000)
})
