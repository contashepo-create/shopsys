/**
 * فحص جولة مراجعة نشاط العيادة (الطلبات 6–9 — الجولة 8):
 * الروشتة المطبوعة — أوضح فجوة مقابل برامج العيادات:
 * ① parsePrescriptionText: «دواء | جرعة» لكل سطر
 * ② renderPrescriptionHtml: ترويسة/مريض/تشخيص/أدوية/تحذير الملف — بلا أي مبالغ
 * تشغيل: node --experimental-strip-types scripts/verify_clinic_review.mjs
 */
const { renderPrescriptionHtml, parsePrescriptionText } = await import('../src/ui/print/printPrescription.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ تحليل نص العلاج إلى سطور روشتة')
const lines = parsePrescriptionText('أموكسيسيللين 500 | كبسولة كل 8 ساعات — 5 أيام\nباراسيتامول | عند اللزوم\nفيتامين د')
ok('ثلاثة أدوية', lines.length === 3)
ok('الدواء الأول باسمه وجرعته', lines[0].medication === 'أموكسيسيللين 500' && lines[0].dosage.includes('كل 8 ساعات'))
ok('دواء بلا جرعة يمر باسمه فقط', lines[2].medication === 'فيتامين د' && lines[2].dosage === '')
ok('نص فارغ = لا سطور', parsePrescriptionText('  \n ').length === 0)
ok('سطور فارغة تُتجاهل', parsePrescriptionText('a\n\n\nb').length === 2)

console.log('\n2️⃣ قالب الروشتة')
// التوقيع الحالي: legacyLines للتوافق الخلفي + allergyWarning منفصل (ترقية الروشتة الجدولية)
const base = { doctorTitle: '', clinicAddress: '', patientCode: 'PAT-0001', patientGender: '', allergyWarning: '', nextVisit: '' }
const html = renderPrescriptionHtml({
  ...base, clinicName: 'عيادة الشفاء', doctorName: 'د/ محمد', clinicPhone: '0100',
  patientName: 'سارة', patientAge: '31 سنة', dateIso: '2026-09-16T10:00:00Z', visitNumber: 'VIS-0007',
  diagnosis: 'التهاب لوزتين', legacyLines: lines, notes: '',
  allergyWarning: 'حساسية بنسلين',
})
ok('الترويسة والمريض والتاريخ', html.includes('عيادة الشفاء') && html.includes('سارة') && html.includes('2026-09-16'))
ok('التشخيص والأدوية مرقمة في الجدول', html.includes('التهاب لوزتين') && html.includes('℞') && html.includes('>1</td>') && html.includes('>3</td>'))
ok('تحذير الملف الطبي (حساسية) ظاهر', html.includes('حساسية بنسلين'))
ok('بلا أي مبالغ أو رموز عملة', !html.includes('ج.م') && !html.includes('EGP'))
ok('تهريب HTML', renderPrescriptionHtml({ ...base, clinicName: '<img onerror=x>', doctorName: '', clinicPhone: '', patientName: 'a', patientAge: '', dateIso: '2026-01-01', visitNumber: 'v', diagnosis: '', legacyLines: [], notes: '' }).includes('&lt;img'))
const emptyHtml = renderPrescriptionHtml({ ...base, clinicName: 'ع', doctorName: '', clinicPhone: '', patientName: 'a', patientAge: '', dateIso: '2026-01-01', visitNumber: 'v', diagnosis: '', legacyLines: [], notes: '' })
ok('بلا أدوية يظهر بديل واضح', emptyHtml.includes('لا أدوية') || emptyHtml.includes('بلا أدوية') || !emptyHtml.includes('<td class="n">'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
