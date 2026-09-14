/**
 * شاشة الأصناف — المرحلة 1 (محدَّثة بملاحظات المالك)
 * - أقسام رئيسية وفرعية (شجرة) مع وراثة الخصائص
 * - كتالوج وحدات احترافي شامل + وحدة مخصصة
 * - سعر التكلفة محسوب تلقائياً من فواتير الشراء (متوسط مرجح) — لا يُعدَّل يدوياً بعد أول حركة
 */
import { useMemo, useState } from 'react'
import { useRef } from 'react'
import { Plus, Search, Pencil, Trash2, Barcode, FolderPlus, Package, Lock, CornerDownLeft, FileDown, FileUp } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  validateItem, nextSku, draftFromCategory, categoryPath, categoryDescendants,
  type ItemDraft, type Item, type Category,
} from '../../core/items.ts'
import { FEATURE_LABELS, type ItemFeature } from '../../core/activities.ts'
import { buildItemsCsv, parseItemsCsv } from '../../core/itemsCsv.ts'
import { UNIT_GROUPS } from '../../core/units.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const ALL_FEATURES: ItemFeature[] = ['expiry_batches', 'serial_warranty', 'variants', 'weight_scale', 'multi_unit', 'price_lists']

export function ItemsPage() {
  const { items, categories, addItem, updateItem, removeItem, addCategory, updateCategory, removeCategory, purchases } = useDataStore()
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
  const [catParentId, setCatParentId] = useState<number | null>(null)
  const [editingCatId, setEditingCatId] = useState<number | null>(null)

  /** ترتيب الأقسام شجرياً للعرض بمسافة بادئة */
  const orderedCats = useMemo(() => {
    const result: { cat: Category; depth: number }[] = []
    const walk = (parentId: number | null, depth: number) => {
      for (const c of categories.filter((x) => x.parentId === parentId)) {
        result.push({ cat: c, depth })
        walk(c.id, depth + 1)
      }
    }
    walk(null, 0)
    return result
  }, [categories])

  const filtered = useMemo(() => {
    const allowedIds = catFilter ? new Set(categoryDescendants(catFilter, categories)) : null
    return items.filter((it) => {
      if (allowedIds && !allowedIds.has(it.categoryId)) return false
      const q = query.trim()
      if (!q) return true
      return it.nameAr.includes(q) || it.sku.includes(q) || it.barcodes.some((b) => b.includes(q))
    })
  }, [items, query, catFilter, categories])

  /** هل للصنف حركة شراء؟ عندها تُقفل التكلفة (تصبح محسوبة فقط) */
  const hasPurchases = (itemId: number) => purchases.some((p) => p.lines.some((l) => l.itemId === itemId))

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

  const openNewCategory = () => {
    setCatName(''); setCatFeatures([]); setCatParentId(null); setEditingCatId(null); setModal('category')
  }

  /* ─── استيراد/تصدير CSV (Excel) ─── */
  const fileRef = useRef<HTMLInputElement>(null)

  const exportCsv = () => {
    const csv = buildItemsCsv(
      items.map((it) => ({
        nameAr: it.nameAr,
        barcode: it.barcodes[0] ?? '',
        categoryName: categories.find((c) => c.id === it.categoryId)?.nameAr ?? '',
        baseUnit: it.baseUnit,
        priceMinor: it.priceMinor,
        costMinor: it.costMinor,
        stockQty: it.stockQty ?? 0,
        minQty: it.minQty,
      })),
      cur,
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `shopsys-items-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    toast.show(`صُدّر ${items.length} صنفاً — يفتح في Excel مباشرة 📄`)
  }

  const importCsv = async (file: File) => {
    try {
      const text = await file.text()
      const report = parseItemsCsv(text, cur, {
        names: new Set(items.map((it) => it.nameAr)),
        barcodes: new Set(items.flatMap((it) => it.barcodes)),
      })
      if (report.errors.length && report.items.length === 0) {
        toast.show(report.errors.slice(0, 3).join(' — '), 'error')
        return
      }
      // أقسام غير موجودة تُنشأ تلقائياً (رئيسية بلا خصائص)
      let cats = categories
      for (const row of report.items) {
        if (row.categoryName && !cats.some((c) => c.nameAr === row.categoryName)) {
          addCategory(row.categoryName, [], null)
          cats = useDataStore.getState().categories
        }
      }
      for (const row of report.items) {
        const cat = cats.find((c) => c.nameAr === row.categoryName) ?? cats[0]
        const draft = draftFromCategory(cat, nextSku(useDataStore.getState().items))
        addItem({
          ...draft,
          nameAr: row.nameAr,
          barcodes: row.barcode ? [row.barcode] : [],
          baseUnit: row.baseUnit,
          priceMinor: row.priceMinor,
          costMinor: row.costMinor,
          stockQty: row.stockQty,
          minQty: row.minQty,
        })
      }
      const parts = [`استُورد ${report.items.length} صنفاً ✅`]
      if (report.skippedDuplicates) parts.push(`تخطى ${report.skippedDuplicates} مكرراً`)
      if (report.errors.length) parts.push(`رفض ${report.errors.length} صفاً معيباً`)
      toast.show(parts.join(' — '), report.errors.length ? 'error' : 'success')
    } catch {
      toast.show('تعذرت قراءة الملف — تأكد أنه CSV مصدَّر من التطبيق', 'error')
    }
  }

  const openEditCategory = (c: Category) => {
    setCatName(c.nameAr); setCatFeatures(c.features); setCatParentId(c.parentId); setEditingCatId(c.id); setModal('category')
  }

  const saveCategory = () => {
    if (!catName.trim()) return
    if (editingCatId) {
      updateCategory(editingCatId, { nameAr: catName.trim(), features: catFeatures, parentId: catParentId })
      toast.show('تم تعديل القسم')
    } else {
      addCategory(catName.trim(), catFeatures, catParentId)
      toast.show(`تم إنشاء قسم «${catName.trim()}»`)
    }
    setModal('closed')
  }

  /** عند اختيار أب، ورّث خصائصه تلقائياً كنقطة بداية */
  const onPickParent = (pid: number | null) => {
    setCatParentId(pid)
    if (pid && !editingCatId) {
      const parent = categories.find((c) => c.id === pid)
      if (parent) setCatFeatures(parent.features)
    }
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
        <select value={catFilter} onChange={(e) => setCatFilter(Number(e.target.value))} className={`${inputCls} w-56`}>
          <option value={0}>كل الأقسام</option>
          {orderedCats.map(({ cat, depth }) => (
            <option key={cat.id} value={cat.id}>{'\u00A0\u00A0'.repeat(depth)}{depth > 0 ? '↳ ' : ''}{cat.nameAr}</option>
          ))}
        </select>
        <Btn variant="soft" onClick={openNewCategory}>
          <span className="flex items-center gap-1.5"><FolderPlus size={15} /> قسم جديد</span>
        </Btn>
        <Btn variant="ghost" onClick={exportCsv} disabled={items.length === 0}>
          <span className="flex items-center gap-1.5"><FileDown size={15} /> تصدير Excel</span>
        </Btn>
        <Btn variant="ghost" onClick={() => fileRef.current?.click()}>
          <span className="flex items-center gap-1.5"><FileUp size={15} /> استيراد Excel</span>
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importCsv(f)
            e.target.value = ''
          }}
        />
        <Btn onClick={openNewItem}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> صنف جديد</span>
        </Btn>
      </div>

      {/* شجرة الأقسام */}
      {orderedCats.length > 0 && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3" style={{ animationDelay: '60ms' }}>
          <div className="text-[11px] font-bold text-slate-400 mb-2 px-1">🗂️ شجرة الأقسام — اضغط للفلترة، وأيقونة القلم للتعديل</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter(0)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all duration-200 hover:scale-105 ${
                catFilter === 0 ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              الكل ({items.length})
            </button>
            {orderedCats.map(({ cat, depth }) => {
              const count = items.filter((i) => categoryDescendants(cat.id, categories).includes(i.categoryId)).length
              return (
                <span key={cat.id} className="group inline-flex items-center">
                  <button
                    onClick={() => setCatFilter(cat.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-r-full text-xs font-bold border-2 border-l-0 transition-all duration-200 hover:scale-[1.03] ${
                      catFilter === cat.id
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {depth > 0 && <CornerDownLeft size={11} className="opacity-40" />}
                    {cat.nameAr}
                    <span className="text-slate-400 font-normal">{count}</span>
                    <span className="flex gap-0.5">{cat.features.slice(0, 3).map((f) => <span key={f} className="text-[10px]">{FEATURE_LABELS[f].icon}</span>)}</span>
                  </button>
                  <button
                    onClick={() => openEditCategory(cat)}
                    className={`px-2 py-1.5 rounded-l-full border-2 border-r-0 text-slate-300 hover:text-brand-600 transition-colors duration-200 ${
                      catFilter === cat.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'
                    }`}
                    title="تعديل القسم"
                  >
                    <Pencil size={11} />
                  </button>
                </span>
              )
            })}
          </div>
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
                <th className="px-4 py-3 font-bold">الرصيد</th>
                <th className="px-4 py-3 font-bold">
                  <span className="inline-flex items-center gap-1">التكلفة <Lock size={10} className="opacity-50" /></span>
                </th>
                <th className="px-4 py-3 font-bold">البيع</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => {
                const cat = categories.find((c) => c.id === it.categoryId)
                return (
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
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[12px]">
                      {cat ? categoryPath(cat, categories) : '—'}
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
                    <td className="px-4 py-3">
                      <span className={`font-bold text-[13px] ${(it.stockQty ?? 0) <= it.minQty ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300'}`}>
                        {it.stockQty ?? 0}
                      </span>
                      <span className="text-[10px] text-slate-400 mr-1">{it.baseUnit}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[13px]">
                      <span title={hasPurchases(it.id) ? 'محسوبة تلقائياً من فواتير الشراء (متوسط مرجح)' : 'تكلفة افتتاحية'}>
                        {formatMinor(it.costMinor, cur, false)}
                        {hasPurchases(it.id) && <Lock size={10} className="inline mr-1 opacity-40" />}
                      </span>
                    </td>
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
                )
              })}
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
            costLocked={editing ? hasPurchases(editing.id) : false}
            orderedCats={orderedCats}
            onSave={saveItem}
            onCancel={() => setModal('closed')}
          />
        )}
      </Modal>

      {/* مودال القسم */}
      <Modal open={modal === 'category'} onClose={() => setModal('closed')} title={editingCatId ? 'تعديل قسم' : 'قسم جديد'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم القسم">
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="مثال: ألبان وأجبان" className={inputCls} autoFocus />
            </Field>
            <Field label="القسم الأب" hint="اتركه «رئيسي» أو اختر أباً ليصبح فرعياً">
              <select
                value={catParentId ?? 0}
                onChange={(e) => onPickParent(Number(e.target.value) || null)}
                className={inputCls}
              >
                <option value={0}>— قسم رئيسي —</option>
                {orderedCats
                  .filter(({ cat }) => cat.id !== editingCatId) // لا يكون أباً لنفسه
                  .map(({ cat, depth }) => (
                    <option key={cat.id} value={cat.id}>{'\u00A0\u00A0'.repeat(depth)}{depth > 0 ? '↳ ' : ''}{cat.nameAr}</option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="خصائص القسم — تورَّث تلقائياً لأصنافه وأقسامه الفرعية الجديدة" hint="وكل صنف يستطيع تجاوزها لاحقاً (القرار 5)">
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
          <div className="flex justify-between gap-2 pt-2">
            {editingCatId ? (
              <Btn
                variant="danger"
                onClick={() => {
                  removeCategory(editingCatId)
                  toast.show('حُذف القسم (إن كان فارغاً بلا أصناف أو فروع)')
                  setModal('closed')
                }}
              >
                حذف القسم
              </Btn>
            ) : <span />}
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setModal('closed')}>إلغاء</Btn>
              <Btn onClick={saveCategory} disabled={!catName.trim()}>حفظ القسم</Btn>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ─────────────── نموذج الصنف ─────────────── */
function ItemForm({
  draft, setDraft, errors, currencySymbol, decimals, costLocked, orderedCats, onSave, onCancel,
}: {
  draft: ItemDraft
  setDraft: (d: ItemDraft) => void
  errors: string[]
  currencySymbol: string
  decimals: number
  costLocked: boolean
  orderedCats: { cat: Category; depth: number }[]
  onSave: () => void
  onCancel: () => void
}) {
  const { categories } = useDataStore()
  const [barcodeInput, setBarcodeInput] = useState('')
  const [colorInput, setColorInput] = useState('')
  const [sizeInput, setSizeInput] = useState('')
  const [customUnit, setCustomUnit] = useState(false)
  const p = (patch: Partial<ItemDraft>) => setDraft({ ...draft, ...patch })

  const moneyInput = (valueMinor: number, onChange: (m: number) => void, disabled = false) => (
    <div className="relative">
      <input
        type="number"
        step={decimals ? `0.${'0'.repeat(decimals - 1)}1` : '1'}
        min={0}
        disabled={disabled}
        defaultValue={valueMinor ? valueMinor / 10 ** decimals : ''}
        onChange={(e) => {
          try { onChange(toMinor(e.target.value || '0', decimals)) } catch { /* تجاهل */ }
        }}
        className={`${inputCls} pl-12 ${disabled ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50' : ''}`}
        placeholder="0"
      />
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">{currencySymbol}</span>
    </div>
  )

  const isKnownUnit = UNIT_GROUPS.some((g) => g.units.includes(draft.baseUnit))

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
        <Field label="القسم (رئيسي أو فرعي)">
          <select
            value={draft.categoryId}
            onChange={(e) => {
              const cat = categories.find((c) => c.id === Number(e.target.value))
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
            {orderedCats.map(({ cat, depth }) => (
              <option key={cat.id} value={cat.id}>{'\u00A0\u00A0'.repeat(depth)}{depth > 0 ? '↳ ' : ''}{cat.nameAr}</option>
            ))}
          </select>
        </Field>
        <Field label="الكود (SKU)">
          <input value={draft.sku} onChange={(e) => p({ sku: e.target.value })} className={inputCls} />
        </Field>
        <Field label="الوحدة الأساسية *" hint={customUnit ? 'اكتب وحدتك الخاصة' : 'كتالوج شامل مجمع بفئات — أو اختر «وحدة مخصصة»'}>
          {customUnit || (!isKnownUnit && draft.baseUnit) ? (
            <div className="flex gap-2">
              <input value={draft.baseUnit} onChange={(e) => p({ baseUnit: e.target.value })} placeholder="اكتب الوحدة…" className={inputCls} />
              <Btn variant="ghost" onClick={() => { setCustomUnit(false); p({ baseUnit: 'قطعة' }) }}>القائمة</Btn>
            </div>
          ) : (
            <select
              value={draft.baseUnit}
              onChange={(e) => {
                if (e.target.value === '__custom__') { setCustomUnit(true); p({ baseUnit: '' }) }
                else p({ baseUnit: e.target.value })
              }}
              className={inputCls}
            >
              {UNIT_GROUPS.map((g) => (
                <optgroup key={g.nameAr} label={`${g.icon} ${g.nameAr}`}>
                  {g.units.map((u) => <option key={u} value={u}>{u}</option>)}
                </optgroup>
              ))}
              <option value="__custom__">✏️ وحدة مخصصة…</option>
            </select>
          )}
        </Field>
        <Field
          label={costLocked ? 'التكلفة (محسوبة تلقائياً 🔒)' : 'التكلفة الافتتاحية'}
        >
          {moneyInput(draft.costMinor, (m) => p({ costMinor: m }), costLocked)}
          <p className="text-[10px] text-slate-400 mt-1">
            {costLocked
              ? 'هذا الصنف له فواتير شراء — تكلفته متوسط مرجح يتحدث تلقائياً مع كل شراء ولا تُعدَّل يدوياً'
              : 'تُستخدم فقط قبل أول فاتورة شراء — بعدها تُحسب تلقائياً من المشتريات ومصاريفها'}
          </p>
        </Field>
        <Field label="سعر البيع">{moneyInput(draft.priceMinor, (m) => p({ priceMinor: m }))}</Field>
        <Field label="حد إعادة الطلب" hint="عند وصول الرصيد إليه يظهر تنبيه نواقص">
          <input
            type="number" min={0} defaultValue={draft.minQty || ''}
            onChange={(e) => p({ minQty: Number(e.target.value) || 0 })}
            className={inputCls} placeholder="0"
          />
        </Field>
      </div>

      {/* الباركودات */}
      <Field label="الباركودات — يدعم أكثر من باركود للصنف الواحد">
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

      {/* خصائص الصنف */}
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
        <select value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} flex-1`}>
          <option value="">اختر وحدة…</option>
          {UNIT_GROUPS.map((g) => (
            <optgroup key={g.nameAr} label={`${g.icon} ${g.nameAr}`}>
              {g.units.filter((u) => u !== draft.baseUnit).map((u) => <option key={u} value={u}>{u}</option>)}
            </optgroup>
          ))}
        </select>
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
