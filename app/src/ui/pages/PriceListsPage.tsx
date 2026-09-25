/**
 * قوائم الأسعار (جملة/نصف جملة/VIP) — سد فجوة Easy Store
 * القائمة: خصم افتراضي ٪ + أسعار خاصة لأصناف بعينها،
 * والعميل المربوط بها يُسعَّر تلقائياً في الكاشير.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Tags, Power, Trash2, Users, Table2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { resolvePrice } from '../../core/priceLists.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'

export function PriceListsPage() {
  const {
    items, customers, priceLists, priceListEntries,
    addPriceList, updatePriceList, updateItem, togglePriceList, removePriceList,
    setPriceListEntry, setCustomerPriceList,
  } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* إنشاء/تعديل قائمة */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [discount, setDiscount] = useState('')
  const saveList = () => {
    try {
      if (editingId != null) { updatePriceList(editingId, name, Number(discount) || 0); toast.show('عُدلت القائمة ✅') }
      else { addPriceList(name, Number(discount) || 0); toast.show('أُنشئت القائمة — اربط بها عملاءها وحدد أسعارها الخاصة ✅') }
      setEditorOpen(false); setName(''); setDiscount(''); setEditingId(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* جدول موحد لكل الأصناف — يعرض التجزئة وكل فئات الخصم النشطة كأعمدة */
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogEditing, setCatalogEditing] = useState(false)
  const [catalogFilter, setCatalogFilter] = useState('')
  const activePriceLists = useMemo(() => priceLists.filter((list) => list.isActive), [priceLists])
  const catalogItems = useMemo(() => {
    const q = catalogFilter.trim().toLowerCase()
    return items.filter((item) => !q || item.nameAr.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.barcodes.some((barcode) => barcode.toLowerCase().includes(q)))
  }, [items, catalogFilter])
  useEffect(() => {
    const itemId = Number(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('item') || 0)
    if (!itemId) return
    const item = items.find((row) => row.id === itemId)
    if (!item) return
    setCatalogFilter(item.sku || item.nameAr)
    setCatalogOpen(true)
  }, [items])
  const wholesaleList = priceLists.find((list) => /جمل[ةه]/.test(list.nameAr))
  const activeWholesaleList = activePriceLists.find((list) => /جمل[ةه]/.test(list.nameAr))
  const discountFor = (retailMinor: number, priceMinor: number) => retailMinor > 0 ? Math.round(((retailMinor - priceMinor) / retailMinor) * 1000) / 10 : 0
  const saveCatalogRetailPrice = (itemId: number, rawValue: string) => {
    const value = rawValue.trim()
    try {
      if (!value) throw new Error('السعر القطاعي مطلوب — لا تتركه فارغاً')
      const priceMinor = toMinor(value, cur.decimals)
      if (priceMinor < 0) throw new Error('السعر القطاعي لا يمكن أن يكون سالباً')
      updateItem(itemId, { priceMinor })
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const saveCatalogPrice = (listId: number, itemId: number, rawValue: string) => {
    const value = rawValue.trim()
    try {
      setPriceListEntry(listId, itemId, value ? toMinor(value, cur.decimals) : null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const addWholesaleList = () => {
    try {
      if (wholesaleList && !wholesaleList.isActive) {
        togglePriceList(wholesaleList.id)
        toast.show('فُعّلت فئة «جملة» لتظهر في الجدول والعملاء ✅')
      } else {
        addPriceList('جملة', 0)
        toast.show('أُضيفت فئة «جملة» — أدخل أسعارها الخاصة من جدول الأسعار ✅')
      }
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* محرر أسعار قائمة */
  const [pricingFor, setPricingFor] = useState<number | null>(null)
  const pricingList = priceLists.find((l) => l.id === pricingFor)
  const [itemFilter, setItemFilter] = useState('')

  /* ربط العملاء */
  const [linkFor, setLinkFor] = useState<number | null>(null)
  const linkList = priceLists.find((l) => l.id === linkFor)

  const countFor = (listId: number) => ({
    entries: priceListEntries.filter((e) => e.listId === listId).length,
    customers: customers.filter((c) => c.priceListId === listId).length,
  })

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><Tags className="w-6 h-6 text-emerald-500" /> قوائم الأسعار</h1>
          <p className="text-[12px] text-slate-500 mt-1">جملة ونصف جملة وVIP — العميل المربوط بقائمة يُسعَّر تلقائياً في الكاشير</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn variant="soft" onClick={() => { setCatalogFilter(''); setCatalogOpen(true) }}>
            <Table2 className="w-4 h-4" /> جدول أسعار الأصناف
          </Btn>
          <Btn onClick={() => { setEditingId(null); setName(''); setDiscount(''); setEditorOpen(true) }}><Plus className="w-4 h-4" /> فئة خصم جديدة</Btn>
        </div>
      </div>

      {priceLists.length === 0 ? (
        <EmptyState icon="🏷️" title="لا قوائم أسعار" sub="أنشئ قائمة «جملة» بخصم افتراضي، ثم اربط بها عملاء الجملة — وسيتسعرون تلقائياً" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {priceLists.map((l) => {
            const c = countFor(l.id)
            return (
              <div key={l.id} className={`rounded-2xl border p-4 space-y-2 ${l.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-dashed opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <button onClick={() => { setEditingId(l.id); setName(l.nameAr); setDiscount(String(l.defaultDiscountPercent || '')); setEditorOpen(true) }} className="font-black hover:text-emerald-600 transition-colors">{l.nameAr}</button>
                  <div className="flex gap-1">
                    <button onClick={() => togglePriceList(l.id)} title={l.isActive ? 'تعطيل' : 'تفعيل'} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all"><Power className="w-4 h-4" /></button>
                    <button onClick={() => { try { removePriceList(l.id); toast.show('حُذفت') } catch (e) { toast.show((e as Error).message, 'error') } }} title="حذف" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="text-[12px] text-slate-500">
                  {l.defaultDiscountPercent > 0 ? <>خصم افتراضي <b className="text-emerald-600">{l.defaultDiscountPercent}٪</b> على غير المُسعَّر</> : 'بلا خصم افتراضي'}
                </div>
                <div className="flex gap-2 text-[11px] font-bold">
                  <button onClick={() => { setPricingFor(l.id); setItemFilter('') }} className="flex-1 py-2 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors">
                    الأسعار الخاصة ({c.entries})
                  </button>
                  <button onClick={() => setLinkFor(l.id)} className="flex-1 py-2 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 transition-colors">
                    <Users className="w-3.5 h-3.5 inline ml-1" />العملاء ({c.customers})
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* جدول موحد: السعر القطاعي، سعر كل فئة، ونسبة الخصم الفعلية */}
      <Modal open={catalogOpen} onClose={() => { setCatalogOpen(false); setCatalogEditing(false) }} title="جدول أسعار جميع الأصناف" wide>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={catalogFilter}
              onChange={(e) => setCatalogFilter(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو الباركود…"
              className={`${inputCls} flex-1 min-w-56`}
            />
            <Btn
              variant={catalogEditing ? 'danger' : 'soft'}
              onClick={() => setCatalogEditing((value) => !value)}
            >
              {catalogEditing ? 'إنهاء التعديل' : 'بدء التعديل'}
            </Btn>
            {!activeWholesaleList && (
              <Btn variant="soft" onClick={addWholesaleList}><Plus className="w-4 h-4" /> {wholesaleList ? 'تفعيل فئة جملة' : 'إضافة فئة جملة'}</Btn>
            )}
            <Btn variant="ghost" onClick={() => { setCatalogOpen(false); setEditingId(null); setName(''); setDiscount(''); setEditorOpen(true) }}>
              <Plus className="w-4 h-4" /> فئة أخرى
            </Btn>
          </div>
          <div className="text-[11px] text-slate-500 rounded-xl bg-slate-500/5 px-3 py-2">
            السعر القطاعي هو السعر الأساسي للصنف. كل فئة خصم نشطة تظهر بعمود للسعر وعمود للخصم؛ والسعر يتغير مباشرة عند تعديل فئة الأسعار.
            {catalogEditing && <span className="block mt-1 font-bold text-amber-700 dark:text-amber-300">وضع التعديل مفتوح: اكتب السعر داخل أي خلية واضغط Enter أو اخرج من الخلية للحفظ. اتركها فارغة للعودة إلى الخصم الافتراضي.</span>}
          </div>
          {catalogItems.length === 0 ? (
            <EmptyState icon="📦" title="لا أصناف مطابقة" sub="أضف أصنافاً أو غيّر كلمة البحث" />
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-max w-full text-[11px]">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                  <tr className="text-right text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <th rowSpan={2} className="px-3 py-2.5 font-black sticky right-0 bg-slate-50 dark:bg-slate-800">الكود</th>
                    <th rowSpan={2} className="px-3 py-2.5 font-black">الصنف</th>
                    <th rowSpan={2} className="px-3 py-2.5 font-black text-amber-700">سعر التكلفة</th>
                    <th rowSpan={2} className="px-3 py-2.5 font-black text-emerald-600">السعر القطاعي</th>
                    {activePriceLists.map((list) => (
                      <th key={list.id} colSpan={2} className="px-3 py-2 font-black text-center border-r border-slate-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={() => { setCatalogOpen(false); setPricingFor(list.id); setItemFilter('') }}
                          className="hover:text-emerald-600 transition-colors"
                          title="فتح أسعار هذه الفئة"
                        >{list.nameAr}</button>
                      </th>
                    ))}
                  </tr>
                  <tr className="text-[10px] text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    {activePriceLists.flatMap((list) => [
                      <th key={`${list.id}-price`} className="px-3 py-1.5 text-center">السعر</th>,
                      <th key={`${list.id}-discount`} className="px-3 py-1.5 text-center border-r border-slate-200 dark:border-slate-700">الخصم ٪</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {catalogItems.map((item) => (
                    <tr key={item.id} className={`border-b border-slate-100 dark:border-slate-800/70 hover:bg-emerald-500/[0.04] ${!item.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 font-mono text-slate-400 sticky right-0 bg-white dark:bg-card-dark" dir="ltr">{item.sku || item.barcodes?.[0] || item.id}</td>
                      <td className="px-3 py-2 font-bold">
                        {item.nameAr}{!item.isActive && <span className="text-[9px] text-slate-400 mr-1">(غير نشط)</span>}
                      </td>
                      <td className="px-3 py-2 font-black text-amber-700 dark:text-amber-300">{fmt(item.costMinor)}</td>
                      <td className="px-3 py-2 font-black text-emerald-600">
                        {catalogEditing ? (
                          <input
                            key={`${item.id}-${item.priceMinor}`}
                            defaultValue={String(item.priceMinor / 10 ** cur.decimals)}
                            aria-label={`السعر القطاعي ${item.nameAr}`}
                            inputMode="decimal"
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
                              if (event.key === 'Escape') { event.currentTarget.value = String(item.priceMinor / 10 ** cur.decimals); event.currentTarget.blur() }
                            }}
                            onBlur={(event) => saveCatalogRetailPrice(item.id, event.currentTarget.value)}
                            className={`${inputCls} w-28 !px-2 !py-1 text-center text-[11px] font-black`}
                          />
                        ) : fmt(item.priceMinor)}
                      </td>
                      {activePriceLists.flatMap((list) => {
                        const price = resolvePrice(item.id, item.priceMinor, list.id, priceLists, priceListEntries)
                        const discountPercent = discountFor(item.priceMinor, price)
                        const entry = priceListEntries.find((candidate) => candidate.listId === list.id && candidate.itemId === item.id)
                        const hasSpecialPrice = !!entry
                        return [
                          <td key={`${list.id}-${item.id}-price`} className="px-3 py-2 text-center font-bold" title={hasSpecialPrice ? 'سعر خاص لهذا الصنف' : 'السعر محسوب من الخصم الافتراضي'}>
                            {catalogEditing ? (
                              <input
                                key={`${list.id}-${item.id}-${entry?.priceMinor ?? 'default'}`}
                                defaultValue={entry ? String(entry.priceMinor / 10 ** cur.decimals) : ''}
                                placeholder={fmt(price)}
                                aria-label={`سعر ${item.nameAr} في ${list.nameAr}`}
                                inputMode="decimal"
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
                                  if (event.key === 'Escape') { event.currentTarget.value = entry ? String(entry.priceMinor / 10 ** cur.decimals) : ''; event.currentTarget.blur() }
                                }}
                                onBlur={(event) => saveCatalogPrice(list.id, item.id, event.currentTarget.value)}
                                className={`${inputCls} w-28 !px-2 !py-1 text-center text-[11px]`}
                              />
                            ) : <>{fmt(price)}{hasSpecialPrice && <span className="text-[9px] text-sky-500 mr-1">★</span>}</>}
                          </td>,
                          <td key={`${list.id}-${item.id}-discount`} className="px-3 py-2 text-center border-r border-slate-100 dark:border-slate-800">{discountPercent > 0 ? `${discountPercent}٪` : discountPercent < 0 ? `زيادة ${Math.abs(discountPercent)}٪` : '—'}</td>,
                        ]
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!activePriceLists.length && <div className="text-center text-[11px] text-slate-400">لا توجد فئات خصم نشطة بعد. أضف «جملة» أو أي فئة أخرى لتظهر كأعمدة في الجدول.</div>}
          <div className="text-[10px] text-slate-400">★ = سعر خاص للصنف. اترك سعر الصنف فارغاً في محرر الفئة ليُحسب تلقائياً من الخصم الافتراضي.</div>
        </div>
      </Modal>

      {/* نافذة إنشاء/تعديل */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editingId != null ? 'تعديل القائمة' : 'قائمة أسعار جديدة'}>
        <div className="space-y-3">
          <Field label="اسم القائمة *"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="جملة / نصف جملة / VIP…" className={inputCls} /></Field>
          <Field label="خصم افتراضي ٪ (اختياري)" hint="يُطبق على الأصناف التي لا سعر خاصاً لها في القائمة">
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
          </Field>
          <Btn onClick={saveList} className="w-full" disabled={!name.trim()}>{editingId != null ? 'حفظ' : 'إنشاء'}</Btn>
        </div>
      </Modal>

      {/* محرر الأسعار الخاصة */}
      <Modal open={!!pricingList} onClose={() => setPricingFor(null)} title={pricingList ? `أسعار «${pricingList.nameAr}» الخاصة` : ''} wide>
        {pricingList && (
          <div className="space-y-3">
            <input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="ابحث عن صنف…" className={inputCls} />
            <div className="max-h-[26rem] overflow-y-auto space-y-1.5">
              {items.filter((it) => it.isActive && (!itemFilter || it.nameAr.includes(itemFilter) || it.sku.includes(itemFilter) || it.barcodes.some((barcode) => barcode.includes(itemFilter)))).slice(0, 60).map((it) => {
                const entry = priceListEntries.find((e) => e.listId === pricingList.id && e.itemId === it.id)
                const effective = resolvePrice(it.id, it.priceMinor, pricingList.id, priceLists, priceListEntries)
                const below = effective < it.costMinor
                return (
                  <div key={it.id} className="flex items-center gap-2 text-[12px] bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2">
                    <span className="flex-1 font-bold"><span className="ml-2 font-mono text-[10px] text-slate-400" dir="ltr">{it.sku || it.barcodes?.[0] || it.id}</span>{it.nameAr}</span>
                    <span className="text-slate-400">تجزئة {fmt(it.priceMinor)}</span>
                    <input
                      defaultValue={entry ? String(entry.priceMinor / 10 ** cur.decimals) : ''}
                      placeholder={pricingList.defaultDiscountPercent > 0 ? `آلي ${fmt(effective)}` : 'بلا سعر خاص'}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        try {
                          setPriceListEntry(pricingList.id, it.id, v ? toMinor(v, cur.decimals) : null)
                        } catch (err) { toast.show((err as Error).message, 'error') }
                      }}
                      className={`${inputCls} w-32 text-center ${below ? 'border-rose-400' : ''}`}
                    />
                    {below && <span className="text-rose-500 font-bold text-[10px]" title="السعر الفعلي أقل من التكلفة">⚠️ تحت التكلفة</span>}
                  </div>
                )
              })}
            </div>
            <div className="text-[11px] text-slate-400">اترك الخانة فارغة = يسري الخصم الافتراضي (أو سعر التجزئة). التحذير الأحمر: السعر تحت متوسط التكلفة.</div>
          </div>
        )}
      </Modal>

      {/* ربط العملاء */}
      <Modal open={!!linkList} onClose={() => setLinkFor(null)} title={linkList ? `عملاء «${linkList.nameAr}»` : ''}>
        {linkList && (
          <div className="space-y-1.5 max-h-[26rem] overflow-y-auto">
            {customers.length === 0 && <div className="text-[12px] text-slate-400 text-center py-6">لا عملاء مسجلون بعد</div>}
            {customers.map((c) => {
              const linked = c.priceListId === linkList.id
              const other = !linked && c.priceListId != null ? priceLists.find((l) => l.id === c.priceListId)?.nameAr : null
              return (
                <label key={c.id} className="flex items-center gap-2 text-[13px] bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={(e) => {
                      try {
                        setCustomerPriceList(c.id, e.target.checked ? linkList.id : null)
                        toast.show(e.target.checked ? `رُبط ${c.nameAr} — سيتسعر بقائمة ${linkList.nameAr} في الكاشير ✅` : 'أُلغي الربط')
                      } catch (err) { toast.show((err as Error).message, 'error') }
                    }}
                    className="accent-emerald-600"
                  />
                  <span className="font-bold flex-1">{c.nameAr}</span>
                  {other && <span className="text-[10px] text-slate-400">مربوط بـ{other}</span>}
                </label>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}
