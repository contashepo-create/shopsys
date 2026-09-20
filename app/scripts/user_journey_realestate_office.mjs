/**
 * 🏢 رحلة مكتب عقارات سعودي كامل (الفحص الفردي لنشاط العقارات):
 * عقار مُدار لمالك بسعي 5% → وحدات → عقد إيجار سنوي ربع سنوي بتأمين وإيجار
 * → تحصيل أقساط: نصيب المالك 2115 + سعي 4114 خاضع للضريبة والأجرة السكنية معفاة
 * → صيانة على المالك تُخصم من مستحقه → سداد المالك → إنهاء بخصم أضرار من التأمين
 * → عقار مملوك يُشترى ويؤجر (الإيراد كله 4113) ثم يُباع بربح → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_realestate_office.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'SA', activityId: 'realestate', vatPercent: 15, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) عقار مُدار لمالك بسعي 5% + التحقق الصارم ═══')
{
  // مدار بلا اسم مالك مرفوض، ومملوك بسعي مرفوض
  assert.throws(() => st().addProperty({ nameAr: 'خطأ', kind: 'residential', ownership: 'managed', ownerName: '', commissionPercent: 5, address: '', costMinor: 0, notes: '' }), /اسم المالك/)
  assert.throws(() => st().addProperty({ nameAr: 'خطأ', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 5, address: '', costMinor: 100, notes: '' }), /لا سعي/)
  assert.throws(() => st().addProperty({ nameAr: 'خطأ', kind: 'residential', ownership: 'managed', ownerName: 'س', commissionPercent: 5, address: '', costMinor: 100, notes: '' }), /التكلفة صفر/)
  const prop = st().addProperty({ nameAr: 'برج العليا', kind: 'residential', ownership: 'managed', ownerName: 'الشيخ عبدالله', commissionPercent: 5, address: 'الرياض — العليا', costMinor: 0, notes: '', unitCodes: ['شقة 101', 'شقة 102'] })
  assert.equal(st().propertyUnits.filter((u) => u.propertyId === prop.id).length, 2, 'وحدتان أُنشئتا مع العقار')
  ok('عقار مُدار بوحدتين — والتحققات الثلاثة الصارمة تعمل')
}
const prop = st().properties[0]
const [u101, u102] = st().propertyUnits

console.log('\n═══ 2) عقد إيجار سنوي (ربع سنوي) 24,000 + تأمين 2,000 ═══')
{
  const lease = st().addLease({ propertyId: prop.id, unitId: u101.id, tenantName: 'م. فهد', startDate: '2026-09-01', months: 12, frequency: 'quarterly', totalRentMinor: 2400000, depositMinor: 200000, ejarNumber: 'EJ-556677', treasury: '1101' })
  assert.equal(lease.installments.length, 4, '4 أقساط ربع سنوية')
  assert.equal(lease.installments[0].amountMinor, 600000, 'كل قسط 6,000')
  assert.equal(acctBal('2103'), -200000, 'التأمين التزام مسترد 2103 لا إيراد')
  assert.equal(st().propertyUnits.find((u) => u.id === u101.id).status, 'leased', 'الوحدة اشتُغلت')
  // عقد ثانٍ على نفس الوحدة المشغولة مرفوض
  assert.throws(() => st().addLease({ propertyId: prop.id, unitId: u101.id, tenantName: 'آخر', startDate: '2026-09-01', months: 12, frequency: 'annual', totalRentMinor: 100, depositMinor: 0 }))
  ok('عقد LC بجدول 4 أقساط، التأمين 2103، الوحدة محجوزة عن التأجير المزدوج')
}
const lease = st().leases[0]

console.log('\n═══ 3) تحصيل قسطين: سعي 5% خاضع 15% والأجرة السكنية معفاة ═══')
{
  const r1 = st().collectLeaseInstallment({ leaseId: lease.id, seq: 1, treasury: '1101' })
  assert.equal(r1.commissionMinor, 30000, 'السعي 5% من 6,000 = 300')
  assert.equal(r1.ownerShareMinor, 570000, 'نصيب المالك 5,700')
  // تحصيل نفس القسط مرتين مرفوض
  assert.throws(() => st().collectLeaseInstallment({ leaseId: lease.id, seq: 1, treasury: '1101' }))
  st().collectLeaseInstallment({ leaseId: lease.id, seq: 2, treasury: '1101' })
  assert.equal(acctBal('2115'), -1140000, 'مستحق المالك المتجمع 11,400')
  assert.equal(st().getOwnerBalance(prop.id), 1140000)
  // السعي دخل إيرادات المكتب 4114 (600 عن قسطين)
  assert.equal(acctBal('4114'), -60000, 'إيراد السعي 600')
  ok('قسطان: مالك 11,400 (2115) + سعي 600 (4114) — والتحصيل المزدوج مرفوض')
}

console.log('\n═══ 4) صيانة على حساب المالك تُخصم من مستحقه ثم سداده ═══')
{
  st().addUnitMaintenance({ unitId: u101.id, amountMinor: 40000, bearer: 'owner', description: 'إصلاح مكيف', treasury: '1101' })
  assert.equal(st().getOwnerBalance(prop.id), 1100000, 'الصيانة نقصت مستحق المالك 400')
  // سداد أكبر من المستحق مرفوض
  assert.throws(() => st().payPropertyOwner({ propertyId: prop.id, amountMinor: 1100001, treasury: '1101' }))
  st().payPropertyOwner({ propertyId: prop.id, amountMinor: 1100000, treasury: '1101' })
  assert.equal(st().getOwnerBalance(prop.id), 0, 'صُفي حساب المالك')
  ok('صيانة 400 على المالك ثم سداد 11,000 — الرصيد صفر والسداد الزائد مرفوض')
}

console.log('\n═══ 5) إنهاء العقد بخصم أضرار 500 من التأمين ═══')
{
  const cashBefore = acctBal('1101')
  st().endLease({ leaseId: lease.id, deductionMinor: 50000, treasury: '1101' })
  assert.equal(acctBal('2103'), 0, 'التزام التأمين صُفي')
  assert.equal(acctBal('1101') - cashBefore, -150000, 'رُد 1,500 نقداً (2,000 − 500 أضرار)')
  assert.equal(st().propertyUnits.find((u) => u.id === u101.id).status, 'vacant', 'الوحدة شاغرة')
  assert.equal(st().leases[0].status, 'ended')
  ok('الإنهاء: رد 1,500 وخصم أضرار 500، الوحدة شاغرة والعقد مقفول')
}

console.log('\n═══ 6) عقار مملوك: شراء 300,000 → إيجار (كله للمكتب) → بيع بربح ═══')
{
  const owned = st().addProperty({ nameAr: 'شقة الملز', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0, address: 'الرياض — الملز', costMinor: 30000000, notes: '', unitCodes: ['الوحدة الرئيسية'], acquisitionPayment: 'cash', treasury: '1102' })
  assert.equal(acctBal('1113'), 30000000, 'العقار أصل استثماري 1113')
  const unit = st().propertyUnits.find((u) => u.propertyId === owned.id)
  const l2 = st().addLease({ propertyId: owned.id, unitId: unit.id, tenantName: 'أ. سالم', startDate: '2026-09-15', months: 12, frequency: 'annual', totalRentMinor: 3600000, depositMinor: 0 })
  const rc = st().collectLeaseInstallment({ leaseId: l2.id, seq: 1, treasury: '1101' })
  assert.equal(rc.commissionMinor, 0, 'لا سعي على المملوك')
  assert.equal(acctBal('4113'), -3600000, 'إيجار المملوك كله للمكتب 4113')
  st().endLease({ leaseId: l2.id, treasury: '1101' })
  // بيع بـ 380,000: ربح 80,000
  st().sellProperty({ propertyId: owned.id, salePriceMinor: 38000000, payment: 'cash', treasury: '1102' })
  assert.equal(acctBal('1113'), 0, 'الأصل خرج من الدفاتر')
  assert.equal(acctBal('4115'), -38000000, 'إيراد البيع')
  assert.equal(acctBal('5116'), 30000000, 'تكلفة العقار المباع')
  assert.equal(st().properties.find((p) => p.id === owned.id).status, 'sold')
  // البيع مرة ثانية مرفوض
  assert.throws(() => st().sellProperty({ propertyId: owned.id, salePriceMinor: 100, payment: 'cash' }))
  ok('المملوك: أصل 1113 → إيجار 36,000 بلا سعي → بيع بربح 80,000 وإقفال السجل')
}

console.log('\n═══ 7) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة مكتب العقارات: ${pass} محطات — كلها خضراء\n`)
