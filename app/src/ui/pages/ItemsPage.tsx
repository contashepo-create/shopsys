/**
 * شاشة الأصناف — نجمة المرحلة 1
 * نظام الخصائص المرنة حيّاً: القسم يورّث خصائصه للصنف، وكل صنف يستطيع التجاوز
 * (جبنة بصلاحية وغسالة بسيريال في نفس القاعدة — وثيقة التصميم، القرار 5)
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Barcode, FolderPlus, Package } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { validateItem, nextSku, draftFromCategory, type ItemDraft, type Item } from '../../core/items.ts'
import { FEATURE_LABELS, type ItemFeature } from '../../core/activities.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const ALL_FEATURES: ItemFeature[] = ['expiry_batches', 'serial_warranty', 'variants', 'weight_scale', 'multi_unit', 'price_lists']

export function ItemsPage() {
  const { items, categories, addItem, updateItem, removeItem, addCategory, updateCategory } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<number | 0>(0)
  const [modal, setModal] = useState<'closed' | 'item' | 'category'>('closed')
  const [editing, setEditing] = useState<Item | null>(null)
  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  // نموذج القسم
  const [catName, setCatName] = useState('')
  const [catFeatures, setCatFeatures] = useState<ItemFeature[]>([])
  const [editingCatId, setEditingCatId] = useState<number | null>(null)

  const filtered = useMemo(
    () =>
      items.filter((it) => {
        if (catFilter && it.categoryId !== catFilter) return false
        const q = query.trim()
        if (!q) return true
        return it.nameAr.includes(q) || it.sku.includes(q) || it.barcodes.some((b) => b.includes(q))
      }),
    [items, query, catFilter],
  )

  const openNewItem = () => {
    const cat = categories.find((c) => c.id === (catFilter || categories[0]?.id))
    setDraft(draftFromCategory(cat, nextSku(items)))
    setEditing(null)
    setErrors([])
    setModal('item')
  }

  const openEditItem = (it: Item) => {
    const { id: _id, ...rest } = it
    setDraft({ ...rest })
    setEditing(it)
    setErrors([])
    setModal('item')
  }

  const saveItem = () => {
    if (!draft) return
    const errs = validateItem(draft, items, editing?.id)
    const blocking = errs.filter((e) => !e.startsWith('تنبيه'))
    setErrors(errs)
    if (blocking.length) return
    if (editing) {
      updateItem(editing.id, draft)
      toast.show(`تم تعديل «${draft.nameAr}»`)
    } else {
      addItem(draft)
      toast.show(`تم إضافة «${draft.nameAr}»`)
    }
    setModal('closed')
  }

  const saveCategory = () => {
    if (!catName.trim()) return
    if (editingCatId) {
      updateCategory(editingCatId, { nameAr: catName.trim(), features: catFeatures })
      toast.show('تم تعديل القسم')
    } else {
      addCategory(catName.trim(), catFeatures)
      toast.show(`تم إنشاء قسم «${catName.trim()}» — أصنافه سترث خصائصه تلقائياً`)
    }
    setModal('closed')
  }

  const featureBadges = (it: Item) => {
    const badges: { icon: string; label: string; cls: string }[] = []
    if (it.trackExpiry) badges.push({ icon: '📅', label: 'صلاحية', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' })
    if (it.trackSerial) badges.push({ icon: '🔢', label: 'سيريال', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' })
    if (it.soldByWeight) badges.push({ icon: '⚖️', label: 'وزن', cls: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' })
    if (it.variantColors.length || it.variantSizes.length) badges.push({ icon: '🎨', label: 'متغيرات', cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' })
    if (it.extraUnits.length) badges.push({ icon: '📦', label: `${it.extraUnits.length + 1} وحدات`, cls: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400' })
    return badges
  }

  return (
    <div className="space-y-4">
      {/* شريط الأدوات */}
      <div className="anim-up flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الكود أو الباركود…"
            className={`${inputCls} pr-10`}
          />
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(Number(e.target.value))} className={`${inputCls} w-44`}>
          <option value={0}>كل الأقسام</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.nameAr}</option>
          ))}
        </select>
        <Btn variant="soft" onClick={() => { setCatName(''); setCatFeatures([]); setEditingCatId(null); setModal('category') }}>
          <span className="flex items-center gap-1.5"><FolderPlus size={15} /> قسم جديد</span>
        </Btn>
        <Btn onClick={openNewItem}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> صنف جديد</span>
        </Btn>
      </div>

      {/* الأقسام كبطاقات صغيرة */}
      {categories.length > 0 && (
        <div className="anim-up flex flex-wrap gap-2" style={{ animationDelay: '60ms' }}>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => { setCatName(c.nameAr); setCatFeatures(c.features); setEditingCatId(c.id); setModal('category') }}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 text-xs hover:border-brand-400 hover:scale-105 transition-all duration-200"
              title="اضغط لتعديل خصائص القسم"
            >
              <span className="font-bold text-slate-700 dark:text-slate-200">{c.nameAr}</span>
              <span className="text-slate-400">{items.filter((i) => i.categoryId === c.id).length}</span>
              <span className="flex gap-0.5">
                {c.features.slice(0, 4).map((f) => (
                  <span key={f} className="text-[10px]">{FEATURE_LABELS[f].icon}</span>
                ))}
              </span>
              <Pencil size={11} className="opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          ))}
        </div>
      )}

      {/* الجدول */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState
            icon="📦"
            title={items.length ? 'لا نتائج للبحث' : 'لا أصناف بعد'}
            sub={items.length ? 'جرّب كلمة أخرى' : 'ابدأ بإضافة أول صنف — سيرث خصائص قسمه تلقائياً'}
          />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '100ms' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الصنف</th>
                <th className="px-4 py-3 font-bold">القسم</th>
                <th className="px-4 py-3 font-bold">الخصائص</th>
                <th className="px-4 py-3 font-bold">التكلفة</th>
                <th className="px-4 py-3 font-bold">البيع</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => (
                <tr
                  key={it.id}
                  style={{ animationDelay: `${i * 30}ms` }}
                  className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-brand-500/[0.03] dark:hover:bg-brand-500/[0.06] transition-colors duration-150"
                >
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{it.nameAr}</div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>{it.sku}</span>
                      {it.barcodes.length > 0 && (
                        <span className="flex items-center gap-1"><Barcode size={11} />{it.barcodes[0]}{it.barcodes.length > 1 && ` +${it.barcodes.length - 1}`}</span>
                      )}
                      <span className="text-slate-300 dark:text-slate-600">· {it.baseUnit}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[13px]">
                    {categories.find((c) => c.id === it.categoryId)?.nameAr ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {featureBadges(it).map((b, j) => (
                        <span key={j} className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${b.cls}`}>
                          {b.icon} {b.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[13px]">{formatMinor(it.costMinor, cur, false)}</td>
                  <td className="px-4 py-3 font-black text-emerald-600 dark:text-emerald-400">{formatMinor(it.priceMinor, cur, false)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEditItem(it)} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110">
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => { removeItem(it.id); toast.show(`تم حذف «${it.nameAr}»`) }}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* مودال الصنف */}
      <Modal open={modal === 'item'} onClose={() => setModal('closed')} title={editing ? `تعديل: ${editing.nameAr}` : 'صنف جديد'} wide>
        {draft && (
          <ItemForm
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            currencySymbol={cur.symbol}
            decimals={cur.decimals}
            onSave={saveItem}
            onCancel={() => setModal('closed')}
          />
        )}
      </Modal>

      {/* مودال القسم */}
      <Modal open={modal === 'category'} onClose={() => setModal('closed')} title={editingCatId ? 'تعديل قسم' : 'قسم جديد'}>
        <div className="space-y-4">
          <Field label="اسم القسم">
            <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="مثال: ألبان وأجبان" className={inputCls} />
          </Field>
          <Field label="خصائص القسم — تورَّث تلقائياً لكل أصنافه الجديدة" hint="وكل صنف يستطيع تجاوزها لاحقاً (القرار 5)">
            <div className="grid grid-cols-2 gap-2">
              {ALL_FEATURES.map((f) => {
                const on = catFeatures.includes(f)
                return (
                  <label
                    key={f}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
                      on ? 'border-brand-500/40 bg-brand-500/8' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setCatFeatures((prev) => (on ? prev.filter((x) => x !== f) : [...prev, f]))}
                      className="w-4 h-4 rounded accent-brand-600"
                    />
                    <span className="text-lg">{FEATURE_LABELS[f].icon}</span>
                    <div>
                      <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{FEATURE_LABELS[f].nameAr}</div>
                      <div className="text-[10px] text-slate-400">{FEATURE_LABELS[f].desc}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="ghost" onClick={() => setModal('closed')}>إلغاء</Btn>
            <Btn onClick={saveCategory} disabled={!catName.trim()}>حفظ القسم</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ─────────────── نموذج الصنف ─────────────── */
function ItemForm({
  draft, setDraft, errors, currencySymbol, decimals, onSave, onCancel,
}: {
  draft: ItemDraft
  setDraft: (d: ItemDraft) => void
  errors: string[]
  currencySymbol: string
  decimals: number
  onSave: () => void
  onCancel: () => void
}) {
  const { categories } = useDataStore()
  const [barcodeInput, setBarcodeInput] = useState('')
  const [colorInput, setColorInput] = useState('')
  const [sizeInput, setSizeInput] = useState('')
  const p = (patch: Partial<ItemDraft>) => setDraft({ ...draft, ...patch })

  const moneyInput = (valueMinor: number, onChange: (m: number) => void) => (
    <div className="relative">
      <input
        type="number"
        step={decimals ? `0.${'0'.repeat(decimals - 1)}1` : '1'}
        min={0}
        defaultValue={valueMinor ? valueMinor / 10 ** decimals : ''}
        onChange={(e) => {
          try { onChange(toMinor(e.target.value || '0', decimals)) } catch { /* تجاهل مدخل غير صالح */ }
        }}
        className={`${inputCls} pl-12`}
        placeholder="0"
      />
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">{currencySymbol}</span>
    </div>
  )

  return (
    <div className="space-y-5">
      {errors.length > 0 && (
        <div className="anim-pop space-y-1">
          {errors.map((e, i) => (
            <div key={i} className={`text-[12px] px-3 py-2 rounded-xl font-bold ${e.startsWith('تنبيه') ? 'bg-amber-500/10 text-amber-600' : 'bg-rose-500/10 text-rose-600'}`}>
              {e}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="اسم الصنف *">
          <input value={draft.nameAr} onChange={(e) => p({ nameAr: e.target.value })} placeholder="مثال: جبنة رومي قديمة" className={inputCls} autoFocus />
        </Field>
        <Field label="القسم">
          <select
            value={draft.categoryId}
            onChange={(e) => {
              const cat = categories.find((c) => c.id === Number(e.target.value))
              // تبديل القسم يعيد وراثة خصائصه (مع إبقاء ما أدخله المستخدم من بيانات)
              const f = new Set(cat?.features ?? [])
              p({
                categoryId: Number(e.target.value),
                trackExpiry: f.has('expiry_batches'),
                trackSerial: f.has('serial_warranty'),
                soldByWeight: f.has('weight_scale'),
              })
            }}
            className={inputCls}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.nameAr}</option>
            ))}
          </select>
        </Field>
        <Field label="الكود (SKU)">
          <input value={draft.sku} onChange={(e) => p({ sku: e.target.value })} className={inputCls} />
        </Field>
        <Field label="الوحدة الأساسية *">
          <input value={draft.baseUnit} onChange={(e) => p({ baseUnit: e.target.value })} placeholder="قطعة / كجم / علبة" className={inputCls} />
        </Field>
        <Field label="سعر التكلفة">{moneyInput(draft.costMinor, (m) => p({ costMinor: m }))}</Field>
        <Field label="سعر البيع">{moneyInput(draft.priceMinor, (m) => p({ priceMinor: m }))}</Field>
      </div>

      {/* الباركودات */}
      <Field label="الباركودات — يدعم أكثر من باركود للصنف الواحد">
        <div className="flex gap-2">
          <input
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && barcodeInput.trim()) {
                e.preventDefault()
                p({ barcodes: [...draft.barcodes, barcodeInput.trim()] })
                setBarcodeInput('')
              }
            }}
            placeholder="امسح أو اكتب ثم Enter"
            className={inputCls}
          />
        </div>
        {draft.barcodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {draft.barcodes.map((b, i) => (
              <span key={i} className="anim-pop flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                <Barcode size={11} /> {b}
                <button onClick={() => p({ barcodes: draft.barcodes.filter((_, j) => j !== i) })} className="text-rose-400 hover:text-rose-600 font-bold">×</button>
              </span>
            ))}
          </div>
        )}
      </Field>

      {/* خصائص الصنف — التجاوز الفردي */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
        <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-1.5">
          <Package size={14} /> خصائص هذا الصنف <span className="font-normal text-slate-400">(موروثة من القسم — عدّلها بحرية)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ['trackExpiry', '📅 تتبع الصلاحية والدفعات', draft.trackExpiry],
            ['trackSerial', '🔢 تتبع السيريال والضمان', draft.trackSerial],
            ['soldByWeight', '⚖️ يُباع بالوزن', draft.soldByWeight],
          ] as const).map(([key, label, on]) => (
            <button
              key={key}
              onClick={() => p({ [key]: !on } as Partial<ItemDraft>)}
              className={`px-3.5 py-2 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 hover:scale-105 ${
                on
                  ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400'
              }`}
            >
              {label} {on ? '✓' : ''}
            </button>
          ))}
        </div>

        {/* المتغيرات */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="🎨 ألوان (اكتب ثم Enter)">
            <input
              value={colorInput}
              onChange={(e) => setColorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && colorInput.trim()) {
                  e.preventDefault()
                  p({ variantColors: [...draft.variantColors, colorInput.trim()] })
                  setColorInput('')
                }
              }}
              placeholder="أسود، أحمر…"
              className={inputCls}
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {draft.variantColors.map((c, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-bold">
                  {c} <button onClick={() => p({ variantColors: draft.variantColors.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
          </Field>
          <Field label="📏 مقاسات (اكتب ثم Enter)">
            <input
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && sizeInput.trim()) {
                  e.preventDefault()
                  p({ variantSizes: [...draft.variantSizes, sizeInput.trim()] })
                  setSizeInput('')
                }
              }}
              placeholder="S، M، L، 42…"
              className={inputCls}
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {draft.variantSizes.map((s, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 font-bold">
                  {s} <button onClick={() => p({ variantSizes: draft.variantSizes.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
          </Field>
        </div>

        {/* الوحدات الإضافية */}
        <div className="mt-3">
          <UnitEditor draft={draft} p={p} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Btn variant="ghost" onClick={onCancel}>إلغاء</Btn>
        <Btn onClick={onSave}>💾 حفظ الصنف</Btn>
      </div>
    </div>
  )
}

function UnitEditor({ draft, p }: { draft: ItemDraft; p: (x: Partial<ItemDraft>) => void }) {
  const [name, setName] = useState('')
  const [factor, setFactor] = useState('')
  return (
    <Field label={`📦 وحدات إضافية (الأساسية: ${draft.baseUnit || '—'})`} hint="مثال: كرتونة = 12 قطعة">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="كرتونة" className={`${inputCls} flex-1`} />
        <input value={factor} onChange={(e) => setFactor(e.target.value)} type="number" min={2} placeholder="= كم؟" className={`${inputCls} w-24`} />
        <Btn
          variant="soft"
          onClick={() => {
            const f = Number(factor)
            if (name.trim() && f > 1) {
              p({ extraUnits: [...draft.extraUnits, { nameAr: name.trim(), factor: f }] })
              setName('')
              setFactor('')
            }
          }}
        >
          +
        </Btn>
      </div>
      {draft.extraUnits.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {draft.extraUnits.map((u, i) => (
            <span key={i} className="anim-pop text-[11px] px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold">
              {u.nameAr} = {u.factor} {draft.baseUnit}
              <button onClick={() => p({ extraUnits: draft.extraUnits.filter((_, j) => j !== i) })} className="mr-1 text-rose-400">×</button>
            </span>
          ))}
        </div>
      )}
    </Field>
  )
}
