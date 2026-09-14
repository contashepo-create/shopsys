/**
 * السنوات المالية — ShopSys
 * (طلب المالك): التسجيل الجديد يبدأ بتأكيد فتح سنة مالية —
 * السنة الحالية أو سنة سابقة (لمن يحتاج تسجيل عمليات قديمة)، بتحديد البداية والنهاية.
 */

export interface FiscalYear {
  id: number
  nameAr: string // «2026» أو «2025-2026»
  startDate: string // ISO yyyy-mm-dd
  endDate: string
  status: 'open' | 'closed'
}

/** اقتراح سنة ميلادية كاملة */
export function suggestFiscalYear(year: number): Omit<FiscalYear, 'id' | 'status'> {
  return { nameAr: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

export function validateFiscalYear(fy: { nameAr: string; startDate: string; endDate: string }, existing: FiscalYear[]): string[] {
  const errors: string[] = []
  if (!fy.nameAr.trim()) errors.push('اسم السنة المالية مطلوب')
  if (!fy.startDate || !fy.endDate) errors.push('تاريخا البداية والنهاية مطلوبان')
  else {
    if (fy.endDate <= fy.startDate) errors.push('نهاية السنة يجب أن تكون بعد بدايتها')
    const days = (new Date(fy.endDate).getTime() - new Date(fy.startDate).getTime()) / 86400000
    if (days > 400) errors.push('السنة المالية لا تتجاوز ~13 شهراً')
    if (days < 27) errors.push('السنة المالية قصيرة جداً (أقل من شهر)')
    // تداخل مع سنوات موجودة
    for (const ex of existing) {
      if (fy.startDate <= ex.endDate && fy.endDate >= ex.startDate) {
        errors.push(`تتداخل مع السنة «${ex.nameAr}» (${ex.startDate} → ${ex.endDate})`)
      }
    }
  }
  return errors
}

/** هل التاريخ داخل سنة مالية مفتوحة؟ (كل قيد يجب أن يقع في سنة مفتوحة) */
export function dateInOpenYear(date: string, years: FiscalYear[]): FiscalYear | null {
  return years.find((y) => y.status === 'open' && date >= y.startDate && date <= y.endDate) ?? null
}
