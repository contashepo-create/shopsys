import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ProjectExpensesPage, ProjectExtractsPage } = await import('../src/ui/pages/ContractingPages.tsx')
const { CustodyPage } = await import('../src/ui/pages/CustodyPage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
const party = (nameAr: string) => ({
  nameAr,
  phone: '01011112222',
  notes: '',
  taxNumber: '300-555-777',
  commercialReg: '',
  email: '',
  address: '',
  city: '',
  postalCode: '',
  buildingNo: '',
  nationalId: '',
})

const ui = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      {el}
      <ToastHost />
    </MemoryRouter>,
  )

describe('قسم مصروفات المشروعات المستقل + قسم المستخلصات كفواتير للعميل', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().updateSetup({
      completed: true,
      countryCode: 'EG',
      activityId: 'contracting',
      shopName: 'مقاولات النيل',
      ownerName: 'م. أحمد',
      features: [],
      modules: ['contracting'],
      accountingMode: 'full',
      vatPercent: 14,
      allowNegativeTreasury: true,
    })
    useDataStore.setState({
      projects: [],
      boqItems: [],
      projectExtracts: [],
      projectCosts: [],
      journal: [],
      customers: [],
      suppliers: [],
      employees: [],
      custodyFiles: [],
      custodyTxs: [],
      employeeAdvances: [],
      payrollRuns: [],
    })
    S().addCustomer({ ...party('هيئة المجتمعات العمرانية'), creditLimitMinor: 0 })
    S().addSupplier({ ...party('شركة حديد عز'), creditLimitMinor: 0 })
    const p = S().addProject({
      nameAr: 'مشروع مول العاصمة',
      clientName: 'هيئة المجتمعات العمرانية',
      clientId: S().customers[0].id,
      contractValueMinor: 50000000, // 500,000.00
      retentionPercent: 10,
      startDate: '2026-10-01',
      notes: '',
    })
    S().addBoqItem({
      projectId: p.id,
      code: 'B-01',
      descriptionAr: 'أعمال الخرسانة العادية',
      unit: 'م3',
      qty: 100,
      unitPriceMinor: 200000, // 200,000.00 total
      estCostMinor: 150000,
    })
    S().addBoqItem({
      projectId: p.id,
      code: 'B-02',
      descriptionAr: 'أعمال المباني والتشطيبات',
      unit: 'م2',
      qty: 100,
      unitPriceMinor: 300000, // 300,000.00 total
      estCostMinor: 200000,
    })
  })

  afterEach(cleanup)

  it('يسجل الإجمالي المبسط مع دفع جزئي من ملف العهدة ويحمّل المدفوع فقط على العهدة والباقي على المورد', async () => {
    const project = S().projects[0]
    S().addEmployee({
      nameAr: 'موظف مصروفات المشروع', phone: '', jobTitle: 'محاسب موقع', roleId: null,
      hireDate: '2026-10-01', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '',
      taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '',
    })
    const employee = S().employees.at(-1)!
    const file = S().openCustodyFile({ employeeId: employee.id, projectId: project.id, reason: 'مصروف مشروع', notes: '' })
    S().fundCustodyFile({ fileId: file.id, amountMinor: 500000, treasury: '1101', description: 'تعزيز الاختبار' })

    ui(<ProjectExpensesPage />)
    fireEvent.click(document.querySelector('[data-open-project-expense-modal]')!)
    expect(document.querySelector('[data-expense-simple-entry]')).not.toBeNull()
    expect(document.querySelector('[data-expense-lines-table]')).toBeNull()

    fireEvent.change(document.querySelector('[data-expense-simple-description]')!, { target: { value: 'مواد بناء للموقع' } })
    fireEvent.change(document.querySelector('[data-expense-simple-total]')!, { target: { value: '11400' } })
    fireEvent.change(document.querySelector('[data-expense-paid-now]')!, { target: { value: '4000' } })
    expect(document.querySelector('[data-expense-payment-total]')?.textContent).toContain('11,400')
    expect(document.querySelector('[data-expense-settlement-preview]')?.textContent).toContain('7,400')

    fireEvent.change(document.querySelector('[data-pay-source-dependent] select[aria-label="نوع مصدر الدفع"]')!, { target: { value: 'custody' } })
    const custodySelect = document.querySelector('[aria-label="ملف العهدة للدفع"]') as HTMLSelectElement
    expect(custodySelect.value).toBe(String(file.id))

    const supplierId = S().suppliers[0].id
    const supplierPicker = document.querySelector('[data-project-expense-modal] [data-party-picker]')!
    fireEvent.change(supplierPicker.querySelector('input')!, { target: { value: 'شركة حديد عز' } })
    let supplierOption: Element | null = null
    await waitFor(() => {
      supplierOption = document.querySelector(`.invoice-party-overlay [data-quick-option][data-value="${supplierId}"]`)
      expect(supplierOption).not.toBeNull()
    })
    fireEvent.doubleClick(supplierOption!)
    await waitFor(() => expect((supplierPicker.querySelector('input') as HTMLInputElement).value).toBe('شركة حديد عز'))

    const save = document.querySelector('[data-save-project-expense]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    const cost = S().projectCosts[0]
    expect(cost.amountMinor).toBe(1140000)
    expect(cost.grossMinor).toBe(1140000)
    expect(cost.paidMinor).toBe(400000)
    expect(cost.dueMinor).toBe(740000)
    expect(cost.payment).toBe('mixed')
    expect(cost.custodyFileId).toBe(file.id)
    expect(cost.supplierId).toBe(supplierId)
    expect(S().getCustodySummary(file.id).spentMinor).toBe(400000)
    expect(S().getCustodySummary(file.id).remainingMinor).toBe(100000)

    const entry = S().journal.find((row) => row.sourceType === 'project_cost' && row.sourceId === cost.id)!
    expect(entry.lines.find((line) => line.accountCode === '1108')?.credit).toBe(400000)
    expect(entry.lines.find((line) => line.accountCode === '2101')?.credit).toBe(740000)
    expect(entry.lines.some((line) => line.accountCode === '1101' && line.credit > 0)).toBe(false)
  })

  it('يسجل فاتورة مصروفات مشروع ببنود حرة (شامل الضريبة وغير شامل) ويخصم الصافي من ربح المشروع', () => {
    ui(<ProjectExpensesPage />)
    fireEvent.click(document.querySelector('[data-open-project-expense-modal]')!)
    expect(document.querySelector('[data-expense-simple-entry]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-toggle-expense-detail]')!)
    expect(document.querySelector('[data-expense-lines-table]')).not.toBeNull()

    // إدخال البند الأول: شامل الضريبة (11,400 ← صافي 10,000 + ضريبة 1,400)
    const descInputs = document.querySelectorAll('[data-expense-line-desc]')
    const priceInputs = document.querySelectorAll('[data-expense-line-price]')
    const taxSelects = document.querySelectorAll('[data-expense-line-tax-mode]')
    fireEvent.change(descInputs[0], { target: { value: 'توريد خرسانة جاهزة شامل الضريبة' } })
    fireEvent.change(priceInputs[0], { target: { value: '11400' } })
    fireEvent.change(taxSelects[0], { target: { value: 'inclusive' } })

    // إضافة بند ثانٍ: بدون ضريبة (3,000)
    fireEvent.click(document.querySelector('[data-add-expense-line]')!)
    const descInputs2 = document.querySelectorAll('[data-expense-line-desc]')
    const priceInputs2 = document.querySelectorAll('[data-expense-line-price]')
    const taxSelects2 = document.querySelectorAll('[data-expense-line-tax-mode]')
    fireEvent.change(descInputs2[1], { target: { value: 'إكراميات ونقل للموقع' } })
    fireEvent.change(priceInputs2[1], { target: { value: '3000' } })
    fireEvent.change(taxSelects2[1], { target: { value: 'none' } })

    // التحقق من الإجماليات المعروضة في النافذة
    expect(document.querySelector('[data-expense-total-net]')?.textContent).toContain('13,000')
    expect(document.querySelector('[data-expense-total-vat]')?.textContent).toContain('1,400')
    expect(document.querySelector('[data-expense-total-gross]')?.textContent).toContain('14,400')
    fireEvent.change(document.querySelector('[data-expense-paid-now]')!, { target: { value: '14400' } })

    // حفظ الفاتورة
    fireEvent.click(document.querySelector('[data-save-project-expense]')!)

    expect(S().projectCosts.length).toBe(1)
    expect(S().projectCosts[0].amountMinor).toBe(1300000) // الصافي فقط 13,000
    expect(S().projectCosts[0].vatMinor).toBe(140000) // ضريبة المدخلات 1,400
    expect(S().projectCosts[0].grossMinor).toBe(1440000) // الإجمالي الشامل 14,400
    expect(S().projectCosts[0].paidMinor).toBe(1440000)
    expect(S().projectCosts[0].dueMinor).toBe(0)
    expect(S().getProjectProfit(S().projects[0].id).costsMinor).toBe(1300000)
  })

  it('يعرض المرتجع والعجز والزيادة المدفوعة والمتبقية بوضوح في الملف المغلق دون اعتبار التسوية مصروفاً', () => {
    S().addEmployee({
      nameAr: 'موظف عهدة مغلقة', phone: '', jobTitle: 'محاسب موقع', roleId: null,
      hireDate: '2026-10-01', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '',
      taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '',
    })
    const employee = S().employees.at(-1)!
    const file = S().openCustodyFile({ employeeId: employee.id, projectId: null, reason: 'تسوية اختبار', notes: '' })
    S().fundCustodyFile({ fileId: file.id, amountMinor: 100000, treasury: '1101', description: 'تعزيز' })
    S().postCustodyExpense({ fileId: file.id, amountMinor: 120000, description: 'مصروف زائد', allowExcess: true })
    S().settleCustodyFile({ fileId: file.id, returnedMinor: 0, treasury: '1101' })

    ui(<CustodyPage />)
    expect(document.querySelector(`[data-custody-excess-due="${file.id}"]`)?.textContent).not.toBe('0')
    fireEvent.click(document.querySelector('tbody button[title="فتح الملف"]')!)

    expect(document.querySelector('[data-custody-excess-summary]')?.textContent).toContain('مسجل / مصروف / باقٍ')
    expect(document.querySelector('[data-custody-excess-summary]')?.textContent).toContain('200')
    expect(document.querySelector('[data-custody-settlement-status]')?.textContent).toContain('زيادة المصروفات المسجلة')
    expect(document.querySelector('[data-custody-settlement-status]')?.textContent).toContain('صُرف منها بالمسيرات')
    expect(document.querySelector('[data-custody-settlement-status]')?.textContent).toContain('متبقي للموظف')
    expect(document.querySelector('[data-custody-settlement-status]')?.textContent).toContain('عجز 0')
    expect(document.querySelector('[data-custody-settlement-status]')?.textContent).toContain('مرتجع 0')

    const detailHeaders = [...document.querySelectorAll('table th')].map((cell) => cell.textContent?.trim())
    expect(detailHeaders).toContain('مصروف فعلي')
    expect(detailHeaders).toContain('مرتجع للخزينة')
    expect(detailHeaders).toContain('عجز / سلفة')
  })

  it('يعرض بنود المشروع بنسبة 0% افتراضياً في المستخلص الأول، ثم يظهر النسبة السابقة وبجانبها النسبة الجديدة في المستخلص الثاني مع زر طباعة فاتورة للعميل', () => {
    ui(<ProjectExtractsPage />)
    fireEvent.click(document.querySelector('[data-open-extract-modal]')!)

    // التحقق من أن جميع بنود المشروع ظهرت في الفاتورة بنسبة 0% افتراضياً
    const prevPcts1 = [...document.querySelectorAll('[data-boq-prev-pct]')].map((el) => el.textContent?.trim())
    const newPctInputs1 = [...document.querySelectorAll('[data-boq-new-pct]')] as HTMLInputElement[]
    expect(prevPcts1).toEqual(['0٪', '0٪'])
    expect(newPctInputs1.map((i) => i.value)).toEqual(['0', '0'])

    // تعديل البند الأول فقط إلى 40% وترك البند الثاني 0%
    fireEvent.change(newPctInputs1[0], { target: { value: '40' } })
    expect(document.querySelector('[data-extract-lines-gross]')?.textContent).toContain('80,000')

    // اعتماد المستخلص الأول
    fireEvent.click(document.querySelector('[data-save-project-extract]')!)
    expect(S().projectExtracts.length).toBe(1)
    expect(S().projectExtracts[0].lines?.length).toBe(1)
    expect(S().projectExtracts[0].totals.grossMinor).toBe(8000000)

    // إغلاق نافذة المراجعة إن كانت مفتوحة ثم فتح نافذة إصدار مستخلص للمرة الثانية لنفس المشروع
    fireEvent.click(document.querySelector('[data-open-extract-modal]')!)
    const prevPcts2 = [...document.querySelectorAll('[data-boq-prev-pct]')].map((el) => el.textContent?.trim())
    const newPctInputs2 = [...document.querySelectorAll('[data-boq-new-pct]')] as HTMLInputElement[]
    // البند الأول تظهر نسبته السابقة 40% وبجانبها النسبة الجديدة، والبند الثاني 0%
    expect(prevPcts2).toEqual(['40٪', '0٪'])
    expect(newPctInputs2.map((i) => i.value)).toEqual(['40', '0'])

    // رفع البند الأول من 40% إلى 75% (شريحة 35% = 70,000) والبند الثاني من 0% إلى 50% (شريحة 50% = 150,000)
    fireEvent.change(newPctInputs2[0], { target: { value: '75' } })
    fireEvent.change(newPctInputs2[1], { target: { value: '50' } })
    expect(document.querySelector('[data-extract-lines-gross]')?.textContent).toContain('220,000')

    fireEvent.click(document.querySelector('[data-save-project-extract]')!)
    expect(S().projectExtracts.length).toBe(2)
    expect(S().projectExtracts[1].totals.grossMinor).toBe(22000000)

    // التحقق من وجود زر طباعة فاتورة احترافية للعميل بجانب كل مستخلص
    const clientPrintButtons = document.querySelectorAll('[data-extract-client-invoice-print]')
    expect(clientPrintButtons.length).toBeGreaterThanOrEqual(2)
  })
})
