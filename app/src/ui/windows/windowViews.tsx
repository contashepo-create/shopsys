import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Boxes, PackageSearch, Save, UserRound } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { useWindowHost } from './windowHostContext.ts'
import { openItemLedgerWindow, openPartyLedgerWindow } from './windowStore.ts'

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
  const { items, stockMoves } = useDataStore()
  const item = items.find((row) => row.id === itemId) ?? null
  const rows = useMemo(
    () => stockMoves.filter((move) => move.itemId === itemId).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300),
    [stockMoves, itemId],
  )
  const totalIn = rows.filter((row) => row.qtyDelta > 0).reduce((sum, row) => sum + row.qtyDelta, 0)
  const totalOut = rows.filter((row) => row.qtyDelta < 0).reduce((sum, row) => sum - row.qtyDelta, 0)
  if (!item) return <div className="p-6 text-sm text-slate-500">الصنف غير موجود.</div>
  return (
    <div className="space-y-3 p-5" data-window-view="item-ledger">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="الرصيد الحالي" value={`${item.stockQty ?? 0} ${item.baseUnit}`} />
        <Stat label="إجمالي الوارد" value={String(totalIn)} tone="in" />
        <Stat label="إجمالي المنصرف" value={String(totalOut)} tone="out" />
        <Stat label="متوسط التكلفة" value={`${formatMinor(item.costMinor ?? 0, cur, false)} ${cur.symbol}`} />
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60"><tr><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">المستند</th><th className="p-2">وارد</th><th className="p-2">منصرف</th><th className="p-2">الرصيد بعدها</th><th className="p-2 text-start">المستخدم</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد حركات مسجلة لهذا الصنف بعد.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} data-ledger-row className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2" dir="ltr">{row.date.slice(0, 16).replace('T', ' ')}</td>
                <td className="p-2">{row.reason}</td>
                <td className="p-2 text-center font-bold text-emerald-600">{row.qtyDelta > 0 ? row.qtyDelta : '—'}</td>
                <td className="p-2 text-center font-bold text-rose-600">{row.qtyDelta < 0 ? -row.qtyDelta : '—'}</td>
                <td className="p-2 text-center" dir="ltr">{row.balanceAfter}</td>
                <td className="p-2 text-slate-500">{row.byUser || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">تُعرض آخر 300 حركة. كارت الصنف الكامل بفلاتر الفترة والمخزن موجود في شاشة الأصناف.</p>
    </div>
  )
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
