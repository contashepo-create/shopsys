/**
 * كشف مصروفات المشروع التفصيلي (طلب المالك 2026-10-22): سطر مستقل لكل
 * **بند** في كل مستند مصروف — بتاريخه وفاتورته المرجعية ومورده وتصنيفه
 * وكميته وسعره وصافيه وضريبته وقيدِه — لا اختصاراً للفئات الرئيسية فقط،
 * حتى يجد أي مراجع كل جنيه/ريال صُرف وأين ذهب. نواة نقية: تدخلها بنود
 * projectCosts كما هي (بكل مصادرها: يدوي/شهادة باطن/يومية/شراء/صرف مواد)
 * ودوابّ أسماء، ويخرج دفتر مسطّح جاهز للعرض والطباعة والتصدير.
 */
import { COST_KIND_LABELS, type CostKind, type ProjectExpenseLineComputed } from './contracting.ts'

type Minor = number

/** الشكل البنيوي الأدنى لمستند تكلفة مشروع (ProjectCost في المستودع يحققه) */
export interface ProjectCostLike {
  id: number
  expenseNumber?: string
  invoiceRef?: string
  date: string
  kind: CostKind
  description: string
  amountMinor: Minor
  vatMinor?: number
  grossMinor?: number
  lines?: ProjectExpenseLineComputed[]
  treasury?: string | null
  custodyFileId?: number | null
  payment: 'cash' | 'credit' | 'mixed'
  paidMinor?: number
  dueMinor?: number
  supplierId?: number | null
  source?: 'manual' | 'sub_certificate' | 'daily_work' | 'purchase' | 'material_issue'
  journalEntryId: number
}

export const PROJECT_COST_SOURCE_LABELS: Record<string, string> = {
  manual: 'تسجيل يدوي',
  sub_certificate: 'شهادة مقاول باطن',
  daily_work: 'أجور يومية مسوّاة',
  purchase: 'فاتورة شراء مربوطة',
  material_issue: 'إذن صرف مواد',
}

export interface ProjectExpenseLedgerRow {
  costId: number
  /** تاريخ المستند YYYY-MM-DD */
  date: string
  /** رقم مستند المصروف PEX-0001 */
  expenseNumber: string
  /** رقم فاتورة المورد/المرجع الخارجي المسجل منه المصروف */
  invoiceRef: string
  supplierName: string
  /** مصدر البند (يدوي/شهادة باطن/…) */
  sourceLabel: string
  /** بيان المستند العام (ملاحظاته) */
  docDescription: string
  /** بيان بند الفاتورة نفسه */
  lineDescription: string
  /** التصنيف الحر كما سُجّل (لقطة)، أو اسم الفئة للبنود القديمة */
  categoryName: string
  /** فئة التكلفة المحاسبية (الحوض) */
  kindName: string
  boqLabel: string
  qty: number
  unitPriceMinor: Minor
  netMinor: Minor
  vatMinor: Minor
  grossMinor: Minor
  taxLabel: string
  /** مدفوع/آجل على مستوى المستند كله (يُعاد في سطور بنوده) */
  docPaidMinor: Minor
  docDueMinor: Minor
  paymentSourceLabel: string
  journalEntryNumber: number
}

export interface ProjectExpenseLedger {
  rows: ProjectExpenseLedgerRow[]
  totals: { netMinor: Minor; vatMinor: Minor; grossMinor: Minor; paidMinor: Minor; dueMinor: Minor; docsCount: number; linesCount: number }
}

export interface ProjectExpenseLedgerLookups {
  supplierName: (id: number | null | undefined) => string
  treasuryName: (code: string | null | undefined) => string
  custodyLabel: (fileId: number | null | undefined) => string
  boqLabel: (id: number | null | undefined) => string
  journalEntryNumber: (entryId: number) => number
}

function taxLabelOf(line: ProjectExpenseLineComputed): string {
  if (line.taxMode === 'inclusive') return `شاملة الضريبة (${line.vatPercent}٪)`
  if (line.taxMode === 'exclusive') return `+ضريبة ${line.vatPercent}٪`
  return 'بدون ضريبة'
}

export function buildProjectExpenseLedger(
  costs: readonly ProjectCostLike[],
  lookups: ProjectExpenseLedgerLookups,
): ProjectExpenseLedger {
  const sorted = [...costs].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  const rows: ProjectExpenseLedgerRow[] = []
  const totals = { netMinor: 0, vatMinor: 0, grossMinor: 0, paidMinor: 0, dueMinor: 0, docsCount: 0, linesCount: 0 }

  for (const cost of sorted) {
    const gross = cost.grossMinor ?? cost.amountMinor + (cost.vatMinor ?? 0)
    const paid = cost.paidMinor ?? (cost.payment === 'cash' ? gross : 0)
    const due = cost.dueMinor ?? Math.max(0, gross - paid)
    totals.docsCount += 1
    totals.netMinor += cost.amountMinor
    totals.vatMinor += cost.vatMinor ?? 0
    totals.grossMinor += gross
    totals.paidMinor += paid
    totals.dueMinor += due

    const paymentSourceLabel = cost.custodyFileId != null
      ? lookups.custodyLabel(cost.custodyFileId)
      : cost.treasury
        ? lookups.treasuryName(cost.treasury)
        : paid > 0 ? 'مصدر نقدي' : 'آجل بالكامل'
    const base = {
      costId: cost.id,
      date: cost.date.slice(0, 10),
      expenseNumber: cost.expenseNumber ?? `PEX-${String(cost.id).padStart(4, '0')}`,
      invoiceRef: cost.invoiceRef ?? '',
      supplierName: lookups.supplierName(cost.supplierId),
      sourceLabel: PROJECT_COST_SOURCE_LABELS[cost.source ?? 'manual'] ?? 'تسجيل يدوي',
      docDescription: cost.description,
      docPaidMinor: paid,
      docDueMinor: due,
      paymentSourceLabel,
      journalEntryNumber: lookups.journalEntryNumber(cost.journalEntryId),
    }

    if (cost.lines && cost.lines.length > 0) {
      for (const line of cost.lines) {
        totals.linesCount += 1
        rows.push({
          ...base,
          lineDescription: line.description,
          categoryName: line.categoryNameAr ?? COST_KIND_LABELS[line.kind].nameAr,
          kindName: COST_KIND_LABELS[line.kind].nameAr,
          boqLabel: lookups.boqLabel(line.boqItemId),
          qty: line.qty,
          unitPriceMinor: line.unitPriceMinor,
          netMinor: line.netMinor,
          vatMinor: line.vatMinor,
          grossMinor: line.grossMinor,
          taxLabel: taxLabelOf(line),
        })
      }
    } else {
      totals.linesCount += 1
      rows.push({
        ...base,
        lineDescription: cost.description,
        categoryName: COST_KIND_LABELS[cost.kind].nameAr,
        kindName: COST_KIND_LABELS[cost.kind].nameAr,
        boqLabel: '',
        qty: 1,
        unitPriceMinor: cost.amountMinor,
        netMinor: cost.amountMinor,
        vatMinor: cost.vatMinor ?? 0,
        grossMinor: gross,
        taxLabel: (cost.vatMinor ?? 0) > 0 ? 'ضريبة مدخلات' : 'بدون ضريبة',
      })
    }
  }
  return { rows, totals }
}

/** أعمدة التصدير الموحدة (طباعة/Excel/CSV) — مصدر واحد فلا تختلف الصيغ */
export const PROJECT_EXPENSE_LEDGER_HEADERS = [
  'التاريخ', 'مستند المصروف', 'فاتورة/مرجع المورد', 'المورد/الجهة', 'المصدر',
  'بيان البند', 'التصنيف', 'فئة التكلفة', 'بند BOQ', 'الكمية', 'السعر',
  'الصافي (5110)', 'الضريبة (2102)', 'الإجمالي', 'حالة الضريبة',
  'مدفوع المستند', 'آجل المستند', 'مصدر السداد', 'رقم القيد', 'ملاحظات المستند',
] as const

/** صف تصدير: مبالغ بوحدة العملة الكبرى كأرقام (decimals خانات) ليجمعها Excel.
 * مبالغ المدفوع/الآجل على مستوى المستند، لذا تُصدّر مرة واحدة فقط لكل مستند. */
export function projectExpenseLedgerExportRow(row: ProjectExpenseLedgerRow, decimals: number, includeDocumentTotals = true): (string | number)[] {
  const money = (m: number) => Math.round((m / 10 ** decimals) * 10 ** decimals) / 10 ** decimals
  return [
    row.date, row.expenseNumber, row.invoiceRef, row.supplierName, row.sourceLabel,
    row.lineDescription, row.categoryName, row.kindName, row.boqLabel, row.qty, money(row.unitPriceMinor),
    money(row.netMinor), money(row.vatMinor), money(row.grossMinor), row.taxLabel,
    includeDocumentTotals ? money(row.docPaidMinor) : 0,
    includeDocumentTotals ? money(row.docDueMinor) : 0,
    row.paymentSourceLabel, row.journalEntryNumber, row.docDescription,
  ]
}

/** يصدر الإجمالي المدفوع/الآجل مرة واحدة فقط لكل مستند متعدد البنود. */
export function projectExpenseLedgerExportRows(rows: readonly ProjectExpenseLedgerRow[], decimals: number): (string | number)[][] {
  const exportedDocumentTotals = new Set<number>()
  return rows.map((row) => {
    const includeDocumentTotals = !exportedDocumentTotals.has(row.costId)
    exportedDocumentTotals.add(row.costId)
    return projectExpenseLedgerExportRow(row, decimals, includeDocumentTotals)
  })
}
