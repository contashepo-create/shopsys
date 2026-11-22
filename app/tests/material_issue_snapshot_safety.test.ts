import { expect, it } from 'vitest'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
import { assertMaterialIssueHistoryPreserved } from '../src/core/materialIssueHistoryGuard.ts'

const req = { id: 1, projectId: 1, journalEntryId: 2, status: 'issued', totalCostMinor: 30, lines: [{ itemId: 5, baseQty: 1, costMinor: 30 }] }
const move = { id: 1, docType: 'material_issue', docId: 1, itemId: 5, qtyDelta: -1, balanceAfter: 2 }
const cost = { id: 1, projectId: 1, source: 'material_issue', journalEntryId: 2, amountMinor: 30 }
const initial = { materialRequisitions: [req], stockMoves: [move], projectCosts: [cost], items: [{ id: 5, stockQty: 2, costMinor: 30 }], journal: [{ id: 2 }], projects: [{ id: 1 }] }
const wrap = (state: object) => JSON.stringify({ state })
it.each(['materialRequisitions', 'stockMoves', 'projectCosts'])('يرفض فقد دليل محلي أو تغييره أو تكراره في %s', key => {
 const row = initial[key as 'materialRequisitions' | 'stockMoves' | 'projectCosts'][0]
 for (const rows of [[], [{ ...row, id: 999 }], [{ ...row, changed: true }], [row, row]]) expect(() => assertMaterialIssueHistoryPreserved(initial, { ...initial, [key]: rows })).toThrow(/صرف المواد/)
})
it('يقبل التاريخ مطابقاً واختلاف ترتيب مفاتيح JSON وإضافة مستند آخر؛ لا يخترع حركات قديمة مفقودة', () => {
 expect(() => assertMaterialIssueHistoryPreserved(initial, JSON.parse(JSON.stringify({ ...initial, materialRequisitions: [{ ...req, id: 2 }, { lines: req.lines, totalCostMinor: 30, status: 'issued', journalEntryId: 2, projectId: 1, id: 1 }] })))).not.toThrow()
 expect(() => assertMaterialIssueHistoryPreserved({ materialRequisitions: [{ id: 1 }] }, { materialRequisitions: [{ id: 1 }] })).not.toThrow()
 expect(() => assertMaterialIssueHistoryPreserved({}, {})).not.toThrow()
})
it('يرفض إذن صرف مع تغيير تكلفة أو مخزون أو اعتماد بالتزامن ولو اختلفت الحقول القابلة للدمج', () => {
 const base = { materialRequisitions: [], items: [{ id: 5, stockQty: 3, costMinor: 30 }], projectCosts: [], stockMoves: [], journal: [], approvalRequests: [] }
 const issued = { ...base, materialRequisitions: [req], items: [{ id: 5, stockQty: 2, costMinor: 30 }] }
 for (const changed of [{ items: [{ id: 5, stockQty: 3, costMinor: 50 }] }, { approvalRequests: [{ id: 3 }] }, { projects: [{ id: 1, status: 'completed' }] }, { batches: [{ id: 1 }] }, { currentUserId: 5 }]) {
  const other = { ...base, ...changed }
  for (const [a,b] of [[issued, other], [other, issued]]) expect(() => mergeConcurrentSnapshots(wrap(base), wrap(a), wrap(b))).toThrow(/تعارض.*صرف المواد/)
 }
})
it('لا يحجب إعادة نفس اللقطة أو تغييراً مستقلاً', () => {
 const base = { materialRequisitions: [], items: [], journal: [] }
 const issued = { ...base, materialRequisitions: [req] }
 expect(JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(issued), wrap(issued))).state.materialRequisitions).toEqual([req])
 expect(JSON.parse(mergeConcurrentSnapshots(wrap(base), wrap(issued), wrap({ ...base, prefs: { theme: 'dark' } }))).state.prefs.theme).toBe('dark')
})
