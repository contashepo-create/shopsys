/**
 * فحص جولة المراجعة الختامية — النشاط العام (الطلبات 6–9 — الجولة 15):
 * مركز التنبيهات الموحد (core/alerts.ts: collectBusinessAlerts):
 * نواقص + صلاحية منتهية/تقارب + أقساط متأخرة/قريبة + شيكات + حد ائتمان،
 * الخطر أولاً — كما بلوحات البرامج التجارية الرائدة.
 * تشغيل: node --experimental-strip-types scripts/verify_general_review.mjs
 */
const { collectBusinessAlerts } = await import('../src/core/alerts.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

const fmt = (m) => String(m / 100)
const base = {
  todayIso: '2026-09-16T10:00:00.000Z',
  items: [], batches: [], installmentAlerts: [], cheques: [], customers: [],
  customerBalances: () => 0, fmt,
}

console.log('\n1️⃣ الحالة الهادئة')
ok('لا شيء يستحق التنبيه = قائمة فارغة', collectBusinessAlerts(base).length === 0)

console.log('\n2️⃣ كل نوع على حدة')
const low = collectBusinessAlerts({ ...base, items: [{ id: 1, nameAr: 'أرز', stockQty: 2, minQty: 5, isActive: true }] })
ok('نواقص المخزون تحذير ويوجه للأصناف', low.length === 1 && low[0].kind === 'low_stock' && low[0].severity === 'warn' && low[0].route === '/inventory/items')
ok('الصنف الموقوف لا يُنبه', collectBusinessAlerts({ ...base, items: [{ id: 1, nameAr: 'x', stockQty: 0, minQty: 5, isActive: false }] }).length === 0)

const items = [{ id: 1, nameAr: 'لبن', stockQty: 9, minQty: 0, isActive: true }]
const exp = collectBusinessAlerts({ ...base, items, batches: [{ itemId: 1, expiryDate: '2026-09-10', qty: 3 }] })
ok('دفعة منتهية = خطر 🔴', exp.length === 1 && exp[0].kind === 'expired' && exp[0].severity === 'danger' && exp[0].detailAr.includes('لبن'))
const expSoon = collectBusinessAlerts({ ...base, items, batches: [{ itemId: 1, expiryDate: '2026-10-01', qty: 3 }] })
ok('تنتهي خلال 30 يوماً = تحذير', expSoon.length === 1 && expSoon[0].kind === 'expiring' && expSoon[0].severity === 'warn')
ok('دفعة فارغة الكمية تُتجاهل', collectBusinessAlerts({ ...base, items, batches: [{ itemId: 1, expiryDate: '2026-09-01', qty: 0 }] }).length === 0)
ok('دفعة بلا تاريخ تُتجاهل', collectBusinessAlerts({ ...base, items, batches: [{ itemId: 1, expiryDate: null, qty: 5 }] }).length === 0)

const ins = collectBusinessAlerts({ ...base, installmentAlerts: [
  { kind: 'overdue', amountDueMinor: 10_000, dueDate: '2026-09-01' },
  { kind: 'due_soon', amountDueMinor: 5_000, dueDate: '2026-09-20' },
] })
ok('قسط متأخر خطر + قريب تحذير، والمجاميع صحيحة',
  ins.length === 2 && ins[0].kind === 'installment_overdue' && ins[0].detailAr.includes('100') && ins[1].detailAr.includes('50'))

const chq = collectBusinessAlerts({ ...base, cheques: [
  { chequeNumber: '123', direction: 'in', status: 'held', dueDate: '2026-09-18', amountMinor: 50_000, partyName: 'شركة س' },
  { chequeNumber: '999', direction: 'in', status: 'collected', dueDate: '2026-09-18', amountMinor: 1, partyName: 'x' },
] })
ok('شيك بالحافظة يستحق قريباً يُنبه والمحصَّل لا', chq.length === 1 && chq[0].kind === 'cheque_due' && chq[0].detailAr.includes('123'))
ok('شيك متجاوز استحقاقه = خطر', collectBusinessAlerts({ ...base, cheques: [{ chequeNumber: '5', direction: 'out', status: 'issued', dueDate: '2026-09-10', amountMinor: 1, partyName: 'م' }] })[0].severity === 'danger')

const cl = collectBusinessAlerts({ ...base, customers: [{ id: 1, nameAr: 'سمير', creditLimitMinor: 100_000 }], customerBalances: () => 150_000 })
ok('تجاوز حد الائتمان = خطر باسم العميل', cl.length === 1 && cl[0].kind === 'credit_limit' && cl[0].severity === 'danger' && cl[0].detailAr.includes('سمير'))
ok('حد ائتمان 0 = بلا رقابة', collectBusinessAlerts({ ...base, customers: [{ id: 1, nameAr: 'س', creditLimitMinor: 0 }], customerBalances: () => 9e9 }).length === 0)

console.log('\n3️⃣ الترتيب')
const mixed = collectBusinessAlerts({
  ...base,
  items: [{ id: 1, nameAr: 'أرز', stockQty: 1, minQty: 5, isActive: true }],
  batches: [{ itemId: 1, expiryDate: '2026-09-01', qty: 2 }],
})
ok('الخطر (منتهية) قبل التحذير (نواقص)', mixed[0].severity === 'danger' && mixed[1].severity === 'warn')

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
