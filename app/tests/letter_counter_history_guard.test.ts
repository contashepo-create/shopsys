import { describe, expect, it } from 'vitest'
import { assertLetterCountersPreserved } from '../src/core/letterCounterHistoryGuard.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const key = 'branch-2:2026'
const state = (counters: unknown) => ({ letterNumberCounters: counters })
describe('حماية عداد الخطابات عند تطبيق اللقطات', () => {
  it('يسمح بالنسخ القديمة إذا لم يصدر عداد محلي، وبالمساوي والزيادة وبعداد مستنفد', () => {
    expect(() => assertLetterCountersPreserved({}, {})).not.toThrow()
    expect(() => assertLetterCountersPreserved(state({ [key]: 0 }), {})).not.toThrow()
    expect(() => assertLetterCountersPreserved(state({ [key]: 3 }), state({ [key]: 3, 'unscoped:2025': 1 }))).not.toThrow()
    expect(() => assertLetterCountersPreserved(state({ [key]: 3 }), state({ [key]: 999999999 }))).not.toThrow()
  })
  it.each([{}, { [key]: 2 }, { 'branch-3:2026': 4 }])('يرفض إسقاط أو خفض عداد مصدر حتى بعد حذف خطابه', next => {
    expect(() => assertLetterCountersPreserved(state({ [key]: 3 }), state(next))).toThrow('عداد الخطابات')
  })
  it.each([null, [], 'x', { [key]: -1 }, { [key]: 1.5 }, { [key]: '4' }, { [key]: 1000000000 }, JSON.parse('{"__proto__":1}')])('يرفض عداداً غير صالح: %s', next => {
    expect(() => assertLetterCountersPreserved({}, state(next))).toThrow('عدادات الخطابات غير صالحة')
  })
  it('يرفض دمجاً يسقط عداداً من الأساس حتى إن غيّر أحد الطرفين حقلاً آخر فقط', () => {
    const wrap = (s: unknown) => JSON.stringify({ state: s })
    expect(() => mergeConcurrentSnapshots(wrap({ ...state({ [key]: 3 }), value: 0 }), wrap({ ...state({}), value: 0 }), wrap({ ...state({ [key]: 3 }), value: 1 }))).toThrow('عداد الخطابات')
  })
})
