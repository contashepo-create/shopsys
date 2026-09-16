/**
 * عمولاتي لدى الغير (طلب المالك): الطبيب/المالك له عمولات مستحقة عند جهات
 * خارجية (مركز أشعة، معمل، مستشفى…) — تسجيل الاستحقاق بقيد 1112/4112،
 * والتحصيل بقيد خزينة/1112 — مع متابعة المتبقي لدى كل جهة.
 */
import { useMemo, useState } from 'react'
import { HandCoins, Plus, Landmark } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function ExternalCommissionsPage() {
  const { externalCommissions, addExternalCommission, collectExternalCommission } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toM = (v: string) => (v.trim() ? toMinor(v, cur.decimals) : 0)

  const totals = useMemo(() => {
    let due = 0, collected = 0
    for (const c of externalCommissions) { due += c.amountMinor; collected += c.collectedMinor }
    return { due, collected, remaining: due - collected }
  }, [externalCommissions])

  /* إضافة استحقاق */
  const [open, setOpen] = useState(false)
  const [party, setParty] = useState('')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const parties = useMemo(() => [...new Set(externalCommissions.map((c) => c.partyName))], [externalCommissions])
  const save = () => {
    try {
      const c = addExternalCommission({ partyName: party, amountMinor: toM(amount), description: desc })
      toast.show(`سُجّلت العمولة ${c.commissionNumber} لدى «${c.partyName}» وتولّد قيد الاستحقاق ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* تحصيل */
  const [collectId, setCollectId] = useState<number | null>(null)
  const collecting = collectId != null ? externalCommissions.find((c) => c.id === collectId) : null
  const [colAmount, setColAmount] = useState('')
  const [colTreasury, setColTreasury] = useState('1101')
  const doCollect = () => {
    if (!collecting) return
    try {
      collectExternalCommission({ commissionId: collecting.id, amountMinor: toM(colAmount), treasury: colTreasury as '1101' })
      toast.show('حُصّلت الدفعة وتولّد قيدها ✅')
      setCollectId(null)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="grid grid-cols-3 gap-2 text-center text-[11.5px]">
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">إجمالي المستحق</div>
            <b>{fmt(totals.due)}</b>
          </div>
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">المحصَّل</div>
            <b className="text-emerald-600">{fmt(totals.collected)}</b>
          </div>
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">المتبقي لدى الغير</div>
            <b className="text-amber-600">{fmt(totals.remaining)}</b>
          </div>
        </div>
        <Btn onClick={() => { setParty(''); setAmount(''); setDesc(''); setOpen(true) }}>
          <Plus size={15} /> عمولة مستحقة جديدة
        </Btn>
      </div>

      {externalCommissions.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🤝" title="لا عمولات لدى الغير بعد" sub="سجّل عمولاتك المستحقة عند مراكز الأشعة والمعامل والمستشفيات — بقيد استحقاق موثق وتحصيل متابع" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 text-right font-bold">العمولة</th>
                <th className="px-4 py-3 text-right font-bold">الجهة</th>
                <th className="px-4 py-3 text-right font-bold">المستحق</th>
                <th className="px-4 py-3 text-right font-bold">المحصَّل</th>
                <th className="px-4 py-3 text-right font-bold">المتبقي</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...externalCommissions].reverse().map((c) => {
                const remaining = c.amountMinor - c.collectedMinor
                return (
                  <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-700 dark:text-slate-200">{c.commissionNumber}</div>
                      <div className="text-[10px] text-slate-400"><span dir="ltr">{c.date.slice(0, 10)}</span>{c.description ? ` — ${c.description}` : ''}</div>
                    </td>
                    <td className="px-4 py-3 font-bold">{c.partyName}</td>
                    <td className="px-4 py-3 font-bold">{fmt(c.amountMinor)}</td>
                    <td className="px-4 py-3 text-emerald-600">{fmt(c.collectedMinor)}</td>
                    <td className={`px-4 py-3 font-black ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {remaining > 0 ? fmt(remaining) : 'مُحصَّلة ✓'}
                    </td>
                    <td className="px-4 py-3 text-left">
                      {remaining > 0 && (
                        <Btn variant="soft" onClick={() => { setCollectId(c.id); setColAmount('') }}>
                          <HandCoins size={14} /> تحصيل
                        </Btn>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* استحقاق جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عمولة مستحقة لدى جهة خارجية">
        <div className="space-y-3">
          <div className="text-[12px] text-slate-500 leading-relaxed flex items-start gap-2">
            <Landmark size={26} className="text-violet-500 shrink-0" />
            مثال: حوّلت مريضاً لمركز أشعة ولك 10% عمولة — سجّلها هنا لتتابع تحصيلها.
            يتولد قيد: <b>عمولات مستحقة لدى الغير (1112) / إيرادات عمولات خارجية (4112)</b>
          </div>
          <Field label="اسم الجهة *">
            <input value={party} onChange={(e) => setParty(e.target.value)} className={inputCls} placeholder="مركز أشعة النور، معمل الشفا…" list="exc-parties" />
            <datalist id="exc-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`المبلغ (${cur.symbol}) *`}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label="البيان">
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} placeholder="عمولة تحويلات شهر 9…" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!party.trim() || !amount.trim()}>💾 تسجيل الاستحقاق</Btn>
          </div>
        </div>
      </Modal>

      {/* تحصيل */}
      <Modal open={!!collecting} onClose={() => setCollectId(null)} title={collecting ? `تحصيل من «${collecting.partyName}»` : ''}>
        {collecting && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500">
              المتبقي لدى الجهة: <b className="text-amber-600">{fmt(collecting.amountMinor - collecting.collectedMinor)} {cur.symbol}</b>
            </div>
            <Field label={`المبلغ المحصَّل (${cur.symbol}) *`}>
              <input value={colAmount} onChange={(e) => setColAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" autoFocus />
            </Field>
            <Field label="الإيداع في">
              <TreasuryPicker value={colTreasury} onChange={setColTreasury} compact />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCollectId(null)}>إلغاء</Btn>
              <Btn onClick={doCollect} disabled={!colAmount.trim()}>💰 تحصيل وتوليد القيد</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
