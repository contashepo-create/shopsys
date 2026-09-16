/**
 * فحص باركود الميزان العالمي (طلب المالك: «لا أعلم أي ميزان سيتعامل معه العميل»):
 * ① خانة تحقق EAN-13 + تحقق سلامة القواعد
 * ② تفكيك بقاعدة وزن (بادئة 22) بسبيرة وبدونها + رفض السبيرة الخاطئة
 * ③ تفكيك بقاعدة سعر (بادئة 20) + تحويل السعر الخام إلى Minor بأي عملة
 * ④ التفكيك العالمي متعدد القواعد: الترتيب، التعطيل، بادئات مختلفة الأطوال
 * ⑤ توليد باركود بقاعدة (مع سبيرة عند 12 خانة) + دورة توليد↔تفكيك كاملة
 * ⑥ قائمة PLU: أكواد، تحذيرات (مفقود/مكرر)، CSV بترويسة وBOM
 * ⑦ التوافق الخلفي: parseScaleBarcode/buildScaleBarcode القديمان يعملان كما كانا
 * ⑧ متجر التطبيق: إضافة/تعديل/حذف قواعد بحماية التحقق
 * تشغيل: node --experimental-strip-types scripts/verify_scale_universal.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const bc = await import('../src/core/barcode.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}

const weightRule = { id: 1, nameAr: 'وزن 22', enabled: true, prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' }
const priceRule = { id: 2, nameAr: 'سعر 20', enabled: true, prefix: '20', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' }

console.log('\n1️⃣ خانة تحقق EAN-13 + تحقق سلامة القواعد')
{
  // مثال معياري معروف: 629104150021 → سبيرة 3
  ok('سبيرة صحيحة لمثال معياري', bc.ean13CheckDigit('629104150021') === 3)
  ok('سبيرة 220004200750', bc.ean13CheckDigit('220004200750') === 2)
  throws('أقل من 12 خانة يرمي', () => bc.ean13CheckDigit('12345'), '12 خانة')
  ok('قاعدة سليمة تمر', bc.validateScaleRule(weightRule).length === 0)
  ok('بادئة غير رقمية تُرفض', bc.validateScaleRule({ ...weightRule, prefix: 'AB' }).length === 1)
  ok('طول كلي فوق 13 يُرفض', bc.validateScaleRule({ ...weightRule, prefix: '223', itemCodeLen: 7, valueLen: 7 }).length === 1)
  ok('اسم فارغ يُرفض', bc.validateScaleRule({ ...weightRule, nameAr: ' ' }).length === 1)
}

console.log('\n2️⃣ قاعدة الوزن (بادئة 22)')
{
  const r1 = bc.parseWithRule('220004200750', weightRule)
  ok('12 خانة بلا سبيرة: الصنف 42 وزن 0.750', r1 && r1.itemCode === '42' && r1.weightKg === 0.75 && r1.priceRaw === null)
  const r2 = bc.parseWithRule('2200042007502', weightRule)
  ok('13 خانة بسبيرة صحيحة (2) تمر', r2 && r2.itemCode === '42' && r2.weightKg === 0.75)
  ok('سبيرة خاطئة تُرفض', bc.parseWithRule('2200042007501', weightRule) === null)
  ok('بادئة مختلفة تُرفض', bc.parseWithRule('230004200750', weightRule) === null)
  ok('وزن صفري يُرفض', bc.parseWithRule('220004200000', weightRule) === null)
  ok('كود صنف صفري يُرفض', bc.parseWithRule('220000000750', weightRule) === null)
  ok('حروف تُرفض', bc.parseWithRule('22ABC4200750', weightRule) === null)
  // checkDigit=require: بلا سبيرة يُرفض
  const strict = { ...weightRule, checkDigit: 'require' }
  ok('require: بلا سبيرة يُرفض', bc.parseWithRule('220004200750', strict) === null)
  ok('require: بسبيرة صحيحة يمر', bc.parseWithRule('2200042007502', strict) !== null)
  // checkDigit=none: الطول الزائد يُرفض
  const none = { ...weightRule, checkDigit: 'none' }
  ok('none: الطول الأساسي فقط', bc.parseWithRule('220004200750', none) !== null && bc.parseWithRule('2200042007502', none) === null)
  // كسور مختلفة: 2 كسور = عشرات جرامات
  const dec2 = { ...weightRule, valueDecimals: 2 }
  ok('كسور 2: 00075 → 0.75 كجم', bc.parseWithRule('220004200075', dec2).weightKg === 0.75)
}

console.log('\n3️⃣ قاعدة السعر (بادئة 20) + تحويل العملات')
{
  const r = bc.parseWithRule('200004201250', priceRule)
  ok('سعر خام 1250 (12.50) والوزن null', r && r.priceRaw === 1250 && r.weightKg === null && r.itemCode === '42')
  ok('تحويل: قرشان → قرشان (مصر)', bc.scalePriceToMinor(1250, 2, 2) === 1250)
  ok('تحويل: قرشان → 3 كسور (الكويت)', bc.scalePriceToMinor(1250, 2, 3) === 12500)
  ok('تحويل: قرشان → 0 كسور (تقريب نصفي)', bc.scalePriceToMinor(1250, 2, 0) === 13)
  ok('تحويل: 0 كسور → قرشان', bc.scalePriceToMinor(13, 0, 2) === 1300)
}

console.log('\n4️⃣ التفكيك العالمي متعدد القواعد')
{
  const rules = [weightRule, priceRule]
  const w = bc.parseScaleBarcodeUniversal('2200042007502', rules)
  ok('باركود 22 يلتقط قاعدة الوزن', w && w.rule.id === 1 && w.weightKg === 0.75)
  const p = bc.parseScaleBarcodeUniversal('200004201250', rules)
  ok('باركود 20 يلتقط قاعدة السعر', p && p.rule.id === 2 && p.priceRaw === 1250)
  ok('باركود مصنع عادي لا يطابق', bc.parseScaleBarcodeUniversal('6221031954016', rules) === null)
  ok('قاعدة معطلة تُتجاهل', bc.parseScaleBarcodeUniversal('200004201250', [weightRule, { ...priceRule, enabled: false }]) === null)
  // الترتيب يفوز: قاعدتان بنفس البادئة — الأولى الممكّنة تلتقط
  const dup = [{ ...priceRule, id: 9, prefix: '22', nameAr: 'سعر 22' }, weightRule]
  const hit = bc.parseScaleBarcodeUniversal('220004201250', dup)
  ok('بنفس البادئة: الأولى بالترتيب تفوز', hit && hit.rule.id === 9 && hit.priceRaw === 1250)
  // بادئة 3 خانات وكود قصير
  const shortRule = { id: 3, nameAr: 'قصير', enabled: true, prefix: '250', itemCodeLen: 4, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' }
  const s = bc.parseScaleBarcodeUniversal('250004201500', [shortRule])
  ok('بادئة 3 خانات + كود 4: الصنف 42 وزن 1.5', s && s.itemCode === '42' && s.weightKg === 1.5)
}

console.log('\n5️⃣ التوليد بقاعدة + دورة كاملة')
{
  const gen = bc.buildWithRule(42, 750, weightRule)
  ok('التوليد 12 خانة يضيف السبيرة تلقائياً', gen === '2200042007502')
  const round = bc.parseWithRule(gen, weightRule)
  ok('دورة توليد↔تفكيك: نفس الصنف والوزن', round && round.itemCode === '42' && round.weightKg === 0.75)
  throws('قيمة خارج النطاق ترمي', () => bc.buildWithRule(42, 100000, weightRule), 'خارج نطاق')
  throws('كود خارج النطاق يرمي', () => bc.buildWithRule(100000, 750, weightRule), 'خارج النطاق')
  // قاعدة أقصر من 12: لا سبيرة
  const shortRule = { id: 3, nameAr: 'ق', enabled: true, prefix: '25', itemCodeLen: 4, valueLen: 4, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' }
  ok('طول غير 12: بلا سبيرة', bc.buildWithRule(42, 750, shortRule) === '2500420750')
}

console.log('\n6️⃣ قائمة PLU وCSV')
{
  const items = [
    { nameAr: 'جبنة رومي', sku: 'ITM-42', barcodes: ['42'], priceMinor: 18000, soldByWeight: true, isActive: true },
    { nameAr: 'جبنة بيضاء', sku: 'ITM-43', barcodes: [], priceMinor: 9500, soldByWeight: true, isActive: true },
    { nameAr: 'لحم مفروم', sku: 'MEAT-X', barcodes: [], priceMinor: 40000, soldByWeight: true, isActive: true }, // sku بلا أرقام صالحة؟ MEAT-X → X لا... فيه لا أرقام
    { nameAr: 'مكرر الكود', sku: 'ITM-42', barcodes: [], priceMinor: 5000, soldByWeight: true, isActive: true },
    { nameAr: 'كوكاكولا', sku: 'ITM-99', barcodes: ['6221031954016'], priceMinor: 1000, soldByWeight: false, isActive: true },
    { nameAr: 'موقوف', sku: 'ITM-77', barcodes: [], priceMinor: 100, soldByWeight: true, isActive: false },
  ]
  const rows = bc.buildPluRows(items, 5, 2)
  ok('الموزونة النشطة فقط (4)', rows.length === 4)
  ok('كود من الباركود أولاً', rows[0].plu === '42' && rows[0].warning === null)
  ok('كود من SKU عند غياب الباركود', rows[1].plu === '43')
  ok('سعر الكيلو بالصيغة العشرية', rows[0].pricePerKg === '180.00')
  ok('بلا كود رقمي → تحذير', rows[2].plu === null && rows[2].warning !== null)
  ok('كود مكرر → تحذير باسم الصنف الأول', rows[3].warning !== null && rows[3].warning.includes('جبنة رومي'))
  const csv = bc.pluCsv(rows)
  ok('CSV بترويسة وBOM', csv.startsWith('\uFEFF') && csv.includes('PLU,Name,PricePerKg'))
  ok('CSV يستبعد أصناف بلا كود', !csv.includes('لحم مفروم') && csv.includes('جبنة رومي'))
  // باركود ميزان طويل مسجل للصنف لا يصلح PLU (أطول من القاعدة)
  ok('باركود أطول من القاعدة يُتجاهل ويسقط لSKU', bc.scalePluCode({ sku: 'ITM-55', barcodes: ['6221031954016'] }, 5) === '55')
}

console.log('\n7️⃣ التوافق الخلفي (الصيغة التاريخية)')
{
  const r = bc.parseScaleBarcode('220004200750')
  ok('القديم: 42 → 0.750', r && r.itemCode === '42' && r.weightKg === 0.75)
  const r13 = bc.parseScaleBarcode('2200042007502')
  ok('القديم: يقبل 13 خانة', r13 && r13.weightKg === 0.75)
  ok('القديم: بادئة أخرى null', bc.parseScaleBarcode('130004200750') === null)
  ok('القديم: التوليد كما كان', bc.buildScaleBarcode(42, 1.25) === '220004201250')
  const items = [{ id: 1, sku: 'ITM-42', barcodes: [], soldByWeight: true }]
  ok('matchScaleItem بالسـKU', bc.matchScaleItem('42', items)?.id === 1)
}

console.log('\n8️⃣ متجر التطبيق: إدارة القواعد بحماية')
{
  mem.clear()
  const { useAppStore } = await import('../src/stores/app.store.ts')
  const A = () => useAppStore.getState()
  ok('القاعدة الافتراضية (بادئة 22) موجودة', A().scaleRules.length === 1 && A().scaleRules[0].prefix === '22')
  A().addScaleRule({ nameAr: 'ميزان CAS', enabled: true, prefix: '20', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' })
  ok('إضافة قاعدة بمعرف تصاعدي', A().scaleRules.length === 2 && A().scaleRules[1].id === 2)
  throws('قاعدة فاسدة تُرفض', () => A().addScaleRule({ nameAr: 'x', enabled: true, prefix: 'ZZ', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' }), 'البادئة')
  A().updateScaleRule(2, { enabled: false })
  ok('تعطيل قاعدة', A().scaleRules.find((r) => r.id === 2).enabled === false)
  throws('تعديل فاسد يُرفض', () => A().updateScaleRule(2, { itemCodeLen: 99 }), 'كود الصنف')
  A().removeScaleRule(2)
  ok('حذف قاعدة', A().scaleRules.length === 1)
}

console.log(`\n═══ النتيجة: نجح ${pass} — فشل: ${fail} ═══`)
if (fail > 0) process.exit(1)
