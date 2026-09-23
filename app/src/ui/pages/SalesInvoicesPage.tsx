/**
 * فواتير المبيعات — كل فاتورة مربوطة بقيدها (اضغط لعرض القيد) + طباعة الإيصال
 * + تعديل الفاتورة (طلب المالك): متاح فقط عندما تكون الفاتورة الإلكترونية غير مفعلة —
 *   التعديل يعكس القيد القديم ويولد قيداً جديداً فلا يفسد الدفتر أبداً.
 *   مع تفعيلها: يظهر بدلاً منه زرا «إشعار دائن» (مرتجع) و«إشعار مدين» (فاتورة إضافية).
 */
import { useMemo, useState } from 'react'
import { Eye, BookOpenText, Printer, FileText, Pencil, FileMinus2, FilePlus2, Trash2, History, HandCoins } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDataStore, type SaleInvoice } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { computeTotals, CreditLimitError, type CartLine } from '../../core/pos.ts'
import { effectiveVatPercent } from '../../core/items.ts'
import { deriveTaxConfig } from '../../core/returns.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { maybeZatcaQr } from '../print/zatcaQr.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { invoiceEditPolicy, electronicInvoiceLockActive, saleEditBlocks } from '../../core/invoiceEdit.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { Modal, EmptyState, useToast, inputCls, Btn, Field } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { normalizeRefQuery } from '../../core/refcode.ts'

export function SalesInvoicesPage() {
  const { sales, customers, journal, items, saleReturns, serials, installmentPlans, clientSettlements, shifts, advancedInvoiceDrafts, deleteAdvancedInvoiceDraft, editSale, employees, staffCommissions, addStaffCommission } = useDataStore()
  const { setup, receipt, einvoice, activatedPayload, trialStartedAt, lastSeenAt } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const country = setup.countryCode ? getCountry(setup.countryCode) : null
  const cur = country?.currency || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const countryVatPercent = country?.vatPercent ?? setup.vatPercent
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [viewing, setViewing] = useState<SaleInvoice | null>(null)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  // سياسة التعديل (طلب المالك): الفاتورة الإلكترونية مفعلة بمفتاح المطور ⇒ لا تعديل — إشعارات فقط
  const lic = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() }),
    [activatedPayload, trialStartedAt, lastSeenAt],
  )
  const einvoiceActive = electronicInvoiceLockActive({ licensed: hasFeature(lic, 'einvoice_sa') || hasFeature(lic, 'einvoice_eg'), enabled: einvoice.enabled === true, taxNumber: einvoice.taxNumber })
  const policy = invoiceEditPolicy({ einvoiceActive })

  /* ─── حالة نافذة التعديل ─── */
  const [editing, setEditing] = useState<SaleInvoice | null>(null)
  const [editLines, setEditLines] = useState<CartLine[]>([])
  const [editCustomerId, setEditCustomerId] = useState<number | null>(null)
  const [editPaid, setEditPaid] = useState('')
  const [editTreasury, setEditTreasury] = useState('1101')
  const [editDiscount, setEditDiscount] = useState(0)
  const [editReason, setEditReason] = useState('')
  const [editAddItemId, setEditAddItemId] = useState(0)

  /* ─── عمولة موظف عن الفاتورة (تعميم — أمر المالك): مصروف مربوط بها ─── */
  const [commFor, setCommFor] = useState<SaleInvoice | null>(null)
  const [commEmpId, setCommEmpId] = useState('')
  const [commAmount, setCommAmount] = useState('')
  const saveInvoiceCommission = () => {
    if (!commFor || !commEmpId || !commAmount.trim()) return
    try {
      const c = addStaffCommission({
        employeeId: Number(commEmpId), source: 'sale', sourceId: commFor.id,
        description: `عمولة بيع — فاتورة ${commFor.invoiceNumber}`,
        amountMinor: toMinor(commAmount, cur.decimals),
      })
      toast.show(`استُحقت ${c.code} — مصروف مربوط بالفاتورة، تُصرف مع الراتب أو منفردة من شاشة الموظفين ✅`)
      setCommFor(null); setCommEmpId(''); setCommAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const blocksOf = (s: SaleInvoice) => saleEditBlocks({
    hasReturns: saleReturns.some((r) => r.saleId === s.id),
    hasSoldSerials: serials.some((u) => u.saleId === s.id && u.status === 'sold'),
    hasInstallmentPlan: installmentPlans.some((p) => p.saleId === s.id),
    hasSettlementAllocation: clientSettlements.some((st) => st.allocations.some((a) => a.docKey === `sale:${s.id}`)),
    shiftClosed: s.shiftId != null && shifts.some((sh) => sh.id === s.shiftId && sh.status === 'closed'),
  })

  // تعديل فاتورة مرحلة = عملية حساسة (نمط QuickBooks audit): يتطلب صلاحية
  // sales.price.edit أو اعتماد مشرف بالرقم السري — يوثق في سجل التدقيق
  const editApproval = useSupervisorApproval('sales.price.edit')
  // التعديل قد يرفع الجزء الآجل فوق حد ائتمان العميل — تجاوز باعتماد مدير (نفس نمط الكاشير)
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const openEdit = (s: SaleInvoice) => {
    const blocks = blocksOf(s)
    if (blocks.length) return toast.show(`لا يمكن تعديل ${s.invoiceNumber}: ${blocks[0]}`, 'error')
    editApproval.request((approvedBy) => {
      if (approvedBy) toast.show(`فُتح التعديل — اعتمده «${approvedBy}» ✓`)
      doOpenEdit(s)
    })
  }
  const doOpenEdit = (s: SaleInvoice) => {
    setEditing(s)
    setEditLines(s.lines.map((l) => ({ ...l })))
    setEditCustomerId(s.customerId)
    setEditPaid(String((s.paidMinor ?? (s.payment === 'cash' ? s.totals.totalMinor : 0)) / 10 ** cur.decimals))
    setEditTreasury(s.treasury ?? '1101')
    setEditDiscount(s.invoiceDiscountPercent)
    setEditReason('')
    setEditAddItemId(0)
  }

  // معاينة إجماليات التعديل بنفس المعاملة الضريبية الأصلية
  // G1: النسبة المخزنة على الفاتورة أولاً (تطابق ما سيحسبه editSale في repo تماماً)
  const editTotals = useMemo(() => {
    if (!editing || !editLines.length) return null
    const { taxPercent, taxInclusive } = editing.taxPercent !== undefined
      ? { taxPercent: editing.taxPercent, taxInclusive: editing.taxInclusive ?? true }
      : deriveTaxConfig(editing.totals)
    const base = computeTotals(editLines, editDiscount, taxPercent, taxInclusive)
    const charges = editing.customerCharges ?? []
    const chargeNet = charges.reduce((sum, charge) => sum + charge.amountMinor, 0)
    const chargeTax = charges.filter((charge) => charge.taxable).reduce((sum, charge) => sum + Math.round(charge.amountMinor * taxPercent / 100), 0)
    return { ...base, netMinor: base.netMinor + chargeNet, taxBaseMinor: base.taxBaseMinor + charges.filter((charge) => charge.taxable).reduce((sum, charge) => sum + charge.amountMinor, 0), taxMinor: base.taxMinor + chargeTax, totalMinor: base.totalMinor + chargeNet + chargeTax }
  }, [editing, editLines, editDiscount])

  const saveEdit = (creditLimitOverrideBy?: string) => {
    if (!editing || !editTotals) return
    try {
      const paidMinor = toMinor(editPaid || '0', cur.decimals)
      const payment = paidMinor >= editTotals.totalMinor ? 'cash' as const : 'credit' as const
      const updated = editSale({
        saleId: editing.id,
        lines: editLines,
        customerId: editCustomerId,
        payment,
        paidMinor: Math.min(paidMinor, editTotals.totalMinor),
        treasury: editTreasury,
        invoiceDiscountPercent: editDiscount,
        reason: editReason.trim(),
        einvoiceActive,
        allowNegativeStock: setup.allowNegativeStock,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      toast.show(`عُدلت ${updated.invoiceNumber} — عُكس قيدها القديم وتولد قيد جديد صحيح ✓`)
      setEditing(null)
    } catch (e) {
      // التعديل رفع آجل العميل فوق حده — اعتماد مدير بصلاحية sales.credit.override
      if (e instanceof CreditLimitError) {
        creditApproval.request((by) => saveEdit(by ?? 'المشرف'))
        return
      }
      toast.show((e as Error).message, 'error')
    }
  }
  // البحث بالمرجع/رقم الفاتورة — المرجعي يُطبع على الإيصال فيقرأه العميل بالهاتف
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return [...sales].reverse()
    const ref = normalizeRefQuery(q)
    return [...sales].reverse().filter((s) =>
      s.invoiceNumber.includes(q) || (s.refCode ?? '').includes(ref))
  }, [sales, query])

  const printInvoice = async (s: SaleInvoice, template: 'thermal' | 'a4' | 'a5') => {
    const licState = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    const qrDataUrl = await maybeZatcaQr({
      featureActive: einvoice.enabled === true && hasFeature(licState, 'einvoice_sa'),
      printEnabled: einvoice.printZatcaQr,
      sellerName: setup.shopName,
      vatNumber: einvoice.taxNumber,
      dateIso: s.date,
      totalMinor: s.totals.totalMinor,
      taxMinor: s.totals.taxMinor,
      decimals: cur.decimals,
    })
    const model = buildReceiptModel({
      invoiceNumber: s.invoiceNumber,
      refCode: s.refCode,
      dateIso: s.date,
      lines: [...s.lines, ...(s.customerCharges ?? []).map((charge, index) => ({ itemId: -(index + 1), nameAr: charge.nameAr, qty: 1, unitPriceMinor: charge.amountMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, vatPercentOverride: charge.taxable ? (s.taxPercent ?? countryVatPercent) : 0 }))],
      totals: s.totals,
      payment: s.payment,
      paidMinor: s.paidMinor, // الدفع المجزأ: المدفوع/المتبقي على المطبوعة (بلاغ المالك)
      customerName: s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? null : null,
      taxPercent: s.taxPercent ?? countryVatPercent,
      taxInclusive: s.taxInclusive ?? setup.taxInclusive,
      settings: receipt,
    })
    if (qrDataUrl) model.qrDataUrl = qrDataUrl
    if (s.customerReference || s.dueDate) model.footerText = `${s.customerReference ? `مرجع العميل: ${s.customerReference}` : ''}${s.customerReference && s.dueDate ? ' — ' : ''}${s.dueDate ? `الاستحقاق: ${s.dueDate}` : ''}${receipt.footerText ? ' — ' + receipt.footerText : ''}`
    printHtml(template === 'thermal' ? renderReceiptHtml(model, cur, receipt) : renderInvoiceA4Html(model, cur, receipt, template))
    toast.show(template === 'thermal' ? `أُرسل إيصال ${s.invoiceNumber} للطباعة 🖨️` : `أُرسلت فاتورة ${template.toUpperCase()} ${s.invoiceNumber} للطباعة 📄`)
  }

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  if (sales.length === 0) {
    return (
      <div className="space-y-4">{advancedInvoiceDrafts.filter(d=>d.kind==='sale').length>0&&<DraftBanner/>}<div className="flex justify-end"><Btn onClick={() => navigate('/sales/invoices/new')}><FilePlus2 size={16}/> فاتورة مبيعات جديدة</Btn></div><div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800"><EmptyState icon="🧾" title="لا فواتير مبيعات بعد" sub="أنشئ فاتورة متقدمة أو استخدم الكاشير للبيع السريع" /></div></div>
    )
  }

  function DraftBanner() {
    const drafts = advancedInvoiceDrafts.filter((draft) => draft.kind === 'sale').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!drafts.length) return null
    return <div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-3 flex flex-wrap items-center justify-between gap-2"><div><b>مسودات مبيعات محفوظة: {drafts.length}</b><div className="text-xs text-slate-500">الأحدث: {drafts[0].name} · {new Date(drafts[0].updatedAt).toLocaleString('ar-EG')}</div></div><div className="flex gap-2"><Btn variant="ghost" onClick={()=>navigate('/sales/invoices/new')}>الانتقال للمحرر</Btn><Btn variant="ghost" onClick={()=>{drafts.forEach(d=>deleteAdvancedInvoiceDraft(d.id));toast.show('حُذفت مسودات المبيعات')}}>حذف الكل</Btn></div></div>
  }

  const profitabilityOf = (sale: SaleInvoice) => {
    const cogs = sale.lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitCostMinor), 0)
    const internal = (sale.internalExpenses ?? []).filter((expense) => expense.affectsProfit).reduce((sum, expense) => sum + expense.amountMinor, 0)
    const commissions = staffCommissions.filter((commission) => commission.source === 'sale' && commission.sourceId === sale.id && commission.status !== 'cancelled').reduce((sum, commission) => sum + commission.amountMinor, 0)
    const returns = saleReturns.filter((ret) => ret.saleId === sale.id)
    const returnedRevenue = returns.reduce((sum, ret) => sum + ret.totals.netMinor, 0)
    const returnedCogs = returns.reduce((sum, ret) => sum + ret.totals.cogsMinor, 0)
    return { cogs: cogs - returnedCogs, internal, commissions, profit: sale.totals.netMinor - returnedRevenue - (cogs - returnedCogs) - internal - commissions }
  }

  return (
    <div className="space-y-4">
      <DraftBanner/>
      <div className="anim-up flex flex-wrap items-center gap-2">
        <Btn onClick={() => navigate('/sales/invoices/new')}><FilePlus2 size={16}/> فاتورة مبيعات جديدة</Btn>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔎 ابحث برقم الفاتورة أو مرجع التتبع (مثل SAL-260915-…)"
          className={inputCls + ' max-w-md'}
        />
        {query && <span className="text-[12px] text-slate-400">{filtered.length} نتيجة</span>}
      </div>
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">الفاتورة</th>
              <th className="px-4 py-3 font-bold">العميل</th>
              <th className="px-4 py-3 font-bold">الدفع</th>
              <th className="px-4 py-3 font-bold">الأصناف</th>
              <th className="px-4 py-3 font-bold">الإجمالي</th>
              <th className="px-4 py-3 font-bold">الاستحقاق</th>
              <th className="px-4 py-3 font-bold">الربحية الداخلية</th>
              <th className="px-4 py-3 font-bold">القيد</th>
              <th className="px-4 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-emerald-500/[0.04] transition-colors duration-150">
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-800 dark:text-white">{s.invoiceNumber}</div>
                  {s.refCode && <div className="text-[10px] font-mono text-sky-600 dark:text-sky-400" dir="ltr">{s.refCode}</div>}
                  <div className="text-[11px] text-slate-400">{s.date.slice(0, 16).replace('T', ' ')}</div>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? '—' : 'عميل نقدي'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${s.payment === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600'}`}>
                    {s.payment === 'cash' ? '💵 كاش' : '👥 آجل'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{s.lines.length}</td>
                <td className="px-4 py-3 font-black text-emerald-600 dark:text-emerald-400">{fmt(s.totals.totalMinor)}</td>
                <td className="px-4 py-3">{(s.paidMinor??0)>=s.totals.totalMinor?<span className="text-emerald-600 font-bold">محصلة</span>:s.dueDate?<span className={s.dueDate<today?'text-rose-600 font-bold':'text-amber-600'}>{s.dueDate<today?'متأخرة':s.dueDate}</span>:<span className="text-slate-400">غير محدد</span>}</td>
                <td className={`px-4 py-3 font-bold ${profitabilityOf(s).profit < 0 ? 'text-rose-600' : 'text-sky-600'}`} title={`تكلفة ${fmt(profitabilityOf(s).cogs)} · مصروف داخلي ${fmt(profitabilityOf(s).internal)} · عمولات ${fmt(profitabilityOf(s).commissions)}`}>{fmt(profitabilityOf(s).profit)}</td>
                <td className="px-4 py-3">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                    <BookOpenText size={11} /> قيد #{s.journalEntryId}
                  </span>
                </td>
                <td className="px-4 py-3 text-left whitespace-nowrap">
                  <button onClick={() => printInvoice(s, 'thermal')} title="طباعة إيصال حراري" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110">
                    <Printer size={15} />
                  </button>
                  <button onClick={() => printInvoice(s, 'a4')} title="طباعة فاتورة A4 احترافية" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all duration-200 hover:scale-110">
                    <FileText size={15} />
                  </button>
                  <button onClick={() => printInvoice(s, 'a5')} title="طباعة فاتورة A5 (نصف ورقة)" className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all duration-200 hover:scale-110 text-[10px] font-black leading-none">
                    A5
                  </button>
                  {policy.canEdit ? (
                    /* تعديل متاح — الفاتورة الإلكترونية غير مفعلة (سياسة المالك) */
                    <button onClick={() => openEdit(s)} title={policy.reasonAr} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200 hover:scale-110">
                      <Pencil size={15} />
                    </button>
                  ) : (
                    /* الفاتورة الإلكترونية مفعلة ⇒ إشعار دائن (مرتجع) / إشعار مدين (فاتورة إضافية) */
                    <>
                      <button onClick={() => navigate('/sales/returns')} title="إشعار دائن — الفاتورة الإلكترونية مفعلة فلا تعديل؛ التخفيض بمرتجع مبيعات رسمي" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110">
                        <FileMinus2 size={15} />
                      </button>
                      <button onClick={() => navigate('/pos')} title="إشعار مدين — الزيادة تكون بفاتورة إضافية جديدة مرتبطة بنفس العميل" className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all duration-200 hover:scale-110">
                        <FilePlus2 size={15} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setCommFor(s)}
                    title={staffCommissions.some((c) => c.source === 'sale' && c.sourceId === s.id && c.status !== 'cancelled') ? 'عليها عمولة موظف مستحقة — إدارتها من شاشة الموظفين' : 'استحقاق عمولة موظف عن هذه الفاتورة'}
                    className={`p-2 rounded-lg transition-all duration-200 hover:scale-110 ${staffCommissions.some((c) => c.source === 'sale' && c.sourceId === s.id && c.status !== 'cancelled') ? 'text-violet-500 bg-violet-500/10' : 'text-slate-400 hover:text-violet-600 hover:bg-violet-500/10'}`}
                  >
                    <HandCoins size={15} />
                  </button>
                  <button onClick={() => setViewing(s)} title="عرض الفاتورة وقيدها" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all duration-200 hover:scale-110">
                    <Eye size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `فاتورة ${viewing.invoiceNumber}${viewing.refCode ? ` — ${viewing.refCode}` : ''}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">سعر</th><th className="px-3 py-2">ضريبة</th><th className="px-3 py-2">خصم</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2 text-sky-600 font-bold">{(l.vatPercentOverride ?? viewing.taxPercent ?? countryVatPercent) > 0 ? `${l.vatPercentOverride ?? viewing.taxPercent ?? countryVatPercent}٪` : 'معفى'}</td>
                    <td className="px-3 py-2">{l.discountPercent ? `${l.discountPercent}٪` : '—'}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-4 text-[13px] font-bold flex-wrap">
              {(viewing.customerCharges ?? []).map((charge,index)=><span key={index}>{charge.nameAr}: <b>{fmt(charge.amountMinor)}</b>{charge.taxable?' (خاضع)':' (غير خاضع)'}</span>)}
              {(viewing.paymentAllocations??[]).map((allocation,index)=><span key={`pay-${index}`} className="text-sky-600">{allocation.note??allocation.accountCode}: {fmt(allocation.amountMinor)}</span>)}
              {viewing.approvedBy&&<span className="text-violet-600">اعتماد المصروف/العمولة: {viewing.approvedBy}</span>}
              <span>الإجمالي: <b className="text-emerald-600">{fmt(viewing.totals.totalMinor)}</b></span>
              {viewing.totals.discountMinor > 0 && <span className="text-rose-500">الخصم: {fmt(viewing.totals.discountMinor)}</span>}
              {viewing.totals.taxMinor > 0 && <span className="text-slate-500">الضريبة: {fmt(viewing.totals.taxMinor)}</span>}
            </div>

            {/* القيد المحاسبي المرتبط — الشفافية بالاتجاهين (القرار 9) */}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المحاسبي المتولد #{entry.entryNumber}
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

            {/* سجل تدقيق التعديلات — كل تعديل موثق بقيده العاكس (لا حذف أبداً) */}
            {viewing.editHistory?.length ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-1.5">
                <div className="text-[12px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <History size={13} /> سجل التعديلات ({viewing.editHistory.length})
                </div>
                {viewing.editHistory.map((h, i) => (
                  <div key={i} className="text-[11px] text-slate-500">
                    {h.at.slice(0, 16).replace('T', ' ')} — {h.reason || 'بلا سبب مذكور'} · عُكس القيد #{h.previousEntryId} بالقيد #{h.reversalEntryId}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      {/* ✏️ تعديل فاتورة (سياسة المالك: فقط عندما تكون الفاتورة الإلكترونية غير مفعلة) */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `✏️ تعديل ${editing.invoiceNumber}` : ''} wide>
        {editing && (
          <div className="space-y-4">
            <p className="text-[11.5px] text-slate-400 leading-relaxed p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              💡 {policy.reasonAr} رقم الفاتورة ومرجعها يبقيان كما هما، ويُسجل التعديل في سجل تدقيق داخل الفاتورة.
            </p>

            {/* سطور الفاتورة */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2">الصنف</th>
                    <th className="px-3 py-2 w-24">الكمية</th>
                    <th className="px-3 py-2 w-28">السعر ({cur.symbol})</th>
                    <th className="px-3 py-2 w-20">ضريبة</th>
                    <th className="px-3 py-2 w-20">خصم ٪</th>
                    <th className="px-3 py-2 w-24">الإجمالي</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {editLines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                      <td className="px-3 py-2">
                        <input
                          value={l.qty || ''}
                          onChange={(e) => setEditLines(editLines.map((x, xi) => (xi === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))}
                          className={inputCls + ' !py-1.5 !text-[12px]'} dir="ltr"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={l.unitPriceMinor / 10 ** cur.decimals || ''}
                          onChange={(e) => setEditLines(editLines.map((x, xi) => (xi === i ? { ...x, unitPriceMinor: toMinor(e.target.value || '0', cur.decimals) } : x)))}
                          className={inputCls + ' !py-1.5 !text-[12px]'} dir="ltr"
                        />
                      </td>
                      <td className="px-3 py-2 text-sky-600 font-bold text-center">{(l.vatPercentOverride ?? editing.taxPercent ?? countryVatPercent) > 0 ? `${l.vatPercentOverride ?? editing.taxPercent ?? countryVatPercent}٪` : 'معفى'}</td>
                      <td className="px-3 py-2">
                        <input
                          value={l.discountPercent || ''}
                          onChange={(e) => setEditLines(editLines.map((x, xi) => (xi === i ? { ...x, discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : x)))}
                          className={inputCls + ' !py-1.5 !text-[12px]'} dir="ltr" placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-2 font-bold text-emerald-600">{fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}</td>
                      <td className="px-3 py-2">
                        <button title="حذف السطر" onClick={() => setEditLines(editLines.filter((_, xi) => xi !== i))} className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* إضافة صنف للفاتورة المعدلة */}
              <div className="flex gap-2 p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                <select value={editAddItemId} onChange={(e) => setEditAddItemId(Number(e.target.value))} className={inputCls + ' !py-1.5 !text-[12px] flex-1'}>
                  <option value={0}>— أضف صنفاً —</option>
                  {items.filter((it) => it.isActive && !editLines.some((l) => l.itemId === it.id)).map((it) => (
                    <option key={it.id} value={it.id}>{it.nameAr} · متاح {it.stockQty ?? 0}</option>
                  ))}
                </select>
                <Btn
                  variant="ghost" className="border border-slate-200 dark:border-slate-700 !py-1.5"
                  disabled={!editAddItemId}
                  onClick={() => {
                    const it = items.find((x) => x.id === editAddItemId)
                    if (!it) return
                    setEditLines([...editLines, { itemId: it.id, nameAr: it.nameAr, qty: 1, unitPriceMinor: it.priceMinor, unitCostMinor: it.costMinor, discountPercent: 0, soldByWeight: it.soldByWeight, vatPercentOverride: effectiveVatPercent(it, countryVatPercent) }])
                    setEditAddItemId(0)
                  }}
                >
                  + إضافة
                </Btn>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="العميل" hint="أي جزء آجل يحتاج عميلاً مسجلاً">
                <select value={editCustomerId ?? 0} onChange={(e) => setEditCustomerId(Number(e.target.value) || null)} className={inputCls}>
                  <option value={0}>عميل نقدي</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                </select>
              </Field>
              <Field label="خصم الفاتورة ٪">
                <input value={editDiscount || ''} onChange={(e) => setEditDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
              <Field label={`المدفوع (${cur.symbol})`} hint="الباقي يُسجل آجلاً على العميل تلقائياً">
                <input value={editPaid} onChange={(e) => setEditPaid(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="خزينة التحصيل">
                <TreasuryPicker value={editTreasury} onChange={setEditTreasury} compact />
              </Field>
            </div>

            <Field label="سبب التعديل" hint="يُحفظ في سجل التدقيق ووصف القيد العاكس">
              <input value={editReason} onChange={(e) => setEditReason(e.target.value)} className={inputCls} placeholder="خطأ في الكمية، سعر خاطئ…" />
            </Field>

            {editTotals && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                <div className="text-[12px] text-slate-500">
                  الإجمالي الجديد {editTotals.taxMinor > 0 && <span>(ض. {fmt(editTotals.taxMinor)})</span>}
                  {' '}— كان {fmt(editing.totals.totalMinor)}
                </div>
                <div className="font-black text-xl text-emerald-600">{fmt(editTotals.totalMinor)} {cur.symbol}</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditing(null)}>إلغاء</Btn>
              <Btn onClick={saveEdit} disabled={!editLines.length || editLines.some((l) => l.qty <= 0)}>💾 حفظ التعديل</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* 🤝 عمولة موظف عن فاتورة بيع — استحقاق مربوط بالفاتورة (تعميم أمر المالك) */}
      <Modal open={!!commFor} onClose={() => setCommFor(null)} title={commFor ? `🤝 عمولة موظف — فاتورة ${commFor.invoiceNumber}` : ''}>
        {commFor && (
          <div className="space-y-3">
            {staffCommissions.filter((c) => c.source === 'sale' && c.sourceId === commFor.id && c.status !== 'cancelled').map((c) => (
              <div key={c.id} className="rounded-xl bg-violet-500/10 border border-violet-500/25 p-3 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                {c.code} — {employees.find((e) => e.id === c.employeeId)?.nameAr}: {fmt(c.amountMinor)} ({c.status === 'paid' ? 'مصروفة ✓' : 'مستحقة ⏳'})
              </div>
            ))}
            <Field label="الموظف *">
              <select value={commEmpId} onChange={(e) => setCommEmpId(e.target.value)} className={inputCls}>
                <option value="">— اختر الموظف —</option>
                {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
              </select>
            </Field>
            <Field label={`مبلغ العمولة (${cur.symbol}) *`}>
              <input value={commAmount} onChange={(e) => setCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <div className="text-[11px] text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 leading-relaxed">
              💡 قيد فوري: مصروف عمولات موظفين (5117) ← عمولات مستحقة (2116) —
              تنخفض ربحية الفترة من لحظة الفاتورة، وتُصرف لاحقاً مع الراتب أو منفردة من شاشة الموظفين ← العمولات.
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCommFor(null)}>إغلاق</Btn>
              <Btn onClick={saveInvoiceCommission} disabled={!commEmpId || !commAmount.trim()}>💾 استحقاق العمولة</Btn>
            </div>
          </div>
        )}
      </Modal>
      {editApproval.dialog}
      {creditApproval.dialog}
    </div>
  )
}
