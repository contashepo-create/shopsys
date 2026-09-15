/**
 * فحص جهات التأمين والتعاقد (صيدلية/معمل): تقسيم الفاتورة نصيب مريض نقدي
 * + نصيب جهة كمطالبة 1110، مع التكلفة للبضاعة، وتحصيل المطالبات مجمعاً.
 * تشغيل: node --experimental-strip-types scripts/verify_insurance.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { splitCoverage } = await import('../src/core/insurance.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'علبة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('🏥 الجهات')
const prov = S().addInsuranceProvider({ nameAr: 'شركة مصر للتأمين الطبي', coveragePercent: 80, phone: '' })
ok('جهة نشطة بنسبة 80٪', prov.isActive && prov.coveragePercent === 80)
throws('اسم مكرر يُرفض', () => S().addInsuranceProvider({ nameAr: 'شركة مصر للتأمين الطبي', coveragePercent: 50 }), 'بهذا الاسم')
throws('نسبة صفرية تُرفض', () => S().addInsuranceProvider({ nameAr: 'أ', coveragePercent: 0 }), 'بين 1 و100')
const sp = splitCoverage(10001, 80)
ok('التقسيم: كسور لصالح المريض تُجبر لأسفل للجهة', sp.providerShareMinor === 8000 && sp.patientShareMinor === 2001)

console.log('💊 بيع صيدلية بتغطية (مع تكلفة البضاعة)')
S().addItem(item({ nameAr: 'مضاد حيوي', costMinor: 3000, stockQty: 50, priceMinor: 5000 }))
const med = S().items.at(-1).id
const r = S().postInsuredSale({
  lines: [{ itemId: med, nameAr: 'مضاد حيوي', qty: 2, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
  providerId: prov.id, taxPercent: 0, taxInclusive: false, treasury: '1101',
})
// إجمالي 10000: جهة 8000، مريض 2000
ok('نصيب الجهة 80 والمريض 20', r.providerShareMinor === 8000 && r.patientShareMinor === 2000)
ok('الخزينة استلمت نصيب المريض فقط', bal('1101') === 2000)
ok('1110 مطالبة بنصيب الجهة', bal('1110') === 8000)
ok('الإيراد كامل 4101', bal('4101') === -10000)
ok('التكلفة قُيدت 5101/1103', bal('5101') === 6000)
ok('المخزون خُصم', S().items.find((i) => i.id === med).stockQty === 48)
ok('رصيد مطالبات الجهة 80', S().getClaimBalance(prov.id) === 8000)
throws('بيع بمخزون غير كافٍ يُرفض', () => S().postInsuredSale({
  lines: [{ itemId: med, nameAr: 'مضاد حيوي', qty: 999, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
  providerId: prov.id, taxPercent: 0, taxInclusive: false,
}), 'غير كافٍ')

console.log('🔬 طلب معمل بتغطية وعمولة محيل')
S().addLabTest({ code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم', unit: '', priceMinor: 30000, costMinor: 0, refRanges: [] })
S().addLabPatient({ nameAr: 'أ/ سعاد', phone: '', gender: 'female', birthDate: '1980-01-01', notes: '' })
S().addLabReferrer({ nameAr: 'د. سامي', phone: '', commissionPercent: 10, notes: '' })
const test = S().labTests.at(-1), patient = S().labPatients.at(-1), ref = S().labReferrers.at(-1)
const order = S().registerInsuredLabOrder({ patientId: patient.id, referrerId: ref.id, testIds: [test.id], providerId: prov.id, vatPercent: 0, treasury: '1101' })
// 30000: جهة 24000، مريض 6000
ok('الطلب مسجل بمرجع تغطية', order.notes.includes('تغطية'))
ok('الخزينة زادت بنصيب المريض 60', bal('1101') === 2000 + 6000)
ok('1110 = مطالبتان 320', bal('1110') === 8000 + 24000)
ok('إيراد المعمل 4106 كامل', bal('4106') === -30000)
ok('عمولة المحيل استُحقت من الصافي كاملاً', order.commissionMinor === 3000)

console.log('🏦 تحصيل المطالبات مجمعاً')
const st = S().settleInsuranceClaims(prov.id, '1102')
ok('حُصلت مطالبتان = 320', st.total === 32000 && st.count === 2)
ok('1110 صفر', bal('1110') === 0)
ok('البنك استلم 320', bal('1102') === 32000)
throws('تحصيل ثانٍ بلا مطالبات يُرفض', () => S().settleInsuranceClaims(prov.id), 'لا مطالبات')

console.log('🔌 التعطيل')
S().toggleInsuranceProvider(prov.id)
throws('بيع بجهة معطلة يُرفض', () => S().postInsuredSale({
  lines: [{ itemId: med, nameAr: 'مضاد حيوي', qty: 1, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }],
  providerId: prov.id, taxPercent: 0, taxInclusive: false,
}), 'معطلة')

console.log('⚖️ الميزان')
ok('الدفتر متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 التأمين والتعاقد يعمل: تقسيم تلقائي، مطالبات 1110 تُحصل مجمعة')
