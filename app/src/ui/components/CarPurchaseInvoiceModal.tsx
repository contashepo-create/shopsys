/**
 * فاتورة شراء سيارات كاملة (طلب المالك: «اجعلها فاتورة شراء كاملة مثل الأنشطة الأخرى
 * بطريقة تصلح مع النشاط الخاص بها»).
 *
 * تعالج البلاغين معاً:
 *  ① سطر مستقل لكل سيارة بلوحتها وعدّادها وغرضها وتكلفتها — كسطر الصنف في فاتورة الشراء العامة.
 *  ② سداد نقدي/بنكي جزئي والباقي آجل على المورد، مع مصاريف مرسملة وضريبة قابلة للخصم أو مرسملة.
 * التنسيق يتبع لغة سندات القبض/الصرف: رأس داكن بملخص حي ثم أقسام مرقّمة ثم شريط القيد المتوقع.
 */
import { useMemo, useState } from 'react'
import { Car, FileText, Layers, Coins, Wallet, Plus, Trash2, UserPlus, Percent } from 'lucide-react'
import { Btn, Field, inputCls, Modal, useToast } from './ui.tsx'
import { PartyQuickPicker } from './KeyboardPickers.tsx'
import { TreasuryPicker } from './TreasuryPicker.tsx'
import { useDataStore, EMPTY_EXTENDED, type Supplier } from '../../data/repo.ts'
import { formatMinor, toMinor, type CurrencyConfig } from '../../core/money.ts'
import { computeCarPurchaseInvoice, type CarInvoiceLine, type CarPurpose } from '../../core/cars.ts'

interface VehicleRow {
  make: string
  model: string
  year: string
  plate: string
  odometer: string
  purpose: CarPurpose
  cost: string
}

const emptyVehicle = (): VehicleRow => ({ make: '', model: '', year: String(new Date().getFullYear()), plate: '', odometer: '0', purpose: 'sale', cost: '' })

const card = 'rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/50 dark:ring-slate-700'
const head = 'flex items-center gap-2 text-[12px] font-black text-[#0f2042] dark:text-slate-100 mb-3'

/** إضافة مورد/ورشة جديدة من داخل أي نافذة — يحل شكوى «لا يوجد ورشة أو مصنع أو أي جهة» */
export function SupplierInlineCreate({ onCreated, placeholder = 'اسم الورشة أو المورد الجديد' }: { onCreated: (supplier: Supplier) => void; placeholder?: string }) {
  const { addSupplier } = useDataStore()
  const toast = useToast()
  const [openForm, setOpenForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const create = () => {
    try {
      addSupplier({ ...EMPTY_EXTENDED, nameAr: name.trim(), phone: phone.trim(), notes: 'جهة تجهيز/توريد أُضيفت من نافذة السيارات', active: true })
      const created = useDataStore.getState().suppliers.at(-1)
      if (created) {
        onCreated(created)
        toast.show(`سُجلت «${created.nameAr}» في الموردين — يمكن تحميل الآجل عليها ✅`)
      }
      setName(''); setPhone(''); setOpenForm(false)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  if (!openForm) {
    return (
      <button type="button" data-supplier-inline-add onClick={() => setOpenForm(true)} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[#3f5f92] hover:underline">
        <UserPlus size={12} /> جهة غير مسجلة؟ أضف ورشة/مصنع/مورداً جديداً الآن
      </button>
    )
  }
  return (
    <div className="mt-2 grid grid-cols-[1.4fr_1fr_auto_auto] gap-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={placeholder} aria-label="اسم الجهة الجديدة" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="هاتف (اختياري)" inputMode="tel" />
      <Btn onClick={create} disabled={!name.trim()}>حفظ الجهة</Btn>
      <Btn variant="ghost" onClick={() => setOpenForm(false)}>إلغاء</Btn>
    </div>
  )
}

export function CarPurchaseInvoiceModal({ open, onClose, cur }: { open: boolean; onClose: () => void; cur: CurrencyConfig }) {
  const { suppliers, addCarPurchaseInvoice } = useDataStore()
  const toast = useToast()
  const fmt = (m: number) => `${formatMinor(m, cur, false)} ${cur.symbol}`

  const [supplierId, setSupplierId] = useState(0)
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<VehicleRow[]>([emptyVehicle()])
  const [expenses, setExpenses] = useState<{ label: string; amount: string }[]>([])
  const [taxPercent, setTaxPercent] = useState('0')
  const [taxRecoverable, setTaxRecoverable] = useState(true)
  const [payMode, setPayMode] = useState<'cash' | 'credit' | 'mixed'>('cash')
  const [paidNow, setPaidNow] = useState('')
  const [treasury, setTreasury] = useState('1101')

  const patchRow = (index: number, patch: Partial<VehicleRow>) => setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  /** إجماليات حية بنفس نواة الحساب المستعملة عند الترحيل — لا حساب مكرر */
  const preview = useMemo(() => {
    const lines: CarInvoiceLine[] = rows
      .filter((row) => row.cost.trim() && row.make.trim() && row.model.trim() && row.plate.trim())
      .map((row) => ({
        make: row.make.trim(), model: row.model.trim(), year: Number(row.year) || 0,
        plateOrVin: row.plate.trim(), odometerKm: Number(row.odometer) || 0,
        purpose: row.purpose, costMinor: toMinor(row.cost || '0', cur.decimals),
      }))
    if (lines.length === 0) return null
    try {
      return {
        lines,
        totals: computeCarPurchaseInvoice({
          lines,
          expenses: expenses.filter((e) => e.amount.trim()).map((e) => ({ label: e.label, amountMinor: toMinor(e.amount || '0', cur.decimals) })),
          taxPercent: Number(taxPercent) || 0,
          taxRecoverable,
        }),
      }
    } catch { return null }
  }, [rows, expenses, taxPercent, taxRecoverable, cur.decimals])

  const totalMinor = preview?.totals.totalMinor ?? 0
  const paidMinor = payMode === 'cash' ? totalMinor : payMode === 'credit' ? 0 : toMinor(paidNow || '0', cur.decimals)
  const dueMinor = Math.max(0, totalMinor - paidMinor)

  const reset = () => {
    setRows([emptyVehicle()]); setExpenses([]); setTaxPercent('0'); setTaxRecoverable(true)
    setPayMode('cash'); setPaidNow(''); setSupplierInvoiceNo(''); setNotes('')
  }

  const save = () => {
    try {
      if (!preview) throw new Error('أكمل بيانات سيارة واحدة على الأقل (ماركة/موديل/لوحة/تكلفة)')
      if (dueMinor > 0 && !supplierId) throw new Error('الجزء الآجل يتطلب اختيار المورد — اختر مورداً أو أضف جهة جديدة')
      if (payMode === 'mixed' && paidMinor <= 0) throw new Error('أدخل المبلغ المدفوع الآن')
      const result = addCarPurchaseInvoice({
        supplierId: supplierId || null,
        supplierInvoiceNo, date,
        lines: preview.lines,
        expenses: expenses.filter((e) => e.amount.trim()).map((e) => ({ label: e.label.trim() || 'مصروف', amountMinor: toMinor(e.amount || '0', cur.decimals) })),
        taxPercent: Number(taxPercent) || 0,
        taxRecoverable,
        paidMinor, treasury, notes,
      })
      toast.show(`رُحّلت الفاتورة ${result.invoice.invoiceNumber} بـ${result.cars.length} سيارة — المتبقي ${fmt(result.invoice.dueMinor)} ✅`)
      reset()
      onClose()
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  return (
    <Modal open={open} onClose={onClose} title="" bare extraWide>
      <div className="flex max-h-[88vh] flex-col overflow-hidden rounded-2xl bg-[#f8f9ff] dark:bg-slate-950">
        {/* رأس الفاتورة بملخص حي */}
        <div className="flex flex-wrap items-center gap-3 bg-[#0f2042] px-5 py-3 text-white">
          <Car size={20} className="text-[#9fc0ff]" />
          <div className="me-auto">
            <div className="text-[14px] font-black">فاتورة شراء سيارات</div>
            <div className="text-[11px] text-[#9fc0ff]">سطر مستقل لكل سيارة — مصاريف مرسملة وضريبة وسداد جزئي والباقي آجل</div>
          </div>
          {([
            ['السيارات', String(preview?.lines.length ?? 0)],
            ['قيمة السيارات', fmt(preview?.totals.vehiclesMinor ?? 0)],
            ['مصاريف', fmt(preview?.totals.expensesMinor ?? 0)],
            ['ضريبة', fmt(preview?.totals.taxMinor ?? 0)],
            ['الإجمالي', fmt(totalMinor)],
            ['المدفوع', fmt(paidMinor)],
            ['المتبقي آجل', fmt(dueMinor)],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white/10 px-3 py-1.5 text-center">
              <div className="text-[9px] text-[#9fc0ff]">{label}</div>
              <div className="text-[12px] font-black" dir="ltr">{value}</div>
            </div>
          ))}
        </div>

        <div className="grid flex-1 gap-3 overflow-y-auto p-4">
          {/* ① بيانات الفاتورة */}
          <section className={card}>
            <h3 className={head}><FileText size={14} className="text-[#3f5f92]" /> ① بيانات الفاتورة والمورد</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="المورد / المعرض البائع" hint="إلزامي لأي جزء آجل — يظهر في كشف حسابه">
                <PartyQuickPicker parties={suppliers} value={supplierId} onChange={setSupplierId} cashLabel="بلا مورد (نقدي فقط)" label="بحث المورد" cashValue={0} />
              </Field>
              <Field label="رقم فاتورة المورد"><input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className={inputCls} placeholder="INV-2026-118" dir="ltr" /></Field>
              <Field label="تاريخ الفاتورة"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
            </div>
            <SupplierInlineCreate onCreated={(supplier) => setSupplierId(supplier.id)} />
            <div className="mt-2"><Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="شروط الفحص، التسليم، الضمان…" /></Field></div>
          </section>

          {/* ② سطور السيارات */}
          <section className={card}>
            <h3 className={head}><Layers size={14} className="text-[#3f5f92]" /> ② السيارات — سطر مستقل لكل سيارة</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[11.5px]">
                <thead>
                  <tr className="bg-[#eff4ff] text-[#45464e] dark:bg-slate-800 dark:text-slate-300">
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">الماركة *</th>
                    <th className="p-2 text-start">الموديل *</th>
                    <th className="p-2 text-start">سنة</th>
                    <th className="p-2 text-start">اللوحة / الشاسيه *</th>
                    <th className="p-2 text-start">العدّاد (كم)</th>
                    <th className="p-2 text-start">الغرض</th>
                    <th className="p-2 text-start">التكلفة *</th>
                    <th className="p-2 text-start">تكلفتها بعد التوزيع</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} data-car-line className="border-b border-[#e8ecf6] last:border-0 dark:border-slate-800">
                      <td className="p-1.5 font-bold text-[#75777f]">{index + 1}</td>
                      <td className="p-1.5"><input value={row.make} onChange={(e) => patchRow(index, { make: e.target.value })} className={inputCls} placeholder="تويوتا" aria-label={`ماركة السيارة ${index + 1}`} /></td>
                      <td className="p-1.5"><input value={row.model} onChange={(e) => patchRow(index, { model: e.target.value })} className={inputCls} placeholder="كورولا" aria-label={`موديل السيارة ${index + 1}`} /></td>
                      <td className="p-1.5 w-20"><input value={row.year} onChange={(e) => patchRow(index, { year: e.target.value })} inputMode="numeric" className={inputCls} /></td>
                      <td className="p-1.5"><input value={row.plate} onChange={(e) => patchRow(index, { plate: e.target.value })} className={inputCls} dir="ltr" placeholder="ABC-1234" aria-label={`لوحة السيارة ${index + 1}`} /></td>
                      <td className="p-1.5 w-24"><input value={row.odometer} onChange={(e) => patchRow(index, { odometer: e.target.value })} inputMode="numeric" className={inputCls} /></td>
                      <td className="p-1.5 w-28">
                        <select value={row.purpose} onChange={(e) => patchRow(index, { purpose: e.target.value as CarPurpose })} className={inputCls} aria-label={`غرض السيارة ${index + 1}`}>
                          <option value="sale">للبيع</option>
                          <option value="rent">للتأجير</option>
                        </select>
                      </td>
                      <td className="p-1.5 w-32"><input value={row.cost} onChange={(e) => patchRow(index, { cost: e.target.value })} inputMode="decimal" className={inputCls} aria-label={`تكلفة السيارة ${index + 1}`} /></td>
                      <td className="p-1.5 font-bold text-[#009c6b]" dir="ltr">{preview?.totals.perVehicleCostMinor[index] != null ? fmt(preview.totals.perVehicleCostMinor[index]) : '—'}</td>
                      <td className="p-1.5">
                        <button type="button" title="حذف السطر" onClick={() => setRows((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : [emptyVehicle()]))} className="rounded-md p-1 text-rose-500 hover:bg-rose-500/10">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" data-add-car-line onClick={() => setRows((list) => [...list, emptyVehicle()])} className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[#3f5f92] hover:underline">
              <Plus size={12} /> إضافة سيارة أخرى للفاتورة
            </button>
          </section>

          {/* ③ المصاريف والضريبة */}
          <section className={card}>
            <h3 className={head}><Coins size={14} className="text-[#3f5f92]" /> ③ مصاريف مرسملة وضريبة</h3>
            <p className="mb-2 text-[11px] text-[#75777f]">النقل والجمارك والفحص والتجهيز الأولي تُوزَّع على السيارات بنسبة قيمة كل سيارة، فتظهر ربحية كل سيارة صحيحة.</p>
            {expenses.map((expense, index) => (
              <div key={index} className="mb-2 grid grid-cols-[1.6fr_1fr_auto] gap-2">
                <input value={expense.label} onChange={(e) => setExpenses((list) => list.map((row, i) => (i === index ? { ...row, label: e.target.value } : row)))} className={inputCls} placeholder="نقل / جمارك / فحص" aria-label="بند مصروف الفاتورة" />
                <input value={expense.amount} onChange={(e) => setExpenses((list) => list.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)))} inputMode="decimal" className={inputCls} placeholder="0" aria-label="قيمة مصروف الفاتورة" />
                <button type="button" onClick={() => setExpenses((list) => list.filter((_, i) => i !== index))} className="rounded-md px-2 text-rose-500 hover:bg-rose-500/10"><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setExpenses((list) => [...list, { label: '', amount: '' }])} className="flex items-center gap-1 text-[11px] font-bold text-[#3f5f92] hover:underline">
              <Plus size={12} /> إضافة مصروف مرسمل
            </button>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label="نسبة الضريبة على الفاتورة (%)"><input value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-[#c5c6cf] bg-[#f8f9ff] px-3 py-2 text-[11.5px] font-bold dark:border-slate-700 dark:bg-slate-900">
                <input type="checkbox" checked={taxRecoverable} onChange={(e) => setTaxRecoverable(e.target.checked)} />
                <Percent size={13} className="text-[#3f5f92]" />
                ضريبة مدخلات قابلة للخصم (2102) — بدونها تُرسمل على تكلفة السيارات
              </label>
            </div>
          </section>

          {/* ④ السداد */}
          <section className={card}>
            <h3 className={head}><Wallet size={14} className="text-[#3f5f92]" /> ④ السداد — نقدي/بنكي الآن والباقي آجل</h3>
            <div className="flex flex-wrap gap-2">
              {([['cash', 'نقدي بالكامل', 'يُدفع كل الإجمالي الآن'], ['mixed', 'مدفوع + آجل', 'ادفع جزءاً والباقي على المورد'], ['credit', 'آجل بالكامل', 'كل الإجمالي على حساب المورد']] as const).map(([mode, label, hint]) => (
                <button key={mode} type="button" data-pay-mode={mode} onClick={() => setPayMode(mode)} className={`flex-1 rounded-xl border p-2.5 text-start transition-all ${payMode === mode ? 'border-[#0f2042] bg-[#e5eeff] dark:bg-slate-800' : 'border-[#c5c6cf] dark:border-slate-700'}`}>
                  <b className="text-[12px]">{label}</b>
                  <div className="text-[10px] text-[#75777f]">{hint}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {payMode === 'mixed' && (
                <Field label={`المدفوع الآن (${cur.symbol}) *`} hint={`المتبقي ${fmt(dueMinor)} يُرحَّل على المورد`}>
                  <input value={paidNow} onChange={(e) => setPaidNow(e.target.value)} inputMode="decimal" className={inputCls} aria-label="المدفوع الآن من الفاتورة" />
                </Field>
              )}
              {payMode !== 'credit' && <div><TreasuryPicker value={treasury} onChange={setTreasury} compact operation="payment" /></div>}
            </div>
          </section>

          {/* القيد المتوقع */}
          <section className="rounded-xl bg-[#eff4ff] p-3 text-[11px] text-[#45464e] dark:bg-slate-800/60 dark:text-slate-300">
            <b className="text-[#0f2042] dark:text-slate-100">القيد المتوقع:</b>{' '}
            <span dir="rtl">
              1103 مخزون السيارات مدين {fmt(preview?.totals.capitalizedMinor ?? 0)}
              {(preview?.totals.recoverableTaxMinor ?? 0) > 0 ? ` + 2102 ضريبة مدخلات ${fmt(preview!.totals.recoverableTaxMinor)}` : ''}
              {' ← '}
              {paidMinor > 0 ? `الخزينة/البنك ${treasury} دائن ${fmt(paidMinor)}` : ''}
              {paidMinor > 0 && dueMinor > 0 ? ' + ' : ''}
              {dueMinor > 0 ? `2101 موردون دائن ${fmt(dueMinor)}` : ''}
            </span>
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-[#dce9ff] bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <span className="me-auto text-[11px] text-[#75777f]">كل سيارة تُنشأ سجلاً مستقلاً بتكلفتها الموزَّعة، وتدخل ربحيتها عند البيع.</span>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn onClick={save} shortcut="F9" disabled={!preview || (dueMinor > 0 && !supplierId)}>ترحيل الفاتورة</Btn>
        </div>
      </div>
    </Modal>
  )
}
