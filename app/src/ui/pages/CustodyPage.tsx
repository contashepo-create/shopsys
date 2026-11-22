import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * ملفات عهد الموظفين — نظام متكامل (طلب المالك، مرجعية pro-acc):
 * فتح ملف (بلا قيد) ← تعزيزات من خزينة/بنك ← مصروفات وفواتير تُخصم منه
 * ← تسوية: مرتجع نقدي + عجز يصير سلفة تُخصم من الراتب على دفعات.
 * زيادة المصاريف عن العهدة تُسجَّل مستحقاً للموظف وتُصرف مع راتبه.
 */
import { useMemo, useRef, useState } from 'react'
import { Plus, Wallet, Receipt, Scale, Eye, HandCoins, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useDataStore, useRawDataStore } from '../../data/repo.ts'
import { withInvoiceCommitLock } from '../../data/invoiceCommitLock.ts'
import { custodyCommitFingerprint } from '../../data/custodyCommit.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { summarizeCustody, summarizeCustodyExcessByFile, summarizeCustodyExcessAllocation, CUSTODY_TX_LABELS, type CustodyFile } from '../../core/custody.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { DocSection, DocOutcome } from '../components/DocSection.tsx'

export function CustodyPage() {
  const {
    custodyFiles, custodyTxs, employeeAdvances, payrollRuns, employees, projects, journal,
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
    void runCustodyCommit(0, () => useRawDataStore.getState().openCustodyFile({
      employeeId: fEmployeeId, projectId: fProjectId ? Number(fProjectId) : null,
      reason: fReason, notes: fNotes.trim(),
    }), f => {
      toast.show(`فُتح الملف ${f.fileNumber} لـ${empName(f.employeeId)} — سجّل أول عهدة فيه الآن 📂`)
      setOpenModal(false)
      setViewingId(f.id)
    }, () => setOpenModal(false), 'فُتح الملف محلياً لكن تعذر تأكيد الحفظ — راجع الملفات قبل إعادة المحاولة')
  }

  /* ─── عرض ملف ─── */
  const [viewingId, setViewingId] = useState<number | null>(null)
  const viewing: CustodyFile | null = viewingId != null ? custodyFiles.find((f) => f.id === viewingId) ?? null : null
  const viewTxs = useMemo(() => custodyTxs.filter((t) => t.fileId === viewingId), [custodyTxs, viewingId])
  const viewSummary = useMemo(() => summarizeCustody(viewTxs), [viewTxs])
  const excessAllocation = useMemo(
    () => summarizeCustodyExcessAllocation(custodyFiles, custodyTxs, payrollRuns),
    [custodyFiles, custodyTxs, payrollRuns],
  )
  const excessByFile = excessAllocation.balances
  const viewingExcess = viewing ? excessByFile.get(viewing.id) : undefined
  const viewingExcessRemaining = viewingExcess?.remainingMinor ?? 0
  const viewingShortageAdvance = viewing
    ? employeeAdvances.find((advance) => advance.source === 'custody_shortage' && advance.custodyFileId === viewing.id)
    : undefined
  const viewingShortageRemaining = viewingShortageAdvance
    ? Math.max(0, viewingShortageAdvance.amountMinor - (viewingShortageAdvance.recoveredMinor ?? 0))
    : viewing?.shortageMinor ?? 0

  // يشترك هذا المسار مع قفل الفواتير، لكن بقية كتّاب العهدة لا يشاركونه جميعاً.
  const commitPending = useRef(false)
  const [commitSaving, setCommitSaving] = useState(false)
  const [commitBasis, setCommitBasis] = useState('')
  const prepareCommit = (id: number) => setCommitBasis(custodyCommitFingerprint(useRawDataStore.getState(), id))
  const runCustodyCommit = async <T,>(id: number, commit: () => T, done: (result: T) => void, close: () => void, uncertainMessage = 'سُجلت الحركة محلياً لكن تعذر تأكيد الحفظ — راجع العهدة والدفتر قبل إعادة المحاولة') => {
    if (commitPending.current) return
    commitPending.current = true; setCommitSaving(true)
    let committed = false
    try {
      const result = await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => {
        if (custodyCommitFingerprint(useRawDataStore.getState(), id) !== commitBasis) throw new Error('تغير أساس العهدة منذ فتح النافذة — أغلقها وراجع الملف قبل المتابعة')
        const result = commit()
        committed = true
        return result
      })
      done(result)
    } catch (error) {
      if (committed) {
        close()
        toast.show(uncertainMessage, 'error')
      } else toast.show((error as Error).message, 'error')
    } finally { commitPending.current = false; setCommitSaving(false) }
  }

  /* قيم مشتقة لنوافذ العهدة: المبالغ بالقروش وأثرها المحاسبي قبل الترحيل */
  const toMinorSafe = (v: string) => { try { return v.trim() ? toMinor(v, cur.decimals) : 0 } catch { return 0 } }

  /* ─── تعزيز ─── */
  const [fundOpen, setFundOpen] = useState(false)
  const [fundAmount, setFundAmount] = useState('')
  const [fundTreasury, setFundTreasury] = useState('1101')
  const [fundDesc, setFundDesc] = useState('')
  const doFund = () => {
    if (!viewing) return
    const id = viewing.id
    void runCustodyCommit(id, () => useRawDataStore.getState().fundCustodyFile({ fileId: id, amountMinor: toMinor(fundAmount || '0', cur.decimals), treasury: fundTreasury, description: fundDesc.trim() }), () => {
      toast.show('عُزّزت العهدة بقيد متوازن (1108 ← الخزينة المختارة) ✅')
      setFundOpen(false); setFundAmount(''); setFundDesc('')
    }, () => setFundOpen(false))
  }

  /* ─── مصروف ─── */
  const [expOpen, setExpOpen] = useState(false)
  const [expAmount, setExpAmount] = useState('')
  const [expDesc, setExpDesc] = useState('')
  const [expProjectId, setExpProjectId] = useState('')
  const [expAllowExcess, setExpAllowExcess] = useState(false)
  const [expVatEnabled, setExpVatEnabled] = useState(false)
  const [expVat, setExpVat] = useState('')
  const [expTaxRef, setExpTaxRef] = useState('')
  const [expVatConfirmed, setExpVatConfirmed] = useState(false)
  const doExpense = () => {
    if (!viewing) return
    const id = viewing.id, projectId = expProjectId ? Number(expProjectId) : null
    void runCustodyCommit(id, () => useRawDataStore.getState().postCustodyExpense({
      fileId: id, amountMinor: toMinor(expAmount || '0', cur.decimals), description: expDesc, projectId, allowExcess: expAllowExcess,
      ...(expVatEnabled ? { inputVatMinor: toMinor(expVat || '0', cur.decimals), taxInvoiceRef: expTaxRef, confirmRecoverableVat: expVatConfirmed } : {}),
    }), tx => {
      toast.show(tx.excessMinor > 0
        ? `سُجل المصروف — منه ${fmt(tx.excessMinor)} زيادة مستحقة للموظف تُصرف مع راتبه ✅`
        : 'سُجل المصروف وخُصم من العهدة ✅')
      setExpOpen(false); setExpAmount(''); setExpDesc(''); setExpAllowExcess(false)
    }, () => setExpOpen(false))
  }

  /* ─── تسوية ─── */
  const [settleOpen, setSettleOpen] = useState(false)
  const [returnAmount, setReturnAmount] = useState('')
  const [settleTreasury, setSettleTreasury] = useState('1101')
  const doSettle = () => {
    if (!viewing) return
    const id = viewing.id
    void runCustodyCommit(id, () => useRawDataStore.getState().settleCustodyFile({ fileId: id, returnedMinor: toMinor(returnAmount || '0', cur.decimals), treasury: settleTreasury }), f => {
      const live = useDataStore.getState()
      const excessDue = summarizeCustodyExcessByFile(live.custodyFiles, live.custodyTxs, live.payrollRuns).get(id)?.remainingMinor ?? 0
      toast.show(`سُوّي ${f.fileNumber}: مرتجع ${fmt(f.returnedMinor)} · عجز ${fmt(f.shortageMinor)}${f.shortageMinor > 0 ? ' (سلفة تُخصم من الراتب)' : ''} · زيادة مصروفات مستحقة ${fmt(excessDue)}${excessDue > 0 ? ' ستظهر في مسير الرواتب' : ''} ✓`)
      setSettleOpen(false); setReturnAmount('')
    }, () => setSettleOpen(false))
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
        <Btn onClick={() => { prepareCommit(0); setFEmployeeId(employees[0]?.id ?? 0); setFProjectId(''); setFReason(''); setFNotes(''); setOpenModal(true) }} disabled={commitSaving || employees.length === 0}>
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
                {['الملف', 'الموظف', 'المشروع', 'التعزيزات', 'مصروف من العهدة', 'زيادة مستحقة', 'المتبقي', 'الحالة', ''].map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...custodyFiles].reverse().map((f, i) => {
                const sum = summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id))
                const excess = excessByFile.get(f.id)
                const excessRemaining = excess?.remainingMinor ?? 0
                return (
                  <tr key={f.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-orange-500/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{f.fileNumber}</div>
                      <div className="text-[11px] text-slate-400">{f.reason} · {f.openedAt}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{empName(f.employeeId)}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">{projName(f.projectId) ?? '—'}</td>
                    <td className="px-4 py-3 font-black text-emerald-600">{fmt(sum.fundedMinor)}</td>
                    <td className="px-4 py-3 font-black text-rose-500" title={`إجمالي المصروف ${fmt(sum.expenseTotalMinor)}، منه زيادة مستحقة ${fmt(sum.excessMinor)}`}>{fmt(sum.spentMinor)}</td>
                    <td className="px-4 py-3 font-black text-amber-600" data-custody-excess-due={f.id}>{fmt(excess?.remainingMinor ?? 0)}</td>
                    <td className="px-4 py-3 font-black">{f.status === 'open' ? fmt(sum.remainingMinor) : '0'}</td>
                    <td className="px-4 py-3">
                      {f.status === 'open'
                        ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold">📂 مفتوح</span>
                        : <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">✓ مُسوَّى{f.returnedMinor > 0 ? ` — مرتجع ${fmt(f.returnedMinor)}` : ''}{f.shortageMinor > 0 ? ` — عجز ${fmt(f.shortageMinor)}` : ''}{excessRemaining > 0 ? ` — زيادة مستحقة ${fmt(excessRemaining)}` : ''}</span>}
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
      <Modal open={openModal} onClose={() => { if (!commitPending.current) setOpenModal(false) }} title="فتح ملف عهدة جديد">
        <div className="space-y-4">
          <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 p-3 text-[12px] text-sky-700 dark:text-sky-300 leading-relaxed">
            الفتح إداري بلا قيد محاسبي — أول عهدة تُسجَّل بعد الفتح بزر «تعزيز». يمكن فتح أكثر من ملف لنفس الموظف.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الموظف *">
              <PartyQuickPicker parties={employees} value={fEmployeeId} onChange={setFEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
            </Field>
            <Field label="ربط بمشروع (اختياري)" hint="يُقترح المشروع عند تسجيل مصروف ويمكن اختيار غيره أو بلا مشروع">
              <QuickSelect value={fProjectId} onChange={(e) => setFProjectId(e.target.value)} className={inputCls}>
                <option value="">— بلا مشروع —</option>
                {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
              </QuickSelect>
            </Field>
          </div>
          <Field label="سبب الملف *"><input value={fReason} onChange={(e) => setFReason(e.target.value)} className={inputCls} placeholder="عهدة موقع، مشتريات نثرية، تشغيل يومي…" autoFocus /></Field>
          <Field label="ملاحظات"><input value={fNotes} onChange={(e) => setFNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" disabled={commitSaving} onClick={() => setOpenModal(false)}>إلغاء</Btn>
            <Btn onClick={doOpenFile} disabled={commitSaving || !fEmployeeId || !fReason.trim()}>📂 فتح الملف</Btn>
          </div>
        </div>
      </Modal>

      {/* ملف العهدة — التفاصيل */}
      <Modal open={!!viewing} onClose={() => { if (!commitPending.current) setViewingId(null) }} title={viewing ? `${viewing.fileNumber} — ${empName(viewing.employeeId)}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 text-center">
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3"><div className="text-[11px] text-slate-500">التعزيزات</div><div className="font-black text-emerald-600">{fmt(viewSummary.fundedMinor)}</div></div>
              <div className="rounded-xl bg-rose-500/5 border border-rose-500/15 p-3"><div className="text-[11px] text-slate-500">إجمالي المصروف الفعلي</div><div className="font-black text-rose-500">{fmt(viewSummary.expenseTotalMinor)}</div><div className="text-[10px] text-slate-400">منه {fmt(viewSummary.spentMinor)} من العهدة</div></div>
              <div className="rounded-xl bg-slate-500/5 border border-slate-500/15 p-3"><div className="text-[11px] text-slate-500">المتبقي بالعهدة</div><div className="font-black">{fmt(viewing.status === 'open' ? viewSummary.remainingMinor : 0)}</div></div>
              <div className="rounded-xl bg-sky-500/5 border border-sky-500/15 p-3"><div className="text-[11px] text-slate-500">المرتجع للخزينة</div><div className="font-black text-sky-600">{fmt(viewSummary.returnedMinor)}</div></div>
              <div className="rounded-xl bg-orange-500/5 border border-orange-500/15 p-3"><div className="text-[11px] text-slate-500">العجز الأصلي / المتبقي</div><div className="font-black text-orange-600">{fmt(viewing.shortageMinor)} / {fmt(viewingShortageRemaining)}</div></div>
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-3" data-custody-excess-summary><div className="text-[11px] text-slate-500">زيادة هذا الملف: مسجل / مصروف / باقٍ</div><div className="font-black text-amber-600">{fmt(viewingExcess?.accruedMinor ?? 0)} / {fmt(viewingExcess?.paidMinor ?? 0)} / {fmt(viewingExcess?.remainingMinor ?? 0)}</div></div>
            </div>
            {viewing.status === 'open' ? (
              <div className="flex gap-2 flex-wrap">
                <Btn onClick={() => { prepareCommit(viewing.id); setFundTreasury('1101'); setFundOpen(true) }}><Wallet size={14} /> تعزيز العهدة</Btn>
                <Btn variant="soft" onClick={() => { prepareCommit(viewing.id); setExpProjectId(viewing.projectId ? String(viewing.projectId) : ''); setExpVatEnabled(false); setExpVat(''); setExpTaxRef(''); setExpVatConfirmed(false); setExpOpen(true) }}><Receipt size={14} /> تسجيل مصروف</Btn>
                <Btn variant="ghost" onClick={() => { prepareCommit(viewing.id); setReturnAmount(String(viewSummary.remainingMinor / 10 ** cur.decimals)); setSettleTreasury('1101'); setSettleOpen(true) }}><Scale size={14} /> تسوية وإغلاق</Btn>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-[12.5px] font-bold text-emerald-700 dark:text-emerald-300" data-custody-settlement-status>
                <div className="flex items-center gap-2"><CheckCircle2 size={15} /> ملف مُسوَّى ومغلق في {viewing.settledAt} — مرتجع {fmt(viewing.returnedMinor)} · عجز {fmt(viewing.shortageMinor)} (سلفة أصلية) · متبقي السلفة {fmt(viewingShortageRemaining)}</div>
                <div className="mt-1 text-[11.5px]">زيادة المصروفات المسجلة {fmt(viewingExcess?.accruedMinor ?? 0)} · صُرف منها بالمسيرات {fmt(viewingExcess?.paidMinor ?? 0)} · المتبقي للموظف على 2107 هو {fmt(viewingExcess?.remainingMinor ?? 0)}.</div>
                <div className="mt-1 text-[11px]">لا حركات عهدة جديدة على الملف؛ يستمر تتبع مستحق الزيادة والسلفة بعد الإغلاق حتى تسويتهما.</div>
              </div>
            )}

            {/* الحركات: التعزيزات مقابل المنصرف (طلب المالك) */}
            <div>
              <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-2">حركات الملف ({viewTxs.length})</div>
              <p className="mb-2 text-[11px] text-amber-700">توزيع دفعات الزيادات على الملفات محسوب من المسيرات وليس تخصيصاً محفوظاً؛ قد يتغير عند تعديل التاريخ، ويجب مراجعة السجلات غير المتسلسلة.</p>
              {(excessAllocation.unallocatedPaidByEmployee.get(viewing.employeeId) ?? 0) > 0 && <p role="alert" className="mb-2 text-[11px] font-bold text-rose-700">يوجد صرف سابق غير موزع بمبلغ {fmt(excessAllocation.unallocatedPaidByEmployee.get(viewing.employeeId)!)}؛ رصيد الزيادة المعروض غير معتمد حتى مراجعة المسيرات وتسلسل الحركات.</p>}
              {viewTxs.length === 0 ? (
                <div className="text-[12.5px] text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-4 text-center">لا حركات بعد — ابدأ بتعزيز العهدة بأول مبلغ</div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-right text-[10.5px] text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                        {['التاريخ', 'الحركة', 'البيان', 'تعزيز نقدي', 'مصروف فعلي', 'منه زيادة مستحقة', 'مرتجع للخزينة', 'عجز / سلفة'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {viewTxs.map((t) => {
                        const lbl = CUSTODY_TX_LABELS[t.type]
                        const isFund = t.type === 'fund'
                        const isExpense = t.type === 'expense' || t.type === 'invoice'
                        const isReturn = t.type === 'return'
                        const isShortage = t.type === 'shortage'
                        return (
                          <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 text-slate-400">{t.date}</td>
                            <td className="px-3 py-2 font-bold">{lbl.icon} {lbl.nameAr}</td>
                            <td className="px-3 py-2">{t.description || '—'}{t.projectId != null && <span className="text-[10px] text-orange-500 font-bold"> · 🏗️ {projName(t.projectId)}</span>}{t.excessMinor > 0 && <span className="text-[10px] text-amber-600 font-bold"> · زيادة {fmt(t.excessMinor)} للموظف</span>}{(t.inputVatMinor ?? 0) > 0 && <span className="text-[10px] text-sky-600 font-bold"> · ضريبة مدخلات {fmt(t.inputVatMinor!)} · مرجع {t.taxInvoiceRef}</span>}</td>
                            <td className="px-3 py-2 font-black text-emerald-600">{isFund ? fmt(t.amountMinor) : ''}</td>
                            <td className="px-3 py-2 font-black text-rose-500">{isExpense ? fmt(t.amountMinor) : ''}</td>
                            <td className="px-3 py-2 font-black text-amber-600">{isExpense && t.excessMinor > 0 ? fmt(t.excessMinor) : ''}</td>
                            <td className="px-3 py-2 font-black text-sky-600">{isReturn ? fmt(t.amountMinor) : ''}</td>
                            <td className="px-3 py-2 font-black text-orange-600">{isShortage ? fmt(t.amountMinor) : ''}</td>
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
      <Modal open={fundOpen} onClose={() => { if (!commitPending.current) setFundOpen(false) }} title="" wide bare>
        {viewing && (
          <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
            <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><HandCoins size={19} /></span>
                <div>
                  <h3 className="text-base font-black leading-tight">تعزيز عهدة</h3>
                  <span className="text-[10.5px] doc-head-sub">CUSTODY FUNDING</span>
                </div>
              </div>
              <span className="rounded-lg bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold">{viewing.fileNumber}</span>
            </div>
            <div className="doc-meta px-5 py-2 text-[10px]">{empName(viewing.employeeId)} · المتبقي بالعهدة الآن {fmt(viewSummary.remainingMinor)} {cur.symbol}</div>
            <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
              <DocSection step="١" title="المبلغ ومصدره" hint="المال ينتقل من خزينة المنشأة إلى ذمة الموظف">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={`المبلغ (${cur.symbol}) *`}>
                    <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus />
                  </Field>
                  <Field label="من أي خزينة/بنك؟"><TreasuryPicker value={fundTreasury} onChange={setFundTreasury} operation="payment" compact /></Field>
                </div>
              </DocSection>
              <DocSection step="٢" title="البيان" hint="يظهر في كشف العهدة وفي الدفتر">
                <input value={fundDesc} onChange={(e) => setFundDesc(e.target.value)} className={inputCls} placeholder="عهدة أسبوع، تشغيل موقع…" />
              </DocSection>
              <DocOutcome>
                <b className="block pb-1">القيد الذي سيُرحَّل</b>
                <div className="flex items-center justify-between gap-3"><span>عهد الموظفين (1108) — مديناً بذمة {empName(viewing.employeeId)}</span><b className="font-mono">{fmt(toMinorSafe(fundAmount))}</b></div>
                <div className="flex items-center justify-between gap-3"><span>الخزينة المصدر ({fundTreasury}) — دائناً</span><b className="font-mono">{fmt(toMinorSafe(fundAmount))}</b></div>
                <div className="mt-1 border-t doc-line pt-1 text-[10.5px] doc-faint">ليس مصروفاً: المال ما زال ملك المنشأة في ذمة الموظف حتى ينفقه أو يردّه.</div>
              </DocOutcome>
            </div>
            <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span className="text-[11px] doc-faint">العهدة بعد التعزيز: <b className="font-mono doc-ink">{fmt(viewSummary.remainingMinor + toMinorSafe(fundAmount))}</b></span>
              <div className="flex gap-2">
                <Btn variant="ghost" disabled={commitSaving} onClick={() => setFundOpen(false)}>إلغاء</Btn>
                <Btn onClick={doFund} shortcut="F9" disabled={commitSaving || toMinorSafe(fundAmount) <= 0}>تعزيز وقيد</Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* مصروف من العهدة */}
      <Modal open={expOpen} onClose={() => { if (!commitPending.current) setExpOpen(false) }} title="" wide bare>
        {viewing && (() => {
          const amountMinor = toMinorSafe(expAmount)
          const vatMinor = expVatEnabled ? toMinorSafe(expVat) : 0
          const vatInvalid = expVatEnabled && (vatMinor <= 0 || vatMinor >= amountMinor || !expTaxRef.trim() || !expVatConfirmed)
          const excess = Math.max(0, amountMinor - viewSummary.remainingMinor)
          return (
            <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
              <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Receipt size={19} /></span>
                  <div>
                    <h3 className="text-base font-black leading-tight">مصروف من العهدة</h3>
                    <span className="text-[10.5px] doc-head-sub">CUSTODY EXPENSE</span>
                  </div>
                </div>
                <span className="rounded-lg bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold">{viewing.fileNumber}</span>
              </div>
              <div className="doc-meta px-5 py-2 text-[10px]">{empName(viewing.employeeId)} · المتبقي بالعهدة {fmt(viewSummary.remainingMinor)} {cur.symbol}</div>
              <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
                <DocSection step="١" title="قيمة المصروف ووجهته" hint="المشروع اختياري — يدخل تكاليفه وربحيته">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={`إجمالي المبلغ المدفوع شامل أي ضريبة (${cur.symbol}) *`}>
                      <input value={expAmount} onChange={(e) => setExpAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus />
                    </Field>
                    <Field label="على مشروع؟">
                      <QuickSelect value={expProjectId} onChange={(e) => setExpProjectId(e.target.value)} className={inputCls}>
                        <option value="">— بلا مشروع —</option>
                        {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
                      </QuickSelect>
                    </Field>
                  </div>
                </DocSection>
                <DocSection step="٢" title="بيان المصروف" hint="إلزامي — هو سند إنفاق العهدة">
                  <input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className={inputCls} placeholder="مواد، مواصلات، إصلاح…" />
                </DocSection>
                <DocSection step="٣" title="تجاوز رصيد العهدة" hint="حين ينفق الموظف من جيبه فوق عهدته">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl doc-tint p-3">
                    <input type="checkbox" checked={expAllowExcess} onChange={(e) => setExpAllowExcess(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                    <span className="text-[12px] font-bold doc-ink">اسمح بالزيادة عن العهدة — الفرق يُسجَّل مستحقاً للموظف يُصرف مع راتبه</span>
                  </label>
                  {excess > 0 && (
                    <p className={`mt-2 rounded-lg px-3 py-2 text-[11.5px] font-bold ${expAllowExcess ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
                      {expAllowExcess
                        ? `الزائد ${fmt(excess)} ${cur.symbol} سيصير مستحقاً للموظف (2107) لا خصماً من العهدة.`
                        : `المبلغ يتجاوز العهدة بـ${fmt(excess)} ${cur.symbol} — فعّل السماح بالزيادة أو قلّل المبلغ.`}
                    </p>
                  )}
                </DocSection>
                <DocSection step="٤" title="ضريبة المدخلات" hint="اختياري — أدخل الضريبة القابلة للخصم من المستند، لا كامل الضريبة غير القابلة للاسترداد">
                  <label className="flex items-center gap-2 text-[12px] font-bold"><input type="checkbox" checked={expVatEnabled} onChange={e => setExpVatEnabled(e.target.checked)} /> فصل ضريبة مدخلات قابلة للاسترداد</label>
                  {expVatEnabled && <div className="mt-3 space-y-2">
                    <Field label={`مبلغ الضريبة القابلة للاسترداد (${cur.symbol})`}><input aria-label="مبلغ الضريبة القابلة للاسترداد" type="number" min={0} step="any" value={expVat} onChange={e => setExpVat(e.target.value)} className={inputCls} dir="ltr" /></Field>
                    <Field label="مرجع الفاتورة الضريبية"><input aria-label="مرجع الفاتورة الضريبية" value={expTaxRef} onChange={e => setExpTaxRef(e.target.value)} className={inputCls} /></Field>
                    <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={expVatConfirmed} onChange={e => setExpVatConfirmed(e.target.checked)} /> أؤكد مراجعة أهلية الخصم والمستند وعدم تسجيله مسبقاً</label>
                    <p className="text-[11px] text-amber-700">المرجع إقرار يدوي ولا يثبت صلاحية الفاتورة أو يمنع تكرارها. راجع المختص والمستند الأصلي.</p>
                  </div>}
                </DocSection>
                <DocOutcome>
                  <b className="block pb-1">القيد الذي سيُرحَّل</b>
                  <div className="flex items-center justify-between gap-3"><span>حساب المصروف — مديناً</span><b className="font-mono">{fmt(Math.max(0, amountMinor - vatMinor))}</b></div>
                  {vatMinor > 0 && <div className="flex items-center justify-between gap-3"><span>ضريبة مدخلات (2102) — مديناً</span><b className="font-mono">{fmt(vatMinor)}</b></div>}
                  <div className="flex items-center justify-between gap-3"><span>عهد الموظفين (1108) — دائناً بما خرج من العهدة</span><b className="font-mono">{fmt(Math.min(amountMinor, viewSummary.remainingMinor))}</b></div>
                  {excess > 0 && expAllowExcess && <div className="flex items-center justify-between gap-3"><span>مستحق للموظف (2107) — دائناً بالزائد</span><b className="font-mono">{fmt(excess)}</b></div>}
                </DocOutcome>
              </div>
              <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="text-[11px] doc-faint">يتبقى بالعهدة بعد الصرف: <b className="font-mono doc-ink">{fmt(Math.max(0, viewSummary.remainingMinor - amountMinor))}</b></span>
                <div className="flex gap-2">
                  <Btn variant="ghost" disabled={commitSaving} onClick={() => setExpOpen(false)}>إلغاء</Btn>
                  <Btn onClick={doExpense} shortcut="F9" disabled={commitSaving || amountMinor <= 0 || !expDesc.trim() || vatInvalid || (excess > 0 && !expAllowExcess)}>تسجيل المصروف</Btn>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* تسوية وإغلاق العهدة */}
      <Modal open={settleOpen} onClose={() => { if (!commitPending.current) setSettleOpen(false) }} title="" wide bare>
        {viewing && (() => {
          const returned = toMinorSafe(returnAmount)
          const over = returned > viewSummary.remainingMinor
          const shortage = Math.max(0, viewSummary.remainingMinor - returned)
          return (
            <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
              <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Scale size={19} /></span>
                  <div>
                    <h3 className="text-base font-black leading-tight">تسوية وإغلاق عهدة</h3>
                    <span className="text-[10.5px] doc-head-sub">CUSTODY SETTLEMENT</span>
                  </div>
                </div>
                <span className="rounded-lg bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold">{viewing.fileNumber}</span>
              </div>
              <div className="doc-meta px-5 py-2 text-[10px]">{empName(viewing.employeeId)} · المطلوب رده {fmt(viewSummary.remainingMinor)} {cur.symbol}</div>
              <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
                <DocSection step="١" title="المرتجع نقداً" hint="ما يعيده الموظف فعلاً — الفرق يصير سلفة عليه">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={`المرتجع (${cur.symbol})`}>
                      <input value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus />
                    </Field>
                    <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={settleTreasury} onChange={setSettleTreasury} operation="receipt" compact /></Field>
                  </div>
                  {over && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] font-bold text-rose-700 dark:text-rose-300">المرتجع أكبر من المتبقي بالعهدة بـ{fmt(returned - viewSummary.remainingMinor)} — راجع المبلغ.</p>}
                </DocSection>
                <DocOutcome>
                  <b className="block pb-1">القيد الذي سيُرحَّل</b>
                  {returned > 0 && <div className="flex items-center justify-between gap-3"><span>الخزينة ({settleTreasury}) — مديناً بالمرتجع</span><b className="font-mono">{fmt(Math.min(returned, viewSummary.remainingMinor))}</b></div>}
                  {shortage > 0 && <div className="flex items-center justify-between gap-3"><span>سلف الموظفين (1107) — مديناً بالعجز</span><b className="font-mono">{fmt(shortage)}</b></div>}
                  <div className="flex items-center justify-between gap-3"><span>عهد الموظفين (1108) — دائناً بإقفال العهدة</span><b className="font-mono">{fmt(viewSummary.remainingMinor)}</b></div>
                  <div className="mt-1 flex items-start gap-1.5 border-t doc-line pt-1 text-[10.5px] doc-faint">
                    {shortage > 0
                      ? <><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>العجز {fmt(shortage)} يصير سلفة على {empName(viewing.employeeId)} تخصمها من راتبه كلها أو على دفعات.</span></>
                      : <><CheckCircle2 size={12} className="mt-0.5 shrink-0" /><span>تسوية كاملة بلا عجز — يُغلق الملف بعد الترحيل.</span></>}
                  </div>
                  {viewingExcessRemaining > 0 && (
                    <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-300" data-settlement-excess-due>
                      الزيادة المستحقة للموظف من هذا الملف {fmt(viewingExcessRemaining)} لا تُخصم من رصيد العهدة ولا تُلغى عند الإغلاق؛ تبقى على 2107 وتظهر في خانة «زيادة عهدة مستحقة» بمسير الرواتب.
                    </div>
                  )}
                </DocOutcome>
              </div>
              <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="text-[11px] doc-faint">{shortage > 0 ? `سلفة ستُقيَّد: ${fmt(shortage)}` : 'لا سلفة — العهدة مغطاة بالكامل'}</span>
                <div className="flex gap-2">
                  <Btn variant="ghost" disabled={commitSaving} onClick={() => setSettleOpen(false)}>إلغاء</Btn>
                  <Btn onClick={doSettle} shortcut="F9" disabled={commitSaving || returnAmount.trim() === '' || over}>تنفيذ التسوية والإغلاق</Btn>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
