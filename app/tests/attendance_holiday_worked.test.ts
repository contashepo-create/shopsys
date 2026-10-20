/**
 * الفجوة ب (بلاغ المالك): تسجيل يوم «يوم إضافي» (حضور وعمل في عطلة رسمية) يحتسب
 * مكافأة تلقائياً بالسعر الذي يحدده المالك — يوم كامل / يوم ونصف / نسبة / مبلغ ثابت.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HR_RULES, normalizeHrRules, holidayWorkBonusPerDayMinor,
  monthlySummary, attendancePayrollImpact, dailyRateMinor,
  type AttendanceRecord,
} from '../src/core/attendance.ts'

const rec = (date: string, status: AttendanceRecord['status']): AttendanceRecord => ({
  id: Math.random(), employeeId: 1, date, status, source: 'manual',
})

describe('مكافأة يوم إضافي (حضور عطلة رسمية)', () => {
  it('monthlySummary يعدّ أيام holiday_worked في holidayWorkedDays', () => {
    const records = [rec('2026-02-06', 'holiday_worked'), rec('2026-02-07', 'present'), rec('2026-02-13', 'holiday_worked')]
    const s = monthlySummary({ employeeId: 1, month: '2026-02', records, leaves: [], types: [] })
    expect(s.holidayWorkedDays).toBe(2)
    expect(s.presentDays).toBe(1)
  })

  it('holidayWorkBonusPerDayMinor: يوم كامل = اليومية، يوم ونصف = ×1.5', () => {
    const dayRate = 40000 // 400 جنيه
    expect(holidayWorkBonusPerDayMinor(dayRate, { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'day' })).toBe(40000)
    expect(holidayWorkBonusPerDayMinor(dayRate, { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'day_and_half' })).toBe(60000)
  })

  it('holidayWorkBonusPerDayMinor: نسبة مئوية من اليومية', () => {
    const dayRate = 40000
    expect(holidayWorkBonusPerDayMinor(dayRate, { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'percent', holidayWorkPercent: 50 })).toBe(20000)
    expect(holidayWorkBonusPerDayMinor(dayRate, { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'percent', holidayWorkPercent: 100 })).toBe(40000)
  })

  it('holidayWorkBonusPerDayMinor: مبلغ ثابت لا يعتمد على اليومية', () => {
    expect(holidayWorkBonusPerDayMinor(999999, { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'fixed', holidayWorkFixedMinor: 15000 })).toBe(15000)
  })

  it('normalizeHrRules يرجع قيماً آمنة افتراضية لحقول الفجوة ب عند غياب التخزين القديم', () => {
    const normalized = normalizeHrRules({})
    expect(normalized.holidayWorkRateMode).toBe('day')
    expect(normalized.holidayWorkPercent).toBe(100)
    expect(normalized.holidayWorkFixedMinor).toBe(0)
  })

  it('attendancePayrollImpact: يضيف المكافأة كبند ائتمان (موجب) في صافي الأثر ويُسجّل ملاحظة عربية', () => {
    const grossMinor = 1040000 // 10400 جنيه ÷ 26 يوم = 400 يومية
    const records = [rec('2026-03-06', 'holiday_worked'), rec('2026-03-13', 'holiday_worked')]
    const impact = attendancePayrollImpact({
      employeeId: 1, month: '2026-03', grossMinor,
      rules: { ...DEFAULT_HR_RULES, holidayWorkRateMode: 'day' },
      records, leaves: [], types: [],
    })
    const dayRate = dailyRateMinor(grossMinor, DEFAULT_HR_RULES)
    expect(impact.summary.holidayWorkedDays).toBe(2)
    expect(impact.holidayWorkBonusMinor).toBe(2 * dayRate)
    expect(impact.netAdjustmentMinor).toBe(impact.holidayWorkBonusMinor) // لا غياب ولا تأخير هنا
    expect(impact.notes.some((n) => n.includes('يوم إضافي (عطلة) 2 يوم'))).toBe(true)
  })

  it('المكافأة تُحتسب حتى لو overtimePaid مطفأ — تسجيل الحالة نفسه هو موافقة المالك', () => {
    const grossMinor = 1040000
    const impact = attendancePayrollImpact({
      employeeId: 1, month: '2026-03', grossMinor,
      rules: { ...DEFAULT_HR_RULES, overtimePaid: false, holidayWorkRateMode: 'day' },
      records: [rec('2026-03-06', 'holiday_worked')], leaves: [], types: [],
    })
    expect(impact.holidayWorkBonusMinor).toBeGreaterThan(0)
    expect(impact.overtimeAllowanceMinor).toBe(0) // الإضافي بالساعات يبقى مطفأ كالمعتاد
  })
})
