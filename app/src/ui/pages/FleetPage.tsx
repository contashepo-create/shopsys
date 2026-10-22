import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الأسطول والسائقون (المرحلة 6 — نمط logistics-web):
 * سجل المركبات مع سائق افتراضي، والسائقون من قسم الموظفين
 * (المسمى الوظيفي «سائق») — مصدر واحد للأشخاص، لا تكرار.
 */
import { useMemo, useState } from 'react'
import { Plus, Truck, Pencil, Trash2, UserRound, Route, Wrench, AlertTriangle } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Vehicle } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { isDriverEmployee } from '../../core/jobTitles.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { buildVehicleReport, vehicleReportCategories, type VehicleReportKind } from '../../core/vehicleReports.ts'
import { vehicleComplianceWarnings, vehicleFuelStats, fuelDeviationWarnings, VEHICLE_COST_LABELS, type VehicleCostKind } from '../../core/logistics.ts'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { todayLocalIso } from '../../core/time.ts'

const VEHICLE_TYPES = ['تريلا', 'قلاب', 'دينا', 'سطحة', 'براد', 'صهريج', 'أخرى']
const VEHICLE_COST_KINDS: VehicleCostKind[] = ['fuel', 'maintenance', 'parts', 'tolls', 'other']

export function FleetPage() {
  const { vehicles, employees, trips, vehicleCostEntries, vehicleParts, addVehicle, updateVehicle, removeVehicle, addVehicleExpense, addEmployee } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toast = useToast()
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState('')
  const [reportVehicleId, setReportVehicleId] = useState('')
  const [reportKind, setReportKind] = useState<VehicleReportKind>('all')
  const [reportCategory, setReportCategory] = useState('all')

  const drivers = useMemo(
    () => [...employees.filter((e) => e.active)].sort((a, b) => Number(isDriverEmployee(b)) - Number(isDriverEmployee(a))),
    [employees],
  )
  const [quickDrvOpen, setQuickDrvOpen] = useState(false)
  const [quickDrvName, setQuickDrvName] = useState('')
  const [quickDrvPhone, setQuickDrvPhone] = useState('')
  const [quickDrvSalary, setQuickDrvSalary] = useState('')
  const saveQuickDriver = () => {
    if (!quickDrvName.trim()) return
    addEmployee({
      ...EMPTY_EXTENDED,
      nameAr: quickDrvName.trim(),
      phone: quickDrvPhone.trim(),
      jobTitle: 'سائق نقل ثقيل',
      hireDate: todayLocalIso(),
      baseSalaryMinor: quickDrvSalary.trim() ? toMinor(quickDrvSalary, cur.decimals) : 0,
      allowancesMinor: 0,
      active: true,
      notes: 'سُجّل كسائق من شاشة الأسطول',
    })
    const newest = useDataStore.getState().employees.at(-1)
    if (newest) setDriverId(String(newest.id))
    setQuickDrvName(''); setQuickDrvPhone(''); setQuickDrvSalary(''); setQuickDrvOpen(false)
    toast.show(`سُجّل السائق «${newest?.nameAr ?? ''}» في الموظفين ورُبط بالمركبة ✅`)
  }
  const driverName = (id: number | null) => (id == null ? '—' : employees.find((e) => e.id === id)?.nameAr ?? '—')
  const reportCategories = useMemo(() => vehicleReportCategories(vehicleCostEntries), [vehicleCostEntries])
  const reportRows = useMemo(() => buildVehicleReport(vehicles, trips, vehicleCostEntries, {
    from: reportFrom || undefined,
    to: reportTo || undefined,
    vehicleId: reportVehicleId ? Number(reportVehicleId) : null,
    kind: reportKind,
    category: reportCategory,
  }), [vehicles, trips, vehicleCostEntries, reportFrom, reportTo, reportVehicleId, reportKind, reportCategory])
  const reportByVehicle = useMemo(() => new Map(reportRows.map((row) => [row.vehicleId, row])), [reportRows])
  const visibleVehicles = useMemo(() => vehicles.filter((vehicle) => !reportVehicleId || vehicle.id === Number(reportVehicleId)), [vehicles, reportVehicleId])
  const filteredEntries = useMemo(() => vehicleCostEntries.filter((entry) => {
    const day = entry.date.slice(0, 10)
    return (!reportFrom || day >= reportFrom) && (!reportTo || day <= reportTo)
      && (!reportVehicleId || entry.vehicleId === Number(reportVehicleId))
      && (reportKind === 'all' || entry.kind === reportKind)
      && (reportCategory === 'all' || (entry.category ?? entry.description) === reportCategory)
  }), [vehicleCostEntries, reportFrom, reportTo, reportVehicleId, reportKind, reportCategory])

  // تنبيهات امتثال المركبات: رخصة/تأمين تقترب أو انتهت (سد فجوة تقرير النشاط #9 — Immediate #1)
  const complianceWarnings = useMemo(() => vehicleComplianceWarnings(vehicles, todayLocalIso(), 30), [vehicles])
  // تحليل استهلاك الوقود لكل مركبة وانحرافاته عن متوسط الأسطول (سد فجوة تقرير النشاط #9 — Future #2)
  const fuelStats = useMemo(() => vehicleFuelStats(trips), [trips])
  const fuelWarnings = useMemo(() => fuelDeviationWarnings(fuelStats), [fuelStats])

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [plate, setPlate] = useState('')
  const [vtype, setVtype] = useState(VEHICLE_TYPES[0])
  const [driverId, setDriverId] = useState('')
  const [notes, setNotes] = useState('')
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('')
  const [insuranceExpiryDate, setInsuranceExpiryDate] = useState('')

  const openNew = () => {
    setEditing(null); setPlate(''); setVtype(VEHICLE_TYPES[0]); setDriverId(''); setNotes('')
    setLicenseExpiryDate(''); setInsuranceExpiryDate(''); setOpen(true)
  }
  const openEdit = (v: Vehicle) => {
    setEditing(v); setPlate(v.plateNumber); setVtype(v.vehicleType)
    setDriverId(v.defaultDriverId ? String(v.defaultDriverId) : ''); setNotes(v.notes)
    setLicenseExpiryDate(v.licenseExpiryDate ?? ''); setInsuranceExpiryDate(v.insuranceExpiryDate ?? ''); setOpen(true)
  }
  const save = () => {
    if (!plate.trim()) return
    const data = {
      plateNumber: plate.trim(),
      vehicleType: vtype,
      defaultDriverId: driverId ? Number(driverId) : null,
      notes: notes.trim(),
      licenseExpiryDate: licenseExpiryDate || null,
      insuranceExpiryDate: insuranceExpiryDate || null,
    }
    if (editing) { updateVehicle(editing.id, data); toast.show('تم تعديل المركبة') }
    else { addVehicle(data); toast.show(`أُضيفت المركبة «${data.plateNumber}»`) }
    setOpen(false)
  }
  const remove = (v: Vehicle) => {
    try { removeVehicle(v.id); toast.show(`حُذفت «${v.plateNumber}»`) }
    catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── تسجيل مصروف مركبة مبسَّط من شاشة الأسطول مباشرة (سد فجوة تقرير النشاط #9 — Immediate #3) ─── */
  const [expenseVehicle, setExpenseVehicle] = useState<Vehicle | null>(null)
  const [expenseKind, setExpenseKind] = useState<VehicleCostKind>('fuel')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDesc, setExpenseDesc] = useState('')
  const [expenseTreasury, setExpenseTreasury] = useState('1101')
  const [expensePartId, setExpensePartId] = useState('')
  const [expensePartQty, setExpensePartQty] = useState('1')
  const availableParts = useMemo(() => vehicleParts.filter((p) => p.qty > 0), [vehicleParts])

  const openExpense = (v: Vehicle) => {
    setExpenseVehicle(v); setExpenseKind('fuel'); setExpenseAmount(''); setExpenseDesc('')
    setExpenseTreasury('1101'); setExpensePartId(''); setExpensePartQty('1')
  }
  const saveExpense = () => {
    if (!expenseVehicle) return
    try {
      const partId = expenseKind === 'parts' && expensePartId ? Number(expensePartId) : null
      const entry = addVehicleExpense({
        vehicleId: expenseVehicle.id,
        kind: expenseKind,
        amountMinor: expenseAmount.trim() ? toMinor(expenseAmount, cur.decimals) : undefined,
        description: expenseDesc.trim(),
        treasury: expenseTreasury,
        partId,
        partQty: partId ? Number(expensePartQty) || 0 : undefined,
      })
      toast.show(`سُجل مصروف ${VEHICLE_COST_LABELS[expenseKind]} على «${expenseVehicle.plateNumber}» بمبلغ ${fmt(entry.amountMinor)} ✅`)
      setExpenseVehicle(null)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between">
        <div className="text-[12px] text-slate-400">
          السائقون يُسجَّلون من <b>الأطراف ← الموظفون</b> (على رأس العمل) ويظهرون هنا للاختيار
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> مركبة جديدة</span></Btn>
      </div>

      <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-black text-slate-800 dark:text-white">📊 تقرير مراكز تكلفة السيارات</h2>
            <p className="text-[11px] text-slate-400 mt-1">إيرادات النقل والنولون مقابل الصيانة والوقود وقطع الغيار، مع فصل المستحق عن المسدد.</p>
          </div>
          <button onClick={() => { setReportFrom(''); setReportTo(''); setReportVehicleId(''); setReportKind('all'); setReportCategory('all') }} className="text-[11px] text-brand-600 hover:underline">إعادة ضبط الفلاتر</button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <Field label="من تاريخ"><input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="إلى تاريخ"><input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className={inputCls} /></Field>
          <Field label="السيارة"><QuickSelect value={reportVehicleId} onChange={(e) => setReportVehicleId(e.target.value)} className={inputCls}><option value="">كل السيارات</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber}</option>)}</QuickSelect></Field>
          <Field label="نوع الحركة"><QuickSelect value={reportKind} onChange={(e) => setReportKind(e.target.value as VehicleReportKind)} className={inputCls}><option value="all">كل الحركات</option><option value="internal_revenue">نولون/تحميلات</option><option value="cost">مصروفات تشغيل</option></QuickSelect></Field>
          <Field label="نوع المصروف"><QuickSelect value={reportCategory} onChange={(e) => setReportCategory(e.target.value)} className={inputCls}><option value="all">كل الأنواع</option>{reportCategories.map((category) => <option key={category} value={category}>{category}</option>)}</QuickSelect></Field>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[12px]">
          <div className="rounded-xl bg-emerald-500/10 p-3"><span className="text-slate-500">إجمالي الإيرادات</span><b className="block text-emerald-600 text-lg">{fmt(reportRows.reduce((sum, row) => sum + row.totalRevenueMinor, 0))}</b></div>
          <div className="rounded-xl bg-rose-500/10 p-3"><span className="text-slate-500">إجمالي التكاليف</span><b className="block text-rose-600 text-lg">{fmt(reportRows.reduce((sum, row) => sum + row.operatingCostMinor, 0))}</b></div>
          <div className="rounded-xl bg-violet-500/10 p-3"><span className="text-slate-500">مستحق غير مسدد</span><b className="block text-violet-600 text-lg">{fmt(reportRows.reduce((sum, row) => sum + row.accruedCostMinor, 0))}</b></div>
          <div className="rounded-xl bg-sky-500/10 p-3"><span className="text-slate-500">صافي الأسطول</span><b className="block text-sky-600 text-lg">{fmt(reportRows.reduce((sum, row) => sum + row.netMinor, 0))}</b></div>
        </div>
        {reportRows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full text-[11px] min-w-[720px]"><thead><tr className="text-slate-400 border-b border-slate-100 dark:border-slate-800"><th className="p-2 text-right">السيارة</th><th className="p-2 text-right">النقل</th><th className="p-2 text-right">النولون</th><th className="p-2 text-right">التكاليف</th><th className="p-2 text-right">المسدد</th><th className="p-2 text-right">المستحق</th><th className="p-2 text-right">الصافي</th><th className="p-2 text-right">النقلات</th></tr></thead><tbody>{[...reportRows].sort((a, b) => b.netMinor - a.netMinor).map((row) => <tr key={row.vehicleId} className="border-b border-slate-50 dark:border-slate-800/50"><td className="p-2 font-bold">{vehicles.find((vehicle) => vehicle.id === row.vehicleId)?.plateNumber ?? '—'}</td><td className="p-2">{fmt(row.tripRevenueMinor)}</td><td className="p-2">{fmt(row.freightRevenueMinor)}</td><td className="p-2 text-rose-500">{fmt(row.operatingCostMinor)}</td><td className="p-2 text-emerald-600">{fmt(row.paidCostMinor)}</td><td className="p-2 text-violet-600">{fmt(row.accruedCostMinor)}</td><td className={`p-2 font-black ${row.netMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.netMinor)}</td><td className="p-2">{row.tripCount}</td></tr>)}</tbody></table>
          </div>
        )}
      </section>

      {complianceWarnings.length > 0 && (
        <section className="anim-up rounded-2xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black text-sm flex items-center gap-1.5">
            <AlertTriangle size={14} /> تنبيهات رخصة وتأمين المركبات
          </div>
          <div className="p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11.5px]">
            {complianceWarnings.map((c) => (
              <div key={`${c.kind}:${c.vehicleId}`} className={`rounded-xl p-2.5 ${c.daysLeft < 0 ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
                <b>{c.vehiclePlate}</b> · {c.kind === 'license' ? 'رخصة' : 'تأمين'}
                <div className="opacity-80">{c.daysLeft < 0 ? `منتهية منذ ${-c.daysLeft} يوماً (${c.dueDate})` : `تنتهي خلال ${c.daysLeft} يوماً (${c.dueDate})`}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fuelWarnings.length > 0 && (
        <section className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-sky-500/20 p-4 text-[11.5px] space-y-2">
          <div className="font-black text-sky-700 dark:text-sky-300">⛽ انحراف استهلاك الوقود عن متوسط الأسطول</div>
          <div className="text-slate-400">مبني على مصاريف «سولار» المسجَّلة فعلاً بالنقلات — بلا أي عداد مسافة أو تكامل تتبع.</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {fuelWarnings.map((w) => (
              <div key={w.vehicleId} className="rounded-xl bg-sky-500/10 p-2.5">
                <b>{vehicles.find((v) => v.id === w.vehicleId)?.plateNumber ?? '—'}</b>
                <div className="text-slate-500">متوسطها {fmt(w.avgFuelPerTripMinor)}/نقلة مقابل متوسط الأسطول {fmt(w.fleetAvgMinor)} (+{w.deviationPercent}٪)</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {vehicles.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚚" title="لا مركبات بعد" sub="أضف مركبات الأسطول ثم سجّل النقلات من شاشة النقلات" />
        </div>
      ) : (
        <div className="anim-up grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ animationDelay: '60ms' }}>
          {visibleVehicles.map((v) => (
            <div key={v.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 hover:border-fuchsia-400/40 transition-colors group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-fuchsia-500/10 text-fuchsia-600 flex items-center justify-center"><Truck size={18} /></div>
                  <div>
                    <div className="font-black text-slate-800 dark:text-white" dir="ltr">{v.plateNumber}</div>
                    <div className="text-[11px] text-slate-400">{v.vehicleType}</div>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                  <button onClick={() => openExpense(v)} title="تسجيل مصروف مركبة" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all"><Wrench size={13} /></button>
                  <button onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all"><Pencil size={13} /></button>
                  <button onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-1 text-slate-500"><UserRound size={12} /> {driverName(v.defaultDriverId)}</span>
                <span className="flex items-center gap-1 text-fuchsia-600 font-bold"><Route size={12} /> {reportByVehicle.get(v.id)?.tripCount ?? 0} نقلة</span>
              </div>
              {(() => { const report = reportByVehicle.get(v.id) ?? { tripRevenueMinor: 0, freightRevenueMinor: 0, operatingCostMinor: 0, accruedCostMinor: 0, paidCostMinor: 0, totalRevenueMinor: 0, netMinor: 0, tripCount: 0, costEntryCount: 0 }; return (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-400">إيراد النقل</span><b className="text-emerald-600">{fmt(report.tripRevenueMinor)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-400">إيراد النولون/التحميل</span><b className="text-emerald-600">{fmt(report.freightRevenueMinor)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-400">التكاليف والمصروفات</span><b className="text-rose-500">{fmt(report.operatingCostMinor)}</b></div>
                  <div className="flex justify-between font-black"><span>صافي مركز التكلفة</span><b className={report.netMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(report.netMinor)}</b></div>
                  {report.accruedCostMinor > 0 && <div className="text-[10px] text-violet-600">تكاليف مستحقة غير مسددة: {fmt(report.accruedCostMinor)}</div>}
                </div>
              ) })()}
            </div>
          ))}
        </div>
      )}

      {filteredEntries.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-violet-500/20 p-4 text-[11.5px]">
          <div className="font-black text-violet-700 dark:text-violet-300">دفتر مركز تكلفة الأسطول حسب الفلاتر</div>
          <div className="mt-1 text-slate-500">مصروف الشراء المرتبط بالمركبة يظهر كتحميل/إيراد داخلي هنا، وتكلفة الصيانة من سند الصرف تظهر كتدفق مستقل؛ لا تُنشئ هذه الشاشة قيد إيراد عام وهمياً.</div>
          <div className="mt-2 grid sm:grid-cols-3 gap-2">
            {filteredEntries.slice(-12).reverse().map((entry) => (
              <div key={entry.id} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2"><b>{vehicles.find((v) => v.id === entry.vehicleId)?.plateNumber ?? '—'}</b> · {entry.kind === 'internal_revenue' ? 'تحميل فاتورة' : 'مصروف تشغيل'}<div className="text-slate-400">{entry.category ?? entry.description} · {entry.description} · {fmt(entry.amountMinor)} · {entry.status === 'paid' ? 'مسدد' : 'مستحق'}</div></div>
            ))}
          </div>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل «${editing.plateNumber}»` : 'مركبة جديدة'}>
        <div className="space-y-4">
          <Field label="رقم اللوحة *">
            <input value={plate} onChange={(e) => setPlate(e.target.value)} className={inputCls} dir="ltr" autoFocus placeholder="أ ب ج 1234" />
          </Field>
          <Field label="نوع المركبة">
            <QuickSelect value={vtype} onChange={(e) => setVtype(e.target.value)} className={inputCls}>
              {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </QuickSelect>
          </Field>
          <Field label="السائق الافتراضي (من الموظفين)" hint="يُربط بالمركبة ويُقترح تلقائياً عند تسجيل فاتورة نقل بها">
            <div className="space-y-2" data-vehicle-driver-picker>
              <PartyQuickPicker
                parties={drivers.map((driver) => ({
                  ...driver,
                  nameAr: `${isDriverEmployee(driver) ? '👨‍✈️ ' : ''}${driver.nameAr}${driver.jobTitle ? ` — ${driver.jobTitle}` : ''}`,
                }))}
                value={driverId ? Number(driverId) : 0}
                onChange={(id) => setDriverId(id ? String(id) : '')}
                cashLabel="بلا سائق افتراضي"
                label="بحث السائق من الموظفين"
                cashValue={0}
              />
              <button type="button" onClick={() => setQuickDrvOpen((v) => !v)} className="text-[11px] font-bold text-fuchsia-600 hover:underline">
                {quickDrvOpen ? 'إخفاء نموذج السائق السريع' : '+ تسجيل سائق جديد في الموظفين وربطه بالمركبة'}
              </button>
              {quickDrvOpen && (
                <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-2.5 space-y-2">
                  <div className="text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300">تسجيل موظف جديد بمسمى «سائق نقل ثقيل»</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input value={quickDrvName} onChange={(e) => setQuickDrvName(e.target.value)} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="اسم السائق *" />
                    <input value={quickDrvPhone} onChange={(e) => setQuickDrvPhone(e.target.value)} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="رقم الهاتف" dir="ltr" />
                    <input value={quickDrvSalary} onChange={(e) => setQuickDrvSalary(e.target.value)} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder={`الراتب (${cur.symbol})`} dir="ltr" inputMode="decimal" />
                  </div>
                  <div className="flex justify-end">
                    <Btn onClick={saveQuickDriver} disabled={!quickDrvName.trim()}>حفظ السائق وربطه</Btn>
                  </div>
                </div>
              )}
            </div>
          </Field>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="تجديد الرخصة" hint="تنبيه مركزي قبل 30 يوماً من الانتهاء">
              <input type="date" value={licenseExpiryDate} onChange={(e) => setLicenseExpiryDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="تجديد التأمين" hint="تنبيه مركزي قبل 30 يوماً من الانتهاء">
              <input type="date" value={insuranceExpiryDate} onChange={(e) => setInsuranceExpiryDate(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!plate.trim()}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!expenseVehicle} onClose={() => setExpenseVehicle(null)} title={expenseVehicle ? `تسجيل مصروف — ${expenseVehicle.plateNumber}` : ''}>
        <div className="space-y-4">
          <Field label="نوع المصروف">
            <QuickSelect value={expenseKind} onChange={(e) => setExpenseKind(e.target.value as VehicleCostKind)} className={inputCls}>
              {VEHICLE_COST_KINDS.map((k) => <option key={k} value={k}>{VEHICLE_COST_LABELS[k]}</option>)}
            </QuickSelect>
          </Field>
          {expenseKind === 'parts' && (
            <Field label="قطعة غيار من المخزون المبسَّط (اختياري)" hint="اختيارها يحسب المبلغ تلقائياً ويخصم الرصيد">
              <QuickSelect value={expensePartId} onChange={(e) => setExpensePartId(e.target.value)} className={inputCls}>
                <option value="">بدون — مبلغ حر</option>
                {availableParts.map((p) => <option key={p.id} value={p.id}>{p.nameAr} — متاح {p.qty} × {fmt(p.unitCostMinor)}</option>)}
              </QuickSelect>
            </Field>
          )}
          {expenseKind === 'parts' && expensePartId && (
            <Field label="الكمية">
              <input type="number" min="1" value={expensePartQty} onChange={(e) => setExpensePartQty(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
          )}
          <Field label={expensePartId && expenseKind === 'parts' ? 'المبلغ (محسوب تلقائياً — اتركه فارغاً)' : 'المبلغ'}>
            <input value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0.00" />
          </Field>
          <Field label="بيان">
            <input value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} className={inputCls} />
          </Field>
          <Field label="الخزينة/البنك">
            <TreasuryPicker value={expenseTreasury} onChange={setExpenseTreasury} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setExpenseVehicle(null)}>إلغاء</Btn>
            <Btn onClick={saveExpense} disabled={!expenseAmount.trim() && !(expenseKind === 'parts' && expensePartId)}>💾 تسجيل وترحيل القيد</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
