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

/** هل التاريخ داخل سنة مالية مقفلة؟ — يمنع التسجيل بأثر رجعي في فترة مقفلة (نمط Closing Date العالمي) */
export function dateInClosedYear(date: string, years: readonly FiscalYear[]): FiscalYear | null {
  return years.find((y) => y.status === 'closed' && date >= y.startDate && date <= y.endDate) ?? null
}

/* ─── إقفال السنة المالية (مراجعة البرامج العالمية: QuickBooks/Xero/SAP) ───
 * المنهجية القياسية Closing Entries:
 * ① كل حسابات الإيرادات (4xxx) تُصفَّر بقيد مدين بأرصدتها الدائنة.
 * ② كل حسابات المصروفات (5xxx) تُصفَّر بقيد دائن بأرصدتها المدينة.
 * ③ الفرق (صافي الربح/الخسارة) يُرحَّل إلى «أرباح مرحّلة» 3102.
 * ④ الميزانية (أصول/التزامات/حقوق ملكية) لا تُقفل — أرصدتها تنتقل تلقائياً
 *    لأن المركز المالي تراكمي من أول قيد (لا حاجة لقيود افتتاحية).
 * ⑤ بعد الإقفال تُقفل الفترة: لا قيود بأثر رجعي داخلها (dateInClosedYear).
 */

export interface ClosingLine { accountCode: string; debit: number; credit: number; note: string }

export interface YearClosingResult {
  lines: ClosingLine[]
  totalRevenueMinor: number
  totalExpenseMinor: number
  netProfitMinor: number // موجب = ربح يُرحَّل دائناً في 3102
}

/**
 * بناء قيد إقفال السنة من دفتر اليومية: يجمع صافي كل حساب إيراد/مصروف
 * داخل الفترة ويولّد الأسطر المُصفِّرة + سطر الأرباح المرحلة 3102.
 * يستثني قيود إقفال سابقة وقوائم القيود العاكسة لها تدخل بطبيعتها (مجاميع صافية).
 */
export function buildYearClosingLines(
  journal: readonly { date: string; lines: readonly { accountCode: string; debit: number; credit: number }[] }[],
  fy: { startDate: string; endDate: string; nameAr: string },
): YearClosingResult {
  // صافي حركة كل حساب 4xxx/5xxx داخل السنة
  const nets = new Map<string, { d: number; c: number }>()
  for (const e of journal) {
    if (e.date < fy.startDate || e.date > fy.endDate) continue
    for (const l of e.lines) {
      const root = l.accountCode[0]
      if (root !== '4' && root !== '5') continue
      const cur = nets.get(l.accountCode) ?? { d: 0, c: 0 }
      cur.d += l.debit
      cur.c += l.credit
      nets.set(l.accountCode, cur)
    }
  }
  const lines: ClosingLine[] = []
  let totalRevenueMinor = 0
  let totalExpenseMinor = 0
  for (const [code, v] of [...nets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (code.startsWith('4')) {
      const bal = v.c - v.d // رصيد الإيراد الدائن
      if (bal > 0) lines.push({ accountCode: code, debit: bal, credit: 0, note: `إقفال إيراد سنة ${fy.nameAr}` })
      else if (bal < 0) lines.push({ accountCode: code, debit: 0, credit: -bal, note: `إقفال إيراد (رصيد عكسي) سنة ${fy.nameAr}` })
      totalRevenueMinor += bal
    } else {
      const bal = v.d - v.c // رصيد المصروف المدين
      if (bal > 0) lines.push({ accountCode: code, debit: 0, credit: bal, note: `إقفال مصروف سنة ${fy.nameAr}` })
      else if (bal < 0) lines.push({ accountCode: code, debit: -bal, credit: 0, note: `إقفال مصروف (رصيد عكسي) سنة ${fy.nameAr}` })
      totalExpenseMinor += bal
    }
  }
  const netProfitMinor = totalRevenueMinor - totalExpenseMinor
  if (netProfitMinor > 0) lines.push({ accountCode: '3102', debit: 0, credit: netProfitMinor, note: `صافي ربح سنة ${fy.nameAr} → أرباح مرحّلة` })
  else if (netProfitMinor < 0) lines.push({ accountCode: '3102', debit: -netProfitMinor, credit: 0, note: `صافي خسارة سنة ${fy.nameAr} → أرباح مرحّلة` })
  // توازن بنيوي إلزامي
  const d = lines.reduce((a, l) => a + l.debit, 0)
  const c = lines.reduce((a, l) => a + l.credit, 0)
  if (d !== c) throw new Error(`قيد الإقفال غير متوازن (${d} ≠ ${c}) — عيب داخلي`)
  return { lines, totalRevenueMinor, totalExpenseMinor, netProfitMinor }
}

/** تحقق قبل الإقفال: السنة منتهية فعلاً، ولا سنة أقدم منها ما زالت مفتوحة (الإقفال بالترتيب) */
export function validateYearClose(fy: FiscalYear, allYears: readonly FiscalYear[], todayIso: string): string[] {
  const errors: string[] = []
  if (fy.status === 'closed') errors.push('السنة مقفلة بالفعل')
  if (fy.endDate >= todayIso) errors.push(`لا تُقفل سنة قبل انتهائها — تنتهي في ${fy.endDate}`)
  const olderOpen = allYears.find((y) => y.id !== fy.id && y.status === 'open' && y.endDate < fy.startDate)
  if (olderOpen) errors.push(`أقفل السنة الأقدم «${olderOpen.nameAr}» أولاً — الإقفال يكون بالترتيب الزمني`)
  return errors
}
