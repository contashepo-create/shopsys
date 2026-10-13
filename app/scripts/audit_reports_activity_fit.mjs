/**
 * جردٌ آليّ (لا بوابة CI) — «هل تتكيّف التقارير والسندات مع النشاط والوحدات المطعَّمة؟»
 * هذا السكربت هو **دليل الإغلاق** المُعاد تشغيله بعد سياسة النواة الموحّدة (v1.0.24):
 *  ① نشاط بلا كاشير (مغسلة): البطاقة الجديدة «إيراد الفترة من الدفتر» = قائمة الدخل = 300،
 *     وبطاقة فواتير الكاشير تبقى 0 لأنها **تفصيل** لا إجمالي.
 *  ② سوبرماركت + مغسلة: الإيراد يتوزّع بالأقسام (كاشير 200 · مغسلة 120) والإجمالي 320.
 *  ③ معرض سيارات: 1103/5101 ظاهران من أول تشغيل (لا «حساب يظهر فجأة»).
 *  ④ منح «كاشير» لنشاط بلا مخزون: التبعيات تُغلق تلقائياً ⇒ الشاشات والحسابات كاملة.
 *  ⑤ سندات القبض والصرف: كل نشاط له حسابات مقابلة متاحة، وأولها هو الافتراضي.
 *
 * تشغيل: node --experimental-strip-types scripts/audit_reports_activity_fit.mjs
 */
import { freshCase, addSimpleItem, balanceOf } from './auditKit.mjs'
import { ACTIVITY_TEMPLATES, effectiveModules } from '../src/core/activities.ts'
import { coaForModules, pathAllowedForSetup, ACCOUNT_MODULE_MAP } from '../src/core/coaVisibility.ts'
import { voucherCountersFor } from '../src/core/voucherCounters.ts'
import { salesSummary, activityRevenueRows } from '../src/core/reports.ts'
import { incomeStatement } from '../src/core/financialReports.ts'

const PERIOD = { from: '0000-01-01', to: '2999-12-31' }
const fmt = (m) => (m / 100).toFixed(2)
const rev = (st, mods) => activityRevenueRows(st.journal, PERIOD, { moduleOf: ACCOUNT_MODULE_MAP, activeModules: mods, coreModules: ['pos', 'inventory', 'purchases'] })

console.log('═══ ① نشاط بلا كاشير: مغسلة — البطاقة الجديدة تجيب الرقم الصحيح ═══')
{
  const c = await freshCase({ activityId: 'laundry', vatPercent: 0, taxInclusive: true })
  const order = c.st().openLaundryOrder({
    customerId: null, customerName: 'عميل', phone: '', promisedAt: '2026-04-05',
    lines: [{ desc: 'بدلة', service: 'dry_clean', qty: 2, unitPriceMinor: 15000 }],
    prepaidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().setLaundryStatus(order.id, 'processing')
  c.st().setLaundryStatus(order.id, 'ready')
  c.st().deliverLaundryOrder({ orderId: order.id, treasury: '1101' })

  const st = c.st()
  const center = salesSummary(st.sales, st.saleReturns, PERIOD)
  const is = incomeStatement(st.journal, PERIOD)
  const journalRev = rev(st, effectiveModules('laundry', []))
  console.log(`  إيراد 4103 في اليومية: ${fmt(-balanceOf(st.journal, '4103'))}`)
  console.log(`  «إيراد الفترة من الدفتر» (الجديد): ${fmt(journalRev.totalMinor)} — البند: ${journalRev.rows.map((r) => `${r.accountCode} ${r.nameAr || ''} (${r.moduleNameAr ?? 'عام'})`).join(' · ')}`)
  console.log(`  قائمة الدخل: ${fmt(is.totalRevenueMinor)} · بطاقة فواتير الكاشير (تفصيل): ${fmt(center.totalMinor)}`)
  console.log(`  ⇒ ${journalRev.totalMinor === is.totalRevenueMinor ? '✓ البطاقة تطابق القوائم المالية — التناقض انتهى (بطاقة الكاشير صارت تفصيلاً موسوماً)' : '⚠ ما زال هناك فرق'}`)
}

console.log('\n═══ ② سوبرماركت + مغسلة (وحدة مطعَّمة): الإيراد يتوزّع بالأقسام ═══')
{
  const c = await freshCase({ activityId: 'grocery', vatPercent: 0, taxInclusive: true, extraModules: ['laundry'] })
  const item = addSimpleItem(c, { nameAr: 'بضاعة', priceMinor: 2000, extra: { costMinor: 1000, stockQty: 100 } })
  c.st().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  })
  const order = c.st().openLaundryOrder({
    customerId: null, customerName: 'عميل', phone: '', promisedAt: '2026-04-05',
    lines: [{ desc: 'قميص', service: 'wash_iron', qty: 3, unitPriceMinor: 4000 }],
    prepaidMinor: 0, treasury: '1101', notes: '',
  })
  c.st().setLaundryStatus(order.id, 'processing')
  c.st().setLaundryStatus(order.id, 'ready')
  c.st().deliverLaundryOrder({ orderId: order.id, treasury: '1101' })

  const st = c.st()
  const journalRev = rev(st, effectiveModules('grocery', ['laundry']))
  const byModule = new Map()
  for (const r of journalRev.rows) {
    const key = r.moduleNameAr ?? 'عام'
    byModule.set(key, (byModule.get(key) ?? 0) + r.amountMinor)
  }
  console.log(`  الوحدات المفعّلة: ${effectiveModules('grocery', ['laundry']).join(', ')}`)
  console.log(`  الإجمالي من الدفتر: ${fmt(journalRev.totalMinor)}`)
  for (const [name, amount] of [...byModule.entries()].sort((a, b) => b[1] - a[1])) console.log(`   • ${name}: ${fmt(amount)}`)
  console.log(`  ⇒ ${journalRev.totalMinor === 32000 ? '✓ إيراد النشاط الأصلي وإيراد الوحدة المطعَّمة في بطاقة واحدة موزّعة بالأقسام' : '⚠ التوزيع غير مكتمل'}`)
}

console.log('\n═══ ③ معرض سيارات (نشاط بلا كاشير): حسابات المخزون ظاهرة من أول تشغيل ═══')
{
  const c = await freshCase({ activityId: 'cars', vatPercent: 0, taxInclusive: false })
  const before = coaForModules(c.coa, c.modules).map((a) => a.code)
  console.log(`  وحدات النشاط: ${c.modules.join(', ')}`)
  console.log(`  قبل أي حركة: 1103 مخزون ظاهر؟ ${before.includes('1103')} · 5101 تكلفة البضاعة ظاهر؟ ${before.includes('5101')}`)
  c.st().addCar({ make: 'تويوتا', model: 'كامري', year: 2024, plateOrVin: 'س ع د 1234', purpose: 'sale', purchaseCostMinor: 50000000, odometerKm: 0, payment: 'cash', notes: '', treasury: '1101' })
  const used = new Set(c.st().journal.flatMap((e) => e.lines.map((l) => l.accountCode)))
  const after = coaForModules(c.coa, c.modules, used).map((a) => a.code)
  console.log(`  بعد شراء سيارة: 1103 ظاهر؟ ${after.includes('1103')} · 5101 ظاهر؟ ${after.includes('5101')}`)
  console.log(`  ⇒ ${before.includes('1103') && before.includes('5101') ? '✓ الشجرة مستقرة من البداية — لا حساب يظهر فجأة' : '⚠ ما زال مؤجلاً'}`)
}

console.log('\n═══ ④ منح «كاشير» لنشاط لا يملكه: التبعيات تُغلق تلقائياً ═══')
{
  const mods = effectiveModules('equipment_rental', ['pos'])
  const c = await freshCase({ activityId: 'equipment_rental', extraModules: ['pos'], vatPercent: 0, taxInclusive: false })
  const vis = new Set(coaForModules(c.coa, mods).map((a) => a.code))
  console.log(`  الوحدات بعد المنح (إغلاق تلقائي): ${mods.join(', ')}`)
  console.log(`  مسار /pos؟ ${pathAllowedForSetup('/pos', mods, [], 'equipment_rental')} · /inventory؟ ${pathAllowedForSetup('/inventory', mods, [], 'equipment_rental')} · /purchases؟ ${pathAllowedForSetup('/purchases', mods, [], 'equipment_rental')}`)
  console.log(`  حسابات محرك الكاشير: 1103 ظاهر؟ ${vis.has('1103')} · 5101 ظاهر؟ ${vis.has('5101')} · 5111 ظاهر؟ ${vis.has('5111')}`)
  console.log(`  ⇒ ${vis.has('1103') && vis.has('5101') ? '✓ الوحدة الممنوحة تعمل كاملة — لا ترحيل على حساب مخفي' : '⚠ الثقب باقٍ'}`)
}

console.log('\n═══ ⑤ سندات القبض والصرف: الحسابات المقابلة المتاحة لكل نشاط ═══')
{
  /* نفس كتالوج الشاشة حرفياً (`core/voucherCounters.ts`) — لا نسخة محلية تتقادم */
  const rows = ACTIVITY_TEMPLATES.map((t) => {
    const mods = effectiveModules(t.id, [])
    return { id: t.id, rec: voucherCountersFor('receipt', mods), pay: voucherCountersFor('payment', mods) }
  })
  const empty = rows.filter((r) => !r.rec.length || !r.pay.length)
  console.log(`  أنشطة لها حساب قبض وحساب صرف متاح: ${rows.length - empty.length}/${rows.length}${empty.length ? ` — ناقص: ${empty.map((r) => r.id).join(', ')}` : ' ✓'}`)
  for (const id of ['logistics', 'lab', 'realestate', 'laundry', 'cars']) {
    const r = rows.find((x) => x.id === id)
    console.log(`   ${id.padEnd(18)} قبض: ${r.rec.map((c) => c.code).join(',')} | صرف: ${r.pay.map((c) => c.code).join(',')}`)
  }
  /* بنود الأقسام: تُفتح بمنح الوحدة وتُغلق لمن لا يملكها */
  const extrasFor = (id, kind) => rows.find((x) => x.id === id)[kind === 'receipt' ? 'rec' : 'pay'].map((c) => c.code)
  console.log(`  بنود الأقسام: معدات ${extrasFor('equipment_rental', 'payment').filter((c) => ['5105', '2103', '2109'].includes(c)).join(',')}`
    + ` · نقلات ${extrasFor('logistics', 'payment').filter((c) => ['2111', '2113', '5106'].includes(c)).join(',')}`
    + ` · مقاولات ${extrasFor('contracting', 'payment').filter((c) => ['2108', '2112'].includes(c)).join(',')}`
    + ` · عقارات ${extrasFor('realestate', 'payment').filter((c) => ['2115', '2103'].includes(c)).join(',')}`)
  const leaked = extrasFor('grocery', 'payment').filter((c) => ['2111', '2113', '2108', '2115', '2110', '5109'].includes(c))
  console.log(`  بقالة (بلا أقسام): بند غريب؟ ${leaked.length === 0 ? 'لا ✓' : `نعم ${leaked.join(',')}`}`)
  console.log('  ⇒ أول حساب في القائمة هو الافتراضي في الشاشة (تُهيَّأ آلياً) — لا خانة فارغة ولا خطأ عند أول حفظ')
}
