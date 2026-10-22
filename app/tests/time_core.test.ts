/**
 * نواة الوقت — عقد التواريخ التي بُنيت عليه كل المستندات الجديدة:
 *  - تاريخ مجرّد يُبنى بـUTC ويُقرأ بـcalendarDateIso (لا يوم UTC في القيود).
 *  - إضافة الأشهر تثبّت آخر يوم في الشهر (لا انسكاب إلى الشهر التالي).
 *  - الختم الكامل يحمل إزاحة صريحة، وتقطيعه إلى 10 أحرف = يوم المستخدم.
 *  - ختم يوم مختار يحمل إزاحة ذلك اليوم لا إزاحة اليوم الحالي.
 */
import { describe, it, expect } from 'vitest'
import {
  addCalendarMonths, calendarDateIso, localDateIso, localDateTimeLabel,
  localIsoTimestamp, localTimestampOn, localTimestampOnDay, todayLocalIso,
} from '../src/core/time.ts'

describe('calendarDateIso — تقويم مجرّد', () => {
  it('يعيد اليوم التقويمي للكائن المبني بـUTC', () => {
    expect(calendarDateIso(new Date('2028-02-29T00:00:00Z'))).toBe('2028-02-29')
    expect(calendarDateIso(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31')
  })
})

describe('addCalendarMonths — آخر يوم في الشهر', () => {
  it('31 يناير + شهر = آخر فبراير لا 3 مارس', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29')
  })
  it('يحافظ على اليوم حين لا يوجد انسكاب', () => {
    expect(addCalendarMonths('2026-01-15', 3)).toBe('2026-04-15')
    expect(addCalendarMonths('2026-01-31', 12)).toBe('2027-01-31')
    expect(addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28')
  })
  it('لا ينهار على مدخل فاسد ويعيد المدخل مقصوصاً', () => {
    expect(addCalendarMonths('غير تاريخ', 1)).toBe('غير تاريخ')
    expect(addCalendarMonths('2026-13-45', 1)).toBe('2026-13-45')
    expect(addCalendarMonths('2026-02-10', 1.5)).toBe('2026-02-10')
  })
})

describe('الأختام', () => {
  it('الختم الكامل يحمل إزاحة صريحة وتقطيعه يوم محلي', () => {
    const at = new Date('2026-10-22T01:05:09.250')
    const stamp = localIsoTimestamp(at)
    expect(stamp).toMatch(/^2026-10-22T01:05:09\.250[+-]\d{2}:\d{2}$/)
    expect(stamp.slice(0, 10)).toBe(todayLocalIso(at))
    expect(new Date(stamp).getTime()).toBe(at.getTime())
  })
  it('ختم يوم مختار يعطي 09:00 محلياً في ذلك اليوم', () => {
    const stamp = localTimestampOn('2026-01-15', 9)
    expect(stamp).toMatch(/^2026-01-15T09:00:00\.000[+-]\d{2}:\d{2}$/)
    const back = new Date(stamp)
    expect(back.getHours()).toBe(9)
    expect(back.getDate()).toBe(15)
    expect(back.getMonth()).toBe(0)
  })
  it('ختم يوم ماضٍ: ساعة اللحظة نفسها بتاريخ ذلك اليوم وبإزاحته', () => {
    const at = new Date(2026, 6, 15, 14, 33, 9, 12)
    const stamp = localTimestampOnDay('2026-01-15', at)
    expect(stamp.startsWith('2026-01-15T14:33:09.012')).toBe(true)
    const back = new Date(stamp)
    expect(back.getHours()).toBe(14)
    expect(back.getMinutes()).toBe(33)
    expect(back.getDate()).toBe(15)
    expect(back.getMonth()).toBe(0)
  })
  it('مدخل تاريخ فاسد يعود إلى ختم اللحظة الحالية لا إلى «T09:00» مبتور', () => {
    const stamp = localTimestampOn('غير تاريخ', 9)
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
    expect(localTimestampOnDay('2026-99-99', new Date()).slice(0, 4)).toMatch(/^\d{4}$/)
  })
  it('ختم محلي بإزاحته: الساعة واليوم كما كُتبا لا بإزاحة اليوم', () => {
    expect(localDateTimeLabel('2026-07-15T12:00:00.000+03:00')).toBe('2026-07-15 12:00')
    expect(localDateIso('2026-07-15T00:30:00.000+03:00')).toBe('2026-07-15')
    expect(localDateTimeLabel('2026-01-31T09:00+02:00')).toBe('2026-01-31 09:00')
  })
  it('عرض تاريخ مخزّن: المجرّد كما هو، واللحظة تُحوَّل للمنطقة المحلية', () => {
    expect(localDateTimeLabel('2026-10-22')).toBe('2026-10-22')
    expect(localDateIso('2026-10-22')).toBe('2026-10-22')
    const label = localDateTimeLabel('2026-10-21T22:00:00Z')
    expect(label.startsWith('2026-10-2')).toBe(true)
    const stamp = localTimestampOn('2026-10-22', 9)
    expect(localDateTimeLabel(stamp)).toBe('2026-10-22 09:00')
    expect(localDateIso(stamp)).toBe('2026-10-22')
  })
})
