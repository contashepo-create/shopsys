export interface PaymentInstallmentTerm {
  dueDays: number
  percent: number
}

export interface PaymentTerm {
  code: string
  nameAr: string
  installments: PaymentInstallmentTerm[]
}

export interface PaymentScheduleLine {
  sequence: number
  dueDate: string
  amountMinor: number
  percent: number
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function validatePaymentTerm(term: PaymentTerm): string[] {
  const errors: string[] = []
  if (!/^[A-Z0-9_-]{2,24}$/.test(term.code)) errors.push('كود شروط السداد غير صالح')
  if (!term.nameAr.trim()) errors.push('اسم شروط السداد مطلوب')
  if (!term.installments.length) errors.push('أضف استحقاقاً واحداً على الأقل')
  let priorDays = -1
  for (const installment of term.installments) {
    if (!Number.isInteger(installment.dueDays) || installment.dueDays < 0) errors.push('أيام الاستحقاق غير صالحة')
    if (!(installment.percent > 0) || installment.percent > 100) errors.push('نسبة الاستحقاق غير صالحة')
    if (installment.dueDays < priorDays) errors.push('رتب الاستحقاقات تصاعدياً')
    priorDays = installment.dueDays
  }
  const sum = Math.round(term.installments.reduce((total, line) => total + line.percent, 0) * 100) / 100
  if (sum !== 100) errors.push(`مجموع نسب الاستحقاق يجب أن يساوي 100٪ (الحالي ${sum}٪)`)
  return errors
}

/** يوزع الباقي الناتج عن التقريب على آخر قسط كي يطابق الإجمالي بالضبط. */
export function buildPaymentSchedule(documentDate: string, totalMinor: number, term: PaymentTerm): PaymentScheduleLine[] {
  const errors = validatePaymentTerm(term)
  if (errors.length) throw new RangeError(errors.join(' — '))
  if (!Number.isInteger(totalMinor) || totalMinor < 0) throw new RangeError('إجمالي المستند غير صالح')
  let allocated = 0
  return term.installments.map((installment, index) => {
    const last = index === term.installments.length - 1
    const amountMinor = last ? totalMinor - allocated : Math.round(totalMinor * installment.percent / 100)
    allocated += amountMinor
    return { sequence: index + 1, dueDate: addUtcDays(documentDate, installment.dueDays), amountMinor, percent: installment.percent }
  })
}
