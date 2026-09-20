/**
 * شجرة الحسابات (المرحلة 4) — عرض هرمي بالأرصدة الحية من دفتر الأستاذ.
 * الحسابات التجميعية تجمع أرصدة أبنائها، والورقية تقبل القيود.
 */
import { useMemo, useState } from 'react'
import { ListTree, ChevronDown, ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { accountBalance, type Account } from '../../core/ledger.ts'
import { useActivityBaseCoa } from '../activityCoa.ts'
import { fullCoa } from '../../core/treasury.ts'
import { customAsAccounts, customParentGroups } from '../../core/customAccounts.ts'
import { Btn, Field, Modal, inputCls, useToast } from '../components/ui.tsx'

const ROOT_LABELS: Record<string, { nameAr: string; tone: string }> = {
  assets: { nameAr: 'الأصول', tone: 'text-sky-600 bg-sky-500/10' },
  liabilities: { nameAr: 'الخصوم', tone: 'text-rose-600 bg-rose-500/10' },
  equity: { nameAr: 'حقوق الملكية', tone: 'text-violet-600 bg-violet-500/10' },
  revenue: { nameAr: 'الإيرادات', tone: 'text-emerald-600 bg-emerald-500/10' },
  expenses: { nameAr: 'المصروفات', tone: 'text-amber-600 bg-amber-500/10' },
}

export function CoaPage() {
  const { journal, treasuries, customAccounts, addCustomAccount, deleteCustomAccount } = useDataStore()
  const toast = useToast()
  // الشجرة الكاملة = القياسية + خزائن المالك + حساباته المخصصة (الشجرة ليست مفروضة — طلب المالك)
  // فلترة الشجرة حسب النشاط (أمر المالك): حسابات المقاولات لا تظهر لصيدلية —
  // وصمام الأمان يُبقي أي حساب عليه حركة فعلية ظاهراً مهما كانت الوحدات
  const activityBase = useActivityBaseCoa()
  const COA = useMemo(() => {
    const base = fullCoa(activityBase, treasuries)
    const customs = customAsAccounts(customAccounts)
    if (customs.length === 0) return base
    // إدراج كل حساب مخصص بعد آخر ابن لمجموعته الأم — يظهر بمكانه الطبيعي بالشجرة
    const out: Account[] = []
    for (const a of base) {
      out.push(a)
      for (const c of customs) {
        const siblings = base.filter((x) => x.parentCode === c.parentCode)
        const lastSibling = siblings.at(-1)
        if ((lastSibling && lastSibling.code === a.code) || (!lastSibling && a.code === c.parentCode)) out.push(c)
      }
    }
    // أي مخصص لم يُدرج (مجموعة بلا أبناء قياسيين) يُلحق آخر الشجرة
    for (const c of customs) if (!out.includes(c)) out.push(c)
    return out
  }, [activityBase, treasuries, customAccounts])
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  /** أرصدة كل الحسابات — التجميعي يجمع أبناءه تنازلياً */
  const balances = useMemo(() => {
    const totals = new Map<string, { d: number; c: number }>()
    for (const e of journal) {
      for (const l of e.lines) {
        const t = totals.get(l.accountCode) ?? { d: 0, c: 0 }
        t.d += l.debit; t.c += l.credit
        totals.set(l.accountCode, t)
      }
    }
    const map = new Map<string, number>()
    const compute = (acc: Account): number => {
      if (map.has(acc.code)) return map.get(acc.code)!
      let d = totals.get(acc.code)?.d ?? 0
      let c = totals.get(acc.code)?.c ?? 0
      for (const child of COA.filter((a) => a.parentCode === acc.code)) {
        compute(child)
        // نجمع الحركة الخام للأبناء لنحسب رصيد الأب بطبيعته
        d += childTotals.get(child.code)?.d ?? 0
        c += childTotals.get(child.code)?.c ?? 0
      }
      childTotals.set(acc.code, { d, c })
      const bal = accountBalance(acc.rootType, d, c)
      map.set(acc.code, bal)
      return bal
    }
    const childTotals = new Map<string, { d: number; c: number }>()
    for (const acc of COA.filter((a) => a.parentCode === null)) compute(acc)
    return map
  }, [journal, COA])

  const toggle = (code: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(code)) n.delete(code)
      else n.add(code)
      return n
    })

  /** هل الحساب مخفي لأن أحد آبائه مطوي؟ */
  const isHidden = (acc: Account): boolean => {
    let p = acc.parentCode
    while (p) {
      if (collapsed.has(p)) return true
      p = COA.find((a) => a.code === p)?.parentCode ?? null
    }
    return false
  }

  const depth = (acc: Account): number => {
    let d = 0, p = acc.parentCode
    while (p) { d++; p = COA.find((a) => a.code === p)?.parentCode ?? null }
    return d
  }

  /* ─── إضافة حساب مخصص (طلب المالك: الشجرة ليست مفروضة) ─── */
  const [addOpen, setAddOpen] = useState(false)
  const [nCode, setNCode] = useState('')
  const [nName, setNName] = useState('')
  const [nParent, setNParent] = useState('')
  const groups = useMemo(() => customParentGroups(COA), [COA])
  const customCodes = useMemo(() => new Set(customAccounts.map((a) => a.code)), [customAccounts])
  const openAdd = () => { setNCode(''); setNName(''); setNParent(''); setAddOpen(true) }
  const saveAccount = () => {
    try {
      const a = addCustomAccount({ code: nCode, nameAr: nName, parentCode: nParent })
      toast.show(`أُضيف الحساب ${a.code} — «${a.nameAr}» للشجرة ✅ متاح فوراً في القيود والتقارير`)
      setAddOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }
  const removeAccount = (code: string) => {
    try {
      deleteCustomAccount(code)
      toast.show('حُذف الحساب المخصص ✓')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <ListTree size={16} className="text-rose-500" />
          شجرة الحسابات — الأرصدة حية من دفتر الأستاذ، وتستطيع إضافة حساباتك الخاصة تحت أي مجموعة
        </div>
        <Btn onClick={openAdd}><Plus size={15} /> حساب جديد</Btn>
      </div>

      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        {COA.map((acc) => {
          if (isHidden(acc)) return null
          const hasChildren = COA.some((a) => a.parentCode === acc.code)
          const bal = balances.get(acc.code) ?? 0
          const d = depth(acc)
          const root = ROOT_LABELS[acc.rootType]
          return (
            <div
              key={acc.code}
              className={`flex items-center gap-2 px-4 py-2.5 border-b border-slate-50 dark:border-slate-800/50 transition-colors hover:bg-rose-500/[0.02] ${d === 0 ? 'bg-slate-50/70 dark:bg-slate-900/40' : ''}`}
              style={{ paddingRight: `${1 + d * 1.5}rem` }}
            >
              {hasChildren ? (
                <button onClick={() => toggle(acc.code)} className="text-slate-400 hover:text-rose-500 transition-colors">
                  {collapsed.has(acc.code) ? <ChevronLeft size={14} /> : <ChevronDown size={14} />}
                </button>
              ) : (
                <span className="w-3.5" />
              )}
              <span className="text-[11px] font-black text-slate-400 w-12">{acc.code}</span>
              <span className={`flex-1 ${d === 0 ? 'font-extrabold text-slate-800 dark:text-white' : acc.isPostable ? 'font-bold text-slate-700 dark:text-slate-200' : 'font-bold text-slate-500'}`}>
                {acc.nameAr}
                {!acc.isPostable && <span className="text-[9px] mr-2 px-1.5 py-0.5 rounded bg-slate-400/10 text-slate-400 font-bold">تجميعي</span>}
              </span>
              {d === 0 && <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${root.tone}`}>{root.nameAr}</span>}
              <span className={`font-black text-[13px] w-32 text-left ${bal === 0 ? 'text-slate-300' : bal > 0 ? 'text-slate-800 dark:text-white' : 'text-rose-500'}`}>
                {bal === 0 ? '—' : fmt(bal)}
              </span>
              {customCodes.has(acc.code) && (
                <button onClick={() => removeAccount(acc.code)} className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-all" title="حذف الحساب المخصص (يُرفض لو عليه حركة)">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* إضافة حساب مخصص */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إضافة حساب لشجرة الحسابات">
        <div className="space-y-3">
          <div className="text-[12px] text-slate-500 leading-relaxed">
            الحساب الجديد يُدرج تحت المجموعة التي تختارها ويصبح متاحاً فوراً في
            <b> القيد اليدوي واليومية وميزان المراجعة والتقارير المالية</b> — بلا فرض للشجرة القياسية.
          </div>
          <Field label="المجموعة الأم *">
            <select value={nParent} onChange={(e) => setNParent(e.target.value)} className={inputCls}>
              <option value="">— اختر المجموعة —</option>
              {groups.map((g) => <option key={g.code} value={g.code}>{g.code} — {g.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="كود الحساب *" hint={nParent ? `يبدأ بـ ${nParent}` : '4-6 أرقام'}>
              <input value={nCode} onChange={(e) => setNCode(e.target.value)} className={inputCls} dir="ltr" placeholder={nParent ? `${nParent}9` : '1115'} />
            </Field>
            <Field label="اسم الحساب *">
              <input value={nName} onChange={(e) => setNName(e.target.value)} className={inputCls} placeholder="مثال: تأمينات لدى الغير، إيراد خدمات إضافية…" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAddOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveAccount} disabled={!nCode.trim() || !nName.trim() || !nParent}>💾 إضافة للحسابات</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
