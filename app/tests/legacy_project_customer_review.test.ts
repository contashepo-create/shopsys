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
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id + 100 })), loyaltyRedemptions: [{ id: 9, date: '2025-01-01', customerId: customer.id + 100, points: 1, valueMinor: 0, journalEntryId: 7 }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/العميل المفقود/)
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

it('يعاين فاتورة إضافية خدمية ومرتجعها المالي المطابق دون تكرار ذمتها', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة إضافية مرتجعة' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة إضافية', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  const ret = S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'credit', reason: 'مرتجع' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
  expect(preview.evidence.some(e => e.description.includes(ret.returnNumber))).toBe(true)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة المرتجع', confirmed: true })
  expect(S().journal).toBe(journal)
  expect(S().getCustomerBalance(customer.id)).toBe(9000)
})

it('يعاين فاتورة إضافية لبضاعة ومرتجعاً مالياً بقيد تكلفة مطابق دون تغيير المخزون', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  S().addItem({ nameAr: 'مواد', sku: 'MAT-X', barcodes: [], categoryId: 0, baseUnit: 'قطعة', extraUnits: [], costMinor: 300, stockQty: 10, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = S().items.at(-1)!
  const sale = S().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 300, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'credit', reason: 'مرتجع' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const stock = S().items.find(row => row.id === item.id)!.stockQty
  const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(preview).toMatchObject({ balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })
  expect(S().items.find(row => row.id === item.id)!.stockQty).toBe(stock)
})

it('يطابق ماكينة فاتورة إضافية وردها مع قيود البيع والمرتجع', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'sale-term', code: 'TERM-04', nameAr: 'ماكينة بيع', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'ps', status: 'active' })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'بيع إضافي' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'بيع إضافي', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'cash', treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra', terminalPayment: { terminalId: 'sale-term', providerReference: 'SALE-PAY' } })
  const charge = S().paymentTerminalTransactions[0]
  S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد', terminalRefund: { originalTransactionId: charge.id, providerReference: 'SALE-REF' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p.balanceAfterMinor).toBe(8000)
  expect(p.evidence.some(e => e.description.includes('SALE-REF'))).toBe(true)
  const good = S().paymentTerminalTransactions
  useRawDataStore.setState({ paymentTerminalTransactions: good.map(tx => tx.kind === 'refund' ? { ...tx, amountMinor: tx.amountMinor - 1 } : tx) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
  useRawDataStore.setState({ paymentTerminalTransactions: good.map(tx => tx.kind === 'refund' ? { ...tx, originalTransactionId: 'missing' } : tx) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
})

it('يطابق فاتورة إضافية بتحصيل مجزأ نقدي وماكينة وآجل دون احتساب الماكينة مرتين', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'mixed-term', code: 'TERM-05', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pm', status: 'active' })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'عمل إضافي' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'عمل إضافي', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra', paymentAllocations: [{ accountCode: '1101', amountMinor: 1000, note: 'نقدي' }, { accountCode: '1101', amountMinor: 500, note: 'ماكينة بطاقة' }], terminalPayment: { terminalId: 'mixed-term', providerReference: 'MIXED' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 500, balanceAfterMinor: 8500 })
  expect(S().sales.find(row => row.id === sale.id)?.paidMinor).toBe(1500)
  expect(p.evidence.some(e => e.description.includes('MIXED'))).toBe(true)
})

it('لا يعيد استخدام رقم عميل مفقود له مشروع تاريخي عند إنشاء عميل آخر', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ customers: [], projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مختلف', phone: '', creditLimitMinor: 0, notes: '' })
  expect(S().customers[0].id).not.toBe(customer.id)
  expect(S().projects.find(p => p.id === project.id)?.clientId).toBe(customer.id)
})

it('يحجز رقم العميل المفقود حتى لو ظهر فقط في افتتاحي فرع أو قيد طرف', () => {
  useRawDataStore.setState({ customers: [], branchOpeningBalances: { 2: { openingBalances: { 'customer:1': 500 }, openingItems: {}, declaredCapitalMinor: null } }, journal: [{ id: 1, entryNumber: 1, date: '2025-01-01', description: '', sourceType: 'manual', sourceId: 1, lines: [{ accountCode: '1104', debit: 0, credit: 0, partyKind: 'customer', partyId: 2 }], createdBy: 'مالك', createdAt: '2025-01-01' }] as never })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جديد', phone: '', creditLimitMinor: 0, notes: '' })
  expect(S().customers[0].id).toBe(3)
})

it('يمنع حذف عميل مشار إليه في سجل غير مشمول بحارس الحذف القديم', () => {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = S().customers[0]
  useRawDataStore.setState({ loyaltyRedemptions: [{ id: 1, date: '2025-01-01', customerId: customer.id, points: 1, valueMinor: 0, journalEntryId: 7 }] })
  expect(() => S().removeCustomer(customer.id)).toThrow(/سجل|مراجعة/)
  expect(S().customers).toContainEqual(customer)
})

it('يرفض ضياع حركة ماكينة مذكورة صراحة في تخصيص فاتورة إضافية', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addPaymentTerminal({ id: 'marked', code: 'TM-6', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'pm6', status: 'active' })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'عمل إضافي' })
  S().postSale({ lines: [{ itemId, nameAr: 'عمل إضافي', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra', paymentAllocations: [{ accountCode: '1101', amountMinor: 1000, note: 'ماكينة بطاقة' }], terminalPayment: { terminalId: 'marked', providerReference: 'MARKED' } })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })), paymentTerminalTransactions: [] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ماكينة/)
})

it('لا يسمح بتغيير رقم العميل أو نقله لفرع بعد ارتباطه بمستخلص', () => {
  const { customer } = legacy()
  const journal = S().journal
  expect(() => S().updateCustomer(customer.id, { id: customer.id + 100 })).toThrow(/رقم العميل/)
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  expect(() => S().updateCustomer(customer.id, { branchId: 2 })).toThrow(/الفروع|الفرع|فرع/)
  expect(S().customers.find(c => c.id === customer.id)).toBeDefined()
  expect(S().journal).toBe(journal)
})

it('يراجع عميلاً مفقوداً إذا لم تبق أي سجلات أخرى على رقمه بعد مطابقة المالك', () => {
  const { customer: missing, project } = legacy()
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'الجهة المطابقة', phone: '010', creditLimitMinor: 0, notes: '' })
  const selected = S().customers.at(-1)!
  useRawDataStore.setState({ customers: [selected], projects: S().projects.map(p => ({ ...p, clientId: missing.id })) })
  const beforeJournal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, selected.id)
  expect(p).toMatchObject({ dueMinor: 8000, balanceBeforeMinor: 0, balanceAfterMinor: 8000, previousCustomerId: missing.id })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: selected.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'طابقت هوية الجهة ومستنداتها', confirmed: true })
  expect(S().projects[0].legacyCustomerResolution?.previousCustomerId).toBe(missing.id)
  expect(S().journal).toBe(beforeJournal)
  expect(S().getCustomerBalance(selected.id)).toBe(8000)
})

it('يلغي مراجعة العميل المفقود إذا ظهر حسابه في فرع آخر بعد المعاينة', () => {
  const { customer: missing, project } = legacy()
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'الجهة الجديدة', phone: '', creditLimitMinor: 0, notes: '' })
  const target = S().customers.at(-1)!
  useRawDataStore.setState({ customers: [target], projects: S().projects.map(p => ({ ...p, clientId: missing.id })) })
  const preview = S().previewLegacyProjectCustomer(project.id, target.id)
  useRawDataStore.setState({ branchOpeningBalances: { 99: { openingBalances: { [`customer:${missing.id}`]: 1000 }, openingItems: {}, declaredCapitalMinor: null } } })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: target.id, expectedDueMinor: preview.dueMinor, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/العميل المفقود/)
  expect(S().projects[0].clientId).toBe(missing.id)
})

it('يطابق مرتجعاً نقدياً عن تحصيل محفوظ للفاتورة الإضافية ويرفض فساد قيده', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'إضافي' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'إضافي', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 1000, treasury: '1101', specificDocKey: `sale:${sale.id}` })
  const ret = S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد نقدي' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
  const good = S().journal
  useRawDataStore.setState({ journal: good.map(e => e.id === ret.journalEntryId ? { ...e, sourceId: ret.id + 100 } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفاتورة/)
  useRawDataStore.setState({ journal: good, saleReturns: S().saleReturns.map(r => r.id === ret.id ? { ...r, lines: r.lines.map(l => ({ ...l, unitPriceMinor: l.unitPriceMinor + 1 })) } : r) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/الفاتورة/)
})

it('يعرض رصيد مرتجع الفاتورة الإضافية المسددة دون تحويله لتحصيل مشروع', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'إضافي' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'إضافي', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 2000, treasury: '1101', specificDocKey: `sale:${sale.id}` })
  S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'store_credit', reason: 'رصيد للعميل' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: -1000, balanceAfterMinor: 7000 })
})

it('يطابق فاتورة إضافية قديمة بلا وسم أو إعداد ضريبة محفوظ مع مرتجع مطابق للقيد', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'إضافي قديم' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'إضافي قديم', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  const ret = S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'credit', reason: 'مرتجع قديم' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })), sales: S().sales.map(row => ({ ...row, projectBilling: undefined, taxPercent: undefined, taxInclusive: undefined })), saleReturns: S().saleReturns.map(row => row.id === ret.id ? { ...row, cashRefundMinor: undefined, creditRefundMinor: undefined } : row) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
})

it('يستعيد سجل العميل المفقود وحده من نسخة مطابقة دون استبدال البيانات أو القيود', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const backup = JSON.stringify(buildBackup({ appState: null, storeState: { state: JSON.parse(JSON.stringify(useRawDataStore.getState())), version: 25 }, appDataVersion: 25, shopName: 'منشأة الاختبار' }))
  useRawDataStore.setState({ customers: [] })
  const beforeJournal = S().journal
  const preview = S().previewMissingProjectCustomerBackup(project.id, backup)
  expect(preview.customer).toMatchObject({ id: customer.id, nameAr: customer.nameAr })
  expect(preview.balanceMinor).toBe(8000)
  S().restoreMissingProjectCustomerBackup({ projectId: project.id, backup, fingerprint: preview.fingerprint, reason: 'مطابقة هوية الجهة والنسخة', confirmed: true })
  expect(S().journal).toBe(beforeJournal)
  expect(S().customers).toContainEqual(customer)
  expect(S().projects[0].clientId).toBe(customer.id)
  expect(S().getCustomerBalance(customer.id)).toBe(8000)
  expect(() => S().restoreMissingProjectCustomerBackup({ projectId: project.id, backup, fingerprint: preview.fingerprint, reason: 'تكرار', confirmed: true })).toThrow(/موجود/)
})

it('يرفض نسخة غير مطابقة أو مالكاً غير مخول واستعادة تغيرت بياناتها بعد الفحص', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const backup = JSON.stringify(buildBackup({ appState: null, storeState: { state: JSON.parse(JSON.stringify(useRawDataStore.getState())), version: 25 }, appDataVersion: 25, shopName: 'منشأة الاختبار' }))
  useRawDataStore.setState({ customers: [] })
  const preview = S().previewMissingProjectCustomerBackup(project.id, backup)
  const args = { projectId: project.id, backup, fingerprint: preview.fingerprint, reason: 'مطابقة', confirmed: true }
  expect(() => S().restoreMissingProjectCustomerBackup({ ...args, confirmed: false })).toThrow(/إقرار/)
  expect(() => S().previewMissingProjectCustomerBackup(project.id, backup.replace('منشأة الاختبار', 'نسخة أخرى').replace('"checksum":"', '"checksum":"x'))).toThrow(/بصمة/)
  useRawDataStore.setState({ openingBalances: { 'customer:123': 1 } })
  expect(() => S().restoreMissingProjectCustomerBackup(args)).toThrow(/تختلف/)
  expect(S().customers).toHaveLength(0)
  useRawDataStore.setState({ openingBalances: {}, appUsers: [{ id: 91, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }], currentUserId: 91 })
  expect(() => S().previewMissingProjectCustomerBackup(project.id, backup)).toThrow(/للمالك فقط/)
})

it('يرفض استعادة سجل عميل من نسخة إذا تغيرت بيانات عميل آخر', () => {
  const { customer, project } = legacy()
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'آخر', phone: '', creditLimitMinor: 0, notes: '' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const backup = JSON.stringify(buildBackup({ appState: null, storeState: { state: JSON.parse(JSON.stringify(useRawDataStore.getState())), version: 25 }, appDataVersion: 25, shopName: 'منشأة الاختبار' }))
  useRawDataStore.setState({ customers: S().customers.filter(c => c.id !== customer.id).map(c => ({ ...c, phone: '010' })) })
  expect(() => S().previewMissingProjectCustomerBackup(project.id, backup)).toThrow(/العملاء الأخرى/)
})

it('يعاين فاتورة إضافية معدلة بعد مطابقة سلسلة قيود العكس دون تعديل التاريخ', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'عمل إضافي معدل' })
  const line = { itemId, nameAr: 'عمل إضافي', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  const edited = S().editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 1500 }], customerId: customer.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 1500, balanceAfterMinor: 9500 })
  expect(p.evidence.some(e => e.description.includes('عكس تعديل'))).toBe(true)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة سلسلة التعديل', confirmed: true })
  expect(S().journal).toBe(journal)
  expect(edited.editHistory).toHaveLength(1)
})

it('يحجب تغيير أو فقد قيد عكس تعديل فاتورة إضافية', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], paymentTerminalTransactions: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة معدلة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  const edited = S().editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 1500 }], customerId: customer.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  const journal = S().journal
  const oldId = edited.editHistory![0].previousEntryId, reverseId = edited.editHistory![0].reversalEntryId
  useRawDataStore.setState({ journal: journal.filter(e => e.id !== reverseId) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفاتورة/)
  useRawDataStore.setState({ journal: journal.map(e => e.id === oldId ? { ...e, description: 'تغيرت بيانات القيد' } : e) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/تغير/)
  expect(S().projects[0].clientId).toBeNull()
})

it('لا يعيد استخدام رقم عميل باقٍ في مسودة فاتورة محفوظة كنص', () => {
  useRawDataStore.setState({ customers: [], advancedInvoiceDrafts: [{ id: 'draft-x', kind: 'sale', name: 'مسودة', payload: JSON.stringify({ customerId: 1 }), createdAt: '2025', updatedAt: '2025' }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل جديد', phone: '', creditLimitMinor: 0, notes: '' })
  expect(S().customers[0].id).toBe(2)
})

it('يستعيد عميل النسخة الفعلية ويصمد بعد حفظ SQLite وإعادة تحميل المتجر', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { ShopsysDatabase } = await import('../desktop/sqlite/storage.ts')
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-customer-recovery-'))
  try {
    const { customer, project } = legacy()
    useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
    await flushSecureStorageWrites('shopsys-data')
    const stored = await secureStorage.getItem('shopsys-data')
    const backup = JSON.stringify(buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'منشأة' }))
    useRawDataStore.setState({ customers: [] })
    const p = S().previewMissingProjectCustomerBackup(project.id, backup)
    S().restoreMissingProjectCustomerBackup({ projectId: project.id, backup, fingerprint: p.fingerprint, reason: 'مطابقة نسخة فعلية', confirmed: true })
    await flushSecureStorageWrites('shopsys-data')
    const saved = await secureStorage.getItem('shopsys-data')
    const path = join(dir, 'shopsys.db')
    const db = await ShopsysDatabase.open(path)
    db.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: saved! })
    db.close()
    const reopened = await ShopsysDatabase.open(path)
    const persisted = reopened.getSnapshot('shopsys-data').payloadJson
    reopened.close()
    useRawDataStore.setState({ customers: [], projects: [], projectExtracts: [], journal: [] })
    await flushSecureStorageWrites('shopsys-data')
    await secureStorage.setItem('shopsys-data', persisted!)
    await useRawDataStore.persist.rehydrate()
    expect(S().customers.find(row => row.id === customer.id)).toEqual(customer)
    expect(S().getCustomerBalance(customer.id)).toBe(8000)
    expect(S().auditLog.some(event => event.title.includes('استعادة سجل العميل المفقود'))).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('يرفض نقل مشروع أو مستخلصات صريحة بين فرعين بمجرد استعادة سجل العميل', () => {
  const { customer, project } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: null, customers: S().customers.map(c => ({ ...c, branchId: 2 })), projects: S().projects.map(p => ({ ...p, clientId: customer.id })) })
  const backup = JSON.stringify(buildBackup({ appState: null, storeState: { state: JSON.parse(JSON.stringify(useRawDataStore.getState())), version: 25 }, appDataVersion: 25, shopName: 'منشأة' }))
  useRawDataStore.setState({ customers: [] })
  expect(() => S().previewMissingProjectCustomerBackup(project.id, backup)).toThrow(/الفروع/)
  expect(S().customers).toHaveLength(0)
})

it('يمنع إصدار أو تعديل مستخلص فرع على عميل تابع لفرع آخر', () => {
  const { customer, project, extract } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 2 })), projects: S().projects.map(p => ({ ...p, clientId: customer.id, branchId: 1 })), projectExtracts: S().projectExtracts.map(e => ({ ...e, branchId: 1 })) })
  const before = useRawDataStore.getState()
  expect(() => S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 1000, vatPercent: 0, payment: 'credit' })).toThrow(/فرع|الفرع/)
  expect(() => S().editProjectExtract({ extractId: extract.id, grossMinor: 7000, vatPercent: 0, payment: 'credit', description: 'تعديل', reason: 'تصحيح' })).toThrow(/فرع|الفرع/)
  expect(() => S().refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'تصحيح' })).toThrow(/فرع|الفرع/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  useRawDataStore.setState({ activeBranchId: 2 })
  expect(() => S().getCustomerBalance(customer.id)).toThrow(/مراجعة/)
  expect(() => S().getOpenClientInvoices(customer.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ activeBranchId: null })
  expect(() => S().getCustomerBalance(customer.id)).toThrow(/مراجعة/)
})

it('يمنع إنشاء مشروع على عميل فرع آخر في الفرع أو العرض الشامل', () => {
  const { customer } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 2 })) })
  const input = { nameAr: 'مشروع آخر', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' }
  expect(() => S().addProject(input)).toThrow(/فرع|الفرع/)
  useRawDataStore.setState({ activeBranchId: null })
  expect(() => S().addProject(input)).toThrow(/فرع|الفرع/)
})


it('يسمح بمستخلصات كل فرع على عميله ويمنع الإصدار من فرع آخر', () => {
  const { customer, project } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 1 })), projects: S().projects.map(p => ({ ...p, clientId: customer.id, branchId: 1 })), projectExtracts: S().projectExtracts.map(e => ({ ...e, branchId: 1 })) })
  const add = () => S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 1000, vatPercent: 0, payment: 'credit' })
  useRawDataStore.setState({ activeBranchId: 2 })
  expect(add).toThrow(/الفرع/)
  useRawDataStore.setState({ activeBranchId: 1 })
  const extract = add()
  expect(useRawDataStore.getState().projectExtracts.find(e => e.id === extract.id)).toMatchObject({ branchId: 1 })
  expect(S().getCustomerBalance(customer.id)).toBe(9000)
  useRawDataStore.setState({ activeBranchId: 2 })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مستقل', phone: '', creditLimitMinor: 0, notes: '' })
  const secondCustomer = S().customers.at(-1)!
  const secondProject = S().addProject({ nameAr: 'مشروع الفرع الثاني', clientId: secondCustomer.id, clientName: secondCustomer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  S().addProjectExtract({ projectId: secondProject.id, description: 'آجل', grossMinor: 2000, vatPercent: 0, payment: 'credit' })
  expect(S().getCustomerBalance(secondCustomer.id)).toBe(2000)
  expect(S().customers.some(c => c.id === customer.id)).toBe(false)
  useRawDataStore.setState({ activeBranchId: null })
  expect(() => S().addProjectExtract({ projectId: secondProject.id, description: 'آجل', grossMinor: 1000, vatPercent: 0, payment: 'credit' })).toThrow(/الفرع/)
  useRawDataStore.setState({ activeBranchId: 1 })
  expect(S().getCustomerBalance(customer.id)).toBe(9000)
  expect(S().customers.some(c => c.id === secondCustomer.id)).toBe(false)
})


it('يحجب الحركة والحساب عند وجود مستخلص لفرع آخر داخل المشروع', () => {
  const { customer, project, extract } = legacy()
  const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
  const second = { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
  useRawDataStore.setState({ branches: [main, second], activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 1 })), projects: S().projects.map(p => ({ ...p, clientId: customer.id, branchId: 1 })), projectExtracts: S().projectExtracts.map(e => ({ ...e, branchId: 2 })) })
  const before = useRawDataStore.getState().journal
  expect(() => S().addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 1000, vatPercent: 0, payment: 'cash' })).toThrow(/الفروع/)
  expect(() => S().getCustomerBalance(customer.id)).toThrow(/الفروع/)
  useRawDataStore.setState({ activeBranchId: null })
  expect(() => S().refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'cash', reason: 'تصحيح' })).toThrow(/الفروع/)
  expect(useRawDataStore.getState().journal).toBe(before)
})

it('يطابق فاتورة إضافية برسوم خاضعة ومعفاة ومصروف مدفوع وإشعار مرتجع دون تغيير القيود', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [] })
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 10000, label: 'الخزينة' })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة مع رسوم' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: false, projectId: project.id, projectBilling: 'extra', customerCharges: [{ kind: 'shipping', nameAr: 'نقل', amountMinor: 200, taxable: true }, { kind: 'service', nameAr: 'إضافة معفاة', amountMinor: 100, taxable: false }], internalExpenses: [{ id: 'exp-1', label: 'مصروف', amountMinor: 150, accountCode: '5108', settlement: 'paid_now', treasury: '1101', taxTreatment: 'exclusive', taxPercent: 15, affectsProfit: true, landedCostAllocation: 'none' }] })
  S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'credit', reason: 'مرتجع خدمة' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(sale.totals.totalMinor).toBe(2630)
  expect(p).toMatchObject({ balanceBeforeMinor: 1480, balanceAfterMinor: 9480 })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة الفاتورة ومصروفاتها', confirmed: true })
  expect(S().journal).toBe(journal)
})

it('يرفض تلف رسوم أو قيد المصروف أو تغييرها بعد معاينة ربط المشروع', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [] })
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 10000, label: 'الخزينة' })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة برسوم' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 10, taxInclusive: false, projectId: project.id, projectBilling: 'extra', customerCharges: [{ kind: 'shipping', nameAr: 'نقل', amountMinor: 100, taxable: true }], internalExpenses: [{ id: 'exp-1', label: 'مصروف', amountMinor: 150, accountCode: '5108', settlement: 'paid_now', treasury: '1101', taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' }] })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  const sales = S().sales, journal = S().journal
  useRawDataStore.setState({ sales: sales.map(row => row.id === sale.id ? { ...row, customerCharges: [{ ...row.customerCharges![0], amountMinor: 101 }] } : row) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/الفاتورة|تغير/)
  useRawDataStore.setState({ sales, journal: journal.map(e => e.id === sale.journalEntryId ? { ...e, lines: e.lines.map(l => l.accountCode === '5108' ? { ...l, debit: l.debit + 1 } : l) } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/الفاتورة/)
  expect(S().projects.find(row => row.id === project.id)?.clientId).toBeNull()
})

it('يقبل إضافة رسم معفى في تعديل فاتورة بيع ويرفض الخصم الإضافي دون تعديلها', () => {
  const { customer } = legacy()
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة للفاتورة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 10, taxInclusive: false })
  const args = { saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit' as const, paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'إضافة رسم', einvoiceActive: false, allowNegativeStock: true }
  const edited = S().editSale({ ...args, customerCharges: [{ kind: 'other', nameAr: 'رسم معفى', amountMinor: 200, taxable: false }] })
  expect(edited.totals).toMatchObject({ taxBaseMinor: 1200, taxMinor: 100, totalMinor: 1300 })
  const entry = S().journal.find(row => row.id === edited.journalEntryId)!
  expect(entry.lines.find(row => row.accountCode === '4101')?.credit).toBe(1200)
  expect(S().getCustomerBalance(customer.id)).toBe(1300)
  const journal = S().journal
  expect(() => S().editSale({ ...args, customerCharges: [{ kind: 'discount', nameAr: 'خصم غير مدعوم', amountMinor: 100, taxable: false }] })).toThrow(/خصم/)
  expect(S().journal).toBe(journal)
})

it('يقبل تحصيلاً مختلطاً لفاتورة ذات رسم معفى ويطابق طرفي القيد', () => {
  const { customer } = legacy()
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة مختلطة' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', paymentAllocations: [{ accountCode: '1101', amountMinor: 400 }], invoiceDiscountPercent: 0, taxPercent: 10, taxInclusive: false, customerCharges: [{ kind: 'other', nameAr: 'رسم معفى', amountMinor: 200, taxable: false }] })
  const entry = S().journal.find(row => row.id === sale.journalEntryId)!
  expect(sale.totals).toMatchObject({ taxBaseMinor: 1200, taxMinor: 100, totalMinor: 1300 })
  expect(entry.lines.reduce((sum, row) => sum + row.debit, 0)).toBe(1300)
  expect(entry.lines.reduce((sum, row) => sum + row.credit, 0)).toBe(1300)
  expect(S().getCustomerBalance(customer.id)).toBe(900)
})

it('لا يخمن ضريبة فاتورة قديمة ذات رسوم عند المرتجع أو التعديل', () => {
  const { customer } = legacy()
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة قديمة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: false, customerCharges: [{ kind: 'other', nameAr: 'رسم معفى', amountMinor: 200, taxable: false }] })
  useRawDataStore.setState({ sales: S().sales.map(row => row.id === sale.id ? { ...row, taxPercent: undefined, taxInclusive: undefined } : row) })
  const journal = S().journal
  expect(() => S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'credit', reason: 'مرتجع' })).toThrow(/الضريبية/)
  expect(() => S().editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })).toThrow(/الضريبية/)
  expect(S().journal).toBe(journal)
})

it('لا يعدّل فاتورة محصلة على حساب موظف أو ينشئ التحصيل الموظفي عبر مسار التعديل', () => {
  const { customer } = legacy()
  S().addEmployee({ nameAr: 'موظف التحصيل', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const employee = S().employees.at(-1)!
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة محصلة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 500 }], invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  expect(S().getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(500)
  const journal = S().journal, advances = S().employeeAdvances
  const args = { saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit' as const, paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تعديل', einvoiceActive: false, allowNegativeStock: true }
  expect(() => S().editSale(args)).toThrow(/موظف/)
  expect(S().journal).toBe(journal)
  expect(S().employeeAdvances).toBe(advances)
  const ordinary = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  const before = S().journal
  expect(() => S().editSale({ ...args, saleId: ordinary.id, paidMinor: 500, paymentAllocations: [{ accountCode: '1107', amountMinor: 500 }] })).toThrow(/موظف/)
  expect(S().journal).toBe(before)
})

it('يراجع تحصيل الفاتورة الإضافية على موظف بعد مطابقة سجله دون نقل حسابه', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [], employeeAdvances: [], advanceRepayments: [] })
  S().addEmployee({ nameAr: 'محصل', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const employee = S().employees.at(-1)!
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 500 }], invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra' })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const advances = S().employeeAdvances, journal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 1500, balanceAfterMinor: 9500 })
  expect(p.evidence.some(item => item.description.includes('الموظف'))).toBe(true)
  useRawDataStore.setState({ employeeAdvances: advances.map(row => ({ ...row, recoveredMinor: 1 })) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })).toThrow(/الفاتورة|تغير/)
  useRawDataStore.setState({ employeeAdvances: advances })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة', confirmed: true })
  expect(S().employeeAdvances).toBe(advances)
  expect(S().journal).toBe(journal)
  expect(S().getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(500)
})

it('يطابق مصروف الفاتورة المستحق على حساب المصروفات المستحقة دون اعتباره دين عميل', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra', internalExpenses: [{ id: 'later', label: 'نقل داخلي', beneficiaryName: 'جهة النقل', amountMinor: 500, accountCode: '5108', settlement: 'payable_later', payableAccountCode: '2117', taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' }] })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const journal = S().journal
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 2000, balanceAfterMinor: 10000 })
  expect(journal.find(entry => entry.id === sale.journalEntryId)?.lines.some(line => line.accountCode === '2117' && line.credit === 500)).toBe(true)
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة المصروف', confirmed: true })
  expect(S().journal).toBe(journal)
})

it('لا يعدّل فاتورة محصلة بعملة أجنبية مع ترك ساق الصرف القديمة', () => {
  const { customer } = legacy()
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة عملة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 10000000, decimals: 2 }, bookCurrencyCode: 'EGP', bookDecimals: 2 })
  const journal = S().journal
  expect(() => S().editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })).toThrow(/عملة أجنبية/)
  expect(S().journal).toBe(journal)
  expect(S().sales.find(row => row.id === sale.id)?.fx).toEqual(sale.fx)
})

it('يراجع فاتورة إضافية محصلة بعملة أجنبية عند مطابقة ساق الصرف والقيد', () => {
  const { customer, project } = legacy()
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: customer.id })), sales: [], saleReturns: [] })
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة بعملة أجنبية' })
  const sale = S().postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'extra', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 10000000, decimals: 2 }, bookCurrencyCode: 'EGP', bookDecimals: 2 })
  useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, clientId: null })) })
  const p = S().previewLegacyProjectCustomer(project.id, customer.id)
  expect(p).toMatchObject({ balanceBeforeMinor: 1000, balanceAfterMinor: 9000 })
  expect(p.evidence.some(item => item.description.includes('USD'))).toBe(true)
  const journal = S().journal, sales = S().sales
  useRawDataStore.setState({ sales: sales.map(row => row.id === sale.id ? { ...row, fx: { ...row.fx!, ratePpm: 20000000 } } : row) })
  expect(() => S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة التحصيل', confirmed: true })).toThrow(/الفاتورة|العملة|تغير/)
  useRawDataStore.setState({ sales })
  S().resolveLegacyProjectCustomer({ projectId: project.id, customerId: customer.id, expectedDueMinor: p.dueMinor, fingerprint: p.fingerprint, reason: 'مطابقة التحصيل', confirmed: true })
  expect(S().journal).toBe(journal)
})

it('يرفض محرر الفاتورة توجيه تحصيلها إلى حساب غير خزينة', () => {
  const { customer } = legacy()
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const sale = S().postSale({ lines: [line], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  const journal = S().journal
  expect(() => S().editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 300, treasury: '1101', paymentAllocations: [{ accountCode: '4101', amountMinor: 300 }], invoiceDiscountPercent: 0, reason: 'تعديل', einvoiceActive: false, allowNegativeStock: true })).toThrow(/حساب التحصيل/)
  expect(S().journal).toBe(journal)
})
