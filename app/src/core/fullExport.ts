/**
 * التصدير الشامل للبيانات (طلب المالك v1.0.6) — «هل يمكن تصدير جميع بيانات
 * التطبيق بالكامل كنسخة إكسل وCSV؟»
 * ─────────────────────────────────────────────────────────────────────
 * ورقة لكل جدول تشغيلي (أصناف/فواتير/قيود/أطراف/خزائن/رواتب/…) تُبنى من
 * المتجر الحي مباشرة:
 *   • Excel: ملف واحد متعدد الأوراق بصيغة SpreadsheetML 2003 — يفتحه
 *     Excel/Calc/LibreOffice بلا أي مكتبات خارجية (بديل xlsx يعمل بنص صريح).
 *   • CSV: لكل جدول ملف مستقل بترميز UTF-8 مع BOM كي تظهر العربية سليمة
 *     عند الفتح المباشر في Excel.
 * الحقول الحساسة (أرقام سرية/بصمات دخول) لا تُصدَّر أبداً — التصدير تشغيلي
 * للمحاسبة والمخزون، لا نسخة استعادة (تلك وظيفة النسخة الاحتياطية الكاملة).
 */

export interface ExportSheet {
  nameAr: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}

/* eslint-disable @typescript-eslint/no-explicit-any — استقبال لقطة المتجر كما هي */
type Snapshot = Record<string, any>

const money = (minor: number | null | undefined): number | null =>
  typeof minor === 'number' && Number.isFinite(minor) ? minor / 100 : null

const dateOnly = (iso: string | null | undefined): string => (typeof iso === 'string' ? iso.slice(0, 10) : '')

/** كل أوراق التصدير من لقطة متجر البيانات الحية. */
export function buildFullExportSheets(s: Snapshot): ExportSheet[] {
  const sheets: ExportSheet[] = []

  if (Array.isArray(s.items)) {
    sheets.push({
      nameAr: 'الأصناف',
      headers: ['المعرف', 'الاسم', 'الباركود', 'الوحدة', 'الكمية', 'سعر البيع', 'التكلفة', 'الفئة', 'المخزن الافتراضي', 'نشط'],
      rows: s.items.map((it: Snapshot) => [
        it.id, it.nameAr, (Array.isArray(it.barcodes) ? it.barcodes.join(' | ') : it.barcode) ?? '', it.baseUnit ?? '',
        it.stockQty ?? 0, money(it.priceMinor), money(it.costMinor), it.categoryId ?? 0, it.warehouseId ?? '', it.active === false ? 'لا' : 'نعم',
      ]),
    })
  }
  if (Array.isArray(s.customers)) {
    sheets.push({
      nameAr: 'العملاء',
      headers: ['المعرف', 'الاسم', 'الهاتف', 'العنوان', 'الرصيد الافتتاحي', 'نشط'],
      rows: s.customers.map((c: Snapshot) => [c.id, c.nameAr, c.phone ?? '', c.address ?? '', money(c.openingBalanceMinor), c.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.suppliers)) {
    sheets.push({
      nameAr: 'الموردون',
      headers: ['المعرف', 'الاسم', 'الهاتف', 'العنوان', 'الرصيد الافتتاحي', 'نشط'],
      rows: s.suppliers.map((c: Snapshot) => [c.id, c.nameAr, c.phone ?? '', c.address ?? '', money(c.openingBalanceMinor), c.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.employees)) {
    sheets.push({
      nameAr: 'الموظفون',
      headers: ['المعرف', 'الاسم', 'الوظيفة', 'الهاتف', 'نشط'],
      rows: s.employees.map((e: Snapshot) => [e.id, e.nameAr, e.jobTitle ?? e.role ?? '', e.phone ?? '', e.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.sales)) {
    sheets.push({
      nameAr: 'فواتير البيع',
      headers: ['المعرف', 'الرقم', 'التاريخ', 'العميل', 'الإجمالي', 'المدفوع', 'الآجل', 'النوع', 'الخزينة'],
      rows: s.sales.map((v: Snapshot) => {
        const total = v.totals?.totalMinor as number | undefined
        const paid = typeof v.paidMinor === 'number' ? v.paidMinor : (v.payment === 'cash' ? total : 0)
        return [v.id, v.invoiceNumber ?? '', dateOnly(v.date), v.customerName ?? (v.customerId ?? ''), money(total), money(paid), money((total ?? 0) - (paid ?? 0)), v.payment === 'cash' ? 'نقدي' : 'آجل', v.treasury ?? '']
      }),
    })
  }
  if (Array.isArray(s.purchases)) {
    sheets.push({
      nameAr: 'فواتير الشراء',
      headers: ['المعرف', 'الرقم', 'التاريخ', 'المورد', 'الإجمالي', 'المدفوع', 'الخزينة'],
      rows: s.purchases.map((v: Snapshot) => [v.id, v.invoiceNumber ?? v.reference ?? '', dateOnly(v.date), v.supplierName ?? (v.supplierId ?? ''), money(v.grandTotalMinor), money(v.paidMinor), v.treasury ?? '']),
    })
  }
  if (Array.isArray(s.journal)) {
    sheets.push({
      nameAr: 'قيود اليومية',
      headers: ['المعرف', 'التاريخ', 'البيان', 'الحساب', 'مدين', 'دائن', 'المصدر'],
      rows: s.journal.flatMap((e: Snapshot) =>
        (Array.isArray(e.lines) ? e.lines : []).map((l: Snapshot) => [
          e.id, dateOnly(e.date), e.description ?? '', l.accountCode ?? '',
          money(l.debit), money(l.credit), `${e.sourceType ?? ''}${e.sourceId != null ? ` #${e.sourceId}` : ''}`,
        ]),
      ),
    })
  }
  if (Array.isArray(s.treasuries)) {
    sheets.push({
      nameAr: 'الخزائن والبنوك',
      headers: ['الكود', 'الاسم', 'النوع', 'نشطة'],
      rows: s.treasuries.map((t: Snapshot) => [t.code, t.nameAr, t.kind ?? '', t.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.warehouses)) {
    sheets.push({
      nameAr: 'المخازن',
      headers: ['المعرف', 'الاسم', 'نشط'],
      rows: s.warehouses.map((w: Snapshot) => [w.id, w.nameAr, w.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.branches)) {
    sheets.push({
      nameAr: 'الفروع',
      headers: ['المعرف', 'الاسم', 'نشط'],
      rows: s.branches.map((b: Snapshot) => [b.id, b.nameAr, b.active === false ? 'لا' : 'نعم']),
    })
  }
  if (Array.isArray(s.payrollSlips)) {
    sheets.push({
      nameAr: 'قسائم الرواتب',
      headers: ['المعرف', 'الرقم', 'الموظف', 'الفترة', 'الإجمالي', 'الاستقطاعات', 'السلفة المستقطعة', 'الصافي', 'الحالة'],
      rows: s.payrollSlips.map((p: Snapshot) => [p.id, p.slipNumber ?? '', p.employeeName ?? '', p.period ?? dateOnly(p.date), money(p.grossMinor), money(p.deductionsMinor), money(p.advanceMinor), money(p.netMinor), p.status ?? '']),
    })
  }
  if (Array.isArray(s.employeeAdvances)) {
    sheets.push({
      nameAr: 'سلف الموظفين',
      headers: ['المعرف', 'الكود', 'الموظف', 'التاريخ', 'المبلغ', 'المسترد', 'المتبقي'],
      rows: s.employeeAdvances.map((a: Snapshot) => [a.id, a.code ?? '', a.employeeId, dateOnly(a.date), money(a.amountMinor), money(a.recoveredMinor), money((a.amountMinor ?? 0) - (a.recoveredMinor ?? 0))]),
    })
  }
  if (Array.isArray(s.staffCommissions)) {
    sheets.push({
      nameAr: 'عمولات الموظفين',
      headers: ['المعرف', 'الكود', 'الموظف', 'التاريخ', 'المبلغ', 'الحالة'],
      rows: s.staffCommissions.map((c: Snapshot) => [c.id, c.code ?? '', c.employeeId, dateOnly(c.date), money(c.amountMinor), c.status ?? '']),
    })
  }
  if (Array.isArray(s.vouchers)) {
    sheets.push({
      nameAr: 'السندات',
      headers: ['المعرف', 'الرقم', 'التاريخ', 'النوع', 'الجهة', 'المبلغ', 'الخزينة', 'البيان'],
      rows: s.vouchers.map((v: Snapshot) => [v.id, v.voucherNumber ?? v.code ?? '', dateOnly(v.date), v.kind === 'receipt' ? 'قبض' : v.kind === 'payment' ? 'صرف' : (v.kind ?? ''), v.partyName ?? '', money(v.amountMinor), v.treasury ?? '', v.description ?? v.notes ?? '']),
    })
  }
  return sheets
}

const xmlEscape = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cellValue = (v: string | number | null | undefined): string =>
  v == null ? '' : typeof v === 'number' ? String(v) : v

/** SpreadsheetML 2003 — ملف Excel واحد متعدد الأوراق، يفتح مباشرة بلا مكتبات. */
export function sheetsToExcelXml(sheets: ExportSheet[]): string {
  const sheetXml = sheets.map((sheet) => {
    const safeName = sheet.nameAr.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    const headerRow = `<Row>${sheet.headers.map((h) => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')}</Row>`
    const rows = sheet.rows
      .map((r) => `<Row>${r.map((c) => (typeof c === 'number' ? `<Cell><Data ss:Type="Number">${c}</Data></Cell>` : `<Cell><Data ss:Type="String">${xmlEscape(cellValue(c))}</Data></Cell>`)).join('')}</Row>`)
      .join('\n')
    return `<Worksheet ss:Name="${xmlEscape(safeName)}"><Table>${headerRow}\n${rows}</Table></Worksheet>`
  }).join('\n')
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E0E7FF" ss:Pattern="Solid"/></Style></Styles>
${sheetXml}
</Workbook>`
}

/** CSV بترميز UTF-8 مع BOM — تفتح العربية سليمة في Excel مباشرة. */
export function sheetToCsv(sheet: ExportSheet): string {
  const esc = (v: string | number | null | undefined) => {
    const raw = cellValue(v)
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
  }
  const lines = [sheet.headers.map(esc).join(','), ...sheet.rows.map((r) => r.map(esc).join(','))]
  return `\uFEFF${lines.join('\r\n')}`
}

/** تنزيل ملف نصي من المتصفح (نفس آلية تنزيل النسخة الاحتياطية). */
export function downloadTextFile(fileName: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

/** اسم ملف تصدير موحد: tahakom-export-اسم-المحل-2026-10-05-1030 */
export function exportFileName(shopName: string, kind: string, ext: string, nowIso: string): string {
  const safe = shopName.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || 'tahakom'
  const d = nowIso.slice(0, 16).replace('T', '-').replace(':', '')
  return `tahakom-${kind}-${safe}-${d}.${ext}`
}
