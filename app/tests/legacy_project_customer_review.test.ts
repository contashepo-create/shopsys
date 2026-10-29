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

it('يرفض مشروعاً له رد أو مقدمة أو تخصيص محفوظ ولو لعميل آخر', () => {
  const { customer, project, extract } = legacy()
  const base = useRawDataStore.getState()
  useRawDataStore.setState({ clientAdvances: [{ id: 1, projectId: project.id, amountMinor: 1000, recoveredMinor: 0, date: '2025-01-01', journalEntryId: 20 }] })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/دفعات/)
  useRawDataStore.setState({ clientAdvances: [], projectExtracts: base.projectExtracts.map(e => e.id === extract.id ? { ...e, refundedMinor: 1000 } : e) })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/ردود/)
  useRawDataStore.setState({ projectExtracts: base.projectExtracts, vouchers: [{ id: 3, projectId: null, kind: 'receipt', partyKind: 'customer', partyId: customer.id + 9, allocations: [{ docKey: `extract:${extract.id}`, appliedMinor: 500 }] }] as never })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/تخصيصات/)
})

it('يرفض حساباً ذا حركات سابقة وحد ائتمان غير كاف ويقبل بعد تصحيحه', () => {
  const { customer, project } = legacy()
  S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'قبض سابق' })
  expect(() => S().previewLegacyProjectCustomer(project.id, customer.id)).toThrow(/حركات/)
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
    const { customer, project } = legacy()
    const preview = S().previewLegacyProjectCustomer(project.id, customer.id)
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
    expect(S().getCustomerBalance(customer.id)).toBe(8000)
    expect(S().projects.find(p => p.id === project.id)?.legacyCustomerResolution?.reason).toBe('مطابقة نسخة SQLite')
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
