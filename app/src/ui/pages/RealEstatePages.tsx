/**
 * صفحات نشاط العقارات (النشاط 21) — معايير سند/الوسيط/سمات السعودية:
 * - PropertiesPage: عقارات (مملوكة/مدارة بسعي) بوحدات، حسابات الملاك وسدادهم،
 *   صيانة الوحدات (على المكتب أو المالك)، وبيع العقار المملوك.
 * - LeasesPage: عقود إيجار بجدول أقساط تلقائي وتأمين مسترد ورقم توثيق إيجار،
 *   تحصيل الأقساط، تنبيهات الانتهاء والتأخير، وإنهاء/إخلاء برد التأمين.
 */
import { useMemo, useState } from 'react'
import { Plus, Building2, HandCoins, Wrench, Tag, Eye, DoorOpen, KeyRound, BellRing } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  PROPERTY_KIND_LABELS, RENT_FREQUENCY_LABELS, collectLeaseAlerts, leaseEndDate,
  type PropertyKind, type PropertyOwnership, type RentFrequency, type Property, type Lease,
} from '../../core/realestate.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { TerminalPaymentPicker, type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
const emptyTerminalPayment = (): TerminalPaymentDraft => ({ terminalId: '', providerReference: '', cardLast4: '' })

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
  const { properties, propertyUnits, employees, addProperty, addPropertyUnit, getOwnerBalance, payPropertyOwner, addUnitMaintenance, sellProperty, addStaffCommission } = useDataStore()
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
  const [unitCodes, setUnitCodes] = useState('')

  const saveProperty = () => {
    try {
      const p = addProperty({
        nameAr, kind, ownership,
        ownerName: ownership === 'managed' ? ownerName : '',
        commissionPercent: ownership === 'managed' ? Number(commission) || 0 : 0,
        address, costMinor: ownership === 'owned' && cost ? toMinor(cost, cur.decimals) : 0,
        notes: '', unitCodes: unitCodes.split('\n').map((x) => x.trim()).filter(Boolean),
        acquisitionPayment: payMode, treasury,
      })
      toast.show(`أُنشئ العقار ${p.code} ✅`)
      setOpen(false); setNameAr(''); setOwnerName(''); setAddress(''); setCost(''); setUnitCodes('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* وحدة جديدة */
  const [unitFor, setUnitFor] = useState<Property | null>(null)
  const [uCode, setUCode] = useState('')
  const [uRent, setURent] = useState('')
  const saveUnit = () => {
    if (!unitFor) return
    try {
      addPropertyUnit({ propertyId: unitFor.id, code: uCode, annualRentMinor: uRent ? toMinor(uRent, cur.decimals) : 0 })
      toast.show('أُضيفت الوحدة ✅'); setUnitFor(null); setUCode(''); setURent('')
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
  const [sPay, setSPay] = useState<'cash' | 'credit'>('cash')
  const [sTreasury, setSTreasury] = useState('1101')
  // عمولة موظف عن البيع (طلب المالك): استحقاق مربوط بالعقار المباع
  const [sCommEmpId, setSCommEmpId] = useState('')
  const [sCommAmount, setSCommAmount] = useState('')
  const saveSale = () => {
    if (!sellFor) return
    try {
      sellProperty({ propertyId: sellFor.id, salePriceMinor: toMinor(sPrice, cur.decimals), payment: sPay, treasury: sTreasury })
      if (sCommEmpId && sCommAmount.trim()) {
        addStaffCommission({
          employeeId: Number(sCommEmpId), source: 'property_sale', sourceId: sellFor.id,
          description: `عمولة بيع عقار «${sellFor.nameAr}»`,
          amountMinor: toMinor(sCommAmount, cur.decimals),
        })
      }
      toast.show(`بيع العقار وقُيد الربح${sCommEmpId && sCommAmount.trim() ? ' + استحقاق عمولة الموظف' : ''} ✅`); setSellFor(null); setSPrice(''); setSCommEmpId(''); setSCommAmount('')
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
                      الوحدات: {units.length} ({leased} مؤجرة / {units.length - leased} شاغرة)
                      {p.ownership === 'managed' && <> · مستحق المالك: <b className={balance > 0 ? 'text-rose-500' : 'text-emerald-600'}>{fmt(balance)}</b></>}
                    </div>
                  </div>
                  {p.status === 'active' && (
                    <div className="flex gap-1">
                      <button onClick={() => { setUnitFor(p); setUCode(''); setURent('') }} title="وحدة جديدة" className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all hover:scale-110"><DoorOpen className="w-4 h-4" /></button>
                      <button onClick={() => { setMaintFor(p); setMUnitId(units[0]?.id ?? ''); setMBearer(p.ownership === 'managed' ? 'owner' : 'office') }} title="صيانة وحدة" className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><Wrench className="w-4 h-4" /></button>
                      {p.ownership === 'managed' && (
                        <button onClick={() => { setPayFor(p); setPayAmount('') }} title="سداد للمالك" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><HandCoins className="w-4 h-4" /></button>
                      )}
                      {p.ownership === 'owned' && (
                        <button onClick={() => { setSellFor(p); setSPrice('') }} title="بيع العقار" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Tag className="w-4 h-4" /></button>
                      )}
                    </div>
                  )}
                </div>
                {units.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {units.map((u) => (
                      <span key={u.id} className={`text-[11px] px-2 py-1 rounded-lg font-bold ${u.status === 'leased' ? 'bg-teal-500/10 text-teal-600' : u.status === 'maintenance' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-500'}`}>
                        {u.code} · {u.status === 'leased' ? 'مؤجرة' : u.status === 'maintenance' ? 'صيانة' : 'شاغرة'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* عقار جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عقار جديد" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setOwnership('owned')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${ownership === 'owned' ? 'border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🏢 مملوك لي — الإيراد كله للمكتب</button>
            <button onClick={() => setOwnership('managed')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${ownership === 'managed' ? 'border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🤝 إدارة أملاك الغير — أكسب السعي</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم العقار *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="برج الياسمين…" autoFocus /></Field>
            <Field label="النوع">
              <select value={kind} onChange={(e) => setKind(e.target.value as PropertyKind)} className={inputCls}>
                {Object.entries(PROPERTY_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.nameAr}</option>)}
              </select>
            </Field>
            {ownership === 'managed' ? (
              <>
                <Field label="اسم المالك *"><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={inputCls} /></Field>
                <Field label="نسبة السعي ٪ *" hint="عمولة المكتب من كل تحصيلة — الباقي مستحق للمالك"><input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              </>
            ) : (
              <>
                <Field label={`تكلفة الاقتناء (${cur.symbol})`} hint="تُرسمل على 1113 — أساس ربح البيع لاحقاً؛ اتركها 0 لعقار قديم مُقيد سابقاً"><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
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
          <Field label="الوحدات الأولية (سطر لكل وحدة)" hint="مثال: شقة 1 — الدور الأول؛ يمكنك الإضافة لاحقاً">
            <textarea value={unitCodes} onChange={(e) => setUnitCodes(e.target.value)} rows={3} className={inputCls + ' !h-auto'} placeholder={'شقة 1\nشقة 2\nمحل أ'} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveProperty} disabled={!nameAr.trim()}>إنشاء العقار</Btn>
          </div>
        </div>
      </Modal>

      {/* وحدة جديدة */}
      <Modal open={!!unitFor} onClose={() => setUnitFor(null)} title={unitFor ? `وحدة جديدة — ${unitFor.nameAr}` : ''}>
        <div className="space-y-3">
          <Field label="كود الوحدة *"><input value={uCode} onChange={(e) => setUCode(e.target.value)} className={inputCls} placeholder="شقة 5 — الدور الثاني" /></Field>
          <Field label={`الأجرة السنوية الاسترشادية (${cur.symbol})`}><input value={uRent} onChange={(e) => setURent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setUnitFor(null)}>إلغاء</Btn><Btn onClick={saveUnit} disabled={!uCode.trim()}>إضافة</Btn></div>
        </div>
      </Modal>

      {/* سداد مالك */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `سداد للمالك — ${payFor.ownerName}` : ''}>
        {payFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500">مستحقه الآن: <b className="text-rose-500">{fmt(getOwnerBalance(payFor.id))}</b> (تحصيلاته − سداداته − صيانة على حسابه)</div>
            <Field label={`المبلغ (${cur.symbol})`}><input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <TreasuryPicker value={payTreasury} onChange={setPayTreasury} />
            <Btn onClick={savePayout} className="w-full" disabled={!payAmount}>سداد وقيد 2115 ← الخزينة</Btn>
          </div>
        )}
      </Modal>

      {/* صيانة وحدة */}
      <Modal open={!!maintFor} onClose={() => setMaintFor(null)} title={maintFor ? `صيانة وحدة — ${maintFor.nameAr}` : ''}>
        {maintFor && (
          <div className="space-y-3">
            <Field label="الوحدة">
              <select value={mUnitId} onChange={(e) => setMUnitId(Number(e.target.value))} className={inputCls}>
                {propertyUnits.filter((u) => u.propertyId === maintFor.id).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
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
            <Btn onClick={saveMaint} className="w-full" disabled={!mAmount || mUnitId === ''}>تسجيل الصيانة وقيدها</Btn>
          </div>
        )}
      </Modal>

      {/* بيع عقار */}
      <Modal open={!!sellFor} onClose={() => setSellFor(null)} title={sellFor ? `بيع العقار — ${sellFor.nameAr}` : ''}>
        {sellFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-teal-500/10 border border-teal-500/30 p-3 text-[12px] font-bold text-teal-700 dark:text-teal-300">
              التكلفة الدفترية {fmt(sellFor.costMinor)} — البيع يقيد الإيراد (4115) والتكلفة (5116) ويخرج العقار من الأصول (1113). لا بيع وعلى العقار عقود نشطة.
            </div>
            <Field label={`سعر البيع (${cur.symbol}) *`}><input value={sPrice} onChange={(e) => setSPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="التحصيل">
              <div className="flex gap-2">
                {(['cash', 'credit'] as const).map((m) => (
                  <button key={m} onClick={() => setSPay(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${sPay === m ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>{m === 'cash' ? 'نقدي' : 'آجل (مدينون)'}</button>
                ))}
              </div>
              {sPay === 'cash' && <div className="mt-2"><TreasuryPicker value={sTreasury} onChange={setSTreasury} compact /></div>}
            </Field>
            <Field label="عمولة موظف (اختياري)" hint="الموظف الذي أتم الصفقة — مصروف مربوط بالبيع يدخل ربحيته">
              <div className="grid grid-cols-2 gap-2">
                <select value={sCommEmpId} onChange={(e) => setSCommEmpId(e.target.value)} className={inputCls}>
                  <option value="">— بلا عمولة —</option>
                  {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
                </select>
                <input value={sCommAmount} onChange={(e) => setSCommAmount(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder={`المبلغ (${cur.symbol})`} disabled={!sCommEmpId} />
              </div>
            </Field>
            <Btn onClick={saveSale} className="w-full" disabled={!sPrice || (!!sCommEmpId && !sCommAmount.trim())}>بيع وقيد الربح</Btn>
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
  const [unitId, setUnitId] = useState<number | ''>('')
  const [tenant, setTenant] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [startDate, setStartDate] = useState(todayIso)
  const [months, setMonths] = useState('12')
  const [frequency, setFrequency] = useState<RentFrequency>('quarterly')
  const [totalRent, setTotalRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [ejar, setEjar] = useState('')
  const [leaseTreasury, setLeaseTreasury] = useState('1101')
  // عمولة موظف عن العقد (طلب المالك): تُستحق مصروفاً مربوطاً بالعقد وتُصرف مع الراتب أو منفردة
  const [commEmpId, setCommEmpId] = useState('')
  const [commAmount, setCommAmount] = useState('')
  const activeProps = properties.filter((p) => p.status === 'active')
  const vacantUnits = useMemo(() => propertyUnits.filter((u) => u.propertyId === propId && u.status === 'vacant'), [propertyUnits, propId])

  const saveLease = () => {
    try {
      if (propId === '' || unitId === '') throw new Error('اختر العقار والوحدة')
      const l = addLease({
        propertyId: propId, unitId, tenantName: tenant, tenantId: tenantId ? Number(tenantId) : null,
        startDate, months: Number(months) || 0, frequency, totalRentMinor: toMinor(totalRent, cur.decimals),
        depositMinor: deposit ? toMinor(deposit, cur.decimals) : 0, ejarNumber: ejar, treasury: leaseTreasury,
      })
      // عمولة الموظف المسوّق (اختيارية): استحقاق مربوط بالعقد — تظهر في «الموظفون ← العمولات»
      if (commEmpId && commAmount.trim()) {
        const unit = propertyUnits.find((u) => u.id === unitId)
        addStaffCommission({
          employeeId: Number(commEmpId), source: 'lease', sourceId: l.id,
          description: `عمولة تأجير ${unit?.code ?? ''} — عقد ${l.contractNumber}`,
          amountMinor: toMinor(commAmount, cur.decimals),
        })
      }
      toast.show(`أُنشئ العقد ${l.contractNumber} بجدول ${l.installments.length} قسطاً${commEmpId && commAmount.trim() ? ' + استحقاق عمولة الموظف' : ''} ✅`)
      setOpen(false); setTenant(''); setTotalRent(''); setDeposit(''); setEjar(''); setUnitId(''); setCommEmpId(''); setCommAmount('')
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
      if (terminal && !colTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
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
                      {propName(l.propertyId)} · {unitCode(l.unitId)} · {l.months} شهراً {RENT_FREQUENCY_LABELS[l.frequency].nameAr} · من {l.startDate} إلى {leaseEndDate(l.startDate, l.months)}
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
              <select value={propId} onChange={(e) => { setPropId(Number(e.target.value)); setUnitId('') }} className={inputCls}>
                {activeProps.map((p) => <option key={p.id} value={p.id}>{p.nameAr}{p.ownership === 'managed' ? ` (سعي ${p.commissionPercent}٪)` : ''}</option>)}
              </select>
            </Field>
            <Field label="الوحدة الشاغرة *">
              <select value={unitId} onChange={(e) => setUnitId(Number(e.target.value))} className={inputCls}>
                <option value="">— اختر —</option>
                {vacantUnits.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
            </Field>
            <Field label="اسم المستأجر *"><input value={tenant} onChange={(e) => setTenant(e.target.value)} className={inputCls} /></Field>
            <Field label="ربط بسجل عميل (إداري)">
              <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={inputCls}>
                <option value="">— بلا ربط —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label="بداية العقد *"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="المدة بالأشهر *"><input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
            <Field label="دورية السداد">
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as RentFrequency)} className={inputCls}>
                {Object.entries(RENT_FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.nameAr}</option>)}
              </select>
            </Field>
            <Field label={`إجمالي أجرة كامل المدة (${cur.symbol}) *`}><input value={totalRent} onChange={(e) => setTotalRent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label={`التأمين المسترد (${cur.symbol})`} hint="يقيد التزاماً (2103) ويُرد عند الإخلاء ناقص الأضرار"><input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="رقم توثيق منصة إيجار" hint="السعودية: رقم العقد الموثق في المنصة الحكومية"><input value={ejar} onChange={(e) => setEjar(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="عمولة موظف (اختياري)" hint="الموظف الذي سوّق العقد — تُستحق مصروفاً مربوطاً به">
              <select value={commEmpId} onChange={(e) => setCommEmpId(e.target.value)} className={inputCls}>
                <option value="">— بلا عمولة —</option>
                {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
              </select>
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
            <Btn onClick={saveLease} disabled={!tenant.trim() || !totalRent || unitId === ''}>إنشاء العقد وتوليد الأقساط</Btn>
          </div>
        </div>
      </Modal>

      {/* تحصيل الأقساط */}
      <Modal open={!!collectFor} onClose={() => setCollectFor(null)} title={collectFor ? `تحصيل — ${collectFor.contractNumber} (${collectFor.tenantName})` : ''} wide>
        {collectFor && (
          <div className="space-y-3">
            <TerminalPaymentPicker value={colTerminal} onChange={setColTerminal} />
            {!colTerminal.terminalId && <TreasuryPicker value={colTreasury} onChange={setColTreasury} />}
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
            <Btn onClick={saveEnd} className="w-full">إنهاء العقد وتسوية التأمين</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
