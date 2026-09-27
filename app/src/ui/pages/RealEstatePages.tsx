import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * صفحات نشاط العقارات (النشاط 21) — معايير سند/الوسيط/سمات السعودية:
 * - PropertiesPage: عقارات (مملوكة/مدارة بسعي) بوحدات، حسابات الملاك وسدادهم،
 *   صيانة الوحدات (على المكتب أو المالك)، وبيع العقار المملوك.
 * - LeasesPage: عقود إيجار بجدول أقساط تلقائي وتأمين مسترد ورقم توثيق إيجار،
 *   تحصيل الأقساط، تنبيهات الانتهاء والتأخير، وإنهاء/إخلاء برد التأمين.
 */
import { useMemo, useState } from 'react'
import { Plus, Building2, HandCoins, Wrench, Tag, Eye, DoorOpen, KeyRound, BellRing, ReceiptText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  PROPERTY_KIND_LABELS, RENT_FREQUENCY_LABELS, collectLeaseAlerts, leaseEndDate,
  type PropertyKind, type PropertyOwnership, type RentFrequency, type Property, type PropertyUnit, type Lease,
} from '../../core/realestate.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
const emptyTerminalPayment = (): TerminalPaymentDraft => ({ terminalId: '', providerReference: '', cardLast4: '' })
type InitialUnitDraft = { code: string; rent: string; cost: string; salePrice: string }

function useCur() {
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  return { cur, fmt }
}

/* ─────────────────────────── العقارات والملاك ─────────────────────────── */
export function PropertiesPage() {
  const { properties, propertyUnits, employees, customers, addProperty, addPropertyUnit, sellPropertyUnits, getOwnerBalance, payPropertyOwner, addUnitMaintenance, sellProperty, addStaffCommission } = useDataStore()
  const { cur, fmt } = useCur()
  const toast = useToast()

  /* عقار جديد */
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [kind, setKind] = useState<PropertyKind>('residential')
  const [ownership, setOwnership] = useState<PropertyOwnership>('owned')
  const [ownerName, setOwnerName] = useState('')
  const [commission, setCommission] = useState('5')
  const [address, setAddress] = useState('')
  const [cost, setCost] = useState('')
  const [payMode, setPayMode] = useState<'cash' | 'credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [initialUnits, setInitialUnits] = useState<InitialUnitDraft[]>([{ code: '', rent: '', cost: '', salePrice: '' }])

  const saveProperty = () => {
    try {
      const unitRows = initialUnits.filter((unit) => unit.code.trim())
      const unitCostTotal = unitRows.reduce((sum, unit) => sum + (unit.cost.trim() ? toMinor(unit.cost, cur.decimals) : 0), 0)
      const propertyCost = ownership === 'owned' ? (unitCostTotal > 0 ? unitCostTotal : cost ? toMinor(cost, cur.decimals) : 0) : 0
      const p = addProperty({
        nameAr, kind, ownership,
        ownerName: ownership === 'managed' ? ownerName : '',
        commissionPercent: ownership === 'managed' ? Number(commission) || 0 : 0,
        address, costMinor: propertyCost,
        notes: '', initialUnits: unitRows.map((unit) => ({
          code: unit.code.trim(),
          annualRentMinor: unit.rent ? toMinor(unit.rent, cur.decimals) : 0,
          costMinor: unit.cost.trim() ? toMinor(unit.cost, cur.decimals) : undefined,
          salePriceMinor: unit.salePrice.trim() ? toMinor(unit.salePrice, cur.decimals) : 0,
          acquisitionPayment: payMode,
        })),
        acquisitionPayment: payMode, treasury,
      })
      toast.show(`أُنشئ العقار ${p.code} ✅`)
      setOpen(false); setNameAr(''); setOwnerName(''); setAddress(''); setCost(''); setInitialUnits([{ code: '', rent: '', cost: '', salePrice: '' }])
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* وحدة جديدة */
  const [unitFor, setUnitFor] = useState<Property | null>(null)
  const [uCode, setUCode] = useState('')
  const [uRent, setURent] = useState('')
  const [uCost, setUCost] = useState('')
  const [uSalePrice, setUSalePrice] = useState('')
  const [uPay, setUPay] = useState<'cash' | 'credit'>('cash')
  const saveUnit = () => {
    if (!unitFor) return
    try {
      addPropertyUnit({
        propertyId: unitFor.id, code: uCode, annualRentMinor: uRent ? toMinor(uRent, cur.decimals) : 0,
        costMinor: uCost ? toMinor(uCost, cur.decimals) : 0,
        salePriceMinor: uSalePrice ? toMinor(uSalePrice, cur.decimals) : 0,
        acquisitionPayment: uPay, treasury,
      })
      toast.show('أُضيفت الوحدة وسُجلت بياناتها المستقلة ✅'); setUnitFor(null); setUCode(''); setURent(''); setUCost(''); setUSalePrice('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* سداد مالك */
  const [payFor, setPayFor] = useState<Property | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payTreasury, setPayTreasury] = useState('1101')
  const savePayout = () => {
    if (!payFor) return
    try {
      payPropertyOwner({ propertyId: payFor.id, amountMinor: toMinor(payAmount, cur.decimals), treasury: payTreasury })
      toast.show('سُدد للمالك بقيد متوازن ✅'); setPayFor(null); setPayAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* صيانة وحدة */
  const [maintFor, setMaintFor] = useState<Property | null>(null)
  const [mUnitId, setMUnitId] = useState<number | ''>('')
  const [mAmount, setMAmount] = useState('')
  const [mBearer, setMBearer] = useState<'office' | 'owner'>('office')
  const [mDesc, setMDesc] = useState('')
  const [mTreasury, setMTreasury] = useState('1101')
  const saveMaint = () => {
    if (!maintFor || mUnitId === '') return
    try {
      addUnitMaintenance({ unitId: mUnitId, amountMinor: toMinor(mAmount, cur.decimals), bearer: mBearer, description: mDesc.trim() || 'صيانة', treasury: mTreasury })
      toast.show('سُجلت الصيانة ✅'); setMaintFor(null); setMAmount(''); setMDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* بيع عقار */
  const [sellFor, setSellFor] = useState<Property | null>(null)
  const [sPrice, setSPrice] = useState('')
  const [sPay, setSPay] = useState<'cash' | 'credit' | 'mixed'>('cash')
  const [sPaidNow, setSPaidNow] = useState('')
  const [sBuyerId, setSBuyerId] = useState(0)
  const [sTreasury, setSTreasury] = useState('1101')
  // عمولة موظف عن البيع (طلب المالك): استحقاق مربوط بالعقار المباع
  const [sCommEmpId, setSCommEmpId] = useState('')
  const [sCommAmount, setSCommAmount] = useState('')
  const saveSale = () => {
    if (!sellFor) return
    try {
      const priceMinor = toMinor(sPrice, cur.decimals)
      const paidMinor = sPay === 'cash' ? priceMinor : sPay === 'credit' ? 0 : toMinor(sPaidNow || '0', cur.decimals)
      if (priceMinor - paidMinor > 0 && !sBuyerId) throw new Error('الجزء الآجل يتطلب اختيار المشتري من سجل العملاء')
      sellProperty({ propertyId: sellFor.id, salePriceMinor: priceMinor, payment: sPay, paidMinor, buyerCustomerId: sBuyerId || null, treasury: sTreasury })
      if (sCommEmpId && sCommAmount.trim()) {
        addStaffCommission({
          employeeId: Number(sCommEmpId), source: 'property_sale', sourceId: sellFor.id,
          description: `عمولة بيع عقار «${sellFor.nameAr}»`,
          amountMinor: toMinor(sCommAmount, cur.decimals),
        })
      }
      toast.show(`بيع العقار وقُيد الربح${sCommEmpId && sCommAmount.trim() ? ' + استحقاق عمولة الموظف' : ''} ✅`); setSellFor(null); setSPrice(''); setSPaidNow(''); setSBuyerId(0); setSPay('cash'); setSCommEmpId(''); setSCommAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* مستند بيع وحدات: سطر مستقل لكل وحدة — لا تُخرج إلا تكلفة الوحدات المباعة */
  const [unitSaleFor, setUnitSaleFor] = useState<Property | null>(null)
  const [unitSaleRows, setUnitSaleRows] = useState<{ unitId: number; code: string; costMinor: number; price: string; picked: boolean }[]>([])
  const [unitSalePay, setUnitSalePay] = useState<'cash' | 'credit' | 'mixed'>('cash')
  const [unitSalePaidNow, setUnitSalePaidNow] = useState('')
  const [unitSaleVat, setUnitSaleVat] = useState('0')
  const [unitSaleBuyerId, setUnitSaleBuyerId] = useState(0)
  const [unitSaleBuyerName, setUnitSaleBuyerName] = useState('')
  const [unitSaleTreasury, setUnitSaleTreasury] = useState('1101')

  /** فتح المستند: كل الوحدات القابلة للبيع سطور، ويمكن تحديد وحدة بعينها مسبقاً */
  const openUnitSale = (property: Property, preselect?: PropertyUnit) => {
    const rows = propertyUnits
      .filter((u) => u.propertyId === property.id && u.status === 'vacant')
      .map((u) => ({
        unitId: u.id, code: u.code, costMinor: u.costMinor ?? 0,
        price: u.salePriceMinor > 0 ? formatMinor(u.salePriceMinor, cur, false) : '',
        picked: preselect ? u.id === preselect.id : false,
      }))
    setUnitSaleFor(property)
    setUnitSaleRows(rows)
    setUnitSalePay('cash'); setUnitSalePaidNow(''); setUnitSaleVat('0'); setUnitSaleBuyerId(0); setUnitSaleBuyerName('')
  }

  const unitSalePicked = unitSaleRows.filter((row) => row.picked && row.price.trim())
  const unitSaleNetMinor = unitSalePicked.reduce((sum, row) => sum + toMinor(row.price || '0', cur.decimals), 0)
  const unitSaleCostMinor = unitSalePicked.reduce((sum, row) => sum + row.costMinor, 0)
  const unitSaleVatMinor = Math.round((unitSaleNetMinor * (Number(unitSaleVat) || 0)) / 100)
  const unitSaleTotalMinor = unitSaleNetMinor + unitSaleVatMinor
  const unitSalePaidMinor = unitSalePay === 'cash' ? unitSaleTotalMinor : unitSalePay === 'credit' ? 0 : toMinor(unitSalePaidNow || '0', cur.decimals)
  const unitSaleDueMinor = Math.max(0, unitSaleTotalMinor - unitSalePaidMinor)

  const saveUnitSale = () => {
    if (!unitSaleFor) return
    try {
      if (unitSalePicked.length === 0) throw new Error('اختر وحدة واحدة على الأقل وحدد سعرها')
      if (unitSaleDueMinor > 0 && !unitSaleBuyerId) throw new Error('الجزء الآجل يتطلب اختيار المشتري من سجل العملاء')
      const doc = sellPropertyUnits({
        propertyId: unitSaleFor.id,
        lines: unitSalePicked.map((row) => ({ unitId: row.unitId, priceMinor: toMinor(row.price || '0', cur.decimals) })),
        payment: unitSalePay, paidMinor: unitSalePaidMinor,
        buyerCustomerId: unitSaleBuyerId || null, buyerName: unitSaleBuyerName.trim(),
        vatPercent: Number(unitSaleVat) || 0, treasury: unitSaleTreasury,
      })
      toast.show(`${doc.saleNumber}: بيعت ${doc.lines.length} وحدة بسطر لكل وحدة — المتبقي ${fmt(doc.dueMinor)} ✅`)
      setUnitSaleFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-teal-500" /> العقارات والملاك</h1>
          <p className="text-[12px] text-slate-500 mt-1">مملوك: الإيراد كله لك (4113) وبيعه بربح — مدار: تحصّل للمالك (2115) وتكسب السعي (4114)</p>
        </div>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> عقار جديد</Btn>
      </div>

      {properties.length === 0 ? (
        <EmptyState icon="🏘️" title="لا عقارات بعد" sub="أضف عقارك الأول: مملوكاً لك أو إدارة أملاك للغير بنسبة سعي — ثم وحداته وعقود إيجاره" />
      ) : (
        <div className="grid gap-3">
          {properties.map((p) => {
            const units = propertyUnits.filter((u) => u.propertyId === p.id)
            const leased = units.filter((u) => u.status === 'leased').length
            const sold = units.filter((u) => u.status === 'sold').length
            const vacant = units.filter((u) => u.status === 'vacant').length
            const balance = p.ownership === 'managed' ? getOwnerBalance(p.id) : 0
            const kd = PROPERTY_KIND_LABELS[p.kind]
            return (
              <div key={p.id} className={card + ' p-4'}>
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="font-black text-slate-800 dark:text-white flex items-center gap-2">
                      {kd.icon} {p.code} — {p.nameAr}
                      {p.status === 'sold' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-bold">مباع</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {kd.nameAr} · {p.ownership === 'owned' ? `مملوك${p.costMinor > 0 ? ` بتكلفة ${fmt(p.costMinor)}` : ''}` : `إدارة أملاك — ${p.ownerName} (سعي ${p.commissionPercent}٪)`}
                      {p.address ? ` · ${p.address}` : ''}
                    </div>
                    <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mt-1.5">
                      الوحدات: {units.length} ({leased} مؤجرة / {vacant} شاغرة{sold > 0 ? ` / ${sold} مباعة` : ''})
                      {p.ownership === 'managed' && <> · مستحق المالك: <b className={balance > 0 ? 'text-rose-500' : 'text-emerald-600'}>{fmt(balance)}</b></>}
                    </div>
                  </div>
                  {p.status === 'active' && (
                    <div className="flex gap-1">
                      <button onClick={() => { setUnitFor(p); setUCode(''); setURent(''); setUCost(''); setUSalePrice(''); setUPay('cash') }} title="وحدة جديدة" className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all hover:scale-110"><DoorOpen className="w-4 h-4" /></button>
                      <button onClick={() => { setMaintFor(p); setMUnitId(units[0]?.id ?? ''); setMBearer(p.ownership === 'managed' ? 'owner' : 'office') }} title="صيانة وحدة" className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><Wrench className="w-4 h-4" /></button>
                      {p.ownership === 'managed' && (
                        <button onClick={() => { setPayFor(p); setPayAmount('') }} title="سداد للمالك" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><HandCoins className="w-4 h-4" /></button>
                      )}
                      {p.ownership === 'owned' && units.some((u) => u.status === 'vacant') && (
                        <button onClick={() => openUnitSale(p)} title="مستند بيع وحدات (سطر لكل وحدة)" data-open-unit-sale className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all hover:scale-110"><ReceiptText className="w-4 h-4" /></button>
                      )}
                      {p.ownership === 'owned' && !units.some((u) => u.status === 'sold') && (
                        <button onClick={() => { setSellFor(p); setSPrice('') }} title="بيع العقار بالكامل" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Tag className="w-4 h-4" /></button>
                      )}
                    </div>
                  )}
                </div>
                {units.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {units.map((u) => (
                      <div key={u.id} className="flex items-center gap-1">
                        <span className={`text-[11px] px-2 py-1 rounded-lg font-bold ${u.status === 'leased' ? 'bg-teal-500/10 text-teal-600' : u.status === 'maintenance' ? 'bg-amber-500/10 text-amber-600' : u.status === 'sold' ? 'bg-rose-500/10 text-rose-600' : 'bg-slate-500/10 text-slate-500'}`}>
                          {u.code} · {u.status === 'leased' ? 'مؤجرة' : u.status === 'maintenance' ? 'صيانة' : u.status === 'sold' ? 'مباعة' : 'شاغرة'}
                          {u.costMinor > 0 ? ` · تكلفة ${fmt(u.costMinor)}` : ''}
                          {u.salePriceMinor > 0 && u.status !== 'sold' ? ` · بيع ${fmt(u.salePriceMinor)}` : ''}
                        </span>
                        {p.ownership === 'owned' && p.status === 'active' && u.status === 'vacant' && (
                          <button onClick={() => openUnitSale(p, u)} title="بيع هذه الوحدة (سطر مستقل داخل مستند بيع)" className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-500/10"><Tag className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* عقار جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عقار جديد" wide subtitle="بطاقة عقار: وحدات ومساحات وقيمة">
        <div className="space-y-3"><DocSectionHead step="١" title="بيانات العقار ووحداته" hint="كل وحدة سطر مستقل في مستند البيع" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setOwnership('owned')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${ownership === 'owned' ? 'border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🏢 مملوك لي — الإيراد كله للمكتب</button>
            <button onClick={() => setOwnership('managed')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${ownership === 'managed' ? 'border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🤝 إدارة أملاك الغير — أكسب السعي</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم العقار *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="برج الياسمين…" autoFocus /></Field>
            <Field label="النوع">
              <QuickSelect value={kind} onChange={(e) => setKind(e.target.value as PropertyKind)} className={inputCls}>
                {Object.entries(PROPERTY_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.nameAr}</option>)}
              </QuickSelect>
            </Field>
            {ownership === 'managed' ? (
              <>
                <Field label="اسم المالك *"><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={inputCls} /></Field>
                <Field label="نسبة السعي ٪ *" hint="عمولة المكتب من كل تحصيلة — الباقي مستحق للمالك"><input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              </>
            ) : (
              <>
                <Field label={`إجمالي تكلفة الاقتناء (${cur.symbol})`} hint="يمكن تركه فارغاً؛ عند إدخال تكاليف الوحدات أدناه يُحسب الإجمالي منها، وكل وحدة تُقيد بسجل مستقل"><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                {cost && (
                  <Field label="سداد الاقتناء">
                    <div className="flex gap-2">
                      {(['cash', 'credit'] as const).map((m) => (
                        <button key={m} onClick={() => setPayMode(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${payMode === m ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{m === 'cash' ? 'نقدي' : 'آجل (مورد/بائع)'}</button>
                      ))}
                    </div>
                    {payMode === 'cash' && <div className="mt-2"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></div>}
                  </Field>
                )}
              </>
            )}
            <Field label="العنوان"><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="الوحدات الأولية" hint="كل وحدة سطر مستقل حقيقي: كود وأجرة وتكلفة اقتناء وسعر بيع؛ لا تُدمج الوحدات في تكلفة واحدة">
            <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-2 overflow-x-auto">
              <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr_auto] min-w-[650px] gap-2 px-1 text-[11px] font-bold text-slate-400"><span>كود الوحدة</span><span>الأجرة السنوية</span><span>تكلفة الاقتناء</span><span>سعر البيع</span><span /></div>
              {initialUnits.map((unit, index) => (
                <div key={index} className="grid grid-cols-[1.1fr_1fr_1fr_1fr_auto] min-w-[650px] gap-2 items-center">
                  <input value={unit.code} onChange={(e) => setInitialUnits((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, code: e.target.value } : row))} className={inputCls} placeholder="شقة 1 — الدور الأول" />
                  <input value={unit.rent} onChange={(e) => setInitialUnits((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, rent: e.target.value } : row))} inputMode="decimal" className={inputCls} placeholder={cur.symbol} />
                  <input value={unit.cost} onChange={(e) => setInitialUnits((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, cost: e.target.value } : row))} inputMode="decimal" className={inputCls} placeholder="0" />
                  <input value={unit.salePrice} onChange={(e) => setInitialUnits((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, salePrice: e.target.value } : row))} inputMode="decimal" className={inputCls} placeholder="0" />
                  <button type="button" onClick={() => setInitialUnits((rows) => rows.length > 1 ? rows.filter((_, rowIndex) => rowIndex !== index) : [{ code: '', rent: '', cost: '', salePrice: '' }])} className="h-9 px-2 rounded-lg text-rose-500 hover:bg-rose-500/10" title="حذف الوحدة">×</button>
                </div>
              ))}
              <button type="button" onClick={() => setInitialUnits((rows) => [...rows, { code: '', rent: '', cost: '', salePrice: '' }])} className="text-[11px] font-bold text-teal-600 hover:underline">+ إضافة وحدة مستقلة</button>
            </div>
          </Field>
          <DocOutcome>الأثر: <b>1103</b> مديناً بتكلفة العقار عند الشراء · إيجار الوحدة دائناً في <b>4113</b> · وبيعها دائناً في <b>4115</b> مقابل تكلفتها مديناً في <b>5116</b>.</DocOutcome><div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveProperty} disabled={!nameAr.trim()}>إنشاء العقار</Btn>
          </div>
        </div>
      </Modal>

      {/* وحدة جديدة */}
      <Modal open={!!unitFor} onClose={() => setUnitFor(null)} title={unitFor ? `وحدة مستقلة جديدة — ${unitFor.nameAr}` : ''}>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12px] text-slate-500">تُحفظ الوحدة كسجل مستقل ويمكن تأجيرها أو بيعها لاحقاً دون التأثير على باقي الوحدات.</div>
          <Field label="كود الوحدة *"><input value={uCode} onChange={(e) => setUCode(e.target.value)} className={inputCls} placeholder="شقة 5 — الدور الثاني" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label={`الأجرة السنوية (${cur.symbol})`}><input value={uRent} onChange={(e) => setURent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label={`تكلفة الاقتناء (${cur.symbol})`} hint={unitFor?.ownership === 'managed' ? 'العقار المدار ليس أصلاً للمكتب' : ''}><input value={uCost} onChange={(e) => setUCost(e.target.value)} inputMode="decimal" className={inputCls} disabled={unitFor?.ownership === 'managed'} /></Field>
            <Field label={`سعر البيع (${cur.symbol})`}><input value={uSalePrice} onChange={(e) => setUSalePrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          {unitFor?.ownership === 'owned' && uCost && <Field label="طريقة دفع الاقتناء"><div className="flex gap-2">{(['cash', 'credit'] as const).map((m) => <button key={m} onClick={() => setUPay(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${uPay === m ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{m === 'cash' ? 'نقدي' : 'آجل'}</button>)}</div></Field>}
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setUnitFor(null)}>إلغاء</Btn><Btn onClick={saveUnit} disabled={!uCode.trim()}>إضافة الوحدة وقيدها</Btn></div>
        </div>
      </Modal>

      {/* سداد مالك */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `سداد للمالك — ${payFor.ownerName}` : ''}>
        {payFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500">مستحقه الآن: <b className="text-rose-500">{fmt(getOwnerBalance(payFor.id))}</b> (تحصيلاته − سداداته − صيانة على حسابه)</div>
            <Field label={`المبلغ (${cur.symbol})`}><input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <TreasuryPicker value={payTreasury} onChange={setPayTreasury} />
            <Btn onClick={savePayout} shortcut="F9" className="w-full" disabled={!payAmount}>سداد وقيد 2115 ← الخزينة</Btn>
          </div>
        )}
      </Modal>

      {/* صيانة وحدة */}
      <Modal open={!!maintFor} onClose={() => setMaintFor(null)} title={maintFor ? `صيانة وحدة — ${maintFor.nameAr}` : ''}>
        {maintFor && (
          <div className="space-y-3">
            <Field label="الوحدة">
              <QuickSelect value={mUnitId} onChange={(e) => setMUnitId(Number(e.target.value))} className={inputCls}>
                {propertyUnits.filter((u) => u.propertyId === maintFor.id).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </QuickSelect>
            </Field>
            <Field label={`القيمة (${cur.symbol})`}><input value={mAmount} onChange={(e) => setMAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="الوصف"><input value={mDesc} onChange={(e) => setMDesc(e.target.value)} className={inputCls} placeholder="سباكة، كهرباء…" /></Field>
            {maintFor.ownership === 'managed' && (
              <Field label="على حساب من؟" hint="نمط الوسيط: صيانة العقار المدار على مالكه ما لم يتحملها المكتب">
                <div className="flex gap-2">
                  <button onClick={() => setMBearer('owner')} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${mBearer === 'owner' ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>المالك (خصم من 2115)</button>
                  <button onClick={() => setMBearer('office')} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${mBearer === 'office' ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>المكتب (مصروف 5108)</button>
                </div>
              </Field>
            )}
            <TreasuryPicker value={mTreasury} onChange={setMTreasury} />
            <Btn onClick={saveMaint} shortcut="F9" className="w-full" disabled={!mAmount || mUnitId === ''}>تسجيل الصيانة وقيدها</Btn>
          </div>
        )}
      </Modal>

      {/* مستند بيع وحدات — سطر مستقل لكل وحدة */}
      <Modal open={!!unitSaleFor} onClose={() => setUnitSaleFor(null)} title={unitSaleFor ? `مستند بيع وحدات — ${unitSaleFor.nameAr}` : ''} wide>
        {unitSaleFor && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([
                ['الوحدات المختارة', String(unitSalePicked.length)],
                ['إجمالي البيع', fmt(unitSaleTotalMinor)],
                ['تكلفتها', fmt(unitSaleCostMinor)],
                ['الربح المتوقع', fmt(unitSaleNetMinor - unitSaleCostMinor)],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-teal-500/10 p-2.5 text-center">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="text-[12.5px] font-black text-teal-700 dark:text-teal-300" dir="ltr">{value}</div>
                </div>
              ))}
            </div>

            {/* ① سطور الوحدات */}
            <Field label="① الوحدات المعروضة للبيع" hint="كل وحدة سطر مستقل بسعرها وتكلفتها — لا تُخرج إلا تكلفة الوحدات المختارة من الأصل 1113">
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {unitSaleRows.length === 0 ? (
                  <div className="p-3 text-[12px] text-slate-400">لا توجد وحدات شاغرة قابلة للبيع في هذا العقار.</div>
                ) : unitSaleRows.map((row, index) => (
                  <label key={row.unitId} data-unit-sale-line className="flex items-center gap-2 border-b border-slate-100 p-2 last:border-0 dark:border-slate-800">
                    <input type="checkbox" checked={row.picked} aria-label={`اختيار الوحدة ${row.code}`} onChange={(e) => setUnitSaleRows((list) => list.map((r, i) => (i === index ? { ...r, picked: e.target.checked } : r)))} />
                    <b className="text-[12px] flex-1">{row.code}</b>
                    <span className="text-[11px] text-slate-400">تكلفتها {fmt(row.costMinor)}</span>
                    <input value={row.price} onChange={(e) => setUnitSaleRows((list) => list.map((r, i) => (i === index ? { ...r, price: e.target.value, picked: true } : r)))} inputMode="decimal" className={`${inputCls} w-32`} placeholder="سعر البيع" aria-label={`سعر بيع الوحدة ${row.code}`} />
                  </label>
                ))}
              </div>
            </Field>

            {/* ② المشتري */}
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="② المشتري" hint="إلزامي لأي جزء آجل — تُتتبع ذمته بكشف حسابه">
                <PartyQuickPicker parties={customers} value={unitSaleBuyerId} onChange={setUnitSaleBuyerId} cashLabel="مشترٍ عابر (نقدي فقط)" label="بحث المشتري" cashValue={0} />
              </Field>
              <Field label="اسم المشتري في العقد (اختياري)"><input value={unitSaleBuyerName} onChange={(e) => setUnitSaleBuyerName(e.target.value)} className={inputCls} /></Field>
            </div>

            {/* ③ التحصيل */}
            <Field label="③ التحصيل" hint="نقدي/بنكي بالكامل، أو مقدم والباقي على المشتري">
              <div className="flex gap-2">
                {([['cash', 'نقدي بالكامل'], ['mixed', 'مقدم + آجل'], ['credit', 'آجل بالكامل']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" data-unit-sale-pay={mode} onClick={() => setUnitSalePay(mode)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${unitSalePay === mode ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{label}</button>
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-2">
                {unitSalePay === 'mixed' && (
                  <Field label={`المحصَّل الآن (${cur.symbol}) *`} hint={`المتبقي ${fmt(unitSaleDueMinor)} على المشتري`}>
                    <input value={unitSalePaidNow} onChange={(e) => setUnitSalePaidNow(e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                )}
                <Field label="نسبة ض.ق.م (%)"><input value={unitSaleVat} onChange={(e) => setUnitSaleVat(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                {unitSalePay !== 'credit' && <div><TreasuryPicker value={unitSaleTreasury} onChange={setUnitSaleTreasury} compact operation="receipt" /></div>}
              </div>
            </Field>

            <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:bg-slate-800/50">
              القيد: {unitSalePaidMinor > 0 ? `الخزينة ${unitSaleTreasury} مدين ${fmt(unitSalePaidMinor)}` : ''}{unitSalePaidMinor > 0 && unitSaleDueMinor > 0 ? ' + ' : ''}{unitSaleDueMinor > 0 ? `1104 عملاء مدين ${fmt(unitSaleDueMinor)}` : ''} ← 4115 إيراد بسطر لكل وحدة{unitSaleVatMinor > 0 ? ` + 2102 ضريبة ${fmt(unitSaleVatMinor)}` : ''}، و5116 تكلفة ← 1113 بسطر لكل وحدة.
            </div>
            <Btn onClick={saveUnitSale} shortcut="F9" className="w-full" disabled={unitSalePicked.length === 0 || (unitSaleDueMinor > 0 && !unitSaleBuyerId)}>ترحيل مستند البيع ({unitSalePicked.length} وحدة)</Btn>
          </div>
        )}
      </Modal>

      {/* بيع عقار */}
      <Modal open={!!sellFor} onClose={() => setSellFor(null)} title={sellFor ? `بيع العقار — ${sellFor.nameAr}` : ''}>
        {sellFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-teal-500/10 border border-teal-500/30 p-3 text-[12px] font-bold text-teal-700 dark:text-teal-300">
              التكلفة الدفترية {fmt(sellFor.costMinor)} — البيع يقيد الإيراد (4115) والتكلفة (5116) ويخرج العقار من الأصول (1113) — <b>بسطر مستقل لكل وحدة</b> يُوزَّع عليه السعر بنسبة تكلفتها. لا بيع وعلى العقار عقود نشطة.
            </div>
            <Field label={`سعر البيع (${cur.symbol}) *`}><input value={sPrice} onChange={(e) => setSPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="التحصيل">
              <div className="flex gap-2">
                {([['cash', 'نقدي'], ['mixed', 'مقدم + آجل'], ['credit', 'آجل (مدينون)']] as const).map(([mode, label]) => (
                  <button key={mode} onClick={() => setSPay(mode)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${sPay === mode ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{label}</button>
                ))}
              </div>
              {sPay === 'mixed' && <div className="mt-2"><Field label={`المحصَّل الآن (${cur.symbol}) *`} hint="الباقي يُرحَّل على حساب المشتري"><input value={sPaidNow} onChange={(e) => setSPaidNow(e.target.value)} inputMode="decimal" className={inputCls} /></Field></div>}
              {sPay !== 'credit' && <div className="mt-2"><TreasuryPicker value={sTreasury} onChange={setSTreasury} compact operation="receipt" /></div>}
              {sPay !== 'cash' && (
                <div className="mt-2"><Field label="المشتري *" hint="الجزء الآجل يظهر في كشف حسابه ويسري حده الائتماني">
                  <PartyQuickPicker parties={customers} value={sBuyerId} onChange={setSBuyerId} cashLabel="اختر المشتري" label="بحث المشتري" cashValue={0} showCash={false} />
                </Field></div>
              )}
            </Field>
            <Field label="عمولة موظف (اختياري)" hint="الموظف الذي أتم الصفقة — مصروف مربوط بالبيع يدخل ربحيته">
              <div className="grid grid-cols-2 gap-2">
                <PartyQuickPicker parties={employees.filter((employee) => employee.active)} value={sCommEmpId ? Number(sCommEmpId) : 0} onChange={(id) => setSCommEmpId(id ? String(id) : '')} cashLabel="بلا عمولة" label="بحث موظف العمولة" cashValue={0} />
                <input value={sCommAmount} onChange={(e) => setSCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder={`المبلغ (${cur.symbol})`} disabled={!sCommEmpId} />
              </div>
            </Field>
            <Btn onClick={saveSale} shortcut="F9" className="w-full" disabled={!sPrice || (sPay !== 'cash' && !sBuyerId) || (!!sCommEmpId && !sCommAmount.trim())}>بيع وقيد الربح</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ─────────────────────────── عقود الإيجار ─────────────────────────── */
export function LeasesPage() {
  const { properties, propertyUnits, leases, customers, employees, paymentTerminals, addLease, collectLeaseInstallment, endLease, addStaffCommission } = useDataStore()
  const { cur, fmt } = useCur()
  const toast = useToast()
  const todayIso = new Date().toISOString().slice(0, 10)
  const alerts = useMemo(() => collectLeaseAlerts(leases, todayIso, 60), [leases, todayIso])

  /* عقد جديد */
  const [open, setOpen] = useState(false)
  const [propId, setPropId] = useState<number | ''>('')
  /** سطور وحدات العقد: سطر مستقل لكل وحدة بأجرتها — عقد واحد قد يضم عدة وحدات */
  const [leaseUnitRows, setLeaseUnitRows] = useState<{ unitId: number; code: string; rent: string; picked: boolean }[]>([])
  const [tenant, setTenant] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [startDate, setStartDate] = useState(todayIso)
  const [months, setMonths] = useState('12')
  const [frequency, setFrequency] = useState<RentFrequency>('quarterly')
  const [deposit, setDeposit] = useState('')
  const [ejar, setEjar] = useState('')
  const [leaseTreasury, setLeaseTreasury] = useState('1101')
  // عمولة موظف عن العقد (طلب المالك): تُستحق مصروفاً مربوطاً بالعقد وتُصرف مع الراتب أو منفردة
  const [commEmpId, setCommEmpId] = useState('')
  const [commAmount, setCommAmount] = useState('')
  const activeProps = properties.filter((p) => p.status === 'active')
  const pickedLeaseUnits = leaseUnitRows.filter((row) => row.picked)
  const leaseUnitsTotalMinor = pickedLeaseUnits.reduce((sum, row) => sum + toMinor(row.rent || '0', cur.decimals), 0)
  /** تحميل سطور الوحدات الشاغرة عند اختيار العقار (الأجرة الاسترشادية × سنوات المدة) */
  const loadLeaseUnitRows = (propertyId: number, monthsValue: number) => {
    const years = Math.max(1, monthsValue) / 12
    setLeaseUnitRows(propertyUnits
      .filter((u) => u.propertyId === propertyId && u.status === 'vacant')
      .map((u) => ({
        unitId: u.id, code: u.code, picked: false,
        rent: u.annualRentMinor > 0 ? formatMinor(Math.round(u.annualRentMinor * years), cur, false) : '',
      })))
  }

  const saveLease = () => {
    try {
      if (propId === '') throw new Error('اختر العقار')
      if (pickedLeaseUnits.length === 0) throw new Error('اختر وحدة واحدة على الأقل — كل وحدة سطر مستقل في العقد')
      const l = addLease({
        propertyId: propId,
        units: pickedLeaseUnits.map((row) => ({ unitId: row.unitId, rentMinor: toMinor(row.rent || '0', cur.decimals) })),
        tenantName: tenant, tenantId: tenantId ? Number(tenantId) : null,
        startDate, months: Number(months) || 0, frequency, totalRentMinor: leaseUnitsTotalMinor,
        depositMinor: deposit ? toMinor(deposit, cur.decimals) : 0, ejarNumber: ejar, treasury: leaseTreasury,
      })
      // عمولة الموظف المسوّق (اختيارية): استحقاق مربوط بالعقد — تظهر في «الموظفون ← العمولات»
      if (commEmpId && commAmount.trim()) {
        const unitsLabel = pickedLeaseUnits.map((row) => row.code).join('، ')
        addStaffCommission({
          employeeId: Number(commEmpId), source: 'lease', sourceId: l.id,
          description: `عمولة تأجير ${unitsLabel} — عقد ${l.contractNumber}`,
          amountMinor: toMinor(commAmount, cur.decimals),
        })
      }
      toast.show(`أُنشئ العقد ${l.contractNumber} على ${l.unitLines?.length ?? 1} وحدة بجدول ${l.installments.length} قسطاً${commEmpId && commAmount.trim() ? ' + استحقاق عمولة الموظف' : ''} ✅`)
      setOpen(false); setTenant(''); setDeposit(''); setEjar(''); setLeaseUnitRows([]); setCommEmpId(''); setCommAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تحصيل */
  const [collectFor, setCollectFor] = useState<Lease | null>(null)
  const [colTreasury, setColTreasury] = useState('1101')
  const [colTerminal, setColTerminal] = useState<TerminalPaymentDraft>(emptyTerminalPayment)
  const collect = (seq: number) => {
    if (!collectFor) return
    try {
      const terminal = paymentTerminals.find((row) => row.id === colTerminal.terminalId)
      const r = collectLeaseInstallment({ leaseId: collectFor.id, seq, treasury: terminal?.settlementAccountCode ?? colTreasury, terminalPayment: terminal ? { terminalId: terminal.id, providerReference: colTerminal.providerReference.trim(), cardLast4: colTerminal.cardLast4 || undefined } : undefined })
      toast.show(`حُصل ${fmt(r.paidMinor)}${r.commissionMinor > 0 ? ` — سعي المكتب ${fmt(r.commissionMinor)} ونصيب المالك ${fmt(r.ownerShareMinor)}` : ''} ✅`)
      setCollectFor((c) => (c ? useDataStore.getState().leases.find((l) => l.id === c.id) ?? null : null)); setColTerminal(emptyTerminalPayment())
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* إنهاء/إخلاء */
  const [endFor, setEndFor] = useState<Lease | null>(null)
  const [endDeduction, setEndDeduction] = useState('')
  const [endEvicted, setEndEvicted] = useState(false)
  const [endTreasury, setEndTreasury] = useState('1101')
  const saveEnd = () => {
    if (!endFor) return
    try {
      endLease({ leaseId: endFor.id, deductionMinor: endDeduction ? toMinor(endDeduction, cur.decimals) : 0, evicted: endEvicted, treasury: endTreasury })
      toast.show(endEvicted ? 'أُخلي المستأجر وسُوي التأمين ✅' : 'أُنهي العقد وسُوي التأمين ✅')
      setEndFor(null); setEndDeduction(''); setEndEvicted(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const propName = (id: number) => properties.find((p) => p.id === id)?.nameAr ?? '—'
  const unitCode = (id: number) => propertyUnits.find((u) => u.id === id)?.code ?? '—'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2"><KeyRound className="w-5 h-5 text-teal-500" /> عقود الإيجار</h1>
          <p className="text-[12px] text-slate-500 mt-1">جدول أقساط تلقائي بالدورية + تأمين مسترد (2103) + رقم توثيق منصة إيجار</p>
        </div>
        <Btn onClick={() => { setOpen(true); setPropId(activeProps[0]?.id ?? '') }}><Plus className="w-4 h-4" /> عقد جديد</Btn>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-1">
          <div className="text-[12px] font-black text-amber-700 dark:text-amber-300 flex items-center gap-1"><BellRing className="w-4 h-4" /> تنبيهات العقود</div>
          {alerts.slice(0, 6).map((a, i) => (
            <div key={i} className="text-[12px] font-bold text-amber-700 dark:text-amber-300">
              {a.kind === 'overdue'
                ? `⏰ ${a.contractNumber} — ${a.tenantName}: قسط متأخر ${a.days} يوماً بمبلغ ${fmt(a.amountMinor)}`
                : a.days < 0
                  ? `📅 ${a.contractNumber} — ${a.tenantName}: العقد منتهٍ منذ ${-a.days} يوماً — جدد أو أخلِ`
                  : `📅 ${a.contractNumber} — ${a.tenantName}: ينتهي خلال ${a.days} يوماً — جهز التجديد`}
            </div>
          ))}
        </div>
      )}

      {leases.length === 0 ? (
        <EmptyState icon="🔑" title="لا عقود إيجار بعد" sub="أنشئ عقداً على وحدة شاغرة: مدة ودورية وأجرة إجمالية — الجدول يتولد تلقائياً والتأمين يقيد التزاماً" />
      ) : (
        <div className="grid gap-3">
          {[...leases].reverse().map((l) => {
            const paid = l.installments.reduce((s, i) => s + i.paidMinor, 0)
            const pct = Math.round((paid / l.totalRentMinor) * 100)
            return (
              <div key={l.id} className={card + ' p-4'}>
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="font-black text-slate-800 dark:text-white">
                      {l.contractNumber} — {l.tenantName}
                      <span className={`mr-2 text-[10px] px-2 py-0.5 rounded-full font-bold ${l.status === 'active' ? 'bg-teal-500/10 text-teal-600' : l.status === 'evicted' ? 'bg-rose-500/10 text-rose-500' : 'bg-slate-500/10 text-slate-500'}`}>
                        {l.status === 'active' ? 'نشط' : l.status === 'evicted' ? 'مُخلى' : 'منتهٍ'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {propName(l.propertyId)} · {(l.unitLines && l.unitLines.length > 0 ? l.unitLines.map((line) => line.code).join('، ') : unitCode(l.unitId))}{l.unitLines && l.unitLines.length > 1 ? ` (${l.unitLines.length} وحدات)` : ''} · {l.months} شهراً {RENT_FREQUENCY_LABELS[l.frequency].nameAr} · من {l.startDate} إلى {leaseEndDate(l.startDate, l.months)}
                      {l.ejarNumber ? ` · إيجار: ${l.ejarNumber}` : ''}
                    </div>
                    <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mt-1.5">
                      الأجرة {fmt(l.totalRentMinor)} · المحصل {fmt(paid)} ({pct}٪){l.depositMinor > 0 ? ` · تأمين ${fmt(l.depositMinor)}` : ''}
                    </div>
                  </div>
                  {l.status === 'active' && (
                    <div className="flex gap-1">
                      <button onClick={() => setCollectFor(l)} title="تحصيل الأقساط" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><HandCoins className="w-4 h-4" /></button>
                      <button onClick={() => { setEndFor(l); setEndDeduction(''); setEndEvicted(false) }} title="إنهاء / إخلاء" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Eye className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* عقد جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عقد إيجار جديد" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="العقار *">
              <QuickSelect value={propId} onChange={(e) => { const id = Number(e.target.value); setPropId(id); loadLeaseUnitRows(id, Number(months) || 12) }} className={inputCls}>
                {activeProps.map((p) => <option key={p.id} value={p.id}>{p.nameAr}{p.ownership === 'managed' ? ` (سعي ${p.commissionPercent}٪)` : ''}</option>)}
              </QuickSelect>
            </Field>
            <div className="sm:col-span-2">
              <Field label={`الوحدات المؤجَّرة * — سطر مستقل لكل وحدة (${pickedLeaseUnits.length} مختارة)`} hint="عقد واحد قد يضم عدة وحدات؛ أجرة كل وحدة سطر مستقل وإجمالي العقد مجموعها">
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  {propId === '' ? (
                    <div className="p-3 text-[12px] text-slate-400">اختر العقار أولاً لعرض وحداته الشاغرة.</div>
                  ) : leaseUnitRows.length === 0 ? (
                    <div className="p-3 text-[12px] text-slate-400">لا توجد وحدات شاغرة في هذا العقار.</div>
                  ) : leaseUnitRows.map((row, index) => (
                    <label key={row.unitId} data-lease-unit-line className="flex items-center gap-2 border-b border-slate-100 p-2 last:border-0 dark:border-slate-800">
                      <input type="checkbox" checked={row.picked} aria-label={`اختيار الوحدة ${row.code} للعقد`} onChange={(e) => setLeaseUnitRows((list) => list.map((r, i) => (i === index ? { ...r, picked: e.target.checked } : r)))} />
                      <b className="text-[12px] flex-1">{row.code}</b>
                      <input value={row.rent} onChange={(e) => setLeaseUnitRows((list) => list.map((r, i) => (i === index ? { ...r, rent: e.target.value, picked: true } : r)))} inputMode="decimal" className={`${inputCls} w-36`} placeholder={`أجرة المدة (${cur.symbol})`} aria-label={`أجرة الوحدة ${row.code}`} />
                    </label>
                  ))}
                </div>
                {pickedLeaseUnits.length > 0 && (
                  <div className="mt-1 text-[11px] font-bold text-teal-700 dark:text-teal-300">إجمالي أجرة العقد من السطور: {fmt(leaseUnitsTotalMinor)} {cur.symbol}</div>
                )}
              </Field>
            </div>
            <Field label="اسم المستأجر *"><input value={tenant} onChange={(e) => setTenant(e.target.value)} className={inputCls} /></Field>
            <Field label="ربط بسجل عميل (إداري)">
              <PartyQuickPicker parties={customers} value={tenantId ? Number(tenantId) : 0} onChange={(id) => setTenantId(id ? String(id) : '')} cashLabel="بلا ربط" label="بحث المستأجر" cashValue={0} />
            </Field>
            <Field label="بداية العقد *"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="المدة بالأشهر *"><input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
            <Field label="دورية السداد">
              <QuickSelect value={frequency} onChange={(e) => setFrequency(e.target.value as RentFrequency)} className={inputCls}>
                {Object.entries(RENT_FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label={`إجمالي أجرة كامل المدة (${cur.symbol})`} hint="محسوب تلقائياً من سطور الوحدات">
              <input value={formatMinor(leaseUnitsTotalMinor, cur, false)} readOnly className={`${inputCls} bg-slate-50 dark:bg-slate-800 font-bold`} dir="ltr" />
            </Field>
            <Field label={`التأمين المسترد (${cur.symbol})`} hint="يقيد التزاماً (2103) ويُرد عند الإخلاء ناقص الأضرار"><input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="رقم توثيق منصة إيجار" hint="السعودية: رقم العقد الموثق في المنصة الحكومية"><input value={ejar} onChange={(e) => setEjar(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="عمولة موظف (اختياري)" hint="الموظف الذي سوّق العقد — تُستحق مصروفاً مربوطاً به">
              <PartyQuickPicker parties={employees.filter((employee) => employee.active)} value={commEmpId ? Number(commEmpId) : 0} onChange={(id) => setCommEmpId(id ? String(id) : '')} cashLabel="بلا عمولة" label="بحث موظف العمولة" cashValue={0} />
            </Field>
            {commEmpId && (
              <Field label={`مبلغ العمولة (${cur.symbol}) *`} hint="تُصرف مع الراتب أو منفردة من «الموظفون ← العمولات»">
                <input value={commAmount} onChange={(e) => setCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder="0" />
              </Field>
            )}
          </div>
          {deposit && <TreasuryPicker value={leaseTreasury} onChange={setLeaseTreasury} />}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveLease} shortcut="F9" disabled={!tenant.trim() || pickedLeaseUnits.length === 0 || leaseUnitsTotalMinor <= 0}>إنشاء العقد وتوليد الأقساط ({pickedLeaseUnits.length} وحدة)</Btn>
          </div>
        </div>
      </Modal>

      {/* تحصيل الأقساط */}
      <Modal open={!!collectFor} onClose={() => setCollectFor(null)} title={collectFor ? `تحصيل — ${collectFor.contractNumber} (${collectFor.tenantName})` : ''} wide>
        {collectFor && (
          <div className="space-y-3">
            <PaymentMethodPicker value={{treasury:colTreasury,terminalPayment:colTerminal}} onChange={value=>{setColTreasury(value.treasury);setColTerminal(value.terminalPayment)}} operation="receipt"/>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <tr><th className="p-2 text-right font-bold">القسط</th><th className="p-2 text-center font-bold">الاستحقاق</th><th className="p-2 text-left font-bold">القيمة</th><th className="p-2 text-left font-bold">المحصل</th><th className="p-2 text-center font-bold"></th></tr>
                </thead>
                <tbody>
                  {collectFor.installments.map((inst) => {
                    const remaining = inst.amountMinor - inst.paidMinor
                    const overdue = remaining > 0 && inst.dueDate < todayIso
                    return (
                      <tr key={inst.seq} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 font-bold">{inst.seq}</td>
                        <td className={`p-2 text-center ${overdue ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>{inst.dueDate}{overdue ? ' ⏰' : ''}</td>
                        <td className="p-2 text-left tabular-nums">{fmt(inst.amountMinor)}</td>
                        <td className="p-2 text-left tabular-nums font-bold">{fmt(inst.paidMinor)}</td>
                        <td className="p-2 text-center">
                          {remaining > 0 ? (
                            <button onClick={() => collect(inst.seq)} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 font-bold hover:bg-emerald-500/20 transition-all">تحصيل {fmt(remaining)}</button>
                          ) : (
                            <span className="text-emerald-600 font-bold">✓ {inst.paidAt}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* إنهاء / إخلاء */}
      <Modal open={!!endFor} onClose={() => setEndFor(null)} title={endFor ? `إنهاء العقد — ${endFor.contractNumber}` : ''}>
        {endFor && (
          <div className="space-y-3">
            {endFor.depositMinor > 0 && (
              <>
                <div className="text-[12px] text-slate-500">التأمين المقبوض: <b>{fmt(endFor.depositMinor)}</b> — يُرد ناقص خصم الأضرار (يقيد إيراداً 4110)</div>
                <Field label={`خصم أضرار (${cur.symbol})`}><input value={endDeduction} onChange={(e) => setEndDeduction(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0 = رد كامل" /></Field>
                <TreasuryPicker value={endTreasury} onChange={setEndTreasury} />
              </>
            )}
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 cursor-pointer">
              <input type="checkbox" checked={endEvicted} onChange={(e) => setEndEvicted(e.target.checked)} className="accent-rose-600" />
              <span className="text-[12px] font-bold text-rose-600 dark:text-rose-400">إخلاء (إنهاء قسري) — يُعلَّم العقد «مُخلى»</span>
            </label>
            <Btn onClick={saveEnd} shortcut="F9" className="w-full">إنهاء العقد وتسوية التأمين</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
