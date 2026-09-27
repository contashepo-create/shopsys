/** نَسَق — جدول محلي قابل للتحرير مع أعمدة محسوبة بصيغة آمنة شبيهة بإكسل. */
export type NasqValue = string | number | boolean | null
export interface NasqColumn { key: string; labelAr: string; formula?: string }
export interface NasqSheet { nameAr: string; columns: NasqColumn[]; rows: Record<string, NasqValue>[] }

const SAFE_EXPRESSION = /^[\d\s+\-*/().,<>=!&|?:A-Za-z_$[\]]+$/
const FUNCTION_NAMES = new Set(['ABS', 'ROUND', 'MIN', 'MAX', 'SUM', 'AVERAGE', 'IF'])

const functions = {
  ABS: Math.abs,
  ROUND: (value: number, digits = 0) => {
    const factor = 10 ** digits
    return Math.round(value * factor) / factor
  },
  MIN: (...values: number[]) => Math.min(...values),
  MAX: (...values: number[]) => Math.max(...values),
  SUM: (...values: number[]) => values.reduce((sum, value) => sum + value, 0),
  AVERAGE: (...values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
  IF: (condition: boolean, whenTrue: number, whenFalse: number) => condition ? whenTrue : whenFalse,
}

function numericValue(value: NasqValue): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

/** يحسب معادلة صف واحد بعد تحويل مراجع الخانات مثل [debit] إلى قيم رقمية. */
export function evaluateNasqFormula(formula: string, row: Record<string, NasqValue>): number {
  const source = formula.trim().replace(/^=/, '').trim()
  if (!source) throw new Error('اكتب معادلة أولاً')
  const references = [...source.matchAll(/\[([\w$.-]+)]/g)].map((match) => match[1])
  if (references.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) throw new Error('مرجع خانة غير موجود في معادلة نَسَق')
  const expression = source.replace(/\[([\w$.-]+)]/g, (_, key: string) => String(numericValue(row[key])))
  if (!SAFE_EXPRESSION.test(expression)) throw new Error('معادلة نَسَق تحتوي تعبيراً غير مسموح')

  const identifiers = expression.match(/[A-Za-z_$][\w$]*/g) ?? []
  for (const identifier of identifiers) {
    if (!FUNCTION_NAMES.has(identifier)) throw new Error('معادلة نَسَق تحتوي تعبيراً غير مسموح')
  }
  const compiled = expression.replace(/\b(ABS|ROUND|MIN|MAX|SUM|AVERAGE|IF)\s*\(/g, 'f.$1(')
  try {
    const value = Function('f', `"use strict"; return (${compiled})`)(functions) as unknown
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('نتيجة معادلة نَسَق غير صالحة')
    return value
  } catch (error) {
    if (error instanceof Error && error.message.includes('معادلة نَسَق')) throw error
    throw new Error('صيغة معادلة نَسَق غير صالحة')
  }
}

export function materializeNasqSheet(sheet: NasqSheet): NasqSheet {
  const rows = sheet.rows.map((source) => {
    const row = { ...source }
    for (const column of sheet.columns) {
      if (!column.formula) continue
      try { row[column.key] = evaluateNasqFormula(column.formula, row) }
      catch (error) { row[column.key] = `#خطأ: ${(error as Error).message}` }
    }
    return row
  })
  return { ...sheet, rows }
}

export function summarizeNasq(sheet: NasqSheet, key: string) {
  const values = materializeNasqSheet(sheet).rows.map((row) => Number(row[key] ?? 0)).filter(Number.isFinite)
  const sum = values.reduce((total, value) => total + value, 0)
  return { count: values.length, sum, average: values.length ? sum / values.length : 0, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 }
}

export function exportNasqCsv(sheet: NasqSheet): string {
  const ready = materializeNasqSheet(sheet)
  const esc = (value: NasqValue) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [ready.columns.map((column) => esc(column.labelAr)).join(','), ...ready.rows.map((row) => ready.columns.map((column) => esc(row[column.key])).join(','))].join('\n')
}
