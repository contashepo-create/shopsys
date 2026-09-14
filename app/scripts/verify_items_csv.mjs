// تحقق استيراد/تصدير الأصناف CSV (المؤجل من المرحلة 1):
// parseCsv (اقتباس RFC 4180)، buildItemsCsv (BOM + ترويسة)، parseItemsCsv
// (تحقق صفّي، تخطي مكرر، أرقام عربية، رسائل بأرقام الصفوف)
// التشغيل: node --experimental-strip-types scripts/verify_items_csv.mjs
import { parseCsv, buildItemsCsv, parseItemsCsv, CSV_HEADERS } from '../src/core/itemsCsv.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const CUR = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }
const NO_EXISTING = { names: new Set(), barcodes: new Set() }

console.log('— parseCsv —')
check('صفوف وخلايا بسيطة', JSON.stringify(parseCsv('a,b\nc,d')) === JSON.stringify([['a', 'b'], ['c', 'd']]))
check('خلية مقتبسة بفاصلة', parseCsv('"جبنة, قديمة",5')[0][0] === 'جبنة, قديمة')
check('اقتباس مزدوج داخل خلية', parseCsv('"قال ""مرحباً""",1')[0][0] === 'قال "مرحباً"')
check('سطر جديد داخل خلية مقتبسة', parseCsv('"سطر1\nسطر2",x')[0][0] === 'سطر1\nسطر2')
check('CRLF ينهي الصف', parseCsv('a,b\r\nc,d').length === 2)
check('يسقط الصفوف الفارغة', parseCsv('a,b\n\n\nc,d').length === 2)
check('يزيل BOM', parseCsv('\uFEFFالاسم,x')[0][0] === 'الاسم')

console.log('— buildItemsCsv —')
const rows = [
  { nameAr: 'لبن كامل', barcode: '6221001', categoryName: 'ألبان', baseUnit: 'قطعة', priceMinor: 3550, costMinor: 2800, stockQty: 24, minQty: 6 },
  { nameAr: 'جبنة "رومي", قديمة', barcode: '', categoryName: '', baseUnit: 'كجم', priceMinor: 26000, costMinor: 21000, stockQty: 5.5, minQty: 1 },
]
const csv = buildItemsCsv(rows, CUR)
check('يبدأ بـBOM', csv.startsWith('\uFEFF'))
check('الترويسة كاملة', csv.includes(CSV_HEADERS.join(',')))
check('السعر منسق بلا فواصل آلاف', csv.includes('35.50') && csv.includes('260.00'))
check('الاسم الخطر مقتبس ومهرَّب', csv.includes('"جبنة ""رومي"", قديمة"'))
// دورة كاملة: تصدير ← استيراد
const roundtrip = parseItemsCsv(csv, CUR, NO_EXISTING)
check('دورة كاملة: صفان بلا أخطاء', roundtrip.items.length === 2 && roundtrip.errors.length === 0)
check('دورة كاملة: السعر عاد كما كان', roundtrip.items[0].priceMinor === 3550 && roundtrip.items[1].priceMinor === 26000)
check('دورة كاملة: الاسم الخطر سليم', roundtrip.items[1].nameAr === 'جبنة "رومي", قديمة')
check('دورة كاملة: الرصيد الكسري', roundtrip.items[1].stockQty === 5.5)

console.log('— parseItemsCsv: تحقق صفّي —')
const H = CSV_HEADERS.join(',')
const r1 = parseItemsCsv(`${H}\n,123,,قطعة,10,,,\nصنف سليم,,,قطعة,10,5,3,1`, CUR, NO_EXISTING)
check('صف بلا اسم يُرفض برقمه', r1.errors.some((e) => e.includes('صف 2') && e.includes('الاسم')))
check('الصف السليم يمر رغم رفض غيره', r1.items.length === 1 && r1.items[0].nameAr === 'صنف سليم')
const r2 = parseItemsCsv(`${H}\nصنف,,,قطعة,abc,,,`, CUR, NO_EXISTING)
check('سعر غير رقمي يُرفض', r2.errors.some((e) => e.includes('غير صالح')))
const r3 = parseItemsCsv(`${H}\nصنف,,,قطعة,-5,,,`, CUR, NO_EXISTING)
check('سعر سالب يُرفض', r3.items.length === 0 && r3.errors.length === 1)
const r4 = parseItemsCsv(`${H}\nصنف,,,قطعة,١٣٠,٥٠,٣,١`, CUR, NO_EXISTING)
check('أرقام عربية تُطبَّع (درس خطأ الكاشير)', r4.items.length === 1 && r4.items[0].priceMinor === 13000 && r4.items[0].stockQty === 3)
const r5 = parseItemsCsv('عمود غريب,آخر\nقيمة,قيمة', CUR, NO_EXISTING)
check('ترويسة غير مطابقة تُرفض بإرشاد', r5.items.length === 0 && r5.errors[0].includes('الترويسة'))
check('ملف فارغ يُرفض', parseItemsCsv('', CUR, NO_EXISTING).errors[0] === 'الملف فارغ')
const r6 = parseItemsCsv(`${H}\nصنف,,,,10,,,`, CUR, NO_EXISTING)
check('وحدة فارغة ← «قطعة»', r6.items[0].baseUnit === 'قطعة')

console.log('— التكرار —')
const existing = { names: new Set(['لبن كامل']), barcodes: new Set(['999']) }
const r7 = parseItemsCsv(`${H}\nلبن كامل,,,قطعة,10,,,\nجديد,999,,قطعة,10,,,\nفريد,,,قطعة,10,,,`, CUR, existing)
check('اسم موجود يُتخطى', r7.skippedDuplicates >= 1)
check('باركود موجود يُتخطى', r7.skippedDuplicates === 2)
check('الفريد يمر', r7.items.length === 1 && r7.items[0].nameAr === 'فريد')
const r8 = parseItemsCsv(`${H}\nمكرر,,,قطعة,10,,,\nمكرر,,,قطعة,20,,,`, CUR, NO_EXISTING)
check('التكرار داخل الملف نفسه يُتخطى', r8.items.length === 1 && r8.skippedDuplicates === 1)

console.log(`\nCSV الأصناف: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
