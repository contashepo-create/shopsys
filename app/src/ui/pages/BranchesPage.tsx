/**
 * شاشة الفروع (سد فجوة التدقيق — إدارة فروع حقيقية بمستوى البرامج العالمية):
 * - كل فرع = مخزنه الخاص + خزينته الخاصة + بياناته (عنوان/هاتف/مدير)
 * - لوحة مقارنة للمالك: مبيعات ومرتجعات وربح ورصيد خزينة وقيمة مخزون كل فرع
 * - التحويل بين الفروع: بضاعةً عبر «التحويلات» (مستند TRF) ونقداً عبر سند تحويل
 * - حد الفروع من الرخصة الموقعة (القرار 24) — الزيادة بمفتاح من المطوّر
 */
import { useMemo, useState } from 'react'
import { GitBranch, Plus, Trash2, Star, PenLine, BarChart3, Wallet2, Package, ArrowLeftRight, Phone, MapPin, UserCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { compareBranches, type Branch } from '../../core/branches.ts'
import { computeWarehouseStock, buildWarehouseDocs } from '../../core/transfers.ts'
import { evaluateLicense, effectiveLimits } from '../../core/license.ts'
import { formatMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

export function BranchesPage() {
  const {
    branches, warehouses, treasuries, addBranch, updateBranch, removeBranch,
    sales, saleReturns, purchases, purchaseReturns, transfers, items, journal, productionOrders,
  } = useDataStore()
  const { setup, activatedPayload, trialStartedAt, lastSeenAt } = useAppStore()
  const toast = useToast()

  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  // حد الفروع من الرخصة الموقعة فقط — لا يُتجاوز إلا بمفتاح جديد من المطوّر
  const maxBranches = useMemo(() => {
    const state = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    return state.status === 'active' ? effectiveLimits(activatedPayload).maxBranches : effectiveLimits(null).maxBranches
  }, [activatedPayload, trialStartedAt, lastSeenAt])

  /* ─── لوحة المقارنة (من نفس الدفاتر — لا عدادات موازية) ─── */
  const comparison = useMemo(() => {
    if (!branches.length) return []
    const accountBalances = new Map<string, number>()
    for (const e of journal) {
      for (const l of e.lines) {
        accountBalances.set(l.accountCode, (accountBalances.get(l.accountCode) ?? 0) + l.debit - l.credit)
      }
    }
    const warehouseStock = computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns, productionOrders))
    return compareBranches({
      branches,
      sales,
      saleReturns,
      saleWarehouseById: new Map(sales.map((s) => [s.id, s.warehouseId ?? null])),
      accountBalances,
      warehouseStock,
      itemCostById: new Map(items.map((it) => [it.id, it.costMinor])),
    })
  }, [branches, sales, saleReturns, purchases, purchaseReturns, transfers, items, warehouses, journal])

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

  const usedWh = new Set(branches.map((b) => b.warehouseId))
  const usedTr = new Set(branches.map((b) => b.treasuryCode))
  const freeWarehouses = warehouses.filter((w) => !usedWh.has(w.id) || w.id === editing?.warehouseId)
  const freeTreasuries = treasuries.filter((t) => !usedTr.has(t.code) || t.code === editing?.treasuryCode)

  const openCreate = () => {
    setEditing(null); setName(''); setAddress(''); setPhone(''); setManager('')
    setWhMode('new'); setTrMode('new-cash'); setOpen(true)
  }
  const openEdit = (b: Branch) => {
    setEditing(b); setName(b.nameAr); setAddress(b.address ?? ''); setPhone(b.phone ?? ''); setManager(b.managerName ?? '')
    setWhMode(b.warehouseId); setTrMode(b.treasuryCode); setOpen(true)
  }

  const save = () => {
    try {
      if (editing) {
        updateBranch(editing.id, {
          nameAr: name,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          managerName: manager.trim() || undefined,
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
          <Btn onClick={openCreate}><Plus size={15} /> فرع جديد</Btn>
        </div>
      </div>

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
                  {!b.isMain && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`حذف فرع «${b.nameAr}»؟ مخزنه وخزينته وتاريخهما تبقى كلها — يُفك الربط التنظيمي فقط.`)) return
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
              <select value={whMode === 'new' ? 'new' : String(whMode)} onChange={(e) => setWhMode(e.target.value === 'new' ? 'new' : Number(e.target.value))} className={inputCls} disabled={!!editing && editing.isMain}>
                {!editing && <option value="new">➕ إنشاء مخزن جديد باسم الفرع تلقائياً</option>}
                {freeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
              </select>
            </Field>
            <Field label="خزينة الفرع *" hint="كل نقدية الفرع عليها — رصيدها من الدفاتر">
              <select value={trMode} onChange={(e) => setTrMode(e.target.value)} className={inputCls} disabled={!!editing && editing.isMain}>
                {!editing && <option value="new-cash">➕ إنشاء خزينة نقدية جديدة تلقائياً</option>}
                {!editing && <option value="new-bank">➕ إنشاء حساب بنكي جديد تلقائياً</option>}
                {freeTreasuries.map((t) => <option key={t.code} value={t.code}>{t.nameAr}</option>)}
              </select>
            </Field>
            <Field label="مدير الفرع"><input value={manager} onChange={(e) => setManager(e.target.value)} className={inputCls} /></Field>
            <Field label="هاتف الفرع"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <Field label="العنوان"><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} /></Field>
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
