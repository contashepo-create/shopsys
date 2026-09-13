/** شاشتا العملاء والموردين — نمط موحّد */
import { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Phone, UserRound, Building2 } from 'lucide-react'
import { useDataStore, type Customer, type Supplier } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

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

  const filtered = useMemo(
    () => customers.filter((c) => !query.trim() || c.nameAr.includes(query) || c.phone.includes(query)),
    [customers, query],
  )

  const openNew = () => { setEditing(null); setName(''); setPhone(''); setCreditLimit(''); setNotes(''); setOpen(true) }
  const openEdit = (c: Customer) => {
    setEditing(c); setName(c.nameAr); setPhone(c.phone)
    setCreditLimit(c.creditLimitMinor ? String(c.creditLimitMinor / 10 ** cur.decimals) : '')
    setNotes(c.notes); setOpen(true)
  }
  const save = () => {
    if (!name.trim()) return
    const data = {
      nameAr: name.trim(), phone: phone.trim(),
      creditLimitMinor: creditLimit ? toMinor(creditLimit, cur.decimals) : 0,
      notes: notes.trim(),
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل عميل' : 'عميل جديد'}>
        <div className="space-y-4">
          <Field label="اسم العميل *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus /></Field>
          <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label={`حد الائتمان (${cur.symbol})`} hint="أقصى مديونية مسموحة للبيع الآجل — 0 = بلا حد">
            <input value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} type="number" min={0} className={inputCls} />
          </Field>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
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

  const filtered = useMemo(
    () => suppliers.filter((s) => !query.trim() || s.nameAr.includes(query) || s.phone.includes(query)),
    [suppliers, query],
  )

  const save = () => {
    if (!name.trim()) return
    const data = { nameAr: name.trim(), phone: phone.trim(), notes: notes.trim() }
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
        <Btn onClick={() => { setEditing(null); setName(''); setPhone(''); setNotes(''); setOpen(true) }}>
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
                  <button onClick={() => { setEditing(s); setName(s.nameAr); setPhone(s.phone); setNotes(s.notes); setOpen(true) }} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => { removeSupplier(s.id); toast.show('تم حذف المورد') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل مورد' : 'مورد جديد'}>
        <div className="space-y-4">
          <Field label="اسم المورد *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus /></Field>
          <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn><Btn onClick={save} disabled={!name.trim()}>حفظ</Btn></div>
        </div>
      </Modal>
    </div>
  )
}
