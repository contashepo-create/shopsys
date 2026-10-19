import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ProjectExpensesPage, ProjectExtractsPage } = await import('../src/ui/pages/ContractingPages.tsx')
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
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup,
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
      },
    })
    useDataStore.setState({
      projects: [],
      boqItems: [],
      projectExtracts: [],
      projectCosts: [],
      journal: [],
      customers: [],
      suppliers: [],
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

  it('يسجل فاتورة مصروفات مشروع ببنود حرة (شامل الضريبة وغير شامل) ويخصم الصافي من ربح المشروع', () => {
    ui(<ProjectExpensesPage />)
    fireEvent.click(document.querySelector('[data-open-project-expense-modal]')!)

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

    // حفظ الفاتورة
    fireEvent.click(document.querySelector('[data-save-project-expense]')!)

    expect(S().projectCosts.length).toBe(1)
    expect(S().projectCosts[0].amountMinor).toBe(1300000) // الصافي فقط 13,000
    expect(S().projectCosts[0].vatMinor).toBe(140000) // ضريبة المدخلات 1,400
    expect(S().projectCosts[0].grossMinor).toBe(1440000) // الإجمالي الشامل 14,400
    expect(S().getProjectProfit(S().projects[0].id).costsMinor).toBe(1300000)
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
