import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * ملفات عهد الموظفين — نظام متكامل (طلب المالك، مرجعية pro-acc):
 * فتح ملف (بلا قيد) ← تعزيزات من خزينة/بنك ← مصروفات وفواتير تُخصم منه
 * ← تسوية: مرتجع نقدي + عجز يصير سلفة تُخصم من الراتب على دفعات.
 * زيادة المصاريف عن العهدة تُسجَّل مستحقاً للموظف وتُصرف مع راتبه.
 */
import { useMemo, useState } from 'react'
import { Plus, Wallet, Receipt, Scale, Eye, HandCoins, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { summarizeCustody, CUSTODY_TX_LABELS, type CustodyFile } from '../../core/custody.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function CustodyPage() {
  const {
    custodyFiles, custodyTxs, employees, projects, journal,
    openCustodyFile, fundCustodyFile, postCustodyExpense, settleCustodyFile, getEmployeeExcessDue,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const empName = (id: number) => employees.find((e) => e.id === id)?.nameAr ?? '—'
  const projName = (id: number | null) => (id == null ? null : projects.find((p) => p.id === id)?.nameAr ?? null)

  /* ─── فتح ملف ─── */
  const [openModal, setOpenModal] = useState(false)
  const [fEmployeeId, setFEmployeeId] = useState(0)
  const [fProjectId, setFProjectId] = useState('')
  const [fReason, setFReason] = useState('')
  const [fNotes, setFNotes] = useState('')
  const doOpenFile = () => {
    try {
      const f = openCustodyFile({
        employeeId: fEmployeeId, projectId: fProjectId ? Number(fProjectId) : null,
        reason: fReason, notes: fNotes.trim(),
      })
      toast.show(`فُتح الملف ${f.fileNumber} لـ${empName(f.employeeId)} — سجّل أول عهدة فيه الآن 📂`)
      setOpenModal(false)
      setViewingId(f.id)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── عرض ملف ─── */
  const [viewingId, setViewingId] = useState<number | null>(null)
  const viewing: CustodyFile | null = viewingId != null ? custodyFiles.find((f) => f.id === viewingId) ?? null : null
  const viewTxs = useMemo(() => custodyTxs.filter((t) => t.fileId === viewingId), [custodyTxs, viewingId])
  const viewSummary = useMemo(() => summarizeCustody(viewTxs), [viewTxs])

  /* ─── تعزيز ─── */
  const [fundOpen, setFundOpen] = useState(false)
  const [fundAmount, setFundAmount] = useState('')
  const [fundTreasury, setFundTreasury] = useState('1101')
  const [fundDesc, setFundDesc] = useState('')
  const doFund = () => {
    if (!viewing) return
    try {
      fundCustodyFile({ fileId: viewing.id, amountMinor: toMinor(fundAmount || '0', cur.decimals), treasury: fundTreasury, description: fundDesc.trim() })
      toast.show('عُزّزت العهدة بقيد متوازن (1108 ← الخزينة المختارة) ✅')
      setFundOpen(false); setFundAmount(''); setFundDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── مصروف ─── */
  const [expOpen, setExpOpen] = useState(false)
  const [expAmount, setExpAmount] = useState('')
  const [expDesc, setExpDesc] = useState('')
  const [expProjectId, setExpProjectId] = useState('')
  const [expAllowExcess, setExpAllowExcess] = useState(false)
  const doExpense = () => {
    if (!viewing) return
    try {
      const tx = postCustodyExpense({
        fileId: viewing.id, amountMinor: toMinor(expAmount || '0', cur.decimals),
        description: expDesc, projectId: expProjectId ? Number(expProjectId) : viewing.projectId,
        allowExcess: expAllowExcess,
      })
      toast.show(tx.excessMinor > 0
        ? `سُجل المصروف — منه ${fmt(tx.excessMinor)} زيادة مستحقة للموظف تُصرف مع راتبه ✅`
        : 'سُجل المصروف وخُصم من العهدة ✅')
      setExpOpen(false); setExpAmount(''); setExpDesc(''); setExpAllowExcess(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── تسوية ─── */
  const [settleOpen, setSettleOpen] = useState(false)
  const [returnAmount, setReturnAmount] = useState('')
  const [settleTreasury, setSettleTreasury] = useState('1101')
  const doSettle = () => {
    if (!viewing) return
    try {
      const f = settleCustodyFile({ fileId: viewing.id, returnedMinor: toMinor(returnAmount || '0', cur.decimals), treasury: settleTreasury })
      toast.show(f.shortageMinor > 0
        ? `سُوّي ${f.fileNumber}: مرتجع ${fmt(f.returnedMinor)} + عجز ${fmt(f.shortageMinor)} سلفة تُخصم من راتبه بحريتك ✓`
        : `سُوّي ${f.fileNumber} وأُغلق — المرتجع ${fmt(f.returnedMinor)} عاد للخزينة 🎉`)
      setSettleOpen(false); setReturnAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const openFiles = custodyFiles.filter((f) => f.status === 'open')
  const viewEntries = useMemo(() => {
    const ids = new Set(viewTxs.map((t) => t.journalEntryId).filter((x) => x != null))
    return journal.filter((e) => ids.has(e.id))
  }, [viewTxs, journal])

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><HandCoins className="w-6 h-6 text-orange-500" /> ملفات عهد الموظفين</h1>
        <Btn onClick={() => { setFEmployeeId(employees[0]?.id ?? 0); setFProjectId(''); setFReason(''); setFNotes(''); setOpenModal(true) }} disabled={employees.length === 0}>
          <Plus size={15} /> فتح ملف عهدة
        </Btn>
      </div>
      {employees.length === 0 && (
        <div className="text-[12px] text-amber-600 bg-amber-500/10 rounded-xl p-3">سجّل موظفاً واحداً على الأقل من «العملاء والموظفون ← الموظفون» أولاً</div>
      )}

      {custodyFiles.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📂" title="لا ملفات عهد بعد" sub="افتح ملفاً لموظف، ثم سجّل أول عهدة فيه — التعزيزات والمصروفات والفواتير كلها تظهر في الملف مقابل بعضها" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                {['الملف', 'الموظف', 'المشروع', 'التعزيزات', 'المنصرف', 'المتبقي', 'الحالة', ''].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...custodyFiles].reverse().map((f, i) => {
                const sum = summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id))
                return (
                  <tr key={f.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-orange-500/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{f.fileNumber}</div>
                      <div className="text-[11px] text-slate-400">{f.reason} · {f.openedAt}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{empName(f.employeeId)}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">{projName(f.projectId) ?? '—'}</td>
                    <td className="px-4 py-3 font-black text-emerald-600">{fmt(sum.fundedMinor)}</td>
                    <td className="px-4 py-3 font-black text-rose-500">{fmt(sum.spentMinor)}</td>
                    <td className="px-4 py-3 font-black">{f.status === 'open' ? fmt(sum.remainingMinor) : '0'}</td>
                    <td className="px-4 py-3">
                      {f.status === 'open'
                        ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold">📂 مفتوح</span>
                        : <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">✓ مُسوَّى{f.shortageMinor > 0 ? ` — عجز ${fmt(f.shortageMinor)}` : ''}</span>}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewingId(f.id)} title="فتح الملف" className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all hover:scale-110"><Eye size={16} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {openFiles.length > 0 && (
        <p className="text-[11.5px] text-slate-400 leading-relaxed">
          💡 يمكنك الدفع من أي ملف عهدة مفتوح مباشرة: في فاتورة الشراء اختر «عهدة موظف» كمصدر الدفع، وفي المقاولات ومسير الرواتب كذلك — كل حركة تظهر هنا في ملفها.
        </p>
      )}

      {/* فتح ملف */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="📂 فتح ملف عهدة جديد">
        <div className="space-y-4">
          <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 p-3 text-[12px] text-sky-700 dark:text-sky-300 leading-relaxed">
            الفتح إداري بلا قيد محاسبي — أول عهدة تُسجَّل بعد الفتح بزر «تعزيز». يمكن فتح أكثر من ملف لنفس الموظف.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الموظف *">
              <PartyQuickPicker parties={employees} value={fEmployeeId} onChange={setFEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
            </Field>
            <Field label="ربط بمشروع (اختياري)" hint="مصروفات الملف تدخل تكاليف المشروع تلقائياً">
              <QuickSelect value={fProjectId} onChange={(e) => setFProjectId(e.target.value)} className={inputCls}>
                <option value="">— بلا مشروع —</option>
                {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
              </QuickSelect>
            </Field>
          </div>
          <Field label="سبب الملف *"><input value={fReason} onChange={(e) => setFReason(e.target.value)} className={inputCls} placeholder="عهدة موقع، مشتريات نثرية، تشغيل يومي…" autoFocus /></Field>
          <Field label="ملاحظات"><input value={fNotes} onChange={(e) => setFNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpenModal(false)}>إلغاء</Btn>
            <Btn onClick={doOpenFile} disabled={!fEmployeeId || !fReason.trim()}>📂 فتح الملف</Btn>
          </div>
        </div>
      </Modal>

      {/* ملف العهدة — التفاصيل */}
      <Modal open={!!viewing} onClose={() => setViewingId(null)} title={viewing ? `${viewing.fileNumber} — ${empName(viewing.employeeId)}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3"><div className="text-[11px] text-slate-500">التعزيزات</div><div className="font-black text-emerald-600">{fmt(viewSummary.fundedMinor)}</div></div>
              <div className="rounded-xl bg-rose-500/5 border border-rose-500/15 p-3"><div className="text-[11px] text-slate-500">المنصرف والفواتير</div><div className="font-black text-rose-500">{fmt(viewSummary.spentMinor)}</div></div>
              <div className="rounded-xl bg-slate-500/5 border border-slate-500/15 p-3"><div className="text-[11px] text-slate-500">المتبقي بالعهدة</div><div className="font-black">{fmt(viewing.status === 'open' ? viewSummary.remainingMinor : 0)}</div></div>
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-3"><div className="text-[11px] text-slate-500">زيادة مستحقة للموظف</div><div className="font-black text-amber-600">{fmt(getEmployeeExcessDue(viewing.employeeId))}</div></div>
            </div>
            {viewing.status === 'open' ? (
              <div className="flex gap-2 flex-wrap">
                <Btn onClick={() => { setFundTreasury('1101'); setFundOpen(true) }}><Wallet size={14} /> تعزيز العهدة</Btn>
                <Btn variant="soft" onClick={() => { setExpProjectId(viewing.projectId ? String(viewing.projectId) : ''); setExpOpen(true) }}><Receipt size={14} /> تسجيل مصروف</Btn>
                <Btn variant="ghost" onClick={() => { setReturnAmount(String(viewSummary.remainingMinor / 10 ** cur.decimals)); setSettleTreasury('1101'); setSettleOpen(true) }}><Scale size={14} /> تسوية وإغلاق</Btn>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-[12.5px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 size={15} /> ملف مُسوَّى ومغلق في {viewing.settledAt} — مرتجع {fmt(viewing.returnedMinor)}{viewing.shortageMinor > 0 ? ` / عجز ${fmt(viewing.shortageMinor)} (سلفة تُخصم من الراتب)` : ''} — لا حركات جديدة عليه
              </div>
            )}

            {/* الحركات: التعزيزات مقابل المنصرف (طلب المالك) */}
            <div>
              <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-2">حركات الملف ({viewTxs.length})</div>
              {viewTxs.length === 0 ? (
                <div className="text-[12.5px] text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-4 text-center">لا حركات بعد — ابدأ بتعزيز العهدة بأول مبلغ</div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-right text-[10.5px] text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                        {['التاريخ', 'الحركة', 'البيان', 'له (تعزيز)', 'عليه (منصرف)'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {viewTxs.map((t) => {
                        const lbl = CUSTODY_TX_LABELS[t.type]
                        const isCredit = t.type === 'fund'
                        return (
                          <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 text-slate-400">{t.date}</td>
                            <td className="px-3 py-2 font-bold">{lbl.icon} {lbl.nameAr}</td>
                            <td className="px-3 py-2">{t.description || '—'}{t.projectId != null && <span className="text-[10px] text-orange-500 font-bold"> · 🏗️ {projName(t.projectId)}</span>}{t.excessMinor > 0 && <span className="text-[10px] text-amber-600 font-bold"> · زيادة {fmt(t.excessMinor)} للموظف</span>}</td>
                            <td className="px-3 py-2 font-black text-emerald-600">{isCredit ? fmt(t.amountMinor) : ''}</td>
                            <td className="px-3 py-2 font-black text-rose-500">{!isCredit ? fmt(t.amountMinor) : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {viewEntries.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer font-bold text-slate-500">القيود المحاسبية ({viewEntries.length})</summary>
                <div className="mt-2 space-y-1">
                  {viewEntries.map((e) => (
                    <div key={e.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-slate-500">
                      قيد #{e.entryNumber} — {e.description}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </Modal>

      {/* تعزيز */}
      <Modal open={fundOpen} onClose={() => setFundOpen(false)} title={viewing ? `💰 تعزيز ${viewing.fileNumber}` : ''}>
        <div className="space-y-4">
          <Field label={`المبلغ (${cur.symbol}) *`}><input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus /></Field>
          <Field label="من أي خزينة/بنك؟"><TreasuryPicker value={fundTreasury} onChange={setFundTreasury} /></Field>
          <Field label="البيان"><input value={fundDesc} onChange={(e) => setFundDesc(e.target.value)} className={inputCls} placeholder="عهدة أسبوع، تشغيل موقع…" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setFundOpen(false)}>إلغاء</Btn>
            <Btn onClick={doFund} shortcut="F9" disabled={!fundAmount.trim()}>💾 تعزيز وقيد</Btn>
          </div>
        </div>
      </Modal>

      {/* مصروف */}
      <Modal open={expOpen} onClose={() => setExpOpen(false)} title={viewing ? `🧾 مصروف من ${viewing.fileNumber}` : ''}>
        {viewing && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px] flex justify-between">
              <span className="text-slate-500">المتبقي بالعهدة</span><b>{fmt(viewSummary.remainingMinor)} {cur.symbol}</b>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`المبلغ (${cur.symbol}) *`}><input value={expAmount} onChange={(e) => setExpAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus /></Field>
              <Field label="على مشروع؟" hint="يدخل تكاليفه وربحيته">
                <QuickSelect value={expProjectId} onChange={(e) => setExpProjectId(e.target.value)} className={inputCls}>
                  <option value="">— بلا مشروع —</option>
                  {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
                </QuickSelect>
              </Field>
            </div>
            <Field label="بيان المصروف *"><input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className={inputCls} placeholder="مواد، مواصلات، إكراميات عمال…" /></Field>
            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-amber-300/50 dark:border-amber-700/50 cursor-pointer">
              <input type="checkbox" checked={expAllowExcess} onChange={(e) => setExpAllowExcess(e.target.checked)} className="w-4 h-4 accent-amber-500" />
              <span className="text-[12px] font-bold text-amber-700 dark:text-amber-300">سماح بالزيادة عن العهدة — الفرق يُسجَّل مستحقاً للموظف ويُصرف مع راتبه</span>
            </label>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setExpOpen(false)}>إلغاء</Btn>
              <Btn onClick={doExpense} shortcut="F9" disabled={!expAmount.trim() || !expDesc.trim()}>💾 تسجيل المصروف</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* تسوية */}
      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title={viewing ? `⚖️ تسوية وإغلاق ${viewing.fileNumber}` : ''}>
        {viewing && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px] flex justify-between">
              <span className="text-slate-500">المتبقي بعهدة {empName(viewing.employeeId)}</span><b>{fmt(viewSummary.remainingMinor)} {cur.symbol}</b>
            </div>
            <Field label={`المرتجع نقداً (${cur.symbol})`} hint="ما يعيده الموظف فعلاً — الفرق يُسجَّل عجزاً">
              <input value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus />
            </Field>
            <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={settleTreasury} onChange={setSettleTreasury} compact /></Field>
            {returnAmount.trim() !== '' && (() => {
              try {
                const ret = toMinor(returnAmount, cur.decimals)
                if (ret > viewSummary.remainingMinor) return <div className="text-[12px] font-bold text-rose-500">⚠️ المرتجع أكبر من المتبقي بالعهدة</div>
                const shortage = viewSummary.remainingMinor - ret
                return shortage > 0 ? (
                  <div className="anim-pop rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 text-[12px] font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>عجز {fmt(shortage)} {cur.symbol} — سيُسجَّل <b>سلفة على الموظف</b> تخصمها من راتبه بحريتك: كلها أو أجزاء على عدة مسيرات</span>
                  </div>
                ) : (
                  <div className="anim-pop text-[12px] font-bold text-emerald-600 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">✓ تسوية كاملة بلا عجز — الملف يُغلق نهائياً</div>
                )
              } catch { return null }
            })()}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setSettleOpen(false)}>إلغاء</Btn>
              <Btn onClick={doSettle} shortcut="F9" disabled={returnAmount.trim() === ''}>⚖️ تنفيذ التسوية والإغلاق</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
