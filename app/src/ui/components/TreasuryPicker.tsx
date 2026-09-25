import { QuickSelect } from './KeyboardPickers.tsx'
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
  // توحيد تجربة الدفع: حتى القائمة القصيرة تبقى قائمة منسدلة، لتظهر
  // النقدي والبنك والمحفظة والفروع/الحسابات التابعة في مكان واحد بلا أزرار متجاورة.
  return (
    <QuickSelect value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${inputCls} ${compact ? 'text-sm' : ''}`}>
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
    </QuickSelect>
  )
}
