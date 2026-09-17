/**
 * مرتجعات الشراء (المرحلة 3) — عن فاتورة شراء أصلية:
 * تُقيَّم بالتكلفة النهائية للوحدة (بضاعة + نصيب مصاريف)، ولا تتجاوز
 * المتبقي القابل للإرجاع ولا المخزون الحالي (لا إرجاع لبضاعة بيعت).
 * الاسترداد: نقدي من المورد أو تخفيض دينه.
 */
import { useMemo, useState } from 'react'
import { RotateCcw, Search, BookOpenText, Eye } from 'lucide-react'
import { useDataStore, type PurchaseInvoice, type PurchaseReturn } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { remainingPurchasable } from '../../core/purchases.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function PurchaseReturnsPage() {
  const { purchases, purchaseReturns, suppliers, items, journal, postPurchaseReturn } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [pickOpen, setPickOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [purchase, setPurchase] = useState<PurchaseInvoice | null>(null)
  const [qtys, setQtys] = useState<Record<number, string>>({})
  const [refund, setRefund] = useState<'cash' | 'debt'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [reason, setReason] = useState('')
  const [viewing, setViewing] = useState<PurchaseReturn | null>(null)

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null
  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.nameAr ?? '—'

  const remaining = useMemo(() => {
    if (!purchase) return new Map<number, number>()
    const prior = purchaseReturns.filter((r) => r.purchaseId === purchase.id).flatMap((r) => r.lines)
    return remainingPurchasable(purchase.lines, prior)
  }, [purchase, purchaseReturns])

  const pickable = useMemo(() => {
    const q = pickQuery.trim()
    return [...purchases].reverse().filter((p) => !q || p.invoiceNumber.includes(q) || (p.refCode ?? '').includes(q.toUpperCase())).slice(0, 20)
  }, [purchases, pickQuery])

  /** الدين المتبقي غير المدفوع على الفاتورة المختارة (بعد مرتجعات الدين السابقة) */
  const unpaidDebt = useMemo(() => {
    if (!purchase) return 0
    // G4+N2: ما خُفض من الدين سابقاً = مستحق المورد عن البضاعة + حصة الضريبة المعكوسة (تطابق قيد 2101)
    const priorDebt = purchaseReturns
      .filter((r) => r.purchaseId === purchase.id && r.refund === 'debt')
      .reduce((a, r) => a + (r.supplierValueMinor ?? r.totalMinor) + (r.inputVatShareMinor ?? 0), 0)
    return Math.max(0, (purchase.supplierDueMinor ?? purchase.grandTotalMinor) - purchase.paidMinor - priorDebt)
  }, [purchase, purchaseReturns])

  const startReturn = (p: PurchaseInvoice) => {
    setPurchase(p)
    setQtys({})
    setRefund((p.supplierDueMinor ?? p.grandTotalMinor) - p.paidMinor > 0 ? 'debt' : 'cash')
    setReason('')
    setPickOpen(false)
  }

  // قاعدة المالك المعممة: كل المرتجعات باعتماد مشرف — مرتجع الشراء يخرج بضاعة ويرد مالاً
  const approval = useSupervisorApproval()
  const submit = () => {
    if (!purchase) return
    approval.request((approvedBy) => {
    try {
      const map = new Map<number, number>()
      for (const [id, v] of Object.entries(qtys)) {
        const n = Number(v)
        if (n > 0) map.set(Number(id), n)
      }
      const ret = postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: map, refund, reason: reason.trim(), treasury, approvedBy })
      toast.show(`تم مرتجع الشراء ${ret.returnNumber} — خرجت البضاعة وتولد القيد ✓`)
      setPurchase(null)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
    })
  }

  const anyQty = Object.values(qtys).some((v) => Number(v) > 0)
  const itemName = (id: number) => items.find((it) => it.id === id)?.nameAr ?? `#${id}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up">
        <div className="text-sm text-slate-500">يُرجَع للمورد بتكلفة الوحدة النهائية من فاتورته — ولا يُرجَع ما بيع بالفعل</div>
        <Btn onClick={() => { setPickQuery(''); setPickOpen(true) }} disabled={purchases.length === 0}>
          <RotateCcw size={15} /> مرتجع شراء جديد
        </Btn>
      </div>

      {purchaseReturns.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📤" title="لا مرتجعات شراء بعد" sub={purchases.length ? 'اضغط «مرتجع شراء جديد» واختر الفاتورة الأصلية' : 'لا فواتير شراء أصلاً'} />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">المرتجع</th>
                <th className="px-4 py-3 font-bold">عن الفاتورة</th>
                <th className="px-4 py-3 font-bold">المورد</th>
                <th className="px-4 py-3 font-bold">الاسترداد</th>
                <th className="px-4 py-3 font-bold">القيمة</th>
                <th className="px-4 py-3 font-bold">القيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {[...purchaseReturns].reverse().map((r, i) => {
                const orig = purchases.find((p) => p.id === r.purchaseId)
                return (
                  <tr key={r.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-cyan-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{r.returnNumber}</div>
                      <div className="text-[11px] text-slate-400">{r.date.slice(0, 16).replace('T', ' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig?.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig ? supplierName(orig.supplierId) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${r.refund === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-cyan-500/10 text-cyan-600'}`}>
                        {r.refund === 'cash' ? '💵 استرداد نقدي' : '📉 تخفيض دين المورد'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-black text-cyan-600">{fmt(r.totalMinor)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                        <BookOpenText size={11} /> قيد #{r.journalEntryId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewing(r)} className="p-2 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-all duration-200 hover:scale-110">
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* اختيار فاتورة الشراء */}
      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="اختر فاتورة الشراء الأصلية">
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="رقم الفاتورة… P-0001" className={`${inputCls} pr-9`} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {pickable.map((p) => (
              <button key={p.id} onClick={() => startReturn(p)} className="w-full text-right px-3 py-2.5 hover:bg-cyan-500/5 transition-colors flex items-center justify-between gap-2">
                <span>
                  <b className="text-slate-800 dark:text-white">{p.invoiceNumber}</b>
                  {p.refCode && <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 mr-2" dir="ltr">{p.refCode}</span>}
                  <span className="text-[11px] text-slate-400 mr-2">{p.date.slice(0, 10)} · {supplierName(p.supplierId)}</span>
                </span>
                <b className="text-cyan-600">{fmt(p.grandTotalMinor)}</b>
              </button>
            ))}
            {pickable.length === 0 && <div className="text-center text-sm text-slate-400 py-6">لا نتائج</div>}
          </div>
        </div>
      </Modal>

      {/* نموذج المرتجع */}
      <Modal open={!!purchase} onClose={() => setPurchase(null)} title={purchase ? `مرتجع عن فاتورة الشراء ${purchase.invoiceNumber}` : ''} wide>
        {purchase && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th>
                  <th className="px-3 py-2">المشترى</th>
                  <th className="px-3 py-2">التكلفة النهائية/وحدة</th>
                  <th className="px-3 py-2">المتبقي القابل للإرجاع</th>
                  <th className="px-3 py-2 w-28">كمية الإرجاع</th>
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((l) => {
                  const rem = remaining.get(l.itemId) ?? 0
                  const stock = items.find((it) => it.id === l.itemId)?.stockQty ?? 0
                  const max = Math.min(rem, stock)
                  return (
                    <tr key={l.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 font-bold">{itemName(l.itemId)}</td>
                      <td className="px-3 py-2">{l.qty}</td>
                      <td className="px-3 py-2">{fmt(l.landedUnitCostMinor)}</td>
                      <td className={`px-3 py-2 font-bold ${max > 0 ? 'text-cyan-600' : 'text-slate-300'}`}>
                        {rem}{stock < rem && <span className="text-[10px] text-amber-500 mr-1">(المخزون {stock})</span>}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={qtys[l.itemId] ?? ''}
                          onChange={(e) => setQtys((q) => ({ ...q, [l.itemId]: e.target.value }))}
                          placeholder="0"
                          disabled={max <= 0}
                          className={`${inputCls} text-center py-1.5 disabled:opacity-40`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setRefund('cash')}
                className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all ${refund === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >💵 استرداد نقدي من المورد</button>
              <button
                onClick={() => setRefund('debt')}
                disabled={unpaidDebt <= 0}
                className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all disabled:opacity-40 ${refund === 'debt' ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >📉 تخفيض دين المورد {unpaidDebt > 0 ? `(المتبقي ${fmt(unpaidDebt)})` : '(مسددة بالكامل)'}</button>
            </div>
            {refund === 'cash' && <TreasuryPicker value={treasury} onChange={setTreasury} compact />}

            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإرجاع (اختياري): تالف، غير مطابق للمواصفات…" className={inputCls} />

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPurchase(null)}>إلغاء</Btn>
              <Btn onClick={submit} disabled={!anyQty}>📤 تنفيذ المرتجع</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* عرض مرتجع */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `المرتجع ${viewing.returnNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">تكلفة/وحدة</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.landedUnitCostMinor)}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.qty * l.landedUnitCostMinor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.reason && <div className="text-[12px] text-slate-500">السبب: {viewing.reason}</div>}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{entry.entryNumber}
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
          </div>
        )}
      </Modal>
      {approval.dialog}
    </div>
  )
}
