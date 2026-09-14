/**
 * سجل المعدات الثقيلة (المرحلة 6 — القرار 13):
 * معدة باسم وكود وسعر يومي افتراضي — تُستدعى في عقود الإيجار.
 * حذف المعدة ممنوع إن ارتبطت بعقود (سلامة السجل).
 */
import { useMemo, useState } from 'react'
import { Plus, Tractor, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { useDataStore, type Equipment } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const EQUIPMENT_KINDS = ['حفار', 'لودر', 'بلدوزر', 'ونش', 'رافعة شوكية', 'مولد', 'ضاغط هواء', 'أخرى']

export function EquipmentPage() {
  const { equipment, rentalContracts, addEquipment, updateEquipment, removeEquipment } = useDataStore()
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
  const [notes, setNotes] = useState('')

  const openNew = () => { setEditing(null); setNameAr(''); setCode(''); setDailyRate(''); setNotes(''); setOpen(true) }
  const openEdit = (e: Equipment) => {
    setEditing(e); setNameAr(e.nameAr); setCode(e.code)
    setDailyRate(e.dailyRateMinor ? formatMinor(e.dailyRateMinor, cur, false).replace(/,/g, '') : '')
    setNotes(e.notes); setOpen(true)
  }
  const save = () => {
    if (!nameAr.trim()) { toast.show('حدد اسم المعدة', 'error'); return }
    const rate = dailyRate.trim() ? toMinor(dailyRate, cur.decimals) : 0
    const payload = { nameAr: nameAr.trim(), code: code.trim(), dailyRateMinor: rate, notes: notes.trim() }
    if (editing) { updateEquipment(editing.id, payload); toast.show('عُدّلت المعدة ✅') }
    else { addEquipment(payload); toast.show('أُضيفت المعدة ✅') }
    setOpen(false)
  }
  const remove = (e: Equipment) => {
    try { removeEquipment(e.id); toast.show('حُذفت المعدة') }
    catch (err) { toast.show((err as Error).message, 'error') }
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
          <EmptyState icon="🚜" title="لا معدات بعد" sub="سجّل معداتك (حفار، لودر، ونش…) بسعر يومي افتراضي ثم افتح عقود الإيجار" />
        </div>
      ) : (
        <div className="anim-up grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ animationDelay: '60ms' }}>
          {equipment.map((e) => (
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
              <div className="mt-3 flex items-center justify-between text-[12px]">
                <span className="text-slate-400">السعر اليومي</span>
                <b className="text-teal-600">{e.dailyRateMinor > 0 ? `${formatMinor(e.dailyRateMinor, cur, false)} ${cur.symbol}` : '—'}</b>
              </div>
              <div className="mt-1 flex items-center justify-between text-[12px]">
                <span className="text-slate-400 flex items-center gap-1"><FileSpreadsheet size={12} /> العقود</span>
                <b>{contractCount(e.id)}</b>
              </div>
              {e.notes && <div className="mt-2 text-[11px] text-slate-400 truncate">{e.notes}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل ${editing.nameAr}` : 'معدة جديدة'}>
        <div className="space-y-3">
          <Field label="اسم المعدة *">
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="حفار كاتربيلر 320" list="equip-kinds" />
            <datalist id="equip-kinds">{EQUIPMENT_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الكود / اللوحة">
              <input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} dir="ltr" placeholder="EQ-01" />
            </Field>
            <Field label={`السعر اليومي (${cur.symbol})`}>
              <input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
          </div>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
