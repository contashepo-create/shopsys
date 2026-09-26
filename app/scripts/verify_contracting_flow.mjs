/**
 * فحص المنطق المحاسبي لنشاط المقاولات — دورة حياة مشروع كاملة على المخزن الحقيقي:
 * عرض سعر ← فوز ← مشروع ← مستخلصات (نقدي/آجل بمحتجز وضريبة) ← تكاليف (نقدي/آجل/عهدة)
 * ← فاتورة شراء مشروع (5110 لا مخزون!) ← تحصيل آجل ← إفراج محتجز وإقفال ← أرصدة نهائية.
 * تشغيل: node --experimental-strip-types scripts/verify_contracting_flow.mjs
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const S = () => useDataStore.getState()
const balanceOf = (code) => {
  let d = 0, c = 0
  for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) { d += l.debit; c += l.credit }
  return d - c
}
const trialBalanced = () => {
  let d = 0, c = 0
  for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }
  return d === c
}

console.log('📋 عرض سعر ← فوز ← مشروع')
S().addQuotation({
  kind: 'tender', clientName: 'هيئة الطرق', titleAr: 'رصف طريق قرية النور',
  validUntil: '2026-12-31', notes: '',
  lines: [{ descriptionAr: 'رصف أسفلت', qty: 1000, unitAr: 'م2', unitPriceMinor: 5000 }],
})
const q = S().quotations.at(-1)
S().setQuotationStatus(q.id, 'submitted')
S().setQuotationStatus(q.id, 'won')
const proj = S().convertQuotationToProject(q.id, 10)
ok('العرض تحول لمشروع بقيمة العقد = إجمالي البنود', proj.contractValueMinor === 5_000_000)
ok('لا قيود حتى الآن (العرض والمشروع مستندات لا قيود)', S().journal.length === 0)

console.log('🧾 مستخلص أول نقدي إلى البنك 1102 (محتجز 10٪ + ضريبة 14٪)')
const ex1 = S().addProjectExtract({ projectId: proj.id, grossMinor: 2_000_000, vatPercent: 14, payment: 'cash', description: 'أعمال الحفر والأساسات', treasury: '1102' })
ok('المستحق = 2م + 280ألف ضريبة − 200ألف محتجز', ex1.totals.dueMinor === 2_080_000)
ok('البنك استلم المستحق فقط', balanceOf('1102') === 2_080_000)
ok('المحتجز 1105 أصل معلق', balanceOf('1105') === 200_000)
ok('الإيراد 4107 بكامل قيمة الأعمال', balanceOf('4107') === -2_000_000)
ok('الضريبة 2102 التزام كامل', balanceOf('2102') === -280_000)

console.log('🧾 مستخلص ثانٍ آجل (على الهيئة)')
S().addProjectExtract({ projectId: proj.id, grossMinor: 1_000_000, vatPercent: 14, payment: 'credit', description: 'طبقة الأساس', treasury: '1101' })
ok('العملاء 1104 عليهم مستحق المستخلص الثاني', balanceOf('1104') === 1_040_000)
ok('المحتجزات تراكمت 300 ألف', balanceOf('1105') === 300_000)

console.log('💰 تكاليف: نقدي + آجل + من عهدة مشرف')
S().addProjectCost({ projectId: proj.id, kind: 'labor', amountMinor: 400_000, payment: 'cash', description: 'أجور عمال أسبوعية', treasury: '1101' })
S().addProjectCost({ projectId: proj.id, kind: 'subcontract', amountMinor: 600_000, payment: 'credit', description: 'مقاول باطن كباري' })
S().addEmployee({ nameAr: 'مشرف الموقع', baseSalaryMinor: 400000, allowancesMinor: 0 })
const emp = S().employees.at(-1)
const file = S().openCustodyFile({ employeeId: emp.id, projectId: proj.id, reason: 'نثريات موقع الطريق', notes: '' })
S().fundCustodyFile({ fileId: file.id, amountMinor: 300_000, treasury: '1101', description: 'عهدة الموقع' })
S().addProjectCost({ projectId: proj.id, kind: 'other', amountMinor: 250_000, payment: 'cash', description: 'وقود ومعدات صغيرة', custodyFileId: file.id })
ok('تكلفة العهدة خُصمت من ملفها (متبقٍ 500)', S().getCustodySummary(file.id).remainingMinor === 50_000)
ok('5110 جمعت الثلاث تكاليف', balanceOf('5110') === 1_250_000)
ok('المقاول الباطن دائن في 2101', balanceOf('2101') === -600_000)

console.log('🛒 فاتورة شراء مربوطة بالمشروع: 5110 لا مخزون (إصلاح الازدواج)')
S().addSupplier({ nameAr: 'مصنع الأسفلت' })
const sup = S().suppliers.at(-1)
S().addCategory({ nameAr: 'خامات', parentId: null })
S().addItem({ nameAr: 'أسفلت', categoryId: S().categories.at(-1).id, unit: 'طن', salePriceMinor: 0, barcodes: [] })
const item = S().items.at(-1)
const stockBefore = S().items.find((i) => i.id === item.id).stockQty
const inv = S().postPurchase({
  supplierId: sup.id, date: '2026-09-10',
  lines: [{ itemId: item.id, qty: 50, unitPriceMinor: 10_000, expiryDate: null }],
  expenses: [{ nameAr: 'نولون', amountMinor: 100_000, method: 'qty' }],
  paidMinor: 300_000, treasury: '1101', projectId: proj.id, notes: '',
})
ok('المخزون لم يرتفع (بضاعة موقع لا رف)', S().items.find((i) => i.id === item.id).stockQty === stockBefore)
ok('1103 لم يُمس بفاتورة المشروع', balanceOf('1103') === 0)
ok('5110 حملت الفاتورة كاملة بمصاريفها', balanceOf('5110') === 1_250_000 + 600_000)
ok('بند تكلفة «مواد» انضم للمشروع', S().projectCosts.some((c) => c.projectId === proj.id && c.kind === 'materials' && c.amountMinor === 600_000))
throws('مرتجع مخزني لفاتورة مشروع يُرفض', () => S().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[item.id, 5]]), refund: 'cash', reason: 'x' }), 'مشروع')

console.log('📈 ربحية المشروع')
const profit = S().getProjectProfit(proj.id)
ok('المستخلصات 3م', profit.extractedMinor === 3_000_000)
ok('التكاليف = 1.25م + 0.6م فاتورة', profit.costsMinor === 1_850_000)
ok('الربح = 1.15م', profit.profitMinor === 1_150_000)
ok('محتجزات معلقة 300 ألف', profit.retentionHeldMinor === 300_000)

console.log('💵 تحصيل المستخلص الآجل بسند قبض')
S().addCustomer({ nameAr: 'هيئة الطرق' })
const client = S().customers.at(-1)
S().postVoucher({ kind: 'receipt', treasury: '1102', counterAccountCode: '1104', amountMinor: 1_040_000, description: 'تحصيل مستخلص الهيئة', partyKind: 'customer', partyId: client.id })
ok('ذمة الهيئة صفرت', balanceOf('1104') === 0)

console.log('🔓 الإفراج عن المحتجزات وإقفال المشروع')
S().releaseRetention(proj.id, '1102')
ok('المحتجزات صفرت', balanceOf('1105') === 0)
ok('المشروع أُقفل', S().projects.find((p) => p.id === proj.id).status === 'completed')
throws('مستخلص على مشروع مقفل يُرفض', () => S().addProjectExtract({ projectId: proj.id, grossMinor: 1000, vatPercent: 0, payment: 'cash', description: 'x', treasury: '1101' }), 'مقفل')
throws('تكلفة على مشروع مقفل تُرفض', () => S().addProjectCost({ projectId: proj.id, kind: 'other', amountMinor: 1000, payment: 'cash', description: 'x', treasury: '1101' }), 'مقفل')
throws('فاتورة شراء لمشروع مقفل تُرفض', () => S().postPurchase({ supplierId: sup.id, date: '2026-09-20', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1000, expiryDate: null }], expenses: [], paidMinor: 0, projectId: proj.id, notes: '' }), 'مقفل')

console.log('⚖️ الأرصدة النهائية تحكي القصة كاملة')
ok('كل القيود متوازنة', trialBalanced())
// البنك: مستخلص1 (2.08م) + تحصيل آجل (1.04م) + محتجزات (0.3م)
ok('البنك 1102 = 3.42م', balanceOf('1102') === 3_420_000)
// الخزينة: −أجور 0.4م − عهدة 0.3م − مدفوع فاتورة 0.3م
ok('الخزينة 1101 عليها المدفوعات', balanceOf('1101') === -1_000_000)
// المعادلة المحاسبية
const bal = {}
for (const e of S().journal) for (const l of e.lines) bal[l.accountCode] = (bal[l.accountCode] ?? 0) + l.debit - l.credit
const root = (p) => Object.entries(bal).filter(([c]) => c.startsWith(p)).reduce((a, [, v]) => a + v, 0)
ok('الأصول = الخصوم + (الإيرادات − المصروفات)', root('1') === -root('2') + (-root('4') - root('5')))

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 المنطق المحاسبي للمقاولات سليم من العرض حتى الإقفال')
