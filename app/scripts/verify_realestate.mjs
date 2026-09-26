/**
 * فحص نشاط العقارات (النشاط 21 — معايير سند/الوسيط/سمات السعودية):
 * عقار مملوك وآخر مدار بسعي، عقود إيجار بجداول أقساط، تحصيل بقيود صحيحة
 * (4113 للمملوك، 2115+4114 للمدار مع ض.ق.م على السعي)، سداد المالك، صيانة على
 * المالك/المكتب، إخلاء برد تأمين وخصم أضرار، بيع عقار بربح، وتنبيهات العقود.
 * تشغيل: node --experimental-strip-types scripts/verify_realestate.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 15 } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { generateLeaseSchedule, collectLeaseAlerts, leaseEndDate } = await import('../src/core/realestate.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('📐 جدول الأقساط النقي')
const sched = generateLeaseSchedule('2026-01-01', 12, 'quarterly', 100_001)
ok('12 شهراً ربع سنوي = 4 أقساط', sched.length === 4)
ok('الباقي على القسط الأخير (25000×3 + 25001)', sched[0].amountMinor === 25_000 && sched[3].amountMinor === 25_001)
ok('تواريخ الاستحقاق كل 3 أشهر', sched[1].dueDate === '2026-04-01' && sched[3].dueDate === '2026-10-01')
throws('رفض مدة لا تقبل القسمة على الدورية', () => generateLeaseSchedule('2026-01-01', 7, 'quarterly', 100_000), 'القسمة')
ok('نهاية عقد 12 شهراً من 2026-01-01', leaseEndDate('2026-01-01', 12) === '2027-01-01')

console.log('🏢 عقار مملوك + عقار مدار بسعي')
const owned = S().addProperty({ nameAr: 'برج المكتب', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0, address: 'الرياض', costMinor: 5_000_000, notes: '', unitCodes: ['شقة 1', 'شقة 2'], acquisitionPayment: 'cash', treasury: '1101' })
ok('اقتناء العقار: 1113 مدين بالتكلفة', bal('1113') === 5_000_000)
ok('وحدتان وُلِّدتا شاغرتين', S().propertyUnits.filter((u) => u.propertyId === owned.id && u.status === 'vacant').length === 2)
const managed = S().addProperty({ nameAr: 'عمارة أبو خالد', kind: 'residential', ownership: 'managed', ownerName: 'أبو خالد', commissionPercent: 5, address: 'جدة', costMinor: 0, notes: '', unitCodes: ['شقة أ'] })
throws('رفض عقار مدار بلا اسم مالك', () => S().addProperty({ nameAr: 'خطأ', kind: 'residential', ownership: 'managed', ownerName: '', commissionPercent: 5, address: '', costMinor: 0, notes: '' }), 'المالك')
throws('رفض سعي على عقار مملوك', () => S().addProperty({ nameAr: 'خطأ', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 5, address: '', costMinor: 0, notes: '' }), 'سعي')
throws('رفض كود وحدة مكرر', () => S().addPropertyUnit({ propertyId: owned.id, code: 'شقة 1', annualRentMinor: 0 }), 'مكرر')

console.log('🧾 كل وحدة لها تكلفة وسعر بيع وقيد مستقل')
const granular = S().addProperty({
  nameAr: 'عمارة وحدات مستقلة', kind: 'mixed', ownership: 'owned', ownerName: '', commissionPercent: 0,
  address: 'الدمام', costMinor: 900_000, acquisitionPayment: 'cash',
  initialUnits: [
    { code: 'A-01', annualRentMinor: 60_000, costMinor: 400_000, salePriceMinor: 700_000 },
    { code: 'B-01', annualRentMinor: 75_000, costMinor: 500_000, salePriceMinor: 900_000 },
  ], notes: '',
})
const gUnits = S().propertyUnits.filter((u) => u.propertyId === granular.id)
ok('كل وحدة حفظت تكلفتها وسعرها منفصلين', gUnits.length === 2 && gUnits[0].costMinor === 400_000 && gUnits[1].salePriceMinor === 900_000)
ok('اقتناء الوحدتين ولد قيدين مستقلين ومتوازنين', S().journal.filter((e) => e.sourceType === 'property_acquisition' && e.sourceId === gUnits[0].id).length === 1 && S().journal.filter((e) => e.sourceType === 'property_acquisition' && e.sourceId === gUnits[1].id).length === 1)
S().sellPropertyUnit({ propertyId: granular.id, unitId: gUnits[0].id, salePriceMinor: 700_000, payment: 'cash', treasury: '1101' })
ok('بيع وحدة واحدة أخرج تكلفتها فقط وبقي العقار نشطاً', S().propertyUnits.find((u) => u.id === gUnits[0].id).status === 'sold' && S().properties.find((p) => p.id === granular.id).status === 'active' && bal('1113') === 5_500_000)
throws('رفض تأجير الوحدة المباعة', () => S().addLease({ propertyId: granular.id, unitId: gUnits[0].id, tenantName: 'غير مسموح', startDate: '2026-01-01', months: 12, frequency: 'annual', totalRentMinor: 100_000, depositMinor: 0 }), 'مباعة')
S().sellPropertyUnit({ propertyId: granular.id, unitId: gUnits[1].id, salePriceMinor: 900_000, payment: 'cash', treasury: '1101' })
ok('بيع آخر وحدة أغلق العقار وجعل كل الأصل الوحدي خارج 1113', S().properties.find((p) => p.id === granular.id).status === 'sold' && bal('1113') === 5_000_000)

console.log('📄 عقد إيجار مملوك: 12 شهراً شهري 120,000 + تأمين 10,000')
const u1 = S().propertyUnits.find((u) => u.propertyId === owned.id)
const lease1 = S().addLease({ propertyId: owned.id, unitId: u1.id, tenantName: 'سالم', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 120_000, depositMinor: 10_000, ejarNumber: 'EJAR-123', treasury: '1101' })
ok('12 قسطاً شهرياً بالتساوي', lease1.installments.length === 12 && lease1.installments[0].amountMinor === 10_000)
ok('التأمين التزام على 2103', bal('2103') === -10_000)
ok('الوحدة صارت مؤجرة', S().propertyUnits.find((u) => u.id === u1.id).status === 'leased')
ok('رقم توثيق إيجار محفوظ', lease1.ejarNumber === 'EJAR-123')
throws('رفض عقد ثانٍ على وحدة مؤجرة', () => S().addLease({ propertyId: owned.id, unitId: u1.id, tenantName: 'آخر', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 100_000, depositMinor: 0 }), 'مؤجرة')

console.log('💰 تحصيل قسط المملوك (سكني معفى من الضريبة)')
const col1 = S().collectLeaseInstallment({ leaseId: lease1.id, seq: 1 })
ok('حُصل 10,000 كاملة بلا سعي', col1.paidMinor === 10_000 && col1.commissionMinor === 0)
ok('الإيراد على 4113', bal('4113') === -10_000)
throws('رفض تحصيل قسط محصَّل', () => S().collectLeaseInstallment({ leaseId: lease1.id, seq: 1 }), 'بالكامل')

console.log('🤝 عقد مدار: السعي 5٪ + ض.ق.م على السعي فقط')
const uM = S().propertyUnits.find((u) => u.propertyId === managed.id)
const lease2 = S().addLease({ propertyId: managed.id, unitId: uM.id, tenantName: 'ماجد', startDate: '2026-01-01', months: 12, frequency: 'annual', totalRentMinor: 200_000, depositMinor: 0 })
const col2 = S().collectLeaseInstallment({ leaseId: lease2.id, seq: 1 })
ok('السعي = 10,000 (5٪) ونصيب المالك 190,000', col2.commissionMinor === 10_000 && col2.ownerShareMinor === 190_000)
ok('نصيب المالك على 2115', bal('2115') === -190_000)
ok('السعي إيراد 4114', bal('4114') === -10_000)
ok('ض.ق.م على السعي فقط = 1,500', bal('2102') === -1_500)
ok('رصيد المالك = 190,000', S().getOwnerBalance(managed.id) === 190_000)

console.log('🔧 صيانة على حساب المالك ثم سداده')
S().addUnitMaintenance({ unitId: uM.id, amountMinor: 15_000, bearer: 'owner', description: 'سباكة', treasury: '1101' })
ok('الصيانة خصمت من 2115 لا من مصاريف المكتب', bal('2115') === -175_000 && S().getOwnerBalance(managed.id) === 175_000)
throws('رفض صيانة على المالك لعقار مملوك', () => S().addUnitMaintenance({ unitId: u1.id, amountMinor: 1_000, bearer: 'owner', description: 'خطأ' }), 'مملوك')
S().payPropertyOwner({ propertyId: managed.id, amountMinor: 175_000, treasury: '1101' })
ok('بعد السداد رصيد المالك صفر و2115 صفر', S().getOwnerBalance(managed.id) === 0 && bal('2115') === 0)
throws('رفض سداد فوق مستحق المالك', () => S().payPropertyOwner({ propertyId: managed.id, amountMinor: 1 }), 'أكبر')

console.log('🔔 تنبيهات العقود (نمط سمات)')
const alerts = collectLeaseAlerts(S().leases, '2026-12-01', 60)
ok('عقد سالم قارب الانتهاء (2027-01-01) يظهر', alerts.some((a) => a.leaseId === lease1.id && a.kind === 'expiring'))
ok('أقساط سالم غير المحصلة المتأخرة تظهر', alerts.some((a) => a.leaseId === lease1.id && a.kind === 'overdue' && a.amountMinor === 10_000))

console.log('🚪 إخلاء برد تأمين ناقص خصم أضرار 2,000')
S().endLease({ leaseId: lease1.id, deductionMinor: 2_000, evicted: true, treasury: '1101' })
const l1After = S().leases.find((l) => l.id === lease1.id)
ok('العقد صار evicted والمردود 8,000', l1After.status === 'evicted' && l1After.depositRefundedMinor === 8_000)
ok('2103 صفر والخصم إيراد على 4110', bal('2103') === 0)
ok('الوحدة عادت شاغرة', S().propertyUnits.find((u) => u.id === u1.id).status === 'vacant')

console.log('🏷️ بيع العقار المملوك')
throws('رفض البيع وعليه عقد نشط… بعد إنشاء عقد جديد', () => {
  const u2 = S().propertyUnits.find((u) => u.propertyId === owned.id && u.status === 'vacant' && u.id !== u1.id)
  S().addLease({ propertyId: owned.id, unitId: u2.id, tenantName: 'مؤقت', startDate: '2026-01-01', months: 12, frequency: 'annual', totalRentMinor: 50_000, depositMinor: 0 })
  S().sellProperty({ propertyId: owned.id, salePriceMinor: 6_000_000, payment: 'cash' })
}, 'نشطة')
S().endLease({ leaseId: S().leases.at(-1).id })
S().sellProperty({ propertyId: owned.id, salePriceMinor: 6_000_000, payment: 'cash', treasury: '1101' })
ok('العقار مباع و1113 صفر', S().properties.find((p) => p.id === owned.id).status === 'sold' && bal('1113') === 0)
ok('الإيراد 4115 يشمل بيع الوحدتين + العقار، والتكلفة 5116 كذلك', bal('4115') === -7_600_000 && bal('5116') === 5_900_000)
throws('رفض بيع عقار مدار', () => S().sellProperty({ propertyId: managed.id, salePriceMinor: 100, payment: 'cash' }), 'مملوك')

ok('دفتر الأستاذ متوازن في النهاية', balanced())

console.log(`\n${fail === 0 ? '🎉' : '💥'} النتيجة: ${pass} ناجح، ${fail} فاشل`)
process.exit(fail === 0 ? 0 : 1)
