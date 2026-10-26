/**
 * 🔐 فحص دائم — الهوية لا تُصفّى بالفرع (بلاغ المالك 2026-10-22):
 * المالك يعمل داخل فرع «ب» ثم يسجل الخروج، فيأتي مستخدم مقيّد بالفرع
 * الرئيسي ويسجل الدخول باسمه ورقمه الصحيحين فكان يُرفض «بيانات الدخول
 * غير صحيحة» — لأن شاشة الدخول وبوابة التطبيق كانتا تقرآن قائمة
 * المستخدمين من المتجر المصفّى بالفرع النشط (useDataStore)، فيختفي
 * مستخدم الفرع الآخر من البحث أصلاً. القاعدة المثبتة هنا:
 *  أ) القراءة المصفّاة تحجب مستخدم الفرع الآخر فعلاً (توثيق الفخ).
 *  ب) القراءة الخام (useRawDataStore) ترى الجميع — وهي ما تستخدمه
 *     شاشة الدخول وبوابة App (حارس مصدري يمنع الرجعة).
 *  ج) الدخول ينجح أياً كان الفرع المتروك مختاراً، وبعده يُقفل نطاق
 *     المستخدم على فرعه وحده (خصوصية الفروع في واجهة العمل سليمة).
 *  د) شارة الفرع وحيدة الموضع: فوق اسم المستخدم في الرأس فقط
 *     (لا نسخة في الشريط الجانبي ولا شريط القوائم — قرار المالك).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_branch_scope_login_badge.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
if (!globalThis.crypto?.subtle) { const { webcrypto } = await import('node:crypto'); globalThis.crypto = webcrypto }

mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'supermarket', allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const { useDataStore, useRawDataStore } = await import(`${repoUrl}?branchlogin=1`)
const { hashPin, findUserByIdentifier } = await import(pathToFileURL(join(root, 'src/core/audit.ts')).href)
const st = () => useDataStore.getState() // مصفّى بالفرع (واجهة العمل)
const raw = () => useRawDataStore.getState() // خام (الهوية والمصادقة)
let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}`); pass++; console.log('  ✓', name) }

st().seed([])
st().setOwnerPin(await hashPin('999999'))

console.log('\n═══ تجهيز: فرعان + مستخدم مقيّد بالرئيسي وآخر بالفرع الثاني ═══')
st().addBranch({ nameAr: 'فرع المعادي', warehouseId: 0, treasuryCode: '', createWarehouse: true, createTreasury: 'cash', managerName: '' }, 2)
const mainBranch = raw().branches.find((b) => b.isMain)
const secondBranch = raw().branches.find((b) => !b.isMain)
ok(mainBranch && secondBranch, 'تولّد الرئيسي + الفرع الثاني')

const EXT = { taxNumber: '', commercialReg: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
st().addEmployee({ nameAr: 'موظف الرئيسي', phone: '0100111222', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 100000, allowancesMinor: 0, active: true, notes: '', email: '', ...EXT })
const mainEmp = raw().employees.at(-1)
st().addEmployee({ nameAr: 'موظف المعادي', phone: '0100333444', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 100000, allowancesMinor: 0, active: true, notes: '', email: '', ...EXT })
const secondEmp = raw().employees.at(-1)

const mainUser = st().addAppUser({ nameAr: mainEmp.nameAr, roleId: 'cashier', pinHash: await hashPin('111111'), employeeId: mainEmp.id, branchId: mainBranch.id, phone: mainEmp.phone, mustChangePin: false })
const secondUser = st().addAppUser({ nameAr: secondEmp.nameAr, roleId: 'cashier', pinHash: await hashPin('222222'), employeeId: secondEmp.id, branchId: secondBranch.id, phone: secondEmp.phone, mustChangePin: false })
eq(mainUser.branchId, mainBranch.id, 'المستخدم الأول مقيّد بالرئيسي')
eq(secondUser.branchId, secondBranch.id, 'المستخدم الثاني مقيّد بفرع المعادي')

console.log('\n═══ إعادة تمثيل البلاغ: المالك داخل فرع المعادي ثم خروج ═══')
st().setActiveBranchId(secondBranch.id) // المالك يترك فرع المعادي مختاراً
st().logout() // اختيار الفرع يبقى محفوظاً (ميزة للمالك) — ولا يجوز أن يسمّم الدخول
eq(raw().activeBranchId, secondBranch.id, 'اختيار الفرع باقٍ بعد الخروج كما هو')
eq(raw().currentUserId, null, 'لا جلسة مستخدم بعد الخروج')

console.log('\n═══ أ) الفخ موثّق: القراءة المصفّاة تحجب مستخدم الرئيسي ═══')
ok(!st().appUsers.some((u) => u.id === mainUser.id), 'المصفّى: مستخدم الرئيسي غير مرئي داخل نطاق المعادي')
eq(findUserByIdentifier(st().appUsers, mainUser.phone), null, 'بحث شاشة الدخول القديم (مصفّى) كان سيرفضه — سبب البلاغ')

console.log('\n═══ ب) القراءة الخام ترى الجميع — والواجهة مربوطة عليها ═══')
ok(raw().appUsers.some((u) => u.id === mainUser.id) && raw().appUsers.some((u) => u.id === secondUser.id), 'الخام: مستخدما الفرعين مرئيان معاً')
eq(findUserByIdentifier(raw().appUsers, mainUser.phone)?.id, mainUser.id, 'بحث الهوية (خام) يجد مستخدم الرئيسي بهاتفه')
const loginScreenSrc = readFileSync(join(root, 'src/ui/LoginScreen.tsx'), 'utf-8')
ok(loginScreenSrc.includes('useRawDataStore') && !/=\s*useDataStore\(\)/.test(loginScreenSrc), 'شاشة الدخول تقرأ المتجر الخام (حارس مصدري ضد الرجعة)')
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf-8')
ok(appSrc.includes('ownerPinHash, loggedOut } = useRawDataStore()'), 'بوابة App (authRequired) تقرأ الهوية خاماً')

console.log('\n═══ ج) الدخول ينجح والنطاق يُقفل على فرع المستخدم ═══')
const res = await raw().login(mainUser.id, '111111')
eq(res.mustChangePin, false, 'دخول مستخدم الرئيسي ناجح رغم أن الفرع المتروك هو المعادي')
eq(raw().currentUserId, mainUser.id, 'الجلسة للمستخدم الصحيح')
eq(st().branches.length, 1, 'النطاق المصفّى بعد الدخول: فرع واحد فقط')
eq(st().branches[0].id, mainBranch.id, '… وهو فرعه الرئيسي لا الفرع المتروك')
ok(!st().appUsers.some((u) => u.id === secondUser.id), 'خصوصية الفروع سليمة: لا يرى مستخدمَ المعادي في واجهة العمل')
st().logout()

console.log('\n═══ د) شارة الفرع وحيدة: فوق اسم المستخدم في الرأس فقط ═══')
const headerSrc = readFileSync(join(root, 'src/ui/layout/Header.tsx'), 'utf-8')
const sidebarSrc = readFileSync(join(root, 'src/ui/layout/Sidebar.tsx'), 'utf-8')
const menubarSrc = readFileSync(join(root, 'src/ui/layout/MenuBar.tsx'), 'utf-8')
const badgeCount = (s) => (s.match(/<BranchBadge/g) ?? []).length
eq(badgeCount(headerSrc), 1, 'الرأس: شارة واحدة فوق اسم المستخدم')
eq(badgeCount(sidebarSrc), 0, 'الشريط الجانبي: بلا شارة')
eq(badgeCount(menubarSrc), 0, 'شريط القوائم: بلا شارة')
ok(headerSrc.includes('showHeaderBranchBadge = activeBranches.length > 0'), 'الشارة تظهر في وضعَي التنقل معاً من موضعها الوحيد')

console.log(`\nPASS=${pass} — الهوية لا تُصفّى بالفرع، والشارة وحيدة الموضع`)
