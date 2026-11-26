import { expect, it } from 'vitest'
import { assertProjectOperationalHistoryPreserved } from '../src/core/projectOperationalHistoryGuard.ts'
import { mergeConcurrentSnapshots, newJournalEntries } from '../src/data/persistentStorage.ts'
const project = { id: 1, status: 'active' }
const event = { from: 'running', to: 'on_hold', reason: 'قرار الإدارة', at: '2026-11-15', by: 'مالك' }
const base = { projects: [project], projectCosts: [], journal: [] }
const paused = { ...base, projects: [{ ...project, operationalStatus: 'on_hold', operationalStatusHistory: [event] }] }
const envelope = (value: unknown) => JSON.stringify({ state: value, version: 1 })
it('يحافظ على سجل الحالات ويمنع الاستعادة الأقدم أو التعديل غير المثبت', () => {
 expect(() => assertProjectOperationalHistoryPreserved(base, paused)).not.toThrow()
 expect(() => assertProjectOperationalHistoryPreserved(paused, base)).toThrow(/حالة المشروع/)
 expect(() => assertProjectOperationalHistoryPreserved(paused, { ...paused, projects: [{ ...paused.projects[0], operationalStatus: 'running' }] })).toThrow(/حالة المشروع/)
 expect(() => assertProjectOperationalHistoryPreserved(paused, paused)).not.toThrow()
})
it('يرفض دمج توقف المشروع مع تسجيل تكلفة متزامنة في الاتجاهين', () => {
 const expense = { ...base, projectCosts: [{ id: 1, projectId: 1, amountMinor: 100 }] }
 expect(() => mergeConcurrentSnapshots(envelope(base), envelope(paused), envelope(expense))).toThrow(/حالة المشروع.*متزامنة/)
 expect(() => mergeConcurrentSnapshots(envelope(base), envelope(expense), envelope(paused))).toThrow(/حالة المشروع.*متزامنة/)
})

it('حفظ SQLite المباشر لا يسقط الإيقاف المسجل بعد تحديث نافذة أخرى', () => {
 expect(() => newJournalEntries(envelope(base), envelope(paused))).toThrow(/حالة المشروع/)
 expect(() => newJournalEntries(envelope(paused), envelope(base))).not.toThrow()
})
it('لا يرفض دمج مشروع جديد مع عملية مستقلة بسبب غياب الحالة القديمة', () => {
 const added = { ...base, projects: [...base.projects, { id: 2, status: 'active' }] }
 const work = { ...base, preferences: { font: 'large' } }
 expect(() => mergeConcurrentSnapshots(envelope(base), envelope(added), envelope(work))).not.toThrow()
})
