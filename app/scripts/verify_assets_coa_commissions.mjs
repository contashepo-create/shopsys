/**
 * التحقق من حزمة «الأصول الممولة + الحسابات المخصصة + عمولات لدى الغير + الرصيد الموحّد»:
 * ① نواة الأصول: تمويل رأس مال/جاري شريك/آجل مورد + جدول أقساط بلا فقد مليم
 * ② repo: أصل آجل يتطلب مورداً حقيقياً + سداد أقساط بقيود + إهلاك تلقائي متعدد الأشهر
 * ③ حسابات مخصصة: إضافة/رفض مكرر/قيد يدوي عليها/حذف محمي
 * ④ عمولات لدى الغير: استحقاق 1112/4112 وتحصيل بالخزينة
 * ⑤ getSupplierBalance موحّد يشمل الافتتاحي
 */
import assert from 'node:assert/strict'

// stubs قبل استيراد repo
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } }, version: 0 }))

const { buildAssetPurchaseEntry, buildAssetInstallments, buildAssetPaymentEntry, ASSET_FUNDING_LABELS } = await import('../src/core/assets.ts')
const { validateCustomAccount, customAsAccounts, rootOfParent } = await import('../src/core/customAccounts.ts')
const { STANDARD_COA } = await import('../src/core/ledger.ts')
const { renderReportShell, DEFAULT_REPORT_PRINT } = await import('../src/core/reportPrint.ts')
const { useDataStore } = await import('../src/data/repo.ts')

let n = 0
const ok = (name, cond) => { n++; assert.ok(cond, name); console.log(`  ✓ ${n}. ${name}`) }

console.log('― نواة الأصول: التمويل ―')
const capLines = buildAssetPurchaseEntry(500_000, 0, 'FA-X', '1101', 'capital')
ok('تمويل رأس مال: 1201 مدين / 3101 دائن', capLines.some((l) => l.accountCode === '1201' && l.debit === 500_000) && capLines.some((l) => l.accountCode === '3101' && l.credit === 500_000))
ok('تمويل رأس مال: لا مساس بالخزينة ولا الموردين', !capLines.some((l) => l.accountCode === '1101' || l.accountCode === '2101'))
const parLines = buildAssetPurchaseEntry(300_000, 0, 'FA-X', '1101', 'partner')
ok('جاري الشريك: دائن 3103', parLines.some((l) => l.accountCode === '3103' && l.credit === 300_000))
const supLines = buildAssetPurchaseEntry(400_000, 0, 'FA-X', '1101', 'supplier_credit')
ok('آجل بالكامل: دائن 2101 بكامل التكلفة', supLines.some((l) => l.accountCode === '2101' && l.credit === 400_000))
const cashLines = buildAssetPurchaseEntry(400_000, 150_000, 'FA-X', '1101', 'cash')
ok('نقدي جزئي: خزينة 150 + موردون 250', cashLines.some((l) => l.accountCode === '1101' && l.credit === 150_000) && cashLines.some((l) => l.accountCode === '2101' && l.credit === 250_000))
ok('تسميات التمويل الأربعة موجودة', Object.keys(ASSET_FUNDING_LABELS).length === 4)

console.log('― جدول أقساط الأصل ―')
const inst = buildAssetInstallments(100_001, 3, 1, '2026-10-01')
ok('3 أقساط ومجموعها = الدين بلا فقد مليم', inst.length === 3 && inst.reduce((a, i) => a + i.amountMinor, 0) === 100_001)
ok('أول قسط يلتقط الباقي', inst[0].amountMinor === 33_335 && inst[1].amountMinor === 33_333)
ok('التواريخ شهرية متتالية', inst[1].dueDate === '2026-11-01' && inst[2].dueDate === '2026-12-01')
assert.throws(() => buildAssetInstallments(1000, 0, 1, '2026-10-01'))
ok('عدد أقساط 0 مرفوض', true)
const payL = buildAssetPaymentEntry(50_000, 'FA-1', '1101')
ok('قيد السداد: 2101 مدين / خزينة دائن', payL[0].accountCode === '2101' && payL[0].debit === 50_000 && payL[1].credit === 50_000)

console.log('― repo: أصل آجل بمورد حقيقي + سداد + إهلاك تلقائي ―')
const st = () => useDataStore.getState()
// تمويل الخزينة برأس مال يدوي
st().postManualEntry({ date: new Date().toISOString().slice(0, 10), description: 'رأس مال', lines: [
  { accountCode: '1101', debit: 10_000_000, credit: 0 },
  { accountCode: '3101', debit: 0, credit: 10_000_000 },
] })
assert.throws(() => st().addAsset({ nameAr: 'ماكينة', costMinor: 1_200_000, salvageMinor: 0, lifeMonths: 24, paidMinor: 0, notes: '', funding: 'supplier_credit' }))
ok('أصل آجل بلا مورد → مرفوض برسالة واضحة (إصلاح بلاغ المالك)', true)
st().addSupplier({ nameAr: 'شركة المعدات الحديثة', phone: '', taxNumber: '', address: '', notes: '' })
const sup = st().suppliers.at(-1)
const asset = st().addAsset({
  nameAr: 'ماكينة تصوير أشعة', costMinor: 1_200_000, salvageMinor: 0, lifeMonths: 24, paidMinor: 0, notes: '',
  funding: 'supplier_credit', supplierId: sup.id, installmentCount: 4, installmentIntervalMonths: 1, firstInstallmentDate: '2026-10-01',
})
ok('الأصل الآجل سُجل بمورد حقيقي وجدول 4 أقساط', asset.supplierId === sup.id && asset.installments.length === 4)
ok('مجموع الأقساط = كامل الدين', asset.installments.reduce((a, i) => a + i.amountMinor, 0) === 1_200_000)
ok('sourceType = asset_purchase وذكر المورد بالوصف', st().journal.at(-1).sourceType === 'asset_purchase' && st().journal.at(-1).description.includes('المعدات الحديثة'))
const due0 = st().getAssetDue(asset.id)
ok('getAssetDue: الدين كامل 1,200,000', due0.totalDueMinor === 1_200_000 && due0.remainingMinor === 1_200_000)
st().payAssetInstallment({ assetId: asset.id, amountMinor: 300_000, treasury: '1101' })
const a2 = st().assets.find((x) => x.id === asset.id)
ok('سداد قسط: الأول مسدد بالكامل والمتبقي 900,000', a2.installments[0].paidMinor === 300_000 && st().getAssetDue(asset.id).remainingMinor === 900_000)
ok('قيد السداد 2101/خزينة بنوع asset_payment', st().journal.at(-1).sourceType === 'asset_payment')
assert.throws(() => st().payAssetInstallment({ assetId: asset.id, amountMinor: 2_000_000, treasury: '1101' }))
ok('سداد أكبر من المتبقي مرفوض', true)

// أصل رأس مال بلا دفع
const capAsset = st().addAsset({ nameAr: 'سيارة المالك', costMinor: 800_000, salvageMinor: 100_000, lifeMonths: 60, paidMinor: 0, notes: '', funding: 'capital' })
ok('أصل رأس مال: بلا مورد وبلا أقساط وبلا دفع', capAsset.supplierId === null && capAsset.installments.length === 0 && capAsset.paidMinor === 0)
ok('قيده الدائن 3101', st().journal.at(-1).lines.some((l) => l.accountCode === '3101' && l.credit === 800_000))
const parAsset = st().addAsset({ nameAr: 'أثاث من شريك', costMinor: 200_000, salvageMinor: 0, lifeMonths: 24, paidMinor: 0, notes: '', funding: 'partner' })
ok('أصل جاري شريك: قيده الدائن 3103', st().journal.at(-1).lines.some((l) => l.accountCode === '3103' && l.credit === 200_000))
void parAsset

// الإهلاك التلقائي: أصل قديم بأشهر متأخرة
const oldMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 7) })()
useDataStore.setState({ assets: st().assets.map((a) => (a.id === capAsset.id ? { ...a, purchaseMonth: oldMonth } : a)) })
const before = st().journal.length
const posted = st().runAutoDepreciation()
ok('الإهلاك التلقائي رحّل الأشهر المتأخرة كلها بلا تدخل', posted >= 3 && st().journal.length === before + posted)
ok('قيود الإهلاك بنوع depreciation', st().journal.at(-1).sourceType === 'depreciation')
ok('استدعاء ثانٍ لا يكرر شيئاً', st().runAutoDepreciation() === 0)

console.log('― الحسابات المخصصة (الشجرة ليست مفروضة) ―')
const errs1 = validateCustomAccount({ code: '1104', nameAr: 'مكرر', parentCode: '11' }, STANDARD_COA, [])
ok('كود مستخدم بالشجرة القياسية مرفوض', errs1.some((e) => e.includes('مستخدم')))
const errs2 = validateCustomAccount({ code: '2199', nameAr: 'تأمينات', parentCode: '11' }, STANDARD_COA, [])
ok('كود لا يطابق جذر المجموعة مرفوض', errs2.length > 0)
ok('rootOfParent(2) = liabilities', rootOfParent('2', STANDARD_COA) === 'liabilities')
const acc = st().addCustomAccount({ code: '1190', nameAr: 'تأمينات لدى الغير', parentCode: '11' })
ok('أُضيف حساب مخصص 1190 بجذر أصول', acc.rootType === 'assets')
assert.throws(() => st().addCustomAccount({ code: '1190', nameAr: 'آخر', parentCode: '11' }))
ok('تكرار الكود المخصص مرفوض', true)
st().postManualEntry({ date: new Date().toISOString().slice(0, 10), description: 'تأمين خطاب ضمان', lines: [
  { accountCode: '1190', debit: 25_000, credit: 0 },
  { accountCode: '1101', debit: 0, credit: 25_000 },
] })
ok('قيد يدوي على الحساب المخصص مقبول (كان مرفوضاً قبل الإصلاح)', st().journal.at(-1).lines.some((l) => l.accountCode === '1190'))
assert.throws(() => st().deleteCustomAccount('1190'))
ok('حذف حساب عليه حركة مرفوض حفاظاً على الدفاتر', true)
const acc2 = st().addCustomAccount({ code: '5190', nameAr: 'مصروف تجريبي مؤقت', parentCode: '5' })
st().deleteCustomAccount(acc2.code)
ok('حذف حساب بلا حركة يمر', !st().customAccounts.some((a) => a.code === '5190'))
ok('customAsAccounts postable', customAsAccounts(st().customAccounts).every((a) => a.isPostable))

console.log('― العمولات بقسميها + سجل الأشخاص (إعادة الهيكلة) ―')
// الطرف يجب أن يكون مسجلاً أولاً (طلب المالك)
assert.throws(() => st().addExternalCommission({ direction: 'earned', partyId: 999, amountMinor: 1_000, description: '' }))
ok('عمولة لطرف غير مسجل مرفوضة', true)
const cmParty = st().addCommissionParty({ nameAr: 'مركز أشعة النور', phone: '', kind: 'مركز أشعة', notes: '' })
ok('سُجل طرف العمولات بكود CMP', cmParty.code === 'CMP-0001')
assert.throws(() => st().addCommissionParty({ nameAr: 'مركز أشعة النور', phone: '', kind: '', notes: '' }))
ok('اسم مكرر في سجل الأطراف مرفوض', true)
const com = st().addExternalCommission({ direction: 'earned', partyId: cmParty.id, amountMinor: 150_000, description: 'تحويلات سبتمبر' })
ok('استحقاق: 1112 مدين / 4112 دائن', st().journal.at(-1).lines.some((l) => l.accountCode === '1112' && l.debit === 150_000) && st().journal.at(-1).lines.some((l) => l.accountCode === '4112' && l.credit === 150_000))
st().collectExternalCommission({ commissionId: com.id, amountMinor: 100_000, treasury: '1101' })
const com2 = st().externalCommissions.find((c) => c.id === com.id)
ok('تحصيل جزئي: المحصَّل 100,000 والمتبقي 50,000', com2.collectedMinor === 100_000 && com2.amountMinor - com2.collectedMinor === 50_000)
ok('قيد التحصيل: خزينة مدين / 1112 دائن', st().journal.at(-1).lines.some((l) => l.accountCode === '1101' && l.debit === 100_000) && st().journal.at(-1).lines.some((l) => l.accountCode === '1112' && l.credit === 100_000))
assert.throws(() => st().collectExternalCommission({ commissionId: com.id, amountMinor: 60_000, treasury: '1101' }))
ok('تحصيل أكبر من المتبقي مرفوض', true)
// القسم الثاني: عمولات للغير (عليّ) — مصروف 5113 والتزام 2114
const broker = st().addCommissionParty({ nameAr: 'أحمد السمسار', phone: '0100', kind: 'سمسار', notes: '' })
const owed = st().addExternalCommission({ direction: 'owed', partyId: broker.id, amountMinor: 80_000, description: 'عمولة بيع' })
ok('استحقاق عليّ: 5113 مدين / 2114 دائن ورقم CMO', owed.commissionNumber.startsWith('CMO-') && st().journal.at(-1).lines.some((l) => l.accountCode === '5113' && l.debit === 80_000) && st().journal.at(-1).lines.some((l) => l.accountCode === '2114' && l.credit === 80_000))
st().collectExternalCommission({ commissionId: owed.id, amountMinor: 80_000, treasury: '1101' })
ok('دفع عليّ: 2114 مدين / خزينة دائن', st().journal.at(-1).lines.some((l) => l.accountCode === '2114' && l.debit === 80_000) && st().journal.at(-1).lines.some((l) => l.accountCode === '1101' && l.credit === 80_000))
// حذف طرف عليه عمولات مرفوض
assert.throws(() => st().deleteCommissionParty(broker.id))
ok('حذف طرف عليه عمولات مرفوض', true)

console.log('― الرصيد الموحّد للمورد + توازن الدفتر ―')
useDataStore.setState({ openingBalances: { ...st().openingBalances, [`supplier:${sup.id}`]: 40_000 } })
ok('getSupplierBalance يشمل الرصيد الافتتاحي', st().getSupplierBalance(sup.id) === 40_000)
let d = 0, c = 0
for (const e of st().journal) for (const l of e.lines) { d += l.debit; c += l.credit }
ok('الدفتر متوازن بعد كل العمليات', d === c)

console.log('― غلاف طباعة التقارير الموحّد ―')
const html = renderReportShell({ title: 'ميزان المراجعة', subtitle: 'تجربة', companyName: 'صيدلية الشفاء', bodyHtml: '<table><tr><td>x</td></tr></table>', settings: DEFAULT_REPORT_PRINT })
ok('الغلاف يتضمن العنوان واسم المنشأة و@page', html.includes('ميزان المراجعة') && html.includes('صيدلية الشفاء') && html.includes('@page'))
const html2 = renderReportShell({ title: 't', subtitle: 's', companyName: 'c', bodyHtml: '', settings: { ...DEFAULT_REPORT_PRINT, paper: 'A5', orientation: 'landscape', showCompanyName: false } })
ok('إعدادات الورق والاتجاه تسري', html2.includes('A5 landscape'))

console.log(`\n✅ نجح التحقق: ${n}/${n}`)
