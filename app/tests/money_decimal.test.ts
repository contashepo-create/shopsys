import { describe, expect, it } from 'vitest'
import { toMinor } from '../src/core/money.ts'

describe('إدخال الكسور العشرية', () => {
  it('يقبل النقطة الإنجليزية والفاصلة العشرية العربية', () => {
    expect(toMinor('1.5', 2)).toBe(150)
    expect(toMinor('١٫٥', 2)).toBe(150)
  })

  it('يقبل الفاصلة الإنجليزية التي ترسلها لوحة المفاتيح العربية', () => {
    expect(toMinor('1,5', 2)).toBe(150)
  })

  it('يحافظ على الدقة بحسب عدد خانات العملة', () => {
    expect(toMinor('1.234', 3)).toBe(1234)
    expect(toMinor('1.5', 0)).toBe(1)
  })
})
