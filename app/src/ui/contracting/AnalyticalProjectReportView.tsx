/**
 * «تقرير المشروع التحليلي» — التصميم ③ الذي اختاره المالك (2026-10-27).
 * يبني النموذج من بيانات المتجر الحقيقية ويعرضه عبر مكوّن FormalReport،
 * فيحصل على: جداول نظامية بلا كروت + زر «معاينة وطباعة» يفتح نافذة المعاينة.
 */
import { useCallback, useMemo } from 'react'
import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { buildAnalyticalProjectReport, buildExtractSettledMap, type AnalyticalProjectSource } from '../../core/analyticalProjectReport.ts'
import { FormalReport } from '../components/FormalReport.tsx'
import { EmptyState } from '../components/ui.tsx'
import { todayLocalIso } from '../../core/time.ts'
import { FinancialDataReviewError } from '../../core/financialDataReview.ts'

interface Props {
  /** معرّف المشروع المختار (نص) — يشارك التاب «مشروع بعينه» اختياره */
  projectId: string
  onProjectChange: (id: string) => void
}

export function AnalyticalProjectReportView({ projectId, onProjectChange }: Props) {
  const {
    projects, projectExtracts, projectCosts, changeOrders, suppliers,
    clientSettlements, vouchers, cheques, getOpenClientInvoices, getProjectCostBreakdown, assertProjectExtractRefunds,
  } = useDataStore()
  const { setup, receipt } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = useCallback((m: number) => formatMinor(m, cur, false), [cur])

  const selected = projects.find((p) => p.id === Number(projectId)) ?? null
  /* يُقرأ التاريخ عند إعادة عرض المكوّن؛ لا يضمن ذلك تحديثاً تلقائياً
     عند منتصف الليل ما لم يحدث عرض جديد. */
  const reportDay = todayLocalIso()

  // الحساب مباشر حتى ينعكس تغير فواتير العميل الأخرى التي تؤثر على توزيع الشيكات.
  const model = (() => {
    if (!selected) return null
    const extracts = projectExtracts.filter((e) => e.projectId === selected.id)
    let refundLedgerIncomplete = false
    try { assertProjectExtractRefunds(selected.id) } catch (error) {
      if (!(error instanceof FinancialDataReviewError)) throw error
      refundLedgerIncomplete = true
    }
    const costs = projectCosts.filter((c) => c.projectId === selected.id)
    const orders = changeOrders.filter((o) => o.projectId === selected.id && (o.status === 'approved' || o.status === 'invoiced'))
    const projectCheques = selected.clientId == null ? [] : cheques
      .filter((c) => c.direction === 'incoming' && c.partyId === selected.clientId)
      .map((c) => ({
        direction: c.direction, partyId: c.partyId, status: c.status, amountMinor: c.amountMinor,
        chequeNumber: c.chequeNumber, bankName: c.bankName, createdAt: c.createdAt, settledAt: c.settledAt,
      }))

    /* مصدر واحد للتحصيلات: دفتر التوزيع (يشمل الشيكات بعد الإصلاح).
       مراجعة 2026-10-27: كان يُبنى بجمع `getOpenClientInvoices().settledMinor`
       ثم إضافة توزيعات السندات والتسويات **مرة ثانية** فيتضاعف المحصَّل.
       النواة buildExtractSettledMap تمنع ذلك: المفتوح يأخذ settledMinor وحده،
       والمسدَّد بالكامل يُقرأ من توزيعاته الصريحة/صافي استحقاقه. */
    const clientId = selected.clientId
    const projectVouchers = clientId == null ? [] : vouchers.filter((v) =>
      !v.reversalEntryId && v.kind === 'receipt' && v.partyKind === 'customer' && v.partyId === clientId)
    const projectSettlements = clientId == null ? [] : clientSettlements.filter((st) => st.customerId === clientId)
    /* الدفتر الكامل (بما فيه المسدَّد بالكامل) ⇒ settledMinor حقيقي لكل
       مستخلص بلا استنتاج. كان غياب مستخلص عن الدفتر المفتوح يُفسَّر
       «مسدَّد بالكامل» لمجرد وجود شيك للعميل على مستند آخر. */
    const openInvoices = clientId == null ? [] : getOpenClientInvoices(clientId, true)
    /* صافي استحقاق المستخلص الآجل بعد المقاصة — لمعرفة ما سُدّد كاملاً بالشيكات
       (الشيكات تُوزَّع داخل الدفتر بلا سجل توزيع صريح على المستخلص). */
    const extractDues = new Map<string, number>()
    if (clientId != null) {
      for (const e of extracts) {
        if (e.payment !== 'credit') continue
        const recovery = Math.min(e.totals.dueMinor, Math.max(0, e.advanceRecoveryMinor ?? 0))
        const due = e.totals.dueMinor - recovery
        if (due > 0) extractDues.set(`extract:${e.id}`, due)
      }
    }
    /* مفاتيح المستخلصات الآجلة فقط: توزيعات السندات على مستخلص نقدي ليست
       تحصيلاً على الذمم (النقدي محصَّل وقته) ولا يجوز أن تُستنتج كتحصيل. */
    const creditExtractDocKeys = extracts.filter((e) => e.payment !== 'cash').map((e) => `extract:${e.id}`)
    const hasSettlementEvidence = projectVouchers.length > 0 || projectSettlements.length > 0
      || projectCheques.some((c) => c.status !== 'bounced' && c.status !== 'cancelled' && c.amountMinor > 0)
    const openInvoiceSettled = buildExtractSettledMap({
      extractDocKeys: creditExtractDocKeys, openInvoices, extractDues,
      vouchers: projectVouchers, clientSettlements: projectSettlements,
      hasSettlementEvidence,
      fullLedger: true,
    })

    /* قيمة الشيكات المخصومة فعلاً من مستخلصات هذا المشروع =
       إجمالي ما سُدّد على المستخلصات − التوزيعات الصريحة (سندات/تسويات).
       الفرق هو نصيب الشيكات وفق توزيع FIFO داخل دفتر العميل؛ تمريره يمنع
       إدراج شيكات العميل كلها في كل مشروع (شيكات مستندات أخرى). */
    const explicitOnExtracts = new Map<string, number>()
    const creditKeySet = new Set(creditExtractDocKeys)
    for (const row of [...projectVouchers, ...projectSettlements]) {
      for (const a of row.allocations ?? []) {
        if (!creditKeySet.has(a.docKey)) continue
        explicitOnExtracts.set(a.docKey, (explicitOnExtracts.get(a.docKey) ?? 0) + a.appliedMinor)
      }
    }
    const offsetsById = new Map<number, { date: string; number: string; amountMinor: number }>()
    for (const doc of openInvoices) {
      if (!creditKeySet.has(doc.docKey)) continue
      for (const offset of doc.offsetAllocations ?? []) {
        const row = offsetsById.get(offset.offsetId) ?? { date: offset.date, number: offset.offsetNumber, amountMinor: 0 }
        row.amountMinor += offset.amountMinor
        offsetsById.set(offset.offsetId, row)
      }
    }
    const projectOffsets = [...offsetsById.values()]
    const adjustmentsByKey = new Map<string, { key: string; date: string; number: string; description: string; amountMinor: number }>()
    for (const doc of openInvoices) {
      if (!creditKeySet.has(doc.docKey)) continue
      for (const adjustment of doc.adjustmentAllocations ?? []) {
        const row = adjustmentsByKey.get(adjustment.key) ?? { key: adjustment.key, date: adjustment.date, number: adjustment.number, description: adjustment.description, amountMinor: 0 }
        row.amountMinor += adjustment.amountMinor
        adjustmentsByKey.set(adjustment.key, row)
      }
    }
    const projectAdjustments = [...adjustmentsByKey.values()]
    const receiptsByKey = new Map<string, { key: string; date: string; number: string; description: string; amountMinor: number }>()
    for (const doc of openInvoices) {
      if (!creditKeySet.has(doc.docKey)) continue
      for (const receipt of doc.estimatedReceiptAllocations ?? []) {
        const row = receiptsByKey.get(receipt.key) ?? { ...receipt, amountMinor: 0 }
        row.amountMinor += receipt.amountMinor
        receiptsByKey.set(receipt.key, row)
      }
    }
    const projectEstimatedReceipts = [...receiptsByKey.values()]
    const offsetTotal = [...projectOffsets, ...projectAdjustments, ...projectEstimatedReceipts].reduce((sum, row) => sum + row.amountMinor, 0)
    const settledOnExtracts = [...openInvoiceSettled.values()].reduce((s, v) => s + v, 0)
    const explicitTotal = [...openInvoiceSettled.keys()].reduce((s, k) => s + (explicitOnExtracts.get(k) ?? 0), 0)
    const chequeAttributedMinor = Math.max(0, settledOnExtracts - explicitTotal - offsetTotal)

    const src: AnalyticalProjectSource = {
      project: {
        code: selected.code, nameAr: selected.nameAr, clientName: selected.clientName,
        status: selected.status === 'active' ? 'جارٍ التنفيذ' : selected.status === 'completed' ? 'مكتمل' : 'مُسلَّم',
        startDate: selected.startDate, contractValueMinor: selected.contractValueMinor,
      },
      changeOrdersApprovedMinor: orders.reduce((s, o) => s + o.amountMinor, 0),
      refundLedgerIncomplete,
      extracts: extracts.map((e) => ({
        extractNumber: e.extractNumber, date: e.date, grossMinor: e.totals.grossMinor,
        vatMinor: e.totals.vatMinor, retentionMinor: e.totals.retentionMinor, dueMinor: e.totals.dueMinor,
        payment: e.payment, advanceRecoveryMinor: e.advanceRecoveryMinor ?? 0,
        refundedMinor: e.refundedMinor ?? 0, refundedTaxMinor: e.refundedTaxMinor ?? 0,
        refunds: e.refunds ?? [],
      })),
      expenses: [
        ...costs.map((c) => ({
          date: c.date, docNumber: c.expenseNumber ?? `#${c.id}`,
          description: c.description,
          party: c.supplierId != null ? suppliers.find((s) => s.id === c.supplierId)?.nameAr ?? undefined : undefined,
          category: c.kind, amountMinor: c.amountMinor,
        })),
        ...getProjectCostBreakdown(selected.id).purchaseReturns.map((r) => ({
          date: r.date, docNumber: r.returnNumber, description: 'مرتجع مشتريات المشروع',
          category: 'مرتجع مشتريات', amountMinor: -r.totalMinor,
        })),
      ],
      openInvoiceSettled,
      extractDocKeys: creditExtractDocKeys,
      vouchers: projectVouchers.map((v) => ({
        date: v.date, number: v.voucherNumber, description: v.description,
        amountMinor: v.amountMinor, reversed: false,
        allocations: v.allocations?.map((a) => ({ docKey: a.docKey, appliedMinor: a.appliedMinor })),
      })),
      clientSettlements: projectSettlements.map((st) => ({
        date: st.date, number: st.settlementNumber, amountMinor: st.amountMinor,
        allocations: st.allocations?.map((a) => ({ docKey: a.docKey, appliedMinor: a.appliedMinor })),
      })),
      cheques: projectCheques,
      partyOffsets: projectOffsets,
      customerAdjustments: projectAdjustments,
      estimatedReceipts: projectEstimatedReceipts,
      chequeAttributedMinor,
      currencySymbol: cur.symbol,
      companyName: setup.shopName || 'المنشأة',
      /* توحيد ترويسة الشاشة والطباعة: نفس الشعار ونفس اسم المُعِدّ في الاثنتين. */
      logoDataUrl: receipt.logoDataUrl || undefined,
      printedBy: setup.ownerName || undefined,
      period: `حتى ${reportDay}`,
      fmt,
    }
    return buildAnalyticalProjectReport(src)
  })()

  return (
    <div className="space-y-3" data-analytical-report>
      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 p-3">
        <div className="max-w-md">
          <PartyQuickPicker
            parties={projects.map((p) => ({ id: p.id, nameAr: `${p.code} — ${p.nameAr}` }))}
            value={projectId ? Number(projectId) : 0}
            onChange={(id) => onProjectChange(id ? String(id) : '')}
            cashLabel="اختر مشروعاً" label="بحث المشروع" cashValue={0}
          />
        </div>
      </div>
      {!selected || !model ? (
        <EmptyState icon="📊" title="اختر مشروعاً لعرض تقريره الرسمي" sub="التقرير يشمل: قيمة المشروع، ما حُصِّل، المتبقي، كل المصروفات برصيد تراكمي، ثم كل التحصيلات بالمتبقي بعد كل عملية، والتسوية الختامية" />
      ) : (
        <FormalReport
          model={model}
          filename={`تقرير-مشروع-${selected.code}-${todayLocalIso()}`}
          allowPrint
          allowExport
        />
      )}
    </div>
  )
}
