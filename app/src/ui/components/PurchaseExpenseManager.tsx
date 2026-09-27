import { useState } from 'react'
import { Plus, Trash2, Receipt, Wallet, Layers, Percent, Search, CheckCircle2, BookOpenText } from 'lucide-react'
import type { ExpenseTemplate } from '../../core/expenseCatalog.ts'
import type { CostCenter } from '../../core/costCenters.ts'
import type { TreasuryDef } from '../../core/treasury.ts'
import type { PurchaseExpense, Vehicle } from '../../data/repo.ts'
import type { CustodyFile } from '../../core/custody.ts'
import { Btn, DecimalInput, Field, inputCls, Modal, useToast } from './ui.tsx'
import { QuickSelect } from './KeyboardPickers.tsx'

/**
 * محرر مصاريف فاتورة الشراء — أُعيد تصميمه بنمط سند القبض/الصرف (طلب المالك):
 * رأس داكن بالملخص، ثم أقسام مرقّمة لكل مصروف (البند ← المعالجة ← الضريبة ← السداد)
 * وشريط سفلي يوضح القيد المتوقع لكل بند قبل الحفظ.
 *
 * القاعدة المهمة هنا: اختيار «مستحق لجهة أخرى» لا يساوي اختيار المورد،
 * ولا يسمح المحرر بحساب 2101. أما تحميل السيارة فيبقى على المصروف/مركز
 * التكلفة ويمكنه تحويل المصروف صراحةً إلى استحقاق مستقل عند الحاجة.
 */
type PurchaseExpenseManagerProps = {
  expenses: PurchaseExpense[]
  onChange: (expenses: PurchaseExpense[]) => void
  expenseTemplates: ExpenseTemplate[]
  onAddTemplate: (input: Omit<ExpenseTemplate, 'id' | 'isActive'> & { isActive?: boolean }) => ExpenseTemplate
  costCenters: CostCenter[]
  vehicles: Vehicle[]
  treasuries: TreasuryDef[]
  custodyFiles: CustodyFile[]
  currencyDecimals: number
  taxPercent: number
  taxEnabled: boolean
  defaultTreasury: string
  showSupplierSource?: boolean
}

type Source = NonNullable<PurchaseExpense['paidBy']>

const sourceOptions: Array<[Source, string, string]> = [
  ['supplier', 'على حساب المورد', 'يزيد مستحق المورد نفسه (2101)'],
  ['treasury', 'مدفوع من خزينة/بنك', 'يخرج نقداً فوراً من الحساب المختار'],
  ['custody', 'مدفوع من عهدة', 'يُحمَّل على ملف عهدة مفتوح'],
  ['payable', 'مستحق لجهة أخرى', 'دائن مستقل على 2117 — ليس المورد'],
]

function blankFromTemplate(template: ExpenseTemplate | undefined, defaultTreasury: string): PurchaseExpense {
  const allocation = template?.landedCostAllocation ?? 'value'
  const paidBy: Source = template?.settlement === 'paid_now' ? 'treasury' : 'payable'
  return {
    nameAr: template?.nameAr ?? '',
    amountMinor: 0,
    method: allocation === 'quantity' ? 'qty' : 'value',
    paidBy,
    payAccount: defaultTreasury,
    custodyFileId: null,
    beneficiaryName: '',
    payableAccountCode: '2117',
    accountCode: template?.accountCode ?? '5108',
    costTreatment: allocation === 'none' ? 'period' : 'inventory',
    taxTreatment: template?.taxTreatment ?? 'exempt',
    taxPercent: template?.taxPercent ?? 0,
    costCenterId: null,
    vehicleId: null,
  }
}

/** عنوان قسم داخل بطاقة المصروف — نفس نَفَس أقسام السند */
function SectionHead({ step, icon, title, hint }: { step: string; icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-[#0f2042] text-[10px] font-black text-white">{step}</span>
      <h4 className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#0f2042]">{icon}{title}</h4>
      {hint && <span className="text-[10px] text-[#75777f]">{hint}</span>}
    </div>
  )
}

export function PurchaseExpenseManager({
  expenses,
  onChange,
  expenseTemplates,
  onAddTemplate,
  costCenters,
  vehicles,
  treasuries,
  custodyFiles,
  currencyDecimals,
  taxPercent,
  taxEnabled,
  defaultTreasury,
  showSupplierSource = true,
}: PurchaseExpenseManagerProps) {
  const toast = useToast()
  const [templateChoice, setTemplateChoice] = useState('')
  const [newTemplateOpen, setNewTemplateOpen] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ nameAr: '', code: '', accountCode: '5108' })
  const activeTemplates = expenseTemplates.filter((template) => template.isActive)
  const openCustodyFiles = custodyFiles.filter((file) => file.status === 'open')
  const patch = (index: number, patchValue: Partial<PurchaseExpense>) => onChange(expenses.map((expense, row) => row === index ? { ...expense, ...patchValue } : expense))
  const chooseTemplate = (value: string) => {
    setTemplateChoice(value)
    if (!value) return
    const template = activeTemplates.find((row) => row.id === Number(value))
    if (template) onChange([...expenses, blankFromTemplate(template, defaultTreasury)])
    setTemplateChoice('')
  }
  const addTemplate = () => {
    const nameAr = newTemplate.nameAr.trim()
    if (!nameAr) return
    const code = newTemplate.code.trim() || `EXP-${Date.now().toString().slice(-6)}`
    try {
      const created = onAddTemplate({
        code,
        nameAr,
        accountCode: newTemplate.accountCode.trim() || '5108',
        taxTreatment: 'exempt',
        taxPercent: 0,
        settlement: 'payable_later',
        affectsProfit: true,
        landedCostAllocation: 'value',
        notes: '',
        isActive: true,
      })
      onChange([...expenses, blankFromTemplate(created, defaultTreasury)])
      setNewTemplate({ nameAr: '', code: '', accountCode: '5108' })
      setNewTemplateOpen(false)
    } catch (error) {
      toast.show((error as Error).message, 'error')
    }
  }
  const decimals = currencyDecimals
  const amountText = (minor: number) => minor ? String(minor / 10 ** decimals) : ''
  const toMinor = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 10 ** decimals))
  const money = (minor: number) => (minor / 10 ** decimals).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  /** ضريبة البند كما ستُحسب عند الترحيل — معاينة فقط تُطمئن المستخدم قبل الحفظ */
  const taxOf = (expense: PurchaseExpense) => {
    const treatment = taxEnabled ? (expense.taxTreatment ?? 'exempt') : 'exempt'
    const rate = treatment === 'exempt' ? 0 : Math.max(0, expense.taxPercent ?? taxPercent)
    if (treatment === 'exclusive') { const tax = Math.round(expense.amountMinor * rate / 100); return { base: expense.amountMinor, tax, total: expense.amountMinor + tax } }
    if (treatment === 'inclusive' && rate > 0) { const base = Math.round(expense.amountMinor / (1 + rate / 100)); return { base, tax: expense.amountMinor - base, total: expense.amountMinor } }
    return { base: expense.amountMinor, tax: 0, total: expense.amountMinor }
  }
  const totals = expenses.reduce((acc, expense) => {
    const parts = taxOf(expense)
    acc.total += parts.total
    acc.tax += parts.tax
    if ((expense.costTreatment ?? 'inventory') === 'inventory') acc.inventory += parts.base; else acc.period += parts.base
    if (expense.paidBy === 'supplier') acc.onSupplier += parts.total
    return acc
  }, { total: 0, tax: 0, inventory: 0, period: 0, onSupplier: 0 })
  const cardCls = 'rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/40 dark:ring-slate-700'
  const fieldCls = 'h-10 w-full rounded-lg border border-[#c5c6cf] bg-[#f8f9ff] px-3 text-sm text-[#0f2042] outline-none focus:border-[#3f5f92] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

  return <div dir="rtl" className="space-y-3.5 rounded-2xl bg-[#f8f9ff] p-3.5 text-[#0b1c30] dark:bg-slate-900/30 dark:text-slate-100">
    {/* شريط الملخص — مثل ترويسة السند */}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0f2042] px-4 py-3 text-white">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10"><Receipt size={18} /></span>
        <div>
          <b className="block text-sm">مصاريف الفاتورة والتكلفة المحمّلة</b>
          <span className="text-[10.5px] text-[#d6e3ff]">{expenses.length} بند · كل بند له حسابه ومصدر سداده وقيده المستقل</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
        <span className="rounded-lg bg-white/10 px-2.5 py-1.5">على المخزون <b className="font-mono">{money(totals.inventory)}</b></span>
        <span className="rounded-lg bg-white/10 px-2.5 py-1.5">مصروف فترة <b className="font-mono">{money(totals.period)}</b></span>
        {totals.tax > 0 && <span className="rounded-lg bg-white/10 px-2.5 py-1.5">ضريبة <b className="font-mono">{money(totals.tax)}</b></span>}
        <span className="rounded-lg bg-[#6ffbbe] px-3 py-1.5 font-bold text-[#002113]">الإجمالي <b className="font-mono">{money(totals.total)}</b></span>
      </div>
    </div>

    {/* ① اختيار البند */}
    <section className={cardCls}>
      <SectionHead step="١" icon={<Search size={15} className="text-[#3f5f92]" />} title="اختر بند المصروف" hint="اكتب أول حرف من اسم المصروف ثم Enter" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <QuickSelect aria-label="بحث قالب المصروف" className={fieldCls} value={templateChoice} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">ابحث عن مصروف معرّف مسبقاً (نولون، جمارك، تحميل…)</option>
            {activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.code} — {template.nameAr} · {template.accountCode}</option>)}
          </QuickSelect>
        </div>
        <Btn variant="soft" type="button" onClick={() => setNewTemplateOpen(true)}><Plus size={15} /> قالب جديد</Btn>
      </div>
      <p className="mt-2 text-[10.5px] text-[#75777f]">يملأ القالب اسم المصروف وحسابه ومعالجته ومركز توزيعه — ثم تحدد أنت القيمة ومصدر السداد بالأسفل.</p>
    </section>

    {expenses.length === 0 && (
      <div className="rounded-xl border border-dashed border-[#c5c6cf] bg-white/60 p-6 text-center text-xs text-[#75777f] dark:bg-slate-900/20">
        لا مصروف على هذه الفاتورة بعد — ابحث عن بند بالأعلى لإضافته.
      </div>
    )}

    {expenses.map((expense, index) => {
      const selectedVehicle = vehicles.find((vehicle) => vehicle.id === expense.vehicleId)
      const parts = taxOf(expense)
      const isPeriod = (expense.costTreatment ?? 'inventory') === 'period'
      const creditAccount = expense.paidBy === 'supplier' ? 'المورد (2101)'
        : expense.paidBy === 'treasury' ? `${treasuries.find((treasury) => treasury.code === (expense.payAccount ?? defaultTreasury))?.nameAr ?? 'الخزينة'} (${expense.payAccount ?? defaultTreasury})`
        : expense.paidBy === 'custody' ? `عهدة ${custodyFiles.find((file) => file.id === expense.custodyFileId)?.fileNumber ?? '—'} (1108)`
        : 'مصاريف مستحقة (2117)'
      return <section key={index} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/40 dark:ring-slate-700">
        {/* ترويسة البند */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#eff4ff] px-4 py-2.5 dark:bg-slate-800/60">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#0f2042] text-[11px] font-black text-white">{index + 1}</span>
            <div className="min-w-0">
              <b className="block truncate text-[13px] text-[#0f2042] dark:text-slate-100">{expense.nameAr || 'مصروف جديد'}</b>
              <span className="text-[10px] text-[#75777f]">حساب المصروف {expense.accountCode || '5108'} · {isPeriod ? 'مصروف فترة' : 'يُحمَّل على تكلفة المخزون'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-[#0f2042] shadow-sm dark:bg-slate-900 dark:text-slate-100">{money(parts.total)}</span>
            <button type="button" aria-label="حذف المصروف" className="rounded-lg p-1.5 text-[#75777f] transition hover:bg-rose-500 hover:text-white" onClick={() => onChange(expenses.filter((_, row) => row !== index))}><Trash2 size={15} /></button>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {/* ② القيمة والمعالجة */}
          <div className="rounded-lg bg-[#f8f9ff] p-3 dark:bg-slate-800/40">
            <SectionHead step="٢" icon={<Layers size={15} className="text-[#3f5f92]" />} title="القيمة ومعالجة التكلفة" />
            <div className="grid gap-2.5 md:grid-cols-3">
              <Field label="قيمة المصروف *">
                <DecimalInput className={fieldCls} min="0" value={amountText(expense.amountMinor)} onValueChange={(value) => patch(index, { amountMinor: toMinor(value) })} placeholder="0" />
              </Field>
              <Field label="تحميل التكلفة">
                <QuickSelect className={fieldCls} value={expense.costTreatment ?? 'inventory'} onChange={(event) => patch(index, { costTreatment: event.target.value as PurchaseExpense['costTreatment'] })}>
                  <option value="inventory">على تكلفة المخزون/الفاتورة</option>
                  <option value="period">مصروف فترة على الفاتورة</option>
                </QuickSelect>
              </Field>
              <Field label="أساس التوزيع على الأصناف">
                <QuickSelect className={fieldCls} value={expense.method} disabled={isPeriod} onChange={(event) => patch(index, { method: event.target.value as 'value' | 'qty' })}>
                  <option value="value">بالقيمة</option>
                  <option value="qty">بالكمية</option>
                </QuickSelect>
              </Field>
            </div>
          </div>

          {/* ③ الضريبة ومراكز التكلفة */}
          <div className="rounded-lg bg-[#f8f9ff] p-3 dark:bg-slate-800/40">
            <SectionHead step="٣" icon={<Percent size={15} className="text-[#3f5f92]" />} title="الضريبة ومركز التكلفة" hint={taxEnabled ? undefined : 'الضريبة غير مفعّلة لهذه الفاتورة'} />
            <div className="grid gap-2.5 md:grid-cols-4">
              <Field label="معاملة الضريبة">
                <QuickSelect className={fieldCls} disabled={!taxEnabled} value={taxEnabled ? (expense.taxTreatment ?? 'exempt') : 'exempt'} onChange={(event) => patch(index, { taxTreatment: event.target.value as PurchaseExpense['taxTreatment'], taxPercent: event.target.value === 'exempt' ? 0 : taxPercent })}>
                  <option value="exempt">غير خاضع</option>
                  <option value="exclusive">ضريبة مضافة</option>
                  <option value="inclusive">شامل الضريبة</option>
                </QuickSelect>
              </Field>
              <Field label="نسبة الضريبة %">
                <DecimalInput className={fieldCls} min="0" max="100" disabled={!taxEnabled || expense.taxTreatment === 'exempt'} value={expense.taxTreatment === 'exempt' ? 0 : (expense.taxPercent ?? taxPercent)} onValueChange={(value) => patch(index, { taxPercent: Math.min(100, Math.max(0, Number(value) || 0)) })} />
              </Field>
              <Field label="مركز التكلفة العام">
                <QuickSelect className={fieldCls} value={expense.costCenterId ?? ''} onChange={(event) => patch(index, { costCenterId: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">بدون مركز عام</option>
                  {costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}
                </QuickSelect>
              </Field>
              <Field label="سيارة/مركز تكلفة النقلة">
                <QuickSelect className={fieldCls} value={expense.vehicleId ?? ''} onChange={(event) => {
                  const vehicleId = event.target.value ? Number(event.target.value) : null
                  patch(index, { vehicleId, ...(vehicleId && expense.paidBy === 'supplier' ? { paidBy: 'payable', payableAccountCode: '2117' } : {}) })
                }}>
                  <option value="">بدون سيارة</option>
                  {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}
                </QuickSelect>
              </Field>
            </div>
            {parts.tax > 0 && <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] text-[#254778]"><span className="rounded bg-[#dce9ff]/70 px-2 py-1">الأساس {money(parts.base)}</span><span className="rounded bg-[#dce9ff]/70 px-2 py-1">الضريبة {money(parts.tax)}</span><span className="rounded bg-[#dce9ff]/70 px-2 py-1">الإجمالي {money(parts.total)}</span></div>}
            {selectedVehicle && <div className="mt-2 text-[10.5px] font-bold text-emerald-600">مرتبط بالسيارة {selectedVehicle.plateNumber} ولن يُحمّل تلقائياً على المورد.</div>}
          </div>

          {/* ④ مصدر السداد */}
          <div className="rounded-lg bg-[#f8f9ff] p-3 dark:bg-slate-800/40">
            <SectionHead step="٤" icon={<Wallet size={15} className="text-[#3f5f92]" />} title="مصدر السداد والاستحقاق" />
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {sourceOptions.filter(([source]) => showSupplierSource || source !== 'supplier').map(([source, label, hint]) => (
                <button
                  type="button"
                  key={source}
                  onClick={() => patch(index, { paidBy: source, custodyFileId: source === 'custody' ? (openCustodyFiles[0]?.id ?? null) : null, ...(source === 'payable' ? { payableAccountCode: '2117' } : {}) })}
                  disabled={source === 'custody' && openCustodyFiles.length === 0}
                  className={`rounded-lg border px-2.5 py-2 text-right transition disabled:opacity-40 ${expense.paidBy === source ? 'border-[#0f2042] bg-[#0f2042] text-white' : 'border-[#c5c6cf] bg-white text-[#45464e] hover:border-[#3f5f92] dark:bg-slate-900 dark:border-slate-700'}`}
                >
                  <b className="block text-[11.5px]">{label}</b>
                  <span className={`block text-[9.5px] ${expense.paidBy === source ? 'text-[#d6e3ff]' : 'text-[#75777f]'}`}>{hint}</span>
                </button>
              ))}
            </div>
            <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
              {expense.paidBy === 'treasury' && <Field label="الخزينة/البنك"><QuickSelect className={fieldCls} value={expense.payAccount ?? defaultTreasury} onChange={(event) => patch(index, { payAccount: event.target.value })}>{treasuries.map((treasury) => <option key={treasury.code} value={treasury.code}>{treasury.nameAr}</option>)}</QuickSelect></Field>}
              {expense.paidBy === 'custody' && <Field label="ملف العهدة"><QuickSelect className={fieldCls} value={expense.custodyFileId ?? ''} onChange={(event) => patch(index, { custodyFileId: event.target.value ? Number(event.target.value) : null })}>{openCustodyFiles.map((file) => <option key={file.id} value={file.id}>{file.fileNumber}</option>)}</QuickSelect></Field>}
              {expense.paidBy === 'payable' && <>
                <Field label="الجهة المستحقة (ليست المورد) *"><input className={fieldCls} value={expense.beneficiaryName ?? ''} onChange={(event) => patch(index, { beneficiaryName: event.target.value })} placeholder="شركة النقل أو مالك السيارة" /></Field>
                <Field label="حساب الاستحقاق"><div className={`${fieldCls} flex items-center bg-[#eff4ff] text-[12px] dark:bg-slate-800`}>مصاريف مستحقة (2117) — مستقل عن المورد</div></Field>
              </>}
              {expense.paidBy === 'supplier' && <div className="self-end text-[11px] font-bold text-amber-700 md:col-span-2 dark:text-amber-300">سيزيد هذا الخيار مستحق المورد فقط لأنه اختيار صريح منك.</div>}
            </div>
          </div>
        </div>

        {/* شريط القيد المتوقع */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dce9ff] bg-white px-4 py-2.5 text-[10.5px] text-[#45464e] dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          <span className="flex items-center gap-1.5"><BookOpenText size={13} className="text-[#3f5f92]" /> القيد المتوقع: مدين <b className="text-[#0f2042] dark:text-slate-100">{isPeriod ? `${expense.accountCode || '5108'} مصروف فترة` : '1103 مخزون'}</b> ← دائن <b className="text-[#0f2042] dark:text-slate-100">{creditAccount}</b></span>
          <span className="flex items-center gap-1 font-bold text-[#009c6b]"><CheckCircle2 size={13} /> يُرحَّل مع الفاتورة</span>
        </div>
      </section>
    })}

    <Modal open={newTemplateOpen} onClose={() => setNewTemplateOpen(false)} title="إضافة قالب مصروف جديد">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">سيظهر القالب في قائمة المصروفات ويمكن استخدامه في الفواتير التالية.</p>
        <Field label="اسم المصروف *"><input autoFocus className={inputCls} value={newTemplate.nameAr} onChange={(event) => setNewTemplate({ ...newTemplate, nameAr: event.target.value })} placeholder="نولون، جمارك، صيانة سيارة…" /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="كود القالب"><input className={inputCls} value={newTemplate.code} onChange={(event) => setNewTemplate({ ...newTemplate, code: event.target.value })} placeholder="يولد تلقائياً" /></Field><Field label="حساب المصروف"><input className={inputCls} value={newTemplate.accountCode} onChange={(event) => setNewTemplate({ ...newTemplate, accountCode: event.target.value })} placeholder="5108" /></Field></div>
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setNewTemplateOpen(false)}>إلغاء</Btn><Btn onClick={addTemplate} disabled={!newTemplate.nameAr.trim()}>حفظ وإضافة للفاتورة</Btn></div>
      </div>
    </Modal>
  </div>
}
