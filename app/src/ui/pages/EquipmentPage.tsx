/**
 * سجل المعدات الثقيلة (المرحلة 6 — القرار 13 + ترقية القرار 25):
 * معدة بأسعار ساعي/يومي/شهري + عدّاد ساعات (Hour Meter) + صيانة وقائية
 * كل N ساعة + وردانيات المشغلين. حذف المعدة ممنوع إن ارتبطت بعقود.
 */
import { useMemo, useState } from 'react'
import { Plus, Tractor, Pencil, Trash2, FileSpreadsheet, Gauge, Wrench, Users, Fuel } from 'lucide-react'
import { useDataStore, type Equipment } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { serviceStatus, shiftsSummary, EQUIPMENT_COST_LABELS, type EquipmentCostKind } from '../../core/rentalMeter.ts'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const EQUIPMENT_KINDS = ['حفار', 'لودر', 'بلدوزر', 'ونش', 'رافعة شوكية', 'مولد', 'ضاغط هواء', 'أخرى']

export function EquipmentPage() {
  const { equipment, rentalContracts, operatorShifts, equipmentCosts, addEquipment, updateEquipment, removeEquipment, addOperatorShift, recordEquipmentService, addEquipmentCost, getEquipmentProfit } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const contractCount = (eid: number) => rentalContracts.filter((c) => c.equipmentId === eid).length

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Equipment | null>(null)
  const [nameAr, setNameAr] = useState('')
  const [code, setCode] = useState('')
  const [dailyRate, setDailyRate] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [monthlyRate, setMonthlyRate] = useState('')
  const [meter, setMeter] = useState('')
  const [serviceEvery, setServiceEvery] = useState('')
  const [notes, setNotes] = useState('')

  // وردية مشغل
  const [shiftFor, setShiftFor] = useState<Equipment | null>(null)
  const [opName, setOpName] = useState('')
  const [shiftDate, setShiftDate] = useState('')
  const [shiftStart, setShiftStart] = useState('')
  const [shiftEnd, setShiftEnd] = useState('')
  const [shiftNotes, setShiftNotes] = useState('')

  const fmtRate = (m: number) => (m > 0 ? `${formatMinor(m, cur, false)} ${cur.symbol}` : '—')

  const openNew = () => {
    setEditing(null); setNameAr(''); setCode(''); setDailyRate(''); setHourlyRate(''); setMonthlyRate('')
    setMeter(''); setServiceEvery(''); setNotes(''); setOpen(true)
  }
  const openEdit = (e: Equipment) => {
    setEditing(e); setNameAr(e.nameAr); setCode(e.code)
    setDailyRate(e.dailyRateMinor ? formatMinor(e.dailyRateMinor, cur, false).replace(/,/g, '') : '')
    setHourlyRate(e.hourlyRateMinor ? formatMinor(e.hourlyRateMinor, cur, false).replace(/,/g, '') : '')
    setMonthlyRate(e.monthlyRateMinor ? formatMinor(e.monthlyRateMinor, cur, false).replace(/,/g, '') : '')
    setMeter(String(e.meterReading || ''))
    setServiceEvery(e.serviceEveryHours ? String(e.serviceEveryHours) : '')
    setNotes(e.notes); setOpen(true)
  }
  const save = () => {
    if (!nameAr.trim()) { toast.show('حدد اسم المعدة', 'error'); return }
    const payload = {
      nameAr: nameAr.trim(),
      code: code.trim(),
      dailyRateMinor: dailyRate.trim() ? toMinor(dailyRate, cur.decimals) : 0,
      hourlyRateMinor: hourlyRate.trim() ? toMinor(hourlyRate, cur.decimals) : 0,
      monthlyRateMinor: monthlyRate.trim() ? toMinor(monthlyRate, cur.decimals) : 0,
      meterReading: Math.max(0, Number(meter) || 0),
      serviceEveryHours: Math.max(0, Number(serviceEvery) || 0),
      lastServiceReading: editing?.lastServiceReading ?? 0,
      notes: notes.trim(),
    }
    if (editing) { updateEquipment(editing.id, payload); toast.show('عُدّلت المعدة ✅') }
    else { addEquipment(payload); toast.show('أُضيفت المعدة ✅') }
    setOpen(false)
  }
  const remove = (e: Equipment) => {
    try { removeEquipment(e.id); toast.show('حُذفت المعدة') }
    catch (err) { toast.show((err as Error).message, 'error') }
  }

  const openShift = (e: Equipment) => {
    setShiftFor(e); setOpName(''); setShiftDate(new Date().toISOString().slice(0, 10))
    setShiftStart(String(e.meterReading || '')); setShiftEnd(''); setShiftNotes('')
  }
  const saveShift = () => {
    if (!shiftFor) return
    try {
      addOperatorShift({
        equipmentId: shiftFor.id,
        operatorName: opName.trim(),
        date: shiftDate,
        startReading: Number(shiftStart),
        endReading: Number(shiftEnd),
        notes: shiftNotes.trim(),
      })
      toast.show(`سُجلت الوردية — عدّاد ${shiftFor.nameAr} تقدّم إلى ${shiftEnd} ⏱️`)
      setShiftFor(null)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const doService = (e: Equipment) => {
    recordEquipmentService(e.id)
    toast.show(`سُجلت خدمة صيانة «${e.nameAr}» عند قراءة ${e.meterReading} — بدأت فترة وقائية جديدة 🔧`)
  }

  /* مصروف تشغيل معدة (وقود/صيانة/إصلاح/مشغل) */
  const [costFor, setCostFor] = useState<Equipment | null>(null)
  const [costKind, setCostKind] = useState<EquipmentCostKind>('fuel')
  const [costAmount, setCostAmount] = useState('')
  const [costDesc, setCostDesc] = useState('')
  const [costTreasury, setCostTreasury] = useState('1101')
  const saveCost = () => {
    if (!costFor) return
    try {
      addEquipmentCost({ equipmentId: costFor.id, kind: costKind, amountMinor: toMinor(costAmount, cur.decimals), description: costDesc.trim(), treasury: costTreasury })
      toast.show('قُيد المصروف على 5105 ودخل ربحية المعدة ✅')
      setCostFor(null); setCostAmount(''); setCostDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-500 text-[13px] font-bold">
          <Tractor size={16} className="text-teal-600" /> المعدات ({equipment.length})
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> معدة جديدة</span></Btn>
      </div>

      {equipment.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚜" title="لا معدات بعد" sub="سجّل معداتك (حفار، لودر، ونش…) بأسعار ساعي/يومي/شهري وعدّاد ساعات ثم افتح عقود الإيجار" />
        </div>
      ) : (
        <div className="anim-up grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ animationDelay: '60ms' }}>
          {equipment.map((e) => {
            const svc = serviceStatus(e.lastServiceReading, e.serviceEveryHours, e.meterReading)
            const summary = shiftsSummary(operatorShifts, e.id)
            return (
              <div key={e.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md transition-all duration-200 group">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 flex items-center justify-center"><Tractor size={18} /></div>
                    <div>
                      <div className="font-black text-slate-800 dark:text-slate-100">{e.nameAr}</div>
                      {e.code && <div className="text-[11px] text-slate-400 font-mono" dir="ltr">{e.code}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all"><Pencil size={14} /></button>
                    <button onClick={() => remove(e)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all"><Trash2 size={14} /></button>
                  </div>
                </div>

                {/* الأسعار الثلاثة */}
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  {([['ساعة', e.hourlyRateMinor], ['يوم', e.dailyRateMinor], ['شهر', e.monthlyRateMinor]] as const).map(([u, m]) => (
                    <div key={u} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 py-1.5">
                      <div className="text-[10px] text-slate-400">{u}</div>
                      <div className="text-[11.5px] font-bold text-teal-600">{fmtRate(m)}</div>
                    </div>
                  ))}
                </div>

                {/* العدّاد */}
                <div className="mt-2 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400 flex items-center gap-1"><Gauge size={12} /> عدّاد الساعات</span>
                  <b className="font-mono" dir="ltr">{e.meterReading} h</b>
                </div>

                {/* الصيانة الوقائية */}
                {svc && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className={`flex items-center gap-1 font-bold ${svc.overdue ? 'text-rose-500' : 'text-slate-400'}`}>
                        <Wrench size={11} /> {svc.overdue ? `صيانة متأخرة ${Math.abs(svc.remainingHours)} ساعة!` : `الخدمة بعد ${svc.remainingHours} ساعة`}
                      </span>
                      <button onClick={() => doService(e)} className="text-[10px] font-bold text-teal-600 hover:underline">تمت الصيانة ✓</button>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${svc.overdue ? 'bg-rose-500' : svc.progress > 0.8 ? 'bg-amber-500' : 'bg-teal-500'}`}
                        style={{ width: `${Math.round(svc.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400 flex items-center gap-1"><FileSpreadsheet size={12} /> العقود</span>
                  <b>{contractCount(e.id)}</b>
                </div>
                {summary.totalHours > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[12px]">
                    <span className="text-slate-400 flex items-center gap-1"><Users size={12} /> وردانيات</span>
                    <b>{summary.totalHours} ساعة ({summary.byOperator.length} مشغل)</b>
                  </div>
                )}

                {/* ربحية المعدة: إيراد − تكاليف تشغيل، وربح الساعة */}
                {(() => {
                  const pr = getEquipmentProfit(e.id)
                  if (pr.revenueMinor === 0 && pr.costsMinor === 0) return null
                  return (
                    <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2 text-[11px] space-y-0.5">
                      <div className="flex justify-between"><span className="text-slate-400">إيراد</span><b className="text-emerald-600">{fmtRate(pr.revenueMinor)}</b></div>
                      <div className="flex justify-between"><span className="text-slate-400">تكاليف تشغيل</span><b className="text-rose-500">{fmtRate(pr.costsMinor)}</b></div>
                      <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-0.5">
                        <span className="text-slate-400">الربح{pr.profitPerHourMinor != null && ` (${fmtRate(pr.profitPerHourMinor)}/ساعة)`}</span>
                        <b className={pr.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtRate(pr.profitMinor)}</b>
                      </div>
                    </div>
                  )
                })()}

                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => openShift(e)}
                    className="py-1.5 rounded-xl border-2 border-dashed border-teal-300/50 dark:border-teal-700/50 text-[11.5px] font-bold text-teal-600 hover:bg-teal-500/5 transition-colors"
                  >
                    + وردية مشغل
                  </button>
                  <button
                    onClick={() => { setCostFor(e); setCostKind('fuel'); setCostAmount(''); setCostDesc('') }}
                    className="py-1.5 rounded-xl border-2 border-dashed border-rose-300/50 dark:border-rose-700/50 text-[11.5px] font-bold text-rose-500 hover:bg-rose-500/5 transition-colors"
                  >
                    <Fuel size={11} className="inline ml-1" />مصروف تشغيل
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* نافذة معدة جديدة/تعديل */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل ${editing.nameAr}` : 'معدة جديدة'}>
        <div className="space-y-3">
          <Field label="اسم المعدة *">
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="حفار كاتربيلر 320" autoComplete="off" />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {EQUIPMENT_KINDS.map((k) => (
                <button key={k} type="button" onClick={() => setNameAr(k)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${nameAr === k ? 'border-amber-500/60 bg-amber-500/15 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-amber-400 hover:text-amber-500'}`}
                >{k}</button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الكود / اللوحة">
              <input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} dir="ltr" placeholder="EQ-01" />
            </Field>
            <Field label="قراءة العدّاد الحالية (ساعة)">
              <input value={meter} onChange={(e) => setMeter(e.target.value)} className={inputCls} dir="ltr" placeholder="0" type="number" min={0} step={0.1} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={`سعر الساعة (${cur.symbol})`}>
              <input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`السعر اليومي (${cur.symbol})`}>
              <input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`السعر الشهري (${cur.symbol})`}>
              <input value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
          </div>
          <Field label="صيانة وقائية كل (ساعة تشغيل)" hint="مثال: 250 — يظهر تنبيه وشريط اقتراب الخدمة. 0 = بلا خطة">
            <input value={serviceEvery} onChange={(e) => setServiceEvery(e.target.value)} className={inputCls} dir="ltr" placeholder="0" type="number" min={0} />
          </Field>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>

      {/* نافذة وردية مشغل */}
      <Modal open={!!shiftFor} onClose={() => setShiftFor(null)} title={`وردية مشغل — ${shiftFor?.nameAr ?? ''}`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="اسم المشغل *">
              <input value={opName} onChange={(e) => setOpName(e.target.value)} className={inputCls} autoFocus />
            </Field>
            <Field label="التاريخ">
              <input value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={inputCls} type="date" dir="ltr" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="قراءة العدّاد بداية الوردية" hint={`عدّاد المعدة الآن: ${shiftFor?.meterReading ?? 0}`}>
              <input value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} className={inputCls} dir="ltr" type="number" min={0} step={0.1} />
            </Field>
            <Field label="قراءة العدّاد نهاية الوردية">
              <input value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} className={inputCls} dir="ltr" type="number" min={0} step={0.1} />
            </Field>
          </div>
          {Number(shiftEnd) > Number(shiftStart) && (
            <div className="anim-pop p-2.5 rounded-xl bg-teal-500/10 text-teal-700 dark:text-teal-400 text-[12px] font-bold text-center">
              ⏱️ ساعات الوردية: {Math.round((Number(shiftEnd) - Number(shiftStart)) * 10) / 10} ساعة
            </div>
          )}
          <Field label="ملاحظات">
            <input value={shiftNotes} onChange={(e) => setShiftNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setShiftFor(null)}>إلغاء</Btn>
            <Btn onClick={saveShift} disabled={!opName.trim() || !shiftEnd}>💾 تسجيل الوردية</Btn>
          </div>
        </div>
      </Modal>

      {/* مصروف تشغيل معدة */}
      <Modal open={!!costFor} onClose={() => setCostFor(null)} title={costFor ? `مصروف تشغيل — ${costFor.nameAr}` : ''}>
        {costFor && (
          <div className="space-y-3">
            <Field label="نوع المصروف">
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => (
                  <button key={k} onClick={() => setCostKind(k)} className={`py-2 rounded-xl text-[11px] font-bold border transition-all ${costKind === k ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {EQUIPMENT_COST_LABELS[k]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`المبلغ (${cur.symbol}) *`}><input value={costAmount} onChange={(e) => setCostAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="بيان (اختياري)"><input value={costDesc} onChange={(e) => setCostDesc(e.target.value)} className={inputCls} placeholder="سولار 100 لتر…" /></Field>
            </div>
            <Field label="الدفع من"><TreasuryPicker value={costTreasury} onChange={setCostTreasury} /></Field>
            <div className="text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5">
              📒 القيد: مصروفات تشغيل معدات 5105 مدين / الخزينة دائن — ويُخصم من ربحية «{costFor.nameAr}»
              {equipmentCosts.filter((c) => c.equipmentId === costFor.id).length > 0 && ` (مصاريف سابقة: ${equipmentCosts.filter((c) => c.equipmentId === costFor.id).length})`}
            </div>
            <Btn onClick={saveCost} shortcut="F9" className="w-full" disabled={!costAmount}>قيد المصروف</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
