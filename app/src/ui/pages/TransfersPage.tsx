import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * التحويلات المخزنية (استكمال المرحلة 3):
 * نقل كميات بين المخازن بمستند مرقّم TRF-#### — حركة داخلية بلا قيد
 * (قيمة المخزون 1103 لا تتغير). التحقق ضد رصيد المخزن المصدر،
 * مع جدول أرصدة لكل مخزن مشتق من الرصيد الكلي وسجل التحويلات.
 */
import { useMemo, useState } from 'react'
import { Plus, ArrowLeftRight, Eye, Warehouse, Trash2 } from 'lucide-react'
import { useDataStore, type StockTransfer } from '../../data/repo.ts'
import { computeWarehouseStock, buildWarehouseDocs } from '../../core/transfers.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'

interface DraftLine { itemId: string; qty: string }

export function TransfersPage() {
  const { transfers, warehouses, items, postTransfer, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders } = useDataStore()
  const toast = useToast()
  const whName = (id: number) => warehouses.find((w) => w.id === id)?.nameAr ?? '—'

  const stock = useMemo(() => computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders)), [items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders])

  const [tab, setTab] = usePersistedSectionView('transfers', 'list', ['list', 'balances'] as const)

  /* ─── تحويل جديد ─── */
  const [open, setOpen] = useState(false)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: '', qty: '1' }])
  const [notes, setNotes] = useState('')

  const openNew = () => {
    const main = warehouses.find((w) => w.isMain)
    setFromId(main ? String(main.id) : '')
    setToId('')
    setLines([{ itemId: '', qty: '1' }])
    setNotes('')
    setOpen(true)
  }
  const patchLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines((ls) => [...ls, { itemId: '', qty: '1' }])
  const dropLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))

  const availableIn = (warehouseId: string, itemId: string) =>
    warehouseId && itemId ? stock.get(Number(warehouseId))?.get(Number(itemId)) ?? 0 : 0

  const save = () => {
    try {
      const t = postTransfer({
        fromWarehouseId: Number(fromId),
        toWarehouseId: Number(toId),
        lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) || 0 })),
        notes,
      })
      toast.show(`رُحّل التحويل ${t.transferNumber} — ${t.totalQty} قطعة ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض ─── */
  const [viewing, setViewing] = useState<StockTransfer | null>(null)

  const listed = useMemo(() => [...transfers].reverse(), [transfers])
  const activeItems = useMemo(() => items.filter((it) => it.isActive), [items])
  const tabCls = (t: 'list' | 'balances') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-amber-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><ArrowLeftRight size={14} className="inline -mt-0.5 me-1" /> التحويلات ({transfers.length})</button>
          <button onClick={() => setTab('balances')} className={tabCls('balances')}><Warehouse size={14} className="inline -mt-0.5 me-1" /> أرصدة المخازن</button>
        </div>
        <Btn onClick={openNew} disabled={warehouses.length < 2}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> تحويل جديد</span>
        </Btn>
      </div>

      {warehouses.length < 2 && (
        <div className="anim-up rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-[12.5px] text-amber-700 dark:text-amber-400">
          التحويلات تتطلب مخزنين على الأقل — أضف مخزناً من صفحة «المخازن» أولاً.
        </div>
      )}

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🔁" title="لا تحويلات بعد" sub="حركة داخلية بين المخازن بمستند مرقّم — لا تغيّر قيمة المخزون فلا قيد لها" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">التحويل</th>
                  <th className="px-4 py-3 text-right font-bold">من</th>
                  <th className="px-4 py-3 text-right font-bold">إلى</th>
                  <th className="px-4 py-3 text-right font-bold">الأصناف</th>
                  <th className="px-4 py-3 text-right font-bold">القطع</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {listed.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-amber-600">{t.transferNumber}</div>
                      <div className="text-[10px] text-slate-400" dir="ltr">{t.date.slice(0, 10)}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{whName(t.fromWarehouseId)}</td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{whName(t.toWarehouseId)}</td>
                    <td className="px-4 py-3 text-slate-500">{t.lines.length}</td>
                    <td className="px-4 py-3 font-bold">{t.totalQty}</td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewing(t)} className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><Eye size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'balances' && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {activeItems.length === 0 ? (
            <div className="text-center text-slate-400 text-[13px] py-10">لا أصناف بعد</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">الصنف</th>
                  {warehouses.map((w) => (
                    <th key={w.id} className="px-4 py-3 text-center font-bold">{w.nameAr}{w.isMain ? ' ★' : ''}</th>
                  ))}
                  <th className="px-4 py-3 text-center font-bold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((it) => (
                  <tr key={it.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{it.nameAr}</td>
                    {warehouses.map((w) => {
                      const q = stock.get(w.id)?.get(it.id) ?? 0
                      return <td key={w.id} className={`px-4 py-2 text-center ${q < 0 ? 'text-rose-600 font-black' : q > 0 ? 'font-bold' : 'text-slate-300'}`}>{q}</td>
                    })}
                    <td className="px-4 py-2 text-center font-black">{it.stockQty ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* تحويل جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="تحويل مخزني جديد" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="من مخزن *">
              <QuickSelect value={fromId} onChange={(e) => setFromId(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}{w.isMain ? ' ★' : ''}</option>)}
              </QuickSelect>
            </Field>
            <Field label="إلى مخزن *">
              <QuickSelect value={toId} onChange={(e) => setToId(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {warehouses.filter((w) => String(w.id) !== fromId).map((w) => <option key={w.id} value={w.id}>{w.nameAr}{w.isMain ? ' ★' : ''}</option>)}
              </QuickSelect>
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-slate-500">الأصناف المنقولة</span>
              <button onClick={addLine} className="text-[11px] font-bold text-amber-600 hover:underline">+ إضافة سطر</button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_90px_28px] gap-1.5 items-center">
                <QuickSelect value={l.itemId} onChange={(e) => patchLine(i, { itemId: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`}>
                  <option value="">— اختر الصنف —</option>
                  {activeItems.map((it) => <option key={it.id} value={it.id}>{it.sku || it.barcodes?.[0] || it.id} — {it.nameAr}</option>)}
                </QuickSelect>
                <input value={l.qty} onChange={(e) => patchLine(i, { qty: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" placeholder="الكمية" />
                <div className="text-[10.5px] text-slate-400 text-center">
                  متاح: <b className={availableIn(fromId, l.itemId) > 0 ? 'text-emerald-600' : 'text-rose-500'}>{fromId && l.itemId ? availableIn(fromId, l.itemId) : '—'}</b>
                </div>
                <button onClick={() => dropLine(i)} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} shortcut="F9" disabled={!fromId || !toId || !lines.some((l) => l.itemId)}>💾 ترحيل التحويل</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض تحويل */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `التحويل ${viewing.transferNumber}` : ''}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">من</div><b>{whName(viewing.fromWarehouseId)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">إلى</div><b>{whName(viewing.toWarehouseId)}</b></div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12px]">
                <tbody>
                  {viewing.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-1.5 font-bold">{l.nameAr}</td>
                      <td className="px-4 py-1.5 font-bold text-left">{l.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewing.notes && <p className="text-[12px] text-slate-400">{viewing.notes}</p>}
            <p className="text-[11px] text-slate-400">حركة داخلية — لا قيد محاسبي (قيمة المخزون 1103 لم تتغير).</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
