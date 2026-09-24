/**
 * العمولات — قسمان بتبويبين لكل قسم (طلب المالك):
 * «عمولات لدى الغير (لي)»: إيراد 4112 يُثبت عند الاستحقاق (1112) ويُحصَّل من الخزينة/البنك
 * «عمولات للغير (عليّ)»: مصروف 5113 يُثبت عند الاستحقاق (2114) ويُدفع من الخزينة/البنك
 * والأشخاص/الجهات مسجلون في سجل خاص — لا تُسجَّل عمولة لطرف غير مسجل.
 * معمم على كل الأنشطة: سمسار، مندوب، طبيب محيل، وسيط شحن…
 */
import { useMemo, useState } from 'react'
import { Plus, HandCoins, Users2, Trash2, Pencil, BookOpenText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COMMISSION_DIRECTION_LABELS, commissionsByParty, type CommissionDirection } from '../../core/commissions.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { accountName } from './accountNames.ts'

export function ExternalCommissionsPage() {
  const {
    externalCommissions, commissionParties, journal, treasuries, paymentTerminals,
    addCommissionParty, updateCommissionParty, deleteCommissionParty,
    addExternalCommission, collectExternalCommission,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* القسم النشط + التبويب النشط داخله */
  const [direction, setDirection] = useState<CommissionDirection>('earned')
  const [tab, setTab] = useState<'commissions' | 'parties'>('commissions')
  const rows = useMemo(
    () => externalCommissions.filter((c) => (c.direction ?? 'earned') === direction).reverse(),
    [externalCommissions, direction],
  )
  const byParty = useMemo(() => commissionsByParty(externalCommissions.map((c) => ({ ...c, direction: c.direction ?? 'earned' })), direction), [externalCommissions, direction])

  /* ─── تسجيل عمولة ─── */
  const [open, setOpen] = useState(false)
  const [partyId, setPartyId] = useState('')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const saveCommission = () => {
    try {
      const c = addExternalCommission({
        direction, partyId: Number(partyId),
        amountMinor: toMinor(amount || '0', cur.decimals), description: desc,
      })
      toast.show(`سُجلت العمولة ${c.commissionNumber} وتولد قيد الاستحقاق ✅`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── تحصيل/دفع ─── */
  const [settleId, setSettleId] = useState<number | null>(null)
  const settling = settleId != null ? externalCommissions.find((c) => c.id === settleId) : null
  const [settleAmount, setSettleAmount] = useState('')
  const [treasury, setTreasury] = useState(treasuries[0]?.code ?? '1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const settle = () => {
    if (!settling) return
    try {
      const terminal = paymentTerminals.find((row) => row.id === terminalPayment.terminalId)
      const u = collectExternalCommission({
        commissionId: settling.id,
        amountMinor: toMinor(settleAmount || '0', cur.decimals),
        treasury: (terminal?.settlementAccountCode ?? treasury) as '1101',
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
      })
      toast.show(direction === 'earned' ? `حُصِّل من ${u.partyName} ✓` : `سُدد لـ${u.partyName} ✓`)
      setSettleId(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── سجل الأشخاص ─── */
  const [partyModal, setPartyModal] = useState(false)
  const [editingPartyId, setEditingPartyId] = useState<number | null>(null)
  const [pName, setPName] = useState('')
  const [pPhone, setPPhone] = useState('')
  const [pKind, setPKind] = useState('')
  const [pNotes, setPNotes] = useState('')
  const openParty = (id?: number) => {
    const p = id != null ? commissionParties.find((x) => x.id === id) : null
    setEditingPartyId(p?.id ?? null)
    setPName(p?.nameAr ?? ''); setPPhone(p?.phone ?? ''); setPKind(p?.kind ?? ''); setPNotes(p?.notes ?? '')
    setPartyModal(true)
  }
  const saveParty = () => {
    try {
      if (editingPartyId != null) {
        updateCommissionParty(editingPartyId, { nameAr: pName, phone: pPhone, kind: pKind, notes: pNotes })
        toast.show('حُدّثت بيانات الطرف ✓')
      } else {
        const p = addCommissionParty({ nameAr: pName, phone: pPhone, kind: pKind, notes: pNotes })
        toast.show(`سُجل ${p.nameAr} (${p.code}) ✅`)
      }
      setPartyModal(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const removeParty = (id: number) => {
    try { deleteCommissionParty(id); toast.show('حُذف الطرف ✓') }
    catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── عرض عمولة وقيودها ─── */
  const [viewingId, setViewingId] = useState<number | null>(null)
  const viewing = viewingId != null ? externalCommissions.find((c) => c.id === viewingId) : null
  const viewingEntries = viewing
    ? journal.filter((e) => e.id === viewing.journalEntryId || viewing.collections.some((cl) => cl.journalEntryId === e.id))
    : []

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
  const dirMeta = COMMISSION_DIRECTION_LABELS[direction]
  const tabActive = direction === 'earned' ? 'bg-emerald-600 text-white shadow-md' : 'bg-rose-600 text-white shadow-md'
  const totals = useMemo(() => {
    let total = 0, settled = 0
    for (const r of rows) { total += r.amountMinor; settled += r.collectedMinor }
    return { total, settled, remaining: total - settled }
  }, [rows])

  return (
    <div className="space-y-4">
      {/* القسمان */}
      <div className="anim-up grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(COMMISSION_DIRECTION_LABELS) as CommissionDirection[]).map((d) => {
          const m = COMMISSION_DIRECTION_LABELS[d]
          const active = direction === d
          return (
            <button
              key={d}
              onClick={() => { setDirection(d); setTab('commissions') }}
              className={`text-right p-4 rounded-2xl border-2 transition-all ${
                active
                  ? d === 'earned' ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-rose-500/50 bg-rose-500/5'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className={`font-black text-[14px] ${active ? (d === 'earned' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') : 'text-slate-600 dark:text-slate-300'}`}>
                {m.icon} {m.nameAr}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{m.desc}</div>
            </button>
          )
        })}
      </div>

      {/* التبويبان + زر */}
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab('commissions')} className={`px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === 'commissions' ? tabActive : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            <HandCoins size={14} className="inline -mt-0.5 me-1" /> تسجيل العمولات ({rows.length})
          </button>
          <button onClick={() => setTab('parties')} className={`px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === 'parties' ? tabActive : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            <Users2 size={14} className="inline -mt-0.5 me-1" /> الأشخاص المتعامل معهم ({commissionParties.length})
          </button>
        </div>
        {tab === 'commissions'
          ? <Btn onClick={() => { setPartyId(''); setAmount(''); setDesc(''); setOpen(true) }}><Plus size={15} /> عمولة جديدة</Btn>
          : <Btn onClick={() => openParty()}><Plus size={15} /> شخص/جهة جديدة</Btn>}
      </div>

      {tab === 'commissions' && (
        <>
          {/* ملخص */}
          <div className="anim-up grid grid-cols-3 gap-3">
            <div className={`${card} p-4`}>
              <div className="text-[11px] text-slate-400 font-bold">إجمالي المستحق</div>
              <div className="font-black text-lg mt-1">{fmt(totals.total)} {cur.symbol}</div>
            </div>
            <div className={`${card} p-4`}>
              <div className="text-[11px] text-slate-400 font-bold">{direction === 'earned' ? 'المحصَّل' : 'المدفوع'}</div>
              <div className="font-black text-lg text-emerald-600 mt-1">{fmt(totals.settled)}</div>
            </div>
            <div className={`${card} p-4`}>
              <div className="text-[11px] text-slate-400 font-bold">المتبقي</div>
              <div className={`font-black text-lg mt-1 ${direction === 'earned' ? 'text-sky-600' : 'text-rose-500'}`}>{fmt(totals.remaining)}</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className={card}>
              <EmptyState icon={dirMeta.icon} title={`لا ${dirMeta.nameAr.split(' (')[0]} بعد`} sub="سجّل الطرف أولاً في تبويب «الأشخاص المتعامل معهم» ثم أضف عمولته" />
            </div>
          ) : (
            <div className={`anim-up ${card} overflow-hidden`}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 font-bold">العمولة</th>
                    <th className="px-4 py-3 font-bold">الشخص/الجهة</th>
                    <th className="px-4 py-3 font-bold">البيان</th>
                    <th className="px-4 py-3 font-bold">المبلغ</th>
                    <th className="px-4 py-3 font-bold">{direction === 'earned' ? 'المحصَّل' : 'المدفوع'}</th>
                    <th className="px-4 py-3 font-bold">المتبقي</th>
                    <th className="px-4 py-3 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const remaining = c.amountMinor - c.collectedMinor
                    return (
                      <tr key={c.id} onClick={() => setViewingId(c.id)} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-500/[0.03] transition-colors cursor-pointer">
                        <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{c.commissionNumber}<div className="text-[10px] text-slate-400 font-normal" dir="ltr">{c.date.slice(0, 10)}</div></td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.partyName}</td>
                        <td className="px-4 py-3 text-slate-500 text-[12px]">{c.description || '—'}</td>
                        <td className="px-4 py-3 font-black">{fmt(c.amountMinor)}</td>
                        <td className="px-4 py-3 text-emerald-600 font-bold">{fmt(c.collectedMinor)}</td>
                        <td className={`px-4 py-3 font-bold ${remaining > 0 ? (direction === 'earned' ? 'text-sky-600' : 'text-rose-500') : 'text-slate-300'}`}>{fmt(remaining)}</td>
                        <td className="px-4 py-3">
                          {remaining > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setSettleId(c.id); setSettleAmount(String(remaining / 10 ** cur.decimals)) }}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${direction === 'earned' ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20' : 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'}`}
                            >
                              {direction === 'earned' ? '💰 تحصيل' : '📤 دفع'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ملخص حسب الشخص */}
          {byParty.length > 0 && (
            <div className={`anim-up ${card} overflow-hidden`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">حسب الشخص/الجهة</div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {byParty.map((p, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{p.partyName} <span className="text-[10px] text-slate-400 font-normal">({p.count} عمولة)</span></td>
                      <td className="px-4 py-2.5 text-slate-500">إجمالي {fmt(p.totalMinor)}</td>
                      <td className="px-4 py-2.5 text-emerald-600 font-bold">{direction === 'earned' ? 'حُصِّل' : 'دُفع'} {fmt(p.settledMinor)}</td>
                      <td className={`px-4 py-2.5 font-black text-left ${p.remainingMinor > 0 ? (direction === 'earned' ? 'text-sky-600' : 'text-rose-500') : 'text-slate-300'}`}>متبقٍ {fmt(p.remainingMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'parties' && (
        commissionParties.length === 0 ? (
          <div className={card}>
            <EmptyState icon="👥" title="لا أشخاص مسجلين بعد" sub="سجّل السماسرة والمندوبين والجهات هنا أولاً — لا تُسجَّل عمولة لطرف غير مسجل" />
          </div>
        ) : (
          <div className={`anim-up ${card} overflow-hidden`}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 font-bold">الكود</th>
                  <th className="px-4 py-3 font-bold">الاسم</th>
                  <th className="px-4 py-3 font-bold">الصفة</th>
                  <th className="px-4 py-3 font-bold">الهاتف</th>
                  <th className="px-4 py-3 font-bold">ملاحظات</th>
                  <th className="px-4 py-3 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {commissionParties.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-500/[0.03] transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400" dir="ltr">{p.code}</td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{p.nameAr}</td>
                    <td className="px-4 py-3 text-slate-500">{p.kind || '—'}</td>
                    <td className="px-4 py-3 text-slate-500" dir="ltr">{p.phone || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-[12px]">{p.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openParty(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Pencil size={14} /></button>
                        <button onClick={() => removeParty(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* عمولة جديدة */}
      <Modal open={open} onClose={() => setOpen(false)} title={`${dirMeta.icon} عمولة جديدة — ${dirMeta.nameAr}`}>
        <div className="space-y-3">
          <Field label="الشخص/الجهة (من السجل)" hint="غير موجود؟ سجّله أولاً من تبويب «الأشخاص المتعامل معهم»">
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputCls}>
              <option value="">اختر…</option>
              {commissionParties.map((p) => <option key={p.id} value={p.id}>{p.nameAr}{p.kind ? ` — ${p.kind}` : ''}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`المبلغ (${cur.symbol})`}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" autoFocus />
            </Field>
            <Field label="البيان">
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} placeholder="عمولة بيع شقة، إحالة مريض…" />
            </Field>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[11px] text-slate-500 leading-relaxed">
            {direction === 'earned'
              ? 'قيد الاستحقاق: عمولات مستحقة لدى الغير (1112) مدين ← إيراد عمولات (4112) دائن — والتحصيل لاحقاً يدخل الخزينة/البنك.'
              : 'قيد الاستحقاق: مصروف عمولات للغير (5113) مدين ← عمولات مستحقة للغير (2114) دائن — والدفع لاحقاً يخرج من الخزينة/البنك.'}
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveCommission} shortcut="F9" disabled={!partyId || !amount.trim()}>💾 تسجيل واستحقاق</Btn>
          </div>
        </div>
      </Modal>

      {/* تحصيل/دفع */}
      <Modal open={!!settling} onClose={() => setSettleId(null)} title={settling ? (direction === 'earned' ? `💰 تحصيل ${settling.commissionNumber} من ${settling.partyName}` : `📤 دفع ${settling.commissionNumber} لـ${settling.partyName}`) : ''}>
        {settling && (
          <div className="space-y-3">
            <Field label={`المبلغ (المتبقي ${fmt(settling.amountMinor - settling.collectedMinor)} ${cur.symbol})`}>
              <input value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} className={inputCls} dir="ltr" autoFocus />
            </Field>
            {direction === 'earned' ? <Field label="يدخل في"><PaymentMethodPicker value={{treasury,terminalPayment}} onChange={value=>{setTreasury(value.treasury);setTerminalPayment(value.terminalPayment)}} operation="receipt"/></Field> : <Field label="يُدفع من"><TreasuryPicker value={treasury} onChange={setTreasury} operation="payment" /></Field>}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setSettleId(null)}>إلغاء</Btn>
              <Btn onClick={settle} shortcut="F9" disabled={!settleAmount.trim()}>{direction === 'earned' ? '💰 تحصيل' : '📤 دفع'} وقيد</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* شخص/جهة جديدة أو تعديل */}
      <Modal open={partyModal} onClose={() => setPartyModal(false)} title={editingPartyId != null ? '✏️ تعديل بيانات الطرف' : '👥 شخص/جهة عمولات جديدة'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم (إلزامي)">
              <input value={pName} onChange={(e) => setPName(e.target.value)} className={inputCls} placeholder="أحمد السمسار، مركز أشعة النور…" autoFocus />
            </Field>
            <Field label="الصفة">
              <input value={pKind} onChange={(e) => setPKind(e.target.value)} className={inputCls} placeholder="سمسار، مندوب، مركز أشعة…" />
            </Field>
            <Field label="الهاتف">
              <input value={pPhone} onChange={(e) => setPPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
            </Field>
            <Field label="ملاحظات">
              <input value={pNotes} onChange={(e) => setPNotes(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPartyModal(false)}>إلغاء</Btn>
            <Btn onClick={saveParty} disabled={!pName.trim()}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض عمولة وقيودها */}
      <Modal open={!!viewing} onClose={() => setViewingId(null)} title={viewing ? `${viewing.commissionNumber} — ${viewing.partyName}` : ''} wide>
        {viewing && (
          <div className="space-y-3">
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
              <div className="font-black text-2xl">{fmt(viewing.amountMinor)} {cur.symbol}</div>
              <div className="text-[12px] text-slate-400 mt-1">{viewing.description || dirMeta.nameAr} · {(viewing.direction ?? 'earned') === 'earned' ? 'محصَّل' : 'مدفوع'} {fmt(viewing.collectedMinor)}</div>
            </div>
            {viewingEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-amber-600 dark:text-amber-400 border-b border-amber-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> قيد #{entry.entryNumber} — {entry.description}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-amber-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {accountName(l.accountCode)}</td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
