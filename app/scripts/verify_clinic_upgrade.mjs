/**
 * تحقق ترقية العيادة (طلبات المالك):
 * ① الروشتة المنظمة: بند لكل دواء — جرعة (مرات/ساعات) + وجبات (1/2/3) + مدة
 *   + تكرار (كم مرة/كل كم يوم) + شكل صرف (شريط/علبة) + ملاحظات + فحص صارم.
 * ② نصوص الجرعة العربية: «مرتين يومياً بعد الوجبة — 5 أيام» / «بعد وجبتين».
 * ③ التاريخ المرضي المنظم + ترحيل النص الحر القديم بلا فقد + ملخص التحذير.
 * ④ المرفقات: صورة/PDF فقط + حد الحجم + فحص.
 * ⑤ العلامات الحيوية + التنبيهات.
 * ⑥ حي: زيارة بروشتة منظمة تُحفظ بقيد متوازن + مرفق + ربط عميل +
 *    كشف حساب العميل يشمل زيارات العيادة الآجلة والتحصيل.
 * ⑦ الترحيب باسم المستخدم لا اسم المحل + قالب الطباعة الجدولي.
 * تشغيل: node --experimental-strip-types scripts/verify_clinic_upgrade.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

import { readFileSync } from 'node:fs'
import {
  emptyRxLine, validateRxLines, doseText, dispenseText, mealText, rxLineText,
  emptyMedicalHistory, migrateFreeHistory, historySummary, validateAttachment,
  vitalsText, vitalsFlags, MAX_ATTACHMENT_BYTES,
} from '../src/core/prescription.ts'
import { customerUnitDocs, customerStatement, statementBalance } from '../src/core/statements.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① بنود الروشتة والفحص —')
const line = { ...emptyRxLine(), medication: 'أموكسيسيللين 500', timesPerDay: 2, mealRelation: 'after', mealsCount: 1, durationDays: 5, form: 'strip', formQty: 2 }
ok(validateRxLines([line]).length === 0, 'بند سليم يمر')
ok(validateRxLines([{ ...line, medication: '' }]).some((e) => e.includes('اسم الدواء')), 'بند بلا اسم دواء يُرفض')
ok(validateRxLines([{ ...line, timesPerDay: 2, everyHours: 8 }]).some((e) => e.includes('ليس الاثنين')), 'مرات يومياً + كل X ساعات معاً = خطأ')
ok(validateRxLines([{ ...line, repeated: true, repeatTimes: 0 }]).some((e) => e.includes('كم مرة')), 'مكرر بلا عدد مرات = خطأ')
ok(validateRxLines([{ ...line, repeated: true, repeatTimes: 2, repeatEveryDays: 0 }]).some((e) => e.includes('كل كم يوم')), 'مكرر بلا فترة = خطأ')
ok(validateRxLines([{ ...line, mealsCount: 5 }]).some((e) => e.includes('الوجبات')), 'عدد وجبات غير 1/2/3 يُرفض')

console.log('— ② النصوص العربية —')
ok(doseText(line) === 'مرتين يومياً — بعد الوجبة — لمدة 5 أيام', `الجرعة: «${doseText(line)}»`)
ok(mealText('after', 2) === 'بعد وجبتين', '«بعد وجبتين» (طلب المالك)')
ok(mealText('after', 3) === 'بعد ثلاث وجبات', '«بعد ثلاث وجبات»')
ok(mealText('before', 1) === 'قبل الوجبة', '«قبل الوجبة»')
ok(mealText('none', 1) === '', 'بدون قيد وجبات = لا نص')
const hourly = { ...line, timesPerDay: 0, everyHours: 8 }
ok(doseText(hourly).startsWith('كل 8 ساعات'), 'الجرعة بالساعات: «كل 8 ساعات»')
const prn = { ...emptyRxLine(), medication: 'مسكن', timesPerDay: 0, everyHours: 0, durationDays: 0, mealRelation: 'none' }
ok(doseText(prn).includes('عند اللزوم'), 'بلا جرعة وبلا مدة = «عند اللزوم»')
const rep = { ...line, repeated: true, repeatTimes: 3, repeatEveryDays: 30 }
ok(dispenseText(rep) === '2 شريط · يُكرر 3 مرات كل 30 يوم', `الصرف والتكرار: «${dispenseText(rep)}»`)
ok(rxLineText(line).includes('أموكسيسيللين'), 'النص الكامل للسجل')

console.log('— ③ التاريخ المرضي المنظم —')
const h = { ...emptyMedicalHistory(), bloodType: 'O+', chronicDiseases: ['سكري', 'ضغط مرتفع'], allergies: ['بنسلين'], smoker: true }
const sum = historySummary(h)
ok(sum.startsWith('⚠️ حساسية: بنسلين'), 'الحساسية أول التحذير دائماً')
ok(sum.includes('سكري') && sum.includes('فصيلة O+') && sum.includes('مدخّن'), 'الملخص يشمل المزمنة والفصيلة والتدخين')
const migrated = migrateFreeHistory('  حساسية بنسلين قديمة  ')
ok(migrated.extraNotes === 'حساسية بنسلين قديمة' && migrated.chronicDiseases.length === 0, 'ترحيل النص الحر القديم لملاحظات بلا فقد')
ok(historySummary(emptyMedicalHistory()) === '', 'ملف فارغ = لا تحذير')

console.log('— ④ المرفقات —')
ok(validateAttachment({ name: 'أشعة صدر', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' }).length === 0, 'صورة سليمة تمر')
ok(validateAttachment({ name: 'تقرير', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' }).length === 0, 'PDF سليم يمر')
ok(validateAttachment({ name: 'ملف', mime: 'application/zip', dataUrl: 'data:application/zip;base64,AAAA' }).some((e) => e.includes('المسموح')), 'ZIP يُرفض — صورة أو PDF فقط')
ok(validateAttachment({ name: '', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }).some((e) => e.includes('اسم')), 'بلا اسم = خطأ')
const huge = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 100000) * 4 / 3))
ok(validateAttachment({ name: 'ضخم', mime: 'image/jpeg', dataUrl: huge }).some((e) => e.includes('كبير')), 'تجاوز حد الحجم يُرفض برسالة عربية')

console.log('— ⑤ العلامات الحيوية —')
const v = { bpSys: 150, bpDia: 95, pulse: 110, tempC: 385, weightKg: 805 }
ok(vitalsText(v) === 'ضغط 150/95 · نبض 110 · حرارة 38.5° · وزن 80.5 كجم', `النص: «${vitalsText(v)}»`)
const flags = vitalsFlags(v)
ok(flags.includes('ضغط مرتفع') && flags.includes('حمّى') && flags.includes('نبض سريع'), 'التنبيهات: ضغط مرتفع + حمّى + نبض سريع')
ok(vitalsFlags({ bpSys: 0, bpDia: 0, pulse: 0, tempC: 0, weightKg: 0 }).length === 0, 'لم تُقس = لا تنبيهات')

console.log('— ⑥ حي: زيارة + مرفق + ربط عميل + كشف حساب —')
const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])
S().addCustomer({ nameAr: 'مريض أحمد', phone: '0100', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cust = S().customers.at(-1)
S().addClinicPatient({ nameAr: 'مريض أحمد', phone: '0100', gender: 'male', birthDate: '1990-01-01', medicalHistory: '', history: h, linkedCustomerId: cust.id, notes: '' })
const patient = S().clinicPatients.at(-1)
ok(patient.linkedCustomerId === cust.id, 'المريض مرتبط بحساب العميل')
ok(patient.history.allergies.includes('بنسلين'), 'التاريخ المنظم محفوظ')

// زيارة بروشتة منظمة — 30 مسدد منها 100 (70 آجل)
const visit = S().addClinicVisit({
  patientId: patient.id, kind: 'checkup', complaint: 'حرارة', diagnosis: 'التهاب', treatment: '',
  rxLines: [line, rep], vitals: v, nextVisit: '2026-10-01',
  feeMinor: 10000, paidMinor: 3000, vatPercent: 0, planId: null, treasury: '1101',
})
ok(visit.rxLines.length === 2 && visit.totals.dueMinor === 7000, 'الزيارة حُفظت ببنود الروشتة والمتبقي 70')
const entry = S().journal.find((e) => e.id === visit.journalEntryId)
const dSum = entry.lines.reduce((a, l) => a + l.debit, 0), cSum = entry.lines.reduce((a, l) => a + l.credit, 0)
ok(dSum === cSum && dSum === 10000, 'قيد الزيارة متوازن (1101+1104 / 4108)')
let threw = false
try { S().addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', rxLines: [{ ...line, repeated: true, repeatTimes: 0 }], feeMinor: 5000, paidMinor: 5000, vatPercent: 0, planId: null }) } catch { threw = true }
ok(threw, 'روشتة ببند فاسد تُرفض قبل أي قيد')

// مرفق
S().addPatientAttachment({ patientId: patient.id, kind: 'xray', name: 'أشعة صدر', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,QUJD', notes: '' })
ok(S().patientAttachments.length === 1, 'المرفق حُفظ')
threw = false
try { S().addPatientAttachment({ patientId: patient.id, kind: 'other', name: 'ملف', mime: 'text/plain', dataUrl: 'data:text/plain;base64,QQ==', notes: '' }) } catch { threw = true }
ok(threw, 'مرفق بنوع ممنوع يُرفض')
S().removePatientAttachment(S().patientAttachments[0].id)
ok(S().patientAttachments.length === 0, 'حذف المرفق يعمل')

// كشف حساب العميل يشمل الزيارة الآجلة
const docs = customerUnitDocs({
  customerId: cust.id,
  clinicVisits: S().clinicVisits, clinicCollections: S().clinicCollections,
  linkedPatientIds: S().clinicPatients.filter((p) => p.linkedCustomerId === cust.id).map((p) => p.id),
})
ok(docs.some((d) => d.docLabel.includes('زيارة عيادة') && d.debitMinor === 7000), 'كشف العميل يُظهر زيارة العيادة الآجلة 70')
S().collectFromPatient(patient.id, 4000, '1101')
const docs2 = customerUnitDocs({
  customerId: cust.id,
  clinicVisits: S().clinicVisits, clinicCollections: S().clinicCollections,
  linkedPatientIds: [patient.id],
})
const bal = statementBalance(customerStatement({ customerId: cust.id, sales: [], saleReturns: [], allSales: [], vouchers: [], cheques: [], extraDocs: docs2 }))
ok(bal === 3000, `التحصيل 40 ظهر — رصيد الكشف ${bal / 100} = 30 المتبقي`)
ok(S().getPatientBalance(patient.id) === 3000, 'رصيد ملف المريض = رصيد الكشف (لا تناقض)')

console.log('— ⑦ الواجهة والطباعة —')
const dash = readFileSync(new URL('../src/ui/pages/Dashboard.tsx', import.meta.url), 'utf8')
ok(dash.includes('activeUserName') && dash.includes('currentUserId'), 'الترحيب باسم المستخدم النشط (لا اسم المحل)')
ok(!dash.includes('أهلاً — ${setup.shopName}'), 'صيغة الترحيب القديمة باسم المحل أزيلت')
const print = readFileSync(new URL('../src/ui/print/printPrescription.ts', import.meta.url), 'utf8')
ok(print.includes('table class="rx"') && print.includes('الجرعة والتعليمات'), 'قالب الطباعة جدول بنود كالفاتورة')
ok(print.includes('allergyWarning') && print.includes('nextVisit'), 'الطباعة تشمل تحذير الحساسية وموعد المراجعة')
ok(print.includes('legacyLines'), 'توافق خلفي: الزيارات القديمة النصية تُطبع أيضاً')
const page = readFileSync(new URL('../src/ui/pages/ClinicPages.tsx', import.meta.url), 'utf8')
ok(page.includes('RxLineEditor') && page.includes('HistoryEditor'), 'محررا الروشتة والتاريخ المنظمان موجودان')
ok(page.includes('compressImage') && page.includes('application/pdf'), 'إرفاق صورة (مضغوطة) أو PDF')
ok(page.includes('addCustomer') && page.includes('linkedCustomerId'), 'إنشاء/ربط حساب عميل مالي من ملف المريض')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
