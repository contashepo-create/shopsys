/**
 * منتقي الخزينة/البنك الموحّد (طلب المالك) —
 * يظهر في كل عملية نقدية: بيع، شراء، سندات، أقساط، رواتب، مصروفات…
 * يعرض كل الخزائن والبنوك المسجلة مهما كان عددها.
 */
import { useDataStore } from '../../data/repo.ts'
import { treasuryLabel } from '../../core/treasury.ts'
import { inputCls } from './ui.tsx'

export function TreasuryPicker({
  value, onChange, disabled, compact,
}: {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  compact?: boolean
}) {
  const treasuries = useDataStore((s) => s.treasuries)
  // قائمة قصيرة (2-3) ⇒ أزرار واضحة؛ أطول ⇒ قائمة منسدلة
  if (treasuries.length <= 3 && !compact) {
    return (
      <div className={`grid gap-2 ${treasuries.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {treasuries.map((t) => (
          <button
            key={t.code}
            type="button"
            disabled={disabled}
            onClick={() => onChange(t.code)}
            className={`p-2.5 rounded-xl border-2 text-[12px] font-bold transition-all disabled:opacity-40 ${
              value === t.code
                ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-sky-300'
            }`}
          >
            {treasuryLabel(t)}
          </button>
        ))}
      </div>
    )
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputCls}>
      {treasuries.map((t) => (
        <option key={t.code} value={t.code}>{treasuryLabel(t)}</option>
      ))}
    </select>
  )
}
