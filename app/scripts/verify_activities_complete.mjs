/**
 * فحص اكتمال كل الأنشطة (مراجعة القرار 27/28 الشاملة):
 * لكل نشاط: وحدات صحيحة، وحدة عمل واحدة على الأقل، خصائص معرّفة،
 * قالب فاتورة، وكل وحدة لها تسمية وقسم تنقل — لا نشاط ناقص التكامل.
 * node --experimental-strip-types scripts/verify_activities_complete.mjs
 */
import {
  ACTIVITY_TEMPLATES, ALL_MODULES, MODULE_LABELS, FEATURE_LABELS,
  getActivity, toggleModuleList,
} from '../src/core/activities.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const throws = (fn, name) => { try { fn(); fail++; console.error(`❌ لم يرمِ: ${name}`) } catch { pass++ } }

/* ─── القائمة الكاملة (20 نشاطاً بعد إضافة صالون/مخبز) ─── */
const EXPECTED = [
  'grocery', 'mobile', 'clothing', 'pharmacy', 'electronics', 'spare_parts',
  'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars',
  'restaurant', 'jewelry', 'laundry', 'butcher', 'dates', 'salon', 'bakery', 'general',
]
ok(ACTIVITY_TEMPLATES.length === EXPECTED.length, `عدد الأنشطة = ${EXPECTED.length}`)
for (const id of EXPECTED) ok(!!getActivity(id), `نشاط ${id} موجود`)

/* ─── فحوص عامة لكل نشاط ─── */
const WORK_MODULES = ['pos', 'maintenance', 'laundry', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars']
const ids = new Set()
for (const a of ACTIVITY_TEMPLATES) {
  ok(!ids.has(a.id), `معرف ${a.id} غير مكرر`)
  ids.add(a.id)
  ok(a.nameAr.trim().length > 0 && a.icon.trim().length > 0 && a.description.trim().length > 0, `${a.id}: اسم وأيقونة ووصف`)
  ok(a.modules.length > 0, `${a.id}: له وحدات`)
  ok(a.modules.every((m) => ALL_MODULES.includes(m)), `${a.id}: كل وحداته معروفة`)
  ok(a.modules.some((m) => WORK_MODULES.includes(m)), `${a.id}: وحدة عمل واحدة على الأقل`)
  ok(new Set(a.modules).size === a.modules.length, `${a.id}: لا وحدات مكررة`)
  ok(a.features.every((f) => f in FEATURE_LABELS), `${a.id}: كل خصائصه معرّفة`)
  ok(a.defaultInvoiceTemplate === 'thermal' || a.defaultInvoiceTemplate === 'a4', `${a.id}: قالب فاتورة صالح`)
  ok(typeof a.taxInclusiveDefault === 'boolean', `${a.id}: افتراضي الضريبة محدد`)
}

/* ─── كل وحدة لها تسمية عربية ─── */
for (const m of ALL_MODULES) {
  ok(MODULE_LABELS[m] && MODULE_LABELS[m].nameAr.trim().length > 0, `وحدة ${m} لها تسمية`)
}

/* ─── منطق الأنشطة الجديدة ─── */
const rest = getActivity('restaurant')
ok(rest.features.includes('expiry_batches') && rest.features.includes('weight_scale'), 'المطعم: صلاحية + وزن (خامات)')
ok(rest.modules.includes('pos') && rest.modules.includes('inventory'), 'المطعم: كاشير + مخزون')
ok(rest.taxInclusiveDefault === true && rest.defaultInvoiceTemplate === 'thermal', 'المطعم: ضريبة شاملة وإيصال حراري')

const jew = getActivity('jewelry')
ok(jew.features.includes('weight_scale') && jew.features.includes('price_lists'), 'المجوهرات: وزن بالجرام + قوائم أسعار')
ok(jew.taxInclusiveDefault === false && jew.defaultInvoiceTemplate === 'a4', 'المجوهرات: فاتورة A4 موثقة')

const lau = getActivity('laundry')
ok(lau.modules.includes('laundry') && !lau.modules.includes('maintenance') && !lau.modules.includes('inventory'), 'المغسلة: وحدة غسيل مستقلة (لا صيانة) بلا مخازن')

/* ─── الأنشطة الخدمية بلا مخازن افتراضياً (قرار 22) ─── */
for (const id of ['logistics', 'lab', 'clinic', 'equipment_rental', 'laundry']) {
  ok(!getActivity(id).modules.includes('inventory'), `${id}: بلا مخازن افتراضياً (تُفعَّل من الإعدادات)`)
}

/* ─── المقاولات: المخزون والمشتريات أساسيان (أمر المالك — دورة المواد) ───
   شراء مواد للمخزن (1103) ← إذن صرف لمشروع (5110/1103). بدونهما شاشة
   أذون الصرف تبقى بلا أصناف والدورة مقطوعة من أولها. */
const con = getActivity('contracting')
ok(con.modules.includes('inventory') && con.modules.includes('purchases'), 'المقاولات: المخزون والمشتريات وحدتان أساسيتان')
ok(con.modules.includes('contracting'), 'المقاولات: وحدة العمل الرئيسية حاضرة')

/* ─── تكامل المحاسبة: حساب إيراد لكل نشاط خدمي ─── */
const codes = new Set(STANDARD_COA.map((x) => x.code))
const revenueBy = {
  equipment_rental: '4104', logistics: '4105', lab: '4106',
  contracting: '4107', clinic: '4108', maintenance: '4103',
}
for (const [mod, code] of Object.entries(revenueBy)) {
  ok(codes.has(code), `وحدة ${mod} لها حساب إيراد ${code} بالشجرة`)
}
ok(codes.has('4101') && codes.has('5101') && codes.has('1103'), 'أنشطة البيع: مبيعات/تكلفة/مخزون بالشجرة')

/* ─── التبديل: آخر وحدة عمل محمية ─── */
throws(() => toggleModuleList(['pos'], 'pos'), 'إطفاء آخر وحدة عمل يرمي')
ok(toggleModuleList(['pos', 'inventory'], 'inventory').length === 1, 'إطفاء المخزون مسموح مع بقاء الكاشير')
ok(toggleModuleList(['maintenance'], 'inventory').includes('inventory'), 'المغسلة تفعّل المخزون لاحقاً من الإعدادات')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص اكتمال الأنشطة — ${pass} اختباراً`)
