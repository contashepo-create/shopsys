/**
 * فحص عمق المقاولات (سد فجوة pro-acc): BOQ، أوامر التغيير، الدفعات المقدمة،
 * مقاولو الباطن بشهادات ومحتجزات، خطابات الضمان، عمال اليومية، وتقرير WIP —
 * كل ذلك على المخزن الحقيقي مع توازن دفتر الأستاذ في كل خطوة.
 * تشغيل: node --experimental-strip-types scripts/verify_contracting_depth.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('🏗️ التأسيس: مشروع بعقد 10م ومحتجز 10٪')
S().addProject({ nameAr: 'برج النيل', clientName: 'شركة التعمير', contractValueMinor: 10_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })
const proj = S().projects.at(-1)

console.log('📐 جدول الكميات BOQ')
S().addBoqItem({ projectId: proj.id, code: '1-1', descriptionAr: 'حفر وإحلال', unit: 'م3', qty: 500, unitPriceMinor: 4000 })
S().addBoqItem({ projectId: proj.id, code: '2-1', descriptionAr: 'خرسانة مسلحة', unit: 'م3', qty: 300, unitPriceMinor: 18000 })
ok('بندان في الجدول', S().boqItems.filter((b) => b.projectId === proj.id).length === 2)
ok('إجمالي المقايسة = 7.4م', S().boqItems.reduce((s, b) => s + Math.round(b.qty * b.unitPriceMinor), 0) === 7_400_000)
S().updateBoqProgress(S().boqItems[0].id, 60)
ok('نسبة إنجاز البند تُحدَّث', S().boqItems[0].progressPercent === 60)
throws('نسبة إنجاز فوق 100 تُرفض', () => S().updateBoqProgress(S().boqItems[0].id, 150), '100')
throws('بند بلا وصف يُرفض', () => S().addBoqItem({ projectId: proj.id, code: '', descriptionAr: ' ', unit: 'م2', qty: 5, unitPriceMinor: 100 }), 'وصف')

console.log('📝 أوامر التغيير')
const co1 = S().addChangeOrder({ projectId: proj.id, titleAr: 'دور إضافي', amountMinor: 2_000_000 })
ok('أمر التغيير مسودة برقم CO', co1.status === 'draft' && co1.number.startsWith('CO-'))
S().setChangeOrderStatus(co1.id, 'approved')
const co2 = S().addChangeOrder({ projectId: proj.id, titleAr: 'إلغاء السور', amountMinor: -500_000 })
S().setChangeOrderStatus(co2.id, 'rejected')
ok('العقد الفعلي = 12م (المعتمد فقط يُحسب)', S().getProjectWip(proj.id).contractMinor === 12_000_000)
throws('حسم أمر محسوم يُرفض', () => S().setChangeOrderStatus(co1.id, 'rejected'), 'محسوم')
throws('تخفيض أكبر من العقد يُرفض', () => {
  const big = S().addChangeOrder({ projectId: proj.id, titleAr: 'تخفيض خرافي', amountMinor: -20_000_000 })
  S().setChangeOrderStatus(big.id, 'approved')
}, 'أكبر')

console.log('💰 الدفعة المقدمة (التزام 2109 لا إيراد)')
S().receiveClientAdvance({ projectId: proj.id, amountMinor: 1_000_000, treasury: '1102' })
ok('البنك استلم مليوناً', bal('1102') === 1_000_000)
ok('2109 التزام بالمليون', bal('2109') === -1_000_000)
ok('لا إيراد بعد (4107 صفر)', bal('4107') === 0)
ok('رصيد الدفعات = مليون', S().getAdvanceBalance(proj.id) === 1_000_000)

console.log('🧾 مستخلص باسترداد جزء من الدفعة')
const ex = S().addProjectExtract({ projectId: proj.id, grossMinor: 3_000_000, vatPercent: 14, payment: 'credit', description: 'الهيكل الخرساني', advanceRecoveryMinor: 600_000 })
// المستحق = 3م + 420ألف ضريبة − 300ألف محتجز = 3.12م، منها 600 ألف من الدفعة
ok('العملاء عليهم المستحق − الاسترداد', bal('1104') === 3_120_000 - 600_000)
ok('2109 انخفض للباقي (400 ألف)', bal('2109') === -400_000)
ok('الإيراد بكامل الأعمال 3م', bal('4107') === -3_000_000)
ok('رصيد الدفعات = 400 ألف', S().getAdvanceBalance(proj.id) === 400_000)
throws('استرداد أكبر من الرصيد يُرفض', () => S().addProjectExtract({ projectId: proj.id, grossMinor: 100_000, vatPercent: 0, payment: 'cash', description: 'x', treasury: '1101', advanceRecoveryMinor: 999_999_999 }), 'أكبر')

console.log('👷 مقاول الباطن: عقد ← شهادتان ← دفعة ← إفراج')
const sc = S().addSubContract({ projectId: proj.id, contractorName: 'شركة الحفر العميق', scopeAr: 'أعمال الحفر', contractValueMinor: 1_500_000, retentionPercent: 10, startDate: '2026-09-05' })
ok('عقد باطن برقم SC نشط', sc.contractNumber.startsWith('SC-') && sc.status === 'active')
const cert1 = S().addSubCertificate({ contractId: sc.id, amountMinor: 800_000, description: 'الأسبوعان الأولان' })
ok('الشهادة: صافي 720 ومحتجز 80', cert1.netMinor === 720_000 && cert1.retentionMinor === 80_000)
ok('5110 حملت التكلفة كاملة', bal('5110') === 800_000)
ok('2108 محتجز الباطن', bal('2108') === -80_000)
ok('الشهادة دخلت تكاليف المشروع تلقائياً', S().projectCosts.some((c) => c.projectId === proj.id && c.kind === 'subcontract' && c.amountMinor === 800_000))
S().addSubCertificate({ contractId: sc.id, amountMinor: 700_000, description: 'إتمام الحفر' })
throws('شهادة تتجاوز قيمة العقد تُرفض', () => S().addSubCertificate({ contractId: sc.id, amountMinor: 100_000, description: 'x' }), 'تتجاوز')
S().paySubContractor({ contractId: sc.id, amountMinor: 1_000_000, treasury: '1101' })
ok('2101 انخفض بالدفعة', bal('2101') === -(720_000 + 630_000 - 1_000_000))
throws('دفعة أكبر من المستحق تُرفض', () => S().paySubContractor({ contractId: sc.id, amountMinor: 999_999_999, treasury: '1101' }), 'أكبر')
const rel = S().releaseSubRetention(sc.id, '1101')
ok('أُفرج عن 150 ألف محتجزات', rel.amount === 150_000)
ok('2108 صفر والعقد مقفل', bal('2108') === 0 && S().subContracts.find((c) => c.id === sc.id).status === 'completed')
throws('شهادة على عقد مقفل تُرفض', () => S().addSubCertificate({ contractId: sc.id, amountMinor: 1000, description: 'x' }), 'نشط')

console.log('🛡️ خطابات الضمان')
const bond = S().issueBond({ projectId: proj.id, bondNumber: 'LG-2026-01', type: 'performance', beneficiary: 'شركة التعمير', amountMinor: 1_200_000, marginMinor: 240_000, feesMinor: 6_000, bank: '1102', issueDate: '2026-09-10', expiryDate: '2027-09-10' })
ok('الهامش مجمد في 1109', bal('1109') === 240_000)
ok('البنك انخفض بالهامش والمصاريف', bal('1102') === 1_000_000 - 246_000)
S().settleBond(bond.id, 'released')
ok('رد الخطاب حرر الهامش', bal('1109') === 0 && bal('1102') === 1_000_000 - 6_000)
const bond2 = S().issueBond({ projectId: null, bondNumber: 'LG-2026-02', type: 'bid', beneficiary: 'هيئة الطرق', amountMinor: 500_000, marginMinor: 100_000, feesMinor: 0, bank: '1102', issueDate: '2026-09-11', expiryDate: '2026-12-01' })
S().settleBond(bond2.id, 'forfeited')
ok('المصادرة حولت الهامش لخسارة 5108', bal('1109') === 0)
throws('تسوية خطاب مُسوَّى تُرفض', () => S().settleBond(bond.id, 'released'), 'بالفعل')
throws('هامش أكبر من قيمة الخطاب يُرفض', () => S().issueBond({ projectId: null, bondNumber: 'X', type: 'bid', beneficiary: 'ج', amountMinor: 100, marginMinor: 200, feesMinor: 0, bank: '1102', issueDate: '2026-09-11', expiryDate: '2026-12-01' }), 'يتجاوز')

console.log('⛏️ عمال اليومية')
const w = S().addDailyWorker({ nameAr: 'عم سيد', phone: '', dailyWageMinor: 30_000 })
S().addDailyWorkRecord({ workerId: w.id, projectId: proj.id, date: '2026-09-12', days: 1 })
S().addDailyWorkRecord({ workerId: w.id, projectId: proj.id, date: '2026-09-13', days: 0.5 })
const cost5110Before = bal('5110')
const st = S().settleDailyWorker(w.id, '1101')
ok('التسوية جمعت يوم ونصف = 45 ألف', st.total === 45_000 && st.recordCount === 2)
ok('5110 حملت الأجور', bal('5110') === cost5110Before + 45_000)
ok('الأجور دخلت تكاليف المشروع (بند labor)', S().projectCosts.some((c) => c.projectId === proj.id && c.kind === 'labor' && c.amountMinor === 45_000))
ok('السجلات معلمة settled', S().dailyWorkRecords.filter((r) => r.workerId === w.id).every((r) => r.settled))
throws('تسوية بلا سجلات تُرفض', () => S().settleDailyWorker(w.id, '1101'), 'أجور')

console.log('📊 تقرير WIP')
const wip = S().getProjectWip(proj.id)
ok('الموازنة من BOQ (7.4م) لا العقد', wip.costToCompleteMinor === Math.max(0, 7_400_000 - wip.costsMinor))
ok('نسبة الإنجاز بين 0 و1', wip.percentComplete >= 0 && wip.percentComplete <= 1)
ok('المفوتر = 3م (المستخلص الوحيد الناجح)', wip.billedMinor === 3_000_000)
ok('حالة الفوترة محسوبة', ['on_track', 'over_billed', 'under_billed'].includes(wip.status))

console.log('⚖️ الميزان')
ok('دفتر الأستاذ متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 عمق المقاولات كامل: BOQ وأوامر تغيير ودفعات مقدمة وباطن وضمانات ويوميات وWIP')
