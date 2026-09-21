// تحقق ترقية تأجير المعدات الثقيلة (القرار 25):
// عدّاد الساعات، تسوية ساعي/يومي/شهري، قيد التجاوز، الوردانيات، الصيانة الوقائية
// التشغيل: node --experimental-strip-types scripts/verify_rental_meter.mjs
import {
  isValidMeterReading, usageHours, daysBetweenDates, computeUsageBilling,
  buildExtraUsageEntry, validateOperatorShift, shiftHours, shiftsSummary, serviceStatus,
} from '../src/core/rentalMeter.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('— عدّاد الساعات —')
check('قراءة صحيحة بدقة عُشر ساعة', isValidMeterReading(1234.5))
check('يرفض دقة أعلى من عُشر', !isValidMeterReading(10.55))
check('يرفض السالب', !isValidMeterReading(-1))
check('ساعات بين قراءتين', usageHours(100, 108.5) === 8.5)
let threw = false
try { usageHours(200, 100) } catch { threw = true }
check('العدّاد لا يرجع للخلف', threw)

console.log('— تسوية الاستخدام —')
// ساعي: حجز 8 ساعات، استخدم 10.3 ⇒ 11 ساعة فعلية (تقريب لأعلى)، تجاوز 3
const h = computeUsageBilling({ rateType: 'hourly', rateMinor: 50000, bookedUnits: 8, startReading: 1000, endReading: 1010.3 })
check('ساعي: كسر الساعة يُحاسب لأعلى', h.actualUnits === 11)
check('ساعي: التجاوز 3 ساعات بقيمته', h.extraUnits === 3 && h.extraMinor === 150000)
// استخدام أقل من المحجوز ⇒ لا رد (عقد حجز)
const h2 = computeUsageBilling({ rateType: 'hourly', rateMinor: 50000, bookedUnits: 8, startReading: 1000, endReading: 1004 })
check('استخدام أقل: لا تجاوز ولا ردّ', h2.extraUnits === 0 && h2.extraMinor === 0)
// يومي: حجز 5 أيام، أعادها بعد 7
check('أيام بين تاريخين', daysBetweenDates('2026-09-01', '2026-09-08') === 7)
const d = computeUsageBilling({ rateType: 'daily', rateMinor: 200000, bookedUnits: 5, startDate: '2026-09-01', endDate: '2026-09-08' })
check('يومي: تجاوز يومين', d.extraUnits === 2 && d.extraMinor === 400000)
// شهري: حجز شهر، أعادها بعد 31 يوماً ⇒ شهران مبدوءان
const m = computeUsageBilling({ rateType: 'monthly', rateMinor: 3000000, bookedUnits: 1, startDate: '2026-01-01', endDate: '2026-02-01' })
check('شهري: 31 يوماً = شهران مبدوءان (تجاوز شهر)', m.actualUnits === 2 && m.extraMinor === 3000000)
threw = false
try { computeUsageBilling({ rateType: 'hourly', rateMinor: 50000, bookedUnits: 8 }) } catch { threw = true }
check('ساعي بلا قراءات يرمي', threw)

console.log('— قيد التجاوز —')
const sum = (lines, k) => lines.reduce((a, l) => a + l[k], 0)
const e1 = buildExtraUsageEntry(150000, 14, 'cash', 'RC-0001')
check('نقدي: خزينة مدين بالإجمالي مع الضريبة', e1[0].accountCode === '1101' && e1[0].debit === 150000 + 21000)
check('4104 إيراد و2102 ضريبة ومتوازن', e1.some((l) => l.accountCode === '4104' && l.credit === 150000) && sum(e1, 'debit') === sum(e1, 'credit'))
const e2 = buildExtraUsageEntry(100000, 0, 'credit', 'RC-0002')
check('آجل بلا ضريبة: 1104 مدين وسطران فقط', e2[0].accountCode === '1104' && e2.length === 2)
threw = false
try { buildExtraUsageEntry(0, 14, 'cash', 'X') } catch { threw = true }
check('يرفض تجاوزاً صفرياً', threw)

console.log('— الوردانيات —')
check('وردية سليمة', validateOperatorShift({ equipmentId: 1, operatorName: 'محمد', date: '2026-09-14', startReading: 100, endReading: 108, notes: '' }).length === 0)
check('يرفض اسماً فارغاً وقراءة راجعة', validateOperatorShift({ equipmentId: 1, operatorName: ' ', date: '2026-09-14', startReading: 108, endReading: 100, notes: '' }).length === 2)
check('ساعات الوردية', shiftHours({ startReading: 100, endReading: 107.5 }) === 7.5)
const shifts = [
  { id: 1, equipmentId: 1, operatorName: 'محمد', date: '2026-09-13', startReading: 100, endReading: 108, notes: '' },
  { id: 2, equipmentId: 1, operatorName: 'أحمد', date: '2026-09-14', startReading: 108, endReading: 112.5, notes: '' },
  { id: 3, equipmentId: 1, operatorName: 'محمد', date: '2026-09-14', startReading: 112.5, endReading: 118, notes: '' },
  { id: 4, equipmentId: 2, operatorName: 'سعيد', date: '2026-09-14', startReading: 0, endReading: 3, notes: '' },
]
const sm = shiftsSummary(shifts, 1)
check('إجمالي ساعات المعدة 1 = 18', sm.totalHours === 18)
check('محمد أعلى المشغلين بـ13.5 ساعة في ورديتين', sm.byOperator[0].operatorName === 'محمد' && sm.byOperator[0].hours === 13.5 && sm.byOperator[0].shiftCount === 2)
check('معدة أخرى لا تختلط', shiftsSummary(shifts, 2).totalHours === 3)

console.log('— الصيانة الوقائية —')
check('لا خطة (0) ⇒ null', serviceStatus(0, 0, 500) === null)
const s1 = serviceStatus(1000, 250, 1100)
check('الخدمة القادمة عند 1250 والمتبقي 150', s1.dueAtReading === 1250 && s1.remainingHours === 150 && !s1.overdue)
check('التقدم 40٪', Math.round(s1.progress * 100) === 40)
const s2 = serviceStatus(1000, 250, 1300)
check('متأخرة 50 ساعة: overdue والتقدم مُشبع 100٪', s2.overdue && s2.remainingHours === -50 && s2.progress === 1)

console.log(`\nعدّاد المعدات: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
