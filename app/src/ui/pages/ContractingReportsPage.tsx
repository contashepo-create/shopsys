import { projectSystemStatusLabel } from '../../core/projectClosureReview.ts'
import { FinancialDataReviewError } from '../../core/financialDataReview.ts'
import { projectExtractSettlement, projectOpenBalances } from '../../core/projectReportBalances.ts'
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
import { addMinor, formatMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, type CostKind, projectReportCard, clientContractingCard, type ClientProjectRow } from '../../core/contracting.ts'
import { netProjectExtractTotals } from '../../core/projectExtractRefundIntegrity.ts'
import { creditedProjectRetention } from '../../core/projectExtractNet.ts'
import { toCsv } from '../../core/security.ts'
import { buildProjectExpenseLedger } from '../../core/projectExpenseLedger.ts'
import { ProjectExpenseLedgerCard } from '../contracting/ProjectExpenseLedgerCard.tsx'
import { AnalyticalProjectReportView } from '../contracting/AnalyticalProjectReportView.tsx'
import { projectReportBasis } from '../contracting/projectReportBasis.ts'
import type { ExportSheet } from '../../core/fullExport.ts'
import { renderReportShell, htmlTableHtml, escHtml } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { EmptyState, useToast } from '../components/ui.tsx'
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

export function ContractingReportsPage() {
  const { projects, getRemainingRetention, getProjectProfit } = useDataStore()
  const failed: string[] = []
  let costs = 0, profits = 0
  for (const project of projects) {
    try {
      getRemainingRetention(project.id)
      const result = getProjectProfit(project.id)
      try { costs = addMinor(costs, result.costsMinor); profits = addMinor(profits, result.profitMinor) }
      catch { throw new FinancialDataReviewError('إجماليات المشاريع', 'المجموع خارج النطاق الآمن') }
    } catch (error) {
      if (!(error instanceof FinancialDataReviewError)) throw error
      failed.push(project.nameAr)
    }
  }
  if (failed.length) return <section role="alert" className="rounded-xl border border-amber-400 p-4 text-amber-700">يلزم مراجعة المستخلصات والمحتجز وتكاليف المشروع أو مرتجعات الشراء وتوزيعات الرواتب وقيودها قبل عرض أو تصدير تقارير المقاولات: {failed.join('، ')}.</section>
  return <ReviewedContractingReportsPage />
}

function ReviewedContractingReportsPage() {
  const {
    projects, projectExtracts, projectCosts, retentionReleases, changeOrders, customers, clientAdvances,
    suppliers, treasuries, custodyFiles, boqItems, journal,
    getOpenClientInvoices, getProjectCostBreakdown, getProjectPayrollCosts, assertProjectExtractRefunds, assertProjectExtractOriginals,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const reportBasis = projectReportBasis(useDataStore.getState())
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  /* §99: مطبوعات الوحدة بالغلاف الموحد (تصدير PDF/Excel لكل تقارير الوحدات) */
  const printDoc = (title: string, subtitle: string, bodyHtml: string) => {
    /* لا تُطبع نسخة سبق بناؤها إذا تغير تخصيص الرواتب أو لم تعد أدلته سليمة. */
    const payrollBasis = JSON.stringify(cards.map(row => [row.project.id, row.payroll]))
    const build = () => {
      const fresh = useDataStore.getState()
      if (projectReportBasis(fresh) !== reportBasis) throw new Error('تغير أساس التقرير')
      for (const project of fresh.projects) { fresh.getRemainingRetention(project.id); fresh.getProjectProfit(project.id) }
      if (JSON.stringify(fresh.projects.map(project => [project.id, fresh.getProjectPayrollCosts(project.id)])) !== payrollBasis) throw new Error('تغيرت توزيعات الرواتب — أعد فتح التقرير')
      const { reportPrint, receipt } = useAppStore.getState()
      return renderReportShell({ title, subtitle, companyName: setup.shopName || 'المنشأة', logoDataUrl: receipt.logoDataUrl, bodyHtml: `<p>التكاليف تشمل 5110 وتوزيع القسائم المثبت من 5102 فقط؛ المسير المجمّع والقسائم بلا توزيع غير مشمولين.</p>${bodyHtml}`, settings: reportPrint })
    }
    try { printHtml(build(), { preview: { title: `معاينة ${title} قبل الطباعة`, rebuild: build } }) }
    catch { toast.show('تغيّرت بيانات التقرير أو تحتاج مراجعة — أعد فتحه', 'error') }
  }
  const sectionHtml = (label: string) => `<p class="sec" style="margin:12px 0 4px;padding:6px 10px">${escHtml(label)}</p>`
  const [tab, setTab] = usePersistedSectionView('contracting-reports', 'projects', ['projects', 'project', 'client', 'dues', 'formal'] as const)
  const [projectId, setProjectId] = useState('')
  const [clientId, setClientId] = useState('')

  /** بطاقة التقرير الخالصة لكل مشروع — من النواة مباشرة */
  const cards = projects.map((p) => {
    assertProjectExtractOriginals(p.id)
    assertProjectExtractRefunds(p.id)
    const extracts = projectExtracts.filter((e) => e.projectId === p.id)
    const released = retentionReleases.filter((r) => r.projectId === p.id).reduce((a, r) => a + r.amountMinor, 0)
    const orders = changeOrders.filter((o) => o.projectId === p.id)
    const advances = clientAdvances.filter((a) => a.projectId === p.id)
    const flat = extracts.map((e) => ({ ...netProjectExtractTotals(e), retentionMinor: (e.totals.retentionMinor - creditedProjectRetention(e)), date: e.date }))
    /* بنود projectCosts بمصادرها المختلفة. أي مرتجع مرتبط بفاتورة المشروع
       يتوقف للمراجعة في المستودع حتى يتوفر مسار يثبت عكس 5110. */
    const bd = getProjectCostBreakdown(p.id)
    const payroll = getProjectPayrollCosts(p.id)
    const payrollTotal = payroll.reduce((sum, row) => addMinor(sum, row.amountMinor), 0)
    const fullCosts = [
      ...projectCosts.filter((c) => c.projectId === p.id).flatMap((c) => c.lines?.length ? c.lines.map(line => ({ kind: line.kind, amountMinor: line.netMinor })) : [{ kind: c.kind, amountMinor: c.amountMinor }]),
      ...bd.purchaseReturns.map((r) => ({ kind: 'materials' as CostKind, amountMinor: -r.totalMinor })),
      ...payroll.map((row) => ({ kind: 'labor' as CostKind, amountMinor: row.amountMinor })),
    ]
    return { project: p, card: projectReportCard(p, flat, fullCosts, released, orders, advances), breakdown: bd, payroll, payrollTotal }
  })
  const guardedDownloadCsv = (rows: readonly Record<string, unknown>[], filename: string) => {
    try {
      const fresh = useDataStore.getState()
      if (projectReportBasis(fresh) !== reportBasis) throw new Error('تغير أساس التقرير')
      if (JSON.stringify(fresh.projects.map(project => [project.id, fresh.getProjectPayrollCosts(project.id)])) !== JSON.stringify(cards.map(row => [row.project.id, row.payroll]))) throw new Error('تغيرت توزيعات الرواتب')
      for (const project of fresh.projects) fresh.getProjectProfit(project.id)
      downloadCsv(rows.map(row => ({ ...row, 'ملاحظة نطاق الرواتب': 'يشمل التوزيع المثبت للقسائم فقط، ولا يشمل المسير المجمّع أو القسائم بلا توزيع' })), filename)
    } catch { toast.show('تغيّرت بيانات الرواتب أو تحتاج مراجعة — أعد فتح التقرير', 'error') }
  }

  /** المفتوح من المستخلصات لكل مشروع: من دفتر التوزيع (docKey = extract:<id>) */
  // الدفتر الكامل يُظهر المستند المسدّد برصيد صفر بدلاً من استنتاجه من الغياب.
  // نحسبه مع كل عرض لأن السداد/الشيكات قد تتغير دون تغير دالة المتجر.
  const openByProject = projectOpenBalances(projects, projectExtracts, getOpenClientInvoices)
  const unlinkedReceivables = new Set(projects.filter(p => (p.clientId == null || !customers.some(c => c.id === p.clientId)) && projectExtracts.some(e => e.projectId === p.id && e.payment === 'credit' && e.totals.dueMinor > (e.advanceRecoveryMinor ?? 0))).map(p => p.id))
  const openProjectLabel = (id: number) => unlinkedReceivables.has(id) ? 'تتطلب مراجعة ربط العميل والتحصيلات' : fmt(openByProject.get(id) ?? 0)

  const totals = ({
    contract: cards.reduce((a, r) => a + r.card.contractEffectiveMinor, 0),
    extracted: cards.reduce((a, r) => a + r.card.extractedMinor, 0),
    costs: cards.reduce((a, r) => a + r.card.costsMinor, 0),
    profit: cards.reduce((a, r) => a + r.card.profitMinor, 0),
    retention: cards.reduce((a, r) => a + r.card.retentionHeldMinor, 0),
    advances: cards.reduce((a, r) => a + r.card.advancesRemainingMinor, 0),
    open: cards.reduce((a, r) => a + (openByProject.get(r.project.id) ?? 0), 0),
  })

  const totalOpenLabel = unlinkedReceivables.size > 0 ? 'تتطلب مراجعة ربط العميل والتحصيلات' : fmt(totals.open)

  /* ═══ تبويب: مشروع بعينه ═══ */
  const selected = cards.find((r) => r.project.id === Number(projectId)) ?? null
  const selectedExtracts = selected ? projectExtracts.filter((e) => e.projectId === selected.project.id) : []
  const selectedCosts = selected ? projectCosts.filter((c) => c.projectId === selected.project.id) : []
  /* كشف المصروفات التفصيلي (طلب المالك — سطر لكل بند) من النواة الخالصة */
  const selectedLedger = buildProjectExpenseLedger(selected ? projectCosts.filter((c) => c.projectId === selected.project.id) : [], {
    supplierName: (id) => (id == null ? '—' : suppliers.find((x) => x.id === id)?.nameAr ?? `#${id}`),
    treasuryName: (code) => (code ? treasuries.find((x) => x.code === code)?.nameAr ?? code : ''),
    custodyLabel: (fileId) => { const f = custodyFiles.find((x) => x.id === fileId); return f ? `عهدة ${f.fileNumber}` : 'عهدة موظف' },
    boqLabel: (id) => { const b = boqItems.find((x) => x.id === id); return b ? `${b.code} — ${b.descriptionAr}` : '' },
    journalEntryNumber: (entryId) => journal.find((e) => e.id === entryId)?.entryNumber ?? entryId,
  })
  const selectedOrders = selected ? changeOrders.filter((o) => o.projectId === selected.project.id) : []
  const selectedOpenDocs = selected?.project.clientId != null && customers.some(c => c.id === selected.project.clientId)
    ? getOpenClientInvoices(selected.project.clientId).filter((inv) => selectedExtracts.some((e) => `extract:${e.id}` === inv.docKey))
    : []

  /* ═══ تبويب: ذمم عملاء المقاولات ═══ */
  const clientDues = (() => {
    const byClient = new Map<number, { nameAr: string; extractedMinor: number; retentionMinor: number; openMinor: number; openDocs: number }>()
    for (const p of projects) {
      if (p.clientId == null || !customers.some(c => c.id === p.clientId)) continue
      const row = byClient.get(p.clientId) ?? { nameAr: customers.find((c) => c.id === p.clientId)?.nameAr ?? '—', extractedMinor: 0, retentionMinor: 0, openMinor: 0, openDocs: 0 }
      for (const e of projectExtracts.filter((x) => x.projectId === p.id)) {
        row.extractedMinor += netProjectExtractTotals(e).grossMinor
        row.retentionMinor += (e.totals.retentionMinor - creditedProjectRetention(e))
      }
      row.openMinor += openByProject.get(p.id) ?? 0
      const ledger = new Map(getOpenClientInvoices(p.clientId, true).map((doc) => [doc.docKey, doc]))
      row.openDocs += projectExtracts.filter((e) => {
        if (e.projectId !== p.id || e.payment !== 'credit') return false
        const doc = ledger.get(`extract:${e.id}`)
        const creditRefund = (e.refunds ?? []).filter(r => r.mode === 'customer_credit').reduce((sum, r) => sum + r.amountMinor, 0)
        const fallback = Math.max(0, e.totals.dueMinor - Math.max(0, e.advanceRecoveryMinor ?? 0) - creditRefund)
        return (doc ? Math.max(0, doc.dueMinor - doc.settledMinor) : fallback) > 0
      }).length
      byClient.set(p.clientId, row)
    }
    return [...byClient.entries()].map(([customerId, row]) => ({ customerId, ...row })).sort((a, b) => b.openMinor - a.openMinor)
  })()

  /* ═══ تبويب: عميل بعينه (§102 — العميل محور التقارير بنمط بطاقة المشروع) ═══ */
  const clientsWithProjects = useMemo(() => {
    const byClient = new Map<number, { customerId: number; nameAr: string; projectsCount: number }>()
    for (const p of projects) {
      if (p.clientId == null || !customers.some(c => c.id === p.clientId)) continue
      const row = byClient.get(p.clientId) ?? { customerId: p.clientId, nameAr: customers.find((c) => c.id === p.clientId)?.nameAr ?? '—', projectsCount: 0 }
      row.projectsCount += 1
      byClient.set(p.clientId, row)
    }
    return [...byClient.values()].sort((a, b) => b.projectsCount - a.projectsCount)
  }, [projects, customers])

  /** دفتر العميل الكامل — يشمل المستندات المفتوحة والمسددة. */
  const clientOpenDocs = clientId ? getOpenClientInvoices(Number(clientId), true) : []
  const extractSettlement = (e: (typeof projectExtracts)[number]) =>
    projectExtractSettlement(e, clientOpenDocs.find((d) => d.docKey === `extract:${e.id}`))

  const clientRows: readonly ClientProjectRow[] = (() => {
    if (!clientId) return []
    const cid = Number(clientId)
    return cards.filter((r) => r.project.clientId === cid).map(({ project: p, card: c }) => {
      let openMinor = 0, openCount = 0, settled = 0
      for (const e of projectExtracts.filter((x) => x.projectId === p.id)) {
        const { settled: st, remaining } = extractSettlement(e)
        settled += st
        openMinor += remaining
        if (remaining > 0) openCount += 1
      }
      return {
        projectId: p.id, projectName: p.nameAr, projectCode: p.code, status: p.status,
        contractEffectiveMinor: c.contractEffectiveMinor, extractedMinor: c.extractedMinor,
        retentionHeldMinor: c.retentionHeldMinor, advancesRemainingMinor: c.advancesRemainingMinor,
        openExtractsMinor: openMinor, openExtractsCount: openCount, settledOnExtractsMinor: settled,
      }
    })
  })()

  const clientCardView = clientRows.length ? clientContractingCard(clientRows) : null
  const clientName = clientsWithProjects.find((c) => c.customerId === Number(clientId))?.nameAr ?? ''
  /** مستخلصات العميل كلها عبر مشاريعه — مع محصّل/متبقٍ كل مستخلص */
  const clientExtractRows = (() => {
    if (!clientRows.length) return []
    const pidToName = new Map(clientRows.map((r) => [r.projectId, `${r.projectCode} — ${r.projectName}`]))
    return projectExtracts
      .filter((e) => pidToName.has(e.projectId))
      .map((e) => {
        const { settled: st, remaining } = extractSettlement(e)
        return {
          extract: e, projectName: pidToName.get(e.projectId) ?? '—',
          settledMinor: st, remainingMinor: remaining,
        }
      })
      .sort((a, b) => b.extract.date.localeCompare(a.extract.date))
  })()

  /* ═══ §99: مطبوعات لوحة المشاريع / بطاقة المشروع / الذمم — كل جدول قابل للطباعة PDF ═══ */
  const printProjects = () => printDoc('لوحة مشاريع المقاولات', 'كل المشاريع — الأرقام من القيود المرحّلة', htmlTableHtml({
    headers: ['المشروع', 'العميل', 'العقد الفعلي', 'إنجاز ٪', 'المستخلصات', 'التكاليف', 'الربح (هامش ٪)', 'محتجز قائم', 'مقدمة متبقية', 'ذمم مفتوحة', 'الحالة'],
    numCols: [2, 3, 4, 5, 6, 7, 8, 9],
    rows: cards.map(({ project: p, card: c }) => [
      `${p.code} — ${p.nameAr}`, p.clientName || '—', fmt(c.contractEffectiveMinor), `${c.progressPercent}٪`,
      fmt(c.extractedMinor), fmt(c.costsMinor), `${fmt(c.profitMinor)} (${c.marginPercent}٪)`,
      fmt(c.retentionHeldMinor), fmt(c.advancesRemainingMinor), openProjectLabel(p.id),
      projectSystemStatusLabel(p.status),
    ]),
    totalRow: ['الإجمالي', '', fmt(totals.contract), '', fmt(totals.extracted), fmt(totals.costs), fmt(totals.profit), fmt(totals.retention), fmt(totals.advances), totalOpenLabel, ''],
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
      ['ذمم مفتوحة (مستخلصات)', openProjectLabel(selected.project.id)],
    ]
    const body = [
      htmlTableHtml({ headers: ['مؤشرات البطاقة', 'القيمة'], numCols: [1], rows: kpiRows }),
      sectionHtml('مصادر التكاليف — مستندات 5110 وتخصيص القسائم من 5102'),
      htmlTableHtml({
        headers: ['المصدر', 'المبلغ'], numCols: [1],
        rows: [
          ['تكاليف يدوية مسجّلة', fmt(bd.totals.manualMinor)],
          ['شهادات مقاولي الباطن', fmt(bd.totals.subMinor)],
          ['أجور يومية مسوّاة', fmt(bd.totals.dailyMinor)],
          ['فواتير شراء مربوطة', fmt(bd.totals.purchasesMinor)],
          ['أذون صرف مواد من المخزن', fmt(bd.totals.materialIssuesMinor)],
          ['مرتجعات شراء (خافضة)', fmt(-bd.totals.returnsMinor)],
          ['تخصيص قسائم الرواتب المثبت (5102)', fmt(selected.payrollTotal)],
        ],
        totalRow: ['إجمالي تكاليف المشروع', fmt(selected.card.costsMinor)],
      }),
      ...(selected.payroll.length ? [sectionHtml('تفصيل التوزيع المثبت من 5102'), htmlTableHtml({
        headers: ['التاريخ', 'القسيمة', 'قيد الاستحقاق', 'النسبة ٪', 'نصيب المشروع'], numCols: [2, 3, 4],
        rows: selected.payroll.map(row => [row.date, row.slipNumber, row.journalEntryId, row.basisPoints / 100, fmt(row.amountMinor)]),
      })] : []),
      ...(selectedExtracts.length ? [
        sectionHtml(`المستخلصات (${selectedExtracts.length})`),
        htmlTableHtml({
          headers: ['المستخلص', 'التاريخ', 'قيمة الأعمال', 'محتجز', 'المستحق'], numCols: [2, 3, 4],
          rows: selectedExtracts.map((e) => [`${e.extractNumber}${e.isFinal ? ' (ختامي)' : ''}`, e.date.slice(0, 10), fmt(netProjectExtractTotals(e).grossMinor), fmt((e.totals.retentionMinor - creditedProjectRetention(e))), fmt(e.totals.dueMinor - (e.refundedMinor ?? 0))]),
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
      ...(selectedLedger.rows.length ? [
        sectionHtml(`كشف مستندات مصروف 5110 فقط، دون مرتجعات الشراء أو توزيع 5102 (${selectedLedger.totals.docsCount} مستند · ${selectedLedger.totals.linesCount} بند)`),
        htmlTableHtml({
          headers: ['التاريخ', 'المستند', 'مرجع المورد', 'المورد', 'بيان البند', 'التصنيف', 'كمية × سعر', 'الصافي', 'الضريبة', 'الإجمالي'],
          numCols: [6, 7, 8, 9],
          rows: selectedLedger.rows.map((r) => [
            r.date, r.expenseNumber, r.invoiceRef || '—', r.supplierName, r.lineDescription, r.categoryName,
            `${r.qty} × ${fmt(r.unitPriceMinor)}`, fmt(r.netMinor), fmt(r.vatMinor), fmt(r.grossMinor),
          ]),
          totalRow: ['', '', '', '', `الإجمالي (المدفوع ${fmt(selectedLedger.totals.paidMinor)} · الآجل ${fmt(selectedLedger.totals.dueMinor)})`, '', '', fmt(selectedLedger.totals.netMinor), fmt(selectedLedger.totals.vatMinor), fmt(selectedLedger.totals.grossMinor)],
        }),
      ] : []),
    ].join('')
    printDoc(`بطاقة مشروع — ${selected.project.code}`, `${selected.project.nameAr}${selected.project.clientName ? ` · العميل: ${selected.project.clientName}` : ''}`, body)
  }

  const printDues = () => printDoc('ذمم عملاء المقاولات', 'متابعة التحصيل — المفتوح من المستخلصات الآجلة', (unlinkedReceivables.size ? '<p>تنبيه: مستخلصات بلا سجل عميل صحيح مستبعدة من التقرير ويلزم مراجعة ربطها وتحصيلاتها.</p>' : '') + htmlTableHtml({
    headers: ['العميل', 'الأعمال المستخلصة', 'المحتجز لديه', 'ذمم مفتوحة', 'مستخلصات آجلة'],
    numCols: [1, 2, 3, 4],
    rows: clientDues.map((row) => [row.nameAr, fmt(row.extractedMinor), fmt(row.retentionMinor), row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة', row.openDocs]),
    totalRow: [unlinkedReceivables.size ? 'إجمالي العملاء المرتبطين فقط' : 'الإجمالي', fmt(clientDues.reduce((a, r) => a + r.extractedMinor, 0)), fmt(clientDues.reduce((a, r) => a + r.retentionMinor, 0)), fmt(clientDues.reduce((a, r) => a + r.openMinor, 0)), clientDues.reduce((a, r) => a + r.openDocs, 0)],
  }))

  const printClientCard = () => {
    if (!clientCardView) return
    const c = clientCardView
    const body = [
      htmlTableHtml({ headers: ['مؤشرات بطاقة العميل', 'القيمة'], numCols: [1], rows: [
        ['المشاريع (جارية منها)', `${c.projectsCount} (${c.activeProjects})`],
        ['مجموع العقود الفعلية', fmt(c.contractMinor)],
        ['قيمة الأعمال المستخلصة', fmt(c.extractedMinor)],
        ['المحتجز القائم لدى العميل', fmt(c.retentionHeldMinor)],
        ['الدفعات المقدمة المتبقية', fmt(c.advancesRemainingMinor)],
        ['المفتوح من المستخلصات الآجلة', `${fmt(c.openDocsMinor)} (${c.openDocsCount} مستند)`],
        ['المحصل على المستخلصات', fmt(c.collectedMinor)],
        ['نسبة التحصيل ٪', `${c.collectedPercent}٪`],
        ['المستحق الصافي (مفتوح − مقدمة متبقية)', fmt(c.netDueMinor)],
      ]}),
      sectionHtml(`مشاريع العميل (${clientRows.length})`),
      htmlTableHtml({
        headers: ['المشروع', 'العقد الفعلي', 'المستخلصات', 'محتجز قائم', 'مقدمة متبقية', 'مفتوح', 'الحالة'], numCols: [1, 2, 3, 4, 5],
        rows: clientRows.map((r) => [`${r.projectCode} — ${r.projectName}`, fmt(r.contractEffectiveMinor), fmt(r.extractedMinor), fmt(r.retentionHeldMinor), fmt(r.advancesRemainingMinor), r.openExtractsMinor > 0 ? fmt(r.openExtractsMinor) : '✓ مسددة', projectSystemStatusLabel(r.status)]),
        totalRow: ['الإجمالي', fmt(c.contractMinor), fmt(c.extractedMinor), fmt(c.retentionHeldMinor), fmt(c.advancesRemainingMinor), fmt(c.openDocsMinor), ''],
      }),
      ...(clientExtractRows.length ? [
        sectionHtml(`مستخلصات العميل (${clientExtractRows.length})`),
        htmlTableHtml({
          headers: ['المستخلص', 'المشروع', 'التاريخ', 'قيمة الأعمال', 'محتجز', 'المستحق', 'محصّل', 'متبقٍ'], numCols: [3, 4, 5, 6, 7],
          rows: clientExtractRows.map(({ extract: e, projectName, settledMinor, remainingMinor }) => [
            `${e.extractNumber}${e.isFinal ? ' (ختامي)' : ''}`, projectName, e.date.slice(0, 10),
            fmt(netProjectExtractTotals(e).grossMinor), fmt((e.totals.retentionMinor - creditedProjectRetention(e))), fmt(e.totals.dueMinor - (e.refundedMinor ?? 0)), fmt(settledMinor), remainingMinor > 0 ? fmt(remainingMinor) : '✓',
          ]),
        }),
      ] : []),
    ].join('')
    printDoc(`بطاقة عميل — ${clientName}`, 'مركز تقارير المقاولات — منظور العميل', body)
  }

  const kpi = (label: string, value: string, tone = 'text-slate-800 dark:text-slate-100') => (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-center"><div className="text-[10px] text-slate-400 font-bold">{label}</div><div className={`font-black text-[15px] ${tone}`}>{value}</div></div>
  )

  return (
    <div className="space-y-4">
      <p role="note" className="text-amber-700 text-sm">تشمل الربحية تكاليف 5110 وتوزيع القسائم المثبت من 5102 فقط، دون قيد إضافي. المسير المجمّع والقسائم بلا توزيع غير مشمولين؛ راجع اكتمال تكاليف الرواتب قبل الاعتماد.</p>
      {unlinkedReceivables.size > 0 && <p role="alert" className="text-amber-700 text-sm">توجد مستخلصات بعميل غير مرتبط أو مفقود؛ لا تُعتمد التحصيلات والذمم الإجمالية حتى مراجعتها، وقد تُستبعد من تقارير العملاء.</p>}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><BarChart3 className="w-6 h-6 text-orange-500" /> مركز تقارير المقاولات</h1>
        <div className="flex gap-1.5">
          {([['projects', 'لوحة المشاريع'], ['project', 'مشروع بعينه'], ['formal', 'التقرير الرسمي ③'], ['client', 'عميل بعينه'], ['dues', 'ذمم العملاء']] as const).map(([id, label]) => (
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
            {kpi('ذمم مفتوحة', totalOpenLabel, 'text-rose-600')}
          </div>

          {/* ═══ ① لوحة المشاريع ═══ */}
          {tab === 'projects' && (
            <div className="anim-up space-y-3">
              <div className="flex justify-end gap-1.5">
                <button onClick={printProjects} data-print="projects"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => guardedDownloadCsv(cards.map((r) => ({
                  'الكود': r.project.code, 'المشروع': r.project.nameAr, 'العميل': r.project.clientName || '—',
                  'قيمة العقد الفعلية': fmt(r.card.contractEffectiveMinor), 'أوامر معلقة': fmt(r.card.changeOrdersPendingMinor),
                  'المستخلصات': fmt(r.card.extractedMinor), 'الإنجاز ٪': r.card.progressPercent,
                  'التكاليف': fmt(r.card.costsMinor), 'الربح': fmt(r.card.profitMinor), 'الهامش ٪': r.card.marginPercent,
                  'محتجز قائم': fmt(r.card.retentionHeldMinor), 'دفعات مقدمة متبقية': fmt(r.card.advancesRemainingMinor),
                  'ذمم مفتوحة': openProjectLabel(r.project.id), 'الحالة': projectSystemStatusLabel(r.project.status),
                })), `تقرير-مشاريع-المقاولات-${todayLocalIso()}.csv`)}
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
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{unlinkedReceivables.has(p.id) ? <span className="text-amber-700">{openProjectLabel(p.id)}</span> : openByProject.get(p.id) ? <span className="text-rose-600">{openProjectLabel(p.id)}</span> : <span className="text-emerald-600">✓</span>}</td>
                        <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-lg text-[10.5px] font-bold ${p.status === 'active' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{projectSystemStatusLabel(p.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ①ب التقرير الرسمي التحليلي (تصميم ③ — قرار المالك 2026-10-27) ═══ */}
          {tab === 'formal' && (
            <div className="anim-up">
              <AnalyticalProjectReportView projectId={projectId} onProjectChange={setProjectId} />
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
                    <button onClick={() => guardedDownloadCsv([
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
                      { 'البند': 'ذمم مفتوحة (مستخلصات)', 'القيمة': openProjectLabel(selected.project.id) },
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
                    {kpi('ذمم مفتوحة', openProjectLabel(selected.project.id), 'text-rose-600')}
                  </div>

                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                      <div key={k} className="rounded-xl bg-slate-500/5 p-2"><div className="text-[10px] text-slate-500">{COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</div><div className="font-bold text-[12px]">{fmt(selected.card.costsByKind[k])}</div></div>
                    ))}
                  </div>

                  {/* مصادر التكاليف المسجلة؛ لا يثبت العرض مطابقة كل دفتر 5110. */}
                  {(() => {
                    const bd = selected.breakdown
                    const rows: [string, number][] = [
                      ['تكاليف يدوية مسجّلة', bd.totals.manualMinor],
                      ['شهادات مقاولي الباطن', bd.totals.subMinor],
                      ['أجور يومية مسوّاة', bd.totals.dailyMinor],
                      ['فواتير شراء مربوطة', bd.totals.purchasesMinor],
                      ['أذون صرف مواد من المخزن', bd.totals.materialIssuesMinor],
                      ['مرتجعات شراء (خافضة)', -bd.totals.returnsMinor],
                      ['تخصيص قسائم الرواتب المثبت (5102)', selected.payrollTotal],
                    ]
                    return (
                      <div className={`${card} overflow-hidden`} data-cost-sources>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                          <span className="flex items-center gap-1"><Calculator size={13} /> مصادر التكاليف (مستندات 5110 وتخصيص 5102)</span>
                          <b className="text-rose-600">{fmt(selected.card.costsMinor)} {cur.symbol}</b>
                        </div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {rows.map(([label, value]) => (
                              <tr key={label} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-4 py-2">{label}</td>
                                <td className={`px-4 py-2 text-left font-bold ${value < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(value)}</td>
                              </tr>
                            ))}
                            <tr className="bg-slate-500/5 font-black"><td className="px-4 py-2">إجمالي تكاليف المشروع</td><td className="px-4 py-2 text-left text-rose-600">{fmt(selected.card.costsMinor)}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  {selected.payroll.length > 0 && <div className={`${card} overflow-x-auto`} data-project-payroll-costs>
                    <h3 className="px-4 py-2 font-black">تخصيص قسائم الرواتب المثبت من 5102</h3>
                    <table className="w-full text-[12px]"><thead><tr>{['التاريخ', 'القسيمة', 'قيد الاستحقاق', 'النسبة ٪', 'نصيب المشروع'].map(label => <th key={label} className="px-4 py-2 text-right">{label}</th>)}</tr></thead>
                      <tbody>{selected.payroll.map(row => <tr key={row.slipId}><td className="px-4 py-2">{row.date}</td><td className="px-4 py-2">{row.slipNumber}</td><td className="px-4 py-2">{row.journalEntryId}</td><td className="px-4 py-2">{row.basisPoints / 100}٪</td><td className="px-4 py-2">{fmt(row.amountMinor)}</td></tr>)}</tbody>
                    </table>
                  </div>}

                  {/* كشف المصروفات التفصيلي + أوراق المشروع والرواتب */}
                  {(() => {
                    const mny = (m: number) => m / 10 ** cur.decimals
                    const openRemaining = selectedOpenDocs.reduce((a, inv) => a + Math.max(0, inv.dueMinor - inv.settledMinor), 0)
                    const cardSheet: ExportSheet = {
                      nameAr: 'بطاقة المشروع',
                      headers: ['البند', 'القيمة'],
                      rows: [
                        ['رمز المشروع', selected.project.code],
                        ['اسم المشروع', selected.project.nameAr],
                        ['العميل', selected.project.clientName ?? ''],
                        ['قيمة العقد الأصلية', mny(selected.card.contractOriginalMinor)],
                        ['قيمة العقد الفعلية (بأوامر التغيير)', mny(selected.card.contractEffectiveMinor)],
                        ['الأعمال المستخلصة', mny(selected.card.extractedMinor)],
                        ['ضريبة القيمة المضافة المحمّلة على العميل', mny(selected.card.vatChargedMinor)],
                        ['نسبة الإنجاز ٪', selected.card.progressPercent],
                        ['الاحتفاظ المحتجَز لدى العميل', mny(selected.card.retentionHeldMinor)],
                        ['الدفعات المقدمة المتبقية', mny(selected.card.advancesRemainingMinor)],
                        ['ذمم مستخلصات مفتوحة', mny(openRemaining)],
                        ['تخصيص قسائم الرواتب المثبت (5102)', mny(selected.payrollTotal)],
                        ['تنبيه', 'لا تشمل الربحية المسير المجمّع أو القسائم بلا توزيع؛ راجع اكتمال الرواتب'],
                        ['إجمالي التكاليف', mny(selected.card.costsMinor)],
                        ['صافي ربح المشروع', mny(selected.card.profitMinor)],
                      ],
                    }
                    const extractsSheet: ExportSheet = {
                      nameAr: 'المستخلصات',
                      headers: ['رقم المستخلص', 'التاريخ', 'الأعمال (شامل الضريبة)', 'الضريبة', 'الاحتفاظ', 'صافي المستحق', 'الحالة'],
                      rows: selectedExtracts.map((e) => [e.extractNumber, e.date.slice(0, 10), mny(netProjectExtractTotals(e).grossMinor), mny(netProjectExtractTotals(e).vatMinor), mny((e.totals.retentionMinor - creditedProjectRetention(e))), mny(e.totals.dueMinor - (e.refundedMinor ?? 0)), e.isFinal ? 'ختامي' : 'جاري']),
                    }
                    const payrollSheet: ExportSheet = {
                      nameAr: 'توزيع الرواتب 5102',
                      headers: ['التاريخ', 'القسيمة', 'قيد الاستحقاق', 'النسبة ٪', 'نصيب المشروع'],
                      rows: selected.payroll.map(row => [row.date, row.slipNumber, row.journalEntryId, row.basisPoints / 100, mny(row.amountMinor)]),
                    }
                    return (
                      <ProjectExpenseLedgerCard
                        costs={selectedCosts}
                        projectCode={selected.project.code}
                        projectNameAr={selected.project.nameAr}
                        preSheets={[cardSheet, extractsSheet, payrollSheet]}
                        assertExportCurrent={() => {
                          const fresh = useDataStore.getState()
                          if (projectReportBasis(fresh) !== reportBasis) throw new Error('تغير أساس التقرير')
                          if (JSON.stringify(fresh.getProjectPayrollCosts(selected.project.id)) !== JSON.stringify(selected.payroll)) throw new Error('تغيرت توزيعات الرواتب')
                          fresh.getProjectProfit(selected.project.id)
                        }}
                        title="كشف مصروفات 5110 — Excel يشمل بطاقة المشروع وتوزيعات 5102"
                      />
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
                                <td className="px-3 py-2">أعمال {fmt(netProjectExtractTotals(e).grossMinor)}</td>
                                <td className="px-3 py-2 text-amber-600">محتجز {fmt((e.totals.retentionMinor - creditedProjectRetention(e)))}</td>
                                <td className="px-3 py-2 font-bold text-left">{fmt(e.totals.dueMinor - (e.refundedMinor ?? 0))}</td>
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

          {/* ═══ ③ عميل بعينه (§102 — العميل محور التقارير) ═══ */}
          {tab === 'client' && (
            <div className="anim-up space-y-3">
              <div className="text-[12px] text-slate-500">
                بطاقة العميل في المقاولات: مشاريعه وعقوده ومستخلصاته ومحتجزه ودفعاته المقدمة وما فُتح منها وما حُصّل — من نفس دفاتر بطاقة المشروع، مع رابط مباشر لكشف حسابه الكامل.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="client-select"
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-card-dark text-[13px] font-bold min-w-56">
                  <option value="">— اختر عميلاً له مشاريع —</option>
                  {clientsWithProjects.map((c) => <option key={c.customerId} value={c.customerId}>{c.nameAr} ({c.projectsCount} مشروع)</option>)}
                </select>
                {clientCardView && (
                  <div className="flex gap-1.5">
                    <button onClick={printClientCard} data-print="client-card"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                    <button onClick={() => guardedDownloadCsv([
                      ...clientRows.map((r) => ({ 'نوع الصف': 'مشروع', 'المشروع': `${r.projectCode} — ${r.projectName}`, 'العقد الفعلي': fmt(r.contractEffectiveMinor), 'المستخلصات': fmt(r.extractedMinor), 'محتجز قائم': fmt(r.retentionHeldMinor), 'مقدمة متبقية': fmt(r.advancesRemainingMinor), 'مفتوح': fmt(r.openExtractsMinor), 'محصّل': fmt(r.settledOnExtractsMinor), 'الحالة': projectSystemStatusLabel(r.status) })),
                      ...clientExtractRows.map(({ extract: e, projectName, settledMinor, remainingMinor }) => ({ 'نوع الصف': 'مستخلص', 'المشروع': projectName, 'العقد الفعلي': '', 'المستخلصات': fmt(netProjectExtractTotals(e).grossMinor), 'محتجز قائم': fmt((e.totals.retentionMinor - creditedProjectRetention(e))), 'مقدمة متبقية': '', 'مفتوح': fmt(remainingMinor), 'محصّل': fmt(settledMinor), 'الحالة': e.payment === 'cash' ? 'نقدي' : remainingMinor > 0 ? 'آجل مفتوح' : 'آجل مسدد' })),
                    ], `بطاقة-عميل-${clientName || clientId}-${todayLocalIso()}.csv`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير البطاقة CSV</button>
                    <button onClick={() => { window.location.hash = `#/reports/statements?kind=customer&id=${clientId}` }}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-[12px] font-bold hover:bg-sky-700 transition-all">كشف الحساب الكامل ←</button>
                  </div>
                )}
              </div>
              {clientCardView ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {kpi('المشاريع (جارية)', `${clientCardView.projectsCount} (${clientCardView.activeProjects})`)}
                    {kpi('مجموع العقود الفعلية', fmt(clientCardView.contractMinor))}
                    {kpi('الأعمال المستخلصة', fmt(clientCardView.extractedMinor), 'text-orange-600')}
                    {kpi('المحتجز لديه', fmt(clientCardView.retentionHeldMinor), 'text-amber-600')}
                    {kpi('دفعات مقدمة متبقية', fmt(clientCardView.advancesRemainingMinor), 'text-sky-600')}
                    {kpi(`مفتوح (${clientCardView.openDocsCount} مستند)`, fmt(clientCardView.openDocsMinor), clientCardView.openDocsMinor > 0 ? 'text-rose-600' : 'text-emerald-600')}
                    {kpi('المحصل على المستخلصات', fmt(clientCardView.collectedMinor), 'text-emerald-600')}
                    {kpi(`نسبة التحصيل ${clientCardView.collectedPercent}٪ · المستحق الصافي`, fmt(clientCardView.netDueMinor), clientCardView.netDueMinor > 0 ? 'text-rose-600' : 'text-emerald-600')}
                  </div>
                  <div className={`${card} overflow-x-auto`}>
                    <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">مشاريع العميل ({clientRows.length})</div>
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
                        <tr>{['المشروع', 'العقد الفعلي', 'المستخلصات', 'محتجز قائم', 'مقدمة متبقية', 'مفتوح', 'الحالة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {clientRows.map((r) => (
                          <tr key={r.projectId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-orange-500/5 transition-colors cursor-pointer"
                            onClick={() => { setProjectId(String(r.projectId)); setTab('project') }}>
                            <td className="px-3 py-2.5 font-bold">{r.projectCode} — {r.projectName}</td>
                            <td className="px-3 py-2.5">{fmt(r.contractEffectiveMinor)}</td>
                            <td className="px-3 py-2.5 text-orange-600 font-bold">{fmt(r.extractedMinor)}</td>
                            <td className="px-3 py-2.5 text-amber-600">{fmt(r.retentionHeldMinor)}</td>
                            <td className="px-3 py-2.5 text-sky-600">{fmt(r.advancesRemainingMinor)}</td>
                            <td className={`px-3 py-2.5 font-bold ${r.openExtractsMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{r.openExtractsMinor > 0 ? fmt(r.openExtractsMinor) : '✓ مسددة'}</td>
                            <td className="px-3 py-2.5">{projectSystemStatusLabel(r.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {clientExtractRows.length > 0 && (
                    <div className={`${card} overflow-x-auto`}>
                      <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">مستخلصات العميل ({clientExtractRows.length})</div>
                      <table className="w-full text-[12.5px]">
                        <thead className="bg-slate-500/10 text-slate-600 dark:text-slate-300">
                          <tr>{['المستخلص', 'المشروع', 'التاريخ', 'قيمة الأعمال', 'محتجز', 'المستحق', 'محصّل', 'متبقٍ'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {clientExtractRows.map(({ extract: e, projectName, settledMinor, remainingMinor }) => (
                            <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-2.5 font-bold">{e.extractNumber}{e.isFinal ? ' (ختامي)' : ''}</td>
                              <td className="px-3 py-2.5 text-[11.5px] text-slate-500">{projectName}</td>
                              <td className="px-3 py-2.5">{e.date.slice(0, 10)}</td>
                              <td className="px-3 py-2.5 text-orange-600 font-bold">{fmt(netProjectExtractTotals(e).grossMinor)}</td>
                              <td className="px-3 py-2.5 text-amber-600">{fmt((e.totals.retentionMinor - creditedProjectRetention(e)))}</td>
                              <td className="px-3 py-2.5">{fmt(e.totals.dueMinor - (e.refundedMinor ?? 0))}</td>
                              <td className="px-3 py-2.5 text-emerald-600 font-bold">{fmt(settledMinor)}</td>
                              <td className={`px-3 py-2.5 font-bold ${remainingMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{remainingMinor > 0 ? fmt(remainingMinor) : '✓'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState icon="👤" title="اختر عميلاً" sub="قائمة العملاء الذين لهم مشاريع مقاولات — البطاقة تجمع كل مشاريعهم ومستخلصاتهم وأرصدتهم في مكان واحد" />
              )}
            </div>
          )}

          {/* ═══ ④ ذمم عملاء المقاولات ═══ */}
          {tab === 'dues' && (
            <div className="anim-up space-y-3">
              <div className="text-[12px] text-slate-500">
                متابعة تحصيل المقاولات: لكل عميل — قيمة الأعمال المستخلصة والمحتجز لديه وما زال مفتوحاً من مستخلصاته (تُطفأ من «تحصيلات العملاء» FIFO أو بمطابقة محددة).
              </div>
              <div className="flex justify-end gap-1.5">
                <button onClick={printDues} data-print="dues"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-bold hover:bg-slate-800 transition-all"><Printer size={14} /> طباعة / PDF</button>
                <button onClick={() => guardedDownloadCsv([
                  ...clientDues.map((row) => ({
                    'العميل': row.nameAr, 'الأعمال المستخلصة': fmt(row.extractedMinor), 'المحتجز لدى العميل': fmt(row.retentionMinor),
                    'ذمم مفتوحة': fmt(row.openMinor), 'مستخلصات آجلة': row.openDocs,
                  })),
                  ...(unlinkedReceivables.size ? [{ 'العميل': 'تنبيه: مستخلصات بلا عميل صحيح مستبعدة؛ راجع الربط والتحصيلات', 'الأعمال المستخلصة': '', 'المحتجز لدى العميل': '', 'ذمم مفتوحة': '', 'مستخلصات آجلة': '' }] : []),
                ], `ذمم-عملاء-المقاولات-${todayLocalIso()}.csv`)}
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
                          <button onClick={() => window.location.hash = `#/accounting/vouchers`} title="التحصيل من قسم سندات القبض" className="text-[11px] font-bold text-emerald-600 hover:underline">سند قبض ←</button>
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
