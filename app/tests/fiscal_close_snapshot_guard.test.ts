import { expect, it } from 'vitest'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const snap = (state: object) => JSON.stringify({ state })
const initial = { journal: [{ id: 1, date: '2024-07-01', sourceType: 'manual', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }] }], branches: [], appUsers: [], currentUserId: null, loggedOut: false, roleOverrides: {}, branchRoleOverrides: {}, customRoles: [], customers: [] }
const close = { id: 2, date: '2024-12-31', sourceType: 'year_closing', sourceId: 1, lines: [{ accountCode: '4101', debit: 100, credit: 0 }, { accountCode: '3102', debit: 0, credit: 100 }] }
const closed = { ...initial, journal: [...initial.journal, close] }
it('يرفض دمج إقفال مع حركة دفتر أو تغيير صلاحيات متزامن في الاتجاهين', () => {
 const movement = { ...initial, journal: [...initial.journal, { ...initial.journal[0], id: 3 }] }
 const access = { ...initial, roleOverrides: { accountant: [] } }
 for (const other of [movement, access]) {
  expect(() => mergeConcurrentSnapshots(snap(initial), snap(closed), snap(other))).toThrow(/إقفال السنة/)
  expect(() => mergeConcurrentSnapshots(snap(initial), snap(other), snap(closed))).toThrow(/إقفال السنة/)
 }
})
it('يسمح بدمج تعديل مستقل لا يؤثر في الدفتر أو صلاحية الإقفال', () => {
 const other = { ...initial, customers: [{ id: 3, nameAr: 'عميل' }] }
 const merged = JSON.parse(mergeConcurrentSnapshots(snap(initial), snap(closed), snap(other)))
 expect(merged.state.journal).toEqual(closed.journal); expect(merged.state.customers).toEqual(other.customers)
})
it('يرفض تعديل الدفتر المتزامن مع عكس الإقفال', () => {
 const before = { ...closed, journal: [initial.journal[0], { ...close, reversedByEntryId: null }] }
 const reopened = { ...before, journal: [initial.journal[0], { ...close, reversedByEntryId: 4 }, { id: 4, sourceType: 'reversal', reversesEntryId: 2 }] }
 const other = { ...before, journal: [...before.journal, { ...initial.journal[0], id: 3 }] }
 expect(() => mergeConcurrentSnapshots(snap(before), snap(reopened), snap(other))).toThrow(/إقفال السنة/)
})
