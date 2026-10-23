/**
 * شارة «الفرع النشط» — مصدر واحد لشكلها في الشريط العلوي والجانبي وفوق اسم المستخدم.
 *
 * قرار المالك (2026-10-22): اسم الفرع كان يُكتب بلون داكن على خلفية رمادية فلا
 * يُقرأ بسرعة، والمطلوب أن يعرف المستخدم **دائماً** أي فرع يعمل داخله: شارة
 * واضحة عالية التباين، ونقطة حالة، وتوهّج نابض هادئ (٣.٨ ثانية) يتوقف تلقائياً
 * لمن طلب تقليل الحركة. الأحمر محفوظ للتحذيرات الحقيقية، فلا تُلوَّن الشارة به.
 *
 * لا تحتوي منطق صلاحيات: تستقبل الفرع الجاهز من `useEffectiveBranchScope`،
 * وتُعيد اختيار المالك عبر `onChange` فقط. الموظف المقيَّد بفرع يراها للقراءة.
 */
import { GitBranch, ChevronDown, Lock } from 'lucide-react'

export interface BranchOption {
  id: number
  nameAr: string
  /** نمط وحدات الفرع: 'custom' يعرض وسم «(مخصص)» بجانب الاسم */
  customModulesMode?: 'all' | 'custom'
}

export function BranchBadge({
  branches,
  value,
  locked = false,
  onChange,
  placement,
  showCaption = false,
  fallbackName,
  className = '',
}: {
  branches: readonly BranchOption[]
  /** الفرع الفعّال — null يعني «كل الفروع (شامل)» */
  value: number | null
  /** حساب مقيَّد بفرع: عرض للقراءة فقط */
  locked?: boolean
  onChange?: (id: number | null) => void
  placement: 'menubar' | 'sidebar' | 'header'
  /** شرح مختصر «الفرع الحالي» — يُستخدم فوق اسم المستخدم فقط */
  showCaption?: boolean
  /**
   * اسم الفرع الفعّال حين لا يكون ضمن `branches` (فرع مُعطَّل مثلاً).
   * بلا هذا الاسم يظهر المبدّل «كل الفروع» بينما النظام مقيَّد بفرع آخر.
   */
  fallbackName?: string
  className?: string
}) {
  if (branches.length === 0) return null
  const current = value == null ? null : branches.find((b) => b.id === value) ?? null
  /* «شامل» تعني فعلاً بلا فرع (value == null) — لا تعني «لم أجد الفرع في القائمة» */
  const allBranches = value == null
  const displayName = current?.nameAr
    ?? (allBranches ? 'كل الفروع' : (fallbackName ?? (locked ? 'فرعك غير متاح' : `فرع #${value}`)))
  const switchable = !locked && !!onChange
  const tone = allBranches ? 'is-all' : 'is-current'
  const switchAttrs = placement === 'menubar'
    ? { 'data-menubar-branch-locked': locked && current ? current.id : undefined }
    : placement === 'sidebar'
      ? { 'data-sidebar-branch-locked': locked && current ? current.id : undefined }
      : {}
  const title = locked
    ? `فرع العمل الحالي: ${displayName} — مخصص لحسابك ولا يمكن تبديله`
    : allBranches
      ? 'عرض شامل لكل الفروع — اختر فرعاً للعمل داخله'
      : `فرع العمل الحالي: ${displayName}`

  const icon = <GitBranch size={10} className="branch-badge-ico" aria-hidden />
  const dot = <span className={`branch-badge-dot ${tone}`} aria-hidden />
  const lock = locked ? <Lock size={9} className="branch-badge-lock" aria-hidden /> : null

  if (!switchable) {
    return (
      <span
        className={`branch-badge ${tone} branch-badge--${placement} ${className}`}
        title={title}
        data-branch-badge={placement}
        {...switchAttrs}
      >
        {icon}
        {dot}
        <span className="branch-badge-name">{displayName}</span>
        {showCaption && !allBranches && <small className="branch-badge-caption">الفرع الحالي</small>}
        {lock}
      </span>
    )
  }

  return (
    <label
      className={`branch-badge ${tone} branch-badge--${placement} is-switchable ${className}`}
      title={title}
      data-branch-badge={placement}
    >
      {icon}
      {dot}
      <select
        aria-label="الفرع النشط — تبديل الفرع"
        data-branch-switcher={placement}
        value={current?.id ?? value ?? ''}
        onChange={(e) => onChange?.(e.target.value ? Number(e.target.value) : null)}
        className="branch-badge-select"
      >
        <option value="">كل الفروع (شامل)</option>
        {/* الفرع الفعّال المُعطَّل: خيار صريح كي لا يعرض المبدّل خياراً مخالفاً للحالة */}
        {!current && value != null && (
          <option value={value}>{fallbackName ?? `فرع #${value}`}</option>
        )}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nameAr}
            {b.customModulesMode === 'custom' ? ' (مخصص)' : ''}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="branch-badge-chev" aria-hidden />
    </label>
  )
}
