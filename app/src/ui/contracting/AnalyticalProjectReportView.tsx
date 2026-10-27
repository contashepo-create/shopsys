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
import { buildAnalyticalProjectReport, type AnalyticalProjectSource } from '../../core/analyticalProjectReport.ts'
import { FormalReport } from '../components/FormalReport.tsx'
import { EmptyState } from '../components/ui.tsx'
import { todayLocalIso } from '../../core/time.ts'

interface Props {
  /** معرّف المشروع المختار (نص) — يشارك التاب «مشروع بعينه» اختياره */
  projectId: string
  onProjectChange: (id: string) => void
}

export function AnalyticalProjectReportView({ projectId, onProjectChange }: Props) {
  const {
    projects, projectExtracts, projectCosts, changeOrders, suppliers,
    clientSettlements, vouchers, cheques, getOpenClientInvoices,
  } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = useCallback((m: number) => formatMinor(m, cur, false), [cur])

  const selected = projects.find((p) => p.id === Number(projectId)) ?? null

  const model = useMemo(() => {
    if (!selected) return null
    const extracts = projectExtracts.filter((e) => e.projectId === selected.id)
    const costs = projectCosts.filter((c) => c.projectId === selected.id)
    const orders = changeOrders.filter((o) => o.projectId === selected.id && (o.status === 'approved' || o.status === 'invoiced'))
    const extractIds = new Set(extracts.map((e) => e.id))
    const extractDocKeys = extracts.map((e) => `extract:${e.id}`)

    /* مصدر واحد للتحصيلات: دفتر التوزيع (يشمل الشيكات بعد الإصلاح) */
    const openInvoiceSettled = new Map<string, number>()
    if (selected.clientId != null) {
      for (const inv of getOpenClientInvoices(selected.clientId)) {
        if (extractDocKeys.includes(inv.docKey)) openInvoiceSettled.set(inv.docKey, inv.settledMinor)
      }
      /* المستندات المسددة بالكامل لا تظهر في getOpenClientInvoices → نقرأ
         توزيعاتها من السندات والتسويات مباشرة */
      for (const v of vouchers) {
        if (v.reversalEntryId || v.kind !== 'receipt' || v.partyKind !== 'customer' || v.partyId !== selected.clientId) continue
        for (const a of v.allocations ?? []) {
          const id = Number(a.docKey.replace('extract:', ''))
          if (!extractIds.has(id)) continue
          openInvoiceSettled.set(a.docKey, (openInvoiceSettled.get(a.docKey) ?? 0) + a.appliedMinor)
        }
      }
      for (const st of clientSettlements) {
        if (st.customerId !== selected.clientId) continue
        for (const a of st.allocations) {
          const id = Number(a.docKey.replace('extract:', ''))
          if (!extractIds.has(id)) continue
          openInvoiceSettled.set(a.docKey, (openInvoiceSettled.get(a.docKey) ?? 0) + a.appliedMinor)
        }
      }
    }

    const src: AnalyticalProjectSource = {
      project: {
        code: selected.code, nameAr: selected.nameAr, clientName: selected.clientName,
        status: selected.status === 'active' ? 'جارٍ التنفيذ' : selected.status === 'completed' ? 'مكتمل' : 'مُسلَّم',
        startDate: selected.startDate, contractValueMinor: selected.contractValueMinor,
      },
      changeOrdersApprovedMinor: orders.reduce((s, o) => s + o.amountMinor, 0),
      extracts: extracts.map((e) => ({
        extractNumber: e.extractNumber, date: e.date, grossMinor: e.totals.grossMinor,
        vatMinor: e.totals.vatMinor, retentionMinor: e.totals.retentionMinor, dueMinor: e.totals.dueMinor,
        payment: e.payment, advanceRecoveryMinor: e.advanceRecoveryMinor ?? 0,
      })),
      expenses: costs.map((c) => ({
        date: c.date, docNumber: c.expenseNumber ?? `#${c.id}`,
        description: c.description,
        party: c.supplierId != null ? suppliers.find((s) => s.id === c.supplierId)?.nameAr ?? undefined : undefined,
        category: c.kind, amountMinor: c.amountMinor,
      })),
      openInvoiceSettled,
      extractDocKeys,
      vouchers: selected.clientId == null ? [] : vouchers
        .filter((v) => v.kind === 'receipt' && v.partyKind === 'customer' && v.partyId === selected.clientId)
        .map((v) => ({
          date: v.date, number: v.voucherNumber, description: v.description,
          amountMinor: v.amountMinor, reversed: !!v.reversalEntryId,
        })),
      clientSettlements: selected.clientId == null ? [] : clientSettlements
        .filter((st) => st.customerId === selected.clientId)
        .map((st) => ({ date: st.date, number: st.settlementNumber, amountMinor: st.amountMinor, allocations: st.allocations })),
      cheques: selected.clientId == null ? [] : cheques
        .filter((c) => c.direction === 'incoming' && c.partyId === selected.clientId)
        .map((c) => ({
          direction: c.direction, partyId: c.partyId, status: c.status, amountMinor: c.amountMinor,
          chequeNumber: c.chequeNumber, bankName: c.bankName, createdAt: c.createdAt, settledAt: c.settledAt,
        })),
      currencySymbol: cur.symbol,
      companyName: setup.shopName || 'المنشأة',
      printedBy: undefined,
      period: `حتى ${todayLocalIso()}`,
      fmt,
    }
    return buildAnalyticalProjectReport(src)
  }, [selected, projectExtracts, projectCosts, changeOrders, suppliers, clientSettlements, vouchers, cheques, getOpenClientInvoices, cur.symbol, setup.shopName, fmt])

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
