/**
 * شاشتا العملاء والموردين — نمط موحّد
 * البيانات الموسعة كلها اختيارية (طلب المالك) لكنها جاهزة للفاتورة الضريبية
 * (السعودية تتطلب: رقم ضريبي، سجل تجاري، عنوان وطني كامل)
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Phone, UserRound, Building2, ChevronDown, FileBadge } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Customer, type Supplier, type PartyExtended } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

/** قسم البيانات الموسعة القابل للطي — مشترك بين العملاء والموردين والموظفين */
function ExtendedFields({ ext, setExt }: { ext: PartyExtended; setExt: (e: PartyExtended) => void }) {
  const [open, setOpen] = useState(false)
  const filledCount = Object.values(ext).filter(Boolean).length
  const p = (patch: Partial<PartyExtended>) => setExt({ ...ext, ...patch })
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200"
      >
        <FileBadge size={15} className="text-brand-500" />
        <span className="flex-1 text-right">بيانات إضافية (اختيارية — مطلوبة للفاتورة الضريبية)</span>
        {filledCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">{filledCount} مكتمل</span>}
        <ChevronDown size={15} className={`opacity-50 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="p-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="الرقم الضريبي (VAT)" hint="إلزامي في السعودية للفاتورة الضريبية B2B">
              <input value={ext.taxNumber} onChange={(e) => p({ taxNumber: e.target.value })} className={inputCls} dir="ltr" placeholder="3XXXXXXXXXXXXXX" />
            </Field>
            <Field label="السجل التجاري">
              <input value={ext.commercialReg} onChange={(e) => p({ commercialReg: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="البريد الإلكتروني">
              <input value={ext.email} onChange={(e) => p({ email: e.target.value })} className={inputCls} dir="ltr" type="email" />
            </Field>
            <Field label="الهوية / الإقامة (للأفراد)">
              <input value={ext.nationalId} onChange={(e) => p({ nationalId: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="العنوان (الشارع / الحي)">
              <input value={ext.address} onChange={(e) => p({ address: e.target.value })} className={inputCls} />
            </Field>
            <Field label="المدينة">
              <input value={ext.city} onChange={(e) => p({ city: e.target.value })} className={inputCls} />
            </Field>
            <Field label="الرمز البريدي">
              <input value={ext.postalCode} onChange={(e) => p({ postalCode: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="رقم المبنى (العنوان الوطني)">
              <input value={ext.buildingNo} onChange={(e) => p({ buildingNo: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CustomersPage() {
  const { customers, addCustomer, updateCustomer, removeCustomer } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [notes, setNotes] = useState('')
  const [ext, setExt] = useState<PartyExtended>(EMPTY_EXTENDED)

  const filtered = useMemo(
    () => customers.filter((c) => !query.trim() || c.nameAr.includes(query) || c.phone.includes(query)),
    [customers, query],
  )

  const openNew = () => { setEditing(null); setName(''); setPhone(''); setCreditLimit(''); setNotes(''); setExt(EMPTY_EXTENDED); setOpen(true) }
  const openEdit = (c: Customer) => {
    setEditing(c); setName(c.nameAr); setPhone(c.phone)
    setCreditLimit(c.creditLimitMinor ? String(c.creditLimitMinor / 10 ** cur.decimals) : '')
    setNotes(c.notes)
    setExt({
      taxNumber: c.taxNumber, commercialReg: c.commercialReg, email: c.email, address: c.address,
      city: c.city, postalCode: c.postalCode, buildingNo: c.buildingNo, nationalId: c.nationalId,
    })
    setOpen(true)
  }
  const save = () => {
    if (!name.trim()) return
    const data = {
      nameAr: name.trim(), phone: phone.trim(),
      creditLimitMinor: creditLimit ? toMinor(creditLimit, cur.decimals) : 0,
      notes: notes.trim(),
      ...ext,
    }
    if (editing) { updateCustomer(editing.id, data); toast.show('تم تعديل العميل') }
    else { addCustomer(data); toast.show(`تم إضافة العميل «${data.nameAr}»`) }
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف…" className={`${inputCls} pr-10`} />
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> عميل جديد</span></Btn>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="👥" title={customers.length ? 'لا نتائج' : 'لا عملاء بعد'} sub="أضف عملاءك ليعمل البيع الآجل والأقساط وكشوف الحساب" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c, i) => (
            <div key={c.id} style={{ animationDelay: `${i * 40}ms` }} className="anim-up group p-4 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 hover:border-violet-400/50 hover:shadow-lg transition-all duration-200">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110">
                  <UserRound size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 dark:text-white truncate">{c.nameAr}</div>
                  {c.phone && <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Phone size={10} /> {c.phone}</div>}
                  {c.creditLimitMinor > 0 && (
                    <div className="text-[10px] mt-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold w-fit">
                      حد ائتمان: {formatMinor(c.creditLimitMinor, cur)}
                    </div>
                  )}
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => { removeCustomer(c.id); toast.show('تم حذف العميل') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل عميل' : 'عميل جديد'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم العميل *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label={`حد الائتمان (${cur.symbol})`} hint="أقصى مديونية مسموحة للبيع الآجل — 0 = بلا حد">
              <input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} type="number" min={0} className={inputCls} />
            </Field>
            <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          </div>
          <ExtendedFields ext={ext} setExt={setExt} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn><Btn onClick={save} disabled={!name.trim()}>حفظ</Btn></div>
        </div>
      </Modal>
    </div>
  )
}

export function SuppliersPage() {
  const { suppliers, addSupplier, updateSupplier, removeSupplier } = useDataStore()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [ext, setExt] = useState<PartyExtended>(EMPTY_EXTENDED)

  const filtered = useMemo(
    () => suppliers.filter((s) => !query.trim() || s.nameAr.includes(query) || s.phone.includes(query)),
    [suppliers, query],
  )

  const save = () => {
    if (!name.trim()) return
    const data = { nameAr: name.trim(), phone: phone.trim(), notes: notes.trim(), ...ext }
    if (editing) { updateSupplier(editing.id, data); toast.show('تم تعديل المورد') }
    else { addSupplier(data); toast.show(`تم إضافة المورد «${data.nameAr}»`) }
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث…" className={`${inputCls} pr-10`} />
        </div>
        <Btn onClick={() => { setEditing(null); setName(''); setPhone(''); setNotes(''); setExt(EMPTY_EXTENDED); setOpen(true) }}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> مورد جديد</span>
        </Btn>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚛" title={suppliers.length ? 'لا نتائج' : 'لا موردين بعد'} sub="أضف مورديك لتعمل فواتير الشراء وكشوف حساباتهم" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s, i) => (
            <div key={s.id} style={{ animationDelay: `${i * 40}ms` }} className="anim-up group p-4 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 hover:border-cyan-400/50 hover:shadow-lg transition-all duration-200">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110">
                  <Building2 size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 dark:text-white truncate">{s.nameAr}</div>
                  {s.phone && <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Phone size={10} /> {s.phone}</div>}
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button onClick={() => { setEditing(s); setName(s.nameAr); setPhone(s.phone); setNotes(s.notes); setExt({ taxNumber: s.taxNumber, commercialReg: s.commercialReg, email: s.email, address: s.address, city: s.city, postalCode: s.postalCode, buildingNo: s.buildingNo, nationalId: s.nationalId }); setOpen(true) }} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => { removeSupplier(s.id); toast.show('تم حذف المورد') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل مورد' : 'مورد جديد'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم المورد *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          </div>
          <ExtendedFields ext={ext} setExt={setExt} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn><Btn onClick={save} disabled={!name.trim()}>حفظ</Btn></div>
        </div>
      </Modal>
    </div>
  )
}
