import { expect, it } from 'vitest'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const wrap = (state: unknown) => JSON.stringify({ state, version: 1 })
const a = { id: 1, entryNumber: 1, date: '2025-01-01', description: 'أصل', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2025-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const base = { journal: [a], preferences: { mode: 'light' } }
const merge = (left: unknown, right: unknown) => JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(left), wrap(right))).state
it('يرفض تركيب تغييرات مستقلة في قيد محلي في الاتجاهين', () => {
 const one = { ...base, journal: [{ ...a, description: 'معدل' }] }
 const two = { ...base, journal: [{ ...a, createdBy: 'آخر' }] }
 expect(() => merge(one, two)).toThrow(/تغيّر بيانات القيد المحلي/)
 expect(() => merge(two, one)).toThrow(/تغيّر بيانات القيد المحلي/)
})
it('يرفض إضافتي دفتر متزامنتين بترتيبين غير قابلين للحفظ كامتداد لكل طرف', () => {
 const one = { ...base, journal: [a, { ...a, id: 2, entryNumber: 2 }] }
 const two = { ...base, journal: [a, { ...a, id: 3, entryNumber: 3 }] }
 expect(() => merge(one, two)).toThrow(/ترتيبها/)
 expect(() => merge(two, one)).toThrow(/ترتيبها/)
})
it('يسمح بإلحاق قيد وتغيير مستقل خارج الدفتر، ويحفظ عكساً مطابقاً', () => {
 const reverse = { ...a, id: 2, entryNumber: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: a.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
 const one = { ...base, journal: [{ ...a, reversedByEntryId: 2 }, reverse] }
 const two = { ...base, preferences: { mode: 'dark' } }
 expect(merge(one, two)).toEqual({ ...one, preferences: two.preferences })
 expect(merge(two, one)).toEqual({ ...one, preferences: two.preferences })
})
