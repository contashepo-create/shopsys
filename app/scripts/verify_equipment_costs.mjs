/**
 * فحص تكاليف تشغيل المعدات وربحية الساعة (سد فجوة Point of Rental):
 * مصروف وقود/صيانة بقيد 5105، عقد ساعي بقراءات، وردانيات،
 * ثم ربحية المعدة = إيراد − تكاليف وربح الساعة من الساعات الموثقة.
 * تشغيل: node --experimental-strip-types scripts/verify_equipment_costs.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('🚜 التأسيس: معدة بأسعار وصيانة كل 250 ساعة')
S().addEquipment({ nameAr: 'حفار كوماتسو', code: 'EX-01', dailyRateMinor: 500000, hourlyRateMinor: 80000, monthlyRateMinor: 9000000, meterReading: 1200, serviceEveryHours: 250, lastServiceReading: 1200, notes: '' })
const eq = S().equipment.at(-1)

console.log('⛽ مصاريف التشغيل بقيودها')
S().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 150000, description: 'سولار 200 لتر' })
S().addEquipmentCost({ equipmentId: eq.id, kind: 'maintenance', amountMinor: 80000, treasury: '1101' })
S().addEquipmentCost({ equipmentId: eq.id, kind: 'operator', amountMinor: 100000 })
ok('ثلاثة مصاريف مسجلة', S().equipmentCosts.length === 3)
ok('5105 حمل 3300', bal('5105') === 330000)
ok('الخزينة دفعت 3300', bal('1101') === -330000)
throws('مبلغ صفري يُرفض', () => S().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 0 }), 'أكبر من صفر')
throws('معدة غير موجودة تُرفض', () => S().addEquipmentCost({ equipmentId: 999, kind: 'fuel', amountMinor: 100 }), 'غير موجودة')

console.log('📄 عقد ساعي بقراءات عداد + وردية')
S().openRental({
  customerId: null, equipmentId: eq.id,
  input: { equipmentName: eq.nameAr, days: 10, dailyRateMinor: 80000, depositMinor: 0, payment: 'cash', vatPercent: 0 },
  notes: '', rateType: 'hourly', startReading: 1200, treasury: '1101',
})
const rc = S().rentalContracts.at(-1)
S().closeRental(rc.id, 0, { endReading: 1210 }, '1101')
ok('العقد أُقفل بقراءة 1210', S().rentalContracts.at(-1).status === 'closed')
ok('عداد المعدة تقدم إلى 1210', S().equipment.find((e) => e.id === eq.id).meterReading === 1210)
S().addOperatorShift({ equipmentId: eq.id, operatorName: 'أسطى محمود', date: '2026-09-15', startReading: 1210, endReading: 1215, notes: '' })

console.log('📊 ربحية المعدة وربح الساعة')
const pr = S().getEquipmentProfit(eq.id)
// إيراد العقد 10×80000 = 800000؛ تكاليف 330000؛ ربح 470000؛ ساعات 10+5=15
ok('الإيراد 8000', pr.revenueMinor === 800000)
ok('التكاليف 3300', pr.costsMinor === 330000)
ok('الربح 4700', pr.profitMinor === 470000)
ok('الساعات الموثقة 15', pr.hours === 15)
ok('ربح الساعة ≈ 313.33', pr.profitPerHourMinor === Math.round(470000 / 15))
throws('ربحية معدة غير موجودة تُرفض', () => S().getEquipmentProfit(999), 'غير موجودة')

console.log('🔧 الصيانة الوقائية تتقدم مع العداد')
const { serviceStatus } = await import('../src/core/rentalMeter.ts')
const eqNow = S().equipment.find((e) => e.id === eq.id)
const svc = serviceStatus(eqNow.lastServiceReading, eqNow.serviceEveryHours, eqNow.meterReading)
ok('الخدمة القادمة عند 1450 والمتبقي 235 (العداد 1215 بعد الوردية)', svc.dueAtReading === 1450 && svc.remainingHours === 235)
S().recordEquipmentService(eq.id)
ok('تسجيل الخدمة صفّر الفترة عند 1215', S().equipment.find((e) => e.id === eq.id).lastServiceReading === 1215)

console.log('⚖️ الميزان')
ok('الدفتر متوازن', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 تكاليف المعدات وربحية الساعة تعمل مع الصيانة الوقائية')
