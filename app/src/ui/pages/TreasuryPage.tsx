/**
 * الخزائن والبنوك — متعددة بلا حدود (طلب المالك):
 * أرصدة حية من دفتر الأستاذ + إضافة/تعديل/حذف خزائن وبنوك +
 * تحويل بين أي خزينتين + كشف حركة لكل خزينة.
 */
import { useMemo, useState } from 'react'
import { Landmark, PiggyBank, ArrowLeftRight, BookOpenText, Plus, Pencil, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import type { TreasuryDef } from '../../core/treasury.ts'
import { Btn, Modal, Field, inputCls, useToast } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { summarizeTreasuryByUser, treasuryUserSummaryCsv } from '../../core/treasuryUserReport.ts'
import { allowedTreasuryCodes } from '../../core/treasuryAccess.ts'

interface Move { date: string; description: string; inMinor: number; outMinor: number; balance: number; entryId: number }

export function TreasuryPage() {
  const { journal, treasuries, appUsers, currentUserId, postVoucher, addTreasury, renameTreasury, removeTreasury } = useDataStore()
  const activeUser = appUsers.find((user) => user.id === currentUserId)
  const visibleTreasuries = useMemo(() => {
    const visibleCodes = allowedTreasuryCodes(activeUser?.treasuryAccess, 'view_balance')
    return visibleCodes == null ? treasuries : treasuries.filter((treasury) => visibleCodes.includes(treasury.code))
  }, [activeUser?.treasuryAccess, treasuries])
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [transferOpen, setTransferOpen] = useState(false)
  const [from, setFrom] = useState('1101')
  const [to, setTo] = useState('1102')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('') // مصروف التحويل — رسوم بنكية/عمولة (طلب المالك)
  const [desc, setDesc] = useState('')
  const [statement, setStatement] = useState<string | null>(null)
  const [cashReportFrom, setCashReportFrom] = useState('')
  const [cashReportTo, setCashReportTo] = useState('')
  // إضافة/تعديل خزينة — نموذج احترافي كامل (طلب المالك)
  const [editOpen, setEditOpen] = useState(false)
  const [editCode, setEditCode] = useState<string | null>(null)
  const [tName, setTName] = useState('')
  const [tKind, setTKind] = useState<'cash' | 'bank'>('cash')
  const [tAlias, setTAlias] = useState('')
  const [tAccountNumber, setTAccountNumber] = useState('')
  const [tIban, setTIban] = useState('')
  const [tBranch, setTBranch] = useState('')
  const [tHolder, setTHolder] = useState('')
  const [tSwift, setTSwift] = useState('')
  const [tNotes, setTNotes] = useState('')

  /** رصيد وحركة كل خزينة من دفتر الأستاذ مباشرة */
  const balances = useMemo(() => {
    const map = new Map<string, { balance: number; moves: Move[] }>()
    for (const t of treasuries) map.set(t.code, { balance: 0, moves: [] })
    for (const e of journal) {
      for (const l of e.lines) {
        const acc = map.get(l.accountCode)
        if (!acc) continue
        acc.balance += l.debit - l.credit
        acc.moves.push({ date: e.date, description: e.description, inMinor: l.debit, outMinor: l.credit, balance: acc.balance, entryId: e.id })
      }
    }
    return map
  }, [journal, treasuries])
  const userCashSummary = useMemo(
    () => summarizeTreasuryByUser(journal, visibleTreasuries.map((treasury) => treasury.code), cashReportFrom || undefined, cashReportTo || undefined),
    [journal, visibleTreasuries, cashReportFrom, cashReportTo],
  )

  const nameOf = (code: string) => treasuries.find((t) => t.code === code)?.nameAr ?? code

  // تحريك النقدية بين الخزائن عملية حساسة — اعتماد مشرف (نفس صلاحية سند الصرف)
  const transferApproval = useSupervisorApproval('trs.payment.approve')
  const doTransfer = () => {
    transferApproval.request(() => {
    try {
      const feeMinor = fee ? toMinor(fee, cur.decimals) : 0
      const v = postVoucher({
        kind: 'transfer',
        treasury: from,
        counterAccountCode: to,
        amountMinor: toMinor(amount || '0', cur.decimals),
        description: desc.trim() || `تحويل من ${nameOf(from)} إلى ${nameOf(to)}`,
        feeMinor,
      })
      toast.show(`تم التحويل ${v.voucherNumber} — ${fmt(v.amountMinor)}${feeMinor ? ` + رسوم ${fmt(feeMinor)}` : ''} من ${nameOf(from)} إلى ${nameOf(to)} ✓`)
      setTransferOpen(false)
      setAmount('')
      setFee('')
      setDesc('')
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
    })
  }

  const fillForm = (t?: TreasuryDef) => {
    setTName(t?.nameAr ?? ''); setTKind(t?.kind ?? 'cash')
    setTAlias(t?.aliasAr ?? ''); setTAccountNumber(t?.accountNumber ?? '')
    setTIban(t?.iban ?? ''); setTBranch(t?.branch ?? '')
    setTHolder(t?.holderName ?? ''); setTSwift(t?.swift ?? ''); setTNotes(t?.notes ?? '')
  }
  const openAdd = () => { setEditCode(null); fillForm(); setEditOpen(true) }
  const openEdit = (t: TreasuryDef) => { setEditCode(t.code); fillForm(t); setEditOpen(true) }
  const saveTreasury = () => {
    try {
      const extra = {
        aliasAr: tAlias.trim(), accountNumber: tAccountNumber.trim(), iban: tIban.trim(),
        branch: tBranch.trim(), holderName: tHolder.trim(), swift: tSwift.trim(), notes: tNotes.trim(),
      }
      if (editCode) { renameTreasury(editCode, tName, extra); toast.show('حُفظت بيانات الخزينة/البنك ✓') }
      else { const t = addTreasury(tName, tKind, extra); toast.show(`أُضيفت «${t.nameAr}» وفُتح لها حساب ${t.code} ✓`) }
      setEditOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const remove = (t: TreasuryDef) => {
    try { removeTreasury(t.code); toast.show(`حُذفت «${t.nameAr}»`) }
    catch (e) { toast.show((e as Error).message, 'error') }
  }

  const stmt = statement ? balances.get(statement) : null
  const exportUserCashCsv = () => {
    const blob = new Blob([treasuryUserSummaryCsv(userCashSummary)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `treasury-users-${cashReportFrom || 'all'}-${cashReportTo || 'all'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between anim-up flex-wrap gap-2">
        <div className="text-sm text-slate-500">الأرصدة حية من دفتر الأستاذ — اضغط خزينة لكشف حركتها</div>
        <div className="flex gap-2">
          {/* زر الإضافة بنفس بروز زر التحويل (ملاحظة المالك: كان باهتاً وغير عملي) */}
          <Btn onClick={openAdd}><Plus size={15} /> خزينة / بنك جديد</Btn>
          <Btn onClick={() => { setAmount(''); setFee(''); setDesc(''); setTransferOpen(true) }} disabled={treasuries.length < 2}>
            <ArrowLeftRight size={15} /> تحويل بين الخزائن
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleTreasuries.map((t, i) => {
          const acc = balances.get(t.code) ?? { balance: 0, moves: [] }
          const Icon = t.kind === 'cash' ? PiggyBank : Landmark
          const color = t.kind === 'cash' ? 'from-emerald-500 to-teal-500' : 'from-sky-500 to-cyan-500'
          const glow = t.kind === 'cash' ? 'shadow-emerald-500/30' : 'shadow-sky-500/30'
          return (
            <div
              key={t.code}
              style={{ animationDelay: `${i * 60}ms` }}
              className="anim-up rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 hover:shadow-xl transition-all duration-200"
            >
              <button onClick={() => setStatement(t.code)} className="w-full text-right">
                <div className="flex items-center gap-3">
                  <span className={`w-12 h-12 rounded-2xl bg-gradient-to-l ${color} flex items-center justify-center text-white shadow-lg ${glow}`}>
                    <Icon size={22} />
                  </span>
                  <div>
                    <div className="text-[12px] font-bold text-slate-400">
                      {t.nameAr} <span className="text-[9px] opacity-60">#{t.code}</span>
                      {t.aliasAr && <span className="mr-1 text-[10px] text-slate-300 dark:text-slate-500">· {t.aliasAr}</span>}
                    </div>
                    {t.accountNumber && <div className="text-[9.5px] text-slate-300 dark:text-slate-500 font-mono" dir="ltr">{t.accountNumber}</div>}
                    <div className={`font-black text-2xl ${acc.balance < 0 ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>
                      {fmt(acc.balance)} <span className="text-xs">{cur.symbol}</span>
                    </div>
                  </div>
                </div>
              </button>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-slate-400">{acc.moves.length} حركة — اضغط لكشف الحساب</span>
                <span className="flex gap-1">
                  <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all"><Pencil size={13} /></button>
                  {t.code !== '1101' && t.code !== '1102' && (
                    <button onClick={() => remove(t)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 size={13} /></button>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {visibleTreasuries.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-sm flex-1">حركة النقدية حسب المستخدم</span>
            <label className="text-[10px] text-slate-400">من <input type="date" value={cashReportFrom} onChange={(e) => setCashReportFrom(e.target.value)} className="mr-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1" /></label>
            <label className="text-[10px] text-slate-400">إلى <input type="date" value={cashReportTo} onChange={(e) => setCashReportTo(e.target.value)} className="mr-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1" /></label>
            <button onClick={exportUserCashCsv} disabled={!userCashSummary.length} className="text-[10px] font-bold px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-600 disabled:opacity-30">تصدير CSV</button>
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-right text-slate-400"><th className="px-4 py-2">المستخدم</th><th>العمليات</th><th>قبض</th><th>صرف</th><th>الصافي</th></tr></thead>
            <tbody>
              {userCashSummary.map((row) => <tr key={row.userName} className="border-t border-slate-50 dark:border-slate-800"><td className="px-4 py-2 font-bold">{row.userName}</td><td>{row.operationsCount}</td><td className="text-emerald-600">{fmt(row.receiptsMinor)}</td><td className="text-rose-500">{fmt(row.paymentsMinor)}</td><td className="font-black">{fmt(row.netMinor)}</td></tr>)}
              {userCashSummary.length === 0 && <tr><td colSpan={5} className="p-5 text-center text-slate-400">لا توجد حركات في النطاق المحدد</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* إضافة / تعديل خزينة — نموذج احترافي بمستوى البرامج العالمية (طلب المالك) */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editCode ? '✏️ تعديل خزينة / بنك' : '🏦 خزينة / بنك جديد'} wide>
        <div className="space-y-5">
          {/* القسم 1: الهوية */}
          <div className="p-4 rounded-2xl bg-sky-500/5 border border-sky-500/20 space-y-3">
            <div className="text-[12px] font-bold text-sky-700 dark:text-sky-400">🪪 الهوية</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="الاسم *" hint="مثال: خزينة الفرع الثاني، بنك مصر، محفظة فودافون كاش…">
                <input value={tName} onChange={(e) => setTName(e.target.value)} className={inputCls} autoFocus />
              </Field>
              <Field label="اسم إضافي / رقم مختصر" hint="اسم فرعي أو رقم داخلي يظهر بجانب الاسم">
                <input value={tAlias} onChange={(e) => setTAlias(e.target.value)} className={inputCls} placeholder="درج الكاشير 2 · NBE-Main…" />
              </Field>
            </div>
            {!editCode && (
              <Field label="النوع">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setTKind('cash')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${tKind === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>💰 خزينة نقدية</button>
                  <button onClick={() => setTKind('bank')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${tKind === 'bank' ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🏦 حساب بنكي / محفظة</button>
                </div>
              </Field>
            )}
          </div>

          {/* القسم 2: البيانات البنكية — تظهر للبنوك والمحافظ */}
          {tKind === 'bank' && (
            <div className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 space-y-3">
              <div className="text-[12px] font-bold text-cyan-700 dark:text-cyan-400">🏛️ البيانات البنكية <span className="font-normal text-slate-400">(كلها اختيارية — تُطبع في المستندات وتفيد المطابقات)</span></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="رقم الحساب">
                  <input value={tAccountNumber} onChange={(e) => setTAccountNumber(e.target.value)} className={inputCls} dir="ltr" placeholder="1234567890" />
                </Field>
                <Field label="IBAN">
                  <input value={tIban} onChange={(e) => setTIban(e.target.value)} className={inputCls} dir="ltr" placeholder="EG38 0019 …" />
                </Field>
                <Field label="اسم صاحب الحساب">
                  <input value={tHolder} onChange={(e) => setTHolder(e.target.value)} className={inputCls} />
                </Field>
                <Field label="الفرع">
                  <input value={tBranch} onChange={(e) => setTBranch(e.target.value)} className={inputCls} placeholder="فرع المنصورة" />
                </Field>
                <Field label="SWIFT / BIC">
                  <input value={tSwift} onChange={(e) => setTSwift(e.target.value)} className={inputCls} dir="ltr" placeholder="NBEGEGCX" />
                </Field>
              </div>
            </div>
          )}

          <Field label="ملاحظات">
            <input value={tNotes} onChange={(e) => setTNotes(e.target.value)} className={inputCls} placeholder="حساب المرتبات، لا يُسحب منه إلا بموافقة…" />
          </Field>

          {!editCode && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              📒 سيُفتح لها حساب دفتري تلقائياً تحت «الأصول المتداولة» وتظهر فوراً في كل شاشات الدفع والتحصيل.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveTreasury} disabled={tName.trim().length < 2}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>

      {/* تحويل بين أي خزينتين */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="تحويل بين الخزائن والبنوك">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="من">
              <TreasuryPicker value={from} onChange={setFrom} operation="transfer_from" compact />
            </Field>
            <Field label="إلى">
              <TreasuryPicker value={to} onChange={setTo} operation="transfer_to" compact />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`المبلغ (${cur.symbol})`}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" autoFocus />
            </Field>
            <Field label={`مصروف التحويل (${cur.symbol})`} hint="رسوم بنكية/عمولة — يخرج من المصدر ويقيد مصروفاً عمومياً">
              <input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" className={inputCls} dir="ltr" />
            </Field>
          </div>
          {Number(fee) > 0 && Number(amount) > 0 && (
            <p className="text-[11px] font-bold text-amber-600">
              ⚠️ سيخرج من {nameOf(from)}: {fmt(toMinor(amount || '0', cur.decimals) + toMinor(fee, cur.decimals))} — يصل {fmt(toMinor(amount || '0', cur.decimals))} والرسوم {fmt(toMinor(fee, cur.decimals))} مصروف
            </p>
          )}
          <Field label="البيان (اختياري)">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setTransferOpen(false)}>إلغاء</Btn>
            <Btn onClick={doTransfer} disabled={!amount.trim() || from === to}>↔️ تنفيذ التحويل</Btn>
          </div>
        </div>
      </Modal>

      {/* كشف حساب خزينة */}
      <Modal open={!!statement} onClose={() => setStatement(null)} title={statement ? `كشف حركة — ${nameOf(statement)}` : ''} wide>
        {stmt && (
          <div className="space-y-3">
            {stmt.moves.length === 0 ? (
              <div className="text-center text-sm text-slate-400 py-8">لا حركات بعد</div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-3 py-2">التاريخ</th>
                    <th className="px-3 py-2">البيان</th>
                    <th className="px-3 py-2 text-left">داخل</th>
                    <th className="px-3 py-2 text-left">خارج</th>
                    <th className="px-3 py-2 text-left">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stmt.moves].reverse().map((m, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 text-slate-400 text-[11px]">{m.date}</td>
                      <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">
                        {m.description}
                        <span className="text-[10px] text-rose-400 mr-2 inline-flex items-center gap-0.5"><BookOpenText size={10} />#{m.entryId}</span>
                      </td>
                      <td className="px-3 py-2 text-left font-bold text-emerald-600">{m.inMinor ? fmt(m.inMinor) : ''}</td>
                      <td className="px-3 py-2 text-left font-bold text-rose-500">{m.outMinor ? fmt(m.outMinor) : ''}</td>
                      <td className={`px-3 py-2 text-left font-black ${m.balance < 0 ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>{fmt(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>
      {transferApproval.dialog}
    </div>
  )
}
