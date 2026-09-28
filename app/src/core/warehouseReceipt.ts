/**
 * إذن استلام من المستودع — **كميات فقط بلا أي سعر أو قيمة**.
 *
 * طلب المالك (2026-09-28): من داخل الفاتورة يُطبع «إذن استلام مستودع» يحمل الأصناف
 * والكميات فقط، لأن أمين المخزن لا يرى الأسعار. للإذن إعداداته المستقلة (أعمدة
 * اختيارية · ترويسة الفرع · التوقيعات · الورق وعدد النسخ) وتُفتح من الفاتورة نفسها
 * ومن «الإعدادات ← إعدادات الطباعة».
 *
 * وحدة حسابية صرفة: لا DOM ولا React — تُنتج HTML نصياً ليطبعه `printHtml`.
 */

export interface WarehouseReceiptSettings {
  /** ترويسة الفرع (الاسم والعنوان) أعلى الإذن */
  showBranchHeader: boolean
  showCode: boolean
  showBarcode: boolean
  showUnit: boolean
  /** عمود موقع التخزين (ممر/رف) */
  showLocation: boolean
  /** عمود فارغ يكتب فيه أمين المخزن الكمية المستلمة فعلياً */
  showReceivedActual: boolean
  showNotesColumn: boolean
  /** سطر إجماليات الكميات وعدد البنود أسفل الجدول */
  showQtyTotals: boolean
  showUser: boolean
  showSignatures: boolean
  /** ملاحظة عامة أسفل الإذن */
  showFootNote: boolean
  /** بيانات العميل/المورد */
  showParty: boolean
  paper: 'a4' | 'a5'
  copies: 1 | 2 | 3
  sort: 'entry' | 'name' | 'qty'
  groupByWarehouse: boolean
}

export const DEFAULT_WAREHOUSE_RECEIPT: WarehouseReceiptSettings = {
  showBranchHeader: true,
  showCode: true,
  showBarcode: false,
  showUnit: true,
  showLocation: false,
  showReceivedActual: true,
  showNotesColumn: false,
  showQtyTotals: true,
  showUser: true,
  showSignatures: true,
  showFootNote: true,
  showParty: true,
  paper: 'a4',
  copies: 1,
  sort: 'entry',
  groupByWarehouse: false,
}

export const WAREHOUSE_RECEIPT_LABELS: Record<keyof Omit<WarehouseReceiptSettings, 'paper' | 'copies' | 'sort' | 'groupByWarehouse'>, string> = {
  showBranchHeader: 'ترويسة الفرع',
  showCode: 'عمود كود الصنف',
  showBarcode: 'عمود الباركود',
  showUnit: 'عمود وحدة القياس',
  showLocation: 'عمود موقع التخزين',
  showReceivedActual: 'خانة «المستلم فعلياً»',
  showNotesColumn: 'عمود الملاحظات',
  showQtyTotals: 'إجمالي الكميات وعدد البنود',
  showUser: 'اسم المستخدم المُصدِر',
  showSignatures: 'خانتا التوقيع',
  showFootNote: 'ملاحظة أسفل الإذن',
  showParty: 'بيانات العميل / المورد',
}

export interface WarehouseReceiptLine {
  nameAr: string
  qty: number
  unit?: string
  code?: string
  barcode?: string
  location?: string
  warehouseAr?: string
  note?: string
}

export interface WarehouseReceiptDoc {
  /** «إذن استلام مستودع» أو «إذن صرف مستودع» */
  title: string
  docNumber: string
  dateLabel: string
  partyLabel: string
  branchLabel: string
  companyName: string
  userLabel: string
  footNote?: string
  lines: WarehouseReceiptLine[]
  settings: WarehouseReceiptSettings
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** تنسيق الكمية: بلا كسور زائدة (3 ⇒ «3»، 2.5 ⇒ «2.5») */
export function formatQty(qty: number): string {
  const rounded = Math.round(qty * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** ترتيب سطور الإذن حسب الإعداد — وتجميعها بالمخزن عند الطلب (ثبات الترتيب مضمون) */
export function sortWarehouseReceiptLines(lines: WarehouseReceiptLine[], settings: WarehouseReceiptSettings): WarehouseReceiptLine[] {
  const indexed = lines.map((line, index) => ({ line, index }))
  indexed.sort((a, b) => {
    if (settings.groupByWarehouse) {
      const group = (a.line.warehouseAr ?? '').localeCompare(b.line.warehouseAr ?? '', 'ar')
      if (group !== 0) return group
    }
    if (settings.sort === 'name') {
      const byName = a.line.nameAr.localeCompare(b.line.nameAr, 'ar')
      if (byName !== 0) return byName
    }
    if (settings.sort === 'qty') {
      const byQty = b.line.qty - a.line.qty
      if (byQty !== 0) return byQty
    }
    return a.index - b.index
  })
  return indexed.map((row) => row.line)
}

export function warehouseReceiptTotals(lines: WarehouseReceiptLine[]): { lineCount: number; totalQty: number } {
  return {
    lineCount: lines.length,
    totalQty: Math.round(lines.reduce((sum, line) => sum + (Number.isFinite(line.qty) ? line.qty : 0), 0) * 1000) / 1000,
  }
}

/** أعمدة الإذن الفعلية بعد تطبيق الإعدادات — تُستعمل في الطباعة وفي الاختبار */
export function warehouseReceiptColumns(settings: WarehouseReceiptSettings): string[] {
  const columns = ['م']
  if (settings.showCode) columns.push('الكود')
  if (settings.showBarcode) columns.push('الباركود')
  columns.push('الصنف')
  if (settings.groupByWarehouse) columns.push('المخزن')
  if (settings.showLocation) columns.push('الموقع')
  if (settings.showUnit) columns.push('الوحدة')
  columns.push('الكمية')
  if (settings.showReceivedActual) columns.push('المستلم فعلياً')
  if (settings.showNotesColumn) columns.push('ملاحظات')
  return columns
}

/** بناء صفحة الإذن كاملة (HTML) — بلا أي سعر أو عملة مهما كانت الإعدادات */
export function buildWarehouseReceiptHtml(doc: WarehouseReceiptDoc): string {
  const settings = doc.settings
  const lines = sortWarehouseReceiptLines(doc.lines, settings)
  const columns = warehouseReceiptColumns(settings)
  const totals = warehouseReceiptTotals(lines)
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')
  const body = lines.map((line, index) => {
    const cells = [String(index + 1)]
    if (settings.showCode) cells.push(line.code ?? '—')
    if (settings.showBarcode) cells.push(line.barcode ?? '—')
    cells.push(line.nameAr)
    if (settings.groupByWarehouse) cells.push(line.warehouseAr ?? '—')
    if (settings.showLocation) cells.push(line.location ?? '—')
    if (settings.showUnit) cells.push(line.unit ?? '—')
    cells.push(formatQty(line.qty))
    if (settings.showReceivedActual) cells.push('')
    if (settings.showNotesColumn) cells.push(line.note ?? '')
    return `<tr>${cells.map((cell, cellIndex) => `<td class="${cellIndex === (settings.showCode ? 1 : 0) + (settings.showBarcode ? 1 : 0) ? 'name' : 'mid'}">${escapeHtml(cell)}</td>`).join('')}</tr>`
  }).join('')
  const totalsRow = settings.showQtyTotals
    ? `<tfoot><tr><td class="mid" colspan="${Math.max(1, columns.length - (settings.showReceivedActual ? 2 : 1) - (settings.showNotesColumn ? 1 : 0))}">إجمالي البنود: ${totals.lineCount}</td><td class="mid"><b>${formatQty(totals.totalQty)}</b></td>${settings.showReceivedActual ? '<td></td>' : ''}${settings.showNotesColumn ? '<td></td>' : ''}</tr></tfoot>`
    : ''
  const meta: string[] = [`رقم المستند: <b>${escapeHtml(doc.docNumber)}</b>`, `التاريخ: <b>${escapeHtml(doc.dateLabel)}</b>`]
  if (settings.showParty) meta.push(`الجهة: <b>${escapeHtml(doc.partyLabel)}</b>`)
  if (settings.showUser) meta.push(`المُصدِر: <b>${escapeHtml(doc.userLabel)}</b>`)
  const header = settings.showBranchHeader
    ? `<div class="wr-head"><div class="wr-co">${escapeHtml(doc.companyName)}</div><div class="wr-br">${escapeHtml(doc.branchLabel)}</div></div>`
    : ''
  const signatures = settings.showSignatures
    ? '<div class="wr-sign"><div>أمين المخزن: ....................................<br/><small>التوقيع والتاريخ</small></div><div>المستلم: ....................................<br/><small>التوقيع والتاريخ</small></div></div>'
    : ''
  const footNote = settings.showFootNote
    ? `<p class="wr-note">${escapeHtml(doc.footNote || 'هذا الإذن للتسليم والاستلام المخزني فقط ولا يحمل أي قيم مالية.')}</p>`
    : ''
  const page = (copyIndex: number) => `<section class="wr-page">
    ${header}
    <h1>${escapeHtml(doc.title)}</h1>
    <div class="wr-meta">${meta.map((item) => `<span>${item}</span>`).join('')}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="mid" colspan="${columns.length}">لا توجد بنود</td></tr>`}</tbody>${totalsRow}</table>
    ${signatures}
    ${footNote}
    <div class="wr-copy">نسخة ${copyIndex + 1} من ${settings.copies}</div>
  </section>`
  const pages = Array.from({ length: Math.min(3, Math.max(1, settings.copies)) }, (_, index) => page(index)).join('')
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} ${escapeHtml(doc.docNumber)}</title><style>
    @page { size: ${settings.paper} portrait; margin: 12mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }
    .wr-page { page-break-after: always; }
    .wr-page:last-child { page-break-after: auto; }
    .wr-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #0f172a; padding-bottom: 6px; }
    .wr-co { font-size: 16px; font-weight: 900; }
    .wr-br { font-size: 11px; color: #475569; }
    h1 { text-align: center; font-size: 15px; margin: 10px 0 4px; letter-spacing: .5px; }
    .wr-meta { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; font-size: 11px; color: #334155; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th, td { border: 1px solid #94a3b8; padding: 5px 6px; }
    th { background: #e2e8f0; text-align: center; font-weight: 800; }
    td.mid { text-align: center; }
    td.name { text-align: right; font-weight: 700; }
    tfoot td { background: #f1f5f9; font-weight: 800; text-align: center; }
    .wr-sign { display: flex; justify-content: space-between; gap: 16px; margin-top: 26px; font-size: 11px; }
    .wr-note { margin-top: 14px; font-size: 10px; color: #64748b; text-align: center; }
    .wr-copy { margin-top: 6px; font-size: 9px; color: #94a3b8; text-align: center; }
  </style></head><body>${pages}</body></html>`
}
