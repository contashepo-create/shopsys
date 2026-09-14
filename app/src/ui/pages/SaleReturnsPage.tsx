/**
 * مرتجعات المبيعات (المرحلة 3) — دائماً عن فاتورة أصلية:
 * اختر الفاتورة ← حدد الكميات (لا تتجاوز المتبقي) ← نقدي/خصم من حساب العميل
 * ← يتولد القيد العاكس تلقائياً وتعود البضاعة للمخزون.
 */
import { useMemo, useState } from 'react'
import { RotateCcw, Search, BookOpenText, Eye } from 'lucide-react'
import { useDataStore, type SaleInvoice, type SaleReturn } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { remainingReturnable } from '../../core/returns.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function SaleReturnsPage() {
  const { sales, saleReturns, customers, journal, postSaleReturn } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [pickOpen, setPickOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [sale, setSale] = useState<SaleInvoice | null>(null)
  const [qtys, setQtys] = useState<Record<number, string>>({})
  const [refund, setRefund] = useState<'cash' | 'credit'>('cash')
  const [reason, setReason] = useState('')
  const [viewing, setViewing] = useState<SaleReturn | null>(null)

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  /** المتبقي القابل للإرجاع للفاتورة المختارة */
  const remaining = useMemo(() => {
    if (!sale) return new Map<number, number>()
    const prior = saleReturns.filter((r) => r.saleId === sale.id).flatMap((r) => r.lines)
    return remainingReturnable(sale.lines, prior)
  }, [sale, saleReturns])

  const pickable = useMemo(() => {
    const q = pickQuery.trim()
    return [...sales].reverse().filter((s) => !q || s.invoiceNumber.includes(q)).slice(0, 20)
  }, [sales, pickQuery])

  const startReturn = (s: SaleInvoice) => {
    setSale(s)
    setQtys({})
    setRefund(s.customerId ? 'credit' : 'cash')
    setReason('')
    setPickOpen(false)
  }

  const submit = () => {
    if (!sale) return
    try {
      const map = new Map<number, number>()
      for (const [id, v] of Object.entries(qtys)) {
        const n = Number(v)
        if (n > 0) map.set(Number(id), n)
      }
      const ret = postSaleReturn({ saleId: sale.id, qtyByItem: map, refund, reason: reason.trim() })
      toast.show(`تم المرتجع ${ret.returnNumber} — عادت البضاعة للمخزون وتولد القيد العاكس ✓`)
      setSale(null)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const anyQty = Object.values(qtys).some((v) => Number(v) > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up">
        <div className="text-sm text-slate-500">
          المرتجع بنفس أسعار وخصومات البيع الأصلي — ولا يُرجَع أكثر مما بيع
        </div>
        <Btn onClick={() => { setPickQuery(''); setPickOpen(true) }} disabled={sales.length === 0}>
          <RotateCcw size={15} /> مرتجع جديد
        </Btn>
      </div>

      {saleReturns.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="↩️" title="لا مرتجعات بعد" sub={sales.length ? 'اضغط «مرتجع جديد» واختر الفاتورة الأصلية' : 'لا فواتير مبيعات أصلاً — المرتجع دائماً عن فاتورة'} />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">المرتجع</th>
                <th className="px-4 py-3 font-bold">عن الفاتورة</th>
                <th className="px-4 py-3 font-bold">الاسترداد</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">القيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {[...saleReturns].reverse().map((r, i) => {
                const orig = sales.find((s) => s.id === r.saleId)
                return (
                  <tr key={r.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{r.returnNumber}</div>
                      <div className="text-[11px] text-slate-400">{r.date.slice(0, 16).replace('T', ' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig?.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${r.refund === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600'}`}>
                        {r.refund === 'cash' ? '💵 نقدي' : '👥 خصم من حساب العميل'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-black text-rose-500">-{fmt(r.totals.totalMinor)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                        <BookOpenText size={11} /> قيد #{r.journalEntryId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewing(r)} className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110">
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

      {/* اختيار الفاتورة الأصلية */}
      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="اختر الفاتورة الأصلية">
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="رقم الفاتورة… S-0001" className={`${inputCls} pr-9`} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {pickable.map((s) => (
              <button key={s.id} onClick={() => startReturn(s)} className="w-full text-right px-3 py-2.5 hover:bg-emerald-500/5 transition-colors flex items-center justify-between gap-2">
                <span>
                  <b className="text-slate-800 dark:text-white">{s.invoiceNumber}</b>
                  <span className="text-[11px] text-slate-400 mr-2">{s.date.slice(0, 10)} · {s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr : 'عميل نقدي'}</span>
                </span>
                <b className="text-emerald-600">{fmt(s.totals.totalMinor)}</b>
              </button>
            ))}
            {pickable.length === 0 && <div className="text-center text-sm text-slate-400 py-6">لا نتائج</div>}
          </div>
        </div>
      </Modal>

      {/* نموذج المرتجع */}
      <Modal open={!!sale} onClose={() => setSale(null)} title={sale ? `مرتجع عن الفاتورة ${sale.invoiceNumber}` : ''} wide>
        {sale && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th>
                  <th className="px-3 py-2">المباع</th>
                  <th className="px-3 py-2">المتبقي القابل للإرجاع</th>
                  <th className="px-3 py-2 w-28">كمية الإرجاع</th>
                </tr>
              </thead>
              <tbody>
                {[...new Map(sale.lines.map((l) => [l.itemId, l])).values()].map((l) => {
                  const sold = sale.lines.filter((x) => x.itemId === l.itemId).reduce((a, x) => a + x.qty, 0)
                  const rem = remaining.get(l.itemId) ?? 0
                  return (
                    <tr key={l.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 font-bold">{l.soldByWeight && '⚖️ '}{l.nameAr}</td>
                      <td className="px-3 py-2">{sold}</td>
                      <td className={`px-3 py-2 font-bold ${rem > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{rem}</td>
                      <td className="px-3 py-2">
                        <input
                          value={qtys[l.itemId] ?? ''}
                          onChange={(e) => setQtys((q) => ({ ...q, [l.itemId]: e.target.value }))}
                          placeholder="0"
                          disabled={rem <= 0}
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
              >💵 رد نقدي من الخزينة</button>
              <button
                onClick={() => setRefund('credit')}
                disabled={!sale.customerId}
                className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all disabled:opacity-40 ${refund === 'credit' ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >👥 خصم من حساب العميل {!sale.customerId && '(عميل نقدي)'}</button>
            </div>

            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإرجاع (اختياري): تالف، غير مطابق…" className={inputCls} />

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setSale(null)}>إلغاء</Btn>
              <Btn onClick={submit} disabled={!anyQty}>↩️ تنفيذ المرتجع</Btn>
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
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">سعر</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.reason && <div className="text-[12px] text-slate-500">السبب: {viewing.reason}</div>}
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
          </div>
        )}
      </Modal>
    </div>
  )
}
