/**
 * فحص جولة مراجعة نشاط المغسلة (الطلبات 6–9 — الجولة 11):
 * موعد التسليم الموعود promisedAt + إنذار «⏰ متأخرة»:
 * ① isTicketOverdue (نواة الصيانة — المغسلة تعمل بها)
 * ② openTicket يحفظ الموعد ويظهر بإيصال الاستلام المطبوع
 * تشغيل: node --experimental-strip-types scripts/verify_laundry_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { isTicketOverdue } = await import('../src/core/maintenance.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { renderTicketReceiptHtml } = await import('../src/ui/print/printMaintenanceTicket.ts')
const { EGP } = await import('../src/core/money.ts').then((m) => ({ EGP: { code: 'EGP', symbol: 'ج.م', decimals: 2 } }))
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ نواة التأخير')
const base = { status: 'received', promisedAt: '2026-09-16T18:00:00.000Z' }
ok('قبل الموعد = ليست متأخرة', !isTicketOverdue(base, '2026-09-16T12:00:00.000Z'))
ok('بعد الموعد = متأخرة', isTicketOverdue(base, '2026-09-16T19:00:00.000Z'))
ok('بلا موعد = لا تتأخر أبداً', !isTicketOverdue({ status: 'received' }, '2030-01-01T00:00:00.000Z'))
ok('المسلَّمة لا تتأخر', !isTicketOverdue({ ...base, status: 'delivered' }, '2030-01-01T00:00:00.000Z'))
ok('الملغاة لا تتأخر', !isTicketOverdue({ ...base, status: 'cancelled' }, '2030-01-01T00:00:00.000Z'))
ok('تحت التجهيز بعد الموعد = متأخرة', isTicketOverdue({ ...base, status: 'in_progress' }, '2026-09-17T00:00:00.000Z'))

console.log('\n2️⃣ الحفظ في المخزن')
const t = S().openTicket({
  customerId: null, customerName: 'أم كريم', customerPhone: '0100',
  deviceName: '3 بدل + 5 قمصان', issue: 'غسيل وكي', estimateMinor: 15_000,
  promisedAt: '2026-09-18T17:00:00.000Z', notes: 'بقعة على البدلة الكحلي',
})
ok('التذكرة تحمل الموعد', t.promisedAt === '2026-09-18T17:00:00.000Z')
const t2 = S().openTicket({ customerId: null, customerName: 'x', customerPhone: '', deviceName: 'y', issue: 'z', estimateMinor: 0, notes: '' })
ok('بلا موعد = undefined (لا سلسلة فارغة)', t2.promisedAt === undefined)

console.log('\n3️⃣ إيصال الاستلام المطبوع')
const html = renderTicketReceiptHtml({
  shopName: 'مغسلة النظافة', headerLines: [], ticketNumber: t.ticketNumber, date: t.date,
  customerName: 'أم كريم', customerPhone: '0100', deviceName: t.deviceName, issue: t.issue,
  estimateMinor: t.estimateMinor, promisedAt: t.promisedAt, notes: t.notes,
}, EGP)
ok('الموعد الموعود مطبوع', html.includes('موعد التسليم الموعود') && html.includes('2026-09-18 17:00'))
ok('القطع والتقدير والبقعة', html.includes('3 بدل + 5 قمصان') && html.includes('150') && html.includes('بقعة'))
const noP = renderTicketReceiptHtml({ shopName: 'م', headerLines: [], ticketNumber: 'MT-1', date: '2026-01-01', customerName: 'a', customerPhone: '', deviceName: 'b', issue: 'c', notes: '' }, EGP)
ok('بلا موعد لا يطبع السطر', !noP.includes('موعد التسليم الموعود'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
