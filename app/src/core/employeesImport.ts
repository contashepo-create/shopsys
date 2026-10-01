/**
 * استيراد الموظفين من Excel/CSV (البند ③ من أمر «اكمل ونفذ» 2026-10-01):
 * تحليل مرن بلا مكتبات — رؤوس أعمدة عربية/إنجليزية بمرادفات، أرقام عربية
 * وهندية، وتواريخ مصرية (يوم/شهر/سنة). «قالب الأعمدة» يُنزَّل كملف CSV
 * يفتحه Excel مباشرة، وتصدير Excel بتنسيق CSV يُستورد هنا كما في بصمة الحضور.
 *
 * نواة خالصة بلا React ولا قيود — كل مبلغ يُحوَّل للوحدة الصغرى (Minor).
 */
export interface EmployeeImportRow {
  nameAr: string
  jobTitle: string
  phone: string
  hireDate: string // YYYY-MM-DD ('' إن لم يُذكر)
  baseSalaryMinor: number
  allowancesMinor: number
  notes: string
}

export interface EmployeeImportResult {
  rows: EmployeeImportRow[]
  errors: string[]
}

/** الأعمدة المفهومة تلقائياً — بالمرادفات العربية والإنجليزية */
export const EMPLOYEES_IMPORT_COLUMNS: { key: keyof EmployeeImportRow | 'ignore'; labelAr: string; synonyms: string[] }[] = [
  { key: 'nameAr', labelAr: 'اسم الموظف', synonyms: ['الاسم', 'اسمالموظف', 'الموظف', 'name', 'employee'] },
  { key: 'jobTitle', labelAr: 'المسمى الوظيفي', synonyms: ['المسمىالوظيفي', 'الوظيفة', 'العمل', 'job', 'title', 'position'] },
  { key: 'phone', labelAr: 'الهاتف', synonyms: ['الهاتف', 'الموبايل', 'الجوال', 'التليفون', 'phone', 'mobile'] },
  { key: 'hireDate', labelAr: 'تاريخ التعيين', synonyms: ['تاريخالتعيين', 'التعيين', 'hire', 'hiredate', 'hire_date'] },
  { key: 'baseSalaryMinor', labelAr: 'الراتب الأساسي', synonyms: ['الراتبالاساسي', 'الاساسي', 'الراتب', 'salary', 'base'] },
  { key: 'allowancesMinor', labelAr: 'البدلات', synonyms: ['البدلات', 'البدل', 'allowances', 'allowance'] },
  { key: 'notes', labelAr: 'ملاحظات', synonyms: ['ملاحظات', 'الملاحظات', 'ملاحظه', 'notes', 'note'] },
]

/** توحيد الأرقام العربية/الهندية إلى اللاتينية (١٢٣ ⇒ 123) */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
}

/** «5,000.50» أو «5000٫5» أو «١٢٣٤» ⇐ وحدة صغرى صحيحة؛ null إن لم تكن رقماً */
export function parseMoneyToMinor(raw: string): number | null {
  const v = normalizeDigits(String(raw ?? '').trim()).replace(/[٬,\s]/g, '').replace('٫', '.')
  if (!v) return 0
  if (!/^\d+(\.\d{1,4})?$/.test(v)) return null
  return Math.round(Number(v) * 100)
}

/** التواريخ: YYYY-MM-DD أو يوم/شهر/سنة (المصري) ⇐ YYYY-MM-DD؛ '' إن فارغ؛ null إن غير مفهوم */
export function parseEmployeeDate(raw: string): string | null {
  const v = normalizeDigits(String(raw ?? '').trim())
  if (!v) return ''
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v)
  if (m) {
    const day = Number(m[1]), month = Number(m[2])
    if (month > 12 || day > 31) return null
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

/**
 * تحليل نص CSV/الملصوق من Excel: يتقبل رؤوساً بمرادفات (أو بدون رأس
 * بالترتيب القياسي: الاسم، الوظيفة، الهاتف، التعيين، الأساسي، البدلات،
 * الملاحظات) ويفصل بفواصل أو Tabs (لصق Excel المباشر).
 */
export function parseEmployeesCsv(text: string): EmployeeImportResult {
  const errors: string[] = []
  const rows: EmployeeImportRow[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { rows, errors: ['الملف فارغ'] }

  /* تقسيم يفهم حقول CSV المقتبسة: Excel يصدّر الأرقام بفواصل الآلاف داخل
     اقتباس ("5,000.50") فيجب ألا تُكسر الحقول — والفاصل فاصلة أو Tab */
  const splitLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 1 } else inQuotes = false
        } else cur += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',' || ch === '\t') { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const header = splitLine(lines[0]).map((cell) => normalizeDigits(cell).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  const colOf = (col: { synonyms: string[] }): number =>
    header.findIndex((cell) => col.synonyms.some((w) => cell === w || cell.includes(w)))

  const knownCols = EMPLOYEES_IMPORT_COLUMNS.map((col) => colOf(col))
  const hasHeader = knownCols.some((index) => index >= 0)
  const cols = hasHeader
    ? Object.fromEntries(EMPLOYEES_IMPORT_COLUMNS.map((col, i) => [col.key, knownCols[i]])) as Record<string, number>
    : { nameAr: 0, jobTitle: 1, phone: 2, hireDate: 3, baseSalaryMinor: 4, allowancesMinor: 5, notes: 6 }
  const dataLines = hasHeader ? lines.slice(1) : lines

  const cell = (line: string[], key: string): string => {
    const index = cols[key]
    return index != null && index >= 0 ? (line[index] ?? '').trim() : ''
  }

  for (let i = 0; i < dataLines.length; i++) {
    const lineNo = hasHeader ? i + 2 : i + 1
    const parts = splitLine(dataLines[i])
    const nameAr = cell(parts, 'nameAr')
    if (!nameAr) { errors.push(`سطر ${lineNo}: اسم الموظف مطلوب`); continue }
    const salaryRaw = cell(parts, 'baseSalaryMinor')
    const baseSalaryMinor = parseMoneyToMinor(salaryRaw)
    if (baseSalaryMinor == null) { errors.push(`سطر ${lineNo}: راتب غير مفهوم «${salaryRaw}» — اكتب رقماً مثل 5000 أو 5000.50`); continue }
    const allowancesRaw = cell(parts, 'allowancesMinor')
    const allowancesMinor = parseMoneyToMinor(allowancesRaw)
    if (allowancesMinor == null) { errors.push(`سطر ${lineNo}: بدلات غير مفهومة «${allowancesRaw}»`); continue }
    const hireDate = parseEmployeeDate(cell(parts, 'hireDate'))
    if (hireDate == null) { errors.push(`سطر ${lineNo}: تاريخ تعيين غير مفهوم — استعمل 2026-01-15 أو 15/01/2026`); continue }
    rows.push({
      nameAr,
      jobTitle: cell(parts, 'jobTitle'),
      phone: normalizeDigits(cell(parts, 'phone')).replace(/[^\d+]/g, ''),
      hireDate: hireDate || new Date().toISOString().slice(0, 10),
      baseSalaryMinor,
      allowancesMinor,
      notes: cell(parts, 'notes'),
    })
  }
  return { rows, errors }
}

/** قالب الأعمدة الرسمي — يُنزَّل كملف CSV يفتحه Excel مباشرة */
export function employeesImportTemplateCsv(): string {
  const head = EMPLOYEES_IMPORT_COLUMNS.filter((c) => c.key !== 'ignore').map((c) => c.labelAr).join(',')
  const examples = [
    ['أحمد سعيد', 'كاشير', '01000000001', '2026-01-15', '5000', '500', 'يعمل وردية مسائية'],
    ['منى عبد الله', 'مشرفة مخزن', '01000000002', '15/01/2026', '7500.50', '0', ''],
  ].map((row) => row.join(',')).join('\n')
  return `${head}\n${examples}\n`
}
