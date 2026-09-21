/**
 * شاشة الأصناف — المرحلة 1 (محدَّثة بملاحظات المالك)
 * - أقسام رئيسية وفرعية (شجرة) مع وراثة الخصائص
 * - كتالوج وحدات احترافي شامل + وحدة مخصصة
 * - سعر التكلفة محسوب تلقائياً من فواتير الشراء (متوسط مرجح) — لا يُعدَّل يدوياً بعد أول حركة
 */
import { useCallback, useMemo, useState } from 'react'
import { useRef } from 'react'
import { Plus, Search, Pencil, Trash2, Barcode, FolderPlus, Package, Lock, CornerDownLeft, FileDown, FileUp, Grid3x3, BookOpen, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  validateItem, nextSku, draftFromCategory, categoryPath, categoryDescendants, GRADE_LABELS,
  type ItemDraft, type Item, type Category,
} from '../../core/items.ts'
import { FEATURE_LABELS, getActivity, type ItemFeature } from '../../core/activities.ts'
import { buildItemsCsv, parseItemsCsv } from '../../core/itemsCsv.ts'
import { UNIT_GROUPS } from '../../core/units.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { buildItemLedger } from '../../core/itemLedger.ts'
import { computeWarehouseStock, buildWarehouseDocs } from '../../core/transfers.ts'
import { renderItemLedgerHtml } from '../print/printItemLedger.ts'
import { renderItemLabelsHtml } from '../print/printProLabels.ts'
import type { ItemLabelData } from '../../core/labels.ts'
import { printHtml } from '../print/printReceipt.ts'

const ALL_FEATURES: ItemFeature[] = ['expiry_batches', 'serial_warranty', 'variants', 'weight_scale', 'multi_unit', 'price_lists']

export function ItemsPage() {
  const { items, categories, addItem, updateItem, removeItem, addCategory, updateCategory, removeCategory, purchases, purchaseReturns, sales, saleReturns, stocktakes, productionOrders, processingOrders, materialRequisitions, recipes, batches, serials, variantStocks, setVariantStock, getUndistributedQty, warehouses, transfers, journal } = useDataStore()
  const { setup, labelSettings } = useAppStore()
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<number | 0>(0)
  const [warehouseFilter, setWarehouseFilter] = useState<number | 0>(0)
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

  const warehouseStock = useMemo(
    () => computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns)),
    [items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns],
  )
  const stockInWarehouse = useCallback((warehouseId: number, itemId: number) => warehouseStock.get(warehouseId)?.get(itemId) ?? 0, [warehouseStock])

  const filtered = useMemo(() => {
    const allowedIds = catFilter ? new Set(categoryDescendants(catFilter, categories)) : null
    return items.filter((it) => {
      if (allowedIds && !allowedIds.has(it.categoryId)) return false
      if (warehouseFilter && stockInWarehouse(warehouseFilter, it.id) <= 0) return false
      const q = query.trim()
      if (!q) return true
      return it.nameAr.includes(q) || it.sku.includes(q) || it.barcodes.some((b) => b.includes(q))
    })
  }, [items, query, catFilter, categories, warehouseFilter, stockInWarehouse])

  /** هل للصنف حركة شراء؟ عندها تُقفل التكلفة (تصبح محسوبة فقط) */
  const hasPurchases = (itemId: number) => purchases.some((p) => p.lines.some((l) => l.itemId === itemId))

  const openNewItem = () => {
    const cat = categories.find((c) => c.id === (catFilter || categories[0]?.id))
    setDraft(draftFromCategory(cat, nextSku(items)))
    setEditing(null)
    setErrors([])
    setModal('item')
  }

  /* مصفوفة لون×مقاس */
  const [matrixFor, setMatrixFor] = useState<Item | null>(null)
  /* ─── كارت الصنف: دفتر الحركة بفلتر فترة + طباعة (الأمر 13) ─── */
  const [cardFor, setCardFor] = useState<Item | null>(null)
  /* ─── طباعة ملصقات الباركود (مراجعة السوبرماركت) ─── */
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelCounts, setLabelCounts] = useState<Record<number, string>>({})
  const printLabels = () => {
    const list: ItemLabelData[] = []
    for (const [idStr, cntStr] of Object.entries(labelCounts)) {
      const cnt = Number(cntStr) || 0
      if (cnt <= 0) continue
      const it = items.find((x) => x.id === Number(idStr))
      if (!it) continue
      list.push({ nameAr: it.nameAr, barcode: it.barcodes.find(Boolean) || it.sku || String(it.id), sku: it.sku, priceMinor: it.priceMinor, count: Math.min(cnt, 500) })
    }
    if (!list.length) { toast.show('حدد عدد الملصقات لصنف واحد على الأقل', 'error'); return }
    // القالب المركزي (مركز الباركود) — يُضبط مرة ويسري على كل الطباعات
    printHtml(renderItemLabelsHtml(setup.shopName || 'تَحَكَّم', list, labelSettings, cur))
  }
  const [ledgerFrom, setLedgerFrom] = useState('')
  const [ledgerTo, setLedgerTo] = useState('')
  const [ledgerWarehouseId, setLedgerWarehouseId] = useState<number | 0>(0)
  const [ledgerUser, setLedgerUser] = useState('')

  const journalUser = useCallback((sourceType: string, sourceId: number | null | undefined) =>
    journal.find((j) => j.sourceType === sourceType && j.sourceId === sourceId)?.createdBy ?? null, [journal])
  const openItemCard = (it: Item) => {
    setCardFor(it); setLedgerFrom(''); setLedgerTo(''); setLedgerWarehouseId(0); setLedgerUser('')
  }

  const ledgerInput = useMemo(() => {
    if (!cardFor) return null
    return {
      itemId: cardFor.id,
      openingQty: 0, // يُحسب عكسياً بالأسفل من الرصيد الحالي
      purchases: purchases.map((p) => ({ invoiceNumber: p.invoiceNumber, date: p.date, warehouseId: p.warehouseId ?? null, userName: journalUser('purchase', p.id), lines: p.lines })),
      purchaseReturns: purchaseReturns.map((r) => ({ returnNumber: r.returnNumber, date: r.date, warehouseId: purchases.find((p) => p.id === r.purchaseId)?.warehouseId ?? null, userName: journalUser('purchase_return', r.id), lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCostMinor: l.landedUnitCostMinor })) })),
      sales: sales.map((sl) => ({ invoiceNumber: sl.invoiceNumber, date: sl.date, warehouseId: sl.warehouseId ?? null, userName: journalUser('sale', sl.id), lines: sl.lines })),
      saleReturns: saleReturns.map((r) => ({ returnNumber: r.returnNumber, date: r.date, warehouseId: sales.find((sl) => sl.id === r.saleId)?.warehouseId ?? null, userName: journalUser('sale_return', r.id), lines: r.lines })),
      stocktakes: stocktakes.map((st) => ({ stocktakeNumber: st.stocktakeNumber, date: st.date, warehouseId: null, userName: journal.find((j) => j.id === st.journalEntryId)?.createdBy ?? null, rows: st.result.variances.map((v) => ({ itemId: v.itemId, systemQty: v.expectedQty, countedQty: v.countedQty })) })),
      productionOrders: productionOrders.map((po) => {
        const recipe = recipes.find((rc) => rc.id === po.recipeId)
        return {
          orderNumber: po.orderNumber, date: po.date, productItemId: po.productItemId, qty: po.producedQty,
          ingredients: (recipe?.ingredients ?? []).map((ing) => ({ itemId: ing.itemId, qty: ing.qty * po.batches })),
        }
      }),
      materialRequisitions: materialRequisitions.map((mr) => ({ reqNumber: mr.reqNumber, date: mr.date, warehouseId: warehouses.find((w) => w.isMain)?.id ?? null, userName: journal.find((j) => j.id === mr.journalEntryId)?.createdBy ?? null, lines: mr.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) })),
      processingOrders: processingOrders.map((pr) => ({ orderNumber: pr.orderNumber, date: pr.date.slice(0, 10), sourceItemId: pr.sourceItemId, sourceQty: pr.sourceQty, outputs: pr.outputs.map((o) => ({ itemId: o.itemId, qty: o.qty })) })),
      transfers: transfers.map((tr) => ({ transferNumber: tr.transferNumber, date: tr.date, fromWarehouseId: tr.fromWarehouseId, toWarehouseId: tr.toWarehouseId, userName: null, lines: tr.lines })),
    }
  }, [cardFor, purchases, purchaseReturns, sales, saleReturns, stocktakes, productionOrders, processingOrders, recipes, materialRequisitions, transfers, warehouses, journal, journalUser])

  const itemLedger = useMemo(() => {
    if (!cardFor || !ledgerInput) return null
    const filterWarehouse = <T extends { warehouseId?: number | null }>(rows: T[]) => ledgerWarehouseId ? rows.filter((r) => (r.warehouseId ?? 0) === ledgerWarehouseId) : rows
    const scopedInput = ledgerWarehouseId ? {
      ...ledgerInput,
      purchases: ledgerInput.purchases.map((p) => ({ ...p, lines: p.lines.filter((l) => (l.warehouseId ?? p.warehouseId ?? 0) === ledgerWarehouseId) })).filter((p) => p.lines.length),
      purchaseReturns: filterWarehouse(ledgerInput.purchaseReturns),
      sales: filterWarehouse(ledgerInput.sales),
      saleReturns: filterWarehouse(ledgerInput.saleReturns),
      stocktakes: filterWarehouse(ledgerInput.stocktakes),
      materialRequisitions: filterWarehouse(ledgerInput.materialRequisitions),
      transfers: (ledgerInput.transfers ?? []).filter((t) => t.fromWarehouseId === ledgerWarehouseId || t.toWarehouseId === ledgerWarehouseId),
    } : ledgerInput
    // الرصيد الافتتاحي يُشتق عكسياً من الرصيد الحالي في النطاق المختار (كل المخازن أو مخزن محدد)
    const currentQty = ledgerWarehouseId ? stockInWarehouse(ledgerWarehouseId, cardFor.id) : (cardFor.stockQty ?? 0)
    const all = buildItemLedger(scopedInput)
    const opening = Math.round((currentQty - (all.totalIn - all.totalOut)) * 1000) / 1000
    return buildItemLedger({ ...scopedInput, openingQty: opening }, ledgerFrom || undefined, ledgerTo || undefined)
  }, [cardFor, ledgerInput, ledgerFrom, ledgerTo, ledgerWarehouseId, stockInWarehouse])
  const shownLedgerRows = useMemo(
    () => itemLedger?.rows.filter((r) => !ledgerUser || (r.userName ?? '') === ledgerUser) ?? [],
    [itemLedger, ledgerUser],
  )
  const ledgerUsers = useMemo(
    () => Array.from(new Set((itemLedger?.rows ?? []).map((r) => r.userName).filter(Boolean) as string[])).sort(),
    [itemLedger],
  )

  const printItemCard = () => {
    if (!cardFor || !itemLedger) return
    const cat = categories.find((c) => c.id === cardFor.categoryId)
    const details = [
      cardFor.sku ? `SKU: ${cardFor.sku}` : '',
      cat ? `القسم: ${cat.nameAr}` : '',
      `الوحدة: ${cardFor.baseUnit}`,
      `التكلفة: ${formatMinor(cardFor.costMinor, cur, false)}`,
      `سعر البيع: ${formatMinor(cardFor.priceMinor, cur, false)}`,
      cardFor.minQty > 0 ? `حد الطلب: ${cardFor.minQty}` : '',
    ].filter(Boolean)
    printHtml(renderItemLedgerHtml({
      shopName: setup.shopName || 'تَحَكَّم',
      headerLines: [],
      itemName: cardFor.nameAr,
      itemDetails: details,
      ledger: itemLedger,
      period: ledgerFrom || ledgerTo ? `من ${ledgerFrom || 'البداية'} إلى ${ledgerTo || 'اليوم'}` : undefined,
      cur,
    }))
  }
  const matrixItem = matrixFor ? items.find((x) => x.id === matrixFor.id) ?? null : null

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
    if (it.isService) badges.push({ icon: '🛎️', label: 'خدمة', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' })
    if (it.trackExpiry) badges.push({ icon: '📅', label: 'صلاحية', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' })
    if (it.trackSerial) badges.push({ icon: '🔢', label: 'سيريال', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' })
    if (it.grade) badges.push({ icon: GRADE_LABELS[it.grade].icon, label: GRADE_LABELS[it.grade].nameAr, cls: 'bg-slate-500/10 text-slate-500 dark:text-slate-400' })
    if (it.oemNumbers?.length) badges.push({ icon: '🔧', label: `${it.oemNumbers.length} OEM`, cls: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' })
    if (it.activeIngredient) badges.push({ icon: '🧪', label: it.activeIngredient, cls: 'bg-lime-500/10 text-lime-600 dark:text-lime-400' })
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
        {warehouses.length > 1 && (
          <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(Number(e.target.value))} className={`${inputCls} w-56`} title="فلترة الأصناف حسب المخزن">
            <option value={0}>كل المخازن</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>🏬 {w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
          </select>
        )}
        <Btn variant="soft" onClick={openNewCategory}>
          <span className="flex items-center gap-1.5"><FolderPlus size={15} /> قسم جديد</span>
        </Btn>
        <Btn variant="ghost" onClick={() => { setLabelCounts({}); setLabelsOpen(true) }} disabled={items.length === 0}>
          <span className="flex items-center gap-1.5"><Barcode size={15} /> ملصقات باركود</span>
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
                    className={`px-2.5 py-1.5 rounded-l-full border-2 border-r-0 text-amber-600 dark:text-amber-400 hover:text-white hover:bg-amber-500 transition-colors duration-200 ${
                      catFilter === cat.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'
                    }`}
                    title="تعديل القسم"
                  >
                    <Pencil size={16} strokeWidth={2.5} />
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
                    onDoubleClick={() => openItemCard(it)}
                    title="اضغط مرتين لفتح كارت حركة الصنف"
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
                        {warehouseFilter ? stockInWarehouse(warehouseFilter, it.id) : (it.stockQty ?? 0)}
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
                        {(it.variantColors.length > 0 || it.variantSizes.length > 0) && (
                          <button onClick={() => setMatrixFor(it)} title="مصفوفة لون×مقاس" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all duration-200 hover:scale-110">
                            <Grid3x3 size={15} />
                          </button>
                        )}
                        <button onClick={() => openItemCard(it)} title="كارت الصنف — دفتر الحركة الكامل مع فلتر وطباعة" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110">
                          <BookOpen size={15} />
                        </button>
                        <button onClick={() => openEditItem(it)} title="تعديل بيانات الصنف" className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110">
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => { try { removeItem(it.id); toast.show(`تم حذف «${it.nameAr}»`) } catch (e) { toast.show((e as Error).message, 'error') } }}
                          title="حذف الصنف — يُرفض إن كان له حركة أو رصيد (عطّله بدلاً من الحذف)"
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

      {/* مصفوفة مخزون لون×مقاس */}
      <Modal open={!!matrixItem} onClose={() => setMatrixFor(null)} title={matrixItem ? `مصفوفة المقاسات — ${matrixItem.nameAr}` : ''} wide>
        {matrixItem && (() => {
          const colors = matrixItem.variantColors.length ? matrixItem.variantColors : ['']
          const sizes = matrixItem.variantSizes.length ? matrixItem.variantSizes : ['']
          const qtyOf = (c: string, sz: string) => variantStocks.find((v) => v.itemId === matrixItem.id && v.color === c && v.size === sz)?.qty ?? 0
          const undistributed = getUndistributedQty(matrixItem.id)
          return (
            <div className="space-y-3">
              <div className={`rounded-xl p-3 text-[12px] font-bold ${undistributed > 0 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>
                رصيد الصنف الإجمالي: {matrixItem.stockQty} — {undistributed > 0 ? `غير موزع على التركيبات: ${undistributed}` : 'موزع بالكامل ✓'}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 text-right text-[11px] font-bold text-slate-400">اللون \ المقاس</th>
                      {sizes.map((sz) => <th key={sz} className="p-2 text-center text-[12px] font-black">{sz || '—'}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {colors.map((c) => (
                      <tr key={c} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 font-bold text-[13px]">{c || '—'}</td>
                        {sizes.map((sz) => (
                          <td key={sz} className="p-1.5 text-center">
                            <input
                              key={`${c}-${sz}-${qtyOf(c, sz)}`}
                              defaultValue={qtyOf(c, sz) || ''}
                              placeholder="0"
                              inputMode="decimal"
                              onBlur={(e) => {
                                const v = Number(e.target.value) || 0
                                if (v === qtyOf(c, sz)) return
                                try {
                                  setVariantStock(matrixItem.id, c, sz, v)
                                  toast.show(`«${c || sz}»: الرصيد ${v} ✓`)
                                } catch (err) {
                                  toast.show((err as Error).message, 'error')
                                  e.target.value = String(qtyOf(c, sz) || '')
                                }
                              }}
                              className="w-20 text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent py-1.5 text-[13px] font-bold focus:border-violet-400 outline-none"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400">
                مجموع التركيبات لا يتجاوز رصيد الصنف — بعد كل فاتورة شراء وزّع الكمية الجديدة هنا. البيع في الكاشير سيطلب اختيار التركيبة ويخصم منها.
              </p>
            </div>
          )
        })()}
      </Modal>

      {/* 🏷️ ملصقات الباركود — شبكة A4 (اسم + سعر + Code128) */}
      <Modal open={labelsOpen} onClose={() => setLabelsOpen(false)} title="🏷️ طباعة ملصقات باركود" wide>
        <div className="space-y-3">
          <p className="text-[11.5px] text-slate-400">حدد عدد الملصقات لكل صنف — تُطبع شبكة A4 (4 أعمدة) باسم الصنف وسعره وباركود Code128 قابل للمسح.</p>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden max-h-[50vh] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-card-dark">
                  <th className="px-4 py-2">الصنف</th><th className="px-4 py-2">الباركود</th><th className="px-4 py-2">السعر</th><th className="px-4 py-2 w-24">عدد الملصقات</th>
                </tr>
              </thead>
              <tbody>
                {items.filter((it) => it.isActive).map((it) => (
                  <tr key={it.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-1.5 font-bold">{it.nameAr}</td>
                    <td className="px-4 py-1.5 font-mono text-[11px] text-slate-400" dir="ltr">{it.barcodes.find(Boolean) || it.sku || it.id}</td>
                    <td className="px-4 py-1.5 text-emerald-600 font-bold">{formatMinor(it.priceMinor, cur, false)}</td>
                    <td className="px-4 py-1.5">
                      <input value={labelCounts[it.id] ?? ''} onChange={(e) => setLabelCounts((c) => ({ ...c, [it.id]: e.target.value }))} className={`${inputCls} !py-1 !text-[12px] text-center`} dir="ltr" placeholder="0" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setLabelsOpen(false)}>إغلاق</Btn>
            <Btn onClick={printLabels}>🖨️ طباعة الملصقات</Btn>
          </div>
        </div>
      </Modal>

      {/* 📖 كارت الصنف — بيانات إضافية + دفتر الحركة بفلتر وطباعة (الأمر 13) */}
      <Modal open={!!cardFor} onClose={() => setCardFor(null)} title={cardFor ? `📖 كارت الصنف — ${cardFor.nameAr}` : ''} wide>
        {cardFor && itemLedger && (() => {
          const cat = categories.find((c) => c.id === cardFor.categoryId)
          const itemBatches = batches.filter((b) => b.itemId === cardFor.id && b.qty > 0)
          const itemSerials = serials.filter((u) => u.itemId === cardFor.id && u.status === 'in_stock')
          const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''))
          return (
            <div className="space-y-4">
              {/* البيانات الإضافية */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">الرصيد الحالي</div><div className="font-black text-lg">{qtyFmt(cardFor.stockQty ?? 0)} {cardFor.baseUnit}</div></div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">التكلفة (متوسط مرجح)</div><div className="font-black text-lg">{formatMinor(cardFor.costMinor, cur, false)}</div></div>
                <div className="p-2.5 rounded-xl bg-emerald-500/5"><div className="text-[10px] text-slate-400">سعر البيع</div><div className="font-black text-lg text-emerald-600">{formatMinor(cardFor.priceMinor, cur, false)}</div></div>
                <div className="p-2.5 rounded-xl bg-violet-500/5"><div className="text-[10px] text-slate-400">قيمة المخزون</div><div className="font-black text-lg text-violet-600">{formatMinor(Math.round((cardFor.stockQty ?? 0) * cardFor.costMinor), cur, false)}</div></div>
              </div>
              {/* أمر التعديل: تفصيل الرصيد بكل مخزن داخل معاينة الصنف */}
              {warehouses.length > 1 && (() => {
                const whStock = computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns))
                return (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2 text-[11.5px] font-black text-slate-500 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">🏬 الرصيد بكل مخزن</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                      {warehouses.map((w) => {
                        const q = whStock.get(w.id)?.get(cardFor.id) ?? 0
                        return (
                          <div key={w.id} className={`p-2.5 rounded-xl text-center ${q > 0 ? 'bg-teal-500/5 border border-teal-500/20' : 'bg-slate-50 dark:bg-slate-800/50 opacity-60'}`}>
                            <div className="text-[10.5px] text-slate-400">{w.nameAr}{w.isMain ? ' ⭐' : ''}</div>
                            <div className={`font-black ${q > 0 ? 'text-teal-600' : 'text-slate-400'}`}>{qtyFmt(q)} {cardFor.baseUnit}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                {cardFor.sku && <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono" dir="ltr">{cardFor.sku}</span>}
                {cat && <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">📁 {cat.nameAr}</span>}
                {cardFor.barcodes.filter(Boolean).map((b, i) => <span key={i} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono" dir="ltr">|||| {b}</span>)}
                {cardFor.minQty > 0 && <span className={`px-2 py-1 rounded-lg font-bold ${(cardFor.stockQty ?? 0) <= cardFor.minQty ? 'bg-rose-500/10 text-rose-500' : 'bg-slate-100 dark:bg-slate-800'}`}>حد الطلب: {cardFor.minQty}</span>}
                {itemBatches.length > 0 && <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-600 font-bold">⏳ {itemBatches.length} دفعة صلاحية</span>}
                {itemSerials.length > 0 && <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-600 font-bold">🔢 {itemSerials.length} سيريال بالمخزون</span>}
              </div>

              {/* فلتر الفترة + طباعة */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                <Field label="من تاريخ"><input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} className={inputCls} /></Field>
                <Field label="إلى تاريخ"><input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} className={inputCls} /></Field>
                <Field label="المخزن">
                  <select value={ledgerWarehouseId} onChange={(e) => setLedgerWarehouseId(Number(e.target.value))} className={inputCls}>
                    <option value={0}>كل المخازن</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="المستخدم">
                  <select value={ledgerUser} onChange={(e) => setLedgerUser(e.target.value)} className={inputCls}>
                    <option value="">كل المستخدمين</option>
                    {ledgerUsers.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700" onClick={printItemCard}>
                  <Printer size={14} /> طباعة
                </Btn>
              </div>

              {/* دفتر الحركة برصيد جارٍ */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
                <div className="px-4 py-2 flex flex-wrap gap-4 text-[11.5px] font-bold bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                  <span>أول الفترة: {qtyFmt(itemLedger.openingQty)}</span>
                  <span className="text-emerald-600">وارد: {qtyFmt(itemLedger.totalIn)}</span>
                  <span className="text-rose-500">منصرف: {qtyFmt(itemLedger.totalOut)}</span>
                  <span>آخر الفترة: {qtyFmt(itemLedger.closingQty)}</span>
                  {ledgerUser && <span className="text-sky-600">المعروض للمستخدم: {shownLedgerRows.length} حركة</span>}
                </div>
                {shownLedgerRows.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-[12px]">لا حركات في الفترة المحددة</div>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-3 py-2">التاريخ</th>
                        <th className="px-3 py-2">المستند</th>
                        <th className="px-3 py-2">المخزن</th>
                        <th className="px-3 py-2">المستخدم</th>
                        <th className="px-3 py-2">وارد</th>
                        <th className="px-3 py-2">منصرف</th>
                        <th className="px-3 py-2">الرصيد</th>
                        <th className="px-3 py-2">القيمة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownLedgerRows.map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-3 py-1.5 text-slate-400 font-mono text-[10.5px]" dir="ltr">{r.date}</td>
                          <td className="px-3 py-1.5 font-bold text-slate-700 dark:text-slate-200">{r.docLabel}<div className="text-[9.5px] text-slate-400 font-normal">{r.note}</div></td>
                          <td className="px-3 py-1.5 text-slate-500">{r.warehouseId ? (warehouses.find((w) => w.id === r.warehouseId)?.nameAr ?? '—') : '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.userName ?? '—'}</td>
                          <td className="px-3 py-1.5 font-bold text-emerald-600">{r.inQty ? qtyFmt(r.inQty) : '—'}</td>
                          <td className="px-3 py-1.5 font-bold text-rose-500">{r.outQty ? qtyFmt(r.outQty) : '—'}</td>
                          <td className="px-3 py-1.5 font-black">{qtyFmt(r.balance)}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.valueMinor ? formatMinor(r.valueMinor, cur, false) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        })()}
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
  const { setup } = useAppStore()
  const [barcodeInput, setBarcodeInput] = useState('')
  const [colorInput, setColorInput] = useState('')
  const [sizeInput, setSizeInput] = useState('')
  const [customUnit, setCustomUnit] = useState(false)
  // النشاط يحدد الخصائص البارزة تلقائياً (طلب المالك) — والبقية تحت «خيارات أكثر»
  const activity = getActivity(setup.activityId)
  const activityFeatures = new Set(activity?.features ?? [])
  const [moreOpen, setMoreOpen] = useState(false)
  const p = (patch: Partial<ItemDraft>) => setDraft({ ...draft, ...patch })

  // الخصائص الثلاث: ما يخص نشاطك يظهر دائماً — والباقي تحت «خيارات أكثر»
  const allProps = [
    { key: 'trackExpiry' as const, label: '📅 تتبع الصلاحية والدفعات', on: draft.trackExpiry, relevant: activityFeatures.has('expiry_batches') },
    { key: 'trackSerial' as const, label: '🔢 تتبع السيريال والضمان', on: draft.trackSerial, relevant: activityFeatures.has('serial_warranty') },
    { key: 'soldByWeight' as const, label: '⚖️ يُباع بالوزن', on: draft.soldByWeight, relevant: activityFeatures.has('weight_scale') },
    // صنف خدمة (Square/Lightspeed): حلاقة/غسيل سيارة/اشتراك جيم — يُباع بلا مخزون ولا تكلفة
    { key: 'isService' as const, label: '🛎️ صنف خدمة (بلا مخزون)', on: draft.isService ?? false, relevant: setup.activityId === 'salon' },
  ]
  const mainProps = allProps.filter((x) => x.relevant || x.on)
  const extraProps = allProps.filter((x) => !x.relevant && !x.on)
  const showVariantsMain = activityFeatures.has('variants')
  const showMultiUnitMain = activityFeatures.has('multi_unit')

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
        <Field label="حد أدنى لسعر البيع" hint="لا بيع تحته إلا باعتماد مدير — حماية من البيع بخسارة (اتركه 0 لتعطيله)">
          {moneyInput(draft.minSalePriceMinor ?? 0, (m) => p({ minSalePriceMinor: m }))}
        </Field>
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

      {/* خصائص الصنف — نشاطك يحدد البارز منها تلقائياً (طلب المالك) */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
        <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-1.5">
          <Package size={14} /> خصائص هذا الصنف
          {activity && <span className="font-normal text-slate-400">— حسب نشاطك ({activity.icon} {activity.nameAr})، والبقية تحت «خيارات أكثر»</span>}
        </div>
        {mainProps.length === 0 && (
          <p className="text-[11.5px] text-slate-400">نشاطك لا يحتاج خصائص تتبع خاصة عادةً — كل الخيارات متاحة أسفل «خيارات أكثر».</p>
        )}
        <div className="flex flex-wrap gap-2">
          {mainProps.map(({ key, label, on }) => (
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

        {/* مدة الضمان الافتراضية — تظهر فقط لأصناف السيريال (نمط موبايل شوب) */}
        {draft.trackSerial && (
          <div className="mt-3 anim-pop">
            <Field label="🛡️ مدة الضمان الافتراضية (بالأشهر)" hint="تُثبت على كل قطعة يوم بيعها — 0 = بلا ضمان">
              <input
                type="number" min={0} max={120}
                value={draft.warrantyMonths}
                onChange={(e) => p({ warrantyMonths: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
                className={inputCls}
              />
            </Field>
          </div>
        )}

        {/* ضريبة خاصة بالصنف أو إعفاء (طلب المالك) — الافتراضي يتبع نسبة البلد */}
        <div className="mt-3">
          <Field label="🧾 ضريبة الصنف" hint="افتراضي = نسبة البلد العامة · معفى = 0% · مخصصة = نسبة خاصة بهذا الصنف فقط">
            <div className="flex gap-2 items-center">
              <select
                value={draft.vatOverride === null || draft.vatOverride === undefined ? 'default' : draft.vatOverride === 0 ? 'exempt' : 'custom'}
                onChange={(e) => {
                  const v = e.target.value
                  p({ vatOverride: v === 'default' ? null : v === 'exempt' ? 0 : (draft.vatOverride || setup.vatPercent || 14) })
                }}
                className={inputCls}
              >
                <option value="default">يتبع النسبة العامة ({setup.vatPercent}%)</option>
                <option value="exempt">معفى ضريبياً (0%)</option>
                <option value="custom">نسبة مخصصة…</option>
              </select>
              {draft.vatOverride !== null && draft.vatOverride !== undefined && draft.vatOverride !== 0 && (
                <input
                  type="number" min={0.1} max={100} step={0.5}
                  value={draft.vatOverride}
                  onChange={(e) => p({ vatOverride: Math.max(0.1, Math.min(100, Number(e.target.value) || 1)) })}
                  className={`${inputCls} !w-24`} dir="ltr"
                />
              )}
            </div>
          </Field>
        </div>

        {/* المادة الفعالة (الصيدلية — نمط ShelfLifePro): الدواء الناقص يقترح بديله آلياً */}
        {(setup.activityId === 'pharmacy' || (draft.activeIngredient ?? '') !== '') && (
          <div className="mt-3 anim-pop">
            <Field label="🧪 المادة الفعالة (Active Ingredient)" hint="عند نفاد الدواء يقترح الكاشير البدائل المتوفرة بنفس المادة — مثال: Paracetamol 500mg">
              <input value={draft.activeIngredient ?? ''} onChange={(e) => p({ activeIngredient: e.target.value })} placeholder="مثال: Amoxicillin 500mg" className={inputCls} dir="ltr" />
            </Field>
          </div>
        )}

        {/* أرقام OEM والتوافق (جولة قطع الغيار) — أساسية لنشاطي قطع الغيار والأجهزة */}
        {(setup.activityId === 'spare_parts' || setup.activityId === 'electronics' || (draft.oemNumbers?.length ?? 0) > 0 || (draft.fitment ?? '') !== '') && (
          <div className="mt-3 anim-pop space-y-3">
            <Field label="🔧 أرقام OEM / بدائل (مفصولة بفواصل)" hint="القطعة تُعرف بأرقام كثيرة — الكاشير يبحث بأي منها (تجاهل الشرطات والمسافات تلقائي)">
              <input
                value={(draft.oemNumbers ?? []).join(', ')}
                onChange={(e) => p({ oemNumbers: e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean) })}
                placeholder="مثال: 0986AB1234, MD-360935"
                className={inputCls} dir="ltr"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="🚗 التوافق (يناسب موديلات)" hint="نص حر يبحث فيه الكاشير: «لانسر 2016» يظهر القطعة">
                <input value={draft.fitment ?? ''} onChange={(e) => p({ fitment: e.target.value })} placeholder="مثال: لانسر 2013-2017، إلنترا CN7" className={inputCls} />
              </Field>
              <Field label="⭐ درجة القطعة">
                <select value={draft.grade ?? ''} onChange={(e) => p({ grade: (e.target.value || undefined) as never })} className={inputCls}>
                  <option value="">— غير محدد —</option>
                  <option value="original">🟢 أصلي</option>
                  <option value="aftermarket">🔵 بديل تجاري</option>
                  <option value="used">🟠 مستعمل (استيراد)</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* المقاسات والألوان — أساسية لأنشطة الملابس ونحوها، وإلا فتحت «خيارات أكثر» */}
        {(showVariantsMain || draft.variantColors.length > 0 || draft.variantSizes.length > 0) && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <VariantsFields draft={draft} p={p} colorInput={colorInput} setColorInput={setColorInput} sizeInput={sizeInput} setSizeInput={setSizeInput} />
          </div>
        )}

        {(showMultiUnitMain || draft.extraUnits.length > 0) && (
          <div className="mt-3">
            <UnitEditor draft={draft} p={p} />
          </div>
        )}
      </div>

      {/* خيارات أكثر (طلب المالك) — كل ما لا يخص نشاطك يبقى متاحاً هنا */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200"
        >
          <Package size={15} className="text-brand-500" />
          <span className="flex-1 text-right">خيارات أكثر لتسجيل الصنف (كل الإمكانات مهما كان نشاطك)</span>
          <CornerDownLeft size={15} className={`opacity-50 transition-transform duration-300 ${moreOpen ? 'rotate-90' : ''}`} />
        </button>
        {moreOpen && (
          <div className="p-4 pt-1 space-y-4 anim-in">
            {extraProps.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {extraProps.map(({ key, label, on }) => (
                  <button
                    key={key}
                    onClick={() => p({ [key]: !on } as Partial<ItemDraft>)}
                    className={`px-3.5 py-2 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 hover:scale-105 ${
                      on ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {label} {on ? '✓' : ''}
                  </button>
                ))}
              </div>
            )}
            {!showVariantsMain && draft.variantColors.length === 0 && draft.variantSizes.length === 0 && (
              <div className="grid grid-cols-2 gap-3">
                <VariantsFields draft={draft} p={p} colorInput={colorInput} setColorInput={setColorInput} sizeInput={sizeInput} setSizeInput={setSizeInput} />
              </div>
            )}
            {!showMultiUnitMain && draft.extraUnits.length === 0 && <UnitEditor draft={draft} p={p} />}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Btn variant="ghost" onClick={onCancel}>إلغاء</Btn>
        <Btn onClick={onSave}>💾 حفظ الصنف</Btn>
      </div>
    </div>
  )
}

/** حقلا الألوان والمقاسات — مكوّن مشترك بين القسم الأساسي و«خيارات أكثر» */
function VariantsFields({
  draft, p, colorInput, setColorInput, sizeInput, setSizeInput,
}: {
  draft: ItemDraft
  p: (x: Partial<ItemDraft>) => void
  colorInput: string
  setColorInput: (v: string) => void
  sizeInput: string
  setSizeInput: (v: string) => void
}) {
  return (
    <>
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
    </>
  )
}

function UnitEditor({ draft, p }: { draft: ItemDraft; p: (x: Partial<ItemDraft>) => void }) {
  const { setup } = useAppStore()
  const unitCur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const [name, setName] = useState('')
  const [factor, setFactor] = useState('')
  const [unitPrice, setUnitPrice] = useState('') // سعر بيع الوحدة الأكبر (اختياري — جولة الصيدلية)
  const [unitBarcode, setUnitBarcode] = useState('') // باركود الوحدة (مسح الشريط/العلبة بالكاشير)
  const f = Number(factor)
  const valid = name.trim() !== '' && f > 1
  const add = () => {
    if (!valid) return
    const priceNum = Number(unitPrice)
    p({ extraUnits: [...draft.extraUnits, {
      nameAr: name.trim(), factor: f,
      ...(priceNum > 0 ? { priceMinor: toMinor(unitPrice, unitCur.decimals) } : {}),
      ...(unitBarcode.trim() ? { barcode: unitBarcode.trim() } : {}),
    }] })
    setName('')
    setFactor('')
    setUnitPrice('')
    setUnitBarcode('')
  }
  return (
    <Field label="📦 وحدات أكبر لنفس الصنف (اختياري)" hint={`تشتري بالكرتونة وتبيع بالـ${draft.baseUnit || 'قطعة'}؟ عرّف الوحدة الكبرى وكم ${draft.baseUnit || 'قطعة'} بداخلها`}>
      {/* تخطيط عملي بعناوين واضحة (ملاحظة المالك): الوحدة الكبرى + محتواها + معاينة فورية */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div>
          <div className="text-[10.5px] font-bold text-slate-400 mb-1">الوحدة الأكبر</div>
          <select value={name} onChange={(e) => setName(e.target.value)} className={inputCls}>
            <option value="">اختر…</option>
            {UNIT_GROUPS.map((g) => (
              <optgroup key={g.nameAr} label={`${g.icon} ${g.nameAr}`}>
                {g.units.filter((u) => u !== draft.baseUnit).map((u) => <option key={u} value={u}>{u}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10.5px] font-bold text-slate-400 mb-1">تحتوي كم {draft.baseUnit || 'وحدة'}؟</div>
          <input
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            type="number" min={2} placeholder="مثال: 12" className={inputCls} dir="ltr"
          />
        </div>
        <Btn variant="soft" onClick={add} disabled={!valid}>+ إضافة</Btn>
      </div>
      {/* سعر وباركود الوحدة الأكبر (جولة الصيدلية): سعر العلبة قد لا يساوي المعامل × سعر القطعة */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <div>
          <div className="text-[10.5px] font-bold text-slate-400 mb-1">سعر بيع الـ{name.trim() || 'وحدة الأكبر'} (اختياري)</div>
          <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} type="number" min={0} placeholder={`فارغ = ${f > 1 ? f : 'المعامل'} × سعر الـ${draft.baseUnit || 'وحدة'}`} className={inputCls} dir="ltr" />
        </div>
        <div>
          <div className="text-[10.5px] font-bold text-slate-400 mb-1">باركود الـ{name.trim() || 'وحدة الأكبر'} (اختياري)</div>
          <input value={unitBarcode} onChange={(e) => setUnitBarcode(e.target.value)} placeholder="امسح باركود العلبة/الشريط…" className={inputCls} dir="ltr" />
        </div>
      </div>
      {/* معاينة حية تشرح المعادلة قبل الإضافة */}
      {name.trim() && (
        <div className={`mt-2 text-[11.5px] font-bold px-3 py-2 rounded-xl ${valid ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400' : 'bg-amber-500/10 text-amber-600'}`}>
          {valid
            ? <>✓ يعني: 1 {name} = {f} {draft.baseUnit || 'وحدة'} — وسعر الـ{name} سيُحسب تلقائياً ({f} × سعر الـ{draft.baseUnit || 'وحدة'})</>
            : <>⚠️ اكتب عدد الـ{draft.baseUnit || 'وحدات'} داخل الـ{name} (رقم أكبر من 1)</>}
        </div>
      )}
      {draft.extraUnits.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {draft.extraUnits.map((u, i) => (
            <span key={i} className="anim-pop text-[11px] px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold">
              1 {u.nameAr} = {u.factor} {draft.baseUnit}{u.priceMinor ? ` — بيع ${formatMinor(u.priceMinor, unitCur, false)}` : ''}
              <button onClick={() => p({ extraUnits: draft.extraUnits.filter((_, j) => j !== i) })} className="mr-1 text-rose-400">×</button>
            </span>
          ))}
        </div>
      )}
    </Field>
  )
}
