/**
 * أوامر الشراء — طلب المالك.
 * أمر الشراء التزام تجاري لا قيد محاسبي: يوثّق المطلوب من المورد بكمياته
 * وأسعاره وضريبته، ثم تُعبَّأ منه فاتورة الشراء بزر «تعبئة من» فتُرحَّل هي وحدها.
 *
 * **مطابق للفاتورة بالضبط (بلاغ v1.0.2)**: المحرر بالوضع المتقدم المتقدم نفسه
 * (أعمدة الكود/الوحدة/المستودع لكل سطر/ملاحظات + تخصيص الحقول) وزر الاعتماد
 * يقول «اعتماد أمر الشراء» — لا «ترحيل» — لأن الأمر التزام تجاري لا قيد.
 *
 * **مستندي بالكامل (طلب المالك ㉘)**: المحرر بنفس هيئة فاتورة الشراء —
 * إطار InvoicePOSFrame وجدول بنود الفاتورة — بدل النافذة البسيطة السابقة.
 */
import { useMemo, useState } from 'react'
import { ClipboardList, Plus, Send, Trash2, XCircle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { QuickSelect, PartyQuickPicker, ItemQuickPicker } from '../components/KeyboardPickers.tsx'
import { formatMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import {
  PURCHASE_ORDER_STATUS_AR, poRemainingQty, purchaseOrderTotals,
  type PurchaseOrderLine, type PurchaseOrderStatus,
} from '../../core/purchaseOrders.ts'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { InvoiceLinesTable } from '../components/InvoiceLinesTable.tsx'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { usePrintSwitches } from '../components/PrintSwitches.tsx'
import { partyCode } from '../../core/partyCodes.ts'
import { useNavigate } from 'react-router-dom'

type DraftLine = PurchaseOrderLine & { key: string; warehouseId: number | null }

const blankLine = (warehouseId: number | null): DraftLine => ({ key: crypto.randomUUID(), itemId: 0, nameAr: '', qty: 1, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 0, vatPercent: 0, notes: '', warehouseId })

/** شروط توريد جاهزة تُضاف بضغطة إلى ملاحظات أمر الشراء — نفس نمط لوحة شروط الفاتورة */
const PURCHASE_TERMS = ['السداد بعد المطابقة والاستلام', 'ضمان المورد سنة على العيوب المصنعية', 'التوريد على نفقة المورد حتى المخزن', 'يُرد التالف خلال 7 أيام من الاستلام', 'التوريد على دفعات حسب جدول المشروع']

export function PurchaseOrdersPage() {
  const toast = useToast()
  const nav = useNavigate()
  const printSwitches = usePrintSwitches()
  const { purchaseOrders, addPurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder, suppliers, items, warehouses } = useDataStore()
  const setup = useAppStore((s) => s.setup)
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (minor: number) => formatMinor(minor, cur, false)

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expectedDate, setExpectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [warehouseId, setWarehouseId] = useState<number | null>(setup.defaultWarehouseId ?? null)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseOrderStatus>('all')

  const totals = useMemo(() => purchaseOrderTotals(lines), [lines])
  const rows = useMemo(
    () => purchaseOrders.filter((order) => statusFilter === 'all' || order.status === statusFilter).slice().reverse(),
    [purchaseOrders, statusFilter],
  )

  const patch = (key: string, value: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...value } : line)))
  const reset = () => { setLines([blankLine(warehouseId)]); setNotes(''); setSupplierId(null); setSupplierName('') }

  const addItem = (id: number) => {
    const item = items.find((x) => x.id === id)
    if (!item) return
    setLines((current) => [...current, { ...blankLine(warehouseId), itemId: item.id, nameAr: item.nameAr, unitAr: item.baseUnit ?? 'قطعة', unitPriceMinor: item.costMinor ?? 0 }])
  }

  const openNew = () => {
    reset(); setDate(new Date().toISOString().slice(0, 10)); setExpectedDate(new Date().toISOString().slice(0, 10)); setOpen(true)
  }

  const submit = () => {
    try {
      const clean = lines.filter((line) => line.itemId > 0 && line.qty > 0)
        .map(({ key, warehouseId: _wh, ...line }) => { void key; void _wh; return line })
      const order = addPurchaseOrder({
        supplierId: supplierId ?? null,
        supplierName: supplierName.trim() || suppliers.find((s) => s.id === supplierId)?.nameAr || 'مورد نقدي',
        date,
        expectedDate,
        warehouseId,
        notes: notes.trim(),
        lines: clean,
      })
      toast.show(`سُجّل أمر الشراء ${order.orderNumber} — عبّئ منه فاتورة الشراء عند الاستلام (زر «تعبئة من»)`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /** معاينة/طباعة أمر الشراء بنفس محرك قوالب الفواتير — شكل مطابق للفاتورة */
  /* المعاينة الحية: الموديل يُبنى بإعدادات اللحظة وrebuild يعيد بناءه كاملاً —
       فيتحدث التذييل (ملاحظات + تذييل الإعدادات) وكل حقول الإعدادات فوراً */
    const buildPrintModel = () => buildSimpleDocModel({
      docTitle: 'أمر شراء (مسودة)',
      invoiceNumber: 'مسودة',
      refCode: 'DRAFT',
      dateIso: date,
      partyLabel: supplierId ? suppliers.find((s) => s.id === supplierId)?.nameAr ?? 'مورد' : (supplierName.trim() || 'مورد نقدي'),
      paymentLabel: `التسليم المتوقع ${expectedDate}`,
      rows: lines.filter((l) => l.itemId > 0).map((l) => ({
        nameAr: `${items.find((i) => i.id === l.itemId)?.sku || ''} — ${items.find((i) => i.id === l.itemId)?.nameAr ?? l.nameAr}`,
        qty: l.qty, unitPriceMinor: l.unitPriceMinor, totalMinor: Math.round(l.qty * l.unitPriceMinor),
      })),
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      operatorName: setup.ownerName ?? 'المالك',
      settings: useAppStore.getState().receipt,
      extraFooter: notes.trim() || undefined,
    })
    const printDraft = (template: InvoiceTemplate) => {
      if (!lines.length) return toast.show('أضف أصنافاً قبل المعاينة', 'error')
      const model = buildPrintModel()
      const live = useAppStore.getState().receipt
      if (!printSwitches.silentPrint) { openPrintPreview({ html: buildModelHtml(model, cur, live, template), wide: template !== 'thermal', title: template !== 'thermal' ? 'معاينة أمر الشراء قبل الطباعة' : 'معاينة الإيصال', rebuild: () => { const r = useAppStore.getState().receipt; return buildModelHtml(buildPrintModel(), cur, r, template) } }); return }
      printModelWithTemplate(model, cur, live, template)
  }

  /* ════ محرر المستند (نفس هيئة فاتورة الشراء — طلب المالك ㉘) ════ */
  if (open) {
    const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null
    const cleanLines = lines.filter((l) => l.itemId > 0)
    return (
      <div data-po-doc-editor>
        <InvoicePOSFrame
          kind="purchase"
          modeLabel="أمر شراء"
          currencyLabel={`${cur.code} · ${cur.symbol}`}
          dateLabel={date}
          branchLabel={warehouses.find((w) => w.id === warehouseId)?.nameAr ?? 'كل المخازن'}
          userLabel={setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber="PO-DRAFT"
          onBack={() => setOpen(false)}
          onNavigate={(path) => nav(path)}
          onPartySearch={() => document.getElementById('po-supplier-field')?.focus()}
          onItemSearch={() => window.dispatchEvent(new Event('shopsys:focus-item'))}
          onSaveDraft={() => toast.show('اضغط «اعتماد وترحيل» لحفظ الأمر — أوامر الشراء لا تُرحَّل محاسبياً حتى فاتورة الشراء')}
          onRestoreDraft={() => toast.show('لا مسودات محفوظة لأوامر الشراء')}
          onPrint={() => printDraft('a4')}
          onExportPdf={() => { toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️'); printDraft('a4') }}
          onPost={submit}
          postLabel="اعتماد أمر الشراء"
          headerFields={
            <>
              <Field label="المورد *">
                <div id="po-supplier-field" className="invoice-doc-infield flex gap-1">
                  <input className={inputCls} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="اسم المورد (نقدي إن ترك فارغاً)" aria-label="اسم المورد" />
                  <PartyQuickPicker parties={suppliers} value={supplierId ?? 0} onChange={(id) => { setSupplierId(id || null); const s = suppliers.find((x) => x.id === id); if (s) setSupplierName(s.nameAr) }} cashLabel="مورد نقدي" label="بحث المورد" cashValue={0} />
                  {selectedSupplier && <span className="invoice-doc-infield-chip">{partyCode('SUP', selectedSupplier.id)}</span>}
                </div>
              </Field>
              <Field label="تاريخ الأمر"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" /></Field>
              <Field label="التسليم المتوقع"><input type="date" className={inputCls} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} dir="ltr" /></Field>
              <Field label="مخزن الاستلام">
                <QuickSelect className={inputCls} value={warehouseId ?? ''} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; setWarehouseId(id); setLines((ls) => ls.map((l) => ({ ...l, warehouseId: id }))) }}>
                  <option value="">كل المخازن</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                </QuickSelect>
              </Field>
            </>
          }
          partyMeta={
            <div className="invoice-doc-partymeta">
              <span>المورد: <b>{selectedSupplier?.nameAr ?? (supplierName.trim() || 'مورد نقدي')}</b></span>
              <span>التسليم: <b>{expectedDate}</b></span>
              <span>مخزن الاستلام: <b>{warehouses.find((w) => w.id === warehouseId)?.nameAr ?? 'كل المخازن'}</b></span>
              <span>الأصناف: <b>{cleanLines.length}</b></span>
              <span>الإجمالي: <b className="font-mono">{fmt(totals.totalMinor)} {cur.symbol}</b></span>
            </div>
          }
        >
          <section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark" data-po-lines>
            <div className="invoice-body-grid">
              <div className="invoice-lines-column">
                <InvoiceLinesTable
                  entry={<ItemQuickPicker items={items.filter((item) => item.isActive !== false)} onPick={addItem} itemMeta={(item) => ({ unit: item.baseUnit ?? '', stock: item.isService ? 'خدمة' : String(item.stockQty ?? 0), price: formatMinor(item.costMinor ?? 0, cur, false) })} amountLabel={(item) => `آخر تكلفة ${formatMinor(item.costMinor ?? 0, cur, false)}`} placeholder="ابحث عن الصنف المطلوب شراؤه…" />}
                  kind="purchase"
                  mode="advanced"
                  lines={lines.map((line) => ({ ...line, warehouseId: line.warehouseId ?? warehouseId }))}
                  items={items}
                  warehouses={warehouses}
                  warehouseId={warehouseId}
                  currencyCode={cur.code}
                  currencyDecimals={cur.decimals}
                  currencySymbol={cur.symbol}
                  canViewCost
                  onPick={addItem}
                  onPatch={(key, value) => patch(key, value as Partial<DraftLine>)}
                  onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
                  placeholder="اكتب اسم الصنف المطلوب؛ ثم اختر بالسهم + Enter"
                  amountLabel={(item) => `آخر تكلفة ${formatMinor(item.costMinor ?? 0, cur, false)}`}
                />
              </div>
            </div>

            <section className="invoice-totals-footer">
              <div className="invoice-doc-panel" data-po-notes>
                <div className="invoice-doc-panel-head"><b>شروط التوريد والملاحظات</b><small>تُطبع في نسخة المورد</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-quick">
                    {PURCHASE_TERMS.map((term) => (
                      <button key={term} type="button" onClick={() => setNotes(notes.trim() ? `${notes.trim()}\n${term}` : term)}>+ {term}</button>
                    ))}
                  </div>
                  <textarea className={`${inputCls} invoice-doc-termsbox`} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="شروط التوريد" placeholder="شروط التوريد — تظهر في نسخة المورد" />
                </div>
              </div>
              <div className="invoice-doc-panel" data-po-totals>
                <div className="invoice-doc-panel-head"><b>إجماليات الأمر</b><small>التزام تجاري — لا قيد حتى فاتورة الشراء</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-sum-row"><span>قيمة البضاعة</span><i /><b className="font-mono">{fmt(totals.netMinor)}</b></div>
                  {totals.taxMinor > 0 && <div className="invoice-doc-sum-row"><span>ضريبة القيمة المضافة</span><i /><b className="font-mono">{fmt(totals.taxMinor)}</b></div>}
                  <div className="invoice-doc-sum-row is-strong"><span>إجمالي الأمر</span><i /><b className="font-mono">{fmt(totals.totalMinor)} {cur.symbol}</b></div>
                  <div className="invoice-doc-sum-row is-info"><span>المُستلَم لاحقاً</span><i /><b className="font-mono">تُعبَّأ فاتورة الشراء من هذا الأمر</b></div>
                </div>
              </div>
            </section>
          </section>
                  </InvoicePOSFrame>
      </div>
    )
  }

  /* ════ قائمة الأوامر ════ */
  return (
    <div className="space-y-4" data-po-list>
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><ClipboardList className="w-6 h-6 text-cyan-500" /> أوامر الشراء</h1>
        <div className="flex items-center gap-2">
          <QuickSelect className={inputCls + ' w-44'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | PurchaseOrderStatus)} aria-label="فلتر الحالة">
            <option value="all">كل الحالات</option>
            {(Object.keys(PURCHASE_ORDER_STATUS_AR) as PurchaseOrderStatus[]).map((status) => <option key={status} value={status}>{PURCHASE_ORDER_STATUS_AR[status]}</option>)}
          </QuickSelect>
          <Btn onClick={openNew}><Plus size={15} /> أمر شراء</Btn>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-8 text-center text-[13px] text-slate-400">
          لا أوامر شراء بعد — سجّل أمراً جديداً ثم عبّئ منه فاتورة الشراء عند الاستلام.
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">الأمر</th>
                <th className="px-4 py-2.5">المورد</th>
                <th className="px-4 py-2.5">التسليم المتوقع</th>
                <th className="px-4 py-2.5">البنود</th>
                <th className="px-4 py-2.5">الإجمالي</th>
                <th className="px-4 py-2.5">الحالة</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const total = purchaseOrderTotals(order.lines)
                const pending = order.lines.reduce((sum, line) => sum + poRemainingQty(line), 0)
                return (
                  <tr key={order.id} data-po-row={order.orderNumber} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-black text-slate-800 dark:text-white">{order.orderNumber}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{order.date}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{order.supplierName}</td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-400 font-mono">{order.expectedDate}</td>
                    <td className="px-4 py-2.5 text-slate-500">{order.lines.length}{pending > 0 && <span className="text-[10.5px] text-amber-600"> (متبقٍ {pending})</span>}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-white">{fmt(total.totalMinor)} <span className="text-[10px] text-slate-400">{cur.symbol}</span></td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                        order.status === 'closed' ? 'bg-emerald-500/10 text-emerald-600' : order.status === 'partial' ? 'bg-amber-500/10 text-amber-600' : order.status === 'cancelled' ? 'bg-rose-500/10 text-rose-500' : 'bg-sky-500/10 text-sky-600'
                      }`}>{PURCHASE_ORDER_STATUS_AR[order.status]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-left">
                      <div className="flex gap-1 justify-end">
                        {order.status === 'draft' && (
                          <button onClick={() => { try { setPurchaseOrderStatus(order.id, 'sent'); toast.show('عُلّم الأمر كمُرسل للمورد ✓') } catch (e) { toast.show((e as Error).message, 'error') } }} title="إرسال للمورد" className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Send size={14} /></button>
                        )}
                        {order.status !== 'cancelled' && order.status !== 'closed' && (
                          <button onClick={() => { try { setPurchaseOrderStatus(order.id, 'cancelled'); toast.show('أُلغي الأمر') } catch (e) { toast.show((e as Error).message, 'error') } }} title="إلغاء" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><XCircle size={14} /></button>
                        )}
                        {order.status !== 'closed' && order.status !== 'cancelled' && (
                          <button onClick={() => nav(`/purchases/invoices/new?po=${order.id}`)} title="فتح فاتورة شراء معبَّأة من بنود هذا الأمر المتبقية مباشرة" className="px-2 py-1 rounded-lg text-[10.5px] font-bold text-cyan-700 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all dark:text-cyan-300">فاتورة استلام</button>
                        )}
                        {order.status === 'draft' && (
                          <button onClick={() => { try { deletePurchaseOrder(order.id); toast.show('حُذف الأمر') } catch (e) { toast.show((e as Error).message, 'error') } }} title="حذف" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
