/**
 * فحص الأدوار المخصصة وتعيين المشرفين (سد فجوة Square/Toast — مراجعة المالك):
 * ① نواة: rolesWithOverrides يدمج الأدوار المخصصة وصلاحياتها من overrides
 * ② repo: addCustomRole (اسم فريد، نسخ من دور أساس، تدقيق) + rename + remove المحمي
 * ③ الدورة الكاملة: موظفة → حساب كاشير → دور مخصص «مشرفة صالة» بصلاحية الاعتماد
 *    → ترقية بالضغطة (updateAppUser roleId) → approveByPin يقبل رقمها فوراً
 * ④ تعديل صلاحيات الدور المخصص يسري فوراً على الاعتماد (سحب الصلاحية = رفض الرقم)
 * ⑤ الحمايات: حذف دور معيّن على مستخدم نشط يُرفض؛ اسم مكرر يُرفض؛ owner لا يُنسخ كأساس
 * تشغيل: node --experimental-strip-types scripts/verify_custom_roles_supervisor.mjs
 */
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { rolesWithOverrides, effectivePermissionsFor, DEFAULT_ROLES } = await import('../src/core/permissions.ts')
const { isEligibleApprover, needsSupervisorPin, REFUND_APPROVE_PERM } = await import('../src/core/refundApproval.ts')
const { hashPin } = await import('../src/core/audit.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const throwsAsync = async (name, fn, part) => {
  try { await fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}

console.log('\n1️⃣ النواة: rolesWithOverrides مع أدوار مخصصة')
{
  const roles = rolesWithOverrides({}, [])
  ok('بلا مخصصة: 5 أدوار النظام كما هي', roles.length === DEFAULT_ROLES.length)
  const withCustom = rolesWithOverrides(
    { custom_1: ['sales.pos.open', REFUND_APPROVE_PERM] },
    [{ id: 'custom_1', nameAr: 'مشرفة صالة' }],
  )
  ok('مع مخصص: يظهر في القائمة باسمه', withCustom.some((r) => r.id === 'custom_1' && r.nameAr === 'مشرفة صالة'))
  const c1 = withCustom.find((r) => r.id === 'custom_1')
  ok('صلاحياته من overrides', c1.permissions.length === 2 && c1.permissions.includes(REFUND_APPROVE_PERM))
  ok('ليس دور نظام (قابل للحذف)', c1.isSystem === false)
  const orphan = rolesWithOverrides({}, [{ id: 'custom_9', nameAr: 'يتيم' }])
  ok('مخصص بلا overrides = صفر صلاحيات (لا انهيار)', orphan.find((r) => r.id === 'custom_9').permissions.length === 0)
  // effectivePermissionsFor يعمل مع الدور المخصص
  const perms = effectivePermissionsFor({ roleId: 'custom_1', extraPerms: [], deniedPerms: [] }, withCustom)
  ok('effectivePermissionsFor يقرأ الدور المخصص', perms.has(REFUND_APPROVE_PERM) && perms.size === 2)
  ok('isEligibleApprover يقبل حامل الصلاحية من دور مخصص', isEligibleApprover({ roleId: 'custom_1', active: true }, perms, REFUND_APPROVE_PERM))
  ok('needsSupervisorPin: حامل الاعتماد لا يُسأل رقماً', needsSupervisorPin({ roleId: 'custom_1' }, perms, REFUND_APPROVE_PERM).needsPin === false)
}

console.log('\n2️⃣ repo: addCustomRole / rename / remove')
{
  const id = S().addCustomRole('مشرف وردية المساء', 'branch_manager')
  ok('الإنشاء يعيد معرفاً custom_N', /^custom_\d+$/.test(id))
  const roles = rolesWithOverrides(S().roleOverrides, S().customRoles)
  const r = roles.find((x) => x.id === id)
  ok('نسخ صلاحيات الأساس (مدير فرع)', r && r.permissions.length === DEFAULT_ROLES.find((x) => x.id === 'branch_manager').permissions.length)
  ok('حدث تدقيق للإنشاء', S().auditLog.some((e) => e.title.includes('مشرف وردية المساء')))
  throws('اسم مكرر يُرفض', () => S().addCustomRole('مشرف وردية المساء'), 'بهذا الاسم')
  throws('اسم فارغ يُرفض', () => S().addCustomRole('   '), 'اكتب اسم')
  const id2 = S().addCustomRole('دور فارغ')
  ok('بلا أساس = صفر صلاحيات', rolesWithOverrides(S().roleOverrides, S().customRoles).find((x) => x.id === id2).permissions.length === 0)
  S().renameCustomRole(id2, 'أمين مخزن')
  ok('إعادة التسمية تعمل', S().customRoles.find((x) => x.id === id2).nameAr === 'أمين مخزن')
  S().removeCustomRole(id2)
  ok('الحذف يزيل الدور وصلاحياته', !S().customRoles.some((x) => x.id === id2) && !(id2 in S().roleOverrides))
  throws('setRolePermissions(owner) يظل محمياً', () => S().setRolePermissions('owner', []), 'محمي')
}

console.log('\n3️⃣ الدورة الكاملة: موظفة → كاشير → دور مخصص معتمد → approveByPin')
const supRoleId = S().customRoles.find((r) => r.nameAr === 'مشرف وردية المساء').id
{
  // المالك برقم 1111 (شرط تفعيل الدخول)
  S().setOwnerPin(await hashPin('1111'))
  S().addEmployee({ nameAr: 'سلمى المشرفة', phone: '0100000001', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const emp = S().employees.at(-1)
  S().addAppUser({ nameAr: emp.nameAr, roleId: 'cashier', pinHash: await hashPin('2222'), employeeId: emp.id, phone: emp.phone, email: '', initialPin: '2222', mustChangePin: false })
  const user = S().appUsers.at(-1)
  // كاشير عادية: رقمها لا يعتمد مرتجعاً
  await throwsAsync('رقم كاشير عادية يُرفض للاعتماد', () => S().approveByPin('2222', REFUND_APPROVE_PERM), 'غير صحيح أو صاحبه لا يملك')
  // الترقية بالضغطة: تعيينها على الدور المخصص (كما في مودال «تغيير دور»)
  S().updateAppUser(user.id, { roleId: supRoleId })
  ok('التعيين على الدور المخصص انعكس', S().appUsers.find((u) => u.id === user.id).roleId === supRoleId)
  const res = await S().approveByPin('2222', REFUND_APPROVE_PERM)
  ok('رقمها يعتمد الآن — approvedBy باسمها', res.approvedBy === 'سلمى المشرفة')
  // صلاحية أخرى يملكها الدور (نسخة مدير فرع): تسوية مخزنية
  const res2 = await S().approveByPin('2222', 'inv.adjust')
  ok('تعتمد تسوية مخزنية أيضاً (من صلاحيات الأساس)', res2.approvedBy === 'سلمى المشرفة')
  // رقم المالك يعتمد دائماً
  const res3 = await S().approveByPin('1111', REFUND_APPROVE_PERM)
  ok('رقم المالك يعتمد دائماً', res3.approvedBy === 'المالك')
}

console.log('\n4️⃣ تعديل صلاحيات الدور المخصص يسري فوراً على الاعتماد')
{
  // سحب صلاحية الاعتماد من الدور — رقم سلمى يُرفض فوراً (لا نسخ قديمة)
  const cur = S().roleOverrides[supRoleId]
  S().setRolePermissions(supRoleId, cur.filter((p) => p !== REFUND_APPROVE_PERM && p !== 'inv.adjust'))
  await throwsAsync('بعد سحب الصلاحية: رقمها يُرفض فوراً', () => S().approveByPin('2222', REFUND_APPROVE_PERM), 'غير صحيح أو صاحبه لا يملك')
  // إرجاعها
  S().setRolePermissions(supRoleId, cur)
  const res = await S().approveByPin('2222', REFUND_APPROVE_PERM)
  ok('بعد الإرجاع: تعتمد من جديد', res.approvedBy === 'سلمى المشرفة')
}

console.log('\n5️⃣ الحمايات البنيوية')
{
  throws('حذف دور معيّن على مستخدمة نشطة يُرفض', () => S().removeCustomRole(supRoleId), 'معيّن')
  const salma = S().appUsers.find((u) => u.nameAr === 'سلمى المشرفة')
  S().updateAppUser(salma.id, { roleId: 'cashier' })
  S().removeCustomRole(supRoleId)
  ok('بعد نقلها لدور آخر: الحذف يمر', !S().customRoles.some((r) => r.id === supRoleId))
  await throwsAsync('بعد حذف الدور: الرقم لا يعتمد (كاشير)', () => S().approveByPin('2222', REFUND_APPROVE_PERM), 'غير صحيح أو صاحبه لا يملك')
  throws('rename لدور محذوف يُرفض', () => S().renameCustomRole(supRoleId, 'س'), 'غير موجود')
}

console.log(`\n══════════════════\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) { process.exit(1) }
console.log('CUSTOM-ROLES-SUPERVISOR-OK ✅')
