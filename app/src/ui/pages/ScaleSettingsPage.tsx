/**
 * إعدادات باركود الميزان (عالمي — طلب المالك: «لا أعلم أي ميزان سيتعامل معه العميل»):
 * ① قواعد تفكيك قابلة للتحرير بالكامل (بادئة/أطوال/وزن أو سعر/كسور/خانة تحقق)
 *   + قوالب جاهزة لأشهر صيغ الموازين عالمياً تُضاف بنقرة.
 * ② صندوق اختبار حي: الصق باركوداً من ملصق ميزانك وشاهد كيف يفككه النظام فوراً.
 * ③ قائمة PLU للأصناف الموزونة: طباعة + تصدير CSV عام لبرمجة أي ميزان،
 *   مع تحذيرات التعارض (كود مفقود/مكرر/أطول من القاعدة).
 */
import { useMemo, useState } from 'react'
import { Scale, Plus, Trash2, FlaskConical, Printer, Download, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import {
  SCALE_RULE_PRESETS, parseScaleBarcodeUniversal, parseWithRule, scalePriceToMinor,
  buildPluRows, pluCsv, matchScaleItem, type ScaleRule,
} from '../../core/barcode.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function ScaleSettingsPage() {
  const { setup, scaleRules, addScaleRule, updateScaleRule, removeScaleRule } = useAppStore()
  const { items } = useDataStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  /* ─── محرر قاعدة (جديدة أو تعديل) ─── */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Omit<ScaleRule, 'id'>>({
    nameAr: '', enabled: true, prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto',
  })
  const openNew = (preset?: (typeof SCALE_RULE_PRESETS)[number]) => {
    setEditId(null)
    setDraft(preset ? { ...preset, enabled: true } : { nameAr: '', enabled: true, prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' })
    setEditorOpen(true)
  }
  const openEdit = (r: ScaleRule) => {
    setEditId(r.id)
    setDraft({ nameAr: r.nameAr, enabled: r.enabled, prefix: r.prefix, itemCodeLen: r.itemCodeLen, valueLen: r.valueLen, valueType: r.valueType, valueDecimals: r.valueDecimals, checkDigit: r.checkDigit })
    setEditorOpen(true)
  }
  const saveRule = () => {
    try {
      if (editId == null) addScaleRule(draft)
      else updateScaleRule(editId, draft)
      setEditorOpen(false)
      toast.show('حُفظت القاعدة — الكاشير يفهمها فوراً ✅')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── صندوق الاختبار الحي ─── */
  const [testCode, setTestCode] = useState('')
  const sellable = useMemo(() => items.filter((it) => it.isActive), [items])
  const testResult = useMemo(() => {
    const q = testCode.trim()
    if (!/^\d{6,14}$/.test(q)) return null
    const hit = parseScaleBarcodeUniversal(q, scaleRules)
    if (!hit) return { ok: false as const }
    const item = matchScaleItem(hit.itemCode, sellable)
    let detail: string
    if (hit.weightKg != null) {
      detail = `وزن ${hit.weightKg} كجم`
    } else {
      const priceMinor = scalePriceToMinor(hit.priceRaw ?? 0, hit.rule.valueDecimals, cur.decimals)
      detail = `سعر إجمالي ${formatMinor(priceMinor, cur, false)} ${cur.symbol}`
    }
    return { ok: true as const, rule: hit.rule.nameAr, itemCode: hit.itemCode, detail, itemName: item?.nameAr ?? null }
  }, [testCode, scaleRules, sellable, cur])

  /* ─── قائمة PLU ─── */
  const maxCodeLen = useMemo(() => Math.max(3, ...scaleRules.filter((r) => r.enabled).map((r) => r.itemCodeLen)), [scaleRules])
  const pluRows = useMemo(() => buildPluRows(items, maxCodeLen, cur.decimals), [items, maxCodeLen, cur.decimals])
  const pluWarnings = pluRows.filter((r) => r.warning)

  const downloadCsv = () => {
    const blob = new Blob([pluCsv(pluRows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'scale-plu.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    toast.show('نُزّل ملف PLU — استورده في برنامج ميزانك (DIGI/CAS/RONGTA…) ✅')
  }

  const printPlu = () => {
    const rows = pluRows.map((r) => `<tr>
      <td style="font-family:monospace;font-weight:800">${r.plu ?? '⚠️'}</td>
      <td>${esc(r.nameAr)}</td>
      <td style="direction:ltr">${r.pricePerKg} ${esc(cur.symbol)}</td>
      <td style="color:#b91c1c;font-size:9pt">${r.warning ? esc(r.warning) : ''}</td>
    </tr>`).join('')
    printHtml(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>قائمة PLU للميزان</title><style>
      body{font-family:'Segoe UI',Tahoma,sans-serif;padding:10mm}
      h1{font-size:14pt;margin:0 0 2mm}
      p{font-size:9pt;color:#64748b;margin:0 0 5mm}
      table{width:100%;border-collapse:collapse;font-size:10pt}
      th,td{border:0.3mm solid #cbd5e1;padding:1.5mm 2.5mm;text-align:right}
      th{background:#f1f5f9;font-size:9pt}
    </style></head><body>
      <h1>⚖️ قائمة PLU — ${esc(setup.shopName || 'تَحَكَّم')}</h1>
      <p>أدخل هذه الأكواد في ذاكرة الميزان (زر PLU لكل صنف) بنفس الأرقام حرفياً — طول الكود حتى ${maxCodeLen} خانات.</p>
      <table><thead><tr><th>PLU</th><th>الصنف</th><th>سعر الكيلو</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`)
  }

  const VALUE_TYPE_LABEL: Record<string, string> = { weight: '⚖️ وزن', price: '💰 سعر' }

  return (
    <div className="space-y-4">
      <p className="anim-up text-[12px] text-slate-400 max-w-2xl leading-relaxed">
        الميزان والكاشير يتفقان على «لغة» داخل رقم الباركود: بادئة + كود صنف + وزن أو سعر.
        النظام عالمي — أضف قاعدة لكل صيغة يطبعها ميزانك (من القوالب الجاهزة أو يدوياً)، وجرب ملصقاً
        حقيقياً في صندوق الاختبار، ثم ابرمج الميزان بقائمة PLU بالأسفل.
      </p>

      {/* ─── القواعد ─── */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2">
            <Scale size={16} className="text-brand-500" /> قواعد تفكيك باركود الميزان
          </h3>
          <div className="flex items-center gap-2">
            <select
              className={`${inputCls} !w-auto !py-1.5 !text-[12px]`}
              value=""
              onChange={(e) => { const p = SCALE_RULE_PRESETS[Number(e.target.value)]; if (p) openNew(p) }}
            >
              <option value="">➕ من قالب جاهز…</option>
              {SCALE_RULE_PRESETS.map((p, i) => <option key={i} value={i}>{p.nameAr}</option>)}
            </select>
            <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 !text-[12px] !py-1.5" onClick={() => openNew()}>
              <Plus size={13} /> قاعدة يدوية
            </Btn>
          </div>
        </div>

        {scaleRules.length === 0 ? (
          <EmptyState icon="⚖️" title="لا قواعد" sub="أضف قاعدة من القوالب الجاهزة — الكاشير لن يفهم باركود الميزان بدونها" />
        ) : (
          <div className="space-y-1.5">
            {scaleRules.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${r.enabled ? 'border-brand-500/30 bg-brand-500/5' : 'border-slate-100 dark:border-slate-800 opacity-60'}`}>
                <input
                  type="checkbox" checked={r.enabled}
                  onChange={(e) => updateScaleRule(r.id, { enabled: e.target.checked })}
                  className="w-4 h-4 rounded accent-brand-600 shrink-0"
                  title={r.enabled ? 'ممكّنة — الكاشير يجربها' : 'معطلة'}
                />
                <button onClick={() => openEdit(r)} className="flex-1 text-right group">
                  <div className="text-[13px] font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand-600 transition-colors">{r.nameAr}</div>
                  <div className="text-[10.5px] text-slate-400 font-mono" dir="ltr">
                    [{r.prefix}][{'C'.repeat(r.itemCodeLen)}][{'V'.repeat(r.valueLen)}] · {VALUE_TYPE_LABEL[r.valueType]} ÷10^{r.valueDecimals} · تحقق: {r.checkDigit}
                  </div>
                </button>
                <button
                  onClick={() => { removeScaleRule(r.id); toast.show('حُذفت القاعدة') }}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10.5px] text-slate-400">💡 تُجرب القواعد بترتيبها من الأعلى — أول مطابقة تفوز. لا تفعّل قاعدتين بنفس البادئة والأطوال بنوعين مختلفين.</p>
      </div>

      {/* ─── صندوق الاختبار الحي ─── */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2">
          <FlaskConical size={16} className="text-violet-500" /> جرب باركوداً من ميزانك الآن
        </h3>
        <input
          value={testCode}
          onChange={(e) => setTestCode(e.target.value.replace(/\D/g, ''))}
          placeholder="زِن أي صنف واطبع ملصقاً ثم اكتب/امسح رقمه هنا — مثال: 2200042007509"
          dir="ltr"
          className={`${inputCls} font-mono text-center tracking-widest`}
          maxLength={14}
        />
        {testCode.trim().length >= 6 && (
          testResult?.ok ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12.5px] space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} /> فُكّك بنجاح بقاعدة «{testResult.rule}»</div>
              <div className="text-slate-600 dark:text-slate-300">كود الصنف: <b className="font-mono">{testResult.itemCode}</b> · {testResult.detail}</div>
              <div className={testResult.itemName ? 'text-slate-600 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400 font-bold'}>
                {testResult.itemName
                  ? <>الصنف المطابق: <b>{testResult.itemName}</b> — سيضاف للسلة فوراً عند المسح في الكاشير ✅</>
                  : '⚠️ لا صنف يحمل هذا الكود — أضف الكود لباركودات الصنف أو راجع قائمة PLU بالأسفل'}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[12.5px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1.5">
              <AlertTriangle size={14} /> لا قاعدة ممكّنة تطابق هذا الباركود — أضف قاعدة ببادئة «{testCode.slice(0, 2)}» من القوالب أو يدوياً
            </div>
          )
        )}
      </div>

      {/* ─── قائمة PLU ─── */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-extrabold text-slate-800 dark:text-white text-sm flex items-center gap-2">
            🥩 قائمة PLU — برمجة الميزان ({pluRows.length} صنف موزون)
          </h3>
          <div className="flex gap-2">
            <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 !text-[12px] !py-1.5" onClick={printPlu} disabled={pluRows.length === 0}>
              <Printer size={13} /> طباعة
            </Btn>
            <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700 !text-[12px] !py-1.5" onClick={downloadCsv} disabled={pluRows.length === 0}>
              <Download size={13} /> CSV للميزان
            </Btn>
          </div>
        </div>
        {pluWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[11.5px] text-amber-700 dark:text-amber-400 space-y-0.5">
            <b>⚠️ {pluWarnings.length} تعارض يجب حله قبل برمجة الميزان:</b>
            {pluWarnings.slice(0, 5).map((w, i) => <div key={i}>• {w.nameAr}: {w.warning}</div>)}
            {pluWarnings.length > 5 && <div>… و{pluWarnings.length - 5} أخرى (تظهر كاملة في الطباعة)</div>}
          </div>
        )}
        {pluRows.length === 0 ? (
          <EmptyState icon="⚖️" title="لا أصناف موزونة" sub="فعّل «يباع بالوزن» في بطاقة الصنف (جبن/لحوم/خضار…) ليظهر هنا بكود PLU" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">PLU</th>
                  <th className="px-3 py-2">الصنف</th>
                  <th className="px-3 py-2">سعر الكيلو</th>
                  <th className="px-3 py-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {pluRows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-mono font-black text-slate-800 dark:text-white" dir="ltr">{r.plu ?? '—'}</td>
                    <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                    <td className="px-3 py-2 text-slate-500" dir="ltr">{r.pricePerKg} {cur.symbol}</td>
                    <td className="px-3 py-2">
                      {r.warning
                        ? <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-bold">{r.warning}</span>
                        : <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">جاهز ✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10.5px] text-slate-400 leading-relaxed">
          📌 خطوات البرمجة لأي ميزان: ① أدخل كل صنف في ذاكرة الميزان برقم PLU أعلاه وسعر الكيلو نفسه.
          ② اضبط صيغة الباركود في الميزان على نفس القاعدة الممكّنة هنا (البادئة والأطوال).
          ③ زِن صنفاً واطبع ملصقاً وجربه في الصندوق البنفسجي أعلاه — لو فُكّك صحيحاً فالكاشير جاهز.
          لو ميزانك يطبع صيغة مختلفة أضف قاعدتها يدوياً — النظام يدعم أي ميزان في العالم بهذه الطريقة.
        </p>
      </div>

      {/* ─── محرر القاعدة ─── */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editId == null ? '⚖️ قاعدة تفكيك جديدة' : '⚖️ تعديل القاعدة'} wide>
        <div className="space-y-4">
          <Field label="اسم القاعدة *" hint="سمّها باسم ميزانك — مثال: «ميزان DIGI قسم الجبن»">
            <input value={draft.nameAr} onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="البادئة" hint="20-29 محجوزة عالمياً">
              <input value={draft.prefix} onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value.replace(/\D/g, '').slice(0, 3) }))} dir="ltr" className={`${inputCls} text-center font-mono`} />
            </Field>
            <Field label="خانات كود الصنف">
              <select value={draft.itemCodeLen} onChange={(e) => setDraft((d) => ({ ...d, itemCodeLen: Number(e.target.value) }))} className={inputCls}>
                {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="خانات القيمة">
              <select value={draft.valueLen} onChange={(e) => setDraft((d) => ({ ...d, valueLen: Number(e.target.value) }))} className={inputCls}>
                {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="عدد الكسور" hint="وزن: 3=جرامات · سعر: 2=قروش">
              <select value={draft.valueDecimals} onChange={(e) => setDraft((d) => ({ ...d, valueDecimals: Number(e.target.value) }))} className={inputCls}>
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="نوع القيمة داخل الباركود" hint="بعض الموازين تطبع الوزن وبعضها السعر الإجمالي — راجع دليل ميزانك أو جرب">
              <select value={draft.valueType} onChange={(e) => setDraft((d) => ({ ...d, valueType: e.target.value as 'weight' | 'price' }))} className={inputCls}>
                <option value="weight">⚖️ وزن (الكاشير يحسب السعر = الوزن × سعر الكيلو)</option>
                <option value="price">💰 سعر إجمالي (الكاشير يشتق الوزن = السعر ÷ سعر الكيلو)</option>
              </select>
            </Field>
            <Field label="خانة التحقق (سبيرة EAN-13)">
              <select value={draft.checkDigit} onChange={(e) => setDraft((d) => ({ ...d, checkDigit: e.target.value as 'auto' | 'require' | 'none' }))} className={inputCls}>
                <option value="auto">تلقائي — يقبلها إن وُجدت (الأنسب لمعظم الموازين)</option>
                <option value="require">إلزامية — يرفض بدونها (أقصى دقة)</option>
                <option value="none">بدون — الميزان يطبع Code128/ITF بلا سبيرة</option>
              </select>
            </Field>
          </div>
          {/* معاينة حية للصيغة */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
            <div className="text-[10.5px] text-slate-400 mb-1">شكل الباركود بهذه القاعدة</div>
            <div className="font-mono text-lg font-black tracking-wider text-slate-700 dark:text-slate-200" dir="ltr">
              <span className="text-brand-600">{draft.prefix}</span>
              <span className="text-emerald-600">{'C'.repeat(draft.itemCodeLen)}</span>
              <span className="text-violet-600">{'V'.repeat(draft.valueLen)}</span>
              {draft.checkDigit !== 'none' && <span className="text-slate-400">✓</span>}
            </div>
            <div className="text-[10px] text-slate-400 mt-1" dir="ltr">
              {(() => {
                const example = parseWithRule(
                  draft.prefix + '42'.padStart(draft.itemCodeLen, '0') + '750'.padStart(draft.valueLen, '0'),
                  { ...draft, id: 0 },
                )
                if (!example) return '—'
                return example.weightKg != null
                  ? `مثال: الصنف 42 → ${example.weightKg} kg`
                  : `مثال: الصنف 42 → سعر خام ${example.priceRaw} (÷${10 ** draft.valueDecimals})`
              })()}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditorOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveRule}>حفظ القاعدة</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
