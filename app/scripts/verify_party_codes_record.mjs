/**
 * تحقق أكواد الأطراف + تقرير سجل المريض الكامل (طلبا المالك):
 * ① الكود ثابت وفريد مشتق من المعرف: CUS/SUP/EMP/PAT/LPT — لا يتغير أبداً.
 * ② مطابقة البحث الذكية: كامل/بلا أصفار/أرقام فقط/بلا شرطة/جزئي.
 * ③ الفلتر الموحد اسم+هاتف+كود.
 * ④ قالب تقرير السجل الكامل: ترويسة+كود+تاريخ مرضي+زيارات بجدول روشتة+خطط+مرفقات+مالية+توقيع.
 * ⑤ الربط في الواجهات: عمود الكود وplaceholder البحث في كل الشاشات + زر الطباعة.
 * تشغيل: node --experimental-strip-types scripts/verify_party_codes_record.mjs
 */
import { readFileSync } from 'node:fs'
import { partyCode, matchesPartyCode, partySearchFilter } from '../src/core/partyCodes.ts'
import { renderPatientRecordHtml } from '../src/ui/print/printPatientRecord.ts'
import { emptyMedicalHistory } from '../src/core/prescription.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① الكود الثابت —')
ok(partyCode('PAT', 42) === 'PAT-0042', 'PAT-0042')
ok(partyCode('CUS', 1) === 'CUS-0001', 'CUS-0001')
ok(partyCode('SUP', 12345) === 'SUP-12345', 'يتمدد بعد 9999 بلا كسر')
ok(partyCode('EMP', 0) === 'EMP-0000', 'معرف غير صالح = 0000 (لا انهيار)')
// الثبات: نفس المعرف = نفس الكود دائماً
ok(partyCode('PAT', 42) === partyCode('PAT', 42), 'الكود ثابت لا يتغير')

console.log('— ② مطابقة البحث الذكية —')
ok(matchesPartyCode('PAT-0042', 'PAT', 42), 'كامل: PAT-0042')
ok(matchesPartyCode('pat-42', 'PAT', 42), 'حروف صغيرة بلا أصفار: pat-42')
ok(matchesPartyCode('PAT42', 'PAT', 42), 'بلا شرطة: PAT42')
ok(matchesPartyCode('42', 'PAT', 42), 'أرقام فقط: 42')
ok(matchesPartyCode('0042', 'PAT', 42), 'أرقام محشوة: 0042')
ok(!matchesPartyCode('43', 'PAT', 42), 'رقم مختلف لا يطابق')
ok(!matchesPartyCode('CUS-0042', 'PAT', 42), 'بادئة مختلفة لا تطابق (دقة — لا خلط عميل بمريض)')
ok(!matchesPartyCode('', 'PAT', 42), 'بحث فارغ لا يطابق')

console.log('— ③ الفلتر الموحد —')
const list = [
  { id: 1, nameAr: 'أحمد محمد', phone: '0100' },
  { id: 2, nameAr: 'محمد أحمد', phone: '0111' },
  { id: 42, nameAr: 'سارة', phone: '0122' },
]
ok(partySearchFilter(list, 'أحمد', 'PAT').length === 2, 'بالاسم: 2 نتيجة (تشابه الأسماء = مشكلة الاسم)')
ok(partySearchFilter(list, '42', 'PAT').length === 1 && partySearchFilter(list, '42', 'PAT')[0].id === 42, 'بالكود: نتيجة واحدة دقيقة')
ok(partySearchFilter(list, 'PAT-0002', 'PAT')[0].id === 2, 'كود كامل يصيب الهدف')
ok(partySearchFilter(list, '', 'PAT').length === 3, 'فارغ = الكل')

console.log('— ④ قالب تقرير السجل —')
const html = renderPatientRecordHtml({
  clinicName: 'عيادة الشفاء', doctorName: 'د/ محمد', clinicPhone: '0100', clinicAddress: 'المنصورة',
  patientName: 'أحمد', patientCode: 'PAT-0007', patientPhone: '0111', patientAge: '35 سنة', patientGender: 'ذكر',
  firstVisitDate: '2026-01-15',
  history: { ...emptyMedicalHistory(), bloodType: 'O+', chronicDiseases: ['سكري'], allergies: ['بنسلين'], smoker: true },
  visits: [{
    visitNumber: 'VIS-0001', date: '2026-01-15T10:00', kindLabel: 'كشف', complaint: 'صداع', diagnosis: 'التهاب',
    treatment: '', rxLines: [{ medication: 'أموكسيسيللين 500', form: 'strip', formQty: 2, timesPerDay: 2, everyHours: 0, mealRelation: 'after', mealsCount: 2, durationDays: 5, repeated: false, repeatTimes: 0, repeatEveryDays: 0, notes: '' }],
    vitals: { bpSys: 150, bpDia: 95, pulse: 80, tempC: 375, weightKg: 800 }, nextVisit: '2026-02-01', totalMinor: 10000, dueMinor: 3000,
  }],
  plans: [{ title: 'تقويم', doneSessions: 4, totalSessions: 4, totalFeeMinor: 50000 }],
  attachments: [{ kind: 'xray', name: 'أشعة صدر', addedAt: '2026-01-16T09:00' }],
  totalFees: '100 ج.م', totalDue: '30 ج.م', printedAt: '2026-09-16 12:00',
})
ok(html.includes('السجل الطبي الكامل'), 'عنوان التقرير')
ok(html.includes('PAT-0007'), 'كود المريض في البطاقة')
ok(html.includes('من بداية التعامل 2026-01-15'), 'بداية التعامل حتى الآن')
ok(html.includes('⚠️ حساسية') && html.includes('بنسلين'), 'الحساسية بارزة في التاريخ المرضي')
ok(html.includes('فصيلة الدم') && html.includes('O+') && html.includes('مدخّن'), 'التاريخ المرضي كامل')
ok(html.includes('VIS-0001') && html.includes('صداع') && html.includes('التهاب'), 'الزيارة بشكواها وتشخيصها')
ok(html.includes('أموكسيسيللين') && html.includes('بعد وجبتين'), 'روشتة الزيارة بجدول والجرعة نصاً عربياً')
ok(html.includes('ضغط 150/95'), 'العلامات الحيوية في السجل')
ok(html.includes('مكتملة ✓'), 'خطط العلاج بحالتها')
ok(html.includes('أشعة صدر'), 'المستندات المرفقة مسرودة')
ok(html.includes('إجمالي الأتعاب') && html.includes('المستحق حالياً'), 'الملخص المالي')
ok(html.includes('توقيع وختم الطبيب') && html.includes('سجل طبي سري'), 'التوقيع وعبارة السرية')
ok(html.includes('page-break-inside: avoid'), 'الزيارة لا تنقسم بين صفحتين (طباعة نظيفة)')

console.log('— ⑤ الربط في الواجهات —')
const clinic = readFileSync(new URL('../src/ui/pages/ClinicPages.tsx', import.meta.url), 'utf8')
ok(clinic.includes("partySearchFilter(clinicPatients, q, 'PAT')"), 'بحث المرضى بالكود')
ok(clinic.includes("partyCode('PAT'"), 'عمود كود المريض + تمريره للطباعة')
ok(clinic.includes('printFullRecord') && clinic.includes('طباعة السجل الكامل'), 'زر تقرير السجل الكامل في ملف المريض')
const parties = readFileSync(new URL('../src/ui/pages/PartiesPages.tsx', import.meta.url), 'utf8')
ok(parties.includes("matchesPartyCode(query, 'CUS'") && parties.includes("partyCode('CUS'"), 'العملاء: بحث + عمود CUS')
ok(parties.includes("matchesPartyCode(query, 'SUP'") && parties.includes("partyCode('SUP'"), 'الموردون: بحث + عمود SUP')
const emp = readFileSync(new URL('../src/ui/pages/EmployeesPage.tsx', import.meta.url), 'utf8')
ok(emp.includes("matchesPartyCode(query, 'EMP'"), 'الموظفون: بحث EMP')
const lab = readFileSync(new URL('../src/ui/pages/LabPages.tsx', import.meta.url), 'utf8')
ok(lab.includes("partySearchFilter(labPatients, q, 'LPT')") && lab.includes("partyCode('LPT'"), 'مرضى المعمل: بحث + عمود LPT')
const rxPrint = readFileSync(new URL('../src/ui/print/printPrescription.ts', import.meta.url), 'utf8')
ok(rxPrint.includes('patientCode'), 'الروشتة A5 تطبع كود المريض')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
