export type NasqValue = string | number | boolean | null
export interface NasqColumn { key: string; labelAr: string; formula?: string }
export interface NasqSheet { nameAr: string; columns: NasqColumn[]; rows: Record<string, NasqValue>[] }
const SAFE = /^[\d\s+\-*/().]+$/
export function evaluateNasqFormula(formula: string, row: Record<string, NasqValue>): number {
  const expression = formula.replace(/\[([\w.]+)]/g, (_, key: string) => String(Number(row[key] ?? 0)))
  if (!SAFE.test(expression)) throw new Error('معادلة نَسَق تحتوي تعبيراً غير مسموح')
  const value = Function(`"use strict"; return (${expression})`)() as unknown
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('نتيجة معادلة نَسَق غير صالحة')
  return value
}
export function materializeNasqSheet(sheet: NasqSheet): NasqSheet {
  const rows = sheet.rows.map(source => { const row={...source}; for(const column of sheet.columns) if(column.formula) row[column.key]=evaluateNasqFormula(column.formula,row); return row })
  return { ...sheet, rows }
}
export function summarizeNasq(sheet: NasqSheet, key: string) { const values=materializeNasqSheet(sheet).rows.map(r=>Number(r[key]??0)); return { count:values.length,sum:values.reduce((a,v)=>a+v,0),average:values.length?values.reduce((a,v)=>a+v,0)/values.length:0,min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0 } }
export function exportNasqCsv(sheet: NasqSheet): string { const ready=materializeNasqSheet(sheet); const esc=(v:NasqValue)=>`"${String(v??'').replace(/"/g,'""')}"`; return [ready.columns.map(c=>esc(c.labelAr)).join(','),...ready.rows.map(r=>ready.columns.map(c=>esc(r[c.key])).join(','))].join('\n') }
