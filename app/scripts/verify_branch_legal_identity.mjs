/**
 * بوابة سلوكية — الهوية القانونية والطباعة المستقلة لكل فرع.
 * التشغيل: node --experimental-strip-types scripts/verify_branch_legal_identity.mjs
 */
import assert from 'node:assert/strict'

const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener() {}, dispatchEvent() { return true } }

const { useAppStore, branchIdentityMissingFields, resolveBranchAppSettings, resolveDocumentBranchAppSettings } = await import('../src/stores/app.store.ts')
const { branchOfRecord } = await import('../src/core/branches.ts')

let passed = 0
const check = (label, assertion) => { assertion(); passed += 1; console.log(`  ✓ ${label}`) }

const store = useAppStore.getState()
store.updateSetup({
  completed: true,
  countryCode: 'EG',
  activityId: 'supermarket',
  shopName: 'الشركة الرئيسية',
  ownerName: 'مالك الشركة',
  phone: '01000000000',
  email: 'main@example.com',
  website: 'main.example.com',
  city: 'القاهرة',
  street: 'شارع الرئيسي',
  buildingNo: '1',
  postalCode: '11111',
  poBox: '10',
  commercialRegister: 'CR-MAIN',
  vatPercent: 14,
  taxInclusive: true,
  taxRegistrationStatus: 'registered',
})
store.updateCompanyProfile({ shopName: 'الشركة الرئيسية' })
assert.equal(useAppStore.getState().baseReceipt.shopName, 'الشركة الرئيسية', 'اسم الرئيسي يزامن قالب إيصال الرئيسي')
store.updateEinvoice({ taxNumber: 'MAIN-TAX-001', address: 'عنوان الممول الرئيسي' })
store.updateReceipt({
  shopName: 'الشركة الرئيسية',
  logoDataUrl: 'data:image/png;base64,main-logo',
  headerLines: ['بيانات المنشأة الرئيسية'],
  footerText: 'تذييل الشركة الرئيسية',
})
store.updateReportPrint({ headerLine: 'ترويسة تقرير الرئيسي', footerText: 'تذييل تقرير الرئيسي', watermarkEnabled: true, watermarkText: 'الرئيسي' })

const mainSetupBefore = structuredClone(useAppStore.getState().companySetup)
const mainReceiptBefore = structuredClone(useAppStore.getState().baseReceipt)
const mainEinvoiceBefore = structuredClone(useAppStore.getState().baseEinvoice)
const mainReportBefore = structuredClone(useAppStore.getState().baseReportPrint)
const branch = {
  id: 77,
  nameAr: 'مركز المنصورة',
  isMain: false,
  active: true,
  warehouseId: 770,
  treasuryCode: '1177',
  customModulesMode: 'all',
  enabledModules: [],
  activityId: null,
}
const main = {
  id: 1,
  nameAr: 'الشركة الرئيسية',
  isMain: true,
  active: true,
  warehouseId: 10,
  treasuryCode: '1101',
  customModulesMode: 'all',
  enabledModules: [],
  activityId: null,
}
const branches = [main, branch]
const warehouses = [{ id: 10, nameAr: 'المخزن الرئيسي', isMain: true }, { id: 770, nameAr: 'مخزن مركز المنصورة', branchId: 77 }]
const treasuries = [{ code: '1101', nameAr: 'الخزينة الرئيسية' }, { code: '1177', nameAr: 'خزينة مركز المنصورة', branchId: 77 }]

useAppStore.getState().setActiveBranchContext(branch)
let active = useAppStore.getState()
check('هوية الفرع الجديد تبدأ باسمه، لا باسم الشركة الرئيسية', () => assert.equal(active.setup.shopName, 'مركز المنصورة'))
check('الهوية القانونية الجديدة (اتصال/عنوان/سجل) تبدأ فارغة', () => {
  for (const key of ['phone', 'email', 'website', 'city', 'street', 'buildingNo', 'postalCode', 'poBox', 'commercialRegister']) {
    assert.equal(active.setup[key] ?? '', '', `${key} لا يُنسخ من الرئيسي`)
  }
})
check('رقم الضريبة وعنوان الممول لا ينسخان إلى الفرع', () => {
  assert.equal(active.einvoice.taxNumber, '')
  assert.equal(active.einvoice.address, '')
  assert.equal(active.einvoice.enabled, mainEinvoiceBefore.enabled, 'تفضيل الميزة فقط مسموح نسخه')
})
check('الشعار والترويسة والنصوص ذات الهوية لا تنتقل من الرئيسي', () => {
  assert.equal(active.receipt.logoDataUrl, '')
  assert.deepEqual(active.receipt.headerLines, [])
  assert.equal(active.receipt.shopName, 'مركز المنصورة')
  assert.notEqual(active.receipt.footerText, mainReceiptBefore.footerText)
  assert.equal(active.reportPrint.headerLine, '')
  assert.equal(active.reportPrint.footerText, '')
  assert.equal(active.reportPrint.watermarkText, '')
})

useAppStore.getState().updateCompanyProfile({
  shopName: 'منشأة مركز المنصورة',
  phone: '01077777777',
  email: 'branch@example.com',
  website: 'branch.example.com',
  city: 'المنصورة',
  street: 'شارع الجمهورية',
  buildingNo: '22',
  postalCode: '35516',
  poBox: '77',
  commercialRegister: 'CR-BRANCH-77',
})
useAppStore.getState().updateEinvoice({ taxNumber: 'BRANCH-TAX-077', address: 'عنوان الممول الفرعي' })
useAppStore.getState().updateReceipt({
  shopName: 'منشأة مركز المنصورة',
  logoDataUrl: 'data:image/png;base64,branch-logo',
  headerLines: ['نص خاص بفرع المنصورة'],
  footerText: 'تذييل الفرع',
})
useAppStore.getState().updateReportPrint({ headerLine: 'ترويسة تقرير الفرع', footerText: 'تذييل تقرير الفرع', watermarkText: 'الفرع' })
active = useAppStore.getState()
check('تحديث الهوية القانونية يحفظ على ملف الفرع الفعال', () => {
  assert.equal(active.setup.shopName, 'منشأة مركز المنصورة')
  assert.equal(active.setup.commercialRegister, 'CR-BRANCH-77')
  assert.equal(active.einvoice.taxNumber, 'BRANCH-TAX-077')
})
check('تحديث تصميم الإيصال/التقرير والشعار يحفظ في الفرع وحده', () => {
  assert.equal(active.receipt.logoDataUrl, 'data:image/png;base64,branch-logo')
  assert.equal(active.receipt.footerText, 'تذييل الفرع')
  assert.ok(active.reportPrint.headerLine.includes('ترويسة تقرير الفرع'))
  assert.ok(active.reportPrint.headerLine.includes('BRANCH-TAX-077'))
  assert.ok(active.reportPrint.headerLine.includes('CR-BRANCH-77'))
  assert.equal(active.reportPrint.watermarkText, 'الفرع')
})
check('بيانات الشركة الرئيسية تبقى كما كانت بعد جميع تعديلات الفرع', () => {
  assert.deepEqual(active.companySetup, mainSetupBefore)
  assert.deepEqual(active.baseReceipt, mainReceiptBefore)
  assert.deepEqual(active.baseEinvoice, mainEinvoiceBefore)
  assert.deepEqual(active.baseReportPrint, mainReportBefore)
})
check('اسم المالك لا يقبل كحقل هوية فرع', () => {
  assert.throws(() => useAppStore.getState().updateCompanyProfile({ ownerName: 'مالك فرعي' }), /لا تُعدّل من داخل فرع مستقل/)
})

useAppStore.getState().setActiveBranchContext(main)
const current = useAppStore.getState()
check('العودة للرئيسي تعيد هويته وضريبته وتصميمه verbatim', () => {
  assert.equal(current.setup.shopName, mainSetupBefore.shopName)
  assert.equal(current.setup.phone, mainSetupBefore.phone)
  assert.equal(current.einvoice.taxNumber, mainEinvoiceBefore.taxNumber)
  assert.equal(current.receipt.logoDataUrl, mainReceiptBefore.logoDataUrl)
  assert.ok(current.reportPrint.headerLine.includes(mainReportBefore.headerLine))
  assert.ok(current.reportPrint.headerLine.includes(mainSetupBefore.commercialRegister))
  assert.ok(current.reportPrint.headerLine.includes(mainEinvoiceBefore.taxNumber))
})
check('حل إعدادات الفرع B لا يعتمد على كون B هو الفرع النشط', () => {
  const resolved = resolveBranchAppSettings(current, branch)
  assert.equal(resolved.setup.shopName, 'منشأة مركز المنصورة')
  assert.equal(resolved.einvoice.taxNumber, 'BRANCH-TAX-077')
  assert.equal(resolved.receipt.logoDataUrl, 'data:image/png;base64,branch-logo')
})
check('فرع الفاتورة يحسم بهوية مستنده لا بالفرع النشط', () => {
  assert.equal(branchOfRecord({ warehouseId: 770 }, branches, warehouses, treasuries)?.id, 77)
  const resolved = resolveDocumentBranchAppSettings(current, { warehouseId: 770 }, branches, warehouses, treasuries)
  assert.equal(resolved.branch?.id, 77)
  assert.equal(resolved.setup.shopName, 'منشأة مركز المنصورة')
})
check('النقص في الهوية يتحدد دون الرجوع إلى بيانات الرئيسي', () => {
  const missing = branchIdentityMissingFields({ shopName: 'مركز مستقل', city: '', street: '', phone: '', commercialRegister: '' }, { taxNumber: '' })
  assert.deepEqual(missing, ['الرقم الضريبي', 'السجل التجاري', 'العنوان', 'الهاتف'])
})

// محاكاة ترطيب ملف فرع تاريخي كان يحتوي اسماً منسوخاً فقط: بقية الحقول
// تظل فارغة وتصميمه لا يسحب شعار/ترويسة الرئيسي عند غياب ملف receipt مستقل.
const legacyState = {
  ...current,
  branchBusinessProfiles: {
    77: {
      shopName: 'اسم تاريخي منسوخ', receiptShopName: 'اسم تاريخي منسوخ',
      vatPercent: 14, taxInclusive: true, doctorSpecialty: '',
      allowNegativeTreasury: false, allowNegativeStock: false, requireOpenShiftForSales: true,
      receipt: { ...mainReceiptBefore, shopName: 'اسم تاريخي منسوخ' },
      reportPrint: { ...mainReportBefore },
      einvoice: { ...mainEinvoiceBefore, taxNumber: '', address: '' },
      approvals: current.baseApprovals,
    },
  },
}
check('ملف فرع تاريخي ناقص لا يرث الرقم/العنوان/الشعار من الرئيسي', () => {
  const resolved = resolveBranchAppSettings(legacyState, branch)
  assert.equal(resolved.setup.shopName, 'اسم تاريخي منسوخ', 'القيمة القديمة الصريحة محفوظة قابلة للتحرير')
  assert.equal(resolved.setup.phone, '')
  assert.equal(resolved.setup.commercialRegister, '')
  assert.equal(resolved.einvoice.taxNumber, '')
  assert.equal(resolved.receipt.logoDataUrl, '', 'حتى شعاراً موروثاً في ملف ناقص لا يطبع')
  assert.deepEqual(resolved.receipt.headerLines, [])
  assert.equal(resolved.reportPrint.headerLine, '', 'ترويسة التقرير لا تكشف حقول الرئيسي')
})

console.log(`\n✅ بوابة الهوية القانونية للفروع: ${passed} اختبارات سلوكية ناجحة\n`)
