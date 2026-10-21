import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * شاشة الفروع (سد فجوة التدقيق — إدارة فروع حقيقية بمستوى البرامج العالمية):
 * - كل فرع = مخزنه الخاص + خزينته الخاصة + بياناته (عنوان/هاتف/مدير)
 * - لوحة مقارنة للمالك: مبيعات ومرتجعات وربح ورصيد خزينة وقيمة مخزون كل فرع
 * - التحويل بين الفروع: بضاعةً عبر «التحويلات» (مستند TRF) ونقداً عبر سند تحويل
 * - حد الفروع من الرخصة الموقعة (القرار 24) — الزيادة بمفتاح من المطوّر
 */
import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Plus, Trash2, Star, PenLine, BarChart3, Wallet2, Package, ArrowLeftRight, Phone, MapPin, UserCircle2, Layers, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { compareBranches, type Branch } from '../../core/branches.ts'
import { ACTIVITY_TEMPLATES, getActivity, MODULE_LABELS, type BusinessModule } from '../../core/activities.ts'
import { computeWarehouseStock, buildWarehouseDocs } from '../../core/transfers.ts'
import { evaluateLicense, effectiveLimits } from '../../core/license.ts'
import { formatMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

export function BranchesPage() {
  const {
    branches, warehouses, treasuries, addBranch, updateBranch, removeBranch,
    activeBranchId, setActiveBranchId, currentUserId, appUsers,
    sales, saleReturns, purchases, purchaseReturns, transfers, items, journal, productionOrders, processingOrders,
  } = useDataStore()
  const canManageAllBranches = currentUserId == null || appUsers.find((user) => user.id === currentUserId)?.roleId === 'owner'
  useEffect(() => {
    // المقارنة تحتاج لقطة شاملة لا بيانات الفرع الذي كان المالك يستعرضه قبل فتح الصفحة.
    if (canManageAllBranches && activeBranchId != null) setActiveBranchId(null)
  }, [activeBranchId, canManageAllBranches, setActiveBranchId])
  const { setup, activatedPayload, trialStartedAt, lastSeenAt, deviceFlags } = useAppStore()
  const toast = useToast()

  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  // حد الفروع من الرخصة الموقعة فقط — لا يُتجاوز إلا بمفتاح جديد من المطوّر
  const maxBranches = useMemo(() => {
    const state = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString(), deviceFlags })
    return state.status === 'active' ? effectiveLimits(activatedPayload).maxBranches : effectiveLimits(null).maxBranches
  }, [activatedPayload, trialStartedAt, lastSeenAt, deviceFlags])

  /* ─── لوحة المقارنة (من نفس الدفاتر — لا عدادات موازية) ─── */
  const comparison = useMemo(() => {
    if (!branches.length) return []
    const accountBalances = new Map<string, number>()
    for (const e of journal) {
      for (const l of e.lines) {
        accountBalances.set(l.accountCode, (accountBalances.get(l.accountCode) ?? 0) + l.debit - l.credit)
      }
    }
    const warehouseStock = computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders))
    return compareBranches({
      branches,
      sales,
      saleReturns,
      saleWarehouseById: new Map(sales.map((s) => [s.id, s.warehouseId ?? null])),
      accountBalances,
      warehouseStock,
      itemCostById: new Map(items.map((it) => [it.id, it.costMinor])),
      itemValueById: new Map(items.map((it) => [it.id, it.stockValueMinor ?? Math.round((it.stockQty ?? 0) * it.costMinor)])),
      itemQtyById: new Map(items.map((it) => [it.id, it.stockQty ?? 0])),
    })
  }, [branches, sales, saleReturns, purchases, purchaseReturns, transfers, items, warehouses, journal, productionOrders, processingOrders])

  /* ─── إنشاء/تعديل فرع ─── */
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [manager, setManager] = useState('')
  // المخزن والخزينة: «جديد تلقائياً» (الافتراضي الأنسب) أو ربط بقائم غير مربوط
  const [whMode, setWhMode] = useState<'new' | number>('new')
  const [trMode, setTrMode] = useState<'new-cash' | 'new-bank' | string>('new-cash')
  // تخصيص الأقسام والنشاط لكل فرع (طلب المالك: تقسيم الأقسام الإضافية على الفروع أو فرع شامل)
  const [customModulesMode, setCustomModulesMode] = useState<'all' | 'custom'>('all')
  const [enabledModules, setEnabledModules] = useState<BusinessModule[]>([])
  const [branchActivityId, setBranchActivityId] = useState<string>('')

  const usedWh = new Set(branches.map((b) => b.warehouseId))
  const usedTr = new Set(branches.map((b) => b.treasuryCode))
  const freeWarehouses = warehouses.filter((w) => !usedWh.has(w.id) || w.id === editing?.warehouseId)
  const freeTreasuries = treasuries.filter((t) => !usedTr.has(t.code) || t.code === editing?.treasuryCode)

  const openCreate = () => {
    setEditing(null); setName(''); setAddress(''); setPhone(''); setManager('')
    setWhMode('new'); setTrMode('new-cash')
    setCustomModulesMode('all'); setEnabledModules([...setup.modules]); setBranchActivityId('')
    setOpen(true)
  }
  const openEdit = (b: Branch) => {
    setEditing(b); setName(b.nameAr); setAddress(b.address ?? ''); setPhone(b.phone ?? ''); setManager(b.managerName ?? '')
    setWhMode(b.warehouseId); setTrMode(b.treasuryCode)
    setCustomModulesMode(b.customModulesMode ?? 'all')
    setEnabledModules(b.customModulesMode === 'custom' && b.enabledModules?.length ? [...b.enabledModules] : [...setup.modules])
    setBranchActivityId(b.activityId ?? '')
    setOpen(true)
  }

  const toggleBranchModule = (mod: BusinessModule) => {
    setEnabledModules((prev) => prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod])
  }

  const applyActivityPreset = (actId: string) => {
    setBranchActivityId(actId)
    if (!actId) return
    const tmpl = getActivity(actId)
    if (!tmpl) return
    const allowed = setup.modules.filter((m) => tmpl.modules.includes(m))
    if (allowed.length > 0) setEnabledModules(allowed)
  }

  const save = () => {
    try {
      if (editing) {
        updateBranch(editing.id, {
          nameAr: name,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          managerName: manager.trim() || undefined,
          customModulesMode,
          enabledModules: customModulesMode === 'custom' ? enabledModules : undefined,
          activityId: branchActivityId || null,
          ...(typeof whMode === 'number' ? { warehouseId: whMode } : {}),
          ...(typeof trMode === 'string' && !trMode.startsWith('new-') ? { treasuryCode: trMode } : {}),
        })
        toast.show(`حُدّث فرع «${name.trim()}» ✅`)
      } else {
        addBranch({
          nameAr: name,
          warehouseId: typeof whMode === 'number' ? whMode : 0,
          treasuryCode: typeof trMode === 'string' && !trMode.startsWith('new-') ? trMode : '',
          createWarehouse: whMode === 'new',
          createTreasury: trMode === 'new-cash' ? 'cash' : trMode === 'new-bank' ? 'bank' : null,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          managerName: manager.trim() || undefined,
          customModulesMode,
          enabledModules: customModulesMode === 'custom' ? enabledModules : undefined,
          activityId: branchActivityId || null,
        }, maxBranches)
        toast.show(`أُنشئ فرع «${name.trim()}» بمخزنه وخزينته ✅`)
      }
      setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.nameAr ?? '—'
  const trName = (code: string) => treasuries.find((t) => t.code === code)?.nameAr ?? code

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><GitBranch className="w-6 h-6 text-teal-500" /> الفروع</h1>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-3 py-1 rounded-full bg-teal-500/10 text-teal-600 font-bold">
            {branches.filter((b) => b.active).length || 1} / {maxBranches} حسب خطتك
          </span>
          {canManageAllBranches && <Btn onClick={openCreate}><Plus size={15} /> فرع جديد</Btn>}
        </div>
      </div>

      {branches.length > 0 && (
        <div className="anim-up rounded-2xl border border-teal-500/25 bg-teal-500/5 p-3.5 flex items-center justify-between flex-wrap gap-3 text-[12px]">
          <div className="space-y-0.5">
            <div className="font-bold text-teal-800 dark:text-teal-200 flex items-center gap-1.5">
              🏢 نظام الشركات والفروع المستقلة بالكامل
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              عند تفعيل أي فرع يعمل كشركة مستقلة تماماً (عملاؤه، موردوه، موظفوه، أصنافه، مخازنه، خزائنه وبنوكه، فواتيره، أقسامه، وميزانه مستقل عن بقية الفروع). وعند اختيار «كل الفروع (شامل)» ترى المنشأة مجمَّعة.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setActiveBranchId(null); toast.show('تم التبديل إلى العرض الشامل لكل الفروع والشركات ✓') }}
              className={`px-3 py-1.5 rounded-xl text-[11.5px] font-bold transition-all ${
                activeBranchId == null
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              🌐 كل الفروع (عرض شامل)
            </button>
          </div>
        </div>
      )}

      {!branches.length && (
        <div className="anim-up">
          <EmptyState
            icon="🏬"
            title="تعمل الآن بوضع الفرع الواحد"
            sub="أنشئ أول فرع إضافي وسيتحول المخزن والخزينة الرئيسيان تلقائياً إلى «الفرع الرئيسي» — كل فرع بمخزنه وخزينته وتقاريره، والتحويل بينها بمستندات موثقة"
          />
        </div>
      )}

      {/* ─── لوحة مقارنة الفروع (للمالك) ─── */}
      {comparison.length > 0 && (
        <div className={`anim-up ${card} p-5 space-y-3`}>
          <div className="font-bold text-[13px] flex items-center gap-2"><BarChart3 size={15} className="text-teal-500" /> مقارنة أداء الفروع (كل الفترة)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[760px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="text-right py-2 px-2">الفرع</th>
                  <th className="text-center py-2 px-2">الفواتير</th>
                  <th className="text-center py-2 px-2">المبيعات</th>
                  <th className="text-center py-2 px-2">المرتجعات</th>
                  <th className="text-center py-2 px-2">صافي الإيراد</th>
                  <th className="text-center py-2 px-2">مجمل الربح</th>
                  <th className="text-center py-2 px-2"><span className="inline-flex items-center gap-1"><Wallet2 size={12} /> رصيد الخزينة</span></th>
                  <th className="text-center py-2 px-2"><span className="inline-flex items-center gap-1"><Package size={12} /> قيمة المخزون</span></th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.branchId} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-teal-500/5 transition-colors">
                    <td className="py-2.5 px-2 font-bold text-slate-700 dark:text-slate-200">
                      <span className="inline-flex items-center gap-1.5">{r.nameAr}{r.isMain && <Star size={12} className="text-teal-400 fill-teal-400" />}</span>
                    </td>
                    <td className="text-center px-2">{r.salesCount}</td>
                    <td className="text-center px-2">{fmt(r.revenueMinor)}</td>
                    <td className="text-center px-2 text-rose-500">{r.returnsMinor ? fmt(r.returnsMinor) : '—'}</td>
                    <td className="text-center px-2 font-bold">{fmt(r.netRevenueMinor)}</td>
                    <td className={`text-center px-2 font-bold ${r.grossProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(r.grossProfitMinor)}</td>
                    <td className="text-center px-2">{fmt(r.treasuryBalanceMinor)}</td>
                    <td className="text-center px-2">{fmt(r.stockValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
            <ArrowLeftRight size={12} />
            التحويل بين الفروع: بضاعةً من <Link to="/inventory/transfers" className="text-teal-600 font-bold hover:underline">التحويلات</Link> (مخزن ← مخزن)،
            ونقداً من <Link to="/accounting/vouchers" className="text-teal-600 font-bold hover:underline">سند تحويل</Link> (خزينة ← خزينة) — كلاهما مستند موثق في الدفاتر.
          </div>
        </div>
      )}

      {/* ─── بطاقات الفروع ─── */}
      {branches.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {branches.map((b, i) => (
            <div key={b.id} style={{ animationDelay: `${i * 60}ms` }}
              className={`anim-up group ${card} p-4 space-y-2.5 hover:border-teal-400/50 hover:shadow-lg transition-all duration-200`}>
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center transition-transform duration-200 group-hover:scale-110">
                  <GitBranch size={20} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 truncate">
                    {b.nameAr}
                    {b.isMain && <Star size={13} className="text-teal-400 fill-teal-400 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-slate-400">{b.isMain ? 'الفرع الرئيسي (المركز)' : 'فرع'}</div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(b)} className="p-2 rounded-lg text-slate-300 hover:text-teal-500 hover:bg-teal-500/10 transition-all">
                    <PenLine size={15} />
                  </button>
                  {!b.isMain && canManageAllBranches && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`حذف فرع «${b.nameAr}»؟ لا يُسمح بحذف فرع له مستخدمون أو سجلات تشغيلية؛ عطّله للحفاظ على تاريخه.`)) return
                        try { removeBranch(b.id); toast.show('حُذف الفرع (المخزن والخزينة باقيان)') }
                        catch (err) { toast.show((err as Error).message, 'error') }
                      }}
                      className="p-2 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-all">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[11.5px] space-y-1 text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5"><Package size={12} className="text-amber-500" /> {whName(b.warehouseId)}</div>
                <div className="flex items-center gap-1.5"><Wallet2 size={12} className="text-emerald-500" /> {trName(b.treasuryCode)}</div>
                {b.managerName && <div className="flex items-center gap-1.5"><UserCircle2 size={12} /> {b.managerName}</div>}
                {b.phone && <div className="flex items-center gap-1.5" dir="ltr"><Phone size={12} /> {b.phone}</div>}
                {b.address && <div className="flex items-center gap-1.5"><MapPin size={12} /> {b.address}</div>}
              </div>

              {/* شارات أقسام ونشاط الفرع + زر تفعيل عرض الفرع */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                    b.customModulesMode === 'custom'
                      ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                      : 'bg-teal-500/10 text-teal-600 dark:text-teal-300'
                  }`}>
                    <Layers size={11} />
                    {b.customModulesMode === 'custom'
                      ? `أقسام مخصصة (${(b.enabledModules ?? []).length})`
                      : 'شامل لكل أقسام الشركة'}
                  </span>
                  {b.activityId && getActivity(b.activityId) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-300">
                      {getActivity(b.activityId)?.icon} {getActivity(b.activityId)?.nameAr}
                    </span>
                  )}
                </div>
                {b.customModulesMode === 'custom' && (b.enabledModules ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(b.enabledModules ?? []).map((mod) => (
                      <span key={mod} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        {MODULE_LABELS[mod]?.icon} {MODULE_LABELS[mod]?.nameAr ?? mod}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  {canManageAllBranches && <button
                    type="button"
                    data-branch-card-switch={b.id}
                    onClick={() => {
                      const next = activeBranchId === b.id ? null : b.id
                      setActiveBranchId(next)
                      toast.show(next ? `تم تفعيل عرض فرع «${b.nameAr}» وأقسامه المخصصة في القوائم ✓` : 'تمت العودة للعرض الشامل لكل الفروع ✓')
                    }}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                      activeBranchId === b.id
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-teal-500/10 hover:text-teal-600'
                    }`}
                  >
                    <CheckCircle2 size={13} />
                    {activeBranchId === b.id ? 'الفرع النشط حالياً (إلغاء التخصيص)' : 'تفعيل قوائم هذا الفرع'}
                  </button>}
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-500/10 hover:text-indigo-600 transition-all"
                  >
                    تخصيص الأقسام
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── نافذة إنشاء/تعديل ─── */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل فرع «${editing.nameAr}»` : 'فرع جديد'}>
        <div className="space-y-4">
          <Field label="اسم الفرع *">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="فرع المعادي…" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="مخزن الفرع *" hint="لكل فرع مخزنه الخاص — أرصدته منفصلة">
              <QuickSelect value={whMode === 'new' ? 'new' : String(whMode)} onChange={(e) => setWhMode(e.target.value === 'new' ? 'new' : Number(e.target.value))} className={inputCls} disabled={!!editing && editing.isMain}>
                {!editing && <option value="new">➕ إنشاء مخزن جديد باسم الفرع تلقائياً</option>}
                {freeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="خزينة الفرع *" hint="كل نقدية الفرع عليها — رصيدها من الدفاتر">
              <QuickSelect value={trMode} onChange={(e) => setTrMode(e.target.value)} className={inputCls} disabled={!!editing && editing.isMain}>
                {!editing && <option value="new-cash">➕ إنشاء خزينة نقدية جديدة تلقائياً</option>}
                {!editing && <option value="new-bank">➕ إنشاء حساب بنكي جديد تلقائياً</option>}
                {freeTreasuries.map((t) => <option key={t.code} value={t.code}>{t.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="مدير الفرع"><input value={manager} onChange={(e) => setManager(e.target.value)} className={inputCls} /></Field>
            <Field label="هاتف الفرع"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <Field label="العنوان"><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} /></Field>

          {/* ─── تخصيص الأقسام والنشاط لهذا الفرع ─── */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/60 dark:bg-slate-900/30">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-bold text-[12.5px] flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <Layers size={14} className="text-teal-500" />
                نطاق الأقسام والأنشطة في هذا الفرع
              </div>
              <span className="text-[10.5px] text-slate-400">يحدد الشاشات والأقسام الظاهرة لموظفي هذا الفرع وعند اختياره</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                customModulesMode === 'all'
                  ? 'border-teal-500 bg-teal-500/10 text-teal-800 dark:text-teal-200'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
              }`}>
                <input
                  type="radio"
                  name="branchModulesMode"
                  checked={customModulesMode === 'all'}
                  onChange={() => setCustomModulesMode('all')}
                  className="mt-1 accent-teal-600"
                />
                <div className="text-[11.5px]">
                  <div className="font-bold">شامل — كل أقسام الشركة المفعلة</div>
                  <div className="text-[10.5px] text-slate-400">يعرض جميع الأقسام والأنشطة المفعلة في المنشأة ({setup.modules.length} قسم)</div>
                </div>
              </label>

              <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                customModulesMode === 'custom'
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-800 dark:text-indigo-200'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
              }`}>
                <input
                  type="radio"
                  name="branchModulesMode"
                  checked={customModulesMode === 'custom'}
                  onChange={() => {
                    setCustomModulesMode('custom')
                    if (!enabledModules.length) setEnabledModules([...setup.modules])
                  }}
                  className="mt-1 accent-indigo-600"
                />
                <div className="text-[11.5px]">
                  <div className="font-bold">تخصيص أقسام أو نشاط محدد للفرع</div>
                  <div className="text-[10.5px] text-slate-400">مثال: فرع للمقاولات فقط وفرع آخر للشحن واللوجستيات فقط</div>
                </div>
              </label>
            </div>

            {customModulesMode === 'custom' && (
              <div className="space-y-3 pt-1">
                <Field label="النشاط التجاري للفرع (اختياري — يضبط مسميات القوائم ويحدد أقسام النشاط تلقائياً)">
                  <QuickSelect
                    aria-label="النشاط التجاري للفرع"
                    value={branchActivityId}
                    onChange={(e) => applyActivityPreset(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">نفس نشاط الشركة الأساسي ({getActivity(setup.activityId)?.nameAr ?? 'عام'})</option>
                    {ACTIVITY_TEMPLATES.map((act) => (
                      <option key={act.id} value={act.id}>
                        {act.icon} {act.nameAr}
                      </option>
                    ))}
                  </QuickSelect>
                </Field>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-300">
                      اختر الأقسام المفعلة في هذا الفرع ({enabledModules.length} من {setup.modules.length}):
                    </span>
                    <div className="flex items-center gap-2 text-[10.5px]">
                      <button
                        type="button"
                        onClick={() => setEnabledModules([...setup.modules])}
                        className="text-teal-600 font-bold hover:underline"
                      >
                        تحديد الكل
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={() => setEnabledModules(setup.modules.filter((m) => m === 'inventory' || m === 'purchases'))}
                        className="text-slate-500 hover:underline"
                      >
                        المخزون والمشتريات فقط
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto p-1">
                    {setup.modules.map((mod) => {
                      const info = MODULE_LABELS[mod]
                      const checked = enabledModules.includes(mod)
                      return (
                        <label
                          key={mod}
                          data-branch-module-checkbox={mod}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-[11.5px] cursor-pointer transition-colors ${
                            checked
                              ? 'border-indigo-500/60 bg-indigo-500/10 font-bold text-slate-800 dark:text-white'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBranchModule(mod)}
                            className="accent-indigo-600 shrink-0"
                          />
                          <span>{info?.icon}</span>
                          <span className="truncate">{info?.nameAr ?? mod}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {!editing && !branches.length && (
            <div className="text-[11.5px] text-teal-600 bg-teal-500/5 border border-teal-400/20 rounded-xl p-3 leading-relaxed">
              💡 أول فرع تنشئه: يتحول المخزن الرئيسي والخزينة الرئيسية تلقائياً إلى «الفرع الرئيسي»،
              ويُنشأ فرعك الجديد بجانبه — فتبدأ المقارنة بينهما فوراً.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!name.trim()}>{editing ? 'حفظ التعديل' : 'إنشاء الفرع'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
