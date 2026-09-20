/**
 * 🔒 فحص عزل الأنشطة (أمر المالك — المراجعة الشاملة):
 * ─────────────────────────────────────────────────
 * «لا يظهر أي قسم/حساب/صلاحية/دور/مسمى لنشاط في نشاط آخر لا يخصه»
 *
 * A) شجرة الحسابات المفلترة: لكل نشاط من الـ28 — لا حساب تخصصي غريب،
 *    وحسابات وحداته المفعلة موجودة، وصمام الأمان يعيد حساباً متحركاً
 * B) حراسة المسارات: نشاط بلا وحدة لا يفتح مساراتها حتى بالرابط المباشر
 * C) الصلاحيات المفلترة: لا صلاحية كاشير لنشاط بلا كاشير — والعامة موجودة دائماً
 * D) الأدوار المرئية: «كاشير» يختفي لنشاط بلا pos، وأدوار النشاط تظهر له وحده
 * E) المسميات: labelFor تعيد مسمى النشاط ولا تلوث الأنشطة الأخرى
 * F) الفاتورة أولاً: تجارة/مصنع/خدمات — كاشير باسم «فاتورة»، لا ورديات، وردية غير ملزمة
 *
 * تشغيل: node --experimental-strip-types scripts/verify_activity_isolation.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const { ACTIVITY_TEMPLATES, effectiveModules, INVOICE_FIRST_ACTIVITIES, isInvoiceFirst } = await import(join(root, 'src/core/activities.ts'))
const { STANDARD_COA } = await import(join(root, 'src/core/ledger.ts'))
const { coaForModules, usedAccountCodes, pathAllowedForSetup, ACCOUNT_MODULE_MAP, MODULE_ROUTES } = await import(join(root, 'src/core/coaVisibility.ts'))
const { PERMISSIONS, PERMISSION_MODULE_MAP, permissionsForModules, permissionSectionsForModules, DEFAULT_ROLES, ACTIVITY_ROLES, rolesWithOverrides, visibleRolesForModules } = await import(join(root, 'src/core/permissions.ts'))
const { ACTIVITY_LABELS, labelFor } = await import(join(root, 'src/core/activityLabels.ts'))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

console.log('\n═══ A) شجرة الحسابات المفلترة لكل نشاط ═══')
// الحسابات التخصصية وأنشطتها المتوقعة
const SPECIALIZED = Object.keys(ACCOUNT_MODULE_MAP)
for (const tpl of ACTIVITY_TEMPLATES) {
  const modules = effectiveModules(tpl.id, [])
  const coa = coaForModules(STANDARD_COA, modules)
  const codes = new Set(coa.map((a) => a.code))
  // لا حساب تخصصي لا تخصه وحدة مفعلة
  for (const code of SPECIALIZED) {
    const req = ACCOUNT_MODULE_MAP[code]
    const shouldShow = req.some((m) => modules.includes(m))
    assert.equal(codes.has(code), shouldShow,
      `${tpl.id}: حساب ${code} — متوقع ${shouldShow ? 'ظهور' : 'اختفاء'} (وحداته ${req} والنشاط ${modules})`)
  }
  // الحسابات العامة موجودة دائماً
  for (const g of ['1101', '1104', '2101', '2104', '3101', '5102', '5108']) {
    assert.ok(codes.has(g), `${tpl.id}: الحساب العام ${g} مفقود!`)
  }
  // لا أب يتيم غير ورقي بلا أبناء
  for (const a of coa.filter((x) => !x.isPostable)) {
    assert.ok(coa.some((c) => c.parentCode === a.code) || a.isPostable,
      `${tpl.id}: أب يتيم ${a.code}`)
  }
}
ok(`28 نشاطاً × ${SPECIALIZED.length} حساباً تخصصياً: الظهور مطابق للوحدات + العامة موجودة + لا آباء يتامى`)

// صمام الأمان: حساب متحرك يظهر حتى لو وحدته مطفأة
{
  const groceryModules = effectiveModules('grocery', [])
  const fakeJournal = [{ lines: [{ accountCode: '4107' }] }] // إيراد مقاولات تحرك في بقالة (سيناريو تبديل نشاط)
  const coa = coaForModules(STANDARD_COA, groceryModules, usedAccountCodes(fakeJournal))
  assert.ok(coa.some((a) => a.code === '4107'), 'صمام الأمان لم يُبقِ الحساب المتحرك!')
  const coaNoUse = coaForModules(STANDARD_COA, groceryModules)
  assert.ok(!coaNoUse.some((a) => a.code === '4107'), '4107 ظهر لبقالة بلا حركة!')
  ok('صمام الأمان: حساب متحرك يبقى ظاهراً — وبلا حركة يختفي')
}

console.log('\n═══ B) حراسة المسارات حسب الوحدات ═══')
{
  const cases = [
    // [النشاط, المسار, متوقع السماح]
    ['realestate', '/pos', false],
    ['realestate', '/realestate/leases', true],
    ['realestate', '/contracting/projects', false],
    ['realestate', '/inventory/items', false],
    ['contracting', '/contracting/projects', true],
    ['contracting', '/pos', false],
    ['contracting', '/inventory/items', true],
    ['grocery', '/pos', true],
    ['grocery', '/lab/orders', false],
    ['grocery', '/inventory/scale', true], // weight_scale مفعلة للبقالة
    ['clinic', '/inventory/scale', false],
    ['clinic', '/clinic/patients', true],
    ['lab', '/clinic/patients', false],
    ['restaurant', '/sales/restaurant-orders', true],
    ['manufacturing', '/sales/restaurant-orders', false], // recipes مفعلة لكنها ليست مطعماً
    ['manufacturing', '/inventory/recipes', true],
    ['mobile', '/maintenance/tickets', true],
    ['clothing', '/maintenance/tickets', false],
    ['trading', '/pos', true], // شاشة إنشاء فواتيرهم
    ['trading', '/sales/shifts', false], // فاتورة أولاً — لا ورديات
    ['trading', '/sales/exchange', false],
    ['services', '/sales/shifts', false],
    ['grocery', '/sales/shifts', true],
    ['salon', '/sales/price-lists', true], // price_lists مفعلة للصالون
    ['clinic', '/sales/price-lists', false],
    ['general', '/settings/general', true], // مسار عام غير محروس بوحدة
  ]
  for (const [act, path, expected] of cases) {
    const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === act)
    assert.ok(tpl, `نشاط مجهول ${act}`)
    const allowed = pathAllowedForSetup(path, effectiveModules(act, []), tpl.features, act)
    assert.equal(allowed, expected, `${act} → ${path}: متوقع ${expected} وجاء ${allowed}`)
  }
  ok(`${cases.length} حالة مسار × نشاط: السماح والحجب مطابقان تماماً`)
}

console.log('\n═══ C) الصلاحيات المفلترة حسب النشاط ═══')
for (const tpl of ACTIVITY_TEMPLATES) {
  const modules = effectiveModules(tpl.id, [])
  const perms = permissionsForModules(modules)
  const ids = new Set(perms.map((p) => p.id))
  // صلاحية مربوطة بوحدة غير مفعلة يجب ألا تظهر
  for (const [pid, req] of Object.entries(PERMISSION_MODULE_MAP)) {
    const shouldShow = req.some((m) => modules.includes(m))
    assert.equal(ids.has(pid), shouldShow, `${tpl.id}: صلاحية ${pid} — متوقع ${shouldShow}`)
  }
  // العامة دائماً
  for (const g of ['party.customer.manage', 'acc.vouchers', 'rep.sales', 'set.users']) {
    assert.ok(ids.has(g), `${tpl.id}: الصلاحية العامة ${g} مفقودة!`)
  }
  // أقسام الشاشة: قسم بلا صلاحيات ظاهرة يختفي
  const sections = permissionSectionsForModules(modules)
  for (const s of sections) {
    assert.ok(perms.some((p) => p.section === s.id), `${tpl.id}: قسم فارغ ${s.id} ظاهر!`)
  }
}
ok('28 نشاطاً: الصلاحيات المعروضة = العامة + المرتبطة بوحدات مفعلة فقط — ولا قسم فارغ')

// عينات دقيقة
{
  const re = permissionsForModules(effectiveModules('realestate', []))
  assert.ok(!re.some((p) => p.id === 'sales.pos.open'), 'فتح الكاشير ظهر للعقارات!')
  assert.ok(!re.some((p) => p.id === 'sales.shift.close'), 'إقفال وردية ظهر للعقارات!')
  assert.ok(!re.some((p) => p.id === 'inv.cost.view'), 'رؤية التكلفة ظهرت للعقارات (بلا مخزون)!')
  assert.ok(re.some((p) => p.id === 'ops.activity.use'), 'صلاحية النشاط التخصصي غابت عن العقارات!')
  const gro = permissionsForModules(effectiveModules('grocery', []))
  assert.ok(gro.some((p) => p.id === 'sales.pos.open'), 'فتح الكاشير غاب عن البقالة!')
  assert.ok(!gro.some((p) => p.id === 'ops.activity.use'), 'صلاحية تخصصية ظهرت لبقالة بلا وحدة تخصصية!')
  ok('عينات: عقارات بلا صلاحيات كاشير/مخزون وبقالة بلا صلاحية تخصصية')
}

console.log('\n═══ D) الأدوار المرئية حسب النشاط ═══')
{
  for (const tpl of ACTIVITY_TEMPLATES) {
    const modules = effectiveModules(tpl.id, [])
    const roles = visibleRolesForModules(rolesWithOverrides({}, [], tpl.id), modules)
    const rids = new Set(roles.map((r) => r.id))
    // كاشير/بائع أول/مدير فرع لا تظهر بلا pos
    const hasPos = modules.includes('pos')
    assert.equal(rids.has('cashier'), hasPos, `${tpl.id}: دور كاشير — متوقع ${hasPos}`)
    assert.equal(rids.has('senior_seller'), hasPos, `${tpl.id}: بائع أول — متوقع ${hasPos}`)
    // المالك والمحاسب دائماً
    assert.ok(rids.has('owner') && rids.has('accountant'), `${tpl.id}: المالك/المحاسب غائب!`)
    // أدوار النشاط نفسه تظهر له
    for (const r of ACTIVITY_ROLES[tpl.id] ?? []) {
      assert.ok(rids.has(r.id), `${tpl.id}: دوره ${r.id} غائب!`)
    }
    // أدوار الأنشطة الأخرى لا تتسرب (فحص التسريب العكسي)
    for (const [otherAct, otherRoles] of Object.entries(ACTIVITY_ROLES)) {
      if (otherAct === tpl.id) continue
      for (const r of otherRoles) {
        // نفس المعرف قد يتكرر عمداً بين أنشطة (أمين مخزن) — التسريب = دور لا يخص النشاط وغير معرف فيه
        const sharedId = (ACTIVITY_ROLES[tpl.id] ?? []).some((x) => x.id === r.id)
        if (!sharedId) assert.ok(!rids.has(r.id), `${tpl.id}: تسرب دور ${r.id} من ${otherAct}!`)
      }
    }
  }
  ok('28 نشاطاً: كاشير مرهون بـpos، أدوار كل نشاط له وحده، لا تسريب عكسي، المالك/المحاسب دائماً')
  // مستخدم قديم على دور مخفي: التقييم يعمل (rolesWithOverrides الكاملة)
  const all = rolesWithOverrides({}, [], 'realestate')
  assert.ok(all.some((r) => r.id === 'cashier'), 'الدور الكامن اختفى من التقييم — مستخدم قديم سينكسر!')
  ok('دور مخفي عن العرض يبقى في التقييم — مستخدم قديم معين عليه لا ينكسر')
}

console.log('\n═══ E) المسميات حسب النشاط ═══')
{
  assert.equal(labelFor('butcher', 'parties.customers', 'العملاء'), 'الزبائن')
  assert.equal(labelFor('contracting', 'parties.customers', 'العملاء'), 'العملاء (أصحاب الأعمال)')
  assert.equal(labelFor('realestate', 'parties.customers', 'العملاء'), 'المستأجرون والمشترون')
  assert.equal(labelFor('manufacturing', 'inventory.recipes', 'الوصفات والإنتاج'), 'وصفات التصنيع وأوامر الإنتاج')
  assert.equal(labelFor('electronics', 'parties.customers', 'العملاء'), 'العملاء') // غير مذكور = الافتراضي
  assert.equal(labelFor(null, 'parties.customers', 'العملاء'), 'العملاء')
  // لا مفتاح مجهول في أي نشاط (سلامة الخريطة)
  const validKeys = new Set(['sales', 'sales.pos', 'sales.invoices', 'inventory', 'inventory.items', 'parties.customers', 'purchases.suppliers', 'inventory.recipes'])
  for (const [act, labels] of Object.entries(ACTIVITY_LABELS)) {
    assert.ok(ACTIVITY_TEMPLATES.some((t) => t.id === act), `مسميات لنشاط مجهول: ${act}`)
    for (const k of Object.keys(labels)) assert.ok(validKeys.has(k), `${act}: مفتاح مسمى مجهول ${k}`)
  }
  ok('المسميات: كل نشاط يرى لغته، غير المذكور افتراضي، لا نشاط ولا مفتاح مجهول')
}

console.log('\n═══ F) أنشطة «الفاتورة أولاً» ═══')
{
  assert.deepEqual([...INVOICE_FIRST_ACTIVITIES].sort(), ['manufacturing', 'services', 'trading'])
  for (const a of INVOICE_FIRST_ACTIVITIES) {
    assert.ok(isInvoiceFirst(a), `${a} ليس فاتورة أولاً!`)
    // شاشة البيع تظهر لهم باسم فاتورة لا كاشير
    const lbl = labelFor(a, 'sales.pos', 'شاشة البيع (كاشير)')
    assert.ok(lbl.includes('فاتورة'), `${a}: مسمى شاشة البيع «${lbl}» لا يقول فاتورة`)
    // ورديات محجوبة والمسار مسموح للبيع
    const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === a)
    const mods = effectiveModules(a, [])
    assert.ok(pathAllowedForSetup('/pos', mods, tpl.features, a), `${a}: /pos محجوب — بيعهم مقطوع!`)
    assert.ok(!pathAllowedForSetup('/sales/shifts', mods, tpl.features, a), `${a}: الورديات ظاهرة!`)
  }
  assert.ok(!isInvoiceFirst('grocery') && !isInvoiceFirst(null))
  ok('تجارة/مصنع/خدمات: بيع بالفاتورة شغال، ورديات مخفية، البقالة كاشير عادي')
}

console.log(`\n✅ فحص عزل الأنشطة: ${pass} مجموعة تحقق — كلها خضراء\n`)
