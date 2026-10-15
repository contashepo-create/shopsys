/**
 * تحقق سد فجوات تقرير النشاط #12 (عيادة طبية — دفعة ب):
 * ① حالة الموعد الرباعية (محجوز/تم/ألغي/لم يحضر) بدل done المنطقي الثنائي.
 * ② زيارة بتغطية تأمينية: `registerInsuredVisit` يقسم الرسم بين المريض
 *    نقداً والجهة ذمةً (1110)، بلا أي دين على المريض (1104)، وقيد متوازن.
 * ③ الجرس المركزي: مواعيد اليوم غير المحسومة + مرضى برصيد متأخر.
 * تشغيل: node --experimental-strip-types scripts/verify_clinic_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { todaysUnfinishedAppointments, overduePatientBalances } = await import('../src/core/clinic.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

const S = () => useDataStore.getState()
S().seed([])

console.log('— ① حالة الموعد الرباعية —')
S().addClinicPatient({ nameAr: 'مريض الموعد', phone: '0101', gender: 'male', birthDate: '1990-01-01', medicalHistory: '', history: null, linkedCustomerId: null, notes: '' })
const apptPatient = S().clinicPatients.at(-1)
const todayIso = new Date().toISOString().slice(0, 10)
const appt = S().addAppointment({ patientId: apptPatient.id, date: todayIso, time: '10:00', purpose: 'كشف دوري' })
ok(appt.status === 'scheduled', 'الموعد الجديد بحالة محجوز افتراضياً')
S().setAppointmentStatus(appt.id, 'no_show')
ok(S().clinicAppointments.find((a) => a.id === appt.id).status === 'no_show', 'setAppointmentStatus يحدّث الحالة للم يحضر')
S().setAppointmentStatus(appt.id, 'done')
ok(S().clinicAppointments.find((a) => a.id === appt.id).status === 'done', 'setAppointmentStatus يحدّث الحالة لتم')

console.log('— ② زيارة بتغطية تأمينية —')
const provider = S().addInsuranceProvider({ nameAr: 'شركة التأمين التجريبية', coveragePercent: 70, phone: '' })
ok(provider.isActive === true, 'الجهة تُضاف نشطة افتراضياً')
S().addClinicPatient({ nameAr: 'مريض مؤمَّن', phone: '0102', gender: 'female', birthDate: '1985-05-05', medicalHistory: '', history: null, linkedCustomerId: null, notes: '' })
const insuredPatient = S().clinicPatients.at(-1)
const journalBefore = S().journal.length
const claimsBefore = S().insuranceClaims.length
const visit = S().registerInsuredVisit({
  patientId: insuredPatient.id, providerId: provider.id, kind: 'checkup', complaint: 'صداع', diagnosis: 'ضغط', treatment: '',
  feeMinor: 10000, vatPercent: 0, planId: null, treasury: '1101',
})
ok(visit.insuranceProviderId === provider.id, 'الزيارة مرتبطة بجهة التأمين')
ok(visit.totals.dueMinor === 0, 'لا دين على المريض إطلاقاً — نصيب الجهة ذمة منفصلة لا دين مريض')
ok(visit.totals.paidMinor === 3000, 'نصيب المريض نقداً = 30٪ من 100 = 30')
const entry = S().journal.find((e) => e.id === visit.journalEntryId)
const dSum = entry.lines.reduce((a, l) => a + l.debit, 0), cSum = entry.lines.reduce((a, l) => a + l.credit, 0)
ok(dSum === cSum && dSum === 10000, 'قيد الزيارة المؤمَّنة متوازن بكامل الرسم 100')
ok(S().journal.length === journalBefore + 1, 'قيد واحد فقط أُضيف')
ok(S().insuranceClaims.length === claimsBefore + 1, 'مطالبة تأمين واحدة أُنشئت')
const claim = S().insuranceClaims.at(-1)
ok(claim.source === 'clinic_visit' && claim.sourceId === visit.id && claim.claimMinor === 7000 && claim.settled === false, 'المطالبة: مصدرها زيارة عيادة بنصيب الجهة 70 غير مسواة')
ok(S().getClaimBalance(provider.id) === 7000, 'رصيد مطالبات الجهة = 70')
const settled = S().settleInsuranceClaims(provider.id, '1101')
ok(settled.total === 7000 && settled.count === 1, 'تحصيل مطالبات الجهة يسوي 70 لمطالبة واحدة')
ok(S().getClaimBalance(provider.id) === 0, 'بعد التحصيل لا رصيد متبقٍ للجهة')
let threw = false
try { S().registerInsuredVisit({ patientId: insuredPatient.id, providerId: 999999, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 5000, vatPercent: 0 }) } catch { threw = true }
ok(threw, 'زيارة بجهة تأمين غير موجودة تُرفض قبل أي قيد')

console.log('— ③ الجرس المركزي: مواعيد اليوم والأرصدة المتأخرة —')
const unfinished = todaysUnfinishedAppointments(S().clinicAppointments, (id) => S().clinicPatients.find((p) => p.id === id)?.nameAr ?? '?', new Date().toISOString())
ok(unfinished.length === 0, 'الموعد الوحيد اليوم أصبح محسوماً (تم) فلا يظهر كمعلّق')
const appt2 = S().addAppointment({ patientId: apptPatient.id, date: todayIso, time: '14:00', purpose: 'متابعة' })
const unfinished2 = todaysUnfinishedAppointments(S().clinicAppointments, (id) => S().clinicPatients.find((p) => p.id === id)?.nameAr ?? '?', new Date().toISOString())
ok(unfinished2.length === 1 && unfinished2[0].appointmentId === appt2.id, 'موعد محجوز جديد اليوم يظهر كغير محسوم')
S().setAppointmentStatus(appt2.id, 'cancelled')
const unfinished3 = todaysUnfinishedAppointments(S().clinicAppointments, (id) => S().clinicPatients.find((p) => p.id === id)?.nameAr ?? '?', new Date().toISOString())
ok(unfinished3.length === 0, 'موعد مُلغى لا يظهر كمعلّق')

S().addClinicPatient({ nameAr: 'مريض متأخر السداد', phone: '0103', gender: 'male', birthDate: '1980-01-01', medicalHistory: '', history: null, linkedCustomerId: null, notes: '' })
const latePatient = S().clinicPatients.at(-1)
const oldDate = new Date(Date.now() - 20 * 86_400_000).toISOString()
S().addClinicVisit({ patientId: latePatient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 5000, paidMinor: 1000, vatPercent: 0, planId: null, treasury: '1101' })
// نُعدّل تاريخ الزيارة يدوياً لمحاكاة تقادمها (الدالة خالصة تقرأ من القائمة المُمرَّرة فقط)
const lateVisits = S().clinicVisits.map((v) => (v.patientId === latePatient.id ? { ...v, date: oldDate } : v))
const overdue = overduePatientBalances(S().clinicPatients, lateVisits.map((v) => ({ patientId: v.patientId, date: v.date, dueMinor: v.totals.dueMinor })), S().getPatientBalance, new Date().toISOString(), 7)
ok(overdue.length === 1 && overdue[0].patientId === latePatient.id && overdue[0].balanceMinor === 4000, 'مريض برصيد 40 منذ 20 يوماً يظهر كمتأخر (حد 7 أيام)')
const overdueFresh = overduePatientBalances(S().clinicPatients, S().clinicVisits.map((v) => ({ patientId: v.patientId, date: v.date, dueMinor: v.totals.dueMinor })), S().getPatientBalance, new Date().toISOString(), 7)
ok(overdueFresh.length === 0, 'نفس المريض برصيد تاريخه اليوم لا يظهر بعد (لم يتجاوز المدة المعقولة)')

console.log('— ④ لا كود ميت: التوصيل الفعلي بالواجهة —')
const { readFileSync } = await import('node:fs')
const clinicPage = readFileSync(new URL('../src/ui/pages/ClinicPages.tsx', import.meta.url), 'utf8')
ok(clinicPage.includes('InsuranceProvidersSection'), 'شاشة العيادة تعرض إدارة جهات التأمين (لم تعد حصراً على المعمل)')
ok(clinicPage.includes('registerInsuredVisit') && clinicPage.includes('vInsuranceId'), 'نموذج الزيارة يستخدم registerInsuredVisit عند اختيار جهة تأمين')
const labPage = readFileSync(new URL('../src/ui/pages/LabPages.tsx', import.meta.url), 'utf8')
ok(labPage.includes("from '../components/InsuranceProvidersSection.tsx'") && labPage.includes('<InsuranceProvidersSection'), 'شاشة المعمل تستخدم المكوّن المشترك بدل نسخة مدمجة مكررة')
const header = readFileSync(new URL('../src/ui/layout/Header.tsx', import.meta.url), 'utf8')
ok(header.includes('todaysUnfinishedAppointments') && header.includes('clinicAppointmentsToday'), 'الجرس المركزي يستقبل مواعيد اليوم غير المحسومة')
ok(header.includes('overduePatientBalances'), 'الجرس المركزي يستقبل مرضى برصيد متأخر')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
