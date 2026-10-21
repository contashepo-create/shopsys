/**
 * واجهة موازنة المشروع — بلاغ المالك 2026-10-21:
 * «إذا كتبت أي رقم ابدأ المقارنة، أما إذا كان صفراً فلا أريد أي إشعارات للموازنة».
 * هذه الاختبارات ترسم الشاشة فعلياً وتتحقق أن الفئة الصفرية تُعرض «بلا موازنة»
 * وبلا انحراف («—») ولا تُلوَّن كتجاوز، ثم تبدأ المقارنة فور كتابة رقم.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ProjectBudgetPage } = await import('../src/ui/pages/ContractingPlanPages.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
const ui = (el: React.ReactElement) => render(<MemoryRouter>{el}<ToastHost /></MemoryRouter>)
const bodyText = () => document.body.textContent ?? ''

describe('شاشة موازنة المشروع — الصفر لا يقارن', () => {
  let projectId = 0

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
      projects: [], projectCosts: [], projectBudgets: [], journal: [], customers: [], suppliers: [], treasuries: [],
    })
    S().addSupplier({
      nameAr: 'مورد الحديد', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '',
      address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0,
    })
    const project = S().addProject({
      nameAr: 'برج النيل', clientName: 'شركة التعمير', clientId: null,
      contractValueMinor: 10_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '',
    })
    projectId = project.id
    S().addProjectCost({
      projectId, kind: 'materials', amountMinor: 500_000,
      payment: 'credit', supplierId: S().suppliers.at(-1)!.id, description: 'توريد حديد',
    })
  })

  afterEach(cleanup)

  it('بلا موازنة: تعرض «بلا موازنة» و«—» ولا تعرض «تجاوز!» ولا «عجز»', () => {
    ui(<ProjectBudgetPage />)
    const text = bodyText()
    expect(text).toContain('بلا موازنة')
    expect(text).not.toContain('تجاوز!')
    expect(text).not.toContain('عجز')
    expect(text).toContain('الفئة التي تتركها صفراً لا تُقارن ولا تُصدر أي تنبيه')
  })

  it('صفر صريح محفوظ من النافذة يبقى «بلا موازنة»', async () => {
    ui(<ProjectBudgetPage />)
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('ضبط الموازنة'))!)
    const inputs = Array.from(document.querySelectorAll('input[inputmode="decimal"]')) as HTMLInputElement[]
    expect(inputs.length).toBe(5)
    inputs.forEach((input) => fireEvent.change(input, { target: { value: '0' } }))
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('حفظ الموازنة'))!)
    await waitFor(() => expect(bodyText()).toContain('بلا موازنة'))
    expect(bodyText()).not.toContain('تجاوز!')
    expect(S().projectBudgets.filter((b) => b.projectId === projectId)).toHaveLength(0) // الصفر لا يُخزَّن كموازنة
  })

  it('كتابة رقم أقل من الفعلي تبدأ المقارنة وتُظهر تجاوزاً وعجزاً', async () => {
    ui(<ProjectBudgetPage />)
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('ضبط الموازنة'))!)
    const inputs = Array.from(document.querySelectorAll('input[inputmode="decimal"]')) as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '3000' } }) // مواد 3,000 مقابل فعلي 5,000
    fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('حفظ الموازنة'))!)
    await waitFor(() => expect(bodyText()).toContain('تجاوز!'))
    expect(bodyText()).toContain('عجز')
    expect(bodyText()).toContain('167٪') // 5,000 ÷ 3,000
    expect(bodyText()).not.toContain('بلا موازنة')
  })

  it('رقم أكبر من الفعلي يُظهر «ضمن الموازنة» بلا تجاوز', async () => {
    S().setProjectBudget(projectId, [{ kind: 'materials', amountMinor: 1_000_000 }])
    ui(<ProjectBudgetPage />)
    expect(bodyText()).toContain('ضمن الموازنة')
    expect(bodyText()).not.toContain('تجاوز!')
    expect(bodyText()).toContain('50٪')
  })
})
