/**
 * فواتير الشراء — مع مصاريف الشراء الموزعة (Landed Cost)
 * (ملاحظة المالك المعتمدة):
 * - كل مصروف (نولون/جمارك/تأمين...) يوزَّع حسب القيمة أو الكمية — اختيار لكل مصروف
 * - الترحيل يحدّث تكلفة الأصناف بالمتوسط المرجح ويزيد المخزون
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Receipt, TruckIcon, Eye, BookOpenText } from 'lucide-react'
import { useDataStore, type PurchaseInvoice } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeLandedCosts } from '../../core/costing.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

interface DraftLine { itemId: number; qty: string; unitPrice: string; expiryDate: string; serialsRaw: string }
interface DraftExpense { nameAr: string; amount: string; method: 'value' | 'qty' }

const EXPENSE_PRESETS = ['نولون / نقل', 'جمارك', 'تأمين', 'شحن وتفريغ', 'عمولة مشتريات', 'أخرى']

export function PurchasesPage() {
  const { items, suppliers, purchases, journal, projects, postPurchase } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<PurchaseInvoice | null>(null)
  const [supplierId, setSupplierId] = useState(0)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [expenses, setExpenses] = useState<DraftExpense[]>([])
  const [paid, setPaid] = useState('')
  const [paySource, setPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [projectId, setProjectId] = useState('')
  const [notes, setNotes] = useState('')

  const openNew = () => {
    setSupplierId(suppliers[0]?.id ?? 0)
    setLines([{ itemId: items[0]?.id ?? 0, qty: '', unitPrice: '', expiryDate: '', serialsRaw: '' }])
    setExpenses([])
    setPaid('')
    setPaySource(DEFAULT_PAY_SOURCE)
    setProjectId('')
    setNotes('')
    setOpen(true)
  }

  /** معاينة حية للتوزيع أثناء الإدخال */
  const preview = useMemo(() => {
    try {
      const costLines = lines
        .filter((l) => l.itemId && Number(l.qty) > 0)
        .map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
          unitPriceMinor: toMinor(l.unitPrice || '0', cur.decimals),
        }))
      if (!costLines.length) return null
      const exps = expenses
        .filter((e) => Number(e.amount) > 0)
        .map((e) => ({ nameAr: e.nameAr, amountMinor: toMinor(e.amount, cur.decimals), method: e.method }))
      const landed = computeLandedCosts(costLines, exps)
      const goods = landed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
      const expTotal = exps.reduce((a, e) => a + e.amountMinor, 0)
      return { landed, goods, expTotal, grand: goods + expTotal }
    } catch {
      return null
    }
  }, [lines, expenses, cur.decimals])

  const save = () => {
    if (!preview || !supplierId) return
    try {
    const inv = postPurchase({
      supplierId,
      date: new Date().toISOString().slice(0, 10),
      lines: preview.landed.map((l) => {
        // سطر الإدخال المطابق: صلاحية FEFO + سيريالات القطع (نمط موبايل شوب)
        const d = lines.find((x) => x.itemId === l.itemId && Number(x.qty) === l.qty)
        return {
          itemId: l.itemId,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          expiryDate: d?.expiryDate || null,
          serialsRaw: d?.serialsRaw || undefined,
        }
      }),
      expenses: expenses
        .filter((e) => Number(e.amount) > 0)
        .map((e) => ({ nameAr: e.nameAr, amountMinor: toMinor(e.amount, cur.decimals), method: e.method })),
      paidMinor: paid ? toMinor(paid, cur.decimals) : 0,
      treasury: paySource.kind === 'treasury' ? paySource.treasury : undefined,
      custodyFileId: paySource.kind === 'custody' ? paySource.custodyFileId : null,
      projectId: projectId ? Number(projectId) : null,
      notes,
    })
    toast.show(`رُحّلت الفاتورة ${inv.invoiceNumber} — تحدثت تكلفة الأصناف بالمتوسط المرجح ✓`)
    setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between">
        <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
          💡 الترحيل يوزع مصاريف الشراء على الأصناف (حسب القيمة أو الكمية لكل مصروف) ثم يحدّث
          تكلفة كل صنف <b>بالمتوسط المرجح المتحرك</b> ويزيد رصيد المخزون.
        </p>
        <Btn onClick={openNew} disabled={items.length === 0 || suppliers.length === 0}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> فاتورة شراء</span>
        </Btn>
      </div>

      {(items.length === 0 || suppliers.length === 0) && (
        <div className="anim-pop p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-[12px] font-bold text-amber-700 dark:text-amber-400">
          ⚠️ تحتاج أولاً: {items.length === 0 ? 'إضافة أصناف (المخزون ← الأصناف)' : ''} {items.length === 0 && suppliers.length === 0 ? ' + ' : ''}
          {suppliers.length === 0 ? 'إضافة مورد (المشتريات ← الموردون)' : ''}
        </div>
      )}

      {purchases.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚛" title="لا فواتير شراء بعد" sub="أول فاتورة شراء هي التي تبدأ حساب التكلفة الحقيقية لأصنافك" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الفاتورة</th>
                <th className="px-4 py-3 font-bold">المورد</th>
                <th className="px-4 py-3 font-bold">البضاعة</th>
                <th className="px-4 py-3 font-bold">المصاريف</th>
                <th className="px-4 py-3 font-bold">الإجمالي</th>
                <th className="px-4 py-3 font-bold">المدفوع</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p, i) => (
                <tr key={p.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-cyan-500/[0.04] transition-colors duration-150">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{p.invoiceNumber}</div>
                    {p.refCode && <div className="text-[10px] font-mono text-sky-600 dark:text-sky-400" dir="ltr">{p.refCode}</div>}
                    <div className="text-[11px] text-slate-400">{p.date}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{suppliers.find((s) => s.id === p.supplierId)?.nameAr ?? '—'}</td>
                  <td className="px-4 py-3">{fmt(p.goodsTotalMinor)}</td>
                  <td className="px-4 py-3">
                    {p.expensesTotalMinor > 0
                      ? <span className="text-amber-600 dark:text-amber-400 font-bold">{fmt(p.expensesTotalMinor)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 font-black text-slate-800 dark:text-white">{fmt(p.grandTotalMinor)}</td>
                  <td className="px-4 py-3">
                    <span className={p.paidMinor >= p.grandTotalMinor ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                      {fmt(p.paidMinor)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button onClick={() => setViewing(p)} className="p-2 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-all duration-200 hover:scale-110">
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* مودال فاتورة جديدة */}
      <Modal open={open} onClose={() => setOpen(false)} title="فاتورة شراء جديدة" wide>
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="المورد *">
              <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))} className={inputCls}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
              </select>
            </Field>
            <Field label={`المدفوع الآن (${cur.symbol})`} hint="الباقي يُسجَّل ديناً على حسابك عند المورد">
              <input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" min={0} className={inputCls} placeholder="0" />
            </Field>
            <Field label="مصدر الدفع" hint="خزينة/بنك — أو عهدة موظف تُخصم من ملفه">
              <PaySourcePicker value={paySource} onChange={setPaySource} />
            </Field>
          </div>
          {projects.some((p) => p.status === 'active') && (
            <Field label="ربط بمشروع مقاولات (اختياري)" hint="الفاتورة تدخل تكاليف المشروع وربحيته">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
                <option value="">— بلا مشروع —</option>
                {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
              </select>
            </Field>
          )}

          {/* السطور */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Receipt size={14} /> أصناف الفاتورة</span>
              <Btn variant="soft" onClick={() => setLines((l) => [...l, { itemId: items[0]?.id ?? 0, qty: '', unitPrice: '', expiryDate: '', serialsRaw: '' }])}>+ سطر</Btn>
            </div>
            {/* رؤوس أعمدة واضحة — حقل الصنف يأخذ نصف العرض (ملاحظة المالك) */}
            <div className="hidden sm:grid grid-cols-[1fr_90px_120px_140px_36px] gap-2 px-1 pb-1 text-[10.5px] font-bold text-slate-400">
              <span>الصنف</span><span>الكمية</span><span>سعر الوحدة ({cur.symbol})</span><span>الصلاحية (إن وجدت)</span><span />
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="anim-in">
                <div className="grid grid-cols-2 sm:grid-cols-[1fr_90px_120px_140px_36px] gap-2 items-center">
                  <select
                    value={l.itemId}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, itemId: Number(e.target.value) } : x)))}
                    className={`${inputCls} col-span-2 sm:col-span-1`}
                  >
                    {items.map((it) => <option key={it.id} value={it.id}>{it.nameAr}{it.baseUnit ? ` (${it.baseUnit})` : ''}</option>)}
                  </select>
                  <input
                    value={l.qty}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    type="number" min={0} placeholder="الكمية" className={inputCls}
                  />
                  <input
                    value={l.unitPrice}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))}
                    type="number" min={0} placeholder="سعر الوحدة" className={inputCls}
                  />
                  {items.find((it) => it.id === l.itemId)?.trackExpiry ? (
                    <input
                      value={l.expiryDate}
                      onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, expiryDate: e.target.value } : x)))}
                      type="date" title="تاريخ الصلاحية (FEFO)" className={inputCls} dir="ltr"
                    />
                  ) : <span className="hidden sm:block text-center text-slate-200 dark:text-slate-700 text-[11px]">—</span>}
                  <button onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-rose-500 transition-colors justify-self-center">
                    <Trash2 size={15} />
                  </button>
                </div>
                {/* سيريالات القطع (أصناف الموبايلات/الأجهزة) — عددها يجب أن يطابق الكمية */}
                {items.find((it) => it.id === l.itemId)?.trackSerial && (
                  <textarea
                    value={l.serialsRaw}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, serialsRaw: e.target.value } : x)))}
                    placeholder={`🔢 سيريالات/IMEI هذه القطع — سطر لكل سيريال أو مفصولة بفواصل (${l.qty || '؟'} سيريال مطلوب) — اتركها فارغة لتخطي التتبع`}
                    rows={2}
                    dir="ltr"
                    className={`${inputCls} mt-1.5 font-mono text-[12px]`}
                  />
                )}
                </div>
              ))}
            </div>
          </div>

          {/* مصاريف الشراء */}
          <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <TruckIcon size={14} /> مصاريف الشراء — تُوزَّع على الأصناف وترفع تكلفتها
              </span>
              <Btn variant="soft" onClick={() => setExpenses((e) => [...e, { nameAr: 'نولون / نقل', amount: '', method: 'qty' }])}>+ مصروف</Btn>
            </div>
            {expenses.length === 0 && <p className="text-[11px] text-slate-400">مثال: نولون 500 يوزَّع بالكمية، جمارك 2000 توزَّع بالقيمة…</p>}
            <div className="space-y-2">
              {expenses.map((e, i) => (
                <div key={i} className="anim-in flex gap-2 items-center">
                  <select
                    value={e.nameAr}
                    onChange={(ev) => setExpenses((arr) => arr.map((x, j) => (j === i ? { ...x, nameAr: ev.target.value } : x)))}
                    className={`${inputCls} flex-1`}
                  >
                    {EXPENSE_PRESETS.map((p2) => <option key={p2} value={p2}>{p2}</option>)}
                  </select>
                  <input
                    value={e.amount}
                    onChange={(ev) => setExpenses((arr) => arr.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))}
                    type="number" min={0} placeholder="المبلغ" className={`${inputCls} w-36`}
                  />
                  <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700">
                    {([['qty', 'بالكمية'], ['value', 'بالقيمة']] as const).map(([m, label]) => (
                      <button
                        key={m}
                        onClick={() => setExpenses((arr) => arr.map((x, j) => (j === i ? { ...x, method: m } : x)))}
                        className={`px-2.5 py-2 text-[11px] font-bold transition-colors duration-200 ${
                          e.method === m ? 'bg-amber-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setExpenses((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-rose-500 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* معاينة التوزيع الحية */}
          {preview && (
            <div className="anim-pop rounded-2xl border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
              <div className="px-4 py-2.5 text-[12px] font-bold text-emerald-700 dark:text-emerald-400 border-b border-emerald-500/15">
                ✨ معاينة حية — التكلفة النهائية لكل وحدة بعد توزيع المصاريف:
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400">
                    <th className="px-4 py-2">الصنف</th>
                    <th className="px-4 py-2">كمية</th>
                    <th className="px-4 py-2">سعر الشراء</th>
                    <th className="px-4 py-2">نصيب المصاريف</th>
                    <th className="px-4 py-2">التكلفة النهائية/وحدة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.landed.map((l, i) => (
                    <tr key={i} className="border-t border-emerald-500/10">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{items.find((it) => it.id === l.itemId)?.nameAr}</td>
                      <td className="px-4 py-2">{l.qty}</td>
                      <td className="px-4 py-2">{fmt(l.unitPriceMinor)}</td>
                      <td className="px-4 py-2 text-amber-600 dark:text-amber-400">{fmt(l.expenseShareMinor)}</td>
                      <td className="px-4 py-2 font-black text-emerald-700 dark:text-emerald-400">{fmt(l.landedUnitCostMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2.5 flex gap-5 text-[12px] border-t border-emerald-500/15 bg-emerald-500/5">
                <span>البضاعة: <b>{fmt(preview.goods)}</b></span>
                <span>المصاريف: <b className="text-amber-600">{fmt(preview.expTotal)}</b></span>
                <span>الإجمالي: <b className="text-emerald-700 dark:text-emerald-400">{fmt(preview.grand)}</b></span>
              </div>
            </div>
          )}

          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!preview || !supplierId}>🚀 ترحيل الفاتورة</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض فاتورة */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `فاتورة ${viewing.invoiceNumber}${viewing.refCode ? ` — ${viewing.refCode}` : ''}` : ''} wide>
        {viewing && (
          <div className="space-y-4 text-sm">
            <div className="flex gap-4 text-[12px] text-slate-500">
              <span>📅 {viewing.date}</span>
              <span>🚛 {suppliers.find((s) => s.id === viewing.supplierId)?.nameAr}</span>
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">سعر</th>
                  <th className="px-3 py-2">نصيب مصاريف</th><th className="px-3 py-2">تكلفة نهائية</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{items.find((it) => it.id === l.itemId)?.nameAr ?? `#${l.itemId}`}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2 text-amber-600">{fmt(l.expenseShareMinor)}</td>
                    <td className="px-3 py-2 font-black text-emerald-600">{fmt(l.landedUnitCostMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.expenses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {viewing.expenses.map((e, i) => (
                  <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold">
                    {e.nameAr}: {fmt(e.amountMinor)} ({e.method === 'qty' ? 'بالكمية' : 'بالقيمة'})
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-5 font-bold">
              <span>البضاعة: {fmt(viewing.goodsTotalMinor)}</span>
              <span className="text-amber-600">المصاريف: {fmt(viewing.expensesTotalMinor)}</span>
              <span className="text-emerald-600">الإجمالي: {fmt(viewing.grandTotalMinor)}</span>
            </div>

            {/* القيد المحاسبي المرتبط — الشفافية بالاتجاهين (القرار 9) */}
            {(() => {
              const entry = viewing.journalEntryId ? journal.find((e) => e.id === viewing.journalEntryId) : null
              return entry ? (
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
              ) : null
            })()}
          </div>
        )}
      </Modal>
    </div>
  )
}
