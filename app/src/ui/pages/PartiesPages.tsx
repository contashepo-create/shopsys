/**
 * شاشتا العملاء والموردين — نمط موحّد
 * البيانات الموسعة كلها اختيارية (طلب المالك) لكنها جاهزة للفاتورة الضريبية
 * (السعودية تتطلب: رقم ضريبي، سجل تجاري، عنوان وطني كامل)
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Trash2, Phone, UserRound, Building2, ChevronDown, FileBadge, FileSpreadsheet, LayoutGrid, List } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Customer, type Supplier, type PartyExtended } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { supplierStatement, statementBalance } from '../../core/statements.ts'
import { partyCode, matchesPartyCode } from '../../core/partyCodes.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

/** مبدّل عرض بطاقات/قائمة (طلب المالك) — مشترك بين العملاء والموردين */
function ViewToggle({ view, setView }: { view: 'cards' | 'list'; setView: (v: 'cards' | 'list') => void }) {
  return (
    <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
      <button title="عرض بطاقات" onClick={() => setView('cards')} className={`px-3 py-2 transition-colors ${view === 'cards' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
        <LayoutGrid size={15} />
      </button>
      <button title="عرض قائمة" onClick={() => setView('list')} className={`px-3 py-2 transition-colors ${view === 'list' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
        <List size={15} />
      </button>
    </div>
  )
}

/** شارة الرصيد بجانب الاسم (طلب المالك) — تظهر في البطاقات والقائمة */
function BalanceBadge({ balance, fmt, positive, negative }: { balance: number; fmt: (m: number) => string; positive: string; negative: string }) {
  if (balance === 0) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold w-fit">رصيد صفر</span>
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold w-fit ${balance > 0 ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
      {balance > 0 ? positive : negative}: {fmt(Math.abs(balance))}
    </span>
  )
}

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
  const { customers, addCustomer, updateCustomer, removeCustomer, sales, saleReturns, vouchers, cheques, clientSettlements, getCustomerBalance } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [query, setQuery] = useState('')
  const [view, setView] = useState<'cards' | 'list'>('cards')

  // رصيد كل عميل بجانب اسمه (طلب المالك) — الرصيد الموحّد من كل الأنشطة (إصلاح الترابط)
  const balances = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of customers) map.set(c.id, getCustomerBalance(c.id))
    return map
  }, [customers, sales, saleReturns, vouchers, cheques, clientSettlements, getCustomerBalance])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [notes, setNotes] = useState('')
  const [ext, setExt] = useState<PartyExtended>(EMPTY_EXTENDED)

  const filtered = useMemo(
    // البحث بالكود (طلب المالك): CUS-0001 أو 1 — أسرع وأدق
    () => customers.filter((c) => !query.trim() || c.nameAr.includes(query) || c.phone.includes(query) || matchesPartyCode(query, 'CUS', c.id)),
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الكود (CUS-0001 أو 1)…" className={`${inputCls} pr-10`} />
        </div>
        <ViewToggle view={view} setView={setView} />
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> عميل جديد</span></Btn>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="👥" title={customers.length ? 'لا نتائج' : 'لا عملاء بعد'} sub="أضف عملاءك ليعمل البيع الآجل والأقساط وكشوف الحساب" />
        </div>
      ) : view === 'cards' ? (
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
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <BalanceBadge balance={balances.get(c.id) ?? 0} fmt={fmt} positive="عليه" negative="له" />
                    {c.creditLimitMinor > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold w-fit">
                        حد ائتمان: {formatMinor(c.creditLimitMinor, cur)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {/* كشف حساب فوري بجانب كل عميل (طلب المالك) */}
                  <button title="كشف حساب العميل" onClick={() => navigate(`/reports/statements?kind=customer&id=${c.id}`)} className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-colors"><FileSpreadsheet size={14} /></button>
                  <button title="تعديل بيانات العميل" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                  <button title="حذف العميل" onClick={() => { removeCustomer(c.id); toast.show('تم حذف العميل') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* عرض القائمة (طلب المالك): صفوف مدمجة بالرصيد بجانب الاسم */
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الكود</th>
                <th className="px-4 py-3 font-bold">العميل</th>
                <th className="px-4 py-3 font-bold">الهاتف</th>
                <th className="px-4 py-3 font-bold">الرصيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const bal = balances.get(c.id) ?? 0
                return (
                  <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-violet-500/[0.03] transition-colors">
                    <td className="px-4 py-2.5"><span className="font-mono font-black text-[11px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300" dir="ltr">{partyCode('CUS', c.id)}</span></td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-white">{c.nameAr}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-[12px]" dir="ltr">{c.phone || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-black ${bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {bal === 0 ? '0' : `${fmt(Math.abs(bal))} ${bal > 0 ? 'عليه' : 'له'}`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-left">
                      <span className="flex gap-0.5 justify-end">
                        <button title="كشف حساب العميل" onClick={() => navigate(`/reports/statements?kind=customer&id=${c.id}`)} className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-colors"><FileSpreadsheet size={14} /></button>
                        <button title="تعديل" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                        <button title="حذف" onClick={() => { removeCustomer(c.id); toast.show('تم حذف العميل') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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

const SUPPLIER_CATEGORIES = ['مواد بناء', 'بضاعة تجارية', 'قطع غيار', 'مقاول باطن', 'خدمات ونقل', 'أخرى']

export function SuppliersPage() {
  const { suppliers, addSupplier, updateSupplier, removeSupplier, purchases, purchaseReturns, vouchers, cheques } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'cards' | 'list'>('cards')

  // رصيد كل مورد بجانب اسمه (طلب المالك) — موجب = مستحق له عندك
  const balances = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of suppliers) {
      map.set(s.id, statementBalance(supplierStatement({ supplierId: s.id, purchases, purchaseReturns, allPurchases: purchases, vouchers, cheques })))
    }
    return map
  }, [suppliers, purchases, purchaseReturns, vouchers, cheques])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [ext, setExt] = useState<PartyExtended>(EMPTY_EXTENDED)
  /* مركز الموردين (أمر التعديل) — كلها اختيارية */
  const [contactPerson, setContactPerson] = useState('')
  const [category, setCategory] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [bankName, setBankName] = useState('')
  const [iban, setIban] = useState('')

  const filtered = useMemo(
    () => suppliers.filter((s) => !query.trim() || s.nameAr.includes(query) || s.phone.includes(query) || (s.category ?? '').includes(query) || matchesPartyCode(query, 'SUP', s.id)),
    [suppliers, query],
  )

  const save = () => {
    if (!name.trim()) return
    const data = {
      nameAr: name.trim(), phone: phone.trim(), notes: notes.trim(), ...ext,
      contactPerson: contactPerson.trim(), category, paymentTermsDays: Number(paymentTerms) || 0,
      bankName: bankName.trim(), iban: iban.trim(), active: true,
    }
    if (editing) { updateSupplier(editing.id, data); toast.show('تم تعديل المورد') }
    else { addSupplier(data); toast.show(`تم إضافة المورد «${data.nameAr}»`) }
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الكود (SUP-0001)…" className={`${inputCls} pr-10`} />
        </div>
        <ViewToggle view={view} setView={setView} />
        <Btn onClick={() => { setEditing(null); setName(''); setPhone(''); setNotes(''); setExt(EMPTY_EXTENDED); setContactPerson(''); setCategory(''); setPaymentTerms(''); setBankName(''); setIban(''); setOpen(true) }}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> مورد جديد</span>
        </Btn>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚛" title={suppliers.length ? 'لا نتائج' : 'لا موردين بعد'} sub="أضف مورديك لتعمل فواتير الشراء وكشوف حساباتهم" />
        </div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s, i) => (
            <div key={s.id} style={{ animationDelay: `${i * 40}ms` }} className="anim-up group p-4 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 hover:border-cyan-400/50 hover:shadow-lg transition-all duration-200">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110">
                  <Building2 size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 dark:text-white truncate">{s.nameAr}</div>
                  {s.phone && <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><Phone size={10} /> {s.phone}{s.contactPerson && ` · ${s.contactPerson}`}</div>}
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <BalanceBadge balance={balances.get(s.id) ?? 0} fmt={fmt} positive="مستحق له" negative="لك عنده" />
                    {s.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 font-bold">{s.category}</span>}
                    {(s.paymentTermsDays ?? 0) > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold">سداد {s.paymentTermsDays} يوماً</span>}
                  </div>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {/* كشف حساب فوري بجانب كل مورد (طلب المالك) */}
                  <button title="كشف حساب المورد" onClick={() => navigate(`/reports/statements?kind=supplier&id=${s.id}`)} className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-colors"><FileSpreadsheet size={14} /></button>
                  <button title="تعديل بيانات المورد" onClick={() => { setEditing(s); setName(s.nameAr); setPhone(s.phone); setNotes(s.notes); setExt({ taxNumber: s.taxNumber, commercialReg: s.commercialReg, email: s.email, address: s.address, city: s.city, postalCode: s.postalCode, buildingNo: s.buildingNo, nationalId: s.nationalId }); setContactPerson(s.contactPerson ?? ''); setCategory(s.category ?? ''); setPaymentTerms(s.paymentTermsDays ? String(s.paymentTermsDays) : ''); setBankName(s.bankName ?? ''); setIban(s.iban ?? ''); setOpen(true) }} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                  <button title="حذف المورد" onClick={() => { removeSupplier(s.id); toast.show('تم حذف المورد') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* عرض القائمة (طلب المالك) */
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الكود</th>
                <th className="px-4 py-3 font-bold">المورد</th>
                <th className="px-4 py-3 font-bold">الهاتف</th>
                <th className="px-4 py-3 font-bold">التصنيف</th>
                <th className="px-4 py-3 font-bold">الرصيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const bal = balances.get(s.id) ?? 0
                return (
                  <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-cyan-500/[0.03] transition-colors">
                    <td className="px-4 py-2.5"><span className="font-mono font-black text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" dir="ltr">{partyCode('SUP', s.id)}</span></td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-white">{s.nameAr}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-[12px]" dir="ltr">{s.phone || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-[12px]">{s.category || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-black ${bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {bal === 0 ? '0' : `${fmt(Math.abs(bal))} ${bal > 0 ? 'مستحق له' : 'لك عنده'}`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-left">
                      <span className="flex gap-0.5 justify-end">
                        <button title="كشف حساب المورد" onClick={() => navigate(`/reports/statements?kind=supplier&id=${s.id}`)} className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-colors"><FileSpreadsheet size={14} /></button>
                        <button title="تعديل" onClick={() => { setEditing(s); setName(s.nameAr); setPhone(s.phone); setNotes(s.notes); setExt({ taxNumber: s.taxNumber, commercialReg: s.commercialReg, email: s.email, address: s.address, city: s.city, postalCode: s.postalCode, buildingNo: s.buildingNo, nationalId: s.nationalId }); setContactPerson(s.contactPerson ?? ''); setCategory(s.category ?? ''); setPaymentTerms(s.paymentTermsDays ? String(s.paymentTermsDays) : ''); setBankName(s.bankName ?? ''); setIban(s.iban ?? ''); setOpen(true) }} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-colors"><Pencil size={14} /></button>
                        <button title="حذف" onClick={() => { removeSupplier(s.id); toast.show('تم حذف المورد') }} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={14} /></button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل مورد' : 'مورد جديد'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم المورد *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus /></Field>
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="مسؤول التواصل"><input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputCls} placeholder="أ. محمود — مدير المبيعات" /></Field>
            <Field label="تصنيف المورد">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                <option value="">— بلا تصنيف —</option>
                {SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="شروط السداد (أيام)" hint="0 أو فارغ = نقدي؛ 30 = فاتورة تستحق بعد شهر">
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} inputMode="numeric" className={inputCls} dir="ltr" />
            </Field>
            <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
            <Field label="اسم البنك"><input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} /></Field>
            <Field label="IBAN / رقم الحساب"><input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} dir="ltr" placeholder="EG…" /></Field>
          </div>
          <ExtendedFields ext={ext} setExt={setExt} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn><Btn onClick={save} disabled={!name.trim()}>حفظ</Btn></div>
        </div>
      </Modal>
    </div>
  )
}
