/**
 * صفحات المقاولات (القرار 27):
 * ProjectsPage — مشروعات بمستخلصات (PRX) وتكاليف ببنود ومحتجزات وربحية
 * كل قيد يظهر ويربط بالمشروع؛ الإفراج عن المحتجز يقفل المشروع.
 */
import { useMemo, useState } from 'react'
import { Plus, HardHat, Eye, BookOpenText, Banknote, TrendingUp, Receipt, Hammer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import type { Project } from '../../core/contracting.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COST_KIND_LABELS, type CostKind } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function ProjectsPage() {
  const {
    projects, projectExtracts, projectCosts, retentionReleases, journal,
    addProject, addProjectExtract, addProjectCost, releaseRetention, getProjectProfit,
  } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* مشروع جديد */
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [clientName, setClientName] = useState('')
  const [contractValue, setContractValue] = useState('')
  const [retention, setRetention] = useState('5')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const saveProject = () => {
    try {
      const p = addProject({
        nameAr: nameAr.trim(), clientName: clientName.trim(),
        contractValueMinor: toMinor(contractValue, cur.decimals),
        retentionPercent: Number(retention) || 0, startDate, notes: notes.trim(),
      })
      toast.show(`أُنشئ المشروع ${p.code} ✅`)
      setOpen(false); setNameAr(''); setClientName(''); setContractValue(''); setRetention('5'); setNotes('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* مستخلص */
  const [extractFor, setExtractFor] = useState<Project | null>(null)
  const [exGross, setExGross] = useState('')
  const [exDesc, setExDesc] = useState('')
  const [exPayment, setExPayment] = useState<'cash' | 'credit'>('credit')
  const [exVat, setExVat] = useState(true)

  const saveExtract = () => {
    if (!extractFor) return
    try {
      const ex = addProjectExtract({
        projectId: extractFor.id, grossMinor: toMinor(exGross, cur.decimals),
        vatPercent: exVat ? setup.vatPercent : 0, payment: exPayment, description: exDesc.trim(),
      })
      toast.show(`سُجل المستخلص ${ex.extractNumber} — المستحق ${fmt(ex.totals.dueMinor)} والمحتجز ${fmt(ex.totals.retentionMinor)} ✅`)
      setExtractFor(null); setExGross(''); setExDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تكلفة */
  const [costFor, setCostFor] = useState<Project | null>(null)
  const [costKind, setCostKind] = useState<CostKind>('materials')
  const [costAmount, setCostAmount] = useState('')
  const [costDesc, setCostDesc] = useState('')
  const [costPayment, setCostPayment] = useState<'cash' | 'credit'>('cash')

  const saveCost = () => {
    if (!costFor) return
    try {
      addProjectCost({
        projectId: costFor.id, kind: costKind, amountMinor: toMinor(costAmount, cur.decimals),
        payment: costPayment, description: costDesc.trim(),
      })
      toast.show('سُجلت التكلفة على المشروع بقيد متوازن ✅')
      setCostFor(null); setCostAmount(''); setCostDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض */
  const [viewing, setViewing] = useState<Project | null>(null)
  const viewingLive = viewing ? projects.find((p) => p.id === viewing.id) ?? null : null
  const profit = viewingLive ? getProjectProfit(viewingLive.id) : null
  const viewExtracts = viewingLive ? projectExtracts.filter((e) => e.projectId === viewingLive.id) : []
  const viewCosts = viewingLive ? projectCosts.filter((c) => c.projectId === viewingLive.id) : []
  const viewEntryIds = new Set([
    ...viewExtracts.map((e) => e.journalEntryId),
    ...viewCosts.map((c) => c.journalEntryId),
    ...retentionReleases.filter((r) => viewingLive && r.projectId === viewingLive.id).map((r) => r.journalEntryId),
  ])
  const viewEntries = journal.filter((e) => viewEntryIds.has(e.id))

  const doRelease = (p: Project) => {
    try {
      const r = releaseRetention(p.id)
      toast.show(`أُفرج عن محتجزات ${fmt(r.amount)} ${cur.symbol} وأُقفل المشروع 🎉`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><HardHat className="w-6 h-6 text-orange-500" /> مشروعات المقاولات</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> مشروع جديد</Btn>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon="🏗️" title="لا مشروعات بعد" sub="أنشئ مشروعك الأول: عقد بقيمة ونسبة محتجز، ثم سجّل المستخلصات والتكاليف — الربحية تُحسب تلقائياً" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
              <tr>{['الكود', 'المشروع', 'العميل', 'قيمة العقد', 'الإنجاز', 'الربح حتى الآن', 'الحالة', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pr = getProjectProfit(p.id)
                return (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-orange-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-black">{p.code}</td>
                    <td className="px-3 py-2.5 font-bold">{p.nameAr}</td>
                    <td className="px-3 py-2.5">{p.clientName || '—'}</td>
                    <td className="px-3 py-2.5">{fmt(p.contractValueMinor)} {cur.symbol}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div className="h-full bg-orange-500 transition-all" style={{ width: `${pr.progressPercent}%` }} />
                        </div>
                        <span className="text-[11px] font-bold">{pr.progressPercent}٪</span>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 font-black ${pr.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(pr.profitMinor)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${p.status === 'active' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                        {p.status === 'active' ? 'جارٍ' : 'مُسلَّم'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {p.status === 'active' && (
                          <>
                            <button onClick={() => { setExtractFor(p); setExGross(''); setExDesc('') }} title="مستخلص جديد" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Receipt className="w-4 h-4" /></button>
                            <button onClick={() => { setCostFor(p); setCostAmount(''); setCostDesc('') }} title="تسجيل تكلفة" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Hammer className="w-4 h-4" /></button>
                            {pr.retentionHeldMinor > 0 && (
                              <button onClick={() => doRelease(p)} title={`الإفراج عن المحتجز (${fmt(pr.retentionHeldMinor)}) وإقفال المشروع`} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><Banknote className="w-4 h-4" /></button>
                            )}
                          </>
                        )}
                        <button onClick={() => setViewing(p)} title="التفاصيل والقيود" className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all hover:scale-110"><Eye className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* مشروع جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="مشروع مقاولات جديد">
        <div className="space-y-3">
          <Field label="اسم المشروع *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="فيلا الشيخ زايد…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="العميل / الجهة"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
            <Field label={`قيمة العقد (${cur.symbol}) *`}><input value={contractValue} onChange={(e) => setContractValue(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="محتجز ضمان الأعمال ٪" hint="يُخصم من كل مستخلص ويُفرج عنه عند التسليم"><input value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="تاريخ البدء"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveProject} disabled={!nameAr.trim() || !contractValue}>إنشاء المشروع</Btn>
          </div>
        </div>
      </Modal>

      {/* مستخلص */}
      <Modal open={!!extractFor} onClose={() => setExtractFor(null)} title={extractFor ? `مستخلص جديد — ${extractFor.nameAr}` : ''}>
        {extractFor && (
          <div className="space-y-3">
            <Field label={`قيمة الأعمال المنفذة (${cur.symbol}) *`}><input value={exGross} onChange={(e) => setExGross(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="وصف الأعمال"><input value={exDesc} onChange={(e) => setExDesc(e.target.value)} className={inputCls} placeholder="أعمال الأساسات…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="التحصيل">
                <div className="flex gap-2">
                  {(['credit', 'cash'] as const).map((p) => (
                    <button key={p} onClick={() => setExPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${exPayment === p ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي فوري' : 'آجل (مستحق)'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="الضريبة">
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                  <input type="checkbox" checked={exVat} onChange={(e) => setExVat(e.target.checked)} className="accent-orange-600" />
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
                </label>
              </Field>
            </div>
            <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3 text-[12px] font-bold text-orange-700 dark:text-orange-300">
              يُخصم محتجز {extractFor.retentionPercent}٪ تلقائياً ويقيد على 1105 حتى التسليم النهائي
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setExtractFor(null)}>إلغاء</Btn>
              <Btn onClick={saveExtract} disabled={!exGross}>تسجيل المستخلص وقيده</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* تكلفة */}
      <Modal open={!!costFor} onClose={() => setCostFor(null)} title={costFor ? `تكلفة على — ${costFor.nameAr}` : ''}>
        {costFor && (
          <div className="space-y-3">
            <Field label="بند التكلفة">
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                  <button key={k} onClick={() => setCostKind(k)}
                    className={`py-2 rounded-xl text-[11px] font-bold border transition-all ${costKind === k ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`المبلغ (${cur.symbol}) *`}><input value={costAmount} onChange={(e) => setCostAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="السداد">
                <div className="flex gap-2">
                  {(['cash', 'credit'] as const).map((p) => (
                    <button key={p} onClick={() => setCostPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${costPayment === p ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي' : 'آجل (مورد)'}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="الوصف"><input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} className={inputCls} placeholder="حديد تسليح، أجور نجارين…" /></Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setCostFor(null)}>إلغاء</Btn>
              <Btn onClick={saveCost} disabled={!costAmount}>تسجيل التكلفة</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* التفاصيل */}
      <Modal open={!!viewingLive} onClose={() => setViewing(null)} title={viewingLive ? `${viewingLive.code} — ${viewingLive.nameAr}` : ''} wide>
        {viewingLive && profit && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-[11px] text-slate-500">المستخلصات</div><div className="font-black text-emerald-600">{fmt(profit.extractedMinor)}</div></div>
              <div className="rounded-xl bg-rose-500/10 p-3"><div className="text-[11px] text-slate-500">التكاليف</div><div className="font-black text-rose-600">{fmt(profit.costsMinor)}</div></div>
              <div className="rounded-xl bg-orange-500/10 p-3"><div className="text-[11px] text-slate-500">الربح ({profit.marginPercent}٪)</div><div className={`font-black ${profit.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(profit.profitMinor)}</div></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">محتجز قائم</div><div className="font-black text-amber-600">{fmt(profit.retentionHeldMinor)}</div></div>
            </div>

            <div>
              <div className="font-bold text-[12px] text-slate-500 mb-1 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> توزيع التكاليف</div>
              <div className="grid grid-cols-5 gap-1.5 text-center">
                {(Object.keys(COST_KIND_LABELS) as CostKind[]).map((k) => (
                  <div key={k} className="rounded-xl bg-slate-500/5 p-2">
                    <div className="text-[10px] text-slate-500">{COST_KIND_LABELS[k].icon} {COST_KIND_LABELS[k].nameAr}</div>
                    <div className="font-bold text-[12px]">{fmt(profit.costsByKind[k])}</div>
                  </div>
                ))}
              </div>
            </div>

            {viewExtracts.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[12px]">
                  <thead className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
                    <tr>{['المستخلص', 'التاريخ', 'الأعمال', 'المحتجز', 'المستحق'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {viewExtracts.map((e) => (
                      <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 font-bold">{e.extractNumber}</td>
                        <td className="px-3 py-2">{e.date.slice(0, 10)}</td>
                        <td className="px-3 py-2">{fmt(e.totals.grossMinor)}</td>
                        <td className="px-3 py-2 text-amber-600">{fmt(e.totals.retentionMinor)}</td>
                        <td className="px-3 py-2 font-bold">{fmt(e.totals.dueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewEntries.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-rose-500/10 px-3 py-2 flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-[12px]">
                  <BookOpenText className="w-4 h-4" /> قيد #{e.entryNumber} — {e.description}
                </div>
                <table className="w-full text-[12px]"><tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                      <td className="px-3 py-1.5 text-emerald-600 font-bold">{l.debit ? fmt(l.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-rose-600 font-bold">{l.credit ? fmt(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
