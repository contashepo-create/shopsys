/**
 * الأسطول والسائقون (المرحلة 6 — نمط logistics-web):
 * سجل المركبات مع سائق افتراضي، والسائقون من قسم الموظفين
 * (المسمى الوظيفي «سائق») — مصدر واحد للأشخاص، لا تكرار.
 */
import { useMemo, useState } from 'react'
import { Plus, Truck, Pencil, Trash2, UserRound, Route } from 'lucide-react'
import { useDataStore, type Vehicle } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const VEHICLE_TYPES = ['تريلا', 'قلاب', 'دينا', 'سطحة', 'براد', 'صهريج', 'أخرى']

export function FleetPage() {
  const { vehicles, employees, trips, vehicleCostEntries, addVehicle, updateVehicle, removeVehicle } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toast = useToast()

  const drivers = useMemo(() => employees.filter((e) => e.active), [employees])
  const driverName = (id: number | null) => (id == null ? '—' : employees.find((e) => e.id === id)?.nameAr ?? '—')
  const tripCount = (vid: number) => trips.filter((t) => t.vehicleId === vid).length
  const vehicleReport = (vid: number) => {
    const tripRevenue = trips.filter((t) => t.vehicleId === vid).reduce((sum, trip) => sum + trip.totals.revenueMinor, 0)
    const entries = vehicleCostEntries.filter((entry) => entry.vehicleId === vid)
    const internalRevenue = entries.filter((entry) => entry.kind === 'internal_revenue').reduce((sum, entry) => sum + entry.amountMinor, 0)
    const costs = entries.filter((entry) => entry.kind === 'cost').reduce((sum, entry) => sum + entry.amountMinor, 0)
    return { tripRevenue, internalRevenue, costs, profit: tripRevenue + internalRevenue - costs, entries }
  }

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [plate, setPlate] = useState('')
  const [vtype, setVtype] = useState(VEHICLE_TYPES[0])
  const [driverId, setDriverId] = useState('')
  const [notes, setNotes] = useState('')

  const openNew = () => { setEditing(null); setPlate(''); setVtype(VEHICLE_TYPES[0]); setDriverId(''); setNotes(''); setOpen(true) }
  const openEdit = (v: Vehicle) => {
    setEditing(v); setPlate(v.plateNumber); setVtype(v.vehicleType)
    setDriverId(v.defaultDriverId ? String(v.defaultDriverId) : ''); setNotes(v.notes); setOpen(true)
  }
  const save = () => {
    if (!plate.trim()) return
    const data = {
      plateNumber: plate.trim(),
      vehicleType: vtype,
      defaultDriverId: driverId ? Number(driverId) : null,
      notes: notes.trim(),
    }
    if (editing) { updateVehicle(editing.id, data); toast.show('تم تعديل المركبة') }
    else { addVehicle(data); toast.show(`أُضيفت المركبة «${data.plateNumber}»`) }
    setOpen(false)
  }
  const remove = (v: Vehicle) => {
    try { removeVehicle(v.id); toast.show(`حُذفت «${v.plateNumber}»`) }
    catch (err) { toast.show((err as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between">
        <div className="text-[12px] text-slate-400">
          السائقون يُسجَّلون من <b>الأطراف ← الموظفون</b> (على رأس العمل) ويظهرون هنا للاختيار
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> مركبة جديدة</span></Btn>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚚" title="لا مركبات بعد" sub="أضف مركبات الأسطول ثم سجّل النقلات من شاشة النقلات" />
        </div>
      ) : (
        <div className="anim-up grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ animationDelay: '60ms' }}>
          {vehicles.map((v) => (
            <div key={v.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 hover:border-fuchsia-400/40 transition-colors group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-fuchsia-500/10 text-fuchsia-600 flex items-center justify-center"><Truck size={18} /></div>
                  <div>
                    <div className="font-black text-slate-800 dark:text-white" dir="ltr">{v.plateNumber}</div>
                    <div className="text-[11px] text-slate-400">{v.vehicleType}</div>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all"><Pencil size={13} /></button>
                  <button onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-1 text-slate-500"><UserRound size={12} /> {driverName(v.defaultDriverId)}</span>
                <span className="flex items-center gap-1 text-fuchsia-600 font-bold"><Route size={12} /> {tripCount(v.id)} نقلة</span>
              </div>
              {(() => { const report = vehicleReport(v.id); return (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-400">إيراد النقل + تحميلات الفواتير</span><b className="text-emerald-600">{fmt(report.tripRevenue + report.internalRevenue)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-400">تكاليف صيانة/تشغيل مسجلة</span><b className="text-rose-500">{fmt(report.costs)}</b></div>
                  <div className="flex justify-between font-black"><span>صافي مركز التكلفة</span><b className={report.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(report.profit)}</b></div>
                  {report.entries.some((entry) => entry.status !== 'paid') && <div className="text-[10px] text-violet-600">استحقاقات غير مسددة: {fmt(report.entries.filter((entry) => entry.status !== 'paid').reduce((sum, entry) => sum + entry.amountMinor, 0))}</div>}
                </div>
              ) })()}
            </div>
          ))}
        </div>
      )}

      {vehicleCostEntries.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-violet-500/20 p-4 text-[11.5px]">
          <div className="font-black text-violet-700 dark:text-violet-300">دفتر مركز تكلفة الأسطول</div>
          <div className="mt-1 text-slate-500">مصروف الشراء المرتبط بالمركبة يظهر كتحميل/إيراد داخلي هنا، وتكلفة الصيانة من سند الصرف تظهر كتدفق مستقل؛ لا تُنشئ هذه الشاشة قيد إيراد عام وهمياً.</div>
          <div className="mt-2 grid sm:grid-cols-3 gap-2">
            {vehicleCostEntries.slice(-6).reverse().map((entry) => (
              <div key={entry.id} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2"><b>{vehicles.find((v) => v.id === entry.vehicleId)?.plateNumber ?? '—'}</b> · {entry.kind === 'internal_revenue' ? 'تحميل فاتورة' : 'مصروف تشغيل'}<div className="text-slate-400">{entry.description} · {fmt(entry.amountMinor)} · {entry.status === 'paid' ? 'مسدد' : 'مستحق'}</div></div>
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
            <select value={vtype} onChange={(e) => setVtype(e.target.value)} className={inputCls}>
              {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="السائق الافتراضي" hint="يُقترح تلقائياً عند تسجيل نقلة بهذه المركبة">
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
              <option value="">بلا سائق افتراضي</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.nameAr}{d.jobTitle ? ` — ${d.jobTitle}` : ''}</option>)}
            </select>
          </Field>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!plate.trim()}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
