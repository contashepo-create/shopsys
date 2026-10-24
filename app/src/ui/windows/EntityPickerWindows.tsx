/**
 * نوافذ المنتقي الحي (طلب المالك — بند ٩): إعادة بناء منتقيات المشروع والعميل
 * والموظف بتصميم «بحث الأصناف — بحث حي» الذي كان موجوداً من قبل. نافذة واحدة
 * (entity-picker) تعرض لوحة البحث الحي المناسبة، والإنشاء السريع يتم في نوافذ
 * ابنة (محرّر الطرف القائم للعملاء/الموردين، ومحرّر مشروع وموظف سريعان هنا)
 * — حفظ الابنة يختار العنصر الجديد ويعود بالنافذة الأم كما طلب المالك.
 */
import { useState } from 'react'
import { Building2, IdCard, Save } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { PartyQuickPicker, PartySearchPanel, ProjectSearchPanel, EmployeeSearchPanel } from '../components/KeyboardPickers.tsx'
import { useWindowHost } from './windowHostContext.ts'
import {
  openPartyEditorWindow, openPartyLedgerWindow, openProjectEditorWindow, openEmployeeEditorWindow,
  type EntityPickerKind,
} from './windowStore.ts'
import { todayLocalIso } from '../../core/time.ts'

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

/* ═══════════ المنتقي الحي — عميل/مورد/موظف/مشروع ═══════════ */
export function EntityPickerWindowView() {
  const host = useWindowHost()
  const props = host?.props ?? {}
  const entity = (props.entity as EntityPickerKind | undefined) ?? 'customer'
  const onPick = props.onPick as ((id: number) => void) | undefined
  const initialQuery = String(props.initialQuery ?? '')
  const cur = useCur()
  const fmtMoney = (m: number) => `${formatMinor(m, cur, false)} ${cur.symbol}`
  const { customers, suppliers, employees, projects, getCustomerBalance, getSupplierBalance } = useDataStore()
  const hostId = host?.windowId ?? null

  const pick = (id: number) => { onPick?.(id); host?.close() }
  const createdThenPick = (id: number) => pick(id)

  return (
    <div className="flex h-full min-h-0 flex-col" data-window-view="entity-picker" data-entity-picker={entity}>
      {entity === 'customer' || entity === 'supplier' ? (
        <PartySearchPanel
          kind={entity}
          parties={entity === 'customer' ? customers : suppliers}
          balanceOf={(id) => (entity === 'customer' ? getCustomerBalance(id) : getSupplierBalance(id))}
          fmtMoney={fmtMoney}
          initialQuery={initialQuery}
          onEscape={() => host?.close()}
          onPick={pick}
          onCreate={() => openPartyEditorWindow(entity, 0, hostId, createdThenPick)}
          onEdit={(id) => openPartyEditorWindow(entity, id, hostId)}
          onLedger={(id) => openPartyLedgerWindow(entity, id, hostId)}
        />
      ) : entity === 'project' ? (
        <ProjectSearchPanel
          projects={projects}
          fmtMoney={fmtMoney}
          initialQuery={initialQuery}
          onEscape={() => host?.close()}
          onPick={pick}
          onCreate={() => openProjectEditorWindow(0, hostId, createdThenPick)}
          onEdit={(id) => openProjectEditorWindow(id, hostId)}
        />
      ) : (
        <EmployeeSearchPanel
          employees={employees}
          initialQuery={initialQuery}
          onEscape={() => host?.close()}
          onPick={pick}
          onCreate={() => openEmployeeEditorWindow(0, hostId, createdThenPick)}
          onEdit={(id) => openEmployeeEditorWindow(id, hostId)}
        />
      )}
    </div>
  )
}

/* ═══════════ مشروع جديد/تعديل سريع — نافذة ابنة ═══════════ */
export function ProjectEditorWindowView() {
  const host = useWindowHost()
  const projectId = Number(host?.props.projectId ?? 0)
  const onSaved = host?.props.onSaved as ((projectId: number) => void) | undefined
  const isNew = projectId === 0
  const cur = useCur()
  const toast = useToast()
  const { projects, customers, addProject, updateProject } = useDataStore()
  const project = projects.find((row) => row.id === projectId) ?? null
  const [form, setForm] = useState(() => ({
    nameAr: project?.nameAr ?? '',
    clientId: project?.clientId ?? 0,
    clientName: project?.clientName ?? '',
    contractValue: project ? String(project.contractValueMinor / 10 ** cur.decimals) : '',
    retentionPercent: String(project?.retentionPercent ?? 10),
    startDate: project?.startDate ?? todayLocalIso(),
    notes: project?.notes ?? '',
  }))
  const patch = (next: Partial<typeof form>) => { setForm((prev) => ({ ...prev, ...next })); host?.setDirty(true) }
  if (!project && !isNew) return <div className="p-6 text-sm text-slate-500">المشروع غير موجود.</div>

  const save = () => {
    try {
      if (!form.nameAr.trim()) throw new Error('اسم المشروع مطلوب')
      const contractValueMinor = toMinor(form.contractValue || '0', cur.decimals)
      if (contractValueMinor <= 0) throw new Error('قيمة العقد يجب أن تكون أكبر من صفر')
      const retentionPercent = Number(form.retentionPercent || 0)
      if (!Number.isFinite(retentionPercent) || retentionPercent < 0 || retentionPercent > 20) throw new Error('نسبة المحتجَز بين ٠ و٢٠٪')
      const client = customers.find((c) => c.id === form.clientId)
      const clientName = (client?.nameAr ?? form.clientName).trim()
      if (isNew) {
        const created = addProject({
          nameAr: form.nameAr.trim(),
          clientName,
          clientId: client ? client.id : null,
          contractValueMinor,
          retentionPercent,
          startDate: form.startDate,
          notes: form.notes,
        })
        host?.setDirty(false)
        toast.show(`أُنشئ المشروع «${created.code} — ${created.nameAr}» ✅`)
        onSaved?.(created.id)
        host?.close()
        return
      }
      updateProject(project!.id, {
        nameAr: form.nameAr.trim(),
        clientName,
        clientId: form.clientId ? form.clientId : null,
        contractValueMinor,
        retentionPercent,
        startDate: form.startDate,
        notes: form.notes,
      })
      host?.setDirty(false)
      toast.show('حُفظت بيانات المشروع ✅')
      onSaved?.(project!.id)
      host?.close()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4 p-5" data-window-view="project-editor">
      <div className="flex items-center gap-3 rounded-2xl bg-brand-500/8 p-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300"><Building2 size={18} /></span>
        <div className="min-w-0">
          <b className="block truncate">{project ? `${project.code} — ${project.nameAr}` : (form.nameAr || 'مشروع جديد')}</b>
          <small className="text-slate-500">{isNew ? 'مشروع جديد — يُحفظ ويُختار تلقائياً في نافذتك' : 'تعديل سريع — البيانات التفصيلية من صفحة المشاريع'}</small>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="اسم المشروع *"><input className={inputCls} value={form.nameAr} onChange={(e) => patch({ nameAr: e.target.value })} aria-label="اسم المشروع" data-project-editor-name /></Field>
        <Field label="العميل (من السجل — اختياري)">
          <PartyQuickPicker parties={customers} value={form.clientId} cashLabel="— بدون ربط بعميل مسجل —" label="بحث عميل المشروع" cashValue={0}
            onChange={(id) => { const c = customers.find((x) => x.id === id); patch({ clientId: id, ...(c ? { clientName: c.nameAr } : {}) }) }} />
        </Field>
        <Field label="اسم العميل (يظهر في المستندات)"><input className={inputCls} value={form.clientName} onChange={(e) => patch({ clientName: e.target.value })} aria-label="اسم عميل المشروع" /></Field>
        <Field label={`قيمة العقد (${cur.symbol}) *`}><input className={inputCls} value={form.contractValue} onChange={(e) => patch({ contractValue: e.target.value })} inputMode="decimal" dir="ltr" data-project-editor-value /></Field>
        <Field label="نسبة المحتجَز ٪ (٠–٢٠)"><input className={inputCls} value={form.retentionPercent} onChange={(e) => patch({ retentionPercent: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        <Field label="تاريخ البدء"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} /></Field>
      </div>
      <Field label="ملاحظات"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Btn variant="ghost" onClick={() => host?.close()}>إلغاء</Btn>
        <Btn onClick={save} shortcut="F9"><Save size={14} /> {isNew ? 'إنشاء المشروع' : 'حفظ التعديل'}</Btn>
      </div>
    </div>
  )
}

/* ═══════════ موظف جديد/تعديل سريع — نافذة ابنة ═══════════ */
const EMPLOYEE_EXTENDED = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

export function EmployeeEditorWindowView() {
  const host = useWindowHost()
  const employeeId = Number(host?.props.employeeId ?? 0)
  const onSaved = host?.props.onSaved as ((employeeId: number) => void) | undefined
  const isNew = employeeId === 0
  const cur = useCur()
  const toast = useToast()
  const { employees, addEmployee, updateEmployee } = useDataStore()
  const employee = employees.find((row) => row.id === employeeId) ?? null
  const [form, setForm] = useState(() => ({
    nameAr: employee?.nameAr ?? '',
    phone: employee?.phone ?? '',
    jobTitle: employee?.jobTitle ?? '',
    hireDate: employee?.hireDate ?? todayLocalIso(),
    baseSalary: employee ? String(employee.baseSalaryMinor / 10 ** cur.decimals) : '',
    allowances: employee ? String(employee.allowancesMinor / 10 ** cur.decimals) : '',
    active: employee?.active ?? true,
    notes: employee?.notes ?? '',
  }))
  const patch = (next: Partial<typeof form>) => { setForm((prev) => ({ ...prev, ...next })); host?.setDirty(true) }
  if (!employee && !isNew) return <div className="p-6 text-sm text-slate-500">الموظف غير موجود.</div>

  const save = () => {
    try {
      if (!form.nameAr.trim()) throw new Error('اسم الموظف مطلوب')
      const baseSalaryMinor = toMinor(form.baseSalary || '0', cur.decimals)
      const allowancesMinor = toMinor(form.allowances || '0', cur.decimals)
      if (isNew) {
        const beforeIds = new Set(employees.map((row) => row.id))
        addEmployee({
          ...EMPLOYEE_EXTENDED,
          nameAr: form.nameAr.trim(),
          phone: form.phone.trim(),
          jobTitle: form.jobTitle.trim(),
          roleId: null,
          hireDate: form.hireDate || todayLocalIso(),
          baseSalaryMinor,
          allowancesMinor,
          active: true,
          notes: form.notes,
        })
        const created = useDataStore.getState().employees.find((row) => !beforeIds.has(row.id))
        host?.setDirty(false)
        toast.show(`أُنشئ الموظف «${form.nameAr.trim()}» ✅`)
        if (created) onSaved?.(created.id)
        host?.close()
        return
      }
      updateEmployee(employee!.id, {
        nameAr: form.nameAr.trim(),
        phone: form.phone.trim(),
        jobTitle: form.jobTitle.trim(),
        hireDate: form.hireDate,
        baseSalaryMinor,
        allowancesMinor,
        active: form.active,
        notes: form.notes,
      })
      host?.setDirty(false)
      toast.show('حُفظت بيانات الموظف ✅')
      onSaved?.(employee!.id)
      host?.close()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4 p-5" data-window-view="employee-editor">
      <div className="flex items-center gap-3 rounded-2xl bg-brand-500/8 p-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300"><IdCard size={18} /></span>
        <div className="min-w-0">
          <b className="block truncate">{employee?.nameAr ?? (form.nameAr || 'موظف جديد')}</b>
          <small className="text-slate-500">{isNew ? 'بطاقة سريعة — تُستكمل التأمينات والسلف من صفحة الموظفين' : 'تعديل سريع لبيانات البطاقة'}</small>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="اسم الموظف *"><input className={inputCls} value={form.nameAr} onChange={(e) => patch({ nameAr: e.target.value })} aria-label="اسم الموظف" data-employee-editor-name /></Field>
        <Field label="المسمى الوظيفي"><input className={inputCls} value={form.jobTitle} onChange={(e) => patch({ jobTitle: e.target.value })} /></Field>
        <Field label="الهاتف"><input className={inputCls} value={form.phone} onChange={(e) => patch({ phone: e.target.value })} dir="ltr" /></Field>
        <Field label="تاريخ التعيين"><input type="date" className={inputCls} value={form.hireDate} onChange={(e) => patch({ hireDate: e.target.value })} /></Field>
        <Field label={`الراتب الأساسي الشهري (${cur.symbol})`}><input className={inputCls} value={form.baseSalary} onChange={(e) => patch({ baseSalary: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        <Field label={`البدلات الشهرية (${cur.symbol})`}><input className={inputCls} value={form.allowances} onChange={(e) => patch({ allowances: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
      </div>
      {!isNew && (
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={form.active} onChange={(e) => patch({ active: e.target.checked })} className="h-4 w-4 accent-brand-600" /> على رأس العمل
        </label>
      )}
      <Field label="ملاحظات"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Btn variant="ghost" onClick={() => host?.close()}>إلغاء</Btn>
        <Btn onClick={save} shortcut="F9"><Save size={14} /> {isNew ? 'إنشاء الموظف' : 'حفظ التعديل'}</Btn>
      </div>
    </div>
  )
}
