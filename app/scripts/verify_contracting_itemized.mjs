/**
 * فحص المستخلص البندي + موازنة الفئات (نقلة المقاولات — نمط AccFlex/pro-acc):
 * 1) مستخلص بندي من BOQ بنسب تراكمية — القيمة تُحسب آلياً وتُحدَّث نسب الإنجاز.
 * 2) رفض التراجع عن نسبة سابقة، ورفض نسبة > 100، ورفض بند من مشروع آخر.
 * 3) موازنة فئات التكاليف وتقرير الانحراف (ok/warning/over).
 * تشغيل: node --experimental-strip-types scripts/verify_contracting_itemized.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('🏗️ التأسيس: مشروع 1,000,000 قرش بمحتجز 10٪ وبندا BOQ')
S().addProject({ nameAr: 'مجمع الوادي', clientName: 'العميل أ', contractValueMinor: 1_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })
const proj = S().projects.at(-1)
S().addBoqItem({ projectId: proj.id, code: '1-1', descriptionAr: 'حفر وأساسات', unit: 'م3', qty: 100, unitPriceMinor: 4000 }) // إجمالي 400,000
S().addBoqItem({ projectId: proj.id, code: '2-1', descriptionAr: 'خرسانة مسلحة', unit: 'م3', qty: 60, unitPriceMinor: 10000 }) // إجمالي 600,000
const [b1, b2] = S().boqItems.filter((b) => b.projectId === proj.id)

// مشروع آخر ببند — لاختبار العزل
S().addProject({ nameAr: 'مشروع آخر', clientName: 'العميل ب', contractValueMinor: 500_000, retentionPercent: 5, startDate: '2026-09-01', notes: '' })
const proj2 = S().projects.at(-1)
S().addBoqItem({ projectId: proj2.id, code: '9-9', descriptionAr: 'بند غريب', unit: 'مقطوعية', qty: 1, unitPriceMinor: 500_000 })
const bAlien = S().boqItems.find((b) => b.projectId === proj2.id)

console.log('📋 المستخلص البندي الأول: 30٪ من البند 1 + 20٪ من البند 2')
const ex1 = S().addProjectExtract({
  projectId: proj.id,
  extractLines: [
    { boqItemId: b1.id, newProgressPercent: 30 }, // 400000×30٪ = 120000
    { boqItemId: b2.id, newProgressPercent: 20 }, // 600000×20٪ = 120000
  ],
  vatPercent: 0, payment: 'credit', description: 'مستخلص بندي 1',
})
ok('إجمالي المستخلص = 240,000 محسوب من البنود', ex1.totals.grossMinor === 240_000, ex1.totals.grossMinor)
ok('بنود المستخلص محفوظة (2 بند بقيم صحيحة)', ex1.lines?.length === 2 && ex1.lines[0].lineValueMinor === 120_000 && ex1.lines[1].lineValueMinor === 120_000)
ok('نسب إنجاز BOQ تحدثت تلقائياً (30 و20)', S().boqItems.find((b) => b.id === b1.id).progressPercent === 30 && S().boqItems.find((b) => b.id === b2.id).progressPercent === 20)
ok('المحتجز 10٪ خُصم = 24,000', ex1.totals.retentionMinor === 24_000, ex1.totals.retentionMinor)
ok('دفتر الأستاذ متوازن بعد المستخلص البندي', balanced())

console.log('🚫 القيود الصارمة')
throws('رفض التراجع: 25٪ بعد 30٪ على نفس البند', () => S().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 25 }], vatPercent: 0, payment: 'credit', description: 'تراجع' }), 'تراكمي')
throws('رفض نسبة فوق 100', () => S().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 120 }], vatPercent: 0, payment: 'credit', description: 'فوق' }))
throws('رفض بند من مشروع آخر', () => S().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: bAlien.id, newProgressPercent: 50 }], vatPercent: 0, payment: 'credit', description: 'دخيل' }))
throws('رفض مستخلص بلا مبلغ ولا بنود', () => S().addProjectExtract({ projectId: proj.id, vatPercent: 0, payment: 'credit', description: 'فارغ' }))

console.log('📋 المستخلص البندي الثاني: تراكمي 30→70٪ للبند 1 فقط')
const ex2 = S().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 70 }], vatPercent: 0, payment: 'credit', description: 'مستخلص بندي 2' })
ok('قيمة الشريحة = 400,000×40٪ = 160,000', ex2.totals.grossMinor === 160_000, ex2.totals.grossMinor)
ok('نسبة البند 1 الآن 70٪ والبند 2 بقي 20٪', S().boqItems.find((b) => b.id === b1.id).progressPercent === 70 && S().boqItems.find((b) => b.id === b2.id).progressPercent === 20)

console.log('💰 النمط القديم (مبلغ إجمالي) ما زال يعمل')
const ex3 = S().addProjectExtract({ projectId: proj.id, grossMinor: 50_000, vatPercent: 0, payment: 'credit', description: 'مستخلص إجمالي' })
ok('مستخلص المبلغ الإجمالي بلا بنود يعمل', ex3.totals.grossMinor === 50_000 && !ex3.lines)

console.log('📊 موازنة الفئات وتقرير الانحراف')
S().setProjectBudget(proj.id, [
  { kind: 'materials', amountMinor: 100_000 },
  { kind: 'labor', amountMinor: 50_000 },
  { kind: 'equipment', amountMinor: 20_000 },
])
S().addProjectCost({ projectId: proj.id, kind: 'materials', amountMinor: 90_000, payment: 'cash', description: 'خامات', treasury: '1101' }) // 90٪ → warning
S().addProjectCost({ projectId: proj.id, kind: 'labor', amountMinor: 60_000, payment: 'cash', description: 'عمالة', treasury: '1101' }) // 120٪ → over
S().addProjectCost({ projectId: proj.id, kind: 'equipment', amountMinor: 5_000, payment: 'cash', description: 'معدات', treasury: '1101' }) // 25٪ → ok
S().addProjectCost({ projectId: proj.id, kind: 'other', amountMinor: 7_000, payment: 'cash', description: 'نثريات بلا موازنة', treasury: '1101' }) // بلا موازنة → over

const rep = S().getProjectBudgetVariance(proj.id)
const row = (k) => rep.rows.find((r) => r.kind === k)
ok('materials عند 90٪ → تحذير', row('materials')?.status === 'warning', JSON.stringify(row('materials')))
ok('labor تجاوز → over وانحراف −10,000', row('labor')?.status === 'over' && row('labor')?.varianceMinor === -10_000)
ok('equipment عند 25٪ → ok ووفر 15,000', row('equipment')?.status === 'ok' && row('equipment')?.varianceMinor === 15_000)
ok('تكلفة بلا موازنة تظهر over', row('other')?.status === 'over' && row('other')?.budgetMinor === 0)
ok('الإجماليات صحيحة (موازنة 170,000 / فعلي 162,000)', rep.totalBudgetMinor === 170_000 && rep.totalActualMinor === 162_000, `${rep.totalBudgetMinor}/${rep.totalActualMinor}`)
throws('رفض موازنة بمبلغ سالب', () => S().setProjectBudget(proj.id, [{ kind: 'materials', amountMinor: -5 }]))
throws('رفض موازنة لمشروع غير موجود', () => S().setProjectBudget(999_999, [{ kind: 'materials', amountMinor: 100 }]), 'غير موجود')

// استبدال الموازنة يحل محل السابقة لا يضيف
S().setProjectBudget(proj.id, [{ kind: 'materials', amountMinor: 200_000 }])
const rep2 = S().getProjectBudgetVariance(proj.id)
ok('إعادة ضبط الموازنة تستبدل لا تُراكم', rep2.totalBudgetMinor === 200_000, rep2.totalBudgetMinor)
ok('دفتر الأستاذ متوازن في النهاية', balanced())

console.log('🗓️ مهام الجدول الزمني')
const task = S().addProjectTask({ projectId: proj.id, nameAr: 'أعمال الحفر', startDate: '2026-09-01', endDate: '2026-09-20', progressPercent: 0, boqItemId: b1.id })
ok('مهمة جديدة تبدأ pending', task.status === 'pending')
S().updateProjectTaskProgress(task.id, 40)
ok('تقدم 40٪ → in_progress', S().projectTasks.find((t) => t.id === task.id).status === 'in_progress')
throws('تقدم المهمة تراكمي لا يتراجع', () => S().updateProjectTaskProgress(task.id, 30), 'تراكمي')
S().updateProjectTaskProgress(task.id, 100)
ok('تقدم 100٪ → done', S().projectTasks.find((t) => t.id === task.id).status === 'done')
throws('رفض مهمة نهايتها قبل بدايتها', () => S().addProjectTask({ projectId: proj.id, nameAr: 'خطأ', startDate: '2026-09-10', endDate: '2026-09-01', progressPercent: 0, boqItemId: null }))
throws('رفض ربط مهمة ببند BOQ من مشروع آخر', () => S().addProjectTask({ projectId: proj.id, nameAr: 'دخيل', startDate: '2026-09-01', endDate: '2026-09-02', progressPercent: 0, boqItemId: bAlien.id }))

console.log('🧾 أمر تغيير: draft→approved→invoiced')
const co = S().addChangeOrder({ projectId: proj.id, titleAr: 'أعمال إضافية', amountMinor: 100_000 })
throws('لا يُستخلص أمر تغيير مسودة', () => S().setChangeOrderStatus(co.id, 'invoiced'), 'معتمد')
S().setChangeOrderStatus(co.id, 'approved')
S().setChangeOrderStatus(co.id, 'invoiced')
const coAfter = S().changeOrders.find((o) => o.id === co.id)
ok('الحالة invoiced مع بقاء تاريخ الاعتماد', coAfter.status === 'invoiced' && coAfter.approvedAt !== null)
const { effectiveContractValue } = await import('../src/core/contracting.ts')
ok('المُستخلَص يبقى ضمن قيمة العقد الفعلية', effectiveContractValue(1_000_000, S().changeOrders.filter((o) => o.projectId === proj.id)) === 1_100_000)

console.log('👷 شهادة باطن بنسبة إنجاز + خصم مقدمة تلقائي (AccFlex)')
const sc = S().addSubContract({ projectId: proj.id, contractorName: 'مقاول الحفر', scopeAr: 'حفر', contractValueMinor: 200_000, retentionPercent: 5, taxWithholdPercent: 0, advanceRecoveryPercent: 20, startDate: '2026-09-01' })
S().addSubAdvance({ contractId: sc.id, amountMinor: 30_000, treasury: '1101' })
const c1 = S().addSubCertificate({ contractId: sc.id, newProgressPercent: 25, description: 'ربع الأعمال' })
ok('شهادة 25٪ = 50,000 من قيمة العقد', c1.amountMinor === 50_000, c1.amountMinor)
ok('خصم المقدمة تلقائي 20٪ = 10,000', c1.advanceRecoveryMinor === 10_000, c1.advanceRecoveryMinor)
ok('نسبة إنجاز العقد تحدثت إلى 25٪', S().subContracts.find((x) => x.id === sc.id).progressPercent === 25)
throws('رفض نسبة باطن متراجعة', () => S().addSubCertificate({ contractId: sc.id, newProgressPercent: 20, description: 'تراجع' }), 'تراكمية')
const c2 = S().addSubCertificate({ contractId: sc.id, newProgressPercent: 100, description: 'الباقي' })
ok('شهادة الإكمال 75٪ = 150,000 وخصم المقدمة بسقف رصيدها 20,000', c2.amountMinor === 150_000 && c2.advanceRecoveryMinor === 20_000, `${c2.amountMinor}/${c2.advanceRecoveryMinor}`)
ok('رصيد مقدمة الباطن صفر بعد الإطفاء', S().getSubAdvanceBalance(sc.id) === 0)
throws('رفض شهادة بلا مبلغ ولا نسبة', () => S().addSubCertificate({ contractId: sc.id, description: 'فارغة' }))
ok('دفتر الأستاذ متوازن بعد شهادات الباطن', balanced())

console.log(`\n${fail === 0 ? '🎉' : '💥'} النتيجة: ${pass} ناجح، ${fail} فاشل`)
process.exit(fail === 0 ? 0 : 1)
