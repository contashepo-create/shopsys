import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ExpenseTemplate } from '../../core/expenseCatalog.ts'
import type { CostCenter } from '../../core/costCenters.ts'
import type { TreasuryDef } from '../../core/treasury.ts'
import type { PurchaseExpense, Vehicle } from '../../data/repo.ts'
import type { CustodyFile } from '../../core/custody.ts'
import { Btn, DecimalInput, Field, inputCls, Modal, useToast } from './ui.tsx'
import { QuickSelect } from './KeyboardPickers.tsx'

/**
 * محرر المصروف المشترك لفواتير الشراء.
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

const sourceOptions: Array<[Source, string]> = [
  ['supplier', 'على حساب المورد'],
  ['treasury', 'مدفوع من خزينة/بنك'],
  ['custody', 'مدفوع من عهدة'],
  ['payable', 'مستحق لجهة أخرى'],
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

  return <div className="space-y-3">
    <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Field label="قالب المصروف — اكتب الاسم ثم Enter">
            <QuickSelect className={inputCls} value={templateChoice} onChange={(event) => chooseTemplate(event.target.value)}>
              <option value="">ابحث عن مصروف معرف مسبقاً</option>
              {activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.code} — {template.nameAr} · {template.accountCode}</option>)}
            </QuickSelect>
          </Field>
        </div>
        <Btn variant="soft" type="button" onClick={() => setNewTemplateOpen(true)}><Plus size={15} /> إضافة قالب مصروف</Btn>
      </div>
      <p className="text-[11px] text-slate-500">يملأ القالب اسم المصروف وحسابه ومعالجته ومركز التوزيع. لا يُضاف إلى الفاتورة حتى تحدد قيمته.</p>
    </div>

    {expenses.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-xs text-slate-500">لم تتم إضافة مصروف. ابحث عن قالب مصروف أعلاه لإضافته.</div>}
    {expenses.map((expense, index) => {
      const selectedVehicle = vehicles.find((vehicle) => vehicle.id === expense.vehicleId)
      return <div key={index} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-sm">{expense.nameAr || 'مصروف جديد'} <span className="text-[10px] text-slate-400">· {expense.accountCode || '5108'}</span></div>
          <button type="button" aria-label="حذف المصروف" className="p-1.5 text-slate-400 hover:text-rose-500" onClick={() => onChange(expenses.filter((_, row) => row !== index))}><Trash2 size={16} /></button>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <Field label="البيان والحساب">
            <input className={`${inputCls} bg-slate-50 dark:bg-slate-800/50`} value={expense.nameAr} readOnly placeholder="اختر قالباً من البحث أعلاه" />
            <div className="mt-1 text-[10px] text-slate-500">حساب المصروف: <b>{expense.accountCode || '5108'}</b></div>
          </Field>
          <Field label="القيمة">
            <DecimalInput className={inputCls} min="0" value={amountText(expense.amountMinor)} onValueChange={(value) => patch(index, { amountMinor: toMinor(value) })} placeholder="0" />
          </Field>
          <Field label="تحميل التكلفة">
            <QuickSelect className={inputCls} value={expense.costTreatment ?? 'inventory'} onChange={(event) => patch(index, { costTreatment: event.target.value as PurchaseExpense['costTreatment'] })}>
              <option value="inventory">على تكلفة المخزون/الفاتورة</option>
              <option value="period">مصروف فترة على الفاتورة</option>
            </QuickSelect>
          </Field>
          <Field label="أساس توزيع تكلفة المخزون">
            <QuickSelect className={inputCls} value={expense.method} disabled={expense.costTreatment === 'period'} onChange={(event) => patch(index, { method: event.target.value as 'value' | 'qty' })}>
              <option value="value">بالقيمة</option>
              <option value="qty">بالكمية</option>
            </QuickSelect>
          </Field>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <Field label="معاملة الضريبة">
            <QuickSelect className={inputCls} value={taxEnabled ? (expense.taxTreatment ?? 'exempt') : 'exempt'} onChange={(event) => patch(index, { taxTreatment: event.target.value as PurchaseExpense['taxTreatment'], taxPercent: event.target.value === 'exempt' ? 0 : taxPercent })}>
              <option value="exempt">غير خاضع</option>
              <option value="exclusive">ضريبة مضافة</option>
              <option value="inclusive">شامل الضريبة</option>
            </QuickSelect>
          </Field>
          <Field label="نسبة الضريبة">
            <DecimalInput className={inputCls} min="0" max="100" disabled={!taxEnabled || expense.taxTreatment === 'exempt'} value={expense.taxTreatment === 'exempt' ? 0 : (expense.taxPercent ?? taxPercent)} onValueChange={(value) => patch(index, { taxPercent: Math.min(100, Math.max(0, Number(value) || 0)) })} />
          </Field>
          <Field label="مركز التكلفة العام">
            <QuickSelect className={inputCls} value={expense.costCenterId ?? ''} onChange={(event) => patch(index, { costCenterId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">بدون مركز عام</option>
              {costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}
            </QuickSelect>
          </Field>
          <Field label="سيارة/مركز تكلفة النقلة">
            <QuickSelect className={inputCls} value={expense.vehicleId ?? ''} onChange={(event) => {
              const vehicleId = event.target.value ? Number(event.target.value) : null
              patch(index, { vehicleId, ...(vehicleId && expense.paidBy === 'supplier' ? { paidBy: 'payable', payableAccountCode: '2117' } : {}) })
            }}>
              <option value="">بدون سيارة</option>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}
            </QuickSelect>
            {selectedVehicle && <div className="mt-1 text-[10px] text-emerald-600">مرتبط بـ {selectedVehicle.plateNumber} ولن يُحمل تلقائياً على المورد.</div>}
          </Field>
        </div>
        <div className="rounded-lg border border-slate-200/70 dark:border-slate-700/70 p-2 space-y-2">
          <div className="text-[11px] font-bold text-slate-500">مصدر السداد والاستحقاق</div>
          <div className="flex flex-wrap gap-1.5">
            {sourceOptions.filter(([source]) => showSupplierSource || source !== 'supplier').map(([source, label]) => <button type="button" key={source} onClick={() => patch(index, { paidBy: source, custodyFileId: source === 'custody' ? (openCustodyFiles[0]?.id ?? null) : null, ...(source === 'payable' ? { payableAccountCode: '2117' } : {}) })} disabled={source === 'custody' && openCustodyFiles.length === 0} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${expense.paidBy === source ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-brand-400'}`}>{label}</button>)}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {expense.paidBy === 'treasury' && <Field label="الخزينة/البنك"><QuickSelect className={inputCls} value={expense.payAccount ?? defaultTreasury} onChange={(event) => patch(index, { payAccount: event.target.value })}>{treasuries.map((treasury) => <option key={treasury.code} value={treasury.code}>{treasury.nameAr}</option>)}</QuickSelect></Field>}
            {expense.paidBy === 'custody' && <Field label="ملف العهدة"><QuickSelect className={inputCls} value={expense.custodyFileId ?? ''} onChange={(event) => patch(index, { custodyFileId: event.target.value ? Number(event.target.value) : null })}>{openCustodyFiles.map((file) => <option key={file.id} value={file.id}>{file.fileNumber}</option>)}</QuickSelect></Field>}
            {expense.paidBy === 'payable' && <><Field label="الجهة المستحقة (ليست المورد)"><input className={inputCls} value={expense.beneficiaryName ?? ''} onChange={(event) => patch(index, { beneficiaryName: event.target.value })} placeholder="شركة النقل أو مالك السيارة" /></Field><Field label="حساب الاستحقاق"><div className={`${inputCls} bg-slate-100 dark:bg-slate-800 text-slate-600`}>مصاريف مستحقة (2117) — مستقل عن المورد</div></Field></>}
            {expense.paidBy === 'supplier' && <div className="md:col-span-2 self-end text-[11px] text-amber-700 dark:text-amber-300">سيزيد هذا الخيار مستحق المورد فقط لأنه اختيار صريح.</div>}
          </div>
        </div>
      </div>
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
