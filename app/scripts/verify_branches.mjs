/**
 * 🏬 فحص دائم — الفروع الحقيقية (سد فجوة تدقيق المالك):
 * 1) إنشاء أول فرع: الرئيسي يتولد تلقائياً + الجديد بمخزنه وخزينته المولدين
 * 2) حد الفروع من الرخصة يُفرض (pro = 2)
 * 3) بيع من مخزن كل فرع إلى خزينته → مقارنة الفروع تعكس الأرقام الصحيحة
 *    (إيراد/تكلفة/مجمل ربح/رصيد خزينة/قيمة مخزون) من نفس الدفاتر
 * 4) تحويل بضاعة بين مخزني الفرعين + تحويل نقدية بين خزينتيهما بمستندات
 * 5) قواعد الصحة: منع مخزن مكرر بين فرعين / حذف الرئيسي وغيره قائم / فك آخر فرع
 *
 * تشغيل: node --experimental-strip-types scripts/verify_branches.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore, getBranchScopedDataState } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const { compareBranches, branchOfWarehouse, validateBranch, resolveBranchModules, resolveBranchActivityId } = await import(pathToFileURL(join(root, 'src/core/branches.ts')).href)
const { computeWarehouseStock, buildWarehouseDocs } = await import(pathToFileURL(join(root, 'src/core/transfers.ts')).href)
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const ITEM = { categoryId: 1, minQty: 0, warrantyMonths: 0, variantColors: [], variantSizes: [], sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 }

st().seed([])
st().addSupplier({ nameAr: 'مورد الفروع', phone: '', notes: '', ...EXT })
st().addItem({ nameAr: 'مياه معدنية', barcodes: ['100'], baseUnit: 'قطعة', extraUnits: [], priceMinor: 1000, ...ITEM })
const itemId = st().items[0].id

console.log('\n═══ 1) إنشاء أول فرع: الرئيسي يتولد + الجديد بمخزنه وخزينته ═══')
{
  assert.equal(st().branches.length, 0)
  const b = st().addBranch({ nameAr: 'فرع المعادي', warehouseId: 0, treasuryCode: '', createWarehouse: true, createTreasury: 'cash', managerName: 'أحمد' }, 2)
  assert.equal(st().branches.length, 2, 'فرعان: الرئيسي المتولد + الجديد')
  const main = st().branches.find((x) => x.isMain)
  assert.ok(main, 'الفرع الرئيسي تولد تلقائياً')
  assert.equal(main.warehouseId, st().warehouses.find((w) => w.isMain).id)
  assert.equal(main.treasuryCode, '1101')
  assert.ok(st().warehouses.some((w) => w.nameAr === 'مخزن فرع المعادي'), 'مخزن الفرع أُنشئ')
  assert.ok(st().treasuries.some((t) => t.code === b.treasuryCode && t.nameAr === 'خزينة فرع المعادي'), 'خزينة الفرع أُنشئت')
  ok('أول فرع: الرئيسي تولد على الرئيسيين والجديد بمخزنه وخزينته')
}

console.log('\n═══ 2) حد الفروع من الرخصة يُفرض ═══')
{
  assert.throws(
    () => st().addBranch({ nameAr: 'فرع ثالث', warehouseId: 0, treasuryCode: '', createWarehouse: true, createTreasury: 'cash' }, 2),
    /خطتك تسمح/,
    'الفرع الثالث فوق حد pro=2 يُرفض',
  )
  assert.equal(st().branches.length, 2)
  ok('حد الرخصة مفروض: الثالث فوق maxBranches=2 مرفوض برسالة عربية')
}

const branchNew = st().branches.find((b) => !b.isMain)
const mainBranch = st().branches.find((b) => b.isMain)
const whMain = mainBranch.warehouseId
const whNew = branchNew.warehouseId

console.log('\n═══ 3) بيع من كل فرع → المقارنة تعكس الدفاتر بدقة ═══')
{
  // شراء 100 قطعة بتكلفة 6.00 على المخزن الرئيسي (فرع رئيسي)
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-20T09:00:00.000Z', lines: [{ itemId, qty: 100, unitPriceMinor: 600 }], expenses: [], paidMinor: 60000, treasury: '1101', warehouseId: whMain, einvoiceActive: false })
  // تحويل 40 قطعة لمخزن فرع المعادي (تحويل بضاعة بين الفروع = مستند TRF)
  st().postTransfer({ fromWarehouseId: whMain, toWarehouseId: whNew, lines: [{ itemId, qty: 40 }], notes: 'تموين فرع المعادي' })
  const stock = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  assert.equal(stock.get(whMain).get(itemId), 60)
  assert.equal(stock.get(whNew).get(itemId), 40)
  ok('تحويل البضاعة بين الفروع: 60 بالرئيسي و40 بالمعادي')

  // بيع 10 من الرئيسي على خزينته + بيع 5 من المعادي على خزينته
  st().postSale({ lines: [{ itemId, nameAr: 'مياه معدنية', qty: 10, unitPriceMinor: 1000, discountPercent: 0, costMinor: 600 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: mainBranch.treasuryCode, warehouseId: whMain })
  st().postSale({ lines: [{ itemId, nameAr: 'مياه معدنية', qty: 5, unitPriceMinor: 1000, discountPercent: 0, costMinor: 600 }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: branchNew.treasuryCode, warehouseId: whNew })

  const balances = new Map()
  for (const e of st().journal) for (const l of e.lines) balances.set(l.accountCode, (balances.get(l.accountCode) ?? 0) + l.debit - l.credit)
  const stock2 = computeWarehouseStock(st().items, st().warehouses, st().transfers, buildWarehouseDocs(st().purchases, st().sales, st().saleReturns, st().purchaseReturns))
  const rows = compareBranches({
    branches: st().branches,
    sales: st().sales,
    saleReturns: st().saleReturns,
    saleWarehouseById: new Map(st().sales.map((s) => [s.id, s.warehouseId ?? null])),
    accountBalances: balances,
    warehouseStock: stock2,
    itemCostById: new Map(st().items.map((it) => [it.id, it.costMinor])),
  })
  const rMain = rows.find((r) => r.isMain)
  const rNew = rows.find((r) => !r.isMain)
  assert.equal(rMain.salesCount, 1)
  assert.equal(rMain.revenueMinor, 10000, 'إيراد الرئيسي 100.00')
  assert.equal(rMain.cogsMinor, 6000)
  assert.equal(rMain.grossProfitMinor, 4000)
  assert.equal(rNew.revenueMinor, 5000, 'إيراد المعادي 50.00')
  assert.equal(rNew.grossProfitMinor, 2000)
  // خزينة الرئيسي: −600.00 شراء +100.00 بيع = −500.00؛ خزينة المعادي: +50.00
  assert.equal(rMain.treasuryBalanceMinor, -50000)
  assert.equal(rNew.treasuryBalanceMinor, 5000)
  // مخزون: الرئيسي 50 × 6.00 = 300.00؛ المعادي 35 × 6.00 = 210.00
  assert.equal(rMain.stockValueMinor, 30000)
  assert.equal(rNew.stockValueMinor, 21000)
  ok('المقارنة مطابقة للدفاتر: إيراد/تكلفة/ربح/خزينة/مخزون لكل فرع')
}

console.log('\n═══ 4) تحويل نقدية بين خزينتي الفرعين بمستند سند ═══')
{
  st().postVoucher({ kind: 'transfer', date: '2026-09-20', treasury: branchNew.treasuryCode, counterAccountCode: '1101', amountMinor: 3000, description: 'توريد نقدية فرع المعادي للمركز' })
  const balances = new Map()
  for (const e of st().journal) for (const l of e.lines) balances.set(l.accountCode, (balances.get(l.accountCode) ?? 0) + l.debit - l.credit)
  assert.equal(balances.get(branchNew.treasuryCode), 2000, 'خزينة المعادي 50.00−30.00=20.00')
  assert.equal(balances.get('1101'), -47000, 'خزينة المركز −500.00+30.00=−470.00')
  ok('تحويل النقدية بين الفروع مستند سند موثق في اليومية')
}

console.log('\n═══ 5) قواعد الصحة ═══')
{
  // مخزن مربوط بفرع آخر يُرفض
  const errs = validateBranch({ nameAr: 'فرع مكرر', warehouseId: whNew, treasuryCode: '1102' }, st().branches, st().warehouses, st().treasuries)
  assert.ok(errs.some((e) => e.includes('مربوط بفرع آخر')), 'مخزن فرع قائم لا يُربط بفرع جديد')
  // نسبة مستند لفرعه
  assert.equal(branchOfWarehouse(whNew, st().branches).id, branchNew.id)
  assert.equal(branchOfWarehouse(null, st().branches).id, mainBranch.id, 'بلا مخزن = الفرع الرئيسي')
  // حذف الرئيسي وغيره قائم مرفوض
  assert.throws(() => st().removeBranch(mainBranch.id), /الرئيسي لا يُحذف/)
  // حذف الفرع الأخير غير الرئيسي يعيد وضع الفرع الواحد — والمخزن والخزينة باقيان
  st().removeBranch(branchNew.id)
  assert.equal(st().branches.length, 0, 'عاد وضع الفرع الواحد')
  assert.ok(st().warehouses.some((w) => w.id === whNew), 'مخزن الفرع المحذوف باقٍ بتاريخه')
  assert.ok(st().treasuries.some((t) => t.code === branchNew.treasuryCode), 'خزينة الفرع المحذوف باقية')
  ok('قواعد الصحة: منع التكرار + حماية الرئيسي + الحذف يفك الربط فقط')
}

console.log('\n═══ 6) تخصيص الأقسام والأنشطة لكل فرع (فرع مقاولات وفرع لوجستيات وفرع شامل) ═══')
{
  const companyModules = ['pos', 'inventory', 'purchases', 'contracting', 'logistics', 'equipment_rental']
  // إنشاء فرع مخصص للشحن واللوجستيات فقط
  const logisticsBranch = st().addBranch({
    nameAr: 'فرع الشحن واللوجستيات',
    warehouseId: 0,
    treasuryCode: '',
    createWarehouse: true,
    createTreasury: 'cash',
    customModulesMode: 'custom',
    enabledModules: ['logistics', 'inventory', 'purchases'],
    activityId: 'logistics',
  }, 5)
  const hqBranch = st().branches.find((x) => x.isMain)
  // تخصيص الفرع الرئيسي للمقاولات وإيجار المعدات
  st().updateBranch(hqBranch.id, {
    customModulesMode: 'custom',
    enabledModules: ['contracting', 'equipment_rental', 'inventory', 'purchases'],
    activityId: 'contracting',
  })
  const updatedHq = st().branches.find((x) => x.id === hqBranch.id)

  // العرض الشامل (null) يعيد كل أقسام الشركة
  assert.deepEqual(resolveBranchModules(null, companyModules), companyModules)
  assert.equal(resolveBranchActivityId(null, 'supermarket'), 'supermarket')

  // فرع المقاولات يعيد أقسام المقاولات والمعدات فقط
  assert.deepEqual(
    resolveBranchModules(updatedHq, companyModules),
    ['inventory', 'purchases', 'contracting', 'equipment_rental'],
  )
  assert.equal(resolveBranchActivityId(updatedHq, 'supermarket'), 'contracting')

  // فرع اللوجستيات يعيد أقسام اللوجستيات فقط
  assert.deepEqual(
    resolveBranchModules(logisticsBranch, companyModules),
    ['inventory', 'purchases', 'logistics'],
  )
  assert.equal(resolveBranchActivityId(logisticsBranch, 'supermarket'), 'logistics')

  // تبديل الفرع النشط في المخزن
  st().setActiveBranchId(logisticsBranch.id)
  assert.equal(st().activeBranchId, logisticsBranch.id)
  st().setActiveBranchId(null)
  assert.equal(st().activeBranchId, null)

  // رفض التخصيص بدون أي قسم
  const emptyCustomErrs = validateBranch(
    { nameAr: 'فرع فارغ الأقسام', warehouseId: whNew, treasuryCode: '1102', customModulesMode: 'custom', enabledModules: [] },
    st().branches,
    st().warehouses,
    st().treasuries,
  )
  assert.ok(emptyCustomErrs.some((e) => e.includes('اختر قسماً واحداً على الأقل')))
  ok('تخصيص الأقسام والأنشطة لكل فرع: شامل أو مخصص (مقاولات/لوجستيات) + تبديل الفرع النشط')

  console.log('\n═══ 7) عزل كل فرع كشركة مستقلة بالكامل (عملاء · موردون · موظفون · أصناف · مخازن · خزائن وبنوك · فواتير · يومية) ═══')
  // تفعيل فرع اللوجستيات كشركة مستقلة
  st().setActiveBranchId(logisticsBranch.id)
  let scoped = getBranchScopedDataState(st())
  assert.equal(scoped.customers.length, 0, 'الشركة/الفرع الجديد يبدأ بلا عملاء من الفرع الرئيسي')
  assert.equal(scoped.suppliers.length, 0, 'الشركة/الفرع الجديد يبدأ بلا موردين من الفرع الرئيسي')
  assert.equal(scoped.employees.length, 0, 'الشركة/الفرع الجديد يبدأ بلا موظفين من الفرع الرئيسي')
  assert.equal(scoped.items.length, 0, 'الشركة/الفرع الجديد يبدأ بلا أصناف من الفرع الرئيسي')
  assert.equal(scoped.warehouses.length, 1, 'يرى مخزنه الخاص فقط')
  assert.equal(scoped.warehouses[0].id, logisticsBranch.warehouseId)
  assert.equal(scoped.treasuries.length, 1, 'يرى خزينته الخاصة فقط')
  assert.equal(scoped.treasuries[0].code, logisticsBranch.treasuryCode)

  // إضافة عميل ومورد وموظف وبنك وصنف وفاتورة شراء وبيع داخل الفرع الثاني
  // (بما في ذلك اختبار قبول نفس الاسم المسجل بالفرع الأول دون تعارض بين الشركتين)
  st().addCustomer({ nameAr: 'عميل الشركة الثانية', phone: '01099999999', creditLimitMinor: 0, notes: '', ...EXT })
  st().addCustomer({ nameAr: 'عميل الفرع الرئيسي', phone: '01088888888', creditLimitMinor: 0, notes: '', ...EXT })
  st().addSupplier({ nameAr: 'مورد الشركة الثانية', phone: '01188888888', notes: '', ...EXT })
  st().addSupplier({ nameAr: 'مورد الفرع الرئيسي', phone: '01177777777', notes: '', ...EXT })
  st().addEmployee({ nameAr: 'موظف الشركة الثانية', phone: '01277777777', jobTitle: 'مدير تشغيل', hireDate: '2026-10-01', baseSalaryMinor: 800000, allowancesMinor: 0, active: true, notes: '', ...EXT })
  const branch2Bank = st().addTreasury('بنك الشركة الثانية', 'bank')
  st().addItem({ nameAr: 'صنف خاص بالشركة الثانية', barcodes: ['100'], baseUnit: 'قطعة', extraUnits: [], priceMinor: 2000, ...ITEM })

  scoped = getBranchScopedDataState(st())
  assert.equal(scoped.customers.length, 2, 'عميلان في الشركة الثانية (شامل اسم متطابق مع الشركة الأولى بلا تعارض)')
  assert.equal(scoped.customers[0].branchId, logisticsBranch.id)
  assert.equal(scoped.suppliers.length, 2)
  assert.equal(scoped.suppliers[0].branchId, logisticsBranch.id)
  assert.equal(scoped.employees.length, 1)
  assert.equal(scoped.employees[0].branchId, logisticsBranch.id)
  assert.equal(scoped.treasuries.length, 2, 'خزينة الفرع + البنك المضاف داخله')
  assert.equal(branch2Bank.branchId, logisticsBranch.id)
  assert.equal(scoped.items.length, 1, 'صنف الفرع الثاني مستقل حتى بنفس الباركود 100')
  assert.equal(scoped.items[0].branchId, logisticsBranch.id)

  // مشروع مقاولات + معدة إيجار + مركبة ونقلة داخل الشركة الثانية تتوجه تلقائياً لخزينة الشركة الثانية
  const proj2 = st().addProject({
    nameAr: 'مشروع الشركة الثانية',
    clientName: 'عميل الشركة الثانية',
    clientId: scoped.customers[0].id,
    contractValueMinor: 50000,
    retentionPercent: 0,
    startDate: '2026-10-01',
    notes: '',
  })
  const ext2 = st().addProjectExtract({
    projectId: proj2.id,
    grossMinor: 10000,
    vatPercent: 0,
    payment: 'cash',
    description: 'مستخلص أول للشركة الثانية',
  })
  scoped = getBranchScopedDataState(st())
  assert.equal(scoped.projects.length, 1)
  assert.equal(scoped.projectExtracts.length, 1)
  assert.equal(scoped.projectExtracts[0].id, ext2.id)

  // ربط حساب دخول موظف الشركة الثانية يقفل الجلسة على الشركة الثانية تلقائياً
  st().setOwnerPin('hashed-owner-pin')
  const b2User = st().addAppUser({
    nameAr: 'موظف الشركة الثانية',
    roleId: 'accountant',
    pinHash: 'hashed-user-pin',
    employeeId: scoped.employees[0].id,
  })
  assert.equal(b2User.branchId, logisticsBranch.id, 'حساب المستخدم يرث فرع الموظف تلقائياً')

  // شراء وبيع داخل الفرع الثاني يتوجهان تلقائياً لمخزن وخزينة الفرع الثاني
  const b2SupplierId = scoped.suppliers[0].id
  const b2CustomerId = scoped.customers[0].id
  const b2ItemId = scoped.items[0].id
  const pur2 = st().postPurchase({
    supplierId: b2SupplierId,
    date: '2026-10-01',
    lines: [{ itemId: b2ItemId, qty: 20, unitPriceMinor: 1000 }],
    expenses: [],
    paidMinor: 20000,
    treasury: '1101', // يُوجَّه تلقائياً لخزينة الفرع النشط
    einvoiceActive: false,
  })
  assert.equal(pur2.warehouseId, logisticsBranch.warehouseId)
  assert.equal(pur2.treasury, logisticsBranch.treasuryCode)

  const sale2 = st().postSale({
    lines: [{ itemId: b2ItemId, nameAr: 'صنف خاص بالشركة الثانية', qty: 5, unitPriceMinor: 2000, discountPercent: 0, costMinor: 1000 }],
    customerId: b2CustomerId,
    payment: 'cash',
    invoiceDiscountPercent: 0,
    taxPercent: 0,
    taxInclusive: true,
    treasury: '1101', // يُوجَّه تلقائياً لخزينة الفرع النشط
  })
  assert.equal(sale2.warehouseId, logisticsBranch.warehouseId)
  assert.equal(sale2.treasury, logisticsBranch.treasuryCode)

  scoped = getBranchScopedDataState(st())
  assert.equal(scoped.purchases.length, 1)
  assert.equal(scoped.sales.length, 1)
  // ميزان الفرع الثاني وحده متزن 100%
  const b2Debit = scoped.journal.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0)
  const b2Credit = scoped.journal.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0)
  assert.ok(b2Debit > 0 && b2Debit === b2Credit, 'يومية وميزان الشركة الثانية متزنان ومستقلان تماماً')

  // التبديل للفرع الرئيسي: لا يرى بيانات الشركة الثانية
  st().setActiveBranchId(hqBranch.id)
  const hqScoped = getBranchScopedDataState(st())
  assert.ok(!hqScoped.customers.some((c) => c.id === b2CustomerId), 'الفرع الرئيسي لا يرى عملاء الشركة الثانية')
  assert.ok(!hqScoped.suppliers.some((s) => s.id === b2SupplierId), 'الفرع الرئيسي لا يرى موردي الشركة الثانية')
  assert.ok(!hqScoped.items.some((i) => i.id === b2ItemId), 'الفرع الرئيسي لا يرى أصناف الشركة الثانية')
  assert.ok(!hqScoped.sales.some((s) => s.id === sale2.id), 'الفرع الرئيسي لا يرى مبيعات الشركة الثانية')

  // التبديل للعرض الشامل (كل الفروع): المالك يرى الشركتين معاً
  st().setActiveBranchId(null)
  const allScoped = getBranchScopedDataState(st())
  assert.ok(allScoped.customers.some((c) => c.id === b2CustomerId))
  assert.ok(allScoped.suppliers.some((s) => s.id === b2SupplierId))
  assert.equal(allScoped.items.length, 2)
  ok('عزل كامل لكل فرع كشركة مستقلة: عملاء وموردون وموظفون وأصناف ومخازن وخزائن وبنوك وفواتير ويومية متزنة')
}

console.log(`\n✅ فحص الفروع الحقيقية: ${pass} محطات — كلها خضراء\n`)
