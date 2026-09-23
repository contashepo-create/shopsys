/**
 * منتقي الخزينة/البنك الموحّد (طلب المالك) —
 * يظهر في كل عملية نقدية: بيع، شراء، سندات، أقساط، رواتب، مصروفات…
 * يعرض كل الخزائن والبنوك المسجلة مهما كان عددها.
 */
import { useEffect } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { treasuryLabel } from '../../core/treasury.ts'
import { allowedTreasuryCodes, type TreasuryOperation } from '../../core/treasuryAccess.ts'
import { inputCls } from './ui.tsx'

export function TreasuryPicker({
  value, onChange, disabled, compact, operation,
}: {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  compact?: boolean
  /** عند تحديدها تُخفى الحسابات غير الممنوحة للمستخدم الحالي لهذه العملية. */
  operation?: TreasuryOperation
}) {
  const { treasuries: allTreasuries, appUsers, currentUserId } = useDataStore()
  const currentUser = appUsers.find((user) => user.id === currentUserId)
  const allowed = operation ? allowedTreasuryCodes(currentUser?.treasuryAccess, operation) : null
  const treasuries = allowed == null ? allTreasuries : allTreasuries.filter((treasury) => allowed.includes(treasury.code))
  const preferred = currentUser?.treasuryAccess?.defaultTreasuryCode
  const effectiveFallback = treasuries.some((treasury) => treasury.code === preferred) ? preferred! : treasuries[0]?.code
  const valueAllowed = treasuries.some((treasury) => treasury.code === value)
  useEffect(() => {
    if (effectiveFallback && !valueAllowed) onChange(effectiveFallback)
  }, [effectiveFallback, onChange, valueAllowed])
  if (treasuries.length === 0) return <div className="text-[11px] font-bold text-rose-500">لا توجد خزينة/بنك مسموح لهذه العملية</div>
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
      {treasuries.filter((t) => !t.parentCode).map((parent) => {
        const children = treasuries.filter((t) => t.parentCode === parent.code)
        return children.length ? (
          <optgroup key={parent.code} label={treasuryLabel(parent)}>
            <option value={parent.code}>{treasuryLabel(parent)} — الرئيسي</option>
            {children.map((child) => <option key={child.code} value={child.code}>↳ {treasuryLabel(child)}</option>)}
          </optgroup>
        ) : <option key={parent.code} value={parent.code}>{treasuryLabel(parent)}</option>
      })}
      {treasuries.filter((t) => t.parentCode && !treasuries.some((p) => p.code === t.parentCode)).map((t) => <option key={t.code} value={t.code}>{treasuryLabel(t)}</option>)}
    </select>
  )
}
