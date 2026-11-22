import { expect, it } from 'vitest'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const wrap = (state: object) => JSON.stringify({ state })
const base = { custodyFiles: [{ id: 1, status: 'open' }], custodyTxs: [{ id: 1, fileId: 1, type: 'fund', amountMinor: 100 }], journal: [{ id: 1 }], branches: [] }
const spending = { ...base, custodyTxs: [...base.custodyTxs, { id: 2, fileId: 1, type: 'expense', amountMinor: 75 }] }
const closing = { ...base, custodyFiles: [{ id: 1, status: 'settled' }] }
const merged = (a: object, b: object) => JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(a), wrap(b))).state

it('يرفض الصرف المتزامن مع الإقفال في الاتجاهين', () => {
 expect(() => merged(spending, closing)).toThrow(/تعارض حركة العهدة/)
 expect(() => merged(closing, spending)).toThrow(/تعارض حركة العهدة/)
})
it.each(['journal', 'employees', 'projects', 'purchases', 'sales', 'payrollRuns', 'treasuries', 'appUsers', 'roleOverrides', 'activeBranchId'])('يرفض تغيير أساس %s بالتزامن مع حركة العهدة', key => {
 const other = { ...base, [key]: key === 'activeBranchId' ? 2 : [{ id: 7 }] }
 expect(() => merged(spending, other)).toThrow(/تعارض حركة العهدة/)
 expect(() => merged(other, spending)).toThrow(/تعارض حركة العهدة/)
})
it('يقبل تغييراً مستقلاً أو إعادة نفس اللقطة، دون ادعاء حماية كل الكتّاب', () => {
 expect(merged(spending, { ...base, userPrefs: { owner: { theme: 'dark' } } })).toMatchObject({ custodyTxs: spending.custodyTxs, userPrefs: { owner: { theme: 'dark' } } })
 expect(merged(spending, spending).custodyTxs).toEqual(spending.custodyTxs)
 expect(merged(base, spending).custodyTxs).toEqual(spending.custodyTxs)
})
