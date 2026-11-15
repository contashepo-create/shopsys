import type { BoqItem, Project } from '../../core/contracting.ts'
import { quantityExtractBasis, type QuantityHistoryExtract } from '../../core/projectExtractQuantity.ts'
import { quantityDraftPreview, quantityInputs, type QuantityDraft, type QuantityEntryMode } from './extractQuantityDraft.ts'

/** واجهة مشتركة لكل محررات المستخلص؛ الوحدات المختلفة لا تجمع معاً. */
export function ExtractQuantityEditor({ project, items, history, values, setValues, mode, setMode, acceptEstimatedPrior, setAcceptEstimatedPrior, fmt, currency }: {
  project: Project | null
  items: readonly BoqItem[]
  history: readonly QuantityHistoryExtract[]
  values: QuantityDraft
  setValues: (values: QuantityDraft) => void
  mode: QuantityEntryMode
  setMode: (mode: QuantityEntryMode) => void
  acceptEstimatedPrior: boolean
  setAcceptEstimatedPrior: (value: boolean) => void
  fmt: (minor: number) => string
  currency: string
}) {
  const preview = quantityDraftPreview(items, history, values, mode, acceptEstimatedPrior)
  const hasEstimated = items.some(item => { try { return quantityExtractBasis(item, history).estimated } catch { return false } })
  const switchMode = (next: QuantityEntryMode) => {
    if (next === mode) return
    try {
      const inputs = quantityInputs(items, history, values, mode)
      const converted: QuantityDraft = {}
      for (const input of inputs) {
        const item = items.find(row => row.id === input.boqItemId)!
        const prev = quantityExtractBasis(item, history).previousQty
        const nextValue = next === 'cumulative' ? input.cumulativeQty : (Math.round(input.cumulativeQty * 1000) - Math.round(prev * 1000)) / 1000
        if (nextValue < 0) throw new Error('')
        converted[item.id] = String(nextValue)
      }
      setValues(converted); setMode(next)
    } catch { /* اترك النمط والقيم كما هي حتى يصحح المستخدم المدخل غير الصالح */ }
  }
  return <div className="space-y-2" data-extract-quantity-editor>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <b>طريقة الإدخال:</b>
      <button type="button" aria-pressed={mode === 'cumulative'} onClick={() => switchMode('cumulative')} className="rounded border px-2 py-1">الكمية التراكمية</button>
      <button type="button" aria-pressed={mode === 'current'} onClick={() => switchMode('current')} className="rounded border px-2 py-1">كمية هذا المستخلص</button>
      <span className="text-slate-500">حتى ثلاث خانات عشرية؛ القيم السابقة المسجلة نسباً تقديرية.</span>
    </div>
    {hasEstimated && <label className="block rounded bg-amber-500/10 p-2 text-xs text-amber-800"><input type="checkbox" checked={acceptEstimatedPrior} onChange={event => setAcceptEstimatedPrior(event.target.checked)} /> راجعت الكميات السابقة التقديرية المستنتجة من النسب وأوافق على استخدامها كأساس لهذا الحصر.</label>}
    <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
      <table className="w-full text-xs" data-extract-qty-table><thead className="bg-slate-100 dark:bg-slate-800"><tr>{['البند / الوحدة', 'كمية العقد', 'السابق', mode === 'current' ? 'كمية هذا المستخلص' : 'الإجمالي المنفذ', 'الإجمالي المنفذ', 'هذا المستخلص', 'المتبقي', 'النسبة', 'القيمة'].map((label, index) => <th key={index} className="p-2 text-right">{label}</th>)}</tr></thead><tbody>
        {items.map(item => {
          let basis: ReturnType<typeof quantityExtractBasis> | undefined, error = ''
          try { basis = quantityExtractBasis(item, history) } catch (e) { error = (e as Error).message }
          const input = preview.inputs.find(row => row.boqItemId === item.id)
          const result = preview.computed.find(row => row.boqItemId === item.id)
          const cumulative = input?.cumulativeQty ?? basis?.previousQty
          const current = cumulative != null && basis ? (Math.round(cumulative * 1000) - Math.round(basis.previousQty * 1000)) / 1000 : undefined
          const remaining = cumulative != null ? (Math.round(item.qty * 1000) - Math.round(cumulative * 1000)) / 1000 : undefined
          const section = project?.boqSections?.find(row => row.id === item.sectionId)?.nameAr
          return <tr key={item.id} className="border-t" data-extract-qty-row={item.id}>
            <td className="p-2 font-bold">{section ? `${section} — ` : ''}{item.code} — {item.descriptionAr} ({item.unit}){error && <span className="block text-rose-600">{error}</span>}</td>
            <td className="p-2">{item.qty}</td><td className="p-2">{basis ? `${basis.estimated ? '≈ ' : ''}${basis.previousQty}` : '—'}</td>
            <td className="p-2"><input aria-label={`كمية البند ${item.code}`} inputMode="decimal" dir="ltr" value={values[item.id] ?? ''} onChange={event => setValues({ ...values, [item.id]: event.target.value })} className="w-24 rounded border bg-transparent p-1 text-center" /></td>
            <td className="p-2">{cumulative ?? '—'}</td><td className="p-2">{current ?? '—'}</td><td className="p-2">{remaining ?? '—'}</td><td className="p-2">{cumulative != null ? `${Number((cumulative / item.qty * 100).toFixed(4))}٪` : '—'}</td><td className="p-2">{result ? `${fmt(result.lineValueMinor)} ${currency}` : '—'}</td>
          </tr>
        })}
      </tbody></table>
    </div>
    {preview.error && <p className="text-xs font-bold text-rose-600" role="alert">{preview.error}</p>}
    <div className="text-xs font-bold">قيمة الأعمال الحالية: {fmt(preview.grossMinor)} {currency}</div>
  </div>
}
