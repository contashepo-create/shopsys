import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
/**
 * مركز تقارير المقاولات (طلب المالك): وحدة تقارير مستقلة تخدم النشاط —
 * لوحة كل المشاريع · بطاقة مشروع بعينه (العميل والمستخلصات والرصيد وكل شيء)
 * · ذمم عملاء المقاولات ومتابعة التحصيل — بتصدير CSV احترافي لكل جدول.
 * البطاقة نفسها من النواة الخالصة projectReportCard (قابلة للفحص ببوابة).
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, BarChart3, Users, Receipt, Calculator, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, type CostKind, projectReportCard } from '../../core/contracting.ts'
import { toCsv } from '../../core/security.ts'
import { renderReportShell, htmlTableHtml, escHtml } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { EmptyState } from '../components/ui.tsx'

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

export function ContractingReportsPage() {
  const {
    projects, projectExtracts, projectCosts, retentionReleases, changeOrders, customers, clientAdvances,
    getOpenClientInvoices, getProjectCostBreakdown,
  } = useDataStore()
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
  const [tab, setTab] = usePersistedSectionView('contracting-reports', 'projects', ['projects', 'project', 'dues'] as const)
  const [projectId, setProjectId] = useState('')

  /** بطاقة التقرير الخالصة لكل مشروع — من النواة مباشرة */
  const cards = useMemo(() => projects.map((p) => {
    const extracts = projectExtracts.filter((e) => e.projectId === p.id)
    const released = retentionReleases.filter((r) => r.projectId === p.id).reduce((a, r) => a + r.amountMinor, 0)
    const orders = changeOrders.filter((o) => o.projectId === p.id)
    const advances = clientAdvances.filter((a) => a.projectId === p.id)
    const flat = extracts.map((e) => ({ grossMinor: e.totals.grossMinor, vatMinor: e.totals.vatMinor, retentionMinor: e.totals.retentionMinor, date: e.date }))
    /* §95 (محاذاة pro-acc — طلب المالك): التكاليف = بنود projectCosts نفسها (بكل
       مصادرها الموسومة: يدوي/شهادة باطن/أجور يومية/فاتورة شراء/إذن صرف) − مرتجعات
       الشراء التي عكست 5110 — فتطابق البطاقة صافي 5110 بالدفتر بلا جمع مزدوج. */
    const bd = getProjectCostBreakdown(p.id)
    const fullCosts = [
      ...projectCosts.filter((c) => c.projectId === p.id).map((c) => ({ kind: c.kind, amountMinor: c.amountMinor })),
      ...bd.purchaseReturns.map((r) => ({ kind: 'materials' as CostKind, amountMinor: -r.totalMinor })),
    ]
    return { project: p, card: projectReportCard(p, flat, fullCosts, released, orders, advances), breakdown: bd }
  }), [projects, projectExtracts, projectCosts, retentionReleases, changeOrders, clientAdvances, getProjectCostBreakdown])

  /** المفتوح من المستخلصات لكل مشروع: من دفتر التوزيع (docKey = extract:<id>) */
  const openByProject = useMemo(() => {
    const settled = new Map<string, number>()
    for (const p of projects) {
      if (p.clientId == null) continue
      for (const inv of getOpenClientInvoices(p.clientId)) settled.set(inv.docKey, inv.settledMinor)
    }
    return new Map(projects.map((p) => {
      const open = projectExtracts
        .filter((e) => e.projectId === p.id && e.payment === 'credit')
        .reduce((sum, e) => sum + Math.max(0, e.totals.dueMinor - (settled.get(`extract:${e.id}`) ?? 0)), 0)
      return [p.id, open]
    }))
  }, [projects, projectExtracts, getOpenClientInvoices])

  const totals = useMemo(() => ({
    contract: cards.reduce((a, r) => a + r.card.contractEffectiveMinor, 0),
    extracted: cards.reduce((a, r) => a + r.card.extractedMinor, 0),
    costs: cards.reduce((a, r) => a + r.card.costsMinor, 0),
    profit: cards.reduce((a, r) => a + r.card.profitMinor, 0),
    retention: cards.reduce((a, r) => a + r.card.retentionHeldMinor, 0),
    advances: cards.reduce((a, r) => a + r.card.advancesRemainingMinor, 0),
    open: cards.reduce((a, r) => a + (openByProject.get(r.project.id) ?? 0), 0),
  }), [cards, openByProject])

  /* ═══ تبويب: مشروع بعينه ═══ */
  const selected = cards.find((r) => r.project.id === Number(projectId)) ?? null
  const selectedExtracts = selected ? projectExtracts.filter((e) => e.projectId === selected.project.id) : []
  const selectedCosts = selected ? projectCosts.filter((c) => c.projectId === selected.project.id) : []
  const selectedOrders = selected ? changeOrders.filter((o) => o.projectId === selected.project.id) : []
  const selectedOpenDocs = selected?.project.clientId != null
    ? getOpenClientInvoices(selected.project.clientId).filter((inv) => selectedExtracts.some((e) => `extract:${e.id}` === inv.docKey))
    : []

  /* ═══ تبويب: ذمم عملاء المقاولات ═══ */
  const clientDues = useMemo(() => {
    const byClient = new Map<number, { nameAr: string; extractedMinor: number; retentionMinor: number; openMinor: number; openDocs: number }>()
    for (const p of projects) {
      if (p.clientId == null) continue
      const row = byClient.get(p.clientId) ?? { nameAr: customers.find((c) => c.id === p.clientId)?.nameAr ?? '—', extractedMinor: 0, retentionMinor: 0, openMinor: 0, openDocs: 0 }
      for (const e of projectExtracts.filter((x) => x.projectId === p.id)) {
        row.extractedMinor += e.totals.grossMinor
        row.retentionMinor += e.totals.retentionMinor
      }
      row.openMinor += openByProject.get(p.id) ?? 0
      row.openDocs += projectExtracts.filter((x) => x.projectId === p.id && x.payment === 'credit').length
      byClient.set(p.clientId, row)
    }
    return [...byClient.entries()].map(([customerId, row]) => ({ customerId, ...row })).sort((a, b) => b.openMinor - a.openMinor)
  }, [projects, projectExtracts, customers, openByProject])

  /* ═══ §99: مطبوعات لوحة المشاريع / بطاقة المشروع / الذمم — كل جدول قابل للطباعة PDF ═══ */
  const printProjects = () => printDoc('لوحة مشاريع المقاولات', 'كل المشاريع — الأرقام من القيود المرحّلة', htmlTableHtml({
    headers: ['المشروع', 'العميل', 'العقد الفعلي', 'إنجاز ٪', 'المستخلصات', 'التكاليف', 'الربح (هامش ٪)', 'محتجز قائم', 'مقدمة متبقية', 'ذمم مفتوحة', 'الحالة'],
    numCols: [2, 3, 4, 5, 6, 7, 8, 9],
    rows: cards.map(({ project: p, card: c }) => [
      `${p.code} — ${p.nameAr}`, p.clientName || '—', fmt(c.contractEffectiveMinor), `${c.progressPercent}٪`,
      fmt(c.extractedMinor), fmt(c.costsMinor), `${fmt(c.profitMinor)} (${c.marginPercent}٪)`,
      fmt(c.retentionHeldMinor), fmt(c.advancesRemainingMinor), fmt(openByProject.get(p.id) ?? 0),
      p.status === 'active' ? 'جارٍ' : 'مُسلَّم',
    ]),
    totalRow: ['الإجمالي', '', fmt(totals.contract), '', fmt(totals.extracted), fmt(totals.costs), fmt(totals.profit), fmt(totals.retention), fmt(totals.advances), fmt(totals.open), ''],
  }))

  const printProjectCard = () => {
    if (!selected) return
    const c = selected.card
    const bd = selected.breakdown
    const kpiRows: (readonly (string | number)[])[] = [
      ['قيمة العقد الأصلية', fmt(c.contractOriginalMinor)],
      ['أوامر التغيير المعتمدة (عدد)', c.changeOrdersApprovedCount],
      ['قيمة العقد الفعلية', fmt(c.contractEffectiveMinor)],
      ['أوامر تغيير معلقة (مسودات)', fmt(c.changeOrdersPendingMinor)],
      ['المستخلصات (عدد)', c.extractsCount],
      ['قيمة الأعمال المستخلصة', fmt(c.extractedMinor)],
      ['ض.ق.م محمّلة على العميل', fmt(c.vatChargedMinor)],
      ['نسبة الإنجاز ٪', `${c.progressPercent}٪`],
      ['التكاليف', fmt(c.costsMinor)],
      ...(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => [`تكاليف — ${COST_KIND_LABELS[k].nameAr}`, fmt(c.costsByKind[k])] as const),
      ['الربح', fmt(c.profitMinor)],
      ['الهامش ٪', `${c.marginPercent}٪`],
      ['محتجز قائم', fmt(c.retentionHeldMinor)],
      ['دفعات مقدمة مستلمة', fmt(c.advancesReceivedMinor)],
      ['دفعات مقدمة مستردة', fmt(c.advancesRecoveredMinor)],
      ['دفعات مقدمة متبقية', fmt(c.advancesRemainingMinor)],
      ['ذمم مفتوحة (مستخلصات)', fmt(openByProject.get(selected.project.id) ?? 0)],
    ]
    const body = [
      htmlTableHtml({ headers: ['مؤشرات البطاقة', 'القيمة'], numCols: [1], rows: kpiRows }),
      sectionHtml('مصادر التكاليف — تُطابق صافي 5110 بالدفتر'),
      htmlTableHtml({
        headers: ['المصدر', 'المبلغ'], numCols: [1],
        rows: [
          ['تكاليف يدوية مسجّلة', fmt(bd.totals.manualMinor)],
          ['شهادات مقاولي الباطن', fmt(bd.totals.subMinor)],
          ['أجور يومية مسوّاة', fmt(bd.totals.dailyMinor)],
          ['فواتير شراء مربوطة', fmt(bd.totals.purchasesMinor)],
          ['أذون صرف مواد من المخزن', fmt(bd.totals.materialIssuesMinor)],
          ['مرتجعات شراء (خافضة)', fmt(-bd.totals.returnsMinor)],
        ],
        totalRow: ['إجمالي تكاليف المشروع', fmt(bd.totals.allMinor)],
      }),
      ...(selectedExtracts.length ? [
        sectionHtml(`المستخلصات (${selectedExtracts.length})`),
        htmlTableHtml({
          headers: ['المستخلص', 'التاريخ', 'قيمة الأعمال', 'محتجز', 'المستحق'], numCols: [2, 3, 4],
          rows: selectedExtracts.map((e) => [`${e.extractNumber}${e.isFinal ? ' (ختامي)' : ''}`, e.date.slice(0, 10), fmt(e.totals.grossMinor), fmt(e.totals.retentionMinor), fmt(e.totals.dueMinor)]),
        }),
      ] : []),
      ...(selectedOpenDocs.length ? [
        sectionHtml('ذمم المستخلصات المفتوحة — تُسدَّد من تحصيلات العملاء'),
        htmlTableHtml({
          headers: ['المستند', 'التاريخ', 'محصّل', 'المتبقي'], numCols: [2, 3],
          rows: selectedOpenDocs.filter((inv) => inv.dueMinor - inv.settledMinor > 0).map((inv) => [inv.docLabel, inv.date.slice(0, 10), fmt(inv.settledMinor), fmt(inv.dueMinor - inv.settledMinor)]),
        }),
      ] : []),
      ...(selectedOrders.length ? [
        sectionHtml(`أوامر التغيير (${selectedOrders.length})`),
        htmlTableHtml({
          headers: ['الأمر', 'البيان', 'المبلغ', 'الحالة'], numCols: [2],
          rows: selectedOrders.map((o) => [o.number, o.titleAr, `${o.amountMinor >= 0 ? '+' : '−'}${fmt(Math.abs(o.amountMinor))}`, o.status === 'approved' ? 'معتمد' : o.status === 'invoiced' ? 'مُستخلَص' : o.status === 'draft' ? 'مسودة' : 'مرفوض']),
        }),
      ] : []),
      ...(selectedCosts.length ? [
        sectionHtml(`تكاليف المشروع (${selectedCosts.length})`),
        htmlTableHtml({
          headers: ['البيان', 'النوع', 'المبلغ'], numCols: [2],
          rows: selectedCosts.map((x) => [x.description, COST_KIND_LABELS[x.kind].nameAr, fmt(x.amountMinor)]),
        }),
      ] : []),
    ].join('')
    printDoc(`بطاقة مشروع — ${selected.project.code}`, `${selected.project.nameAr}${selected.project.clientName ? ` · العميل: ${selected.project.clientName}` : ''}`, body)
  }

  const printDues = () => printDoc('ذمم عملاء المقاولات', 'متابعة التحصيل — المفتوح من المستخلصات الآجلة', htmlTableHtml({
    headers: ['العميل', 'الأعمال المستخلصة', 'المحتجز لديه', 'ذمم مفتوحة', 'مستخلصات آجلة'],
    numCols: [1, 2, 3, 4],
    rows: clientDues.map((row) => [row.nameAr, fmt(row.extractedMinor), fmt(row.retentionMinor), row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة', row.openDocs]),
    totalRow: ['الإجمالي', fmt(clientDues.reduce((a, r) => a + r.extractedMinor, 0)), fmt(clientDues.reduce((a, r) => a + r.retentionMinor, 0)), fmt(clientDues.reduce((a, r) => a + r.openMinor, 0)), clientDues.reduce((a, r) => a + r.openDocs, 0)],
  }))

  const kpi = (label: string, value: string, tone = 'text-slate-800 dark:text-slate-100') => (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-center"><div className="text-[10px] text-slate-400 font-bold">{label}</div><div className={`font-black text-[15px] ${tone}`}>{value}</div></div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><BarChart3 className="w-6 h-6 text-orange-500" /> مركز تقارير المقاولات</h1>
        <div className="flex gap-1.5">
          {([['projects', 'لوحة المشاريع'], ['project', 'مشروع بعينه'], ['dues', 'ذمم العملاء']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${tab === id ? 'bg-orange-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{label}</button>
          ))}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon="🏗️" title="لا مشروعات بعد" sub="أنشئ مشروعاً من «المشروعات والمستخلصات» ثم عد هنا — كل التقارير تُبنى تلقائياً من القيود" />
      ) : (
        <>
          {/* ═══ KPIs إجمالية دائمة ═══ */}
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {kpi('العقود الفعلية', fmt(totals.contract))}
            {kpi('المستخلصات', fmt(totals.extracted), 'text-orange-600')}
            {kpi('التكاليف', fmt(totals.costs), 'text-rose-600')}
            {kpi('الأرباح', fmt(totals.profit), totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}
            {kpi('محتجز قائم', fmt(totals.retention), 'text-amber-600')}
            {kpi('دفعات مقدمة متبقية', fmt(totals.advances), 'text-sky-600')}
            {kpi('ذمم مفتوحة', fmt(totals.open), 'text-rose-600')}
          </div>

          {/* ═══ ① لوحة المشاريع ═══ */}
          {tab === 'projects' && (
            <div className="anim-up space-y-3">
              <div className="flex justify-end gap-1.5">
                <button onClick={printProjects} data-print="projects"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => downloadCsv(cards.map((r) => ({
                  'الكود': r.project.code, 'المشروع': r.project.nameAr, 'العميل': r.project.clientName || '—',
                  'قيمة العقد الفعلية': fmt(r.card.contractEffectiveMinor), 'أوامر معلقة': fmt(r.card.changeOrdersPendingMinor),
                  'المستخلصات': fmt(r.card.extractedMinor), 'الإنجاز ٪': r.card.progressPercent,
                  'التكاليف': fmt(r.card.costsMinor), 'الربح': fmt(r.card.profitMinor), 'الهامش ٪': r.card.marginPercent,
                  'محتجز قائم': fmt(r.card.retentionHeldMinor), 'دفعات مقدمة متبقية': fmt(r.card.advancesRemainingMinor),
                  'ذمم مفتوحة': fmt(openByProject.get(r.project.id) ?? 0), 'الحالة': r.project.status === 'active' ? 'جارٍ' : 'مُسلَّم',
                })), `تقرير-مشاريع-المقاولات-${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير اللوحة CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
                    <tr>{['المشروع', 'العميل', 'العقد الفعلي', 'إنجاز', 'مستخلصات', 'تكاليف', 'ربح (هامش)', 'محتجز', 'ذمم مفتوحة', 'الحالة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cards.map(({ project: p, card: c }) => (
                      <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-orange-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-black whitespace-nowrap">{p.code}<span className="block text-[10.5px] font-bold text-slate-400">{p.nameAr}</span></td>
                        <td className="px-3 py-2.5">{p.clientName || '—'}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{fmt(c.contractEffectiveMinor)}{c.changeOrdersPendingMinor !== 0 && <span className="block text-[10px] text-violet-500 font-bold">+ معلق {fmt(c.changeOrdersPendingMinor)}</span>}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className="h-full bg-orange-500" style={{ width: `${Math.min(100, c.progressPercent)}%` }} /></div>
                            <span className="text-[11px] font-bold">{c.progressPercent}٪</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-orange-600 font-bold whitespace-nowrap">{fmt(c.extractedMinor)}</td>
                        <td className="px-3 py-2.5 text-rose-600 font-bold whitespace-nowrap">{fmt(c.costsMinor)}</td>
                        <td className={`px-3 py-2.5 font-black whitespace-nowrap ${c.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(c.profitMinor)}<span className="block text-[10px] font-bold opacity-70">{c.marginPercent}٪</span></td>
                        <td className="px-3 py-2.5 text-amber-600 font-bold whitespace-nowrap">{fmt(c.retentionHeldMinor)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{openByProject.get(p.id) ? <span className="text-rose-600">{fmt(openByProject.get(p.id)!)}</span> : <span className="text-emerald-600">✓</span>}</td>
                        <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-lg text-[10.5px] font-bold ${p.status === 'active' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{p.status === 'active' ? 'جارٍ' : 'مُسلَّم'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ② مشروع بعينه ═══ */}
          {tab === 'project' && (
            <div className="anim-up space-y-3">
              <div className={`${card} p-4`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-64 flex-1"><PartyQuickPicker parties={projects.map((p) => ({ id: p.id, nameAr: `${p.code} — ${p.nameAr}` }))} value={projectId ? Number(projectId) : 0} onChange={(id) => setProjectId(id ? String(id) : '')} cashLabel="اختر مشروعاً" label="بحث المشروع" cashValue={0} /></div>
                  {selected && (
                    <div className="flex gap-1.5">
                    <button onClick={printProjectCard} data-print="project-card"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                    <button onClick={() => downloadCsv([
                      { 'البند': 'قيمة العقد الأصلية', 'القيمة': fmt(selected.card.contractOriginalMinor) },
                      { 'البند': 'أوامر التغيير المعتمدة (عدد)', 'القيمة': selected.card.changeOrdersApprovedCount },
                      { 'البند': 'قيمة العقد الفعلية', 'القيمة': fmt(selected.card.contractEffectiveMinor) },
                      { 'البند': 'أوامر تغيير معلقة (مسودات)', 'القيمة': fmt(selected.card.changeOrdersPendingMinor) },
                      { 'البند': 'المستخلصات (عدد)', 'القيمة': selected.card.extractsCount },
                      { 'البند': 'قيمة الأعمال المستخلصة', 'القيمة': fmt(selected.card.extractedMinor) },
                      { 'البند': 'ض.ق.م محمّلة على العميل', 'القيمة': fmt(selected.card.vatChargedMinor) },
                      { 'البند': 'نسبة الإنجاز ٪', 'القيمة': selected.card.progressPercent },
                      { 'البند': 'التكاليف', 'القيمة': fmt(selected.card.costsMinor) },
                      ...(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => ({ 'البند': `تكاليف — ${COST_KIND_LABELS[k].nameAr}`, 'القيمة': fmt(selected.card.costsByKind[k]) })),
                      { 'البند': 'الربح', 'القيمة': fmt(selected.card.profitMinor) },
                      { 'البند': 'الهامش ٪', 'القيمة': selected.card.marginPercent },
                      { 'البند': 'محتجز قائم', 'القيمة': fmt(selected.card.retentionHeldMinor) },
                      { 'البند': 'دفعات مقدمة مستلمة', 'القيمة': fmt(selected.card.advancesReceivedMinor) },
                      { 'البند': 'دفعات مقدمة مستردة', 'القيمة': fmt(selected.card.advancesRecoveredMinor) },
                      { 'البند': 'دفعات مقدمة متبقية', 'القيمة': fmt(selected.card.advancesRemainingMinor) },
                      { 'البند': 'ذمم مفتوحة (مستخلصات)', 'القيمة': fmt(openByProject.get(selected.project.id) ?? 0) },
                    ], `تقرير-${selected.project.code}.csv`)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير بطاقة المشروع</button>
                    </div>
                  )}
                </div>
              </div>

              {!selected ? (
                <EmptyState icon="📊" title="اختر مشروعاً" sub="بطاقة كاملة: العقد وأوامر التغيير والمستخلصات والضريبة والتكاليف والربح والمحتجز والدفعات المقدمة والذمم" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {kpi('العقد الفعلي', fmt(selected.card.contractEffectiveMinor))}
                    {kpi('أوامر معلقة', fmt(selected.card.changeOrdersPendingMinor), 'text-violet-600')}
                    {kpi('المستخلصات', `${fmt(selected.card.extractedMinor)}`, 'text-orange-600')}
                    {kpi('ض.ق.م محمّلة', fmt(selected.card.vatChargedMinor))}
                    {kpi('إنجاز', `${selected.card.progressPercent}٪`)}
                    {kpi('التكاليف', fmt(selected.card.costsMinor), 'text-rose-600')}
                    {kpi('الربح', fmt(selected.card.profitMinor), selected.card.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600')}
                    {kpi('الهامش', `${selected.card.marginPercent}٪`)}
                    {kpi('محتجز قائم', fmt(selected.card.retentionHeldMinor), 'text-amber-600')}
                    {kpi('مقدمة مستلمة', fmt(selected.card.advancesReceivedMinor), 'text-sky-600')}
                    {kpi('مقدمة متبقية', fmt(selected.card.advancesRemainingMinor), 'text-sky-600')}
                    {kpi('ذمم مفتوحة', fmt(openByProject.get(selected.project.id) ?? 0), 'text-rose-600')}
                  </div>

                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                      <div key={k} className="rounded-xl bg-slate-500/5 p-2"><div className="text-[10px] text-slate-500">{COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</div><div className="font-bold text-[12px]">{fmt(selected.card.costsByKind[k])}</div></div>
                    ))}
                  </div>

                  {/* §95: مصادر التكاليف — مطابقة صافي 5110 بالدفتر */}
                  {(() => {
                    const bd = selected.breakdown
                    const rows: [string, number][] = [
                      ['تكاليف يدوية مسجّلة', bd.totals.manualMinor],
                      ['شهادات مقاولي الباطن', bd.totals.subMinor],
                      ['أجور يومية مسوّاة', bd.totals.dailyMinor],
                      ['فواتير شراء مربوطة', bd.totals.purchasesMinor],
                      ['أذون صرف مواد من المخزن', bd.totals.materialIssuesMinor],
                      ['مرتجعات شراء (خافضة)', -bd.totals.returnsMinor],
                    ]
                    return (
                      <div className={`${card} overflow-hidden`} data-cost-sources>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                          <span className="flex items-center gap-1"><Calculator size={13} /> مصادر التكاليف (تُطابق صافي 5110 بالدفتر)</span>
                          <b className="text-rose-600">{fmt(bd.totals.allMinor)} {cur.symbol}</b>
                        </div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {rows.map(([label, value]) => (
                              <tr key={label} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-4 py-2">{label}</td>
                                <td className={`px-4 py-2 text-left font-bold ${value < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(value)}</td>
                              </tr>
                            ))}
                            <tr className="bg-slate-500/5 font-black"><td className="px-4 py-2">إجمالي تكاليف المشروع</td><td className="px-4 py-2 text-left text-rose-600">{fmt(bd.totals.allMinor)}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {selectedExtracts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1"><Receipt size={13} /> المستخلصات ({selectedExtracts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selectedExtracts].reverse().map((e) => (
                              <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{e.extractNumber}{e.isFinal && <span className="text-[9.5px] bg-rose-500/10 text-rose-600 px-1.5 py-0.5 rounded mr-1">ختامي</span>}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{e.date.slice(0, 10)}</td>
                                <td className="px-3 py-2">أعمال {fmt(e.totals.grossMinor)}</td>
                                <td className="px-3 py-2 text-amber-600">محتجز {fmt(e.totals.retentionMinor)}</td>
                                <td className="px-3 py-2 font-bold text-left">{fmt(e.totals.dueMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedOpenDocs.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">ذمم المستخلصات المفتوحة — تُسدَّد من تحصيلات العملاء</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {selectedOpenDocs.map((inv) => {
                              const remaining = inv.dueMinor - inv.settledMinor
                              if (remaining <= 0) return null
                              return (
                                <tr key={inv.docKey} className="border-b border-slate-50 dark:border-slate-800/50">
                                  <td className="px-3 py-2 font-bold">{inv.docLabel}</td>
                                  <td className="px-3 py-2 text-slate-400 text-[11px]">{inv.date.slice(0, 10)}</td>
                                  <td className="px-3 py-2 text-slate-500">محصّل {fmt(inv.settledMinor)}</td>
                                  <td className="px-3 py-2 font-black text-rose-600 text-left">{fmt(remaining)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedOrders.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">أوامر التغيير ({selectedOrders.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selectedOrders].reverse().map((o) => (
                              <tr key={o.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{o.number}</td>
                                <td className="px-3 py-2">{o.titleAr}</td>
                                <td className={`px-3 py-2 font-bold text-left ${o.amountMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{o.amountMinor >= 0 ? '+' : '−'}{fmt(Math.abs(o.amountMinor))}</td>
                                <td className="px-3 py-2 text-[10.5px]">{o.status === 'approved' ? '✅ معتمد' : o.status === 'invoiced' ? '🧾 مُستخلَص' : o.status === 'draft' ? '📝 مسودة' : '❌ مرفوض'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedCosts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">آخر التكاليف ({selectedCosts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selectedCosts].reverse().slice(0, 8).map((c) => (
                              <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2">{COST_KIND_LABELS[c.kind].icon} {c.description}</td>
                                <td className="px-3 py-2 font-bold text-rose-600 text-left">{fmt(c.amountMinor)}</td>
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

          {/* ═══ ③ ذمم عملاء المقاولات ═══ */}
          {tab === 'dues' && (
            <div className="anim-up space-y-3">
              <div className="text-[12px] text-slate-500">
                متابعة تحصيل المقاولات: لكل عميل — قيمة الأعمال المستخلصة والمحتجز لديه وما زال مفتوحاً من مستخلصاته (تُطفأ من «تحصيلات العملاء» FIFO أو بمطابقة محددة).
              </div>
              <div className="flex justify-end gap-1.5">
                <button onClick={printDues} data-print="dues"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => downloadCsv(clientDues.map((row) => ({
                  'العميل': row.nameAr, 'الأعمال المستخلصة': fmt(row.extractedMinor), 'المحتجز لدى العميل': fmt(row.retentionMinor),
                  'ذمم مفتوحة': fmt(row.openMinor), 'مستخلصات آجلة': row.openDocs,
                })), `ذمم-عملاء-المقاولات-${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير الذمم CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                    <tr>{['العميل', 'الأعمال المستخلصة', 'المحتجز لديه', 'ذمم مفتوحة', 'مستخلصات آجلة', ''].map((h, i) => <th key={i} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {clientDues.map((row) => (
                      <tr key={row.customerId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-rose-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-bold flex items-center gap-1.5"><Users size={13} className="text-slate-400" /> {row.nameAr}</td>
                        <td className="px-3 py-2.5 text-orange-600 font-bold">{fmt(row.extractedMinor)}</td>
                        <td className="px-3 py-2.5 text-amber-600 font-bold">{fmt(row.retentionMinor)}</td>
                        <td className={`px-3 py-2.5 font-black ${row.openMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة'}</td>
                        <td className="px-3 py-2.5">{row.openDocs}</td>
                        <td className="px-3 py-2.5 text-left">
                          <button onClick={() => window.location.hash = `#/contracting/collections`} title="التحصيل من قسم تحصيلات العملاء" className="text-[11px] font-bold text-emerald-600 hover:underline">تحصيل ←</button>
                        </td>
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
