/**
 * فحص أمر المالك: المخزون والمشتريات وحدتان أساسيتان في نشاط المقاولات —
 * الدورة الكاملة للمواد على المخزن الحقيقي:
 *   1) قالب المقاولات يشمل contracting + inventory + purchases
 *   2) شاشات المخزون والمشتريات وأذون الصرف كلها مرئية للمقاول في التنقل
 *   3) شراء مواد للمخزن: 1103 يزيد + متوسط مرجح + رصيد الصنف يزيد
 *   4) إذن صرف لمشروع: المخزون ينقص + التكلفة تُحمَّل على المشروع (5110/1103)
 *   5) ربحية المشروع تُحمَّل بتكلفة المواد المنصرفة بالقرش
 *   6) الميزان متوازن بعد كل خطوة
 * تشغيل: node --experimental-strip-types scripts/verify_contracting_inventory.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { ACTIVITY_TEMPLATES, effectiveModules } = await import('../src/core/activities.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })

console.log('🏗️ (1) قالب المقاولات: المخزون والمشتريات أساسيان')
const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === 'contracting')
ok('القالب يشمل contracting', tpl.modules.includes('contracting'))
ok('القالب يشمل inventory (أمر المالك)', tpl.modules.includes('inventory'))
ok('القالب يشمل purchases (أمر المالك)', tpl.modules.includes('purchases'))
const eff = effectiveModules('contracting', [])
ok('effectiveModules بلا رخصة إضافية يعيد الثلاثة', ['contracting', 'inventory', 'purchases'].every((m) => eff.includes(m)))

console.log('\n🧭 (2) التنقل: شاشات الدورة كلها مرئية للمقاول (فحص نصي لبوابات navCatalog)')
// navCatalog ملف .tsx لا يُستورد في node — نفحص بواباته نصياً:
// قسم المخزون خلف module:'inventory' والمشتريات خلف module:'purchases'
// وكلاهما الآن ضمن قالب المقاولات، فيظهران له في Sidebar (المفلتر بsetup.modules)
const { readFileSync } = await import('node:fs')
const nav = readFileSync(new URL('../src/ui/navCatalog.tsx', import.meta.url), 'utf8')
ok('قسم المخزون خلف بوابة inventory', /id: 'inventory'[^\n]*module: 'inventory'/.test(nav))
ok('قسم المشتريات خلف بوابة purchases', /id: 'purchases'[^\n]*module: 'purchases'/.test(nav))
ok('شاشة أذون صرف المواد موجودة بقسم المقاولات', nav.includes("path: '/contracting/material-issues'"))
ok('شاشة المشروعات موجودة', nav.includes("path: '/contracting/projects'"))
ok('قسم المبيعات خلف بوابة pos (لا يظهر للمقاول)', /id: 'sales'[^\n]*module: 'pos'/.test(nav) && !tpl.modules.includes('pos'))

console.log('\n🚛 (3) شراء مواد للمخزن: 1103 + متوسط مرجح')
S().seed([])
S().addSupplier({ ...party('شركة أسمنت الشرقية'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
S().addItem({
  nameAr: 'أسمنت بورتلاندي', sku: '', barcodes: [], categoryId: 1, baseUnit: 'شيكارة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
})
const cement = S().items.at(-1)
const stockBefore = bal('1103')
// 200 شيكارة × 180 ج + 2000 ج نقل موزع بالقيمة ⇒ تكلفة الشيكارة = 190
S().postPurchase({
  supplierId: sup.id, date: '2026-09-16',
  lines: [{ itemId: cement.id, qty: 200, unitPriceMinor: 18000, expiryDate: null }],
  expenses: [{ nameAr: 'نقل', amountMinor: 200000, allocation: 'value', payment: 'cash' }],
  paidMinor: 3800000, notes: '',
})
const afterBuy = S().items.find((it) => it.id === cement.id)
ok('رصيد الصنف 200 شيكارة', afterBuy.stockQty === 200)
ok('التكلفة بالمتوسط المرجح مع النقل = 190 ج', afterBuy.costMinor === 19000, `فعلي ${afterBuy.costMinor}`)
ok('1103 زاد بقيمة الشراء + النقل (38,000 ج)', bal('1103') - stockBefore === 3800000, `فعلي ${bal('1103') - stockBefore}`)
ok('الميزان متوازن بعد الشراء', balanced())

console.log('\n📦 (4) إذن صرف لمشروع: مخزون ينقص + 5110 يتحمل')
S().addEmployee({ ...party('أمين المخزن'), jobTitle: 'أمين مخزن', hireDate: '2025-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true })
const keeper = S().employees.at(-1)
S().addEmployee({ ...party('مهندس الموقع'), jobTitle: 'مهندس موقع', hireDate: '2025-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true })
const eng = S().employees.at(-1)
S().addProject({ nameAr: 'برج النخيل', clientName: 'شركة العمران', clientId: null, contractValueMinor: 500000000, retentionPercent: 5, startDate: '2026-09-01', notes: '' })
const project = S().projects.at(-1)
const c5110Before = bal('5110'), inv1103Before = bal('1103')
const req = S().issueMaterials({
  projectId: project.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: eng.id,
  lines: [{ itemId: cement.id, qty: 50, unitAr: '' }], notes: 'صبة القواعد',
})
ok('الإذن برقم متسلسل رسمي', /^MRQ-\d{4}$/.test(req.reqNumber))
ok('تكلفة الإذن = 50 × 190 = 9,500 ج', req.totalCostMinor === 950000, `فعلي ${req.totalCostMinor}`)
ok('المخزون نقص إلى 150 شيكارة', S().items.find((it) => it.id === cement.id).stockQty === 150)
ok('5110 تحمَّل بتكلفة المواد', bal('5110') - c5110Before === 950000)
ok('1103 نقص بنفس القيمة (لا فقد قرش)', inv1103Before - bal('1103') === 950000)
ok('الميزان متوازن بعد الصرف', balanced())

console.log('\n📈 (5) ربحية المشروع تتحمل المواد المنصرفة')
const costs = S().projectCosts.filter((c) => c.projectId === project.id)
ok('التكلفة مسجلة على المشروع ببند مواد', costs.some((c) => c.kind === 'materials' && c.amountMinor === 950000))
const profit = S().getProjectProfit(project.id)
ok('تقرير الربحية: بند المواد = 9,500 ج', profit.costsByKind.materials === 950000, `فعلي ${profit.costsByKind.materials}`)

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
