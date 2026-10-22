import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
/**
 * وحدة تقارير المعدات (طلب المالك): نفس نمط مركز تقارير المقاولات —
 * لوحة الأسطول (ربحية كل معدة) · معدة بعينه (عقودها وتكاليفها وساعاتها
 * وذممها) · ذمم عملاء التأجير ومتابعة التحصيل — بتصدير CSV لكل جدول.
 * البطاقة نفسها من النواة الخالصة equipmentReportCard (قابلة للفحص ببوابة).
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, BarChart3, Users, Tractor, Clock, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { EQUIPMENT_COST_LABELS, usageHours, equipmentReportCard, type EquipmentCostKind } from '../../core/rentalMeter.ts'
import { toCsv } from '../../core/security.ts'
import { renderReportShell, htmlTableHtml, escHtml } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { EmptyState } from '../components/ui.tsx'
import { todayLocalIso } from '../../core/time.ts'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700'

function downloadCsv(rows: readonly Record<string, unknown>[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function EquipmentReportsPage() {
  const { equipment, rentalContracts, rentalInvoices, equipmentCosts, operatorShifts, customers, employees, journal, getOpenClientInvoices } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  /* §99: مطبوعات الوحدة بالغلاف الموحد (تصدير PDF/Excel لكل تقارير الوحدات) */
  const printDoc = (title: string, subtitle: string, bodyHtml: string) => {
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title, subtitle, companyName: setup.shopName || 'المنشأة', logoDataUrl: receipt.logoDataUrl, bodyHtml, settings: reportPrint }))
  }
  const sectionHtml = (label: string) => `<p class="sec" style="margin:12px 0 4px;padding:6px 10px">${escHtml(label)}</p>`
  const [tab, setTab] = usePersistedSectionView('equipment-reports', 'fleet', ['fleet', 'equipment', 'pnl', 'dues'] as const)
  const [equipmentId, setEquipmentId] = useState('')

  /** بطاقة التقرير الخالصة لكل معدة — تشمل عقودها وفواتيرها الدورية وتفصل مصاريف المالك عن المستأجر */
  const cards = useMemo(() => equipment.map((eq) => {
    const contracts = rentalContracts.filter((c) => c.equipmentId === eq.id)
    const allCosts = equipmentCosts.filter((c) => c.equipmentId === eq.id)
    const ownerCosts = allCosts.filter((c) => c.borneBy !== 'customer')
    const customerBorneMinor = allCosts.filter((c) => c.borneBy === 'customer').reduce((a, c) => a + c.amountMinor, 0)
    const directMinor = ownerCosts.filter((c) => (c.costLayer ?? (c.kind === 'operator' ? 'driver' : 'direct')) === 'direct').reduce((a, c) => a + c.amountMinor, 0)
    const driverMinor = ownerCosts.filter((c) => (c.costLayer ?? (c.kind === 'operator' ? 'driver' : 'direct')) === 'driver').reduce((a, c) => a + c.amountMinor, 0)
    const indirectMinor = ownerCosts.filter((c) => c.costLayer === 'indirect').reduce((a, c) => a + c.amountMinor, 0)
    const shiftHours = operatorShifts
      .filter((s) => s.equipmentId === eq.id && s.startReading != null && s.endReading != null)
      .reduce((a, s) => a + usageHours(s.startReading, s.endReading), 0)
    const report = equipmentReportCard({
      contracts: contracts.map((c) => {
        const realizedRent = c.billingMode === 'reference'
          ? rentalInvoices.filter((inv) => inv.contractId === c.id).reduce((s, inv) => s + inv.netMinor, 0) + (c.deductMinor ?? 0) - (c.refundedMinor ?? 0)
          : c.totals.rentMinor + (c.deductMinor ?? 0) - (c.refundedMinor ?? 0)
        return {
          days: c.days, status: c.status, extraMinor: c.extraMinor,
          rateType: c.rateType ?? 'daily', startReading: c.startReading, endReading: c.endReading,
          totals: { rentMinor: realizedRent, depositMinor: c.totals.depositMinor },
        }
      }),
      costs: ownerCosts.map((c) => ({ amountMinor: c.amountMinor })),
      shiftHours,
    })
    return {
      equipment: eq,
      report,
      contracts,
      costs: ownerCosts,
      allCosts,
      directMinor,
      driverMinor,
      indirectMinor,
      customerBorneMinor,
    }
  }), [equipment, rentalContracts, rentalInvoices, equipmentCosts, operatorShifts])

  /** المفتوح من عقود الإيجار وفواتيرها الدورية لكل معدة */
  const openByEquipment = useMemo(() => {
    const settled = new Map<string, number>()
    const custIds = new Set<number>()
    for (const c of rentalContracts) if (c.customerId != null) custIds.add(c.customerId)
    for (const inv of rentalInvoices) if (inv.customerId != null) custIds.add(inv.customerId)
    for (const cid of custIds) {
      for (const doc of getOpenClientInvoices(cid)) settled.set(doc.docKey, doc.settledMinor)
    }
    return new Map(equipment.map((eq) => {
      const openContracts = rentalContracts
        .filter((c) => c.equipmentId === eq.id && c.customerId != null && c.billingMode !== 'reference')
        .reduce((sum, c) => {
          const due = c.totals.collectCreditMinor - (c.refundedMinor ?? 0)
          return sum + Math.max(0, due - (settled.get(`rental:${c.id}`) ?? 0))
        }, 0)
      const openInvoices = rentalInvoices
        .filter((inv) => inv.equipmentId === eq.id && inv.customerId != null)
        .reduce((sum, inv) => {
          const paid = inv.payment === 'cash' ? inv.totalMinor : inv.paidNowMinor
          const due = inv.totalMinor - paid
          return sum + Math.max(0, due - (settled.get(`rentinv:${inv.id}`) ?? 0))
        }, 0)
      const openCustCosts = equipmentCosts
        .filter((cost) => cost.equipmentId === eq.id && cost.borneBy === 'customer' && cost.customerId != null)
        .reduce((sum, cost) => sum + Math.max(0, cost.amountMinor - (settled.get(`eqcost:${cost.id}`) ?? 0)), 0)
      return [eq.id, openContracts + openInvoices + openCustCosts]
    }))
  }, [equipment, rentalContracts, rentalInvoices, equipmentCosts, getOpenClientInvoices])

  const totals = useMemo(() => ({
    revenue: cards.reduce((a, r) => a + r.report.revenueMinor, 0),
    costs: cards.reduce((a, r) => a + r.report.costsMinor, 0),
    directCosts: cards.reduce((a, r) => a + r.directMinor, 0),
    driverCosts: cards.reduce((a, r) => a + r.driverMinor, 0),
    indirectCosts: cards.reduce((a, r) => a + r.indirectMinor, 0),
    customerBorneCosts: cards.reduce((a, r) => a + r.customerBorneMinor, 0),
    profit: cards.reduce((a, r) => a + r.report.profitMinor, 0),
    hours: cards.reduce((a, r) => a + r.report.hours, 0),
    deposits: cards.reduce((a, r) => a + r.report.depositsHeldMinor, 0),
    open: cards.reduce((a, r) => a + (openByEquipment.get(r.equipment.id) ?? 0), 0),
    active: cards.reduce((a, r) => a + r.report.activeContracts, 0),
  }), [cards, openByEquipment])

  /* ═══ القوائم الربحية على مستوى كل عقد + قطاع الإيجارات + الشركة ككل ═══ */
  const contractPnlRows = useMemo(() => rentalContracts.map((c) => {
    const cInvs = rentalInvoices.filter((inv) => inv.contractId === c.id)
    const revMinor = c.billingMode === 'reference'
      ? cInvs.reduce((s, inv) => s + inv.netMinor, 0) + c.extraMinor + (c.deductMinor ?? 0) - (c.refundedMinor ?? 0)
      : c.totals.rentMinor + c.extraMinor + (c.deductMinor ?? 0) - (c.refundedMinor ?? 0)
    const cCosts = equipmentCosts.filter((cost) => cost.contractId === c.id)
    const ownerC = cCosts.filter((cost) => cost.borneBy !== 'customer')
    const directMinor = ownerC.filter((cost) => (cost.costLayer ?? (cost.kind === 'operator' ? 'driver' : 'direct')) === 'direct').reduce((s, x) => s + x.amountMinor, 0)
    const driverMinor = ownerC.filter((cost) => (cost.costLayer ?? (cost.kind === 'operator' ? 'driver' : 'direct')) === 'driver').reduce((s, x) => s + x.amountMinor, 0)
    const indirectMinor = ownerC.filter((cost) => cost.costLayer === 'indirect').reduce((s, x) => s + x.amountMinor, 0)
    const ownerTotalMinor = directMinor + driverMinor + indirectMinor
    const customerBorneMinor = cCosts.filter((cost) => cost.borneBy === 'customer').reduce((s, x) => s + x.amountMinor, 0)
    const driverName = employees.find((e) => e.id === c.driverEmployeeId)?.nameAr ?? '—'
    const customerName = c.customerId != null ? (customers.find((cu) => cu.id === c.customerId)?.nameAr ?? '—') : 'نقدي'
    return {
      contract: c,
      customerName,
      driverName,
      invoicesCount: cInvs.length,
      revMinor,
      directMinor,
      driverMinor,
      indirectMinor,
      ownerTotalMinor,
      customerBorneMinor,
      netProfitMinor: revMinor - ownerTotalMinor,
    }
  }), [rentalContracts, rentalInvoices, equipmentCosts, employees, customers])

  const companyVsRentalPnl = useMemo(() => {
    let totalRev4xxx = 0
    let rentalRev4104 = 0
    let contractingRev4107 = 0
    let totalExp5xxx = 0
    let rentalExp5105 = 0
    let contractingExp5106 = 0
    for (const entry of journal) {
      for (const l of entry.lines) {
        if (l.accountCode.startsWith('4')) {
          const net = l.credit - l.debit
          totalRev4xxx += net
          if (l.accountCode === '4104') rentalRev4104 += net
          if (l.accountCode === '4107') contractingRev4107 += net
        } else if (l.accountCode.startsWith('5')) {
          const net = l.debit - l.credit
          totalExp5xxx += net
          if (l.accountCode === '5105') rentalExp5105 += net
          if (l.accountCode === '5106') contractingExp5106 += net
        }
      }
    }
    const otherRev = totalRev4xxx - rentalRev4104 - contractingRev4107
    const otherExp = totalExp5xxx - rentalExp5105 - contractingExp5106
    return {
      rentalRev4104,
      rentalExp5105,
      rentalNet: rentalRev4104 - rentalExp5105,
      contractingRev4107,
      contractingExp5106,
      contractingNet: contractingRev4107 - contractingExp5106,
      otherRev,
      otherExp,
      companyRev: totalRev4xxx,
      companyExp: totalExp5xxx,
      companyNet: totalRev4xxx - totalExp5xxx,
    }
  }, [journal])

  /* ═══ تبويب: معدة بعينه ═══ */
  const selected = cards.find((r) => r.equipment.id === Number(equipmentId)) ?? null
  const selectedShifts = selected ? operatorShifts.filter((s) => s.equipmentId === selected.equipment.id) : []
  const selectedOpenDocs = selected
    ? (() => {
        const custIds = new Set<number>()
        for (const c of selected.contracts) if (c.customerId != null) custIds.add(c.customerId)
        const contractIds = new Set(selected.contracts.map((c) => `rental:${c.id}`))
        const invIds = new Set(rentalInvoices.filter((inv) => inv.equipmentId === selected.equipment.id).map((inv) => `rentinv:${inv.id}`))
        const costIds = new Set(equipmentCosts.filter((cost) => cost.equipmentId === selected.equipment.id && cost.borneBy === 'customer').map((cost) => `eqcost:${cost.id}`))
        return [...custIds].flatMap((cid) =>
          getOpenClientInvoices(cid).filter(
            (doc) => (contractIds.has(doc.docKey) || invIds.has(doc.docKey) || costIds.has(doc.docKey)) && doc.dueMinor - doc.settledMinor > 0,
          ),
        )
      })()
    : []

  /* ═══ تبويب: ذمم عملاء التأجير ═══ */
  const renterDues = useMemo(() => {
    const byClient = new Map<number, { nameAr: string; contractsCount: number; revenueMinor: number; openMinor: number }>()
    for (const c of rentalContracts) {
      if (c.customerId == null) continue
      const row = byClient.get(c.customerId) ?? { nameAr: customers.find((x) => x.id === c.customerId)?.nameAr ?? '—', contractsCount: 0, revenueMinor: 0, openMinor: 0 }
      row.contractsCount += 1
      const cRev = c.billingMode === 'reference'
        ? rentalInvoices.filter((inv) => inv.contractId === c.id).reduce((s, inv) => s + inv.netMinor, 0) + c.extraMinor
        : c.totals.rentMinor + c.extraMinor
      row.revenueMinor += cRev
      byClient.set(c.customerId, row)
    }
    for (const [customerId, row] of byClient) {
      for (const inv of getOpenClientInvoices(customerId)) {
        if (inv.docKey.startsWith('rental:') || inv.docKey.startsWith('rentinv:') || inv.docKey.startsWith('rentalextra:') || inv.docKey.startsWith('eqcost:')) {
          row.openMinor += inv.dueMinor - inv.settledMinor
        }
      }
    }
    return [...byClient.entries()].map(([customerId, row]) => ({ customerId, ...row })).sort((a, b) => b.openMinor - a.openMinor)
  }, [rentalContracts, rentalInvoices, customers, getOpenClientInvoices])

  /* ═══ §99: مطبوعات الأسطول / بطاقة المعدة / الذمم — كل جدول قابل للطباعة PDF ═══ */
  const printFleet = () => printDoc('لوحة أسطول المعدات', 'ربحية كل معدة — الأرقام من العقود والقيود المرحّلة', htmlTableHtml({
    headers: ['المعدة', 'الكود', 'الإيراد', 'المصاريف', 'الربح', 'ربح الساعة', 'ساعات', 'عقود (نشطة)', 'تأمينات محتجزة', 'ذمم مفتوحة'],
    numCols: [2, 3, 4, 5, 6, 8, 9],
    rows: cards.map(({ equipment: eq, report: r }) => [
      eq.nameAr, eq.code || `#${eq.id}`, fmt(r.revenueMinor), fmt(r.costsMinor), fmt(r.profitMinor),
      r.profitPerHourMinor != null ? fmt(r.profitPerHourMinor) : '—', r.hours,
      `${r.contractsCount} (${r.activeContracts})`, fmt(r.depositsHeldMinor), fmt(openByEquipment.get(eq.id) ?? 0),
    ]),
    totalRow: ['الإجمالي', '', fmt(totals.revenue), fmt(totals.costs), fmt(totals.profit), '—', totals.hours, `${cards.reduce((a, r) => a + r.report.contractsCount, 0)} (${totals.active})`, fmt(totals.deposits), fmt(totals.open)],
  }))

  const printEquipmentCard = () => {
    if (!selected) return
    const r = selected.report
    const body = [
      htmlTableHtml({
        headers: ['مؤشرات البطاقة', 'القيمة'], numCols: [1],
        rows: [
          ['إيراد الإيجار + التجاوز', fmt(r.revenueMinor)],
          ['مصاريف التشغيل', fmt(r.costsMinor)],
          ...(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => [`مصاريف — ${EQUIPMENT_COST_LABELS[k]}`, fmt(selected.costs.filter((c) => c.kind === k).reduce((a, c) => a + c.amountMinor, 0))] as const),
          ['الربح', fmt(r.profitMinor)],
          ['ساعات التشغيل الموثقة', r.hours],
          ['ربح الساعة', r.profitPerHourMinor != null ? fmt(r.profitPerHourMinor) : '—'],
          ['العقود (نشطة)', `${r.contractsCount} (${r.activeContracts})`],
          ['الوحدات المحجوزة', r.rentedUnits],
          ['تأمينات محتجزة', fmt(r.depositsHeldMinor)],
          ['ذمم مفتوحة', fmt(openByEquipment.get(selected.equipment.id) ?? 0)],
          ['قراءة العدّاد', selected.equipment.meterReading],
        ],
      }),
      ...(selected.contracts.length ? [
        sectionHtml(`العقود (${selected.contracts.length})`),
        htmlTableHtml({
          headers: ['العقد', 'التاريخ', 'الأيام × اليومية', 'تجاوز', 'الإجمالي', 'الحالة'], numCols: [4, 5],
          rows: selected.contracts.map((c) => [c.contractNumber, c.date.slice(0, 10), `${c.days} × ${fmt(c.dailyRateMinor)}`, c.extraMinor > 0 ? fmt(c.extraMinor) : '—', fmt(c.totals.grandMinor + c.extraMinor), c.status === 'active' ? 'نشط' : 'مُقفل']),
        }),
      ] : []),
      ...(selectedOpenDocs.length ? [
        sectionHtml('ذمم الإيجار المفتوحة — تُسدَّد من سند قبض/تحصيل العميل'),
        htmlTableHtml({
          headers: ['المستند', 'التاريخ', 'محصّل', 'المتبقي'], numCols: [2, 3],
          rows: selectedOpenDocs.map((inv) => [inv.docLabel, inv.date.slice(0, 10), fmt(inv.settledMinor), fmt(inv.dueMinor - inv.settledMinor)]),
        }),
      ] : []),
      ...(selected.costs.length ? [
        sectionHtml(`مصاريف التشغيل (${selected.costs.length})`),
        htmlTableHtml({
          headers: ['البيان', 'النوع', 'التاريخ', 'المبلغ'], numCols: [3],
          rows: selected.costs.map((c) => [c.description, EQUIPMENT_COST_LABELS[c.kind], c.date.slice(0, 10), fmt(c.amountMinor)]),
        }),
      ] : []),
      ...(selectedShifts.length ? [
        sectionHtml(`وردانيات المشغلين (${selectedShifts.length})`),
        htmlTableHtml({
          headers: ['المشغل', 'التاريخ', 'قراءة العدّاد', 'الساعات'], numCols: [3],
          rows: selectedShifts.map((x) => [x.operatorName, x.date.slice(0, 10), `${x.startReading} ← ${x.endReading ?? '—'}`, `${usageHours(x.startReading, x.endReading)} س`]),
        }),
      ] : []),
    ].join('')
    printDoc(`بطاقة معدة — ${selected.equipment.code || `#${selected.equipment.id}`}`, selected.equipment.nameAr, body)
  }

  const printDues = () => printDoc('ذمم عملاء التأجير', 'متابعة التحصيل — المفتوح من مستحقات العقود', htmlTableHtml({
    headers: ['العميل', 'العقود', 'إيراد الإيجار', 'ذمم مفتوحة'],
    numCols: [1, 2, 3],
    rows: renterDues.map((row) => [row.nameAr, row.contractsCount, fmt(row.revenueMinor), row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة']),
    totalRow: ['الإجمالي', renterDues.reduce((a, r) => a + r.contractsCount, 0), fmt(renterDues.reduce((a, r) => a + r.revenueMinor, 0)), fmt(renterDues.reduce((a, r) => a + r.openMinor, 0))],
  }))

  const kpi = (label: string, value: string, tone = 'text-slate-800 dark:text-slate-100') => (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-center"><div className="text-[10px] text-slate-400 font-bold">{label}</div><div className={`font-black text-[15px] ${tone}`}>{value}</div></div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><BarChart3 className="w-6 h-6 text-teal-500" /> وحدة تقارير المعدات</h1>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['fleet', 'لوحة الأسطول'],
            ['equipment', 'معدة بعينها'],
            ['pnl', 'القوائم الربحية (٤ مستويات)'],
            ['dues', 'ذمم عملاء التأجير'],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${tab === id ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{label}</button>
          ))}
        </div>
      </div>

      {equipment.length === 0 ? (
        <EmptyState icon="🚜" title="لا معدات بعد" sub="أضف معداتك من قسم «المعدات» ثم أجرِ عقود الإيجار — كل التقارير تُبنى تلقائياً من القيود" />
      ) : (
        <>
          {/* ═══ KPIs إجمالية دائمة ═══ */}
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {kpi('إيراد الأسطول', fmt(totals.revenue))}
            {kpi('مصاريف التشغيل', fmt(totals.costs), 'text-rose-600')}
            {kpi('أرباح الأسطول', fmt(totals.profit), totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}
            {kpi('ساعات تشغيل', `${totals.hours}`, 'text-sky-600')}
            {kpi('عقود نشطة', `${totals.active}`, 'text-teal-600')}
            {kpi('تأمينات محتجزة', fmt(totals.deposits), 'text-amber-600')}
            {kpi('ذمم مفتوحة', fmt(totals.open), 'text-rose-600')}
          </div>

          {/* ═══ ① لوحة الأسطول ═══ */}
          {tab === 'fleet' && (
            <div className="anim-up space-y-3">
              <div className="flex justify-end gap-1.5">
                <button onClick={printFleet} data-print="fleet"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => downloadCsv(cards.map((r) => ({
                  'المعدة': r.equipment.nameAr, 'الكود': r.equipment.code || '—',
                  'الإيراد': fmt(r.report.revenueMinor), 'مصاريف التشغيل': fmt(r.report.costsMinor),
                  'الربح': fmt(r.report.profitMinor), 'ساعات': r.report.hours,
                  'ربح الساعة': r.report.profitPerHourMinor != null ? fmt(r.report.profitPerHourMinor) : '—',
                  'عقود': r.report.contractsCount, 'نشطة': r.report.activeContracts,
                  'وحدات محجوزة': r.report.rentedUnits, 'تأمينات محتجزة': fmt(r.report.depositsHeldMinor),
                  'ذمم مفتوحة': fmt(openByEquipment.get(r.equipment.id) ?? 0),
                })), `تقرير-أسطول-المعدات-${todayLocalIso()}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير الأسطول CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-teal-500/10 text-teal-700 dark:text-teal-300">
                    <tr>{['المعدة', 'إيراد', 'مصاريف', 'ربح', 'ربح الساعة', 'ساعات', 'عقود (نشطة)', 'تأمينات محتجزة', 'ذمم مفتوحة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cards.map(({ equipment: eq, report: r }) => (
                      <tr key={eq.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-teal-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-black whitespace-nowrap"><Tractor size={13} className="inline ml-1 text-teal-500" /> {eq.nameAr}<span className="block text-[10.5px] font-bold text-slate-400">{eq.code || `#${eq.id}`}</span></td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{fmt(r.revenueMinor)}</td>
                        <td className="px-3 py-2.5 text-rose-600 font-bold whitespace-nowrap">{fmt(r.costsMinor)}</td>
                        <td className={`px-3 py-2.5 font-black whitespace-nowrap ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap text-sky-600">{r.profitPerHourMinor != null ? fmt(r.profitPerHourMinor) : '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{r.hours}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{r.contractsCount} <span className="text-teal-600 font-bold">({r.activeContracts})</span></td>
                        <td className="px-3 py-2.5 text-amber-600 font-bold whitespace-nowrap">{fmt(r.depositsHeldMinor)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{openByEquipment.get(eq.id) ? <span className="text-rose-600">{fmt(openByEquipment.get(eq.id)!)}</span> : <span className="text-emerald-600">✓</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ② معدة بعينها ═══ */}
          {tab === 'equipment' && (
            <div className="anim-up space-y-3">
              <div className={`${card} p-4`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-64 flex-1"><PartyQuickPicker parties={equipment.map((eq) => ({ id: eq.id, nameAr: `${eq.code || `#${eq.id}`} — ${eq.nameAr}` }))} value={equipmentId ? Number(equipmentId) : 0} onChange={(id) => setEquipmentId(id ? String(id) : '')} cashLabel="اختر معدة" label="بحث المعدة" cashValue={0} /></div>
                  {selected && (
                    <div className="flex gap-1.5">
                    <button onClick={printEquipmentCard} data-print="equipment-card"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                    <button onClick={() => downloadCsv([
                      { 'البند': 'إيراد الإيجار + التجاوز', 'القيمة': fmt(selected.report.revenueMinor) },
                      { 'البند': 'مصاريف التشغيل', 'القيمة': fmt(selected.report.costsMinor) },
                      ...(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => ({ 'البند': `مصاريف — ${EQUIPMENT_COST_LABELS[k]}`, 'القيمة': fmt(selected.costs.filter((c) => c.kind === k).reduce((a, c) => a + c.amountMinor, 0)) })),
                      { 'البند': 'الربح', 'القيمة': fmt(selected.report.profitMinor) },
                      { 'البند': 'ساعات التشغيل الموثقة', 'القيمة': selected.report.hours },
                      { 'البند': 'ربح الساعة', 'القيمة': selected.report.profitPerHourMinor != null ? fmt(selected.report.profitPerHourMinor) : '—' },
                      { 'البند': 'العقود (نشطة)', 'القيمة': `${selected.report.contractsCount} (${selected.report.activeContracts})` },
                      { 'البند': 'الوحدات المحجوزة', 'القيمة': selected.report.rentedUnits },
                      { 'البند': 'تأمينات محتجزة', 'القيمة': fmt(selected.report.depositsHeldMinor) },
                      { 'البند': 'ذمم مفتوحة', 'القيمة': fmt(openByEquipment.get(selected.equipment.id) ?? 0) },
                    ], `تقرير-${selected.equipment.code || `معدة-${selected.equipment.id}`}.csv`)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير بطاقة المعدة</button>
                    </div>
                  )}
                </div>
              </div>

              {!selected ? (
                <EmptyState icon="🚜" title="اختر معدة" sub="بطاقة كاملة: الإيراد والمصاريف والربح وساعات التشغيل والعقود والتأمينات المحتجزة والذمم" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {kpi('الإيراد', fmt(selected.report.revenueMinor))}
                    {kpi('المصاريف', fmt(selected.report.costsMinor), 'text-rose-600')}
                    {kpi('الربح', fmt(selected.report.profitMinor), selected.report.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600')}
                    {kpi('ربح الساعة', selected.report.profitPerHourMinor != null ? fmt(selected.report.profitPerHourMinor) : '—', 'text-sky-600')}
                    {kpi('ساعات موثقة', `${selected.report.hours}`, 'text-sky-600')}
                    {kpi('عقود (نشطة)', `${selected.report.contractsCount} (${selected.report.activeContracts})`, 'text-teal-600')}
                    {kpi('وحدات محجوزة', `${selected.report.rentedUnits}`)}
                    {kpi('تأمينات محتجزة', fmt(selected.report.depositsHeldMinor), 'text-amber-600')}
                    {kpi('ذمم مفتوحة', fmt(openByEquipment.get(selected.equipment.id) ?? 0), 'text-rose-600')}
                    {kpi('قراءة العدّاد', `${selected.equipment.meterReading}`)}
                  </div>

                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => (
                      <div key={k} className="rounded-xl bg-slate-500/5 p-2"><div className="text-[10px] text-slate-500">{EQUIPMENT_COST_LABELS[k]}</div><div className="font-bold text-[12px]">{fmt(selected.costs.filter((c) => c.kind === k).reduce((a, c) => a + c.amountMinor, 0))}</div></div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {selected.contracts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">العقود ({selected.contracts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selected.contracts].reverse().map((c) => (
                              <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{c.contractNumber}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{c.date.slice(0, 10)}</td>
                                <td className="px-3 py-2">{c.days} × {fmt(c.dailyRateMinor)}</td>
                                {c.extraMinor > 0 && <td className="px-3 py-2 text-violet-600">+{fmt(c.extraMinor)}</td>}
                                <td className={`px-3 py-2 font-bold text-left ${c.status === 'active' ? 'text-teal-600' : 'text-slate-400'}`}>{fmt(c.totals.grandMinor + c.extraMinor)}</td>
                                <td className="px-3 py-2 text-[10.5px]">{c.status === 'active' ? 'نشط' : 'مُقفل'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedOpenDocs.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">ذمم الإيجار المفتوحة — تُسدَّد من سند قبض/تحصيل العميل</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {selectedOpenDocs.map((inv) => (
                              <tr key={inv.docKey} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{inv.docLabel}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{inv.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 text-slate-500">محصّل {fmt(inv.settledMinor)}</td>
                                <td className="px-3 py-2 font-black text-rose-600 text-left">{fmt(inv.dueMinor - inv.settledMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selected.costs.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">مصاريف التشغيل ({selected.costs.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selected.costs].reverse().slice(0, 8).map((c) => (
                              <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2">{EQUIPMENT_COST_LABELS[c.kind]} — {c.description}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{c.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 font-bold text-rose-600 text-left">{fmt(c.amountMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedShifts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1"><Clock size={13} /> وردانيات المشغلين ({selectedShifts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selectedShifts].reverse().slice(0, 8).map((s) => (
                              <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{s.operatorName}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{s.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 text-slate-500">{s.startReading} ← {s.endReading}</td>
                                <td className="px-3 py-2 font-bold text-sky-600 text-left">{usageHours(s.startReading, s.endReading)} س</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ ③ القوائم الربحية رباعية المستويات (عقد · معدة · قطاع الإيجارات · الشركة ككل) ═══ */}
          {tab === 'pnl' && (
            <div className="anim-up space-y-4" data-equipment-4level-pnl>
              {/* المستوى ٣ و٤: قطاع الإيجارات كاملاً مقارنة بالشركة ككل */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className={`${card} p-4 space-y-2.5`}>
                  <div className="text-[13px] font-black text-teal-700 dark:text-teal-300 flex items-center justify-between">
                    <span>🏢 المستوى ٣: قائمة دخل قطاع الإيجارات كاملاً (Rental Division P&L)</span>
                    <span className={totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(totals.profit)} {cur.symbol}</span>
                  </div>
                  <div className="space-y-1 text-[12px]">
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>إجمالي إيراد عقود وفواتير التأجير (4104)</span><b className="text-emerald-600 font-mono">{fmt(totals.revenue)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>(−) مصاريف تشغيل وصيانة مباشرة للمالك</span><b className="text-rose-500 font-mono">{fmt(totals.directCosts)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>(−) أجور ومصاريف السائقين والمشغلين</span><b className="text-amber-600 font-mono">{fmt(totals.driverCosts)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>(−) مصاريف غير مباشرة / عامة على الأسطول</span><b className="text-rose-400 font-mono">{fmt(totals.indirectCosts)}</b></div>
                    <div className="flex justify-between py-1.5 font-black text-[13px] bg-teal-500/5 px-2 rounded-lg"><span>(=) صافي ربح قطاع تأجير المعدات</span><b className={totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(totals.profit)} {cur.symbol}</b></div>
                    <div className="flex justify-between pt-1 text-[11px] text-sky-600"><span>مصاريف سُدِّدت وحُمِّلت على المستأجرين (1104)</span><b className="font-mono">{fmt(totals.customerBorneCosts)}</b></div>
                  </div>
                </div>

                <div className={`${card} p-4 space-y-2.5`}>
                  <div className="text-[13px] font-black text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
                    <span>🏛️ المستوى ٤: قائمة الدخل الكلية للشركة (Company-Wide P&L)</span>
                    <span className={companyVsRentalPnl.companyNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(companyVsRentalPnl.companyNet)} {cur.symbol}</span>
                  </div>
                  <div className="space-y-1 text-[12px]">
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>صافي ربح قطاع الإيجارات (4104 − 5105)</span><b className="text-teal-600 font-mono">{fmt(companyVsRentalPnl.rentalNet)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>صافي ربح قطاع المقاولات والمشروعات (4107 − 5106)</span><b className="text-orange-600 font-mono">{fmt(companyVsRentalPnl.contractingNet)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>إيرادات الأنشطة والمبيعات الأخرى</span><b className="text-emerald-600 font-mono">{fmt(companyVsRentalPnl.otherRev)}</b></div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800"><span>(−) المصروفات العمومية والإدارية والتشغيلية الأخرى</span><b className="text-rose-500 font-mono">{fmt(companyVsRentalPnl.otherExp)}</b></div>
                    <div className="flex justify-between py-1.5 font-black text-[13px] bg-indigo-500/5 px-2 rounded-lg"><span>(=) صافي ربح الشركة الكلي (كافة القطاعات)</span><b className={companyVsRentalPnl.companyNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(companyVsRentalPnl.companyNet)} {cur.symbol}</b></div>
                  </div>
                </div>
              </div>

              {/* المستوى ٢: قائمة دخل كل معدة منفردة */}
              <div className={`${card} overflow-x-auto`}>
                <div className="px-4 py-3 text-[12.5px] font-black text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">
                  🚜 المستوى ٢: قائمة دخل كل معدة منفردة (Equipment Unit P&L)
                </div>
                <table className="w-full text-[12px]">
                  <thead className="bg-teal-500/10 text-teal-700 dark:text-teal-300">
                    <tr>{['المعدة', 'السائق الأساسي', 'إيراد الإيجار', '(−) مباشر', '(−) سائق', '(−) غير مباشر', '(=) صافي ربح المعدة', 'مصاريف على المستأجر'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cards.map((r) => (
                      <tr key={r.equipment.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 font-black">{r.equipment.nameAr}</td>
                        <td className="px-3 py-2 text-slate-500">{employees.find((e) => e.id === r.equipment.driverEmployeeId)?.nameAr ?? '—'}</td>
                        <td className="px-3 py-2 font-bold text-emerald-600 font-mono">{fmt(r.report.revenueMinor)}</td>
                        <td className="px-3 py-2 text-rose-500 font-mono">{fmt(r.directMinor)}</td>
                        <td className="px-3 py-2 text-amber-600 font-mono">{fmt(r.driverMinor)}</td>
                        <td className="px-3 py-2 text-rose-400 font-mono">{fmt(r.indirectMinor)}</td>
                        <td className={`px-3 py-2 font-black font-mono ${r.report.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.report.profitMinor)}</td>
                        <td className="px-3 py-2 text-sky-600 font-mono">{fmt(r.customerBorneMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* المستوى ١: قائمة دخل كل عقد إيجار منفرداً */}
              <div className={`${card} overflow-x-auto`}>
                <div className="px-4 py-3 text-[12.5px] font-black text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">
                  📋 المستوى ١: قائمة دخل كل عقد إيجار منفرداً (Contract P&L)
                </div>
                {contractPnlRows.length === 0 ? (
                  <div className="p-6 text-center text-[12px] text-slate-400">لا عقود إيجار بعد</div>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                      <tr>{['العقد', 'المعدة', 'العميل', 'السائق', 'الفواتير', 'الإيراد المحقق', '(−) مباشر', '(−) سائق', '(−) غير مباشر', '(=) صافي ربح العقد', 'مصاريف على المستأجر'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {contractPnlRows.map((row) => (
                        <tr key={row.contract.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-bold text-teal-600">{row.contract.contractNumber}</td>
                          <td className="px-3 py-2 font-bold">{row.contract.equipmentName}</td>
                          <td className="px-3 py-2">{row.customerName}</td>
                          <td className="px-3 py-2 text-slate-500">{row.driverName}</td>
                          <td className="px-3 py-2">{row.contract.billingMode === 'reference' ? `${row.invoicesCount} دورية` : 'مسبق'}</td>
                          <td className="px-3 py-2 font-bold text-emerald-600 font-mono">{fmt(row.revMinor)}</td>
                          <td className="px-3 py-2 text-rose-500 font-mono">{fmt(row.directMinor)}</td>
                          <td className="px-3 py-2 text-amber-600 font-mono">{fmt(row.driverMinor)}</td>
                          <td className="px-3 py-2 text-rose-400 font-mono">{fmt(row.indirectMinor)}</td>
                          <td className={`px-3 py-2 font-black font-mono ${row.netProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.netProfitMinor)}</td>
                          <td className="px-3 py-2 text-sky-600 font-mono">{fmt(row.customerBorneMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ═══ ④ ذمم عملاء التأجير ═══ */}
          {tab === 'dues' && (
            <div className="anim-up space-y-3">
              <div className="text-[12px] text-slate-500">
                متابعة تحصيل الإيجار: لكل عميل — عقوده وإيراده وما زال مفتوحاً من مستحقاته (تُطفأ من سند القبض أو تحصيل العميل FIFO).
              </div>
              <div className="flex justify-end gap-1.5">
                <button onClick={printDues} data-print="dues"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => downloadCsv(renterDues.map((row) => ({
                  'العميل': row.nameAr, 'العقود': row.contractsCount, 'الإيراد': fmt(row.revenueMinor), 'ذمم مفتوحة': fmt(row.openMinor),
                })), `ذمم-عملاء-التأجير-${todayLocalIso()}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير الذمم CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                    <tr>{['العميل', 'العقود', 'إيراد الإيجار', 'ذمم مفتوحة'].map((h, i) => <th key={i} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {renterDues.map((row) => (
                      <tr key={row.customerId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-rose-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-bold flex items-center gap-1.5"><Users size={13} className="text-slate-400" /> {row.nameAr}</td>
                        <td className="px-3 py-2.5">{row.contractsCount}</td>
                        <td className="px-3 py-2.5 font-bold text-teal-600">{fmt(row.revenueMinor)}</td>
                        <td className={`px-3 py-2.5 font-black ${row.openMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
