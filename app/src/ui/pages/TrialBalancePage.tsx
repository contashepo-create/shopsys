import { useState } from 'react'
import { getCountry } from '../../core/countries.ts'
import { todayLocalIso } from '../../core/time.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { inputCls } from '../components/ui.tsx'
import { FinancialReportsTab } from './FinancialReportsTab.tsx'

/** تقرير الحسابات يستخدم نفس منهج وتقارير مركز التقارير. */
export function TrialBalancePage() {
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const [today] = useState(() => todayLocalIso())
  const [from, setFrom] = useState(() => `${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-card-dark">
      <label className="text-xs font-bold text-slate-500">من<input aria-label="من تاريخ" type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inputCls} block mt-1`} /></label>
      <label className="text-xs font-bold text-slate-500">إلى<input aria-label="إلى تاريخ" type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inputCls} block mt-1`} /></label>
      <p className="text-xs text-slate-500">الفترة الافتراضية من بداية السنة الميلادية حتى اليوم؛ يمكن تعديلها لتطابق السنة المالية.</p>
    </div>
    <FinancialReportsTab period={{ from, to }} cur={cur} companyName={setup.shopName || 'المنشأة'} />
  </div>
}
