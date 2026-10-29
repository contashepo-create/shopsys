import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { secureStorage, flushSecureStorageWrites } from '../src/data/secureStorage.ts'
import { buildBackup, parseBackup } from '../src/core/backup.ts'

const original = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useDataStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, customers: [], projects: [], projectExtracts: [], clientAdvances: [], sales: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {}, branchOpeningBalances: {}, insuranceClaims: [], clinicPatients: [], labPatients: [], auditLog: [] })
})
function legacy() {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة المشروع', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = S().customers.at(-1)!
  const project = S().addProject({ nameAr: 'مشروع تاريخي', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 20000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  const extract = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 8000, vatPercent: 0, payment: 'credit' })
  // محاكاة الشكل التاريخي الذي كان يُنشئ ذمة بلا عميل — ليس بيانات إنتاج.
  useRawDataStore.setState({ projects: S().projects.map(p => p.id === project.id ? { ...p, clientId: null } : p) })
  return { customer, project, extract }
}
it('مراجعة صريحة تربط الذمة اليتيمة بعميل بلا حركة دون إضافة أو تغيير قيد', () => {
  const { customer, project, extract } = legacy()
  const journal = S().journal
  expect(S().getCustomerBalance(customer.id)).toBe(0)
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, extractCount: 1 })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: 7000, fingerprint: preview.fingerprint, reason: 'مطابقة العقد والدفتر', confirmed: true })).toThrow(/تغير|المراجعة/)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: 8000, fingerprint: preview.fingerprint, reason: 'مطابقة العقد والدفتر وعدم وجود تحصيل', confirmed: true })
  expect(S().journal).toBe(journal)
  expect(S().getCustomerBalance(customer.id)).toBe(8000)
  expect(S().getOpenClientInvoices(customer.id, true).find(d => d.docKey === `extract:${extract.id}`)).toMatchObject({ dueMinor: 8000, settledMinor: 0 })
  expect(S().projects.find(p => p.id === project.id)?.legacyCustomerResolution).toMatchObject({ customerId: customer.id, dueMinor: 8000, reason: 'مطابقة العقد والدفتر وعدم وجود تحصيل' })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: 8000, fingerprint: preview.fingerprint, reason: 'تكرار', confirmed: true })).toThrow(/مربوط|مسبق/)
})

it('يشترط إقراراً وسبباً، ويرفض غير المالك دون أثر', () => {
  const { customer, project } = legacy()
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  const args = { projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true }
  const before = S()
  expect(() => S().resolveLegacyProjectCustomer({ ...args, confirmed: false })).toThrow(/الإقرار/)
  expect(() => S().resolveLegacyProjectCustomer({ ...args, reason: ' ' })).toThrow(/سبب/)
  expect(S().projects).toBe(before.projects)
  useRawDataStore.setState({ appUsers: [{ id: 91, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }], currentUserId: 91 })
  expect(() => S().resolveLegacyProjectCustomer(args)).toThrow(/للمالك فقط/)
})

it('يرفض قيداً أصلياً مفقوداً أو لقيد مستخلص يحمل طرفاً صريحاً', () => {
  const { customer, project, extract } = legacy()
  const journal = S().journal
  useRawDataStore.setState({ journal: journal.filter(e => e.id !== extract.journalEntryId) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ journal: journal.map(e => e.id === extract.journalEntryId ? { ...e, lines: e.lines.map(l => l.accountCode === '1104' ? { ...l, partyKind: 'customer' as const, partyId: customer.id } : l) } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/طرفاً صريحاً/)
})

it('يرفض رداً أو مقدمة فاسدة وتخصيصاً محفوظاً لعميل آخر', () => {
  const { customer, project, extract } = legacy()
  const base = useRawDataStore.getState()
  useRawDataStore.setState({ clientAdvances: [{ id: 1, projectId: project.id, amountMinor: 1000, recoveredMinor: 0, date: '2025-01-01', journalEntryId: 20 }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ clientAdvances: [], projectExtracts: base.projectExtracts.map(e => e.id === extract.id ? { ...e, refundedMinor: 1000 } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectExtracts: base.projectExtracts, vouchers: [{ id: 3, projectId: null, kind: 'receipt', partyKind: 'customer', partyId: customer.id + 9, allocations: [{ docKey: `extract:${extract.id}`, appliedMinor: 500 }] }] as never })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/تخصيصات/)
})

it('يعاين حساباً ذا حركات سابقة ويحترم حد الائتمان', () => {
  const { customer, project } = legacy()
  S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'قبض سابق' })
  expect(S().previewLegacyProjectCustomer(project.id, customer.id)).toMatchObject({ balanceBeforeMinor: -1000, balanceAfterMinor: 7000 })
  useRawDataStore.setState({ vouchers: [], journal: S().journal.filter(e => e.sourceType !== 'payment_voucher'), customers: S().customers.map(c => ({ ...c, creditLimitMinor: 7000 })) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ائتمان/)
  useRawDataStore.setState({ customers: S().customers.map(c => ({ ...c, creditLimitMinor: 8000 })) })
  expect(S().previewLegacyProjectCustomer(project.id, customer.id).dueMinor).toBe(8000)
})

it('يعزل المشروع والعميل والقيد عن الفروع الأخرى', () => {
  const { customer, project, extract } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 2 })), projects: S().projects.map(p => ({ ...p, branchId: 2 })), projectExtracts: S().projectExtracts.map(e => ({ ...e, branchId: 2 })) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفرع الحالي/)
  useRawDataStore.setState({ activeBranchId: 2, journal: useRawDataStore.getState().journal.map(e => e.id === extract.journalEntryId ? { ...e, branchId: 1 } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ journal: useRawDataStore.getState().journal.map(e => e.id === extract.journalEntryId ? { ...e, branchId: 2 } : e) })
  expect(S().previewLegacyProjectCustomer(project.id, customer.id).dueMinor).toBe(8000)
})


it('يحفظ أثر المراجعة بعد التخزين المشفر والنسخة الاحتياطية وإعادة تحميل Zustand', async () => {
  const { customer, project } = legacy()
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة المستندات', confirmed: true })
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  expect(stored).toBeTruthy()
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 1, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ customers: [], projects: [], projectExtracts: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(S().getCustomerBalance(customer.id)).toBe(8000)
  expect(S().projects.find(p => p.id === project.id)?.legacyCustomerResolution?.reason).toBe('مطابقة المستندات')
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مربوط|مسبق/)
})

it('يحفظ لقطة المراجعة ويستعيدها بعد إغلاق وفتح SQLite فعلياً', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-legacy-project-'))
  try {
    const { customer, project, extract } = legacy()
    useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
    S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض محفوظ' })
    S().refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'إشعار' })
    useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
    const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
    expect(preview.balanceAfterMinor).toBe(4000)
    S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة نسخة SQLite', confirmed: true })
    await flushSecureStorageWrites('shopsys-data')
    const payload = await secureStorage.getItem('shopsys-data')
    expect(payload).toBeTruthy()
    const path = join(dir, 'shopsys.db')
    const db = await ShopsysDatabase.open(path)
    db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: payload! })
    db.close()
    const reopened = await ShopsysDatabase.open(path)
    const saved = reopened.getSnapshot('shopsys-data').payloadJson
    reopened.close()
    expect(saved).toBeTruthy()
    useRawDataStore.setState({ customers: [], projects: [], projectExtracts: [], journal: [] })
    await flushSecureStorageWrites('shopsys-data')
    await secureStorage.setItem('shopsys-data', saved!)
    await useRawDataStore.persist.rehydrate()
    expect(S().getCustomerBalance(customer.id)).toBe(4000)
    const review = S().projects.find(p => p.id === project.id)?.legacyCustomerResolution
    expect(review?.reason).toBe('مطابقة نسخة SQLite')
    expect(review?.documents?.find(doc => doc.docKey === `extract:${extract.id}`)?.afterSources).toContainEqual({ description: 'سند RV-0001 (تخصيص محفوظ)', amountMinor: 3000 })
    expect(review?.evidence?.some(item => item.description.includes('إشعار دائن'))).toBe(true)
    expect(review?.evidence?.some(item => item.description.includes('سند RV-0001'))).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض تكرار هوية المستخلص أو تغيّر بياناته بعد المعاينة ولو لم يتغير الإجمالي', () => {
  const { customer, project, extract } = legacy()
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  const originalExtracts = S().projectExtracts
  useRawDataStore.setState({ projectExtracts: [...originalExtracts, { ...extract, projectId: project.id + 1 }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/غير فريدة/)
  useRawDataStore.setState({ projectExtracts: originalExtracts.map(e => ({ ...e, extractNumber: 'PRX-تغير' })) })
  const before = S()
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/تغير/)
  expect(S().projects).toBe(before.projects)
})

it('معاينة العميل ذي الحركات تُظهر أثر إعادة توزيع الشيك قبل الربط دون تغيير أي سجل', () => {
  const { customer, project, extract } = legacy()
  const s = S()
  const other = s.addProject({ nameAr: 'مشروع آخر للعميل', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const newer = s.addProjectExtract({ projectId: other.id, description: 'آخر', grossMinor: 5000, vatPercent: 0, payment: 'credit' })
  useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(e => ({ ...e, date: e.id === extract.id ? '2025-01-01' : '2026-01-01' })) })
  s.receiveCheque({ chequeNumber: 'HISTORY-CH', partyId: customer.id, bankName: 'بنك', amountMinor: 3000, dueDate: '2026-11-01', notes: '' })
  const before = S()
  expect(s.getCustomerBalance(customer.id)).toBe(2000)
  const preview = s.previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: 2000, balanceAfterMinor: 10000 })
  expect(preview.documents.find(d => d.docKey === `extract:${newer.id}`)).toMatchObject({ beforeRemainingMinor: 2000, afterRemainingMinor: 5000 })
  expect(preview.documents.find(d => d.docKey === `extract:${extract.id}`)).toMatchObject({ beforeRemainingMinor: null, afterRemainingMinor: 5000 })
  expect(S().projects).toBe(before.projects)
  expect(S().journal).toBe(before.journal)
  const afterPreviewJournal = S().journal
  s.resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة العقد والتحصيلات', confirmed: true })
  expect(s.getCustomerBalance(customer.id)).toBe(10000)
  expect(s.getOpenClientInvoices(customer.id, true).find(d => d.docKey === `extract:${newer.id}`)?.settledMinor).toBe(0)
  expect(S().journal).toBe(afterPreviewJournal)
})


it('يُعاين إشعاراً دائناً مطابقاً ويفصله عن التحصيل دون تعديل قيد', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().refundProjectExtract({ extractId: extract.id, amountMinor: 2000, mode: 'customer_credit', reason: 'أعمال مردودة' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 6000, balanceBeforeMinor: 0, balanceAfterMinor: 6000 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة الإشعار والعقد', confirmed: true })
  expect(S().getCustomerBalance(customer.id)).toBe(6000)
  expect(S().journal).toBe(journal)
})

it('يراجع قيد الدفعة المقدمة واستردادها قبل حساب الذمة الصافية', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().receiveClientAdvance({ projectId: project.id, amountMinor: 1000, treasury: '1101' })
  S().addProjectExtract({ projectId: project.id, grossMinor: 2000, vatPercent: 0, payment: 'credit', description: 'الختامي', advanceRecoveryMinor: 1000 })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ dueMinor: 9000, balanceAfterMinor: 9000 })
  const before = S().clientAdvances
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة المقدمة والاسترداد', confirmed: true })
  expect(S().getAdvanceBalance(project.id)).toBe(0)
  expect(S().getCustomerBalance(customer.id)).toBe(9000)
  expect(S().clientAdvances).toBe(before)
})


it('يحافظ على التخصيص الصريح لسند قبض مطابق للمشروع والعميل', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض مرتبط' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const vouchers = S().vouchers
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: -3000, balanceAfterMinor: 5000 })
  expect(p.documents.find(d => d.docKey === `extract:${extract.id}`)?.afterRemainingMinor).toBe(5000)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة سند القبض', confirmed: true })
  expect(S().vouchers).toBe(vouchers)
  expect(S().getCustomerBalance(customer.id)).toBe(5000)
})

it('يفصل المستخلص النقدي عن الذمة ويضيف إشعاره الدائن فقط عند مطابقة قيده', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const cash = S().addProjectExtract({ projectId: project.id, grossMinor: 2000, vatPercent: 0, payment: 'cash', description: 'نقدي' })
  S().refundProjectExtract({ extractId: cash.id, amountMinor: 500, mode: 'customer_credit', reason: 'رد نقدي على الحساب' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ dueMinor: 7500, balanceAfterMinor: 7500 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة النقد والإشعار', confirmed: true })
  expect(S().getCustomerBalance(customer.id)).toBe(7500)
})

it('يرفض الحفظ بعد تغير توزيع شيك سابق حتى لو لم يتغير أصل المستخلص', () => {
  const { customer, project } = legacy()
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  S().receiveCheque({ chequeNumber: 'CH-NEW', partyId: customer.id, bankName: 'بنك', amountMinor: 1200, dueDate: '2026-11-01', notes: '' })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/تغير/)
  expect(S().projects.find(item => item.id === project.id)?.clientId).toBeNull()
})

it('يمنع إسقاط عميل محذوف أو نقل مشروع تاريخي بين فروع بمجرد اختيار عميل', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id + 100 })) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مرتبط/)
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: null, customers: S().customers.map(c => ({ ...c, branchId: 2 })) } as never)
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/فرع/)
})

it('يطابق تحصيل العميل الصريح وقيده ويرفض تلفه قبل الكتابة', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 2400, treasury: '1101', specificDocKey: `extract:${extract.id}` })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const collection = S().clientSettlements.at(-1)!
  const good = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p.documents.find(doc => doc.docKey === `extract:${extract.id}`)?.afterSources).toContainEqual({ description: `تحصيل ${collection.settlementNumber} (تخصيص محفوظ)`, amountMinor: 2400 })
  useRawDataStore.setState({ journal: good.filter(entry => entry.id !== collection.journalEntryId) })
  const before = S().projects
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة التحصيل', confirmed: true })).toThrow(/تخصيصات/)
  expect(S().projects).toBe(before)
  useRawDataStore.setState({ journal: good })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة التحصيل', confirmed: true })
  expect(S().getCustomerBalance(customer.id)).toBe(5600)
})

it('يمنع حفظ المقدمة عند اختلاف إجمالي استردادها عن المستخلصات', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().receiveClientAdvance({ projectId: project.id, amountMinor: 1000, treasury: '1101' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })), clientAdvances: S().clientAdvances.map(a => ({ ...a, recoveredMinor: 500 })) })
  const projects = S().projects
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/استرداد/)
  expect(S().projects).toBe(projects)
})

it('يرفض تخصيص تحصيل مختلط يشير إلى مستند آخر لا يمكن إثبات انتمائه للعميل', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })), vouchers: S().vouchers.map(v => ({ ...v, allocations: [{ docKey: `extract:${extract.id}`, docLabel: 'مستخلص', appliedMinor: 2000 }, { docKey: 'sale:999999', docLabel: 'فاتورة مجهولة', appliedMinor: 1000 }] })) })
  const before = S().projects
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مستند غير ظاهر/)
  expect(S().projects).toBe(before)
})

it('يعتمد سنداً معكوساً بعد مطابقة قيديه ولا يحتسب تخصيصه تحصيلاً قائماً', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const voucher = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض ملغى' })
  S().reverseVoucher(voucher.id, 'إلغاء التحصيل')
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const ledger = S().journal
  const vouchers = S().vouchers
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: 0, balanceAfterMinor: 8000 })
  expect(preview.documents.find(doc => doc.docKey === `extract:${extract.id}`)).toMatchObject({ afterRemainingMinor: 8000, afterSettledMinor: 0, afterSources: [] })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة السند وعكسه', confirmed: true })
  expect(S().journal).toBe(ledger)
  expect(S().vouchers).toBe(vouchers)
  expect(S().getCustomerBalance(customer.id)).toBe(8000)
})

it('يرفض سنداً معكوساً فقد قيد العكس أو اختلف مبلغه أو تغير بعد المعاينة', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const voucher = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض ملغى' })
  const reversed = S().reverseVoucher(voucher.id, 'إلغاء')
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  const ledger = S().journal
  useRawDataStore.setState({ journal: ledger.filter(e => e.id !== reversed.reversalEntryId) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/عكس|تخصيصات/)
  useRawDataStore.setState({ journal: ledger.map(e => e.id === reversed.reversalEntryId ? { ...e, lines: e.lines.map((l, i) => i === 0 ? { ...l, debit: l.debit + 1 } : l) } : e) })
  const before = S().projects
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/عكس|تخصيصات/)
  expect(S().projects).toBe(before)
})

it('يعاين مستخلصاً ودفعة مقدمة وماكينة ورداً مطابقاً دون تعديل حركات الماكينة', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'term-1', code: 'TERM-01', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pos-1', status: 'active' })
  S().receiveClientAdvance({ projectId: project.id, amountMinor: 1000, treasury: '1101', terminalPayment: { terminalId: 'term-1', providerReference: 'ADV-1' } })
  const cash = S().addProjectExtract({ projectId: project.id, grossMinor: 2000, vatPercent: 0, payment: 'cash', description: 'نقدي بالماكينة', treasury: '1101', terminalPayment: { terminalId: 'term-1', providerReference: 'EX-1' } })
  const charge = S().paymentTerminalTransactions.find(tx => tx.documentId === String(cash.id))!
  S().refundProjectExtract({ extractId: cash.id, amountMinor: 500, mode: 'cash', treasury: '1101', reason: 'رد ماكينة', terminalRefund: { originalTransactionId: charge.id, providerReference: 'R-1' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const terminalTransactions = S().paymentTerminalTransactions
  const journal = S().journal
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, balanceAfterMinor: 8000 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة الماكينة والدفتر', confirmed: true })
  expect(S().paymentTerminalTransactions).toBe(terminalTransactions)
  expect(S().journal).toBe(journal)
})

it('يرفض مبلغ ماكينة أو ردّها إذا خالف القيد أو فقد أصله أو تغيرت بياناته بعد المعاينة', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'term-1', code: 'TERM-01', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pos-1', status: 'active' })
  const cash = S().addProjectExtract({ projectId: project.id, grossMinor: 2000, vatPercent: 0, payment: 'cash', description: 'نقدي', treasury: '1101', terminalPayment: { terminalId: 'term-1', providerReference: 'EX-2' } })
  const charge = S().paymentTerminalTransactions.find(tx => tx.documentId === String(cash.id))!
  S().refundProjectExtract({ extractId: cash.id, amountMinor: 500, mode: 'cash', treasury: '1101', reason: 'رد', terminalRefund: { originalTransactionId: charge.id, providerReference: 'R-2' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const good = S().paymentTerminalTransactions
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  useRawDataStore.setState({ paymentTerminalTransactions: good.map(t => t.id === charge.id ? { ...t, amountMinor: t.amountMinor + 1 } : t) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
  useRawDataStore.setState({ paymentTerminalTransactions: good.filter(t => t.id !== charge.id) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
  useRawDataStore.setState({ paymentTerminalTransactions: good.map(t => t.id === charge.id ? { ...t, providerReference: 'CHANGED' } : t) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/تغير/)
  expect(S().projects.find(p => p.id === project.id)?.clientId).toBeNull()
})

it('يسمح بفواتير توثيق صامتة ومرتجعاتها بعد مطابقة العميل والمستخلص والقيود التذكارية', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], stockMoves: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'أعمال توثيق' })
  const doc = S().postSale({ lines: [{ itemId, nameAr: 'أعمال توثيق', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'documentation', extractIds: [extract.id] })
  const ret = S().postSaleReturn({ saleId: doc.id, qtyByItem: new Map([[itemId, 1]]), refund: 'credit', reason: 'تصحيح توثيق' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ dueMinor: 8000, balanceAfterMinor: 8000 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة توثيق المشروع', confirmed: true })
  expect(S().getCustomerBalance(customer.id)).toBe(8000)
  expect(S().journal).toBe(journal)
  expect(S().saleReturns.find(row => row.id === ret.id)?.projectBilling).toBe('documentation')
})

it('يمنع فاتورة توثيق تحمل قيداً مالياً أو عميلًا آخر أو مستخلصاً آخر', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], stockMoves: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة توثيق' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة توثيق', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'documentation', extractIds: [extract.id] })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview.evidence).toContainEqual({ description: `فاتورة توثيق ${sale.invoiceNumber} (تذكارية بلا قيد مالي)`, amountMinor: 1000 })
  const good = S().sales
  useRawDataStore.setState({ sales: good.map(row => ({ ...row, customerId: customer.id + 1 })) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/عميل/)
  useRawDataStore.setState({ sales: good.map(row => ({ ...row, extractIds: [extract.id + 1] })) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/مستخلص/)
  useRawDataStore.setState({ sales: good, journal: S().journal.map(e => e.id === sale.journalEntryId ? { ...e, memoOnly: false } : e) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/مراجعة/)
})

it('يعاين فاتورة إضافية مثبتة لعميل المشروع وتحصيلها دون تكرار دينها عند الربط', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], stockMoves: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'أعمال إضافية' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'أعمال إضافية', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 1000, treasury: '1101', specificDocKey: `sale:${sale.id}` })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة الفاتورة والتحصيل', confirmed: true })
  expect(S().journal).toBe(journal)
  expect(S().getCustomerBalance(customer.id)).toBe(9000)
})

it('يمنع تكرار عكس السند حتى لو بدا قيد العكس الأول صحيحاً', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const v = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض' })
  const reversed = S().reverseVoucher(v.id, 'إلغاء')
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const original = S().journal.find(e => e.id === reversed.reversalEntryId)!
  useRawDataStore.setState({ journal: [...S().journal, { ...original, id: original.id + 1000 }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/تخصيصات/)
})

it('يتحقق من تحصيل ماكينة السند المرتبط ويحجب رداً خارجياً غير موزع', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'term-v', code: 'TERM-02', nameAr: 'ماكينة سند', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pv', status: 'active' })
  S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, projectId: project.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 2000, description: 'قبض ماكينة', terminalPayment: { terminalId: 'term-v', providerReference: 'V-1' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const charge = S().paymentTerminalTransactions[0]
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview.balanceAfterMinor).toBe(6000)
  expect(preview.evidence.some(row => row.description.includes('ماكينة تحصيل'))).toBe(true)
  useRawDataStore.setState({ paymentTerminalTransactions: [...S().paymentTerminalTransactions, { ...charge, id: 'refund-outside', idempotencyKey: 'refund-outside', kind: 'refund', amountMinor: 100, originalTransactionId: charge.id, documentId: 'unallocated', providerReference: 'R-OUT' }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
})

it('يرفض فاتورة إضافية معدّلة أو مردودة بدل إسناد دين غير موثوق', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], stockMoves: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة إضافية' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة إضافية', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const good = S().journal
  S().previewLegacyProjectCustomer(project.id, customer.id)
  useRawDataStore.setState({ journal: good.map(e => e.id === sale.journalEntryId ? { ...e, lines: e.lines.map((line, i) => i === 0 ? { ...line, debit: line.debit + 1 } : line) } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفاتورة/)
  useRawDataStore.setState({ journal: good, saleReturns: [{ id: 111, saleId: sale.id }] as never })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفاتورة/)
})

it('يطابق ماكينة تحصيل العميل ويرفض حفظ معاينة تغيرت فيها بيانات الماكينة', () => {
  const { customer, project, extract } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'term-c', code: 'TERM-03', nameAr: 'ماكينة تحصيل', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pc', status: 'active' })
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 2500, treasury: '1101', specificDocKey: `extract:${extract.id}`, terminalPayment: { terminalId: 'term-c', providerReference: 'C-1' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview.balanceAfterMinor).toBe(5500)
  expect(preview.evidence.some(row => row.description.includes('C-1'))).toBe(true)
  useRawDataStore.setState({ paymentTerminals: S().paymentTerminals.map(t => ({ ...t, nameAr: 'اسم جديد' })) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/تغير/)
  expect(S().projects.find(p => p.id === project.id)?.clientId).toBeNull()
})
