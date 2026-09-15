/**
 * الأرصدة الافتتاحية (جولة مراجعة الموبايلات — نمط mobileshop):
 * المتجر المنتقل للبرنامج يثبت أرصدته القائمة (ديون عملاء/موردين، نقدية، سلف)
 * بقيود متوازنة مقابل رأس المال 3101 — والتعديل يرحّل قيد الفرق فقط.
 */
import { useMemo, useState } from 'react'
import { Scale, Users, Truck, PiggyBank, HandCoins, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { openingKey, type OpeningKind } from '../../core/openingBalances.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

const TABS: { id: OpeningKind; nameAr: string; icon: typeof Users; hint: string }[] = [
  { id: 'customer', nameAr: 'العملاء', icon: Users, hint: 'المديونيات القائمة لك على العملاء قبل البرنامج — قيد: عملاء 1104 / رأس المال' },
  { id: 'supplier', nameAr: 'الموردون', icon: Truck, hint: 'الديون القائمة عليك للموردين — قيد: رأس المال / موردون 2101' },
  { id: 'treasury', nameAr: 'الخزائن والبنوك', icon: PiggyBank, hint: 'النقدية الفعلية بالأدراج والحسابات يوم البدء — قيد: الخزينة / رأس المال' },
  { id: 'employee_advance', nameAr: 'سلف الموظفين', icon: HandCoins, hint: 'سلف قائمة لم تُخصم بعد — قيد: سلف 1107 / رأس المال' },
]

export function OpeningBalancesPage() {
  const { customers, suppliers, employees, treasuries, openingBalances, setOpeningBalance } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [tab, setTab] = useState<OpeningKind>('customer')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const meta = TABS.find((t) => t.id === tab)!

  const rows = useMemo(() => {
    if (tab === 'customer') return customers.map((c) => ({ refId: c.id as string | number, nameAr: c.nameAr }))
    if (tab === 'supplier') return suppliers.map((s) => ({ refId: s.id as string | number, nameAr: s.nameAr }))
    if (tab === 'treasury') return treasuries.map((t) => ({ refId: t.code as string | number, nameAr: t.nameAr }))
    return employees.map((e) => ({ refId: e.id as string | number, nameAr: e.nameAr }))
  }, [tab, customers, suppliers, treasuries, employees])

  const totalPosted = useMemo(
    () => rows.reduce((a, r) => a + (openingBalances[openingKey(tab, r.refId)] ?? 0), 0),
    [rows, openingBalances, tab],
  )

  const save = (refId: string | number, nameAr: string) => {
    const key = openingKey(tab, refId)
    const raw = drafts[key]
    if (raw == null || raw.trim() === '') return
    try {
      setOpeningBalance({ kind: tab, refId, amountMinor: toMinor(raw, cur.decimals), label: nameAr })
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n })
      toast.show(`ثُبّت الرصيد الافتتاحي لـ«${nameAr}» بقيد متوازن مقابل رأس المال ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-slate-400 max-w-xl leading-relaxed">
          <Scale size={14} className="inline -mt-0.5 ml-1" />
          لمن ينتقل للبرنامج بأرصدة قائمة: ثبّت ديون العملاء والموردين والنقدية والسلف كما هي يوم البدء —
          كل رصيد يولّد قيداً متوازناً مقابل <b>رأس المال 3101</b> فيبقى المركز المالي متزناً من أول يوم.
          التعديل لاحقاً يرحّل <b>قيد الفرق فقط</b> ولا يمس أي قيد قديم.
        </p>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-3 text-center">
          <div className="text-[10px] text-slate-400 font-bold">إجمالي المثبت — {meta.nameAr}</div>
          <div className="text-lg font-black text-brand-600">{fmt(totalPosted)} {cur.symbol}</div>
        </div>
      </div>

      <div className="anim-up flex gap-1.5 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 ${
                tab === t.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-600' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300'
              }`}
            >
              <Icon size={14} /> {t.nameAr}
            </button>
          )
        })}
      </div>

      <p className="text-[11.5px] text-slate-400">{meta.hint}</p>

      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-[12.5px]">لا سجلات — أضف {meta.nameAr} أولاً من شاشتهم</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">الاسم</th>
                <th className="px-4 py-2.5">الرصيد المثبت</th>
                <th className="px-4 py-2.5 w-44">رصيد جديد ({cur.symbol})</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = openingKey(tab, r.refId)
                const posted = openingBalances[key] ?? 0
                return (
                  <tr key={key} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                    <td className="px-4 py-2">
                      {posted > 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 size={13} /> {fmt(posted)}</span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={drafts[key] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && save(r.refId, r.nameAr)}
                        className={`${inputCls} !py-1.5 !text-[12px]`}
                        dir="ltr"
                        placeholder={posted > 0 ? fmt(posted) : '0'}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Btn variant="soft" onClick={() => save(r.refId, r.nameAr)} disabled={!drafts[key]?.trim()}>تثبيت</Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
