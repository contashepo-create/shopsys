/**
 * تحقق فرض الصلاحيات (البند 4 — RBAC صفر تجاوز):
 * ① كل مسار في الراوتر له صلاحية معرّفة (أو متاح للجميع عمداً).
 * ② الصلاحيات الفعالة: الدور ∪ منح فردي − حجب فردي؛ المالك = الكل دائماً.
 * ③ تعديلات الأدوار محفوظة في المخزن + دور المالك يرفض أي تعديل/حجب.
 * ④ الفرض مربوط فعلاً: القائمة الجانبية + حارس المسارات في Shell.
 * تشغيل: node --experimental-strip-types scripts/verify_permissions.mjs
 */
import { readFileSync } from 'node:fs'
import {
  PERMISSIONS, DEFAULT_ROLES, ROUTE_PERMISSIONS,
  permissionForPath, effectivePermissionsFor, canAccessPath, rolesWithOverrides,
} from '../src/core/permissions.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① تغطية المسارات —')
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const routes = [...appSrc.matchAll(/path="(\/[^"*]*)"/g)].map((m) => m[1])
ok(routes.length > 60, `الراوتر فيه ${routes.length} مساراً`)
const permIds = new Set(PERMISSIONS.map((p) => p.id))
let uncovered = 0, badPerm = 0
for (const r of routes) {
  const need = permissionForPath(r)
  if (need !== null && !permIds.has(need)) { badPerm++; console.log(`    ! صلاحية غير معرّفة لمسار ${r}: ${need}`) }
  if (need === null && !['/', '/settings/about', '/settings/support', '/settings/issues', '/settings/guides'].includes(r)) uncovered++
}
ok(badPerm === 0, 'كل صلاحيات الخريطة معرّفة في PERMISSIONS')
ok(uncovered === 0, 'لا مسار مفتوح للجميع إلا المقصود (الرئيسية/حول/الدعم/البلاغات/الشروحات)')
ok(permissionForPath('/pos') === 'sales.pos.open', '/pos → فتح شاشة البيع')
ok(permissionForPath('/settings/permissions') === 'set.users', 'شاشة الصلاحيات → إدارة المستخدمين')
ok(permissionForPath('/accounting/coa') === 'acc.coa.manage', 'أطول بادئة تفوز: coa ≠ سندات')
ok(permissionForPath('/settings/about') === null, 'حول التطبيق متاح للجميع')

console.log('— ② الصلاحيات الفعالة —')
const roles = DEFAULT_ROLES
const ownerPerms = effectivePermissionsFor(null, roles)
ok(ownerPerms.size === PERMISSIONS.length, 'المالك الافتراضي (null) = كل الصلاحيات')
const cashier = { roleId: 'cashier' }
const cPerms = effectivePermissionsFor(cashier, roles)
ok(cPerms.has('sales.pos.open') && !cPerms.has('acc.journal.manual'), 'الكاشير: بيع نعم — قيد يدوي لا')
ok(!canAccessPath('/settings/permissions', cPerms), 'الكاشير لا يفتح شاشة الصلاحيات حتى بالرابط المباشر')
ok(canAccessPath('/pos', cPerms) && canAccessPath('/', cPerms), 'الكاشير يفتح البيع والرئيسية')
const promoted = { roleId: 'cashier', extraPerms: ['rep.sales'] }
ok(effectivePermissionsFor(promoted, roles).has('rep.sales'), 'منح فردي فوق الدور يعمل')
const restricted = { roleId: 'cashier', deniedPerms: ['sales.pos.open'] }
ok(!effectivePermissionsFor(restricted, roles).has('sales.pos.open'), 'حجب فردي رغم الدور يعمل')
const both = { roleId: 'cashier', extraPerms: ['inv.adjust'], deniedPerms: ['inv.adjust'] }
ok(!effectivePermissionsFor(both, roles).has('inv.adjust'), 'الحجب يعلو على المنح (الأشد أماناً)')
const ownerUser = { roleId: 'owner', deniedPerms: ['sales.pos.open'] }
ok(effectivePermissionsFor(ownerUser, roles).size === PERMISSIONS.length, 'دور المالك: الحجب لا يمسه أبداً')

console.log('— ③ الأدوار المحفوظة والمالك المحمي —')
const withOv = rolesWithOverrides({ cashier: ['sales.pos.open'], owner: [] })
ok(withOv.find((r) => r.id === 'cashier').permissions.length === 1, 'تعديل دور الكاشير يسري')
ok(withOv.find((r) => r.id === 'owner').permissions.length === PERMISSIONS.length, 'محاولة تفريغ دور المالك تُتجاهل بنيوياً')
const { useDataStore } = await (async () => {
  const mem = new Map()
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
  globalThis.window = globalThis
  return import('../src/data/repo.ts')
})()
const S = () => useDataStore.getState()
S().setRolePermissions('cashier', ['sales.pos.open', 'inv.view'])
ok(S().roleOverrides.cashier.length === 2, 'setRolePermissions يحفظ في المخزن (يبقى بعد التحديث)')
let threw = false
try { S().setRolePermissions('owner', []) } catch { threw = true }
ok(threw, 'setRolePermissions(owner) يرمي — صفر تجاوز')
S().setOwnerPin('y'.repeat(64)) // الدفعة الجديدة: PIN المالك شرط قبل إضافة مستخدمين
S().addAppUser({ nameAr: 'كاشير تجربة', roleId: 'cashier', pinHash: 'x'.repeat(64) })
const u = S().appUsers.at(-1)
S().setUserPermExceptions(u.id, ['rep.sales'], ['inv.view'])
const u2 = S().appUsers.find((x) => x.id === u.id)
ok(u2.extraPerms.includes('rep.sales') && u2.deniedPerms.includes('inv.view'), 'الاستثناءات الفردية تُحفظ على المستخدم')
const eff = effectivePermissionsFor(u2, rolesWithOverrides(S().roleOverrides))
ok(eff.has('rep.sales') && !eff.has('inv.view') && eff.has('sales.pos.open'), 'الفعال = دور معدل ∪ منح − حجب')

console.log('— ④ الفرض مربوط في الواجهة —')
const sidebar = readFileSync(new URL('../src/ui/layout/Sidebar.tsx', import.meta.url), 'utf8')
ok(sidebar.includes('canAccessPath') && sidebar.includes('effectivePermissionsFor'), 'القائمة الجانبية تخفي الشاشات غير المصرح بها')
ok(appSrc.includes('canAccessPath(location.pathname'), 'حارس المسارات في Shell: الرابط المباشر لا يتجاوز')

// تدقيق التغطية (طلب المالك — «الصلاحيات enforcement فعلي»):
// كل مسار في كتالوج التنقل يجب أن يقع تحت بادئة محمية أدق من الجذر '/'
// وإلا فهو شاشة مفتوحة للجميع بالخطأ
const navSrc = readFileSync(new URL('../src/ui/navCatalog.tsx', import.meta.url), 'utf8')
const navPaths = [...navSrc.matchAll(/path: '([^']+)'/g)].map((m) => m[1])
const PUBLIC_OK = new Set(['/', '/settings/about', '/settings/support', '/settings/issues', '/settings/guides'])
const uncoveredNav = navPaths.filter((p) => {
  const match = ROUTE_PERMISSIONS.filter((r) => p === r.prefix || p.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return match && match.prefix === '/' && !PUBLIC_OK.has(p)
})
ok(uncoveredNav.length === 0, `كل مسارات الكتالوج (${navPaths.length}) مغطاة بحارس صلاحيات — لا شاشة مفتوحة سهواً${uncoveredNav.length ? `: ${uncoveredNav.join('، ')}` : ''}`)
const permPage = readFileSync(new URL('../src/ui/pages/PermissionsPage.tsx', import.meta.url), 'utf8')
ok(permPage.includes('setRolePermissions') && permPage.includes('rolesWithOverrides'), 'شاشة الصلاحيات تحفظ التعديلات دائماً (لا useState مؤقت)')
ok(permPage.includes('setUserPermExceptions'), 'محرر الاستثناءات الفردية موجود')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
