/**
 * 🧾 فحص كتالوج الحسابات المقابلة في سندات القبض والصرف
 * ─────────────────────────────────────────────────────
 * أمر المالك (2026-10-11): «تكيّف سندات القبض والصرف مع الأقسام الإضافية»
 * + «لكل الأنشطة مخزون ومشتريات وموردون» ⇒ فبندو السندات يجب أن تتبع
 * الوحدات المفعّلة، لا النشاط المكتوب في الشاشة.
 *
 * A) سلامة الكتالوج: كل كود حساب قائم وقابل للترحيل، بلا تكرار،
 *    ووحدات الشرط وحدات حقيقية معروفة، وبندو الأقسام مرتبة تصاعدياً
 * B) اتساق الخريطة: نطاق ظهور البند ⊇ نطاق كشف حسابه في الشجرة
 * C) تغطية ٢٩ نشاطاً: لا قائمة فارغة، وأول بند هو الافتراضي المُهيَّأ آلياً
 * D) لا تسرّب: بند وحدة لا يظهر لمن لا يملكها (معدات لا ترى بنود النقلات…)
 * E) كل وحدة تخصصية لها بندو سندات (قبض/صرف) تُفتح بمنحها
 * F) «مصروف على فاتورة شراء» يظهر لكل الأنشطة (المشتريات صارت نواة)
 * G) الحسابات المخصصة: إيراد ⇒ قبض، مصروف ⇒ صرف، وتُضاف في نهاية القائمة
 * H) مطابقة الشاشة بالكتالوج: كل شرط في نافذة السندات (`counter === 'xxxx'`)
 *    يقوده بند حقيقي — لا خانة ميتة ولا بند محذوف تُبنى عليه شاشة
 *
 * تشغيل: node --experimental-strip-types scripts/verify_voucher_counters.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const { ACTIVITY_TEMPLATES, ALL_MODULES, MODULE_LABELS, effectiveModules } = await import(pathToFileURL(join(root, 'src/core/activities.ts')).href)
const { STANDARD_COA } = await import(pathToFileURL(join(root, 'src/core/ledger.ts')).href)
const { ACCOUNT_MODULE_MAP } = await import(pathToFileURL(join(root, 'src/core/coaVisibility.ts')).href)
const { RECEIPT_COUNTERS, PAYMENT_COUNTERS, PURCHASE_EXPENSE_CODE, moduleCounters, counterAccountAllowed, voucherCountersFor } = await import(pathToFileURL(join(root, 'src/core/voucherCounters.ts')).href)
const { readFileSync } = await import('node:fs')

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }
const postable = new Set(STANDARD_COA.filter((a) => a.isPostable).map((a) => a.code))
const codeOf = (c) => c.code

console.log('═══ A) سلامة الكتالوج (بنود القبض والصرف) ═══')
{
  assert.ok(RECEIPT_COUNTERS.length >= 4 && PAYMENT_COUNTERS.length >= 9)
  for (const [name, list] of [['القبض', RECEIPT_COUNTERS], ['الصرف', PAYMENT_COUNTERS]]) {
    const codes = list.map(codeOf)
    assert.equal(new Set(codes).size, codes.length, `${name}: كود مكرر في الكتالوج`)
    for (const c of list) {
      if (c.code === PURCHASE_EXPENSE_CODE) continue
      assert.ok(postable.has(c.code), `${name}: الحساب ${c.code} غير قائم أو غير قابل للترحيل في الشجرة`)
      assert.ok(c.label.trim().length > 3, `${name}: بند بلا شرح (${c.code})`)
    }
    // بندو الأقسام مرتبة تصاعدياً بالكود حتى لا يتغيّر الافتراضي المصادفة
    const extras = list.filter((c) => c.when).map(codeOf)
    assert.deepEqual(extras, [...extras].sort(), `${name}: بندو الأقسام غير مرتبة بالكود`)
    // وحدات الشرط وحدات حقيقية
    for (const c of list.filter((c) => c.when)) {
      for (const m of c.when) assert.ok(ALL_MODULES.includes(m), `${name}: ${c.code} مشروط بوحدة غير معروفة «${m}»`)
    }
  }
  ok(`الكتالوج سليم: ${RECEIPT_COUNTERS.length} بند قبض · ${PAYMENT_COUNTERS.length} بند صرف · بلا تكرار وبلا حساب غير قابل للترحيل`)
}

console.log('\n═══ B) اتساق نطاق الظهور مع كشف الحساب ═══')
{
  let checked = 0
  for (const [name, list] of [['القبض', RECEIPT_COUNTERS], ['الصرف', PAYMENT_COUNTERS]]) {
    for (const c of list) {
      const req = ACCOUNT_MODULE_MAP[c.code]
      if (!req || c.code === PURCHASE_EXPENSE_CODE) continue
      if (c.when) {
        /* أي وحدة تُكشف بها الحساب يجب أن تكون داخل نطاق ظهور البند — وإلا ظهر
           البند لمن لا يرى الحساب (أو اختفى عمّن يراه) */
        for (const m of req) assert.ok(c.when.includes(m), `${name}: ${c.code} مكشوف لوحدة «${m}» خارج نطاق ظهوره (${c.when.join(',')})`)
      }
      checked++
    }
  }
  ok(`نطاق الظهور ⊇ نطاق الكشف: ${checked} بند مقيّد بخريطة الشجرة — لا تعارض`)
}

console.log('\n═══ C) تغطية الأنشطة (٢٩) والافتراضي المُهيَّأ ═══')
{
  const rows = ACTIVITY_TEMPLATES.map((t) => {
    const mods = effectiveModules(t.id, [])
    return {
      id: t.id,
      receipt: voucherCountersFor('receipt', mods),
      payment: voucherCountersFor('payment', mods),
      mods,
    }
  })
  const empty = rows.filter((r) => !r.receipt.length || !r.payment.length)
  assert.equal(empty.length, 0, `أنشطة بلا حساب قبض أو صرف: ${empty.map((r) => r.id).join(', ')}`)
  for (const r of rows) {
    assert.equal(r.receipt[0].code, '1104', `${r.id}: افتراضي القبض ليس «سداد من عميل»`)
    assert.equal(r.payment[0].code, '2101', `${r.id}: افتراضي الصرف ليس «سداد لمورد»`)
  }
  ok(`٢٩/٢٩ نشاطاً لها بنود قبض وصرف، والافتراضي (1104 قبض · 2101 صرف) متاح في كل الأنشطة`)
}

console.log('\n═══ D) لا تسرّب بين الأقسام ═══')
{
  const modsOf = (id) => effectiveModules(id, [])
  const codesFor = (id, kind) => voucherCountersFor(kind, modsOf(id)).map(codeOf)
  /* معدات لا ترى بنود النقلات، والمعمل لا يرى بنود المقاولات، والمقاولات لا ترى بنود السيارات */
  const isolated = [
    ['equipment_rental', 'payment', ['2111', '2113', '5106', '2108', '2110', '2115', '5109']],
    ['lab', 'payment', ['2108', '2110', '2115', '2111', '2113']],
    ['contracting', 'payment', ['2110', '2115', '2113', '2111', '5109']],
    ['logistics', 'payment', ['2108', '2110', '2115', '5109']],
    ['grocery', 'receipt', ['2109', '2103', '2110', '1110', '1105']],
    ['cars', 'payment', ['2111', '2113', '2108', '2115', '5109']],
  ]
  for (const [id, kind, forbidden] of isolated) {
    const codes = codesFor(id, kind)
    for (const f of forbidden) assert.ok(!codes.includes(f), `${id}: بند «${f}» ظهر لنشاط لا يخصه!`)
  }
  /* والعكس: بند الوحدة يظهر لمن يملكها */
  const positive = [
    ['equipment_rental', 'payment', '5105'],
    ['logistics', 'payment', '2111'],
    ['contracting', 'payment', '2108'],
    ['cars', 'payment', '2110'],
    ['realestate', 'payment', '2115'],
    ['lab', 'payment', '5109'],
    ['laundry', 'receipt', '2109'],
    ['cars', 'receipt', '2103'],
    ['clinic', 'receipt', '1110'],
    ['contracting', 'receipt', '1105'],
  ]
  for (const [id, kind, code] of positive) {
    assert.ok(codesFor(id, kind).includes(code), `${id}: بند «${code}» غائب وهو من حسابات النشاط!`)
  }
  ok(`لا تسرّب: ٦ أنشطة لا ترى بنود غيرها · و١٠ بنود أقسام تظهر لأهلها وحدهم`)
}

console.log('\n═══ E) كل وحدة تخصصية لها بندو سندات ═══')
{
  const SPECIALTY = ['maintenance', 'laundry', 'equipment_rental', 'cars', 'logistics', 'lab', 'contracting', 'realestate']
  const coverage = SPECIALTY.map((m) => {
    const owner = ACTIVITY_TEMPLATES.find((t) => effectiveModules(t.id, []).includes(m))
    assert.ok(owner, `لا نشاط يملك وحدة «${m}» — فالمنح يحتاج اختبار تطعيم`)
    const mods = effectiveModules(owner.id, [])
    const extras = [...moduleCounters('receipt'), ...moduleCounters('payment')]
      .filter((c) => c.when.includes(m) && counterAccountAllowed(c.code, mods))
    return { m, id: owner.id, count: extras.length }
  })
  const missing = coverage.filter((c) => c.count === 0)
  assert.equal(missing.length, 0, `وحدات بلا بند سند: ${missing.map((c) => `${c.m} (${c.id})`).join(' · ')}`)
  console.log(`     ${coverage.map((c) => `${MODULE_LABELS[c.m].nameAr}: ${c.count}`).join(' · ')}`)
  ok(`${SPECIALTY.length} وحدة تخصصية — كلها لها بنود سندات متاحة (${coverage.reduce((s, c) => s + c.count, 0)} بنداً)`)
}

console.log('\n═══ F) مصروف على فاتورة الشراء + تغطية النواة ═══')
{
  for (const t of ACTIVITY_TEMPLATES) {
    const mods = effectiveModules(t.id, [])
    assert.ok(mods.includes('purchases'), `${t.id}: بلا وحدة مشتريات!`)
    const codes = voucherCountersFor('payment', mods).map(codeOf)
    assert.ok(codes.includes(PURCHASE_EXPENSE_CODE), `${t.id}: خيار «مصروف على فاتورة شراء» غائب رغم وجود المشتريات!`)
    assert.ok(codes.includes('2101'), `${t.id}: سداد المورد غائب رغم وجود الموردين!`)
  }
  ok(`٢٩/٢٩ نشاطاً: «سداد لمورد» و«مصروف على فاتورة شراء» ظاهران (النواة الجديدة) — والترحيل على حساب مكشوف`)
}

console.log('\n═══ G) الحسابات المخصصة في نهاية القائمة ═══')
{
  const custom = [
    { code: '4199', nameAr: 'إيراد خاص', parentCode: '41', rootType: 'revenue', createdAt: '2026-10-12' },
    { code: '5199', nameAr: 'مصروف خاص', parentCode: '51', rootType: 'expenses', createdAt: '2026-10-12' },
  ]
  const mods = effectiveModules('grocery', [])
  const receipt = voucherCountersFor('receipt', mods, custom)
  const payment = voucherCountersFor('payment', mods, custom)
  assert.equal(receipt.at(-1).code, '4199', 'حساب الإيراد المخصص لم يُضف في نهاية قائمة القبض')
  assert.equal(payment.at(-1).code, '5199', 'حساب المصروف المخصص لم يُضف في نهاية قائمة الصرف')
  assert.ok(!receipt.some((c) => c.code === '5199'), 'حساب مصروف ظهر في القبض!')
  assert.ok(!payment.some((c) => c.code === '4199'), 'حساب إيراد ظهر في الصرف!')
  ok('حساب مخصص للقبض وحساب مخصص للصرف — في النهاية وبلا تبادل')
}

console.log('\n═══ H) مطابقة نافذة السندات بالكتالوج (لا شرط ميت) ═══')
{
  const page = readFileSync(join(root, 'src/ui/pages/VouchersPage.tsx'), 'utf8')
  const known = new Set([...RECEIPT_COUNTERS, ...PAYMENT_COUNTERS].map((c) => c.code))
  const referenced = new Set()
  for (const m of page.matchAll(/counter\s*={2,3}\s*'([^']+)'/g)) referenced.add(m[1])
  assert.ok(referenced.size >= 4, 'لم نجد شروط الحساب المقابل في نافذة السندات — تغيّر الشكل فحدّث الفحص')
  const orphans = [...referenced].filter((code) => !known.has(code))
  assert.equal(orphans.length, 0, `نافذة السندات تشترط حساباً غير موجود في الكتالوج: ${orphans.join(', ')} — شرط ميت أو بند محذوف`)
  /* والعكس مهم: الشاشة تقرأ الكتالوج من المصدر الواحد لا قائمة محلية */
  assert.ok(page.includes("from '../../core/voucherCounters.ts'"), 'الشاشة لا تقرأ كتالوج السندات من `core/voucherCounters.ts`')
  assert.ok(!/const (RECEIPT|PAYMENT)_COUNTERS\s*=/.test(page), 'الشاشة ما زالت تعرّف قائمة محلية — الكتالوج يجب أن يكون مصدراً واحداً')
  ok(`الشاشة والكتالوج متطابقان: ${[...referenced].sort().join(', ')} — كلها بنود حقيقية، والقائمة من المصدر الواحد`)
}

console.log('\n═══ I) بنود سلف الموظفين — المسار الذي كان معطّلاً ═══')
{
  /* الفحص يعتصر بلاغة الخطأ الشهير: شاشة السندات كانت تشترط الموظف عند «1107»
     لكنّ الكتالوج فقد البند، فصار الشرط ميتاً والمسار غير قابل للوصول */
  assert.ok(RECEIPT_COUNTERS.some((c) => c.code === '1107'), 'بند «سداد سلفة موظف» غائب عن كتالوج القبض (مسار مسدود)')
  assert.ok(PAYMENT_COUNTERS.some((c) => c.code === '1107'), 'بند «صرف سلفة لموظف» غائب عن كتالوج الصرف (مسار مسدود)')
  for (const t of ACTIVITY_TEMPLATES) {
    const mods = effectiveModules(t.id, [])
    assert.ok(voucherCountersFor('receipt', mods).some((c) => c.code === '1107'), `${t.id}: لا سند قبض لسلفة الموظف`)
    assert.ok(voucherCountersFor('payment', mods).some((c) => c.code === '1107'), `${t.id}: لا سند صرف لسلفة الموظف`)
  }
  /* و1107 حساب مراقبة دفتره المساعد الموظفون: القيد اليدوي عليه مقفول (JournalPage)
     أما السند فمستند باسم الموظف — وهذا هو الفرق بين المسارين */
  const { LOCKED_CONTROL_ACCOUNTS } = await import(pathToFileURL(join(root, 'src/core/accounting.ts')).href)
  assert.ok(LOCKED_CONTROL_ACCOUNTS['1107'], '1107 لم يعد حساب مراقبة مقفولاً على القيد اليدوي — راجع سياسة السند')
  ok('بند سلف الموظفين متاح قبضاً وصرفاً لكل الأنشطة، و1107 يبقى مقفولاً على القيد اليدوي وحدها')
}

console.log(`\n✅ فحص كتالوج السندات: ${pass} مجموعة تحقق — كلها خضراء\n`)
