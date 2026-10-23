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

const { useDataStore, useRawDataStore, getBranchScopedDataState } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const { useAppStore, branchIdentityMissingFields, resolveBranchAppSettings, resolveDocumentBranchAppSettings } = await import(pathToFileURL(join(root, 'src/stores/app.store.ts')).href)
const { hashPin } = await import(pathToFileURL(join(root, 'src/core/audit.ts')).href)
useAppStore.getState().updateSetup({ allowNegativeTreasury: true, shopName: 'المنشأة الأساسية', vatPercent: 14, taxInclusive: true, taxRegistrationStatus: 'registered' })
const { compareBranches, branchOfWarehouse, validateBranch, resolveBranchModules, resolveBranchActivityId } = await import(pathToFileURL(join(root, 'src/core/branches.ts')).href)
const { computeWarehouseStock, buildWarehouseDocs } = await import(pathToFileURL(join(root, 'src/core/transfers.ts')).href)
const { trialBalance } = await import(pathToFileURL(join(root, 'src/core/financialReports.ts')).href)
const st = () => useDataStore.getState()
const raw = () => useRawDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const ITEM = { categoryId: 1, minQty: 0, warrantyMonths: 0, variantColors: [], variantSizes: [], sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 }

st().seed([])
st().addCustomer({ nameAr: 'عميل الفرع الرئيسي', phone: '01010000000', creditLimitMinor: 0, notes: '', ...EXT })
const mainCustomerId = st().customers[0].id
st().addSupplier({ nameAr: 'مورد الفروع', phone: '', notes: '', ...EXT })
st().addItem({ nameAr: 'مياه معدنية', barcodes: ['100'], baseUnit: 'قطعة', extraUnits: [], priceMinor: 1000, ...ITEM })
const itemId = st().items[0].id
st().addEmployee({ nameAr: 'موظف الفرع الرئيسي', phone: '01211111111', jobTitle: 'محاسب', hireDate: '2026-09-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '', ...EXT })
const mainEmployeeId = st().employees[0].id
const mainPriceList = st().addPriceList('قائمة أسعار الرئيسي', 0)

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
  st().setActiveBranchId(branchNew.id)
  assert.equal(getBranchScopedDataState(st()).items.find((item) => item.id === itemId)?.stockQty, 40,
    'الفرع المستقبل يرى رصيده المحلي لا إجمالي مخزون الشركة')
  st().setActiveBranchId(mainBranch.id)
  assert.equal(getBranchScopedDataState(st()).items.find((item) => item.id === itemId)?.stockQty, 60,
    'الرئيسي يرى رصيد مخازنه المحلي فقط')
  st().setActiveBranchId(null)
  ok('تحويل البضاعة بين الفروع: 60 بالرئيسي و40 بالمعادي مع عزل كمية المخزون المعروضة')

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

  // تدقيق دفتر/ميزان كل فرع: جمع ميزاني الفروع يجب أن يعيد ميزان الشركة
  // حساباً بحساب، بلا قيد مكرر أو مفقود (خصوصاً الحساب المشترك 4101).
  // بعض القيود تُنسب بعلاقة مستندها/خزينتها بدلاً من ختم branchId عند العرض الشامل.
  const companyJournal = st().journal
  const companyTotals = new Map()
  for (const entry of companyJournal) for (const line of entry.lines) {
    const total = companyTotals.get(line.accountCode) ?? { debit: 0, credit: 0 }
    total.debit += line.debit; total.credit += line.credit
    companyTotals.set(line.accountCode, total)
  }
  const branchTotals = new Map()
  const scopedEntryIds = []
  for (const branch of st().branches.filter((row) => row.active)) {
    st().setActiveBranchId(branch.id)
    const scoped = getBranchScopedDataState(st())
    for (const entry of scoped.journal) {
      scopedEntryIds.push(entry.id)
      for (const line of entry.lines) {
        const total = branchTotals.get(line.accountCode) ?? { debit: 0, credit: 0 }
        total.debit += line.debit; total.credit += line.credit
        branchTotals.set(line.accountCode, total)
      }
    }
  }
  assert.equal(scopedEntryIds.length, companyJournal.length, 'كل قيد ظاهر في فرع واحد بالضبط')
  assert.equal(new Set(scopedEntryIds).size, companyJournal.length, 'لا قيد متكرر بين ميزاني الفروع')
  assert.deepEqual([...branchTotals.entries()].sort(), [...companyTotals.entries()].sort(), 'مجاميع كل حساب عبر الفروع تطابق ميزان الشركة')
  assert.equal(branchTotals.get('4101')?.credit, companyTotals.get('4101')?.credit, 'الحساب المشترك 4101 لا يتضخم عند جمع الفروع')
  st().setActiveBranchId(null)
  ok('مطابقة دفترية حساباً بحساب: لا قيد مفقود/مكرر، ومجموع أرصدة الفروع يساوي الشركة')
  ok('المقارنة مطابقة للدفاتر: إيراد/تكلفة/ربح/خزينة/مخزون لكل فرع')
}

console.log('\n═══ 4) تحويل نقدية بين خزينتي الفرعين بمستند سند ═══')
{
  st().postVoucher({ kind: 'transfer', date: '2026-09-20', treasury: branchNew.treasuryCode, counterAccountCode: '1101', amountMinor: 3000, description: 'توريد نقدية فرع المعادي للمركز' })
  const balances = new Map()
  for (const e of st().journal) for (const l of e.lines) balances.set(l.accountCode, (balances.get(l.accountCode) ?? 0) + l.debit - l.credit)
  assert.equal(balances.get(branchNew.treasuryCode), 2000, 'خزينة المعادي 50.00−30.00=20.00')
  assert.equal(balances.get('1101'), -47000, 'خزينة المركز −500.00+30.00=−470.00')
  const voucher = st().vouchers.at(-1)
  const pair = st().journal.filter((entry) => entry.interBranchTransferId === voucher.id)
  assert.equal(pair.length, 2, 'التحويل يُنشئ قيداً في دفتر كل فرع')
  assert.deepEqual(new Set(pair.map((entry) => entry.branchId)), new Set([mainBranch.id, branchNew.id]))
  assert.ok(pair.every((entry) => entry.lines.reduce((sum, line) => sum + line.debit, 0) === entry.lines.reduce((sum, line) => sum + line.credit, 0)), 'القيدان متوازنان منفردين')
  const consolidated = trialBalance(st().journal, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(consolidated.rows.some((row) => row.code === '1114' || row.code === '2118'), false, 'الرصيد البيني يُستبعد من التقرير المجمع بعد التحقق من اقتران القيدين')
  const reversed = st().reverseVoucher(voucher.id, 'اختبار عكس مزدوج')
  assert.ok(reversed.branchTransfer.destinationReversalEntryId, 'عكس السند يُنشئ قيد عكس ثانياً للفرع المقابل')
  assert.equal(st().journal.filter((entry) => entry.interBranchTransferId === voucher.id).length, 4, 'العكس يضيف قيدين ولا يمحو الأصل')
  ok('قيدان متوازنان مستقلان للتحويل، تسوية داخلية مستبعدة من التجميع، وعكس ذري مزدوج')
}

console.log('\n═══ 5) الأرصدة الافتتاحية: ملف ودفتر مستقلان لكل فرع ═══')
{
  const mainOpening = 125000
  const branchOpening = 287000
  st().setActiveBranchId(mainBranch.id)
  st().setOpeningBalance({ kind: 'treasury', refId: mainBranch.treasuryCode, amountMinor: mainOpening, label: 'افتتاحي خزينة الرئيسي' })
  const mainScope = getBranchScopedDataState(st())
  assert.equal(mainScope.openingBalances[`treasury:${mainBranch.treasuryCode}`], mainOpening)
  assert.ok(mainScope.journal.some((entry) => entry.sourceType === 'opening' && entry.branchId === mainBranch.id), 'قيد افتتاحي الرئيسي مختوم بالرئيسي')

  st().setActiveBranchId(branchNew.id)
  st().setOpeningBalance({ kind: 'treasury', refId: branchNew.treasuryCode, amountMinor: branchOpening, label: 'افتتاحي خزينة الفرع' })
  const branchScope = getBranchScopedDataState(st())
  assert.equal(branchScope.openingBalances[`treasury:${branchNew.treasuryCode}`], branchOpening)
  assert.equal(branchScope.openingBalances[`treasury:${mainBranch.treasuryCode}`], undefined, 'لا يقرأ افتتاحي خزينة الرئيسي')
  assert.ok(branchScope.journal.some((entry) => entry.sourceType === 'opening' && entry.branchId === branchNew.id), 'قيد افتتاحي الفرع مختوم بفرعه')
  assert.equal(raw().branchOpeningBalances[branchNew.id].openingBalances[`treasury:${branchNew.treasuryCode}`], branchOpening)
  assert.equal(raw().openingBalances[`treasury:${mainBranch.treasuryCode}`], mainOpening, 'افتتاحي الرئيسي محفوظ في ملفه')
  st().setActiveBranchId(null)
  ok('خزائن الفروع: رصيد الافتتاحي يُحفظ ويُرحّل بدفتر الفرع، لا يختلط بين الرئيسي والفرع')
}

console.log('\n═══ 6) سنوات مالية وإقفال مستقل لكل فرع ═══')
{
  const mainYear = { id: 901, branchId: mainBranch.id, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }
  const branchYear = { id: 902, branchId: branchNew.id, nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }
  useAppStore.setState({ fiscalYears: [mainYear, branchYear] })
  const postRevenue = (branch, amount) => {
    st().setActiveBranchId(branch.id)
    st().postManualEntry({
      date: '2025-06-30', description: `إيراد اختبار ${branch.nameAr}`,
      lines: [
        { accountCode: branch.treasuryCode, debit: amount, credit: 0, note: 'تحصيل' },
        { accountCode: '4101', debit: 0, credit: amount, note: 'إيراد' },
      ],
    })
  }
  postRevenue(mainBranch, 100000)
  postRevenue(branchNew, 250000)
  st().setActiveBranchId(mainBranch.id)
  const mainClose = st().closeFiscalYear(mainYear, [mainYear])
  st().setActiveBranchId(branchNew.id)
  const branchClose = st().closeFiscalYear(branchYear, [branchYear])
  const mainClosing = raw().journal.find((entry) => entry.id === mainClose.entryId)
  const branchClosing = raw().journal.find((entry) => entry.id === branchClose.entryId)
  assert.equal(mainClose.netProfitMinor, 100000)
  assert.equal(branchClose.netProfitMinor, 250000)
  assert.equal(mainClosing.branchId, mainBranch.id)
  assert.equal(branchClosing.branchId, branchNew.id)
  assert.equal(mainClosing.lines.find((line) => line.accountCode === '4101')?.debit, 100000)
  assert.equal(branchClosing.lines.find((line) => line.accountCode === '4101')?.debit, 250000)
  ok('فرعان لهما الفترة نفسها: قيد الإقفال مختوم بالفرع ويصفّر صافي دفتره فقط بلا خلط')
  st().setActiveBranchId(null)
}

console.log('\n═══ 7) قواعد الصحة ═══')
{
  // مخزن مربوط بفرع آخر يُرفض
  const errs = validateBranch({ nameAr: 'فرع مكرر', warehouseId: whNew, treasuryCode: '1102' }, st().branches, st().warehouses, st().treasuries)
  assert.ok(errs.some((e) => e.includes('مربوط بفرع آخر')), 'مخزن فرع قائم لا يُربط بفرع جديد')
  // نسبة مستند لفرعه
  assert.equal(branchOfWarehouse(whNew, st().branches).id, branchNew.id)
  assert.equal(branchOfWarehouse(null, st().branches).id, mainBranch.id, 'بلا مخزن = الفرع الرئيسي')
  // حذف الرئيسي وغيره قائم مرفوض
  assert.throws(() => st().removeBranch(mainBranch.id), /الرئيسي لا يُحذف/)
  // فرع له حركة تشغيلية لا يُحذف كي لا تُفقد نسبة مستنداته التاريخية؛ يُعطّل بدلاً منه.
  assert.throws(() => st().removeBranch(branchNew.id), /لا يمكن حذف فرع له مستخدمون أو سجلات تشغيلية/)
  assert.equal(st().branches.length, 2, 'الفرع ذو التاريخ التشغيلي باقٍ')
  assert.ok(st().warehouses.some((w) => w.id === whNew), 'مخزن الفرع محفوظ')
  assert.ok(st().treasuries.some((t) => t.code === branchNew.treasuryCode), 'خزينة الفرع محفوظة')
  ok('قواعد الصحة: منع التكرار + حماية الرئيسي + منع حذف الفرع ذي التاريخ التشغيلي')
}

console.log('\n═══ 8) تخصيص الأقسام والأنشطة لكل فرع (فرع مقاولات وفرع لوجستيات وفرع شامل) ═══')
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

  // الهوية القانونية وتصميم الطباعة مستقلان: الفرع الجديد يبدأ باسمه وببيانات قانونية فارغة.
  const mainIdentityBeforeBranchEdit = { ...useAppStore.getState().companySetup }
  const mainReceiptBeforeBranchEdit = { ...useAppStore.getState().baseReceipt }
  const mainReportPrintBeforeBranchEdit = { ...useAppStore.getState().baseReportPrint }
  const baseEinvoice = { ...useAppStore.getState().baseEinvoice }
  st().setActiveBranchId(logisticsBranch.id)
  const newBranchProfile = useAppStore.getState().branchBusinessProfiles[logisticsBranch.id]
  assert.equal(useAppStore.getState().setup.shopName, logisticsBranch.nameAr, 'الفرع الجديد يبدأ باسمه لا باسم المنشأة الرئيسية')
  assert.equal(useAppStore.getState().setup.phone, '', 'هاتف الفرع الجديد فارغ ولا يرث هاتف الرئيسي')
  assert.equal(useAppStore.getState().setup.commercialRegister, '', 'سجل الفرع الجديد فارغ ولا يرث سجل الرئيسي')
  assert.equal(useAppStore.getState().einvoice.taxNumber, '', 'رقم ضريبة الفرع الجديد فارغ ولا يرث الرئيسي')
  assert.equal(useAppStore.getState().einvoice.address, '', 'عنوان الممول للفرع الجديد فارغ')
  assert.equal(newBranchProfile.receipt.logoDataUrl, '', 'شعار الفرع الجديد لا ينسخ شعار الرئيسي')
  assert.deepEqual(newBranchProfile.receipt.headerLines, [], 'ترويسة الفرع الجديد لا تنسخ بيانات الرئيسي')

  useAppStore.getState().updateCompanyProfile({
    shopName: 'اسم فرع اللوجستيات', phone: '01090000000', email: 'branch@example.com',
    website: 'branch.example.com', city: 'المنصورة', street: 'شارع الجيش', buildingNo: '12',
    postalCode: '35511', poBox: '44', commercialRegister: 'CR-BR-22',
  })
  useAppStore.getState().updateTaxSettings({ vatPercent: 5, taxInclusive: false, taxRegistrationStatus: 'registered' })
  useAppStore.getState().updateSetup({ allowNegativeTreasury: false })
  useAppStore.getState().updateEinvoice({ taxNumber: '123456789', address: 'عنوان ضريبي فرعي' })
  useAppStore.getState().updateReceipt({
    shopName: 'اسم إيصال اللوجستيات', logoDataUrl: 'data:image/png;base64,branch-logo',
    headerLines: ['سطر فرع مستقل'], footerText: 'تذييل فرع مستقل',
  })
  useAppStore.getState().updateReportPrint({ headerLine: 'ترويسة تقرير فرعية', footerText: 'تذييل تقرير فرعي' })
  assert.equal(useAppStore.getState().setup.shopName, 'اسم فرع اللوجستيات')
  assert.equal(useAppStore.getState().setup.vatPercent, 5)
  assert.equal(useAppStore.getState().setup.allowNegativeTreasury, false)
  assert.equal(useAppStore.getState().einvoice.taxNumber, '123456789')
  assert.equal(useAppStore.getState().receipt.logoDataUrl, 'data:image/png;base64,branch-logo')
  assert.equal(useAppStore.getState().receipt.footerText, 'تذييل فرع مستقل')
  assert.ok(useAppStore.getState().reportPrint.headerLine.includes('ترويسة تقرير فرعية'))
  assert.ok(useAppStore.getState().reportPrint.headerLine.includes('CR-BR-22'))
  assert.ok(useAppStore.getState().reportPrint.headerLine.includes('123456789'))
  assert.deepEqual(useAppStore.getState().companySetup, mainIdentityBeforeBranchEdit, 'تعديل هوية الفرع لا يغير ملف الشركة الرئيسي')
  assert.deepEqual(useAppStore.getState().baseReceipt, mainReceiptBeforeBranchEdit, 'تعديل تصميم إيصال الفرع لا يغير إيصال الرئيسي')
  assert.deepEqual(useAppStore.getState().baseEinvoice, baseEinvoice, 'إعداد الضريبة الإلكترونية للفرع لا يغير الرئيسي')
  assert.deepEqual(useAppStore.getState().baseReportPrint, mainReportPrintBeforeBranchEdit, 'تصميم تقارير الفرع لا يغير إعدادات الرئيسي')

  st().setActiveBranchId(hqBranch.id)
  assert.equal(useAppStore.getState().setup.shopName, 'المنشأة الأساسية', 'اسم المنشأة الرئيسية الأصلي محفوظ')
  assert.equal(useAppStore.getState().setup.vatPercent, 14, 'ضريبة الفرع لا تغير ضريبة المنشأة الأساسية')
  assert.equal(useAppStore.getState().setup.phone, '', 'هوية الرئيسي لا تتغير بسبب تعديل الفرع')
  assert.deepEqual(useAppStore.getState().einvoice, baseEinvoice, 'رقم الضريبة الإلكترونية لا ينتقل بين الفروع')
  const resolvedBranchBWhileMainActive = resolveBranchAppSettings(useAppStore.getState(), logisticsBranch)
  assert.equal(resolvedBranchBWhileMainActive.setup.shopName, 'اسم فرع اللوجستيات', 'محلل فرع ب يعيد هويته بينما الرئيسي نشط')
  assert.equal(resolvedBranchBWhileMainActive.einvoice.taxNumber, '123456789')
  assert.equal(resolvedBranchBWhileMainActive.receipt.logoDataUrl, 'data:image/png;base64,branch-logo')
  const resolvedDocumentBWhileMainActive = resolveDocumentBranchAppSettings(
    useAppStore.getState(), { warehouseId: logisticsBranch.warehouseId }, st().branches, st().warehouses, st().treasuries,
  )
  assert.equal(resolvedDocumentBWhileMainActive.branch.id, logisticsBranch.id, 'مخزن المستند يحدد فرعه مستقلاً عن الفرع النشط')
  assert.equal(resolvedDocumentBWhileMainActive.setup.shopName, 'اسم فرع اللوجستيات')
  assert.deepEqual(branchIdentityMissingFields({ shopName: logisticsBranch.nameAr, city: '', street: '', phone: '', commercialRegister: '' }, { taxNumber: '' }), ['الرقم الضريبي', 'السجل التجاري', 'العنوان', 'الهاتف'])

  st().setActiveBranchId(logisticsBranch.id)
  assert.equal(useAppStore.getState().setup.shopName, 'اسم فرع اللوجستيات', 'إعدادات فرع اللوجستيات محفوظة عند العودة إليه')
  useAppStore.getState().updateSetup({ allowNegativeTreasury: true })
  st().setActiveBranchId(null)
  ok('هوية وإيصال وتقارير وضريبة مستقلة؛ بذرة بلا نسخ للرئيسي؛ محلل مستند B يعمل والرئيسي نشط')

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

  console.log('\n═══ 9) عزل كل فرع كشركة مستقلة بالكامل (عملاء · موردون · موظفون · أصناف · مخازن · خزائن وبنوك · فواتير · يومية) ═══')
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
  const branch2PriceList = st().addPriceList('قائمة أسعار الشركة الثانية', 0)

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

  // سجلات رئيسية تُستخدم للتأكد أن الإدخالات الجديدة لا تربط أبناء الفرع بسجلات أب من الشركة الأخرى.
  st().setActiveBranchId(hqBranch.id)
  const mainProject = st().addProject({
    nameAr: 'مشروع الفرع الرئيسي', clientName: 'عميل الفرع الرئيسي', clientId: mainCustomerId,
    contractValueMinor: 80000, retentionPercent: 0, startDate: '2026-10-01', notes: '',
  })
  const mainCustodyFile = st().openCustodyFile({
    employeeId: mainEmployeeId, projectId: mainProject.id, reason: 'عهدة اختبار الفرع الرئيسي', notes: '',
  })
  st().fundCustodyFile({
    fileId: mainCustodyFile.id, amountMinor: 5000, treasury: hqBranch.treasuryCode, description: 'رصيد اختبار عزل الفروع',
  })
  // مستند حقيقي في الرئيسي لكشف أي getter يتجاوز مصفوفات الحالة المعزولة.
  const mainSale = st().postSale({
    lines: [{ itemId, nameAr: 'مياه معدنية', qty: 1, unitPriceMinor: 1000, discountPercent: 0, costMinor: 600 }],
    customerId: mainCustomerId, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0,
    taxInclusive: true, treasury: hqBranch.treasuryCode, warehouseId: hqBranch.warehouseId,
  })

  // حسابات الدخول بفرعين؛ الموظف في الفرع الثاني يجب ألا يرى/يعدل مستخدم الفرع الرئيسي أو بياناته.
  st().setActiveBranchId(null)
  const globalRoleId = st().addCustomRole('دور عام للشركة', 'accountant')
  st().updateOwnerProfile({ nameAr: 'هوية المالك السرية', phone: '01012345678' })
  const ownerPinHash = await hashPin('owner-123')
  const branchPinHash = await hashPin('branch-123')
  st().setOwnerPin(ownerPinHash)
  const mainUser = st().addAppUser({ nameAr: 'محاسب الرئيسي', roleId: 'accountant', pinHash: await hashPin('main-123'), branchId: hqBranch.id })
  const b2User = st().addAppUser({
    nameAr: 'موظف الشركة الثانية',
    roleId: 'accountant',
    pinHash: branchPinHash,
    employeeId: scoped.employees[0].id,
  })
  assert.equal(b2User.branchId, logisticsBranch.id, 'حساب المستخدم يرث فرع الموظف تلقائياً')
  st().setActiveBranchId(logisticsBranch.id)
  await st().login(b2User.id, 'branch-123')
  scoped = getBranchScopedDataState(st())
  assert.ok(scoped.appUsers.some((user) => user.id === b2User.id))
  assert.ok(!scoped.appUsers.some((user) => user.id === mainUser.id), 'مستخدم الرئيسي غير مرئي لفرع اللوجستيات')
  assert.ok(!scoped.appUsers.some((user) => user.roleId === 'owner'), 'حساب المالك وتجزئة رقمه لا يخرجان إلى مستخدم الفرع')
  assert.equal(scoped.ownerPinHash, null)
  assert.equal(scoped.ownerTempPin, null)
  assert.notEqual(scoped.ownerProfile.nameAr, 'هوية المالك السرية')
  assert.ok(scoped.customRoles.some((role) => role.id === globalRoleId), 'الدور العام ظاهر للقراءة فقط')
  assert.ok(!scoped.customers.some((customer) => customer.id === mainCustomerId), 'عميل الرئيسي غير مرئي لفرع اللوجستيات')
  assert.deepEqual(scoped.priceLists.map((list) => list.id), [branch2PriceList.id], 'قائمة الأسعار محصورة بفرعها')
  const branch2ItemForIsolation = scoped.items[0].id
  assert.throws(() => st().setPriceListEntry(mainPriceList.id, branch2ItemForIsolation, 1200), /القائمة غير موجودة في هذا الفرع/)
  assert.throws(() => st().setPriceListEntry(branch2PriceList.id, itemId, 1200), /الصنف غير موجود في هذا الفرع/)
  assert.throws(() => st().setPriceListCategoryRule(mainPriceList.id, 1, 5), /القائمة غير موجودة في هذا الفرع/)
  assert.throws(() => st().setCustomerPriceList(mainCustomerId, branch2PriceList.id), /العميل غير موجود في هذا الفرع/)
  assert.throws(() => st().setEmployeeShift(mainEmployeeId, { startMin: 480, endMin: 960, graceMinutes: 10 }), /تابع لفرع آخر/)
  assert.throws(() => st().setVariantStock(itemId, 'أحمر', 'M', 1), /الصنف غير موجود في هذا الفرع/)
  assert.throws(() => st().setJewelryProfile({ itemId }), /الصنف غير موجود في هذا الفرع/)
  assert.throws(() => st().removeJewelryProfile(itemId), /الصنف غير موجود في هذا الفرع/)
  assert.throws(() => st().addPromotion({
    nameAr: 'عرض عابر للفروع', components: [{ itemId, qty: 1 }, { itemId: branch2ItemForIsolation, qty: 1 }],
    bundlePriceMinor: 1000, startIso: '', endIso: '', isActive: true,
  }), /مكوّن غير موجود/)
  st().setPriceListEntry(branch2PriceList.id, branch2ItemForIsolation, 1800)
  assert.equal(getBranchScopedDataState(st()).priceListEntries.find((entry) => entry.listId === branch2PriceList.id)?.priceMinor, 1800,
    'تظل كتابة قائمة أسعار الفرع نفسه مسموحة')
  const { canManageConflictSnapshots, listConflictSnapshots, getConflictSnapshotData, restoreConflictSnapshot } = await import(pathToFileURL(join(root, 'src/data/syncRunner.ts')).href)
  const testSnapshotAt = '2026-10-20T12:00:00.000Z'
  mem.set('shopsys-conflict-snapshots', JSON.stringify([{ at: testSnapshotAt, data: '{}' }]))
  assert.equal(canManageConflictSnapshots(), false, 'مستخدم الفرع لا يملك صلاحية التعامل مع لقطات المتجر الكاملة')
  assert.deepEqual(await listConflictSnapshots(), [])
  assert.equal(await getConflictSnapshotData(testSnapshotAt), null)
  const deniedRestore = await restoreConflictSnapshot(testSnapshotAt)
  assert.equal(deniedRestore.ok, false)
  assert.match(deniedRestore.message, /للمالك فقط/)
  assert.equal(st().getCustomerBalance(mainCustomerId), 0, 'رصيد العميل الرئيسي لا يتسرب عبر getter')
  assert.deepEqual(st().getCustomerStatementRows(mainCustomerId), [], 'كشف العميل الرئيسي لا يتسرب عبر getter')
  assert.deepEqual(st().getOpenClientInvoices(mainCustomerId), [], 'الفواتير المفتوحة للرئيسي لا تتسرب عبر getter')
  st().markNotificationRead('branch-only-notification')
  assert.ok(st().readNotificationIds.includes('branch-only-notification'))
  assert.throws(() => st().addCustomRole('دور بلا صلاحية', 'accountant'), /تتطلب صلاحية «المستخدمون والصلاحيات»/)
  st().logout()
  await st().login(null, 'owner-123')
  st().setUserPermExceptions(b2User.id, ['set.users'], [])
  st().setActiveBranchId(logisticsBranch.id)
  await st().login(b2User.id, 'branch-123')
  scoped = getBranchScopedDataState(st())
  const branchRoleId = st().addCustomRole('دور خاص باللوجستيات', 'accountant')
  st().setRolePermissions(branchRoleId, ['inv.view', 'set.users'])
  assert.equal(scoped.customRoles.find((role) => role.id === branchRoleId), undefined, 'اللقطة السابقة لا تتغير بعد الإضافة')
  scoped = getBranchScopedDataState(st())
  assert.equal(scoped.customRoles.find((role) => role.id === branchRoleId)?.branchId, logisticsBranch.id)
  assert.throws(() => st().renameCustomRole(globalRoleId, 'تعديل عام من الفرع'), /الدور عام على الشركة/)
  assert.throws(() => st().removeCustomRole(globalRoleId), /الدور عام على الشركة/)
  assert.throws(() => st().addCustomAccount({}), /دليل الحسابات العام متاحة للمالك فقط/)
  assert.throws(() => st().setRolePermissions('custom_9999', ['owner']), /الدور غير موجود في نطاق هذا الفرع/)
  assert.throws(() => useDataStore.setState({ loggedOut: false }), /تحديث الحالة الكاملة غير مسموح/)
  assert.throws(() => st().updateCustomer(mainCustomerId, { notes: 'تعديل عابر للفروع' }), /فرع آخر/)
  assert.throws(() => st().updateAppUser(mainUser.id, { nameAr: 'تعديل عابر للفروع' }), /فرع آخر/)
  assert.throws(() => st().renameTreasury(hqBranch.treasuryCode, 'خزينة مخترقة'), /غير موجودة في هذا الفرع/)
  assert.throws(() => st().postTransfer({ fromWarehouseId: logisticsBranch.warehouseId, toWarehouseId: hqBranch.warehouseId, lines: [], notes: '' }), /المخزن المستقبل غير موجود في هذا الفرع/)
  assert.throws(() => st().setOwnerPin('new-owner-pin'), /متاح للمالك فقط/)
  const companyIdentityBeforeBranchEdit = { ...useAppStore.getState().companySetup }
  useAppStore.getState().updateCompanyProfile({ shopName: 'هوية فرع اللوجستيات' })
  assert.equal(useAppStore.getState().setup.shopName, 'هوية فرع اللوجستيات')
  assert.deepEqual(useAppStore.getState().companySetup, companyIdentityBeforeBranchEdit, 'تعديل هوية الفرع لا يغير ملف المنشأة الرئيسية')

  // حراس علاقة الأب: لا يكفي ختم السجل الجديد بفرعه إذا كان يشير إلى موظف/مشروع/عهدة من شركة أخرى.
  const custodyTxCountBefore = st().custodyTxs.length
  const projectExtractCountBefore = st().projectExtracts.length
  const payrollRunCountBefore = st().payrollRuns.length
  assert.throws(() => st().openCustodyFile({
    employeeId: mainEmployeeId, projectId: null, reason: 'ربط موظف من فرع آخر', notes: '',
  }), /فرع آخر/)
  assert.throws(() => st().postPayroll({
    month: '2026-11', payMode: 'cash', treasury: logisticsBranch.treasuryCode, notes: 'اختبار عزل الموظف',
    lines: [{ employeeId: mainEmployeeId, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }],
  }), /فرع آخر/)
  assert.throws(() => st().addProjectExtract({
    projectId: mainProject.id, grossMinor: 1000, vatPercent: 0, payment: 'cash', description: 'ربط مشروع من فرع آخر',
  }), /فرع آخر/)
  assert.throws(() => st().fundCustodyFile({
    fileId: mainCustodyFile.id, amountMinor: 1000, treasury: hqBranch.treasuryCode, description: 'محاولة تعزيز عابرة للفروع',
  }), /فرع آخر/)
  assert.throws(() => st().addProjectCost({
    projectId: proj2.id, kind: 'other', amountMinor: 1000, payment: 'cash', paidMinor: 1000,
    custodyFileId: mainCustodyFile.id, description: 'ربط عهدة من فرع آخر',
  }), /فرع آخر|غير موجود في هذا الفرع/)
  assert.equal(st().custodyTxs.length, custodyTxCountBefore, 'رفض علاقة الأب لا يترك حركة عهدة جزئية')
  assert.equal(st().projectExtracts.length, projectExtractCountBefore, 'رفض المشروع الأجنبي لا ينشئ مستخلصاً')
  assert.equal(st().payrollRuns.length, payrollRunCountBefore, 'رفض الموظف الأجنبي لا ينشئ مسيراً')
  ok('حساب الفرع لا يقرأ أو يعدل بيانات فرع آخر، وحراس العلاقات تمنع ربط موظف/مشروع/عهدة أجنبية ذرياً')

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

  // بعد فحص حراسة المستخدم الفرعي، نعود إلى المالك لعرض مقارنة الفروع.
  st().logout()
  await st().login(null, 'owner-123')
  assert.equal(canManageConflictSnapshots(), true, 'المالك وحده يدير لقطات التعارض')
  assert.ok((await listConflictSnapshots()).some((snapshot) => snapshot.at === testSnapshotAt))
  assert.equal(await getConflictSnapshotData(testSnapshotAt), '{}')
  const ownerRestore = await restoreConflictSnapshot(testSnapshotAt)
  assert.equal(ownerRestore.ok, true, 'استعادة لقطة المتجر تبقى متاحة للمالك')
  st().logout()
  assert.equal(canManageConflictSnapshots(), false, 'لا تُتاح اللقطة بعد تسجيل خروج المالك')
  await st().login(null, 'owner-123')
  // التبديل للفرع الرئيسي: لا يرى بيانات الشركة الثانية
  st().setActiveBranchId(hqBranch.id)
  const hqScoped = getBranchScopedDataState(st())
  assert.ok(!hqScoped.customRoles.some((role) => role.id === branchRoleId), 'الدور المخصص للوجستيات غير مرئي في الرئيسي')
  assert.ok(hqScoped.customRoles.some((role) => role.id === globalRoleId), 'الدور العام يظل متاحاً للقراءة في الفروع')
  assert.ok(!hqScoped.readNotificationIds.includes('branch-only-notification'), 'علامة قراءة إشعار الفرع لا تتداخل مع الرئيسي')
  assert.equal(st().getOpenClientInvoices(mainCustomerId).filter((invoice) => invoice.docKey === `sale:${mainSale.id}`).length, 1, 'المالك يرى فاتورة العميل في الفرع الرئيسي')
  assert.ok(!hqScoped.customers.some((c) => c.id === b2CustomerId), 'الفرع الرئيسي لا يرى عملاء الشركة الثانية')
  assert.ok(!hqScoped.suppliers.some((s) => s.id === b2SupplierId), 'الفرع الرئيسي لا يرى موردي الشركة الثانية')
  assert.ok(!hqScoped.items.some((i) => i.id === b2ItemId), 'الفرع الرئيسي لا يرى أصناف الشركة الثانية')
  assert.ok(!hqScoped.sales.some((s) => s.id === sale2.id), 'الفرع الرئيسي لا يرى مبيعات الشركة الثانية')

  // التبديل للعرض الشامل (كل الفروع): المالك يرى الشركتين معاً
  st().setActiveBranchId(null)
  const allScoped = getBranchScopedDataState(st())
  assert.ok(allScoped.customRoles.some((role) => role.id === globalRoleId))
  assert.ok(allScoped.customRoles.some((role) => role.id === branchRoleId))
  assert.ok(!allScoped.readNotificationIds.includes('branch-only-notification'), 'علامة القراءة تظل خاصة بمستخدم الفرع')
  assert.ok(allScoped.customers.some((c) => c.id === b2CustomerId))
  assert.ok(allScoped.suppliers.some((s) => s.id === b2SupplierId))
  assert.equal(allScoped.items.length, 2)
  ok('عزل كامل لكل فرع كشركة مستقلة: عملاء وموردون وموظفون وأصناف ومخازن وخزائن وبنوك وفواتير ويومية متزنة')
}

console.log(`\n✅ فحص الفروع الحقيقية: ${pass} محطات — كلها خضراء\n`)
