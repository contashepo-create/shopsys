import { useEffect, useMemo, useState } from 'react'
import { Calculator, Download, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { exportNasqCsv, materializeNasqSheet, summarizeNasq, type NasqColumn, type NasqValue } from '../../core/nasq.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

const STORAGE_KEY = 'shopsys-nasq-editor-v1'

type NasqRow = Record<string, NasqValue>
type SavedNasq = { columns: NasqColumn[]; rows: NasqRow[] }

function defaultColumns(): NasqColumn[] {
  return [
    { key: 'date', labelAr: 'التاريخ' },
    { key: 'account', labelAr: 'الحساب' },
    { key: 'debit', labelAr: 'مدين' },
    { key: 'credit', labelAr: 'دائن' },
    { key: 'net', labelAr: 'الصافي', formula: '[debit]-[credit]' },
  ]
}

function readSavedSheet(): SavedNasq | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedNasq
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null
    return parsed
  } catch { return null }
}

function nextKey(columns: NasqColumn[], prefix: string): string {
  let sequence = 1
  const keys = new Set(columns.map((column) => column.key))
  while (keys.has(`${prefix}${sequence}`)) sequence += 1
  return `${prefix}${sequence}`
}

function valueForInput(value: NasqValue): string {
  return value == null ? '' : String(value)
}

function parseCellValue(value: string): NasqValue {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed)
  return value
}

export function NasqPage() {
  const { journal } = useDataStore()
  const toast = useToast()
  const journalRows = useMemo<NasqRow[]>(() => journal.flatMap((entry) => entry.lines.map((line) => ({ date: entry.date, debit: line.debit, credit: line.credit, account: line.accountCode }))), [journal])
  const saved = useMemo(() => readSavedSheet(), [])
  const [columns, setColumns] = useState<NasqColumn[]>(saved?.columns?.length ? saved.columns : defaultColumns)
  const [rows, setRows] = useState<NasqRow[]>(saved?.rows ?? journalRows)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, rows })) } catch { /* التخزين المحلي اختياري */ }
  }, [columns, rows])

  const sheet = useMemo(() => materializeNasqSheet({ nameAr: 'جدول نَسَق', columns, rows }), [columns, rows])
  const summaryKey = columns.find((column) => column.key === 'net')?.key ?? columns.find((column) => column.formula)?.key ?? ''
  const summary = summarizeNasq(sheet, summaryKey)
  const numericKeys = columns.filter((column) => column.key !== 'date' && column.key !== 'account').map((column) => column.key)
  const debitKey = columns.some((column) => column.key === 'debit') ? 'debit' : numericKeys[0]
  const creditKey = columns.some((column) => column.key === 'credit') ? 'credit' : numericKeys[1] ?? numericKeys[0]
  const readyFormulas = [
    debitKey && creditKey ? { label: 'الفرق بين عمودين', formula: `[${debitKey}]-[${creditKey}]` } : null,
    debitKey ? { label: 'القيمة المطلقة', formula: `ABS([${debitKey}])` } : null,
    debitKey ? { label: 'تقريب إلى منزلتين', formula: `ROUND([${debitKey}],2)` } : null,
    debitKey ? { label: 'موجب فقط باستخدام IF', formula: `IF([${debitKey}]>0,[${debitKey}],0)` } : null,
    debitKey && creditKey ? { label: 'الأكبر بين عمودين', formula: `MAX([${debitKey}],[${creditKey}])` } : null,
  ].filter((preset): preset is { label: string; formula: string } => preset !== null)

  const updateColumn = (index: number, patch: Partial<NasqColumn>) => setColumns((current) => current.map((column, columnIndex) => columnIndex === index ? { ...column, ...patch } : column))
  const updateCell = (rowIndex: number, key: string, value: string) => setRows((current) => current.map((row, index) => index === rowIndex ? { ...row, [key]: parseCellValue(value) } : row))
  const addRawColumn = () => setColumns((current) => [...current, { key: nextKey(current, 'field'), labelAr: 'خانة جديدة' }])
  const addFormulaColumn = (formula = debitKey && creditKey ? `[${debitKey}]-[${creditKey}]` : debitKey ? `[${debitKey}]` : '0', labelAr = 'عمود محسوب') => setColumns((current) => [...current, { key: nextKey(current, 'calc'), labelAr, formula }])
  const removeColumn = (index: number) => {
    const key = columns[index]?.key
    if (!key) return
    setColumns((current) => current.filter((_, columnIndex) => columnIndex !== index))
    setRows((current) => current.map((row) => { const next = { ...row }; delete next[key]; return next }))
  }
  const addRow = () => setRows((current) => [...current, Object.fromEntries(columns.map((column) => [column.key, column.formula ? null : '']))])
  const removeRow = (rowIndex: number) => setRows((current) => current.filter((_, index) => index !== rowIndex))
  const restoreJournal = () => { setColumns(defaultColumns()); setRows(journalRows); toast.show('تمت استعادة أعمدة وبيانات اليومية') }
  const download = () => {
    const blob = new Blob(['\uFEFF' + exportNasqCsv(sheet)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'nasq.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <div className="p-4 md:p-6 space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-black flex items-center gap-2"><Calculator className="text-violet-500" />نَسَق | NASQ</h1>
        <p className="text-sm text-slate-500">محرر خانات محلي شبيه بإكسل — عدّل الخلايا، أضف أعمدة وصفوفاً، واستخدم المعادلات الجاهزة.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn variant="ghost" onClick={restoreJournal}><RotateCcw size={16} /> استعادة اليومية</Btn>
        <Btn variant="ghost" onClick={addRawColumn}><Plus size={16} /> خانة جديدة</Btn>
        <Btn variant="ghost" onClick={() => addFormulaColumn()}><Plus size={16} /> عمود محسوب</Btn>
        <Btn onClick={download}><Download size={16} /> CSV</Btn>
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[['الصفوف', summary.count], ['الأعمدة', columns.length], ['صافي الحركة', summary.sum], ['المتوسط', summary.average]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border bg-white dark:bg-card-dark p-4"><div className="text-xs text-slate-500">{label}</div><b className="text-lg">{Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}</b></div>)}
    </div>

    <section className="rounded-2xl border bg-white dark:bg-card-dark p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black">معادلات جاهزة مثل Excel:</span>
        <select className={`${inputCls} max-w-xs`} value="" onChange={(event) => { const preset = readyFormulas.find((item) => item.formula === event.target.value); if (preset) addFormulaColumn(preset.formula, preset.label) }}>
          <option value="">اختر قالباً لإضافة عمود محسوب…</option>
          {readyFormulas.map((preset) => <option key={preset.formula} value={preset.formula}>{preset.label} — {preset.formula}</option>)}
        </select>
        <span className="text-xs text-slate-500">المراجع تكتب بين أقواس مربعة: [debit] + [credit]</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1">الدوال: ABS</span>
        <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1">ROUND</span>
        <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1">MIN / MAX</span>
        <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1">SUM / AVERAGE</span>
        <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1">IF</span>
      </div>
    </section>

    <div className="overflow-auto rounded-2xl border bg-white dark:bg-card-dark">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-violet-500/10 align-top">
            <th className="p-2 w-12">#</th>
            {columns.map((column, index) => <th key={column.key} className="p-2 min-w-44 border-s border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-1">
                <input aria-label={`اسم العمود ${index + 1}`} className={`${inputCls} min-w-0 flex-1 font-bold`} value={column.labelAr} onChange={(event) => updateColumn(index, { labelAr: event.target.value })} />
                <button type="button" className="p-1 text-rose-500 hover:bg-rose-500/10 rounded" title="حذف العمود" onClick={() => removeColumn(index)}><X size={14} /></button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[10px] text-slate-400 font-mono">[{column.key}]</span>
                <input dir="ltr" aria-label={`معادلة ${column.labelAr}`} className={`${inputCls} min-w-0 flex-1 text-[11px]`} value={column.formula ?? ''} placeholder="معادلة اختيارية" onChange={(event) => updateColumn(index, { formula: event.target.value.trim() ? event.target.value : undefined })} />
              </div>
            </th>)}
            <th className="p-2 w-14">حذف</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.slice(0, 500).map((row, rowIndex) => <tr key={rowIndex} className="border-t border-slate-200 dark:border-slate-700 hover:bg-violet-500/5">
            <td className="p-2 text-center text-xs text-slate-400">{rowIndex + 1}</td>
            {columns.map((column) => {
              const isFormula = Boolean(column.formula?.trim())
              const error = typeof row[column.key] === 'string' && String(row[column.key]).startsWith('#خطأ:')
              return <td key={column.key} className={`p-1 border-s border-slate-100 dark:border-slate-800 ${error ? 'text-rose-600' : ''}`}><input dir={typeof row[column.key] === 'number' ? 'ltr' : 'rtl'} className={`${inputCls} w-full min-w-32 ${isFormula ? 'bg-violet-500/5 font-bold' : ''}`} readOnly={isFormula} value={valueForInput(row[column.key])} onChange={(event) => updateCell(rowIndex, column.key, event.target.value)} title={isFormula ? 'عمود محسوب — عدّل المعادلة من رأس العمود' : 'خانة قابلة للتحرير'} /></td>
            })}
            <td className="p-1 text-center"><button type="button" className="p-2 text-rose-500 hover:bg-rose-500/10 rounded" title="حذف الصف" onClick={() => removeRow(rowIndex)}><Trash2 size={15} /></button></td>
          </tr>)}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
        <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-dashed border-violet-400 px-3 py-2 text-sm font-bold text-violet-700 hover:bg-violet-500/10" onClick={addRow}><Plus size={15} /> إضافة صف</button>
        <span className="text-xs text-slate-500">تُحفظ تعديلات الأعمدة والخلايا محلياً على هذا الجهاز.</span>
      </div>
    </div>
    {sheet.rows.length > 500 && <p className="text-xs text-amber-600">تُعرض أول 500 صف للأداء؛ التصدير يشمل جميع الصفوف.</p>}
  </div>
}
