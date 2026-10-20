/**
 * تحقق سد فجوة تقرير النشاط #24 (شركة خدمات):
 * تعليق التصميم الداخلي لثلاثة أنشطة (صالون #19، شركة خدمات #24، مكتبة
 * وخدمة طالب) يصرّح أنها مبنية حول صنف "خدمة" (isService) بلا مخزون —
 * بل نشاط «شركة خدمات» كله لا يبيع شيئاً غير الخدمات بالتعريف. لكن مفتاح
 * إظهار حقل "🛎️ صنف خدمة (بلا مخزون)" بارزاً في نموذج إضافة صنف جديد
 * (بدل إخفائه تحت «خيارات أكثر» المطوية افتراضياً) كان مربوطاً بنص
 * activityId === 'salon' فقط — فيفاجأ صاحب نشاط "شركة خدمات" (الذي كل
 * صنف يضيفه فعلياً خدمة) أو صاحب المكتبة (خدمات تصوير/طباعة) بأن الحقل
 * الجوهري لنشاطهما غير ظاهر افتراضياً عند أول استخدام.
 * الإصلاح: خاصية `service_items` صريحة بنفس نمط بقية خصائص الصنف
 * (expiry_batches/serial_warranty/weight_scale)، مانحة الثلاثة أنشطة
 * (صالون/خدمات/مكتبة) ظهوراً بارزاً للحقل — لا تغيير في منطق البيع.
 * تشغيل: node --experimental-strip-types scripts/verify_services_phase_b.mjs
 */
import assert from 'node:assert/strict'

const { ACTIVITY_TEMPLATES, getActivity, FEATURE_LABELS, effectiveModules } = await import('../src/core/activities.ts')

let PASS = 0
const ok = (cond, msg) => {
  assert.ok(cond, msg)
  PASS++
  console.log(`  ✓ ${msg}`)
}

console.log('— ① خاصية service_items موجودة ومُسمّاة —')
ok(FEATURE_LABELS.service_items != null, 'FEATURE_LABELS يحوي مدخلاً لـ service_items')
ok(typeof FEATURE_LABELS.service_items.nameAr === 'string' && FEATURE_LABELS.service_items.nameAr.length > 0, 'له اسم عربي معروض')

console.log('— ② الأنشطة الثلاثة المبنية حول صنف الخدمة تملك الخاصية —')
for (const id of ['salon', 'services', 'stationery']) {
  const tpl = getActivity(id)
  ok(!!tpl, `نشاط ${id} موجود في القوالب`)
  ok(tpl.features.includes('service_items'), `نشاط ${id} يملك خاصية service_items (صنف الخدمة بارز في نموذج الإضافة)`)
}

console.log('— ③ بقية الأنشطة غير المبنية حول صنف الخدمة لا تملكها (لا تضخّم عشوائي) —')
for (const id of ['grocery', 'pharmacy', 'contracting', 'realestate', 'trading', 'manufacturing', 'clinic', 'lab']) {
  const tpl = getActivity(id)
  ok(!!tpl, `نشاط ${id} موجود في القوالب`)
  ok(!tpl.features.includes('service_items'), `نشاط ${id} لا يملك service_items — ليس مبنياً حول صنف خدمة عام في شاشة الأصناف`)
}

console.log('— ④ كل نشاط في القوالب الكاملة يمر على FEATURE_LABELS دون خطأ (لا مفتاح مفقود) —')
for (const tpl of ACTIVITY_TEMPLATES) {
  for (const f of tpl.features) {
    ok(FEATURE_LABELS[f] != null, `نشاط ${tpl.id}: خاصية ${f} لها مدخل في FEATURE_LABELS`)
  }
}

console.log('— ⑤ effectiveModules لم يتأثر إطلاقاً (الإصلاح خاص بخصائص الصنف لا الوحدات) —')
ok(JSON.stringify(effectiveModules('services', undefined)) === JSON.stringify(['pos', 'inventory', 'purchases']), 'وحدات شركة خدمات كما هي بلا تغيير')
ok(JSON.stringify(effectiveModules('salon', undefined)) === JSON.stringify(['pos', 'inventory', 'purchases', 'booking']), 'وحدات الصالون كما هي بلا تغيير')
ok(JSON.stringify(effectiveModules('stationery', undefined)) === JSON.stringify(['pos', 'inventory', 'purchases']), 'وحدات المكتبة كما هي بلا تغيير')

console.log(`\nPASS=${PASS} FAIL=0`)
console.log('🎉 نجح تحقق سد فجوة بروز حقل «صنف خدمة» — الأنشطة 19/24/مكتبة')
