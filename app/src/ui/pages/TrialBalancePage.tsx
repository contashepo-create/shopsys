/**
 * ميزان المراجعة + قائمة الدخل (المرحلة 4) —
 * مجاميع وأرصدة كل الحسابات المتحركة، مع سطر تحقق التوازن،
 * وقائمة دخل بفترة اختيارية (صافي ربح/خسارة).
 */
import { useMemo, useState } from 'react'
import { Scale, CheckCircle2, AlertTriangle, TrendingUp } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { STANDARD_COA } from '../../core/ledger.ts'
import { fullCoa } from '../../core/treasury.ts'
import { computeTrialBalance, computeIncomeStatement } from '../../core/accounting.ts'
import { inputCls, EmptyState } from '../components/ui.tsx'

export function TrialBalancePage() {
  const { journal, treasuries } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [tab, setTab] = useState<'trial' | 'income'>('trial')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // الشجرة الكاملة تشمل الخزائن والبنوك المخصصة — حتى لا تسقط أرصدتها من الميزان
  const coa = useMemo(() => fullCoa(STANDARD_COA, treasuries), [treasuries])
  const tb = useMemo(() => computeTrialBalance(journal, coa), [journal, coa])
  const is = useMemo(
    () => computeIncomeStatement(journal, coa, from || undefined, to || undefined),
    [journal, coa, from, to],
  )

  if (journal.length === 0) {
    return (
      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
        <EmptyState icon="⚖️" title="لا قيود بعد" sub="ميزان المراجعة وقائمة الدخل يتولدان من دفتر الأستاذ — ابدأ بالبيع أو الشراء" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* تبويب */}
      <div className="anim-up flex gap-2">
        <button
          onClick={() => setTab('trial')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'trial' ? 'bg-rose-500/10 text-rose-600 border-2 border-rose-500/40' : 'text-slate-400 border-2 border-transparent hover:bg-slate-500/5'}`}
        >
          <Scale size={14} className="inline ml-1" /> ميزان المراجعة
        </button>
        <button
          onClick={() => setTab('income')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'income' ? 'bg-emerald-500/10 text-emerald-600 border-2 border-emerald-500/40' : 'text-slate-400 border-2 border-transparent hover:bg-slate-500/5'}`}
        >
          <TrendingUp size={14} className="inline ml-1" /> قائمة الدخل
        </button>
      </div>

      {tab === 'trial' ? (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الحساب</th>
                <th className="px-4 py-3 font-bold text-left">مجموع مدين</th>
                <th className="px-4 py-3 font-bold text-left">مجموع دائن</th>
                <th className="px-4 py-3 font-bold text-left">رصيد مدين</th>
                <th className="px-4 py-3 font-bold text-left">رصيد دائن</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, i) => (
                <tr key={r.code} style={{ animationDelay: `${i * 20}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.02] transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-black text-slate-400 ml-2">{r.code}</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</span>
                  </td>
                  <td className="px-4 py-2.5 text-left text-slate-500">{r.totalDebit ? fmt(r.totalDebit) : '—'}</td>
                  <td className="px-4 py-2.5 text-left text-slate-500">{r.totalCredit ? fmt(r.totalCredit) : '—'}</td>
                  <td className="px-4 py-2.5 text-left font-black text-slate-800 dark:text-white">{r.balanceDebit ? fmt(r.balanceDebit) : '—'}</td>
                  <td className="px-4 py-2.5 text-left font-black text-slate-800 dark:text-white">{r.balanceCredit ? fmt(r.balanceCredit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-900/50 font-black text-[13px]">
                <td className="px-4 py-3">الإجمالي</td>
                <td className="px-4 py-3 text-left">{fmt(tb.totalDebit)}</td>
                <td className="px-4 py-3 text-left">{fmt(tb.totalCredit)}</td>
                <td className="px-4 py-3 text-left">{fmt(tb.balanceDebitTotal)}</td>
                <td className="px-4 py-3 text-left">{fmt(tb.balanceCreditTotal)}</td>
              </tr>
            </tfoot>
          </table>
          {/* سطر تحقق التوازن */}
          <div className={`px-4 py-3 flex items-center gap-2 text-[13px] font-bold ${tb.balanced ? 'bg-emerald-500/5 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
            {tb.balanced ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {tb.balanced
              ? `الميزان متزن تماماً: مدين ${fmt(tb.totalDebit)} = دائن ${fmt(tb.totalCredit)} ✓`
              : 'الميزان مختل! هذا لا يجب أن يحدث بنيوياً — راجع فوراً'}
          </div>
        </div>
      ) : (
        <div className="anim-up space-y-4">
          {/* فترة */}
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1">من</div>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1">إلى</div>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </div>
            {(from || to) && (
              <button onClick={() => { setFrom(''); setTo('') }} className="text-[12px] font-bold text-slate-400 hover:text-rose-500 pb-2.5 transition-colors">✕ كل الفترات</button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* الإيرادات */}
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-emerald-500/20 overflow-hidden">
              <div className="px-4 py-2.5 text-[12px] font-black text-emerald-600 bg-emerald-500/5 border-b border-emerald-500/10">الإيرادات</div>
              {is.revenueRows.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-slate-400">لا إيرادات في الفترة</div>
              ) : (
                is.revenueRows.map((r) => (
                  <div key={r.code} className="flex justify-between px-4 py-2 border-b border-slate-50 dark:border-slate-800/50 text-[13px]">
                    <span className="font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</span>
                    <span className="font-black text-emerald-600">{fmt(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between px-4 py-2.5 bg-emerald-500/5 font-black text-emerald-700 dark:text-emerald-300">
                <span>إجمالي الإيرادات</span><span>{fmt(is.totalRevenue)}</span>
              </div>
            </div>

            {/* المصروفات */}
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-amber-500/20 overflow-hidden">
              <div className="px-4 py-2.5 text-[12px] font-black text-amber-600 bg-amber-500/5 border-b border-amber-500/10">المصروفات</div>
              {is.expenseRows.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-slate-400">لا مصروفات في الفترة</div>
              ) : (
                is.expenseRows.map((r) => (
                  <div key={r.code} className="flex justify-between px-4 py-2 border-b border-slate-50 dark:border-slate-800/50 text-[13px]">
                    <span className="font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</span>
                    <span className="font-black text-amber-600">{fmt(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between px-4 py-2.5 bg-amber-500/5 font-black text-amber-700 dark:text-amber-300">
                <span>إجمالي المصروفات</span><span>{fmt(is.totalExpenses)}</span>
              </div>
            </div>
          </div>

          {/* صافي النتيجة */}
          <div className={`rounded-3xl p-5 text-center border-2 ${is.netIncome >= 0 ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-rose-500/30 bg-rose-500/[0.04]'}`}>
            <div className="text-[12px] font-bold text-slate-400">{is.netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</div>
            <div className={`font-black text-3xl mt-1 ${is.netIncome >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {fmt(Math.abs(is.netIncome))} {cur.symbol}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">إيرادات {fmt(is.totalRevenue)} − مصروفات {fmt(is.totalExpenses)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
