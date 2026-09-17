/**
 * مرتجعات المبيعات — معالج مراحل بالنمط العالمي (Shopify POS / Lightspeed / Square):
 * ① اختر الفاتورة الأصلية ← ② حدد البنود سطراً بسطر (كمية + حالة سليم/تالف + سبب موحد)
 * ← ③ اختر طريقة الرد (نقدي درج/بنك، خصم من الحساب، رصيد للعميل، أو تحويل لاستبدال)
 * ← ④ مراجعة وتأكيد: ملخص المبالغ وتوزيع الرد قبل الترحيل.
 * المحاسبة: قيد عاكس متوازن — التالف يذهب لبند الهالك 5111 ولا يدخل المخزون.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, Search, BookOpenText, Eye, Printer, ChevronRight, ChevronLeft, Repeat } from 'lucide-react'
import { useDataStore, type SaleInvoice, type SaleReturn } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { remainingByLine, returnCashRefundMinor, allocationOf, validateRefundAllocation, RETURN_REASONS, returnReasonName, type ReturnLineSpec, type ReturnCondition, type RefundAllocation } from '../../core/returns.ts'
import { computeTotals } from '../../core/pos.ts'
import { deriveTaxConfig } from '../../core/returns.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

/** حالة سطر واحد في المعالج */
interface WizardLine {
  qty: string
  condition: ReturnCondition
}

const STEPS = ['الفاتورة', 'البنود', 'طريقة الرد', 'مراجعة وتأكيد'] as const

export function SaleReturnsPage() {
  const { sales, saleReturns, customers, journal, treasuries, postSaleReturn, clientSettlements } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* ─── حالة المعالج ─── */
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [pickQuery, setPickQuery] = useState('')
  const [sale, setSale] = useState<SaleInvoice | null>(null)
  const [wiz, setWiz] = useState<Record<number, WizardLine>>({}) // بمفتاح فهرس السطر
  const [refund, setRefund] = useState<'cash' | 'credit' | 'store_credit' | 'custom'>('cash')
  const [refundTreasury, setRefundTreasury] = useState('')
  /** التوزيع الحر الرباعي (refund='custom') — نصوص المبالغ كما يكتبها المستخدم */
  const [customCash, setCustomCash] = useState('')
  const [customCredit, setCustomCredit] = useState('')
  const [customStore, setCustomStore] = useState('')
  const [customWaived, setCustomWaived] = useState('')
  const [reasonCode, setReasonCode] = useState('changed_mind')
  const [reason, setReason] = useState('')
  const [viewing, setViewing] = useState<SaleReturn | null>(null)

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  /** المتبقي القابل للإرجاع لكل سطر من الفاتورة المختارة */
  const remaining = useMemo(() => {
    if (!sale) return [] as number[]
    const prior = saleReturns.filter((r) => r.saleId === sale.id).flatMap((r) => r.lines)
    return remainingByLine(sale.lines, prior)
  }, [sale, saleReturns])

  const pickable = useMemo(() => {
    const q = pickQuery.trim()
    return [...sales].reverse().filter((s) => !q || s.invoiceNumber.includes(q) || (s.refCode ?? '').includes(q.toUpperCase())).slice(0, 20)
  }, [sales, pickQuery])

  const resetWizard = () => {
    setStep(0); setSale(null); setWiz({}); setRefund('cash'); setRefundTreasury('')
    setCustomCash(''); setCustomCredit(''); setCustomStore(''); setCustomWaived('')
    setReasonCode('changed_mind'); setReason(''); setPickQuery('')
  }
  const openWizard = () => { resetWizard(); setWizardOpen(true) }
  const closeWizard = () => { setWizardOpen(false); resetWizard() }

  const startWithSale = (s: SaleInvoice) => {
    setSale(s)
    setWiz({})
    setRefund(s.customerId ? 'credit' : 'cash')
    setRefundTreasury('') // فارغ = خزينة البيع الأصلية
    setStep(1)
  }

  /* ─── مواصفات السطور المختارة ─── */
  const specs: ReturnLineSpec[] = useMemo(() => {
    if (!sale) return []
    const out: ReturnLineSpec[] = []
    for (const [idxStr, w] of Object.entries(wiz)) {
      const idx = Number(idxStr)
      const q = Number(w.qty)
      if (q > 0) out.push({ lineIndex: idx, qty: q, condition: w.condition })
    }
    return out
  }, [sale, wiz])

  /** أخطاء المرحلة 2 (تجاوز المتبقي) — تُعرض فوراً */
  const lineErrors = useMemo(() => {
    if (!sale) return []
    const errs: string[] = []
    for (const s of specs) {
      const can = remaining[s.lineIndex] ?? 0
      if (s.qty > can + 1e-9) errs.push(`«${sale.lines[s.lineIndex].nameAr}»: المطلوب ${s.qty} والمتبقي ${can}`)
    }
    return errs
  }, [sale, specs, remaining])

  /** معاينة الإجماليات والرد الهجين (نفس منطق النواة تماماً — للعرض قبل التأكيد) */
  const preview = useMemo(() => {
    if (!sale || !specs.length || lineErrors.length) return null
    try {
      const lines = specs.map((s) => ({ ...sale.lines[s.lineIndex], qty: s.qty }))
      const { taxPercent, taxInclusive } = sale.taxPercent !== undefined
        ? { taxPercent: sale.taxPercent, taxInclusive: sale.taxInclusive ?? true }
        : deriveTaxConfig(sale.totals)
      const totals = computeTotals(lines, sale.invoiceDiscountPercent, taxPercent, taxInclusive)
      const paidAtSale = sale.paidMinor ?? (sale.payment === 'cash' ? sale.totals.totalMinor : 0)
      const priorReturns = saleReturns.filter((r) => r.saleId === sale.id)
      const priorCredit = priorReturns.reduce((a, r) => a + (r.creditRefundMinor ?? (r.refund === 'credit' ? r.totals.totalMinor : 0)), 0)
      const priorCash = priorReturns.reduce((a, r) => a + returnCashRefundMinor(r), 0)
      const settled = clientSettlements.reduce(
        (a, st) => a + st.allocations.filter((al) => al.docKey === `sale:${sale.id}`).reduce((b, al) => b + al.appliedMinor, 0), 0)
      const openCredit = sale.totals.totalMinor - paidAtSale - priorCredit - settled
      const received = paidAtSale + settled - priorCash
      // التوزيع الرباعي: تلقائي حسب نمط الرد، أو يدوي حر (custom) مع أخطائه المفصلة.
      // تحويل آمن: مدخل غير رقمي لا يرمي (وإلا اختفت اللوحة كلها) — يُعدّ صفراً بخطأ واضح
      const safeMinor = (s: string): number | null => { try { return toMinor(s || '0', cur.decimals) } catch { return null } }
      let alloc: RefundAllocation
      let allocErrors: string[] = []
      if (refund === 'custom') {
        const vals = [safeMinor(customCash), safeMinor(customCredit), safeMinor(customStore), safeMinor(customWaived)]
        const bad = vals.some((v) => v === null)
        alloc = {
          cashMinor: vals[0] ?? 0,
          creditMinor: vals[1] ?? 0,
          storeCreditMinor: vals[2] ?? 0,
          waivedMinor: vals[3] ?? 0,
        }
        allocErrors = bad
          ? ['أحد المبالغ غير رقمي — صحّحه أولاً']
          : validateRefundAllocation(totals.totalMinor, alloc, openCredit, received, sale.customerId !== null)
      } else {
        alloc = allocationOf(totals.totalMinor, refund, openCredit, received)
      }
      const damagedCost = specs.filter((s) => s.condition === 'damaged')
        .reduce((a, s) => a + Math.round(s.qty * sale.lines[s.lineIndex].unitCostMinor), 0)
      return { totals, alloc, allocErrors, damagedCost, openCredit: Math.max(0, openCredit), received: Math.max(0, received) }
    } catch { return null }
  }, [sale, specs, lineErrors, refund, saleReturns, clientSettlements, customCash, customCredit, customStore, customWaived, cur.decimals])

  const approval = useSupervisorApproval()
  const submit = () => {
    if (!sale || !specs.length || !preview || preview.allocErrors.length > 0) return
    approval.request((approvedBy) => {
      try {
        const ret = postSaleReturn({
          saleId: sale.id,
          lineSpecs: specs,
          refund,
          ...(refund === 'custom' && preview ? { allocation: preview.alloc } : {}),
          reason: reason.trim() || returnReasonName(reasonCode),
          reasonCode,
          treasury: refundTreasury || undefined,
          approvedBy,
        })
        toast.show(`تم المرتجع ${ret.returnNumber} — تولد القيد العاكس ✓${approvedBy ? ` (اعتمده «${approvedBy}»)` : ''}${ret.crossShiftNote ? ` — ${ret.crossShiftNote}` : ''}`)
        closeWizard()
        setViewing(ret)
      } catch (e) {
        toast.show((e as Error).message, 'error')
      }
    })
  }

  /** طباعة إشعار المرتجع للعميل */
  const printReturn = (r: SaleReturn) => {
    const orig = sales.find((s) => s.id === r.saleId)
    const model = buildReceiptModel({
      invoiceNumber: r.returnNumber,
      refCode: r.refCode,
      dateIso: r.date,
      lines: r.lines,
      totals: r.totals,
      payment: r.refund === 'cash' ? 'cash' : 'credit',
      paidMinor: r.refund === 'cash' ? r.totals.totalMinor : 0,
      customerName: orig?.customerId ? customers.find((c) => c.id === orig.customerId)?.nameAr ?? null : null,
      taxPercent: setup.vatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
    model.docTitle = 'مرتجع مبيعات'
    model.paidMinor = r.totals.totalMinor
    model.remainingMinor = 0
    const cashPart = returnCashRefundMinor(r)
    const waivedPart = r.waivedRefundMinor ?? 0
    const creditPart = r.totals.totalMinor - cashPart - waivedPart
    const partsLabels: string[] = []
    if (cashPart > 0) partsLabels.push(`رد نقدي ${fmt(cashPart)}`)
    if (creditPart > 0) partsLabels.push((r.storeCreditRefundMinor ?? 0) >= creditPart ? `رصيد في الحساب ${fmt(creditPart)}` : `خصم من الحساب ${fmt(creditPart)}`)
    if (waivedPart > 0) partsLabels.push(`تنازل ${fmt(waivedPart)}`)
    model.paymentLabel = partsLabels.length > 1
      ? partsLabels.join(' + ')
      : cashPart > 0 ? 'رد نقدي'
      : waivedPart > 0 ? 'تنازل — بلا رد'
      : r.refund === 'store_credit' ? 'إيداع رصيداً في حساب العميل' : 'خصم من حساب العميل'
    printHtml(receipt.defaultTemplate === 'a4' ? renderInvoiceA4Html(model, cur, receipt) : renderReceiptHtml(model, cur, receipt))
    toast.show(`أُرسل إشعار المرتجع ${r.returnNumber} للطباعة 🖨️`)
  }

  const canNext =
    step === 0 ? sale !== null
    : step === 1 ? specs.length > 0 && lineErrors.length === 0
    : step === 2 ? (refund !== 'custom' || (preview !== null && preview.allocErrors.length === 0))
    : false

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up">
        <div className="text-sm text-slate-500">
          معالج مرتجع بمراحل: فاتورة ← بنود بحالتها ← طريقة الرد ← مراجعة — بنفس أسعار البيع الأصلي
        </div>
        <Btn onClick={openWizard} disabled={sales.length === 0}>
          <RotateCcw size={15} /> مرتجع جديد
        </Btn>
      </div>

      {saleReturns.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="↩️" title="لا مرتجعات بعد" sub={sales.length ? 'اضغط «مرتجع جديد» وابدأ المعالج' : 'لا فواتير مبيعات أصلاً — المرتجع دائماً عن فاتورة'} />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">المرتجع</th>
                <th className="px-4 py-3 font-bold">عن الفاتورة</th>
                <th className="px-4 py-3 font-bold">السبب</th>
                <th className="px-4 py-3 font-bold">الاسترداد</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {[...saleReturns].reverse().map((r, i) => {
                const orig = sales.find((s) => s.id === r.saleId)
                const hasDamaged = r.lines.some((l) => l.condition === 'damaged')
                return (
                  <tr key={r.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{r.returnNumber}</div>
                      <div className="text-[11px] text-slate-400">{r.date.slice(0, 16).replace('T', ' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig?.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-slate-500">{r.reasonCode ? returnReasonName(r.reasonCode) : (r.reason || '—')}</span>
                      {hasDamaged && <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">🗑️ تالف</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const cash = returnCashRefundMinor(r)
                        const waived = r.waivedRefundMinor ?? 0
                        const credit = r.totals.totalMinor - cash - waived
                        const many: string[] = []
                        if (cash > 0) many.push(`💵 ${fmt(cash)}`)
                        if (credit > 0) many.push(`👥 ${fmt(credit)}`)
                        if (waived > 0) many.push(`🤝 ${fmt(waived)}`)
                        const label = many.length > 1 ? many.join(' + ')
                          : cash > 0 ? '💵 نقدي'
                          : waived > 0 ? '🤝 تنازل — بلا رد'
                          : r.refund === 'store_credit' ? '🏦 رصيد في حسابه' : '👥 خصم من حساب العميل'
                        return (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${credit === 0 ? 'bg-emerald-500/10 text-emerald-600' : cash === 0 ? 'bg-violet-500/10 text-violet-600' : 'bg-amber-500/10 text-amber-600'}`}>
                            {label}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 font-black text-rose-500">-{fmt(r.totals.totalMinor)}</td>
                    <td className="px-4 py-3 text-left">
                      <span className="flex items-center gap-1 justify-end">
                        <button title="طباعة إشعار المرتجع للعميل" onClick={() => printReturn(r)} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110">
                          <Printer size={15} />
                        </button>
                        <button title="تفاصيل المرتجع وقيده" onClick={() => setViewing(r)} className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110">
                          <Eye size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── معالج المرتجع ─── */}
      <Modal open={wizardOpen} onClose={closeWizard} title={sale ? `مرتجع عن ${sale.invoiceNumber}` : 'مرتجع جديد'} wide>
        <div className="space-y-4">
          {/* شريط المراحل */}
          <div className="flex items-center gap-1">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1 flex-1">
                <button
                  onClick={() => { if (i < step) setStep(i) }}
                  className={`flex items-center gap-1.5 w-full justify-center py-2 rounded-xl text-[11.5px] font-bold transition-all ${
                    i === step ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                    : i < step ? 'bg-rose-500/10 text-rose-600 cursor-pointer hover:bg-rose-500/20'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  <span className={`w-4.5 h-4.5 rounded-full grid place-items-center text-[10px] ${i === step ? 'bg-white/20' : ''}`}>{i < step ? '✓' : i + 1}</span>
                  {label}
                </button>
                {i < STEPS.length - 1 && <ChevronLeft size={13} className="text-slate-300 shrink-0" />}
              </div>
            ))}
          </div>

          {/* ① اختيار الفاتورة */}
          {step === 0 && (
            <div className="space-y-3 anim-pop">
              <div className="relative">
                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="رقم الفاتورة S-0001 أو الكود المرجعي…" className={`${inputCls} pr-9`} autoFocus />
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {pickable.map((s) => (
                  <button key={s.id} onClick={() => startWithSale(s)} className={`w-full text-right px-3 py-2.5 transition-colors flex items-center justify-between gap-2 ${sale?.id === s.id ? 'bg-rose-500/10' : 'hover:bg-rose-500/5'}`}>
                    <span>
                      <b className="text-slate-800 dark:text-white">{s.invoiceNumber}</b>
                      {s.refCode && <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 mr-2" dir="ltr">{s.refCode}</span>}
                      <span className="text-[11px] text-slate-400 mr-2">{s.date.slice(0, 10)} · {s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr : 'عميل نقدي'}</span>
                    </span>
                    <b className="text-emerald-600">{fmt(s.totals.totalMinor)}</b>
                  </button>
                ))}
                {pickable.length === 0 && <div className="text-center text-sm text-slate-400 py-6">لا نتائج</div>}
              </div>
            </div>
          )}

          {/* ② البنود سطراً بسطر: كمية + حالة */}
          {step === 1 && sale && (
            <div className="space-y-3 anim-pop">
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                حدد <b>كل سطر</b> على حدة — يمكن إرجاع بند واحد فقط أو جزء من كميته. البضاعة
                <b className="text-emerald-600"> السليمة</b> تعود للمخزون؛ <b className="text-rose-500">التالفة</b> لا تدخل المخزون وتُقيَّد هالكاً (5111) تلقائياً.
              </p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">الصنف</th>
                    <th className="px-3 py-2">المباع</th>
                    <th className="px-3 py-2">سعر/خصم</th>
                    <th className="px-3 py-2">المتبقي</th>
                    <th className="px-3 py-2 w-24">كمية الإرجاع</th>
                    <th className="px-3 py-2 w-40">حالة البضاعة</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.lines.map((l, idx) => {
                    const rem = remaining[idx] ?? 0
                    const w = wiz[idx]
                    return (
                      <tr key={idx} className={`border-b border-slate-50 dark:border-slate-800/50 ${Number(w?.qty) > 0 ? 'bg-rose-500/[0.03]' : ''}`}>
                        <td className="px-3 py-2 text-slate-400 text-[11px]">{idx + 1}</td>
                        <td className="px-3 py-2 font-bold">
                          {l.soldByWeight && '⚖️ '}{l.nameAr}
                          {(l.variantColor || l.variantSize) && <span className="text-[10px] text-fuchsia-500 mr-1">({[l.variantColor, l.variantSize].filter(Boolean).join('/')})</span>}
                          {l.unitLabel && <span className="text-[10px] text-sky-500 mr-1">[{l.unitLabel}]</span>}
                        </td>
                        <td className="px-3 py-2">{l.qty}</td>
                        <td className="px-3 py-2 text-[11px] text-slate-500">{fmt(l.unitPriceMinor)}{l.discountPercent > 0 && <span className="text-rose-400"> −{l.discountPercent}٪</span>}</td>
                        <td className={`px-3 py-2 font-bold ${rem > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{rem}</td>
                        <td className="px-3 py-2">
                          <input
                            value={w?.qty ?? ''}
                            onChange={(e) => setWiz((prev) => ({ ...prev, [idx]: { qty: e.target.value, condition: prev[idx]?.condition ?? 'resellable' } }))}
                            placeholder="0"
                            disabled={rem <= 0}
                            className={`${inputCls} text-center py-1.5 disabled:opacity-40`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              onClick={() => setWiz((prev) => ({ ...prev, [idx]: { qty: prev[idx]?.qty ?? '', condition: 'resellable' } }))}
                              disabled={rem <= 0}
                              className={`flex-1 px-1.5 py-1.5 rounded-lg text-[10.5px] font-bold border transition-all disabled:opacity-30 ${(w?.condition ?? 'resellable') === 'resellable' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                            >✅ سليم</button>
                            <button
                              onClick={() => setWiz((prev) => ({ ...prev, [idx]: { qty: prev[idx]?.qty ?? '', condition: 'damaged' } }))}
                              disabled={rem <= 0}
                              className={`flex-1 px-1.5 py-1.5 rounded-lg text-[10.5px] font-bold border transition-all disabled:opacity-30 ${w?.condition === 'damaged' ? 'border-rose-500/50 bg-rose-500/10 text-rose-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                            >🗑️ تالف</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {lineErrors.length > 0 && (
                <div className="text-[11.5px] text-rose-500 font-bold p-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-0.5">
                  {lineErrors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                </div>
              )}
              {/* سبب الإرجاع الموحد + نص حر */}
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={reasonCode}
                  onChange={(e) => {
                    setReasonCode(e.target.value)
                    // السبب التالف يقترح حالة تالف على السطور المختارة (يبقى قابلاً للتعديل)
                    const def = RETURN_REASONS.find((r) => r.id === e.target.value)?.defaultCondition
                    if (def) setWiz((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, Number(v.qty) > 0 ? { ...v, condition: def } : v])))
                  }}
                  className={inputCls}
                >
                  {RETURN_REASONS.map((r) => <option key={r.id} value={r.id}>{r.nameAr}</option>)}
                </select>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="تفاصيل إضافية (اختياري)…" className={inputCls} />
              </div>
            </div>
          )}

          {/* ③ طريقة الرد */}
          {step === 2 && sale && (
            <div className="space-y-3 anim-pop">
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setRefund('cash')}
                  className={`p-3 rounded-2xl border-2 font-bold text-[12.5px] transition-all ${refund === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >💵 رد نقدي / تحويل بنكي</button>
                <button
                  onClick={() => setRefund('credit')}
                  disabled={!sale.customerId}
                  title="يطفئ دين الفاتورة المفتوح أولاً — لو تجاوز المرتجع الدين يُرد الفائض نقداً تلقائياً"
                  className={`p-3 rounded-2xl border-2 font-bold text-[12.5px] transition-all disabled:opacity-40 ${refund === 'credit' ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >👥 خصم من حساب العميل {!sale.customerId && '(عميل نقدي)'}</button>
                <button
                  onClick={() => setRefund('store_credit')}
                  disabled={!sale.customerId}
                  title="لا نقدية تخرج: كامل القيمة تودع رصيداً دائناً في حساب العميل يُخصم من فواتيره القادمة (Store Credit)"
                  className={`p-3 rounded-2xl border-2 font-bold text-[12.5px] transition-all disabled:opacity-40 ${refund === 'store_credit' ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >🏦 إيداع رصيداً في حسابه {!sale.customerId && '(عميل نقدي)'}</button>
                <button
                  onClick={() => setRefund('custom')}
                  title="حرية كاملة: وزّع قيمة المرتجع يدوياً بين نقدي وخصم ذمم ورصيد عميل وتنازل (مرتجع بلا رد) — بأي مزيج"
                  className={`p-3 rounded-2xl border-2 font-bold text-[12.5px] transition-all ${refund === 'custom' ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >🎛️ توزيع حر / بلا رد</button>
              </div>

              {refund === 'custom' && preview && (
                <div className="p-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] space-y-2">
                  <div className="text-[11.5px] font-bold text-amber-700 dark:text-amber-400">
                    وزّع قيمة المرتجع {fmt(preview.totals.totalMinor)} بحرية — المجموع يجب أن يساويها بالضبط
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10.5px] text-emerald-600 font-bold">💵 نقدي يخرج فعلاً (بسقف المحصَّل {fmt(preview.received)})</span>
                      <input value={customCash} onChange={(e) => setCustomCash(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10.5px] text-violet-600 font-bold">👥 خصم من دين الفاتورة (بسقف المفتوح {fmt(preview.openCredit)})</span>
                      <input value={customCredit} onChange={(e) => setCustomCredit(e.target.value)} inputMode="decimal" placeholder="0" disabled={!sale.customerId} className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10.5px] text-sky-600 font-bold">🏦 رصيد في حساب العميل (بلا سقف)</span>
                      <input value={customStore} onChange={(e) => setCustomStore(e.target.value)} inputMode="decimal" placeholder="0" disabled={!sale.customerId} className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10.5px] text-slate-500 font-bold">🤝 تنازل — العميل لا يريد رداً (إيرادات أخرى 4110)</span>
                      <input value={customWaived} onChange={(e) => setCustomWaived(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      onClick={() => { setCustomCash(''); setCustomCredit(''); setCustomStore(''); setCustomWaived(String(preview.totals.totalMinor / 10 ** cur.decimals)) }}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >مرتجع بلا رد — كله تنازلاً</button>
                    <button
                      onClick={() => {
                        const cash = Math.min(preview.totals.totalMinor, preview.received)
                        setCustomCash(String(cash / 10 ** cur.decimals)); setCustomCredit('')
                        setCustomStore(sale.customerId ? String((preview.totals.totalMinor - cash) / 10 ** cur.decimals) : '')
                        setCustomWaived(sale.customerId ? '' : String((preview.totals.totalMinor - cash) / 10 ** cur.decimals))
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >أقصى نقدي والباقي {sale.customerId ? 'رصيداً' : 'تنازلاً'}</button>
                    {sale.customerId != null && (
                      <button
                        onClick={() => {
                          const credit = Math.min(preview.totals.totalMinor, preview.openCredit)
                          setCustomCredit(String(credit / 10 ** cur.decimals)); setCustomCash('')
                          setCustomStore(String((preview.totals.totalMinor - credit) / 10 ** cur.decimals)); setCustomWaived('')
                        }}
                        className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                      >إطفاء الدين والباقي رصيداً</button>
                    )}
                  </div>
                  {(() => {
                    const sum = preview.alloc.cashMinor + preview.alloc.creditMinor + preview.alloc.storeCreditMinor + preview.alloc.waivedMinor
                    const diff = preview.totals.totalMinor - sum
                    return diff !== 0 ? (
                      <p className="text-[11px] font-bold text-rose-500">المجموع الموزع {fmt(sum)} — {diff > 0 ? `تبقى ${fmt(diff)} بلا وجهة` : `زيادة ${fmt(-diff)} عن قيمة المرتجع`}</p>
                    ) : <p className="text-[11px] font-bold text-emerald-600">✓ التوزيع مكتمل ومطابق لقيمة المرتجع</p>
                  })()}
                  {preview.allocErrors.map((e, i) => (
                    <p key={i} className="text-[11px] font-bold text-rose-500">⚠️ {e}</p>
                  ))}
                  {preview.alloc.cashMinor > 0 && (
                    <div className="pt-1 space-y-1.5">
                      <div className="text-[10.5px] font-bold text-slate-500">وجهة الجزء النقدي:</div>
                      <TreasuryPicker value={refundTreasury || (sale.treasury ?? '1101')} onChange={setRefundTreasury} compact />
                    </div>
                  )}
                </div>
              )}

              {refund === 'cash' && (
                <div className="p-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] space-y-2">
                  <div className="text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400">وجهة الرد: درج نقدي أو بنك/محفظة (تحويل للعميل)</div>
                  <TreasuryPicker value={refundTreasury || (sale.treasury ?? '1101')} onChange={setRefundTreasury} compact />
                  <p className="text-[10.5px] text-slate-400">الافتراضي: نفس خزينة البيع الأصلية «{treasuries.find((t) => t.code === (sale.treasury ?? '1101'))?.nameAr ?? 'الخزينة الرئيسية'}» — اختر بنكاً لو الرد تحويلاً.</p>
                </div>
              )}
              {refund === 'store_credit' && (
                <p className="text-[11.5px] text-sky-600 dark:text-sky-400 p-2.5 rounded-xl bg-sky-500/5 border border-sky-500/20 leading-relaxed">
                  🏦 لا يخرج مال من الخزينة: قيمة المرتجع كلها تُقيَّد دائنة في حساب العميل — تطفئ دينه إن وُجد، وما زاد يبقى رصيداً له يُخصم تلقائياً من مشترياته القادمة.
                </p>
              )}

              {/* بديل رابع: استبدال بدل الرد */}
              <button
                onClick={() => { closeWizard(); navigate('/sales/exchange') }}
                className="w-full p-3 rounded-2xl border-2 border-dashed border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-400 font-bold text-[12.5px] hover:bg-fuchsia-500/5 transition-all flex items-center justify-center gap-2"
              >
                <Repeat size={15} /> العميل يريد استبدالاً لا استرداداً؟ → افتح شاشة الاستبدال (مرتجع + بيع جديد بمستند واحد)
              </button>
            </div>
          )}

          {/* ④ مراجعة وتأكيد */}
          {step === 3 && sale && preview && (
            <div className="space-y-3 anim-pop">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-slate-500 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">البنود المرتجعة</div>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {specs.map((s) => {
                      const l = sale.lines[s.lineIndex]
                      return (
                        <tr key={s.lineIndex} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-4 py-2 font-bold">{l.nameAr}</td>
                          <td className="px-4 py-2">{s.qty} × {fmt(l.unitPriceMinor)}{l.discountPercent > 0 && ` −${l.discountPercent}٪`}</td>
                          <td className="px-4 py-2">
                            {s.condition === 'damaged'
                              ? <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">🗑️ تالف → هالك 5111</span>
                              : <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">✅ يعود للمخزون</span>}
                          </td>
                          <td className="px-4 py-2 font-bold text-left">{fmt(Math.round(l.unitPriceMinor * s.qty * (1 - l.discountPercent / 100)))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 space-y-1.5">
                  <div className="flex justify-between"><span className="text-slate-400">قيمة المرتجع (شامل الضريبة)</span><b>{fmt(preview.totals.totalMinor)}</b></div>
                  {preview.totals.taxMinor > 0 && <div className="flex justify-between"><span className="text-slate-400">منها ض.ق.م تُعكس</span><b>{fmt(preview.totals.taxMinor)}</b></div>}
                  {preview.damagedCost > 0 && <div className="flex justify-between text-rose-500"><span>تكلفة التالف → هالك</span><b>{fmt(preview.damagedCost)}</b></div>}
                  <div className="flex justify-between"><span className="text-slate-400">السبب</span><b>{returnReasonName(reasonCode)}</b></div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-500 mb-1">توزيع الرد الفعلي</div>
                  {preview.alloc.cashMinor > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>💵 يخرج نقداً/تحويلاً من {treasuries.find((t) => t.code === (refundTreasury || sale.treasury || '1101'))?.nameAr ?? 'الخزينة'}</span><b>{fmt(preview.alloc.cashMinor)}</b></div>
                  )}
                  {preview.alloc.creditMinor > 0 && (
                    <div className="flex justify-between text-violet-600"><span>👥 يخفض دين العميل</span><b>{fmt(preview.alloc.creditMinor)}</b></div>
                  )}
                  {preview.alloc.storeCreditMinor > 0 && (
                    <div className="flex justify-between text-sky-600"><span>🏦 يودع رصيداً في حسابه</span><b>{fmt(preview.alloc.storeCreditMinor)}</b></div>
                  )}
                  {preview.alloc.waivedMinor > 0 && (
                    <div className="flex justify-between text-slate-500"><span>🤝 تنازل العميل (إيرادات أخرى)</span><b>{fmt(preview.alloc.waivedMinor)}</b></div>
                  )}
                  {refund !== 'store_credit' && refund !== 'custom' && preview.alloc.cashMinor > 0 && preview.alloc.creditMinor > 0 && (
                    <p className="text-[10.5px] text-amber-600 leading-relaxed">رد هجين تلقائي: لا نرد نقداً أكثر من المحصَّل فعلاً ولا نخفض ديناً أكثر من المفتوح.</p>
                  )}
                </div>
              </div>

              {approval.willAskPin && (
                <p className="text-[11.5px] text-amber-600 dark:text-amber-400 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 leading-relaxed">
                  🔐 سيُطلب رقم مشرف الكاشير أو المالك لاعتماد هذا المرتجع.
                </p>
              )}
            </div>
          )}
          {step === 3 && sale && !preview && (
            <p className="text-[12px] text-rose-500 font-bold">تعذر حساب المعاينة — راجع الكميات في مرحلة البنود.</p>
          )}

          {/* أزرار التنقل */}
          <div className="flex justify-between pt-1">
            <Btn variant="ghost" onClick={() => (step === 0 ? closeWizard() : setStep(step - 1))}>
              <ChevronRight size={14} /> {step === 0 ? 'إلغاء' : 'السابق'}
            </Btn>
            {step < 3 ? (
              <Btn onClick={() => setStep(step + 1)} disabled={!canNext}>
                التالي <ChevronLeft size={14} />
              </Btn>
            ) : (
              <Btn onClick={submit} disabled={!preview}>↩️ تأكيد وترحيل المرتجع</Btn>
            )}
          </div>
        </div>
      </Modal>
      {approval.dialog}

      {/* عرض مرتجع */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `المرتجع ${viewing.returnNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">الحالة</th><th className="px-3 py-2">سعر</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2 text-[11px]">{l.condition === 'damaged' ? <span className="text-rose-500 font-bold">🗑️ تالف</span> : <span className="text-emerald-600">✅ سليم</span>}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[12px] text-slate-500">
              السبب: <b>{viewing.reasonCode ? returnReasonName(viewing.reasonCode) : ''}</b>{viewing.reason && viewing.reason !== returnReasonName(viewing.reasonCode ?? '') ? ` — ${viewing.reason}` : ''}
            </div>
            {viewing.approvedBy && (
              <div className="text-[12px] text-slate-500">
                🔐 نفّذه: <b>{viewing.requestedBy ?? '—'}</b>
                {viewing.approvedBy !== viewing.requestedBy && <> — اعتمده: <b className="text-amber-600">{viewing.approvedBy}</b></>}
              </div>
            )}
            {viewing.crossShiftNote && (
              <div className="text-[11.5px] text-amber-600 dark:text-amber-400 p-2 rounded-xl bg-amber-500/5 border border-amber-500/20">⏱️ {viewing.crossShiftNote}</div>
            )}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد العاكس #{entry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                          {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                        </td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end">
              <Btn variant="ghost" onClick={() => printReturn(viewing)}><Printer size={14} /> طباعة إشعار المرتجع</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
