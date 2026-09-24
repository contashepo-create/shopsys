/**
 * عمق المقاولات (مقارنة pro-acc والبرامج العالمية — طلب المالك):
 * - BoqPage: جداول الكميات مع نسب إنجاز بندية
 * - SubcontractorsPage: عقود الباطن ← شهادات بمحتجز ← دفعات ← إفراج
 * - BondsPage: خطابات الضمان بهوامشها ومصاريفها ودورة رد/مصادرة
 * - DailyWorkersPage: عمال اليومية بسجلات على المشاريع وتسوية دورية
 * - أوامر التغيير والدفعات المقدمة داخل صفحة المشروعات نفسها
 */
import { useMemo, useState } from 'react'
import { Plus, Eye, ListChecks, Users2, ShieldCheck, CalendarClock } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { boqItemTotal, BOND_TYPE_LABELS, type BondType, type SubContract, type Bond } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

const useCur = () => {
  const { setup } = useAppStore()
  return useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
}

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

/* ═══════════ جداول الكميات BOQ ═══════════ */
export function BoqPage() {
  const { projects, boqItems, addBoqItem, updateBoqProgress, removeBoqItem, getProjectWip } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [projectId, setProjectId] = useState<number | ''>('')
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [desc, setDesc] = useState('')
  const [unit, setUnit] = useState('م2')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [estCost, setEstCost] = useState('') // التكلفة التقديرية للوحدة — موازنة البند لتحليل EVM

  const items = boqItems.filter((b) => projectId !== '' && b.projectId === projectId)
  const total = items.reduce((s, b) => s + boqItemTotal(b), 0)
  const wip = projectId !== '' && projects.find((p) => p.id === projectId) ? getProjectWip(projectId as number) : null

  const save = () => {
    try {
      if (projectId === '') throw new Error('اختر المشروع أولاً')
      addBoqItem({ projectId: projectId as number, code: code.trim(), descriptionAr: desc.trim(), unit: unit.trim(), qty: Number(qty) || 0, unitPriceMinor: toMinor(price, cur.decimals), estCostMinor: toMinor(estCost || '0', cur.decimals) })
      toast.show('أُضيف البند لجدول الكميات ✅')
      setOpen(false); setCode(''); setDesc(''); setQty(''); setPrice(''); setEstCost('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><ListChecks className="w-6 h-6 text-orange-500" /> جداول الكميات BOQ</h1>
        <div className="flex gap-2 items-center">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} className={inputCls + ' min-w-52'}>
            <option value="">— اختر المشروع —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
          </select>
          <Btn onClick={() => setOpen(true)} disabled={projectId === ''}><Plus className="w-4 h-4" /> بند جديد</Btn>
        </div>
      </div>

      {wip && (
        <div className={`${card} p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-center anim-up`}>
          <div><div className="text-[11px] text-slate-400 font-bold">قيمة العقد الفعلية</div><div className="font-black">{fmt(wip.contractMinor)}</div></div>
          <div><div className="text-[11px] text-slate-400 font-bold">نسبة الإنجاز (تكلفة)</div><div className="font-black text-orange-500">{Math.round(wip.percentComplete * 100)}٪</div></div>
          <div><div className="text-[11px] text-slate-400 font-bold">الإيراد المكتسب</div><div className="font-black">{fmt(wip.earnedRevenueMinor)}</div></div>
          <div><div className="text-[11px] text-slate-400 font-bold">{wip.underBillingMinor >= 0 ? 'فوترة ناقصة (لك)' : 'فوترة زائدة (عليك)'}</div>
            <div className={`font-black ${wip.underBillingMinor >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(Math.abs(wip.underBillingMinor))}</div></div>
          <div><div className="text-[11px] text-slate-400 font-bold">تكلفة متبقية للإكمال</div><div className="font-black">{fmt(wip.costToCompleteMinor)}</div></div>
        </div>
      )}

      {projectId === '' ? (
        <EmptyState icon="📐" title="اختر مشروعاً" sub="جدول الكميات يفصّل بنود العقد: كمية وسعر وحدة ونسبة إنجاز لكل بند — ومنه تُحسب موازنة التكاليف لتقرير WIP" />
      ) : items.length === 0 ? (
        <EmptyState icon="📐" title="لا بنود بعد" sub="أضف بنود المقايسة: حفر، خرسانة، حدادة… بكمياتها وأسعارها" />
      ) : (
        <div className={`${card} overflow-hidden anim-up`}>
          <table className="w-full text-sm">
            <thead><tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">الكود</th><th className="px-4 py-3 font-bold">البند</th><th className="px-4 py-3 font-bold">الوحدة</th>
              <th className="px-4 py-3 font-bold">الكمية</th><th className="px-4 py-3 font-bold">سعر الوحدة</th><th className="px-4 py-3 font-bold">الإجمالي</th>
              <th className="px-4 py-3 font-bold">الإنجاز</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-3 font-mono text-[12px]">{b.code || '—'}</td>
                  <td className="px-4 py-3 font-bold">{b.descriptionAr}</td>
                  <td className="px-4 py-3">{b.unit}</td>
                  <td className="px-4 py-3">{b.qty}</td>
                  <td className="px-4 py-3">{fmt(b.unitPriceMinor)}</td>
                  <td className="px-4 py-3 font-bold">{fmt(boqItemTotal(b))}</td>
                  <td className="px-4 py-3 w-40">
                    <div className="flex items-center gap-2">
                      <input type="range" min={0} max={100} step={5} value={b.progressPercent}
                        onChange={(e) => updateBoqProgress(b.id, Number(e.target.value))} className="flex-1 accent-orange-500" />
                      <span className="text-[11px] font-bold w-9">{b.progressPercent}٪</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><button onClick={() => removeBoqItem(b.id)} className="text-rose-500 text-[11px] font-bold hover:underline">حذف</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-orange-500/5 font-black"><td colSpan={5} className="px-4 py-3">إجمالي المقايسة ({items.length} بنداً)</td><td className="px-4 py-3">{fmt(total)}</td><td colSpan={2}></td></tr></tfoot>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="بند جدول كميات جديد">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="كود البند"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1-2" className={inputCls} /></Field>
            <Field label="الوحدة"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="م2 / م3 / طن / مقطوعية" className={inputCls} /></Field>
            <Field label="الكمية"><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <Field label="وصف البند"><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="توريد وصب خرسانة مسلحة…" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`سعر الوحدة (${cur.symbol})`}><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label={`تكلفة تقديرية/وحدة (${cur.symbol})`} hint="موازنة البند — تغذي لوحة القيمة المكتسبة EVM وتنبيهات التجاوز">
              <input value={estCost} onChange={(e) => setEstCost(e.target.value)} inputMode="decimal" className={inputCls} />
            </Field>
          </div>
          <Btn onClick={save} className="w-full">حفظ البند</Btn>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════ مقاولو الباطن ═══════════ */
export function SubcontractorsPage() {
  const { projects, subContracts, subCertificates, subPayments, journal, suppliers, boqItems, addSubContract, addSubCertificate, paySubContractor, releaseSubRetention, addSubAdvance, getSubAdvanceBalance } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<number | ''>('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [value, setValue] = useState('')
  const [retention, setRetention] = useState('5')
  const [supplierId, setSupplierId] = useState('') // ربط اختياري بسجل مورد
  const [withhold, setWithhold] = useState('0') // ضريبة استقطاع ٪
  const [advPct, setAdvPct] = useState('0') // خصم الدفعة المقدمة تلقائياً ٪
  const [assignedBoq, setAssignedBoq] = useState<number[]>([]) // بنود BOQ المسندة

  const [certFor, setCertFor] = useState<SubContract | null>(null)
  const [certMode, setCertMode] = useState<'percent' | 'amount'>('percent')
  const [certPercent, setCertPercent] = useState('')
  const [certAmount, setCertAmount] = useState('')
  const [certDesc, setCertDesc] = useState('')
  const [certRecovery, setCertRecovery] = useState('') // استرداد من الدفعة المقدمة

  const [advFor, setAdvFor] = useState<SubContract | null>(null)
  const [advAmount, setAdvAmount] = useState('')
  const [advTreasury, setAdvTreasury] = useState('1101')

  const [payFor, setPayFor] = useState<SubContract | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payTreasury, setPayTreasury] = useState('1101')

  const [viewing, setViewing] = useState<SubContract | null>(null)

  const stats = (c: SubContract) => {
    const certs = subCertificates.filter((x) => x.contractId === c.id)
    const certified = certs.reduce((s, x) => s + x.amountMinor, 0)
    const retained = certs.reduce((s, x) => s + x.retentionMinor, 0)
    const net = certs.reduce((s, x) => s + x.netMinor, 0)
    const paid = subPayments.filter((x) => x.contractId === c.id && x.kind === 'payment').reduce((s, x) => s + x.amountMinor, 0)
    const released = subPayments.filter((x) => x.contractId === c.id && x.kind === 'retention_release').reduce((s, x) => s + x.amountMinor, 0)
    return { certified, retained, net, paid, released, dueNow: net - paid, heldNow: retained - released }
  }

  const saveContract = () => {
    try {
      if (projectId === '') throw new Error('اختر المشروع')
      const c = addSubContract({
        projectId: projectId as number, contractorName: name.trim(), scopeAr: scope.trim(),
        supplierId: supplierId ? Number(supplierId) : null,
        contractValueMinor: toMinor(value, cur.decimals), retentionPercent: Number(retention) || 0,
        taxWithholdPercent: Number(withhold) || 0, boqItemIds: assignedBoq, advanceRecoveryPercent: Number(advPct) || 0,
        startDate: new Date().toISOString().slice(0, 10),
      })
      toast.show(`أُنشئ عقد الباطن ${c.contractNumber} ✅`)
      setOpen(false); setName(''); setScope(''); setValue(''); setSupplierId(''); setWithhold('0'); setAdvPct('0'); setAssignedBoq([])
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const saveCert = () => {
    if (!certFor) return
    try {
      const cert = addSubCertificate({
        contractId: certFor.id,
        ...(certMode === 'percent'
          ? { newProgressPercent: Number(certPercent) }
          : { amountMinor: toMinor(certAmount, cur.decimals) }),
        description: certDesc.trim(),
        ...(certRecovery ? { advanceRecoveryMinor: toMinor(certRecovery, cur.decimals) } : {}),
      })
      toast.show(`اعتُمدت الشهادة #${cert.number} — صافي ${fmt(cert.netMinor)} (محتجز ${fmt(cert.retentionMinor)}${cert.taxWithholdMinor > 0 ? ` + استقطاع ${fmt(cert.taxWithholdMinor)}` : ''}${cert.advanceRecoveryMinor > 0 ? ` + استرداد ${fmt(cert.advanceRecoveryMinor)}` : ''}) ✅`)
      setCertFor(null); setCertAmount(''); setCertDesc(''); setCertRecovery(''); setCertPercent('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const savePay = () => {
    if (!payFor) return
    try {
      paySubContractor({ contractId: payFor.id, amountMinor: toMinor(payAmount, cur.decimals), treasury: payTreasury })
      toast.show('سُجلت الدفعة بقيد متوازن ✅')
      setPayFor(null); setPayAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const saveAdvance = () => {
    if (!advFor) return
    try {
      addSubAdvance({ contractId: advFor.id, amountMinor: toMinor(advAmount, cur.decimals), treasury: advTreasury })
      toast.show('صُرفت الدفعة المقدمة (أصل 1111) — تُسترد من الشهادات ✅')
      setAdvFor(null); setAdvAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const doRelease = (c: SubContract) => {
    try {
      const r = releaseSubRetention(c.id, payTreasury)
      toast.show(`أُفرج عن محتجزات ${fmt(r.amount)} وأُقفل العقد 🎉`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const viewLive = viewing ? subContracts.find((c) => c.id === viewing.id) ?? null : null
  const viewCerts = viewLive ? subCertificates.filter((x) => x.contractId === viewLive.id) : []
  const viewPays = viewLive ? subPayments.filter((x) => x.contractId === viewLive.id) : []
  const viewEntryIds = new Set([...viewCerts.map((x) => x.journalEntryId), ...viewPays.map((x) => x.journalEntryId)])
  const viewEntries = journal.filter((e) => viewEntryIds.has(e.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><Users2 className="w-6 h-6 text-orange-500" /> مقاولو الباطن</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> عقد باطن جديد</Btn>
      </div>
      <div className="text-sm text-slate-500">عقد ← شهادات أعمال بمحتجز ← دفعات من المستحق ← إفراج المحتجزات عند الاستلام النهائي — وكل شهادة تدخل تكاليف مشروعها تلقائياً</div>

      {subContracts.length === 0 ? (
        <EmptyState icon="👷" title="لا عقود باطن بعد" sub="سجّل مقاولي الباطن (حفر، حدادة، كهرباء…) بعقود ومحتجزات — التكلفة تُعترف بالشهادات المعتمدة لا بالدفع" />
      ) : (
        <div className={`${card} overflow-hidden anim-up`}>
          <table className="w-full text-sm">
            <thead><tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">العقد</th><th className="px-4 py-3 font-bold">المشروع</th><th className="px-4 py-3 font-bold">قيمة العقد</th>
              <th className="px-4 py-3 font-bold">المعتمد</th><th className="px-4 py-3 font-bold">مستحق الآن</th><th className="px-4 py-3 font-bold">محتجز</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {subContracts.map((c) => {
                const st = stats(c)
                const proj = projects.find((p) => p.id === c.projectId)
                return (
                  <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-orange-500/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-bold">{c.contractorName} {c.supplierId != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold">مورد مربوط</span>}</div>
                      <div className="text-[11px] text-slate-400">{c.contractNumber} — {c.scopeAr}{c.taxWithholdPercent > 0 && ` · استقطاع ${c.taxWithholdPercent}٪`} {c.status === 'completed' && '✅ مقفل'}</div>
                    </td>
                    <td className="px-4 py-3 text-[12px]">{proj?.nameAr ?? '—'}</td>
                    <td className="px-4 py-3">{fmt(c.contractValueMinor)}</td>
                    <td className="px-4 py-3">{fmt(st.certified)}</td>
                    <td className="px-4 py-3 font-bold text-rose-500">{fmt(st.dueNow)}</td>
                    <td className="px-4 py-3 text-amber-600">{fmt(st.heldNow)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        <button onClick={() => setViewing(c)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="عرض"><Eye size={15} /></button>
                        {c.status === 'active' && <>
                          <Btn variant="soft" onClick={() => setAdvFor(c)} className="!px-2 !py-1 !text-[11px]">دفعة مقدمة</Btn>
                          <Btn variant="soft" onClick={() => setCertFor(c)} className="!px-2 !py-1 !text-[11px]">شهادة</Btn>
                          <Btn variant="soft" onClick={() => setPayFor(c)} className="!px-2 !py-1 !text-[11px]" disabled={st.dueNow <= 0}>دفعة</Btn>
                          <Btn variant="ghost" onClick={() => doRelease(c)} className="!px-2 !py-1 !text-[11px]" disabled={st.heldNow <= 0}>إفراج + إقفال</Btn>
                        </>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="عقد مقاول باطن جديد">
        <div className="space-y-3">
          <Field label="المشروع">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
              <option value="">— اختر —</option>
              {projects.filter((p) => p.status !== 'completed').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اسم المقاول"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
            <Field label="نطاق الأعمال"><input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="أعمال الحفر والردم" className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`قيمة العقد (${cur.symbol})`}><input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="نسبة المحتجز ٪" hint="يُخصم من كل شهادة ويُفرج عنه عند الاستلام">
              <input value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
            <Field label="ضريبة استقطاع ٪" hint="تُخصم من كل شهادة التزاماً (2112) حتى توريدها للمصلحة">
              <input value={withhold} onChange={(e) => setWithhold(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
            <Field label="خصم الدفعة المقدمة ٪" hint="تُخصم تلقائياً من كل شهادة بهذه النسبة حتى إطفاء المقدمة — 0 = خصم يدوي">
              <input value={advPct} onChange={(e) => setAdvPct(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
            <Field label="ربط بسجل مورد (اختياري)" hint="يوحّد مستحقاته في كشف حساب المورد">
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
                <option value="">— بلا ربط —</option>
                {suppliers.map((su) => <option key={su.id} value={su.id}>{su.nameAr}</option>)}
              </select>
            </Field>
          </div>
          {projectId !== '' && boqItems.filter((b) => b.projectId === projectId).length > 0 && (
            <Field label="بنود BOQ المسندة لهذا المقاول" hint="إسناد إداري لمتابعة نطاق الأعمال">
              <div className="flex flex-wrap gap-1.5">
                {boqItems.filter((b) => b.projectId === projectId).map((b) => (
                  <button key={b.id} type="button"
                    onClick={() => setAssignedBoq((arr) => arr.includes(b.id) ? arr.filter((x) => x !== b.id) : [...arr, b.id])}
                    className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold border transition-all ${assignedBoq.includes(b.id) ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                    {b.code || b.id} — {b.descriptionAr.slice(0, 24)}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Btn onClick={saveContract} className="w-full">إنشاء العقد</Btn>
        </div>
      </Modal>

      <Modal open={!!certFor} onClose={() => setCertFor(null)} title={certFor ? `شهادة أعمال — ${certFor.contractorName}` : ''}>
        {certFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-orange-500/5 rounded-xl p-3">
              الاستقطاعات آلية: محتجز {certFor.retentionPercent}٪ (2108){certFor.taxWithholdPercent > 0 && <> + ضريبة استقطاع {certFor.taxWithholdPercent}٪ (2112)</>} + استرداد الدفعة المقدمة (1111): تلقائي بنسبة العقد {certFor.advanceRecoveryPercent > 0 ? `${certFor.advanceRecoveryPercent}٪` : '—'} أو يدوي أدناه — والتكلفة تُعترف فور الاعتماد
            </div>
            <div className="flex gap-2">
              {([['percent', 'بنسبة إنجاز تراكمية'], ['amount', 'بمبلغ مباشر']] as const).map(([m, label]) => (
                <button key={m} onClick={() => setCertMode(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${certMode === m ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{label}</button>
              ))}
            </div>
            {certMode === 'percent' ? (
              <Field label={`نسبة الإنجاز الجديدة ٪ (السابقة ${certFor.progressPercent}٪)`} hint={`قيمة الشريحة = ${fmt(certFor.contractValueMinor)} × (الجديدة − ${certFor.progressPercent})٪`}>
                <input value={certPercent} onChange={(e) => setCertPercent(e.target.value)} inputMode="decimal" className={inputCls} placeholder={`أكبر من ${certFor.progressPercent} وحتى 100`} />
              </Field>
            ) : (
              <Field label={`قيمة الأعمال المعتمدة (${cur.symbol})`}><input value={certAmount} onChange={(e) => setCertAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            )}
            <Field label="وصف الأعمال"><input value={certDesc} onChange={(e) => setCertDesc(e.target.value)} placeholder="أعمال الأسبوع الثالث…" className={inputCls} /></Field>
            {getSubAdvanceBalance(certFor.id) > 0 && (
              <Field label={`استرداد من الدفعة المقدمة (رصيدها ${fmt(getSubAdvanceBalance(certFor.id))})`} hint="يخصم من صافي الشهادة ويطفئ 1111">
                <input value={certRecovery} onChange={(e) => setCertRecovery(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
            )}
            <Btn onClick={saveCert} shortcut="F9" className="w-full" disabled={certMode === 'percent' ? !certPercent : !certAmount}>اعتماد الشهادة</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `دفعة — ${payFor.contractorName}` : ''}>
        {payFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500">مستحقه الآن: <b className="text-rose-500">{fmt(stats(payFor).dueNow)}</b> (صافي الشهادات − المدفوع)</div>
            <Field label={`قيمة الدفعة (${cur.symbol})`}><input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="من أي خزينة/بنك؟"><TreasuryPicker value={payTreasury} onChange={setPayTreasury} /></Field>
            <Btn onClick={savePay} shortcut="F9" className="w-full">صرف الدفعة</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!advFor} onClose={() => setAdvFor(null)} title={advFor ? `دفعة مقدمة — ${advFor.contractorName}` : ''}>
        {advFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-orange-500/5 rounded-xl p-3">
              تُصرف قبل بدء الأعمال وتُقيّد أصلاً (1111) — ثم تُسترد تلقائياً من شهادات أعماله.
              {getSubAdvanceBalance(advFor.id) > 0 && <> الرصيد القائم: <b>{fmt(getSubAdvanceBalance(advFor.id))}</b></>}
            </div>
            <Field label={`قيمة الدفعة المقدمة (${cur.symbol})`}><input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="من أي خزينة/بنك؟"><TreasuryPicker value={advTreasury} onChange={setAdvTreasury} /></Field>
            <Btn onClick={saveAdvance} shortcut="F9" className="w-full">صرف الدفعة المقدمة</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!viewLive} onClose={() => setViewing(null)} title={viewLive ? `${viewLive.contractNumber} — ${viewLive.contractorName}` : ''} wide>
        {viewLive && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              {(() => { const st = stats(viewLive); return <>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-[11px] text-slate-400 font-bold">المعتمد</div><div className="font-black">{fmt(st.certified)}</div></div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-[11px] text-slate-400 font-bold">المدفوع</div><div className="font-black">{fmt(st.paid)}</div></div>
                <div className="rounded-xl bg-rose-500/5 p-3"><div className="text-[11px] text-slate-400 font-bold">مستحق الآن</div><div className="font-black text-rose-500">{fmt(st.dueNow)}</div></div>
                <div className="rounded-xl bg-amber-500/5 p-3"><div className="text-[11px] text-slate-400 font-bold">محتجز قائم</div><div className="font-black text-amber-600">{fmt(st.heldNow)}</div></div>
              </> })()}
            </div>
            {viewCerts.length > 0 && (
              <table className="w-full text-[12px]">
                <thead><tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">#</th><th className="px-3 py-2">التاريخ</th><th className="px-3 py-2">الوصف</th><th className="px-3 py-2">القيمة</th><th className="px-3 py-2">المحتجز</th><th className="px-3 py-2">الصافي</th>
                </tr></thead>
                <tbody>{viewCerts.map((x) => (
                  <tr key={x.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{x.number}</td><td className="px-3 py-2">{x.date}</td><td className="px-3 py-2">{x.descriptionAr || '—'}</td>
                    <td className="px-3 py-2">{fmt(x.amountMinor)}</td><td className="px-3 py-2 text-amber-600">{fmt(x.retentionMinor)}</td><td className="px-3 py-2 font-bold">{fmt(x.netMinor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {viewEntries.map((e) => (
              <div key={e.id} className="rounded-xl border border-orange-500/20 bg-orange-500/[0.03] p-3 text-[12px]">
                <b>قيد #{e.entryNumber}</b> — {e.description}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ═══════════ خطابات الضمان ═══════════ */
export function BondsPage() {
  const { projects, bonds, treasuries, issueBond, settleBond } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const banks = treasuries.filter((t) => t.kind === 'bank')

  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<number | ''>('')
  const [bondNumber, setBondNumber] = useState('')
  const [type, setType] = useState<BondType>('bid')
  const [beneficiary, setBeneficiary] = useState('')
  const [amount, setAmount] = useState('')
  const [margin, setMargin] = useState('')
  const [fees, setFees] = useState('')
  const [bank, setBank] = useState('1102')
  const [expiry, setExpiry] = useState('')

  const save = () => {
    try {
      const b = issueBond({
        projectId: projectId === '' ? null : (projectId as number),
        bondNumber: bondNumber.trim(), type, beneficiary: beneficiary.trim(),
        amountMinor: toMinor(amount, cur.decimals), marginMinor: toMinor(margin, cur.decimals),
        feesMinor: toMinor(fees || '0', cur.decimals), bank,
        issueDate: new Date().toISOString().slice(0, 10), expiryDate: expiry,
      })
      toast.show(`صدر الخطاب ${b.bondNumber} — الهامش مجمد في 1109 ✅`)
      setOpen(false); setBondNumber(''); setBeneficiary(''); setAmount(''); setMargin(''); setFees(''); setExpiry('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const settle = (b: Bond, outcome: 'released' | 'forfeited') => {
    try {
      settleBond(b.id, outcome)
      toast.show(outcome === 'released' ? `رُد الخطاب ${b.bondNumber} وتحرر هامشه ✅` : `صودر الخطاب ${b.bondNumber} — الهامش خسارة ⚠️`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-orange-500" /> خطابات الضمان</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> خطاب جديد</Btn>
      </div>
      <div className="text-sm text-slate-500">الهامش نقدية مجمدة (أصل 1109) والمصاريف مصروف فوري — قيمة الخطاب التزام محتمل لا يُقيَّد إلا عند المصادرة</div>

      {bonds.length === 0 ? (
        <EmptyState icon="🛡️" title="لا خطابات ضمان" sub="ابتدائي لدخول العطاءات، نهائي لحسن التنفيذ، دفعة مقدمة… سجّلها بهوامشها لتتبع النقدية المجمدة وتواريخ الانتهاء" />
      ) : (
        <div className={`${card} overflow-hidden anim-up`}>
          <table className="w-full text-sm">
            <thead><tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">الخطاب</th><th className="px-4 py-3 font-bold">النوع</th><th className="px-4 py-3 font-bold">المستفيد</th>
              <th className="px-4 py-3 font-bold">القيمة</th><th className="px-4 py-3 font-bold">الهامش</th><th className="px-4 py-3 font-bold">ينتهي</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {bonds.map((b) => {
                const expired = b.status === 'active' && b.expiryDate < today
                const expiringSoon = b.status === 'active' && !expired && b.expiryDate <= soon
                return (
                  <tr key={b.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-3">
                      <div className="font-bold">{b.bondNumber}</div>
                      <div className="text-[11px] text-slate-400">{projects.find((p) => p.id === b.projectId)?.nameAr ?? 'عام'}</div>
                    </td>
                    <td className="px-4 py-3 text-[12px]">{BOND_TYPE_LABELS[b.type]}</td>
                    <td className="px-4 py-3 text-[12px]">{b.beneficiary}</td>
                    <td className="px-4 py-3">{fmt(b.amountMinor)}</td>
                    <td className="px-4 py-3 font-bold text-sky-600">{fmt(b.marginMinor)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                        b.status === 'released' ? 'bg-emerald-500/10 text-emerald-600'
                        : b.status === 'forfeited' ? 'bg-rose-500/10 text-rose-600'
                        : expired ? 'bg-rose-500/10 text-rose-600'
                        : expiringSoon ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-slate-500/10 text-slate-500'
                      }`}>
                        {b.status === 'released' ? '✅ مُرد' : b.status === 'forfeited' ? '❌ صودر' : expired ? `⚠️ انتهى ${b.expiryDate}` : b.expiryDate}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.status === 'active' && (
                        <div className="flex gap-1.5 justify-end">
                          <Btn variant="soft" onClick={() => settle(b, 'released')} className="!px-2 !py-1 !text-[11px]">رد الخطاب</Btn>
                          <Btn variant="danger" onClick={() => settle(b, 'forfeited')} className="!px-2 !py-1 !text-[11px]">مصادرة</Btn>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="إصدار خطاب ضمان">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الخطاب"><input value={bondNumber} onChange={(e) => setBondNumber(e.target.value)} className={inputCls} /></Field>
            <Field label="النوع">
              <select value={type} onChange={(e) => setType(e.target.value as BondType)} className={inputCls}>
                {Object.entries(BOND_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الجهة المستفيدة"><input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className={inputCls} /></Field>
            <Field label="المشروع (اختياري)">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
                <option value="">عام (بلا مشروع)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={`قيمة الخطاب (${cur.symbol})`}><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="الهامش المحجوز" hint="النقدية المجمدة بالبنك"><input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="مصاريف الإصدار"><input value={fees} onChange={(e) => setFees(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="البنك المصدر">
              <select value={bank} onChange={(e) => setBank(e.target.value)} className={inputCls}>
                {(banks.length ? banks : treasuries).map((t) => <option key={t.code} value={t.code}>{t.nameAr}</option>)}
              </select>
            </Field>
            <Field label="تاريخ الانتهاء"><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} /></Field>
          </div>
          <Btn onClick={save} className="w-full">إصدار الخطاب</Btn>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════ عمال اليومية ═══════════ */
export function DailyWorkersPage() {
  const { projects, dailyWorkers, dailyWorkRecords, addDailyWorker, addDailyWorkRecord, settleDailyWorker } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [wage, setWage] = useState('')

  const [recFor, setRecFor] = useState<number | null>(null)
  const [recProject, setRecProject] = useState<number | ''>('')
  const [recDate, setRecDate] = useState(new Date().toISOString().slice(0, 10))
  const [recDays, setRecDays] = useState('1')

  const [settleTreasury, setSettleTreasury] = useState('1101')

  const unsettledOf = (workerId: number) => dailyWorkRecords.filter((r) => r.workerId === workerId && !r.settled)

  const saveWorker = () => {
    try {
      addDailyWorker({ nameAr: name.trim(), phone: phone.trim(), dailyWageMinor: toMinor(wage, cur.decimals) })
      toast.show('سُجل العامل ✅')
      setOpen(false); setName(''); setPhone(''); setWage('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const saveRecord = () => {
    if (recFor == null) return
    try {
      // المشروع اختياري (أمر التعديل): بلا مشروع = عمالة تشغيل عام → مصروف عمومي 5108
      const r = addDailyWorkRecord({ workerId: recFor, projectId: recProject === '' ? null : (recProject as number), date: recDate, days: Number(recDays) || 0 })
      toast.show(`سُجل ${r.days} يوم عمل بأجر ${fmt(r.wageMinor)}${r.projectId == null ? ' — تشغيل عام' : ''} ✅`)
      setRecFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const doSettle = (workerId: number) => {
    try {
      const r = settleDailyWorker(workerId, settleTreasury)
      toast.show(`سُويت ${r.recordCount} سجلاً بإجمالي ${fmt(r.total)} — دخلت تكاليف مشاريعها ✅`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><CalendarClock className="w-6 h-6 text-orange-500" /> عمال اليومية</h1>
        <div className="flex gap-2 items-center">
          <div className="w-44"><TreasuryPicker value={settleTreasury} onChange={setSettleTreasury} compact /></div>
          <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> عامل جديد</Btn>
        </div>
      </div>
      <div className="text-sm text-slate-500">سجّل أيام العمل أولاً بأول — المربوط بمشروع يدخل تكاليفه (5110)، وبلا مشروع يُرحَّل مصروف تشغيل عام (5108) تلقائياً</div>

      {dailyWorkers.length === 0 ? (
        <EmptyState icon="⛏️" title="لا عمال يومية" sub="عمال المواقع بأجر يومي خارج المسير الشهري: سجّل أيامهم على المشاريع وسوِّ مستحقاتهم أسبوعياً" />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {dailyWorkers.map((w) => {
            const unsettled = unsettledOf(w.id)
            const due = unsettled.reduce((s, r) => s + r.wageMinor, 0)
            return (
              <div key={w.id} className={`${card} p-4 space-y-2 anim-up`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold">{w.nameAr}</div>
                    <div className="text-[11px] text-slate-400">اليومية {fmt(w.dailyWageMinor)} {w.phone && `— ${w.phone}`}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] text-slate-400 font-bold">مستحق غير مسدد</div>
                    <div className={`font-black ${due > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{fmt(due)}</div>
                  </div>
                </div>
                {unsettled.length > 0 && (
                  <div className="text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    {unsettled.slice(-3).map((r) => (
                      <div key={r.id}>• {r.date}: {r.days} يوم على {r.projectId == null ? 'تشغيل عام' : projects.find((p) => p.id === r.projectId)?.nameAr ?? '—'} = {fmt(r.wageMinor)}</div>
                    ))}
                    {unsettled.length > 3 && <div>… و{unsettled.length - 3} سجلات أخرى</div>}
                  </div>
                )}
                <div className="flex gap-2">
                  <Btn variant="soft" onClick={() => { setRecFor(w.id); setRecProject('') }} className="flex-1 !text-[12px]">+ يوم عمل</Btn>
                  <Btn onClick={() => doSettle(w.id)} disabled={due <= 0} className="flex-1 !text-[12px]">تسوية {due > 0 && fmt(due)}</Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="عامل يومية جديد">
        <div className="space-y-3">
          <Field label="الاسم"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الهاتف (اختياري)"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></Field>
            <Field label={`الأجر اليومي (${cur.symbol})`}><input value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <Btn onClick={saveWorker} className="w-full">تسجيل العامل</Btn>
        </div>
      </Modal>

      <Modal open={recFor != null} onClose={() => setRecFor(null)} title="تسجيل يوم عمل">
        <div className="space-y-3">
          <Field label="المشروع (اختياري)" hint="بلا مشروع = عمالة تشغيل عام — تُرحَّل مصروفاً عمومياً (5108) لا تكلفة مشروع">
            <select value={recProject} onChange={(e) => setRecProject(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
              <option value="">🏢 تشغيل عام (بلا مشروع)</option>
              {projects.filter((p) => p.status !== 'completed').map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="التاريخ"><input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} className={inputCls} /></Field>
            <Field label="عدد الأيام" hint="نصف يوم = 0.5"><input value={recDays} onChange={(e) => setRecDays(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <Btn onClick={saveRecord} className="w-full">تسجيل</Btn>
        </div>
      </Modal>
    </div>
  )
}
