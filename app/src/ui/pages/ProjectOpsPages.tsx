/**
 * صفحات أوامر التعديل — عمليات المشاريع المتقدمة:
 * MaterialIssuesPage — أذون صرف مواد (متوسط مرجح، صارف/مستلم إلزاميان، وحدات متعددة)
 * ClientCollectionsPage — تحصيلات العملاء (FIFO تلقائي + مطابقة محددة اختيارية)
 * EvmDashboardPage — لوحة القيمة المكتسبة (موازنة/فعلي/إنجاز + تنبيهات تجاوز)
 * ApprovalsPage — مسارات الموافقات التسلسلية وطلبات الاعتماد
 */
import { useMemo, useState } from 'react'
import { PackageMinus, Plus, Trash2, HandCoins, Gauge, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, ListChecks } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { APPROVAL_ACTION_LABELS, type ApprovalAction, type IssueLineInput } from '../../core/projectOps.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

function useCur() {
  const { setup } = useAppStore()
  return useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
}

/* ═══════════════ أذون صرف المواد ═══════════════ */

interface DraftIssueLine { itemId: string; qty: string; unitAr: string }

export function MaterialIssuesPage() {
  const { materialRequisitions, projects, employees, items, issueMaterials } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [issuedBy, setIssuedBy] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [lines, setLines] = useState<DraftIssueLine[]>([])
  const [notes, setNotes] = useState('')

  const activeEmployees = employees.filter((e) => e.active)
  const stockItems = items.filter((it) => it.isActive)

  const openNew = () => {
    setProjectId(''); setIssuedBy(''); setReceivedBy(''); setNotes('')
    setLines([{ itemId: '', qty: '1', unitAr: '' }])
    setOpen(true)
  }

  const unitsOf = (itemId: string) => {
    const it = items.find((x) => x.id === Number(itemId))
    if (!it) return []
    return [it.baseUnit, ...it.extraUnits.map((u) => u.nameAr)]
  }

  const save = () => {
    try {
      const parsed: IssueLineInput[] = lines
        .filter((l) => l.itemId && Number(l.qty) > 0)
        .map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), unitAr: l.unitAr }))
      const req = issueMaterials({
        projectId: Number(projectId),
        issuedByEmployeeId: Number(issuedBy),
        receivedByEmployeeId: Number(receivedBy),
        lines: parsed, notes: notes.trim(),
      })
      toast.show(`صدر إذن الصرف ${req.reqNumber} بتكلفة ${fmt(req.totalCostMinor)} — حُمِّلت على المشروع ✅`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><PackageMinus className="w-6 h-6 text-orange-500" /> أذون صرف المواد</h1>
        <Btn onClick={openNew}><Plus size={15} /> إذن صرف</Btn>
      </div>
      <div className="text-sm text-slate-500">
        صرف مواد من المخزن لمشروع: التكلفة بالمتوسط المرجح تُحمَّل تكلفةً مباشرة على المشروع (5110/1103) —
        بصارف (أمين مخزن) ومستلم (مهندس موقع) إلزاميين، ومنع صارم للرصيد السالب، وتدقيق كامل للحركة.
      </div>

      {materialRequisitions.length === 0 ? (
        <div className={card}><EmptyState icon="📦" title="لا أذون صرف بعد" sub="المواد المصروفة للمواقع تخرج بمستند رسمي موقّع بين أمين المخزن ومهندس الموقع" /></div>
      ) : (
        <div className={`anim-up ${card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الإذن</th>
                <th className="px-4 py-3 font-bold">المشروع</th>
                <th className="px-4 py-3 font-bold">الأصناف</th>
                <th className="px-4 py-3 font-bold">التكلفة</th>
                <th className="px-4 py-3 font-bold">الصارف ← المستلم</th>
              </tr>
            </thead>
            <tbody>
              {[...materialRequisitions].reverse().map((r, i) => (
                <tr key={r.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{r.reqNumber}</div>
                    <div className="text-[11px] text-slate-400">{r.date.slice(0, 10)}{r.notes && ` — ${r.notes}`}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{projects.find((p) => p.id === r.projectId)?.nameAr ?? '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">
                    {r.lines.map((l, j) => <div key={j}>{l.nameAr}: {l.qty} {l.unitAr}{l.unitFactor !== 1 && ` (= ${l.baseQty})`}</div>)}
                  </td>
                  <td className="px-4 py-3 font-black text-orange-600">{fmt(r.totalCostMinor)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">{r.issuedByName} ← {r.receivedByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="إذن صرف مواد لمشروع" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="المشروع *">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {projects.filter((p) => p.status !== 'completed').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
              </select>
            </Field>
            <Field label="الصارف (أمين المخزن) *" hint="إلزامي من سجل الموظفين">
              <select value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.nameAr}{e.jobTitle && ` (${e.jobTitle})`}</option>)}
              </select>
            </Field>
            <Field label="المستلم (مهندس الموقع/المشرف) *" hint="إلزامي — لا يكون الصارف نفسه">
              <select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.nameAr}{e.jobTitle && ` (${e.jobTitle})`}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">الأصناف المنصرفة</span>
              <Btn variant="soft" onClick={() => setLines((l) => [...l, { itemId: '', qty: '1', unitAr: '' }])}>+ صنف</Btn>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const it = items.find((x) => x.id === Number(l.itemId))
                return (
                  <div key={i} className="anim-in grid grid-cols-[1fr_90px_130px_36px] gap-2 items-center">
                    <select value={l.itemId} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, itemId: e.target.value, unitAr: '' } : x)))} className={inputCls}>
                      <option value="">— الصنف —</option>
                      {stockItems.map((x) => <option key={x.id} value={x.id}>{x.nameAr} (رصيد {x.stockQty} {x.baseUnit})</option>)}
                    </select>
                    <input value={l.qty} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} type="number" min={0} className={inputCls} />
                    <select value={l.unitAr || (it?.baseUnit ?? '')} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitAr: e.target.value } : x)))} className={inputCls} disabled={!l.itemId}>
                      {unitsOf(l.itemId).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-rose-500 transition-colors justify-self-center"><Trash2 size={15} /></button>
                  </div>
                )
              })}
            </div>
          </div>

          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="صبّة القواعد — بلوك أ…" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!projectId || !issuedBy || !receivedBy || lines.every((l) => !l.itemId)}>📦 صرف المواد</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════════ تحصيلات العملاء FIFO ═══════════════ */

export function ClientCollectionsPage() {
  const { customers, clientSettlements, getOpenClientInvoices, receiveClientPayment } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [treasury, setTreasury] = useState('1101')
  const [specific, setSpecific] = useState(false)
  const [specificKey, setSpecificKey] = useState('')
  const [notes, setNotes] = useState('')

  const openInvoices = customerId ? getOpenClientInvoices(Number(customerId)) : []
  const totalOpen = openInvoices.reduce((s, inv) => s + inv.dueMinor - inv.settledMinor, 0)

  const collect = () => {
    try {
      const r = receiveClientPayment({
        customerId: Number(customerId),
        amountMinor: toMinor(amount, cur.decimals),
        treasury,
        specificDocKey: specific && specificKey ? specificKey : null,
        notes: notes.trim(),
      })
      const applied = r.allocations.map((a) => `${a.docLabel}: ${fmt(a.appliedMinor)}`).join('، ')
      toast.show(`${r.settlementNumber} ✅ ${applied}${r.unallocatedMinor > 0 ? ` + ${fmt(r.unallocatedMinor)} تحت الحساب` : ''}`)
      setAmount(''); setNotes(''); setSpecificKey(''); setSpecific(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><HandCoins className="w-6 h-6 text-emerald-500" /> تحصيلات العملاء</h1>
      </div>
      <div className="text-sm text-slate-500">
        التحصيل على مستوى حساب العميل الإجمالي: يُطفئ الفواتير والمستخلصات المفتوحة تلقائياً بالأقدم أولاً (FIFO) —
        وبمفتاح اختياري تُطابق دفعةً بفاتورة محددة. رصيد العميل لا ينشأ إلا من فاتورة/مستخلص رسمي.
      </div>

      <div className={`anim-up ${card} p-4 space-y-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="العميل *">
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setSpecificKey('') }} className={inputCls}>
              <option value="">— اختر —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </Field>
          <Field label={`المبلغ المحصَّل (${cur.symbol}) *`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputCls} />
          </Field>
          <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={treasury} onChange={setTreasury} /></Field>
        </div>

        {customerId && (
          openInvoices.length === 0 ? (
            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-[13px] font-bold text-emerald-700 dark:text-emerald-300">
              لا مستندات مفتوحة على هذا العميل ✓ — أي تحصيل يُسجَّل دفعة تحت الحساب
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">المستندات المفتوحة (الأقدم أولاً)</span>
                <span className="text-[12px] font-black text-rose-500">إجمالي المفتوح: {fmt(totalOpen)}</span>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {openInvoices.map((inv) => {
                      const remaining = inv.dueMinor - inv.settledMinor
                      return (
                        <tr key={inv.docKey} className={`border-b border-slate-50 dark:border-slate-800/50 ${specific && specificKey === inv.docKey ? 'bg-emerald-500/10' : ''}`}>
                          <td className="px-3 py-2">
                            {specific && (
                              <input type="radio" name="specificInv" checked={specificKey === inv.docKey} onChange={() => setSpecificKey(inv.docKey)} className="ml-2 accent-emerald-600" />
                            )}
                            <span className="font-bold">{inv.docLabel}</span>
                            <span className="text-[11px] text-slate-400 mr-2">{inv.date.slice(0, 10)}</span>
                          </td>
                          <td className="px-3 py-2 text-left font-black">{fmt(remaining)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={specific} onChange={(e) => { setSpecific(e.target.checked); if (!e.target.checked) setSpecificKey('') }} className="accent-emerald-600 w-4 h-4" />
                مطابقة محددة: خصّص هذه الدفعة لفاتورة بعينها (والباقي FIFO)
              </label>
            </div>
          )
        )}

        <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
        <Btn onClick={collect} disabled={!customerId || !amount} className="w-full">💰 تحصيل وتوزيع تلقائي</Btn>
      </div>

      {clientSettlements.length > 0 && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">سجل التحصيلات</div>
          <table className="w-full text-sm">
            <tbody>
              {[...clientSettlements].reverse().slice(0, 30).map((st) => (
                <tr key={st.id} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-2.5">
                    <div className="font-bold">{st.settlementNumber} — {customers.find((c) => c.id === st.customerId)?.nameAr ?? '—'}</div>
                    <div className="text-[11px] text-slate-400">
                      {st.date.slice(0, 10)} · {st.allocations.map((a) => `${a.docLabel} (${fmt(a.appliedMinor)})`).join('، ')}
                      {st.unallocatedMinor > 0 && ` · تحت الحساب ${fmt(st.unallocatedMinor)}`}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-left font-black text-emerald-600">{fmt(st.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ═══════════════ لوحة القيمة المكتسبة EVM ═══════════════ */

export function EvmDashboardPage() {
  const { projects, boqItems, getProjectEvm } = useDataStore()
  const cur = useCur()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [projectId, setProjectId] = useState('')

  const evm = useMemo(() => {
    if (!projectId) return null
    try { return getProjectEvm(Number(projectId)) } catch { return null }
  }, [projectId, getProjectEvm])

  const hasBoq = projectId ? boqItems.some((b) => b.projectId === Number(projectId)) : false

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><Gauge className="w-6 h-6 text-orange-500" /> القيمة المكتسبة EVM</h1>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputCls} !w-64`}>
          <option value="">— اختر مشروعاً —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
        </select>
      </div>
      <div className="text-sm text-slate-500">
        مقارنة لحظية: الموازنة (التكلفة التقديرية للبنود) × الإنجاز مقابل التكلفة الفعلية المسجلة —
        مع مؤشر كفاءة التكلفة CPI وتنبيه فوري عند التجاوز.
      </div>

      {!projectId ? (
        <div className={card}><EmptyState icon="📊" title="اختر مشروعاً" sub="تُبنى اللوحة من جدول كميات المشروع (بتكاليفه التقديرية) وتكاليفه الفعلية" /></div>
      ) : !hasBoq ? (
        <div className={card}><EmptyState icon="🧮" title="لا جدول كميات لهذا المشروع" sub="أضف بنود BOQ بتكاليفها التقديرية (أو حوّل عرض سعر ببنوده) لتفعيل التحليل" /></div>
      ) : evm && (
        <>
          {evm.costOverrun && (
            <div className="anim-pop p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0" />
              <div className="text-[13px]">
                <div className="font-black text-rose-600 dark:text-rose-400">تنبيه: التكلفة الفعلية تتجاوز الموازنة المكتسبة بمقدار {fmt(evm.overrunMinor)}</div>
                <div className="text-rose-500/80">راجع بنود الصرف — الفعلي {fmt(evm.actualCostMinor)} مقابل موازنة مستحقة {fmt(evm.earnedBudgetMinor)} عند إنجاز {evm.progressPercent}٪</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'موازنة الإتمام BAC', value: fmt(evm.budgetAtCompletionMinor), color: 'text-slate-700 dark:text-slate-200' },
              { label: 'القيمة المكتسبة EV', value: fmt(evm.earnedValueMinor), color: 'text-emerald-600' },
              { label: 'الموازنة المكتسبة', value: fmt(evm.earnedBudgetMinor), color: 'text-sky-600' },
              { label: 'التكلفة الفعلية AC', value: fmt(evm.actualCostMinor), color: evm.costOverrun ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200' },
              { label: 'كفاءة التكلفة CPI', value: evm.cpi == null ? '—' : String(evm.cpi), color: evm.cpi != null && evm.cpi < 1 ? 'text-rose-500' : 'text-emerald-600' },
            ].map((kpi, i) => (
              <div key={i} style={{ animationDelay: `${i * 40}ms` }} className={`anim-up ${card} p-4`}>
                <div className="text-[11px] font-bold text-slate-400">{kpi.label}</div>
                <div className={`text-lg font-black mt-1 ${kpi.color}`}>{kpi.value}</div>
              </div>
            ))}
          </div>
          <div className={`anim-up ${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <ListChecks size={14} /> البنود (مراكز التكلفة) — الإنجاز الكلي {evm.progressPercent}٪
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2.5 font-bold">البند</th>
                  <th className="px-4 py-2.5 font-bold">الموازنة</th>
                  <th className="px-4 py-2.5 font-bold">القيمة المكتسبة</th>
                  <th className="px-4 py-2.5 font-bold">الموازنة المكتسبة</th>
                </tr>
              </thead>
              <tbody>
                {evm.lines.map((l) => (
                  <tr key={l.boqItemId} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2.5"><span className="text-[11px] text-slate-400 ml-1">{l.code}</span> {l.descriptionAr}</td>
                    <td className="px-4 py-2.5 font-bold">{fmt(l.budgetCostMinor)}</td>
                    <td className="px-4 py-2.5 font-bold text-emerald-600">{fmt(l.earnedValueMinor)}</td>
                    <td className="px-4 py-2.5 font-bold text-sky-600">{fmt(l.earnedBudgetMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ═══════════════ الموافقات التسلسلية ═══════════════ */

const ALL_ACTIONS: ApprovalAction[] = ['quotation_to_project', 'material_requisition', 'sub_certificate', 'project_extract']

export function ApprovalsPage() {
  const { approvalFlows, approvalRequests, employees, setApprovalFlow, requestApproval, decideApproval } = useDataStore()
  const toast = useToast()

  /* تحرير مسار */
  const [editAction, setEditAction] = useState<ApprovalAction | null>(null)
  const [steps, setSteps] = useState<{ roleAr: string; employeeId: string }[]>([])
  const [flowActive, setFlowActive] = useState(true)

  const openFlow = (action: ApprovalAction) => {
    const existing = approvalFlows.find((f) => f.action === action)
    setSteps(existing ? existing.steps.map((s) => ({ roleAr: s.roleAr, employeeId: s.employeeId == null ? '' : String(s.employeeId) })) : [{ roleAr: 'مهندس الموقع', employeeId: '' }, { roleAr: 'مدير المشروع', employeeId: '' }])
    setFlowActive(existing ? existing.active : true)
    setEditAction(action)
  }

  const saveFlow = () => {
    if (!editAction) return
    try {
      setApprovalFlow(editAction, steps.map((s) => ({ roleAr: s.roleAr, employeeId: s.employeeId ? Number(s.employeeId) : null })), flowActive)
      toast.show(`حُفظ مسار «${APPROVAL_ACTION_LABELS[editAction]}» ✅`)
      setEditAction(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* طلب جديد */
  const [reqOpen, setReqOpen] = useState(false)
  const [reqAction, setReqAction] = useState<ApprovalAction>('material_requisition')
  const [reqSubject, setReqSubject] = useState('')
  const [reqRef, setReqRef] = useState('')

  const saveRequest = () => {
    try {
      requestApproval(reqAction, reqSubject.trim() || APPROVAL_ACTION_LABELS[reqAction], Number(reqRef) || 0)
      toast.show('أُنشئ طلب الاعتماد — بانتظار المستوى الأول ✅')
      setReqOpen(false); setReqSubject(''); setReqRef('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const decide = (id: number, decision: 'approved' | 'rejected') => {
    try {
      const r = decideApproval(id, decision, 'المالك', '')
      toast.show(r.status === 'approved' ? '✅ اكتمل الاعتماد — يمكن تنفيذ الإجراء الآن' : r.status === 'rejected' ? 'رُفض الطلب' : `تمت الموافقة — بانتظار المستوى ${r.currentStep + 1}`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const pending = approvalRequests.filter((r) => r.status === 'pending')
  const resolved = approvalRequests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-violet-500" /> الموافقات التسلسلية</h1>
        <Btn onClick={() => setReqOpen(true)}><Plus size={15} /> طلب اعتماد</Btn>
      </div>
      <div className="text-sm text-slate-500">
        مسارات موافقات متعددة المستويات (مهندس موقع ← مدير مشروع ← محاسب أول…) على الإجراءات الحرجة —
        الإجراء ذو المسار النشط لا يُنفَّذ إلا باعتماد مكتمل، وكل اعتماد يُستهلك بتنفيذ واحد.
      </div>

      {/* المسارات */}
      <div className="grid sm:grid-cols-2 gap-3">
        {ALL_ACTIONS.map((action, i) => {
          const flow = approvalFlows.find((f) => f.action === action)
          return (
            <div key={action} style={{ animationDelay: `${i * 40}ms` }} className={`anim-up ${card} p-4 space-y-2`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[13.5px]">{APPROVAL_ACTION_LABELS[action]}</span>
                <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-bold ${flow?.active ? 'bg-violet-500/10 text-violet-600' : 'bg-slate-500/10 text-slate-400'}`}>
                  {flow?.active ? '🔒 مسار نشط' : 'حر (بلا موافقات)'}
                </span>
              </div>
              {flow && flow.steps.length > 0 && (
                <div className="text-[11.5px] text-slate-500">{flow.steps.map((s) => s.roleAr).join(' ← ')}</div>
              )}
              <Btn variant="soft" onClick={() => openFlow(action)} className="!text-[12px]">⚙️ ضبط المسار</Btn>
            </div>
          )
        })}
      </div>

      {/* الطلبات المعلقة */}
      {pending.length > 0 && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">طلبات بانتظار الاعتماد ({pending.length})</div>
          {pending.map((r) => {
            const flow = approvalFlows.find((f) => f.action === r.action)
            const step = flow?.steps[r.currentStep]
            return (
              <div key={r.id} className="px-4 py-3 border-b border-slate-50 dark:border-slate-800/50 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-bold text-[13px]">{r.subject}</div>
                  <div className="text-[11px] text-slate-400">
                    {APPROVAL_ACTION_LABELS[r.action]} · المستوى {r.currentStep + 1}/{flow?.steps.length ?? '?'} — بانتظار: <b>{step?.roleAr ?? '—'}</b>
                    {r.decisions.length > 0 && ` · وافق: ${r.decisions.map((d) => d.roleAr).join('، ')}`}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => decide(r.id, 'approved')} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all flex items-center gap-1"><CheckCircle2 size={13} /> اعتماد</button>
                  <button onClick={() => decide(r.id, 'rejected')} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 transition-all flex items-center gap-1"><XCircle size={13} /> رفض</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* المحسومة */}
      {resolved.length > 0 && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">سجل الاعتمادات</div>
          {[...resolved].reverse().slice(0, 20).map((r) => (
            <div key={r.id} className="px-4 py-2.5 border-b border-slate-50 dark:border-slate-800/50 flex items-center justify-between">
              <div>
                <span className="font-bold text-[12.5px]">{r.subject}</span>
                <span className="text-[11px] text-slate-400 mr-2">{APPROVAL_ACTION_LABELS[r.action]}</span>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${r.status === 'approved' ? (r.consumedAt ? 'bg-slate-500/10 text-slate-500' : 'bg-emerald-500/10 text-emerald-600') : 'bg-rose-500/10 text-rose-500'}`}>
                {r.status === 'approved' ? (r.consumedAt ? '✓ معتمد ومستهلك' : '✓ معتمد — جاهز للتنفيذ') : '✗ مرفوض'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ضبط مسار */}
      <Modal open={editAction != null} onClose={() => setEditAction(null)} title={editAction ? `مسار: ${APPROVAL_ACTION_LABELS[editAction]}` : ''}>
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[24px_1fr_1fr_32px] gap-2 items-center">
              <span className="text-[12px] font-black text-slate-400 text-center">{i + 1}</span>
              <input value={s.roleAr} onChange={(e) => setSteps((arr) => arr.map((x, j) => (j === i ? { ...x, roleAr: e.target.value } : x)))} placeholder="مهندس الموقع…" className={inputCls} />
              <select value={s.employeeId} onChange={(e) => setSteps((arr) => arr.map((x, j) => (j === i ? { ...x, employeeId: e.target.value } : x)))} className={inputCls}>
                <option value="">أي موظف بهذا الدور</option>
                {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
              </select>
              <button onClick={() => setSteps((arr) => arr.filter((_, j) => j !== i))} className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
            </div>
          ))}
          <Btn variant="soft" onClick={() => setSteps((arr) => [...arr, { roleAr: '', employeeId: '' }])} disabled={steps.length >= 6}>+ مستوى</Btn>
          <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
            <input type="checkbox" checked={flowActive} onChange={(e) => setFlowActive(e.target.checked)} className="accent-violet-600 w-4 h-4" />
            المسار نشط — الإجراء لا يُنفَّذ إلا باعتماد مكتمل
          </label>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditAction(null)}>إلغاء</Btn>
            <Btn onClick={saveFlow}>💾 حفظ المسار</Btn>
          </div>
        </div>
      </Modal>

      {/* طلب اعتماد */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="طلب اعتماد جديد">
        <div className="space-y-3">
          <Field label="الإجراء">
            <select value={reqAction} onChange={(e) => setReqAction(e.target.value as ApprovalAction)} className={inputCls}>
              {ALL_ACTIONS.map((a) => <option key={a} value={a}>{APPROVAL_ACTION_LABELS[a]}</option>)}
            </select>
          </Field>
          <Field label="الموضوع"><input value={reqSubject} onChange={(e) => setReqSubject(e.target.value)} className={inputCls} placeholder="صرف أسمنت لمشروع المخازن…" /></Field>
          <Field label="رقم المستند المرجعي" hint="معرف المشروع/العرض/عقد الباطن المعني — يجب أن يطابق عند التنفيذ">
            <input value={reqRef} onChange={(e) => setReqRef(e.target.value)} inputMode="numeric" className={inputCls} dir="ltr" />
          </Field>
          <Btn onClick={saveRequest} className="w-full" disabled={!reqRef}>إنشاء الطلب</Btn>
        </div>
      </Modal>
    </div>
  )
}
