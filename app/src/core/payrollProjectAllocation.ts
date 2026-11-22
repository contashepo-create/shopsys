/**
 * حساب نسب استرشادية فقط. لا يثبت أن الموظف شارك في المشروع، ولا يحفظ
 * إسناداً أو يرحّل راتباً أو يؤثر في اليومية أو تقارير المشاريع.
 * يمرّر المستدعي المشاريع التي ثبتت مشاركته فيها صراحةً للفترة المعنية.
 */
export interface PayrollAllocationProject {
  id: number
  status: 'active' | 'completed'
}

/** وحدات النسبة: 10000 = 100٪ و 1 = 0.01٪. */
export interface PayrollProjectPercentage {
  projectId: number
  basisPoints: number
}

/** لقطة تخصيص عند ترحيل القسيمة؛ ليست قيداً أو مصروفاً ثانياً. */
export interface PayrollProjectAllocationSnapshot {
  version: 1
  basis: 'payroll_5102_net_plus_advance'
  expenseMinor: number
  journalEntryId: number
  projects: (PayrollProjectPercentage & { amountMinor: number; projectCode: string; projectName: string })[]
}

function eligibleProjectIds(projects: readonly PayrollAllocationProject[]): number[] {
  const ids = new Set<number>()
  for (const project of projects) {
    if (!project || !Number.isSafeInteger(project.id) || project.id <= 0 || ids.has(project.id)) {
      throw new Error('المشاريع المشاركة غير صالحة أو مكررة')
    }
    if (project.status !== 'active') throw new Error('لا يُقترح توزيع تلقائي على مشروع غير قائم')
    ids.add(project.id)
  }
  if (ids.size > 10000) throw new Error('عدد المشاريع يتجاوز دقة النسب المتاحة')
  return [...ids].sort((a, b) => a - b)
}

/**
 * مشروعان 50٪ لكل مشروع، وأكثر من مشروعين بالتساوي قدر دقة 0.01٪.
 * عند عدم انقسام 100٪ توزع الأجزاء الزائدة حسب ترتيب معرف المشروع،
 * بحيث لا تتجاوز أو تنقص النسب عن 100٪. المشروع الوحيد يأخذ 100٪ افتراضياً.
 */
export function suggestPayrollProjectPercentages(projects: readonly PayrollAllocationProject[]): PayrollProjectPercentage[] {
  const ids = eligibleProjectIds(projects)
  if (ids.length === 0) return []
  const base = Math.floor(10000 / ids.length)
  const remainder = 10000 % ids.length
  return ids.map((projectId, index) => ({ projectId, basisPoints: base + (index < remainder ? 1 : 0) }))
}

/** يحفظ الباقي غير موزع في النتيجة؛ لا يقرر هل يُحمّل فرعاً أو حساباً. */
export function validateManualPayrollPercentages(projects: readonly PayrollAllocationProject[], shares: readonly PayrollProjectPercentage[]): { unallocatedBasisPoints: number } {
  const ids = eligibleProjectIds(projects)
  const allowed = new Set(ids), seen = new Set<number>()
  let total = 0
  for (const share of shares) {
    if (!share || !allowed.has(share.projectId) || seen.has(share.projectId)) throw new Error('المشروع غير مشارك أو مكرر في التوزيع')
    if (!Number.isSafeInteger(share.basisPoints) || share.basisPoints < 0 || share.basisPoints > 10000) throw new Error('النسبة يجب أن تكون بين صفر و100٪ بدقة 0.01٪')
    seen.add(share.projectId)
    total += share.basisPoints
    if (total > 10000) throw new Error('مجموع نسب المشاريع يتجاوز 100٪')
  }
  if (seen.size !== ids.length) throw new Error('أدخل نسبة لكل مشروع مشارك، ويمكن إدخال صفر')
  return { unallocatedBasisPoints: 10000 - total }
}

/**
 * نصيب الموظف من مدين 5102 حسب حساب المسير الحالي: الصافي مع السلفة
 * المستردة. هذه العملية لا تثبت مطابقة القيد الإجمالي أو سلامة تاريخ المستند.
 */
export function payrollProjectExpenseBasis(netMinor: number, recoveredAdvanceMinor: number): number {
  if (![netMinor, recoveredAdvanceMinor].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('أساس تكلفة الراتب غير صالح')
  const total = netMinor + recoveredAdvanceMinor
  if (!Number.isSafeInteger(total)) throw new Error('أساس تكلفة الراتب يتجاوز النطاق الآمن')
  return total
}

/**
 * حساب معاينة مبالغ صحيحة لوحدات العملة الصغرى. لا تحفظ ولا تتحقق من القيد.
 * المتبقي غير موزع؛ لا يُحمّل فرعاً أو مشروعاً تلقائياً.
 * يُوزع فرق التقريب بأكبر باقي، ثم معرف المشروع، والمتبقي غير الموزع أخيراً.
 */
export function calculatePayrollProjectAmounts(projects: readonly PayrollAllocationProject[], shares: readonly PayrollProjectPercentage[], expenseMinor: number): {
  shares: (PayrollProjectPercentage & { amountMinor: number })[]
  unallocatedBasisPoints: number
  unallocatedMinor: number
} {
  if (!Number.isSafeInteger(expenseMinor) || expenseMinor < 0) throw new Error('مبلغ تكلفة الراتب غير صالح')
  const { unallocatedBasisPoints } = validateManualPayrollPercentages(projects, shares)
  const parts: { projectId: number | null; basisPoints: number; amountMinor: number; remainder: bigint }[] = [
    ...shares.map(share => ({ projectId: share.projectId, basisPoints: share.basisPoints })),
    { projectId: null, basisPoints: unallocatedBasisPoints },
  ].map(part => {
    const numerator = BigInt(expenseMinor) * BigInt(part.basisPoints)
    return { ...part, amountMinor: Number(numerator / 10000n), remainder: numerator % 10000n }
  })
  let residual = expenseMinor - parts.reduce((sum, part) => sum + part.amountMinor, 0)
  const ranked = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    if (a.projectId == null) return b.projectId == null ? 0 : 1
    if (b.projectId == null) return -1
    return a.projectId - b.projectId
  })
  for (const part of ranked) {
    if (residual === 0) break
    part.amountMinor++; residual--
  }
  const unallocated = parts.find(part => part.projectId === null)!
  return {
    shares: parts.filter((part): part is typeof part & { projectId: number } => part.projectId !== null)
      .map(({ projectId, basisPoints, amountMinor }) => ({ projectId, basisPoints, amountMinor })),
    unallocatedBasisPoints,
    unallocatedMinor: unallocated.amountMinor,
  }
}

/** يفحص شكل اللقطة وحسابها؛ لا يثبت القيد أو الإلغاء أو مشاركة الموظف. */
export function isPayrollProjectSnapshotReadable(value: unknown, slip: { netMinor: number; advanceMinor: number; accrualEntryId: number }): value is PayrollProjectAllocationSnapshot {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const snapshot = value as PayrollProjectAllocationSnapshot
    if (snapshot.version !== 1 || snapshot.basis !== 'payroll_5102_net_plus_advance' || !Number.isSafeInteger(slip.accrualEntryId) || slip.accrualEntryId <= 0 || snapshot.journalEntryId !== slip.accrualEntryId || snapshot.expenseMinor !== payrollProjectExpenseBasis(slip.netMinor, slip.advanceMinor) || !Array.isArray(snapshot.projects) || !snapshot.projects.length) return false
    if (snapshot.projects.some(project => !project || typeof project.projectCode !== 'string' || !project.projectCode.trim() || typeof project.projectName !== 'string' || !project.projectName.trim() || !Number.isSafeInteger(project.amountMinor) || project.amountMinor < 0)) return false
    // حالة المشروع الحالية ليست دليلاً على حالته عند إصدار القسيمة.
    const projects: PayrollAllocationProject[] = snapshot.projects.map(project => ({ id: project.projectId, status: 'active' }))
    const result = calculatePayrollProjectAmounts(projects, snapshot.projects, snapshot.expenseMinor)
    return result.unallocatedBasisPoints === 0 && result.shares.every((row, index) => row.amountMinor === snapshot.projects[index].amountMinor)
  } catch { return false }
}

/** إدخال النسبة مع أرقام عربية أو إنجليزية وبحد أقصى منزلتين عشريتين. */
export function parsePayrollProjectPercentage(text: string): number {
  const normalized = text.trim().replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٫,]/g, '.')
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) throw new Error('أدخل نسبة صحيحة بمنزلتين عشريتين كحد أقصى')
  const [whole, fraction = ''] = normalized.split('.')
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (basisPoints > 10000) throw new Error('النسبة لا تتجاوز 100٪')
  return basisPoints
}
