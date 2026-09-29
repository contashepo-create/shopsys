import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Boxes, PackageSearch, Save, UserRound } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { buildItemLedger } from '../../core/itemLedger.ts'
import { useItemLedgerInput } from '../hooks/useItemLedgerInput.ts'
import { ItemSearchPanel, type QuickItem, type QuickItemMeta } from '../components/KeyboardPickers.tsx'
import { resolvePrice, priceSource } from '../../core/priceLists.ts'
import { useWindowHost } from './windowHostContext.ts'
import { openItemEditorWindow, openItemLedgerWindow, openItemPricesWindow, openPartyLedgerWindow } from './windowStore.ts'

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

/* ═══════════ تعديل صنف — نافذة مستقلة تُفتح فوق الفاتورة ═══════════ */
export function ItemEditorWindowView() {
  const host = useWindowHost()
  const itemId = Number(host?.props.itemId ?? 0)
  const cur = useCur()
  const toast = useToast()
  const { items, updateItem } = useDataStore()
  const item = items.find((row) => row.id === itemId) ?? null
  const [form, setForm] = useState(() => ({
    nameAr: item?.nameAr ?? '',
    sku: item?.sku ?? '',
    barcode: item?.barcodes?.[0] ?? '',
    baseUnit: item?.baseUnit ?? 'قطعة',
    price: item ? String(item.priceMinor / 10 ** cur.decimals) : '0',
    minQty: item ? String(item.minQty ?? 0) : '0',
    active: item?.isActive !== false,
  }))
  const patch = (next: Partial<typeof form>) => { setForm((prev) => ({ ...prev, ...next })); host?.setDirty(true) }

  if (!item) return <div className="p-6 text-sm text-slate-500">الصنف غير موجود (ربما حُذف).</div>

  const save = () => {
    try {
      if (!form.nameAr.trim()) throw new Error('اسم الصنف مطلوب')
      updateItem(item.id, {
        nameAr: form.nameAr.trim(),
        sku: form.sku.trim(),
        barcodes: form.barcode.trim() ? [form.barcode.trim(), ...(item.barcodes ?? []).slice(1)] : (item.barcodes ?? []),
        baseUnit: form.baseUnit.trim() || 'قطعة',
        priceMinor: toMinor(form.price || '0', cur.decimals),
        minQty: Number(form.minQty) || 0,
        isActive: form.active,
      })
      host?.setDirty(false)
      toast.show(`حُفظ الصنف «${form.nameAr}» ✅ — الفاتورة المفتوحة لم تتأثر`)
      host?.close()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4 p-5" data-window-view="item-editor">
      <div className="flex items-center gap-3 rounded-2xl bg-brand-500/8 p-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300"><PackageSearch size={18} /></span>
        <div className="min-w-0">
          <b className="block truncate">{item.nameAr}</b>
          <small className="text-slate-500">كود {item.sku || item.id} · متاح {item.stockQty ?? 0} {item.baseUnit} · تكلفة {formatMinor(item.costMinor ?? 0, cur, false)} {cur.symbol}</small>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="اسم الصنف *"><input className={inputCls} value={form.nameAr} onChange={(e) => patch({ nameAr: e.target.value })} aria-label="اسم الصنف" /></Field>
        <Field label="الكود / SKU"><input className={inputCls} value={form.sku} onChange={(e) => patch({ sku: e.target.value })} dir="ltr" /></Field>
        <Field label="الباركود"><input className={inputCls} value={form.barcode} onChange={(e) => patch({ barcode: e.target.value })} dir="ltr" /></Field>
        <Field label="الوحدة"><input className={inputCls} value={form.baseUnit} onChange={(e) => patch({ baseUnit: e.target.value })} /></Field>
        <Field label={`سعر البيع (${cur.symbol})`}><input className={inputCls} value={form.price} onChange={(e) => patch({ price: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        <Field label="حد إعادة الطلب"><input className={inputCls} value={form.minQty} onChange={(e) => patch({ minQty: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active} onChange={(e) => patch({ active: e.target.checked })} /> صنف نشط يظهر في البحث والفواتير</label>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Btn variant="ghost" onClick={() => openItemLedgerWindow(item.id, host?.windowId ?? null)}><Boxes size={14} /> حركة الصنف</Btn>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => host?.close()}>إلغاء</Btn>
          <Btn onClick={save} shortcut="F9"><Save size={14} /> حفظ التعديل</Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══════════ حركة صنف ═══════════ */
export function ItemLedgerWindowView() {
  const host = useWindowHost()
  const itemId = Number(host?.props.itemId ?? 0)
  const cur = useCur()
  const { items, warehouses } = useDataStore()
  const { fiscalYears } = useAppStore()
  const item = items.find((row) => row.id === itemId) ?? null
  const today = new Date().toISOString().slice(0, 10)
  /* الافتراضي المطلوب من المالك: من بداية السنة المالية حتى اليوم */
  const yearStart = useMemo(() => {
    const open = fiscalYears.find((fy) => fy.status === 'open') ?? fiscalYears.at(-1)
    return open?.startDate ?? `${today.slice(0, 4)}-01-01`
  }, [fiscalYears, today])
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [warehouseId, setWarehouseId] = useState(0)
  const [flow, setFlow] = useState<'all' | 'in' | 'out'>('all')
  const [docType, setDocType] = useState('')

  const ledgerInput = useItemLedgerInput(itemId || null)
  const ledger = useMemo(() => {
    if (!ledgerInput) return null
    const scoped = warehouseId
      ? {
          ...ledgerInput,
          purchases: ledgerInput.purchases.filter((p) => (p.warehouseId ?? 0) === warehouseId),
          purchaseReturns: ledgerInput.purchaseReturns.filter((r) => (r.warehouseId ?? 0) === warehouseId),
          sales: ledgerInput.sales.filter((sl) => (sl.warehouseId ?? 0) === warehouseId),
          saleReturns: ledgerInput.saleReturns.filter((r) => (r.warehouseId ?? 0) === warehouseId),
          stocktakes: ledgerInput.stocktakes.filter((st) => (st.warehouseId ?? 0) === warehouseId),
          materialRequisitions: ledgerInput.materialRequisitions.filter((mr) => (mr.warehouseId ?? 0) === warehouseId),
          transfers: (ledgerInput.transfers ?? []).filter((t) => t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId),
        }
      : ledgerInput
    const all = buildItemLedger(scoped)
    const opening = Math.round(((item?.stockQty ?? 0) - (all.totalIn - all.totalOut)) * 1000) / 1000
    return buildItemLedger({ ...scoped, openingQty: opening }, from || undefined, to || undefined)
  }, [ledgerInput, warehouseId, from, to, item])

  const rows = useMemo(
    () => (ledger?.rows ?? []).filter((r) => (flow === 'in' ? r.inQty > 0 : flow === 'out' ? r.outQty > 0 : true))
      .filter((r) => !docType || r.docType === docType)
      .slice().reverse(),
    [ledger, flow, docType],
  )
  const docTypes = useMemo(() => Array.from(new Set((ledger?.rows ?? []).map((r) => r.docType))).sort(), [ledger])
  const totalIn = rows.reduce((sum, r) => sum + r.inQty, 0)
  const totalOut = rows.reduce((sum, r) => sum + r.outQty, 0)
  if (!item) return <div className="p-6 text-sm text-slate-500">الصنف غير موجود.</div>
  return (
    <div className="space-y-3 p-5" data-window-view="item-ledger">
      {/* فلاتر حركة الصنف (دفعة المالك ⑩ي البند ⑦): فترة تبدأ من بداية السنة المالية + مخزن + نوع الحركة + نوع المستند */}
      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40" data-ledger-filters>
        <Field label="من تاريخ">
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} data-ledger-from aria-label="من تاريخ" />
        </Field>
        <Field label="إلى تاريخ">
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} data-ledger-to aria-label="إلى تاريخ" />
        </Field>
        <Field label="المخزن">
          <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))} data-ledger-warehouse aria-label="المخزن">
            <option value={0}>كل المخازن</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
          </select>
        </Field>
        <Field label="نوع الحركة">
          <select className={inputCls} value={flow} onChange={(e) => setFlow(e.target.value as 'all' | 'in' | 'out')} data-ledger-flow aria-label="نوع الحركة">
            <option value="all">الكل</option>
            <option value="in">وارد فقط</option>
            <option value="out">منصرف فقط</option>
          </select>
        </Field>
        <Field label="المستند">
          <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)} data-ledger-doctype aria-label="المستند">
            <option value="">كل المستندات</option>
            {docTypes.map((d) => <option key={d} value={d}>{DOC_LABELS[d] ?? d}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="رصيد أول المدة" value={`${ledger?.openingQty ?? 0} ${item.baseUnit}`} />
        <Stat label="إجمالي الوارد" value={String(totalIn)} tone="in" />
        <Stat label="إجمالي المنصرف" value={String(totalOut)} tone="out" />
        <Stat label={warehouseId ? 'رصيد المخزن الحالي' : 'الرصيد الحالي'} value={`${ledger?.closingQty ?? item.stockQty ?? 0} ${item.baseUnit}`} />
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">المستند</th><th className="p-2 text-center">وارد</th><th className="p-2 text-center">منصرف</th><th className="p-2 text-center">الرصيد</th><th className="p-2 text-start">القيمة</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد حركات في النطاق المحدد.</td></tr>}
            {rows.map((row, idx) => (
              <tr key={`${row.date}-${row.docLabel}-${idx}`} data-ledger-row className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2" dir="ltr">{row.date}</td>
                <td className="p-2">{row.docLabel}{row.userName ? ` — ${row.userName}` : ''}</td>
                <td className="p-2 text-center font-bold text-emerald-600">{row.inQty || '—'}</td>
                <td className="p-2 text-center font-bold text-rose-600">{row.outQty || '—'}</td>
                <td className="p-2 text-center" dir="ltr">{row.balance}</td>
                <td className="p-2 text-slate-500">{formatMinor(row.valueMinor, cur, false)} {cur.symbol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">دفتر الحركة مبني من المستندات نفسها (شراء · بيع · مرتجعات · جرد · إنتاج · تحويلات)، فلا تفوت حركة.</p>
    </div>
  )
}

const DOC_LABELS: Record<string, string> = {
  purchase: 'فاتورة شراء', sale: 'فاتورة بيع', purchase_return: 'مرتجع شراء', sale_return: 'مرتجع بيع',
  stocktake: 'جرد', production: 'إنتاج', processing: 'تجهيز/تفكيك', material_issue: 'صرف مواد',
  transfer_in: 'تحويل وارد', transfer_out: 'تحويل منصرف', opening: 'رصيد افتتاحي',
}

/* ═══════════ تعديل عميل/مورد ═══════════ */
export function PartyEditorWindowView() {
  const host = useWindowHost()
  const partyKind = (host?.props.partyKind as 'customer' | 'supplier') ?? 'customer'
  const partyId = Number(host?.props.partyId ?? 0)
  const cur = useCur()
  const toast = useToast()
  const { customers, suppliers, updateCustomer, updateSupplier, getCustomerBalance, getSupplierBalance } = useDataStore()
  const party = partyKind === 'customer' ? customers.find((row) => row.id === partyId) : suppliers.find((row) => row.id === partyId)
  const [form, setForm] = useState(() => ({
    nameAr: party?.nameAr ?? '',
    phone: party?.phone ?? '',
    email: party?.email ?? '',
    taxNumber: party?.taxNumber ?? '',
    address: party?.address ?? '',
    city: party?.city ?? '',
    notes: party?.notes ?? '',
    creditLimit: partyKind === 'customer' && party && 'creditLimitMinor' in party ? String((party.creditLimitMinor ?? 0) / 10 ** cur.decimals) : '0',
  }))
  const patch = (next: Partial<typeof form>) => { setForm((prev) => ({ ...prev, ...next })); host?.setDirty(true) }
  if (!party) return <div className="p-6 text-sm text-slate-500">الحساب غير موجود.</div>
  const balance = partyKind === 'customer' ? getCustomerBalance(party.id) : getSupplierBalance(party.id)

  const save = () => {
    try {
      if (!form.nameAr.trim()) throw new Error('الاسم مطلوب')
      const base = { nameAr: form.nameAr.trim(), phone: form.phone.trim(), email: form.email.trim(), taxNumber: form.taxNumber.trim(), address: form.address.trim(), city: form.city.trim(), notes: form.notes }
      if (partyKind === 'customer') updateCustomer(party.id, { ...base, creditLimitMinor: toMinor(form.creditLimit || '0', cur.decimals) })
      else updateSupplier(party.id, base)
      host?.setDirty(false)
      toast.show('حُفظت بيانات الحساب ✅ — الفاتورة المفتوحة لم تتأثر')
      host?.close()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4 p-5" data-window-view="party-editor">
      <div className="flex items-center gap-3 rounded-2xl bg-brand-500/8 p-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300"><UserRound size={18} /></span>
        <div className="min-w-0">
          <b className="block truncate">{party.nameAr}</b>
          <small className="text-slate-500">{partyCode(partyKind === 'customer' ? 'CUS' : 'SUP', party.id)} · الرصيد {formatMinor(Math.abs(balance), cur, false)} {cur.symbol} {balance > 0 ? 'عليه' : balance < 0 ? 'له' : 'متزن'}</small>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="الاسم *"><input className={inputCls} value={form.nameAr} onChange={(e) => patch({ nameAr: e.target.value })} aria-label="اسم الحساب" /></Field>
        <Field label="الهاتف"><input className={inputCls} value={form.phone} onChange={(e) => patch({ phone: e.target.value })} dir="ltr" /></Field>
        <Field label="البريد"><input className={inputCls} value={form.email} onChange={(e) => patch({ email: e.target.value })} dir="ltr" /></Field>
        <Field label="الرقم الضريبي"><input className={inputCls} value={form.taxNumber} onChange={(e) => patch({ taxNumber: e.target.value })} dir="ltr" /></Field>
        <Field label="العنوان"><input className={inputCls} value={form.address} onChange={(e) => patch({ address: e.target.value })} /></Field>
        <Field label="المدينة"><input className={inputCls} value={form.city} onChange={(e) => patch({ city: e.target.value })} /></Field>
        {partyKind === 'customer' && <Field label={`الحد الائتماني (${cur.symbol})`}><input className={inputCls} value={form.creditLimit} onChange={(e) => patch({ creditLimit: e.target.value })} inputMode="decimal" dir="ltr" /></Field>}
      </div>
      <Field label="ملاحظات"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Btn variant="ghost" onClick={() => openPartyLedgerWindow(partyKind, party.id, host?.windowId ?? null)}>كشف الحساب</Btn>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => host?.close()}>إلغاء</Btn>
          <Btn onClick={save} shortcut="F9"><Save size={14} /> حفظ التعديل</Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══════════ كشف حساب عميل/مورد ═══════════ */
export function PartyLedgerWindowView() {
  const host = useWindowHost()
  const partyKind = (host?.props.partyKind as 'customer' | 'supplier') ?? 'customer'
  const partyId = Number(host?.props.partyId ?? 0)
  const cur = useCur()
  const { customers, suppliers, getCustomerStatementRows, getSupplierStatementRows, getCustomerBalance, getSupplierBalance } = useDataStore()
  const party = partyKind === 'customer' ? customers.find((row) => row.id === partyId) : suppliers.find((row) => row.id === partyId)
  const rows = partyKind === 'customer' ? getCustomerStatementRows(partyId) : getSupplierStatementRows(partyId)
  const balance = partyKind === 'customer' ? getCustomerBalance(partyId) : getSupplierBalance(partyId)
  if (!party) return <div className="p-6 text-sm text-slate-500">الحساب غير موجود.</div>
  return (
    <div className="space-y-3 p-5" data-window-view="party-ledger">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="الحساب" value={party.nameAr} />
        <Stat label="عدد الحركات" value={String(rows.length)} />
        <Stat label={balance > 0 ? (partyKind === 'customer' ? 'مطلوب من العميل' : 'مستحق للمورد') : 'الرصيد'} value={`${formatMinor(Math.abs(balance), cur, false)} ${cur.symbol}`} tone={balance > 0 ? 'out' : 'in'} />
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">المستند</th><th className="p-2">عليه</th><th className="p-2">له</th><th className="p-2">الرصيد</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">لا توجد حركات على هذا الحساب بعد.</td></tr>}
            {rows.map((row, index) => (
              <tr key={`${row.date}-${index}`} data-statement-row className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2" dir="ltr">{row.date}</td>
                <td className="p-2">{row.docLabel}</td>
                <td className="p-2 text-center" dir="ltr">{row.debitMinor ? formatMinor(row.debitMinor, cur, false) : '—'}</td>
                <td className="p-2 text-center" dir="ltr">{row.creditMinor ? formatMinor(row.creditMinor, cur, false) : '—'}</td>
                <td className="p-2 text-center font-bold" dir="ltr">{formatMinor(row.balanceMinor, cur, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-card-dark">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`flex items-center gap-1 text-sm font-black ${tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-rose-600' : ''}`} dir="auto">
        {tone === 'in' && <ArrowDownLeft size={14} />}{tone === 'out' && <ArrowUpRight size={14} />}{value}
      </div>
    </div>
  )
}

/* ═══════════ اختيار صنف — نافذة أم لنوافذ التعديل/الحركة/الأسعار ═══════════ */
export function ItemPickerWindowView() {
  const host = useWindowHost()
  const props = host?.props ?? {}
  const items = (props.items as QuickItem[] | undefined) ?? []
  const itemMeta = props.itemMeta as ((item: QuickItem) => QuickItemMeta) | undefined
  const categories = props.categories as { id: number; nameAr: string }[] | undefined
  const amountLabel = props.amountLabel as ((item: QuickItem) => string) | undefined
  const onCreate = props.onCreate as ((name: string) => void) | undefined
  const onPick = props.onPick as ((id: number) => void) | undefined
  const initialQuery = String(props.initialQuery ?? '')
  /* القائمة تُحدَّث حيّاً بعد التعديل في النافذة الابنة */
  const liveItems = useDataStore((state) => state.items)
  const merged = items.map((row) => {
    const live = liveItems.find((entry) => entry.id === row.id)
    return live ? { ...row, nameAr: live.nameAr, sku: live.sku, stockQty: live.stockQty, priceMinor: live.priceMinor, costMinor: live.costMinor, baseUnit: live.baseUnit } : row
  })
  return (
    <div className="flex h-full min-h-0 flex-col" data-window-view="item-picker">
      <ItemSearchPanel
        items={merged}
        itemMeta={itemMeta}
        categories={categories}
        amountLabel={amountLabel}
        onCreate={onCreate}
        initialQuery={initialQuery}
        onEscape={() => host?.close()}
        onPick={(id) => { onPick?.(id); host?.close() }}
        onEdit={(id) => openItemEditorWindow(id, host?.windowId ?? null)}
        onMovement={(id) => openItemLedgerWindow(id, host?.windowId ?? null)}
        onPrices={(id) => openItemPricesWindow(id, host?.windowId ?? null)}
      />
    </div>
  )
}

/* ═══════════ أسعار الصنف — القطاعي والتكلفة والهامش وقوائم الأسعار ═══════════ */
export function ItemPricesWindowView() {
  const host = useWindowHost()
  const itemId = Number(host?.props.itemId ?? 0)
  const cur = useCur()
  const { items, categories, priceLists, priceListEntries, priceListCategoryRules, purchases } = useDataStore()
  const item = items.find((row) => row.id === itemId) ?? null
  const money = (value: number) => formatMinor(value, cur)
  const lastPurchase = (() => {
    if (!item) return null
    for (let index = purchases.length - 1; index >= 0; index--) {
      const line = purchases[index].lines.find((row) => row.itemId === item.id)
      if (line) return { date: purchases[index].date, priceMinor: line.landedUnitCostMinor || line.unitPriceMinor, qty: line.qty }
    }
    return null
  })()
  if (!item) return <div className="p-6 text-sm text-slate-500">الصنف غير موجود (ربما حُذف).</div>
  const retail = item.priceMinor ?? 0
  const cost = item.costMinor ?? 0
  const marginMinor = retail - cost
  const marginPercent = cost > 0 ? Math.round((marginMinor / cost) * 1000) / 10 : null
  const categoryName = categories.find((cat) => cat.id === item.categoryId)?.nameAr ?? '—'
  const rows = priceLists.map((list) => {
    const price = resolvePrice(item.id, retail, list.id, priceLists, priceListEntries, priceListCategoryRules, item.categoryId ?? null)
    const source = priceSource(item.id, list.id, priceLists, priceListEntries, priceListCategoryRules, item.categoryId ?? null)
    const rule = priceListCategoryRules.find((entry) => entry.listId === list.id && entry.categoryId === (item.categoryId ?? 0))
    return { list, price, source, rule }
  })
  const sourceLabel: Record<string, string> = { item: 'سعر خاص للصنف', category: 'خصم فئة', list: 'خصم القائمة', retail: 'سعر التجزئة' }
  return (
    <div className="space-y-4 p-5" data-window-view="item-prices">
      <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/8 p-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><PackageSearch size={18} /></span>
        <div className="min-w-0">
          <b className="block truncate">{item.nameAr}</b>
          <small className="text-slate-500">كود {item.sku || item.id} · فئة {categoryName} · وحدة {item.baseUnit}</small>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4" data-item-prices-summary>
        <div className="rounded-xl border border-slate-200 p-2.5 text-center dark:border-slate-700"><small className="block text-slate-500">سعر التجزئة</small><b className="text-base text-brand-600">{money(retail)}</b></div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-center dark:border-slate-700"><small className="block text-slate-500">التكلفة</small><b className="text-base">{money(cost)}</b></div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-center dark:border-slate-700"><small className="block text-slate-500">الهامش</small><b className={`text-base ${marginMinor < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(marginMinor)}</b></div>
        <div className="rounded-xl border border-slate-200 p-2.5 text-center dark:border-slate-700"><small className="block text-slate-500">نسبة الهامش</small><b className={`text-base ${marginPercent != null && marginPercent < 0 ? 'text-rose-600' : ''}`}>{marginPercent == null ? '—' : `${marginPercent}%`}</b></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm" data-item-prices-table>
          <thead className="bg-slate-50 text-[11px] font-black text-slate-500 dark:bg-slate-800/60">
            <tr><th className="p-2 text-right">قائمة الأسعار</th><th className="p-2">السعر للصنف</th><th className="p-2">مصدر السعر</th><th className="p-2">خصم فئة «{categoryName}»</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(({ list, price, source, rule }) => (
              <tr key={list.id} className="border-t border-slate-100 text-center dark:border-slate-800" data-item-prices-row>
                <td className="p-2 text-right font-bold">{list.nameAr}{!list.isActive && <small className="ms-1 text-rose-500">(موقوفة)</small>}</td>
                <td className="p-2 font-black tabular-nums">{money(price)}</td>
                <td className="p-2 text-[11px] text-slate-500">{sourceLabel[source] ?? source}</td>
                <td className="p-2 text-[11px]">{rule ? `${rule.discountPercent}%` : <span className="text-slate-400">—</span>}</td>
              </tr>
            )) : <tr><td colSpan={4} className="p-4 text-center text-sm text-slate-400">لا قوائم أسعار — سعر التجزئة يسري على الجميع</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-slate-200 p-3 text-[12px] dark:border-slate-700">
        <b className="text-slate-600 dark:text-slate-300">آخر شراء: </b>
        {lastPurchase ? <span>{money(lastPurchase.priceMinor)} للوحدة · كمية {lastPurchase.qty} · بتاريخ {lastPurchase.date}</span> : <span className="text-slate-400">لا مشتريات مسجلة لهذا الصنف</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Btn variant="ghost" onClick={() => openItemEditorWindow(item.id, host?.windowId ?? null)}><PackageSearch size={14} /> تعديل سعر الصنف</Btn>
        <Btn variant="ghost" onClick={() => host?.close()}>إغلاق</Btn>
      </div>
    </div>
  )
}
