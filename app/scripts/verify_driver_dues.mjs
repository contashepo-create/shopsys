/**
 * فحص مستحقات السائقين: عمولة تُستحق مع الرحلة (5106/2111) بلا نقدية،
 * تتجمع عبر رحلات، وتُسوى دفعة واحدة (2111/خزينة) — بتوازن الدفتر.
 * تشغيل: node --experimental-strip-types scripts/verify_driver_dues.mjs
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

console.log('🚚 التأسيس: سائق ورحلتان بعمولة')
S().addEmployee({ nameAr: 'كابتن رمضان', phone: '', role: 'سائق', baseSalaryMinor: 0, hireDate: '2026-01-01', notes: '' })
const driver = S().employees.at(-1)
const tripArgs = (n) => ({
  customerId: null, vehicleId: null, driverId: driver.id,
  input: { fromLoc: 'الدمام', toLoc: 'الرياض', qty: 1, unitPriceMinor: 500000, payment: 'cash', vatPercent: 0, containerNumbers: [], expenses: [{ nameAr: 'سولار', qty: 1, unitAmountMinor: 100000, source: 'cash' }] },
  notes: n, treasury: '1101', driverCommissionMinor: 50000,
})
S().postTrip(tripArgs('رحلة 1'))
S().postTrip(tripArgs('رحلة 2'))
ok('استحقاقان مسجلان', S().driverDues.filter((d) => !d.settled).length === 2)
ok('2111 دائن بالعمولتين', bal('2111') === -100000)
ok('رصيد السائق 1000', S().getDriverDueBalance(driver.id) === 100000)
// 5106: مصاريف رحلتين 200000 + عمولتان 100000
ok('5106 = مصاريف + عمولات', bal('5106') === 300000)
const cashAfterTrips = bal('1101')
ok('لا نقدية خرجت للعمولة بعد', cashAfterTrips === 2 * 500000 - 2 * 100000)

console.log('🧾 الحواجز')
throws('عمولة بلا سائق تُرفض', () => S().postTrip({ ...tripArgs('x'), driverId: null }), 'اختيار سائق')
throws('تسوية سائق غير مسجل تُرفض', () => S().settleDriverDues(999), 'غير مسجل')

console.log('💵 التسوية المجمعة')
const r = S().settleDriverDues(driver.id, '1101')
ok('سُوي 1000 عن رحلتين', r.total === 100000 && r.count === 2)
ok('2111 صفر بعد التسوية', bal('2111') === 0)
ok('الخزينة دفعت العمولات', bal('1101') === cashAfterTrips - 100000)
ok('السجلات معلمة settled', S().driverDues.every((d) => d.settled))
throws('تسوية ثانية بلا رصيد تُرفض', () => S().settleDriverDues(driver.id), 'لا مستحقات')

console.log('⚖️ الميزان')
ok('الدفتر متوازن', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 مستحقات السائقين تعمل: استحقاق بالرحلة وتسوية مجمعة')
