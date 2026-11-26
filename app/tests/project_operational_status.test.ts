import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { draftFromCategory } from '../src/core/items.ts'
const data = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', allowNegativeTreasury: true, activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...data, currentUserId: null, loggedOut: false, activeBranchId: null, branches: [], customers: [], suppliers: [], projects: [], items: [], projectExtracts: [], projectCosts: [], clientAdvances: [], changeOrders: [], boqItems: [], journal: [], vouchers: [], purchases: [], sales: [], subContracts: [], dailyWorkers: [], dailyWorkRecords: [], warehouses: [] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', notes: '', creditLimitMinor: 0 })
 S().addItem({ ...draftFromCategory(undefined, 'HOLD'), nameAr: 'سلعة', costMinor: 100, priceMinor: 200, stockQty: 10, isService: true })
 S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 100000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
})
afterEach(() => { useRawDataStore.setState(data); useAppStore.setState(app) })

describe.each(['on_hold', 'cancelled', 'finished'] as const)('الحالة التشغيلية %s', status => {
 it('توقف المستخلص والتكلفة والمقدمة وأمر التغيير والشراء حتى العودة إلى جاري', () => {
  const project = S().projects[0]
  S().setProjectOperationalStatus({ projectId: project.id, expected: 'running', status, reason: 'قرار الإدارة' })
  const before = S()
  const operations = [
   () => S().addProjectExtract({ projectId: project.id, grossMinor: 1000, vatPercent: 0, payment: 'credit', description: 'أعمال' }),
   () => S().addProjectCost({ projectId: project.id, kind: 'other', amountMinor: 1000, payment: 'credit', description: 'تكلفة' }),
   () => S().receiveClientAdvance({ projectId: project.id, amountMinor: 1000, treasury: '1101' }),
   () => S().addChangeOrder({ projectId: project.id, titleAr: 'تغيير', amountMinor: 1000 }),
   () => S().postPurchase({ projectId: project.id, supplierId: 0, date: '2026-01-01', lines: [{ itemId: S().items[0].id, qty: 1, unitPriceMinor: 100 }], expenses: [], paidMinor: 100, notes: '' }),
  ]
  for (const operation of operations) { expect(operation).toThrow(/المشروع/); expect(S()).toBe(before) }
  expect(S().projects[0].status).toBe('active')
  expect(S().projects[0].operationalStatusHistory?.at(-1)).toMatchObject({ from: 'running', to: status, reason: 'قرار الإدارة' })
  S().setProjectOperationalStatus({ projectId: project.id, expected: status, status: 'running', reason: 'استئناف' })
  expect(S().addProjectExtract({ projectId: project.id, grossMinor: 1000, vatPercent: 0, payment: 'credit', description: 'أعمال' })).toBeTruthy()
 })
})
it('يرفض الحالة القديمة والسبب الفارغ وإعادة فتح الإقفال المالي', () => {
 const id = S().projects[0].id
 expect(() => S().setProjectOperationalStatus({ projectId: id, expected: 'on_hold', status: 'cancelled', reason: 'سبب' })).toThrow(/تغير/)
 expect(() => S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: ' ' })).toThrow(/سبب/)
 useRawDataStore.setState({ projects: [{ ...S().projects[0], status: 'completed' }] })
 expect(() => S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'running', reason: 'سبب' })).toThrow(/مقفل/)
})

it('يقبل تصحيح المستخلص القائم وفاتورة توثيقه أثناء التأجيل دون عمل جديد', () => {
 const id = S().projects[0].id, customer = S().customers[0]
 const ex = S().addProjectExtract({ projectId: id, grossMinor: 3000, vatPercent: 0, payment: 'credit', description: 'عمل سابق' })
 S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: 'تأجيل' })
 const edited = S().editProjectExtract({ extractId: ex.id, grossMinor: 2000, vatPercent: 0, payment: 'credit', description: 'تصحيح', reason: 'تصحيح أعمال سابقة' })
 expect(edited.totals.grossMinor).toBe(2000)
 const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'توثيق أعمال' })
 const sale = S().postSale({ lines: [{ itemId, nameAr: 'توثيق أعمال', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: id, projectBilling: 'documentation', extractIds: [ex.id] })
 expect(sale.projectBilling).toBe('documentation')
})
it('يرفض بغير صلاحية أو خارج الفرع أو بعد تسجيل الخروج', () => {
 const id = S().projects[0].id, change = () => S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: 'سبب' })
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '' }] })
 expect(change).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null, appUsers: [], loggedOut: true })
 expect(change).toThrow(/الدخول/)
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ loggedOut: false, branches, activeBranchId: 1, projects: S().projects.map(p => ({ ...p, branchId: 2 })) })
 expect(change).toThrow(/الفرع/)
})

it('يمنع شهادات الباطن والأوامر والبيع الإضافي لكنه يترك دفع شهادة سابقة', () => {
 const id = S().projects[0].id
 const sub = S().addSubContract({ projectId: id, contractorName: 'مقاول', scopeAr: 'أعمال', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01' })
 const cert = S().addSubCertificate({ contractId: sub.id, amountMinor: 1000, description: 'عمل سابق' })
 const order = S().addChangeOrder({ projectId: id, titleAr: 'زيادة', amountMinor: 100 })
 S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'cancelled', reason: 'توقف المشروع' })
 expect(() => S().addSubCertificate({ contractId: sub.id, amountMinor: 1000, description: 'عمل جديد' })).toThrow(/المشروع/)
 expect(() => S().setChangeOrderStatus(order.id, 'approved')).toThrow(/المشروع/)
 expect(() => S().addBoqItem({ projectId: id, code: '2', descriptionAr: 'بند', unit: 'م', qty: 1, unitPriceMinor: 100 })).toThrow(/المشروع/)
 const itemId = S().items[0].id
 expect(() => S().postSale({ projectId: id, lines: [{ itemId, nameAr: 'عمل', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: S().customers[0].id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })).toThrow(/المشروع/)
 S().paySubContractor({ contractId: sub.id, amountMinor: cert.netMinor, treasury: '1101' })
 expect(S().subPayments.at(-1)?.amountMinor).toBe(cert.netMinor)
})
it('يرفض شراء مشروع موقوف قبل إنشاء طلب اعتماد جديد', () => {
 const id = S().projects[0].id
 S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: 'تأجيل' })
 useAppStore.setState({ approvals: { enabled: true, scope: ['purchase'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
 useRawDataStore.setState({ currentUserId: 5, appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'cashier', pinHash: '', active: true }], docApprovals: [] })
 const before = S()
 expect(() => S().postPurchase({ projectId: id, supplierId: 0, date: '2026-01-01', lines: [{ itemId: S().items[0].id, qty: 1, unitPriceMinor: 100 }], expenses: [], paidMinor: 100, notes: '' })).toThrow(/المشروع/)
 expect(S().docApprovals).toBe(before.docApprovals)
})
it('يمنع زيادة التقدم أو تغيير أسس العقد مع إبقاء التصحيح الوصفي', () => {
 const id = S().projects[0].id
 const boq = S().addBoqItem({ projectId: id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 10, unitPriceMinor: 100 })
 const sub = S().addSubContract({ projectId: id, contractorName: 'مقاول', scopeAr: 'عمل', contractValueMinor: 1000, retentionPercent: 0, startDate: '2025-01-01' })
 const task = S().addProjectTask({ projectId: id, nameAr: 'مهمة', startDate: '2025-01-01', endDate: '2026-01-01', progressPercent: 0, boqItemId: boq.id })
 S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: 'تأجيل' })
 expect(() => S().updateBoqProgress(boq.id, 10)).toThrow(/المشروع/)
 expect(() => S().updateProjectTaskProgress(task.id, 10)).toThrow(/المشروع/)
 expect(() => S().updateBoqItem(boq.id, { qty: 20 })).toThrow(/المشروع/)
 expect(() => S().updateSubContract(sub.id, { contractValueMinor: 2000 })).toThrow(/المشروع/)
 expect(S().updateBoqItem(boq.id, { descriptionAr: 'تصحيح وصف' }).descriptionAr).toBe('تصحيح وصف')
})
it('الإقفال المالي القديم يمنع أعمالاً جديدة حتى لو غابت حالة التنفيذ', () => {
 const p = S().projects[0]
 useRawDataStore.setState({ projects: [{ ...p, status: 'completed' }] })
 expect(() => S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 1, unitPriceMinor: 100 })).toThrow(/المشروع/)
 expect(() => S().addSubContract({ projectId: p.id, contractorName: 'مقاول', scopeAr: 'عمل', contractValueMinor: 1000, retentionPercent: 0, startDate: '2025-01-01' })).toThrow(/المشروع/)
})
