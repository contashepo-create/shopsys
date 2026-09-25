/**
 * دفعة مراجعة المالك (سبتمبر 2026): المستخدمون والدخول والإشعارات والاستبدال
 * ==========================================================================
 * أ) الدخول بلا قوائم: findUserByIdentifier (اسم/هاتف/بريد، مطابقة حرفية، لا جزئية)
 * ب) الحساب مبني على موظف: addAppUser(employeeId) + منع التكرار + رفض غير النشط
 * ج) أول دخول: mustChangePin يُرجع من login + changeOwnPin يمسح initialPin
 * د) الرقم المبدئي مرئي للمدير (initialPin) ويختفي بعد تغيير الموظف رقمه
 * هـ) اقتراح الدور من المسمى الوظيفي (suggestRoleForJobTitle)
 * و) الإشعارات: markNotificationRead / markAllNotificationsRead / restore
 * ز) قيود باسم المنفذ الفعلي: قيد ينفذه مستخدم فرعي يُختم باسمه لا «المالك»
 * ح) الاستبدال: مرتجع كسر عشري (وزن) يمر سليماً + soldByWeight يؤخذ من الصنف
 * ط) تغيير صلاحيات المجموعة يسري على كل مستخدميها + الاستثناءات الفردية تبقى
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
// WebCrypto لhashPin — Node 18+ يوفر crypto.subtle
if (!globalThis.crypto?.subtle) { const { webcrypto } = await import('node:crypto'); globalThis.crypto = webcrypto }

const { hashPin, findUserByIdentifier, suggestRoleForJobTitle } = await import(join(root, 'src/core/audit.ts'))
const { effectivePermissionsFor, rolesWithOverrides } = await import(join(root, 'src/core/permissions.ts'))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++ }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a} والمتوقع ${b}`); pass++ }
const throws = (fn, name) => { assert.throws(fn, undefined, name); pass++ }

/* ═══ هـ) اقتراح الدور من الوظيفة ═══ */
eq(suggestRoleForJobTitle('كاشير'), 'cashier', 'كاشير → cashier')
eq(suggestRoleForJobTitle('مدير فرع'), 'branch_manager', 'مدير فرع → branch_manager')
eq(suggestRoleForJobTitle('مشرف صالة'), 'branch_manager', 'مشرف → branch_manager')
eq(suggestRoleForJobTitle('محاسب أول'), 'accountant', 'محاسب → accountant')
eq(suggestRoleForJobTitle('بائع أول'), 'senior_seller', 'بائع أول → senior_seller')
eq(suggestRoleForJobTitle('سائق'), 'cashier', 'وظيفة غير معروفة → أدنى دور (cashier)')

/* ═══ أ) البحث بالمعرف الحرفي ═══ */
const usersFixture = [
  { id: 1, nameAr: 'أحمد الكاشير', phone: '0551234567', email: 'ahmed@shop.sa', active: true },
  { id: 2, nameAr: 'سارة المحاسبة', phone: '0559998887', email: '', active: true },
  { id: 3, nameAr: 'موظف معطل', phone: '0500000000', email: 'x@y.z', active: false },
]
eq(findUserByIdentifier(usersFixture, 'أحمد الكاشير')?.id, 1, 'الاسم الكامل يطابق')
eq(findUserByIdentifier(usersFixture, '0551234567')?.id, 1, 'الهاتف يطابق')
eq(findUserByIdentifier(usersFixture, 'AHMED@shop.sa')?.id, 1, 'البريد يطابق (غير حساس لحالة الأحرف)')
eq(findUserByIdentifier(usersFixture, ' سارة المحاسبة '), usersFixture[1], 'التشذيب يعمل')
eq(findUserByIdentifier(usersFixture, 'أحمد'), null, 'لا مطابقة جزئية — لا كشف حسابات')
eq(findUserByIdentifier(usersFixture, '0500000000'), null, 'المعطل لا يُعاد')
eq(findUserByIdentifier(usersFixture, ''), null, 'فارغ = null')

/* ═══ متجر فعلي ═══ */
mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'SA', activityId: 'butcher', vatPercent: 15, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const { useDataStore } = await import(`${repoUrl}?ulogin=1`)
const st = () => useDataStore.getState()
st().seed([])

/* ═══ ب) الحساب مبني على موظف ═══ */
const ownerHash = await hashPin('9999')
st().setOwnerPin(ownerHash)
st().addEmployee({ nameAr: 'أحمد الجزار', phone: '0551112223', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '', email: 'ahmed@butcher.sa', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const emp = st().employees.at(-1)
st().addEmployee({ nameAr: 'موظف سابق', phone: '', jobTitle: '', hireDate: '2026-01-01', baseSalaryMinor: 0, allowancesMinor: 0, active: false, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const inactiveEmp = st().employees.at(-1)

const pin1 = await hashPin('1234')
throws(() => st().addAppUser({ nameAr: 'x', roleId: 'cashier', pinHash: pin1, employeeId: 999 }), 'رفض موظف غير موجود')
throws(() => st().addAppUser({ nameAr: 'x', roleId: 'cashier', pinHash: pin1, employeeId: inactiveEmp.id }), 'رفض موظف غير نشط')
const user = st().addAppUser({ nameAr: emp.nameAr, roleId: 'cashier', pinHash: pin1, employeeId: emp.id, phone: emp.phone, email: emp.email, initialPin: '1234', mustChangePin: true })
eq(user.employeeId, emp.id, 'الحساب مربوط بالموظف')
eq(user.initialPin, '1234', 'الرقم المبدئي محفوظ للمدير')
eq(user.mustChangePin, true, 'إجبار تغيير الرقم مفعل')
throws(() => st().addAppUser({ nameAr: 'حساب ثانٍ', roleId: 'cashier', pinHash: pin1, employeeId: emp.id }), 'رفض حساب ثانٍ لنفس الموظف')

/* ═══ ج + د) أول دخول: mustChangePin ثم changeOwnPin يمسح initialPin ═══ */
const login1 = await st().login(user.id, '1234')
eq(login1.mustChangePin, true, 'أول دخول يعيد mustChangePin=true')
const newHash = await hashPin('5678')
throws(() => st().changeOwnPin(user.id, pin1), 'رفض رقم جديد يطابق القديم')
st().changeOwnPin(user.id, newHash)
const after = st().appUsers.find((u) => u.id === user.id)
eq(after.mustChangePin, false, 'بعد التغيير: لا إجبار')
eq(after.initialPin, null, 'الرقم المبدئي مُسح — لا يعرفه أحد الآن')
const login2 = await st().login(user.id, '5678')
eq(login2.mustChangePin, false, 'الدخول التالي عادي')
ok(st().auditLog.some((e) => e.title.includes('غيّر رقمه السري')), 'تغيير الرقم مسجل في التدقيق')

/* ═══ ز) القيود باسم المنفذ الفعلي ═══ */
// المستخدم «أحمد الجزار» داخل الآن (currentUserId من login) — قيده باسمه
st().addSupplier({ nameAr: 'مسلخ', phone: '', notes: '' })
const sup = st().suppliers.at(-1)
st().addItem({ nameAr: 'ذبيحة', sku: 'C1', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, priceMinor: 0, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
const carcass = st().items.at(-1)
st().addItem({ nameAr: 'فخذ', sku: 'C2', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, priceMinor: 6000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
const leg = st().items.at(-1)
st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: carcass.id, qty: 10, unitPriceMinor: 15000 }], expenses: [], paidMinor: 0, notes: '' })
const purchaseEntry = st().journal.at(-1)
eq(purchaseEntry.createdBy, 'أحمد الجزار', 'قيد الشراء باسم المنفذ الفعلي لا «المالك»')

/* ═══ ح) الاستبدال بوزن عشري ═══ */
st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1000000, label: 'خزينة' })
st().postProcessing({ kind: 'butcher', sourceItemId: carcass.id, sourceQty: 10, outputs: [{ itemId: leg.id, qty: 6 }], overheadMinor: 0, wasteQty: 4 })
// بيع وزني 2.35 كجم ثم استبدال جزء عشري 1.15 كجم بقطعة أخرى وزنها 0.9
const legCost = st().items.find((i) => i.id === leg.id).costMinor
st().postSale({ lines: [{ itemId: leg.id, nameAr: 'فخذ', qty: 2.35, unitPriceMinor: 6000, unitCostMinor: legCost, discountPercent: 0, soldByWeight: true }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: true, treasury: '1101', priceFloorOverrideBy: 'اختبار الترحيل' })
const sale = st().sales.at(-1)
const exch = st().postExchange({
  originalSaleId: sale.id,
  returnLineSpecs: [{ lineIndex: 0, qty: 1.15, condition: 'resellable' }],
  newLines: [{ itemId: leg.id, nameAr: 'فخذ', qty: 0.9, unitPriceMinor: 6000, unitCostMinor: legCost, discountPercent: 0, soldByWeight: true }],
  notes: 'استبدال وزني عشري', approvedBy: 'المالك', creditLimitOverrideBy: null, priceFloorOverrideBy: 'المالك',
})
ok(exch.exchangeNumber.startsWith('EXC'), 'مستند استبدال صدر')
const retDoc = st().saleReturns.at(-1)
eq(retDoc.lines[0].qty, 1.15, 'كمية المرتجع العشرية 1.15 مقبولة كما هي')
// الرصيد: 6 − 2.35 + 1.15 − 0.9 = 3.9
eq(st().items.find((i) => i.id === leg.id).stockQty, 3.9, 'رصيد الوزن بعد الاستبدال العشري صحيح')

/* ═══ و) الإشعارات كمقروء ═══ */
eq(st().readNotificationIds.length, 0, 'لا مقروءات مبدئياً')
st().markNotificationRead('exp:1:2026-01-01')
st().markNotificationRead('exp:1:2026-01-01') // مكرر لا يتضاعف
eq(st().readNotificationIds.length, 1, 'تعليم واحد لا يتكرر')
st().markAllNotificationsRead(['a', 'b', 'c'])
eq(st().readNotificationIds.length, 4, 'تعليم الكل يضيف الجديد فقط')
st().restoreNotifications()
eq(st().readNotificationIds.length, 0, 'الاسترجاع يمسح الكل')

/* ═══ ط) صلاحيات المجموعة والاستثناءات الفردية ═══ */
// المستخدم «أحمد» دوره cashier — نضيف له استثناء فردياً ثم نغير صلاحيات الدور
st().setUserPermExceptions(user.id, ['rep.sales'], ['sales.return.create'])
const rolesBefore = rolesWithOverrides(st().roleOverrides)
const permsBefore = effectivePermissionsFor(st().appUsers.find((u) => u.id === user.id), rolesBefore)
ok(permsBefore.has('rep.sales'), 'الاستثناء الممنوح يعمل (فوق الدور)')
ok(!permsBefore.has('sales.return.create'), 'الاستثناء المحجوب يعمل (رغم الدور)')
ok(permsBefore.has('sales.pos.open'), 'صلاحية الدور الأساسية موجودة')
// تغيير صلاحيات مجموعة الكاشير: نحذف sales.pos.open — يسري فوراً على كل مستخدمي الدور
const cashierPerms = rolesBefore.find((r) => r.id === 'cashier').permissions.filter((x) => x !== 'sales.pos.open')
st().setRolePermissions('cashier', cashierPerms)
const rolesAfter = rolesWithOverrides(st().roleOverrides)
const permsAfter = effectivePermissionsFor(st().appUsers.find((u) => u.id === user.id), rolesAfter)
ok(!permsAfter.has('sales.pos.open'), 'تغيير المجموعة يسري فوراً على مستخدميها (لا نسخ منفصلة)')
ok(permsAfter.has('rep.sales'), 'الاستثناء الفردي الممنوح يبقى بعد تغيير المجموعة')
ok(!permsAfter.has('sales.return.create'), 'الاستثناء الفردي المحجوب يبقى بعد تغيير المجموعة')
throws(() => st().setRolePermissions('owner', []), 'دور المالك محمي بنيوياً')

console.log(`\nPASS=${pass} FAIL=0`)
console.log('🎉 نجحت دفعة المستخدمين والدخول والإشعارات والاستبدال العشري')
