/**
 * E2E — تكامل عابر للشاشات بمحاكاة مستخدم حقيقي (أمر الإصلاح):
 * لا فحص أكواد حالة — بل تحقق أن القوائم المنسدلة تجلب أسماء حقيقية
 * ومفاتيح أجنبية صحيحة من قاعدة البيانات عبر الشاشات:
 *  - إنشاء مشروع: منسدلة «ربط بسجل عميل» تعرض أسماء العملاء الفعلية وتربط بالمعرف
 *  - إذن صرف مواد: منسدلات الموظفين (صارف/مستلم) والأصناف برصيدها الحي
 *  - تحصيلات العملاء: منسدلة العملاء + الفواتير المفتوحة تظهر بأرقامها الحقيقية
 *  - عقد باطن: منسدلة الموردين المسجلين
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ProjectsPage } = await import('../src/ui/pages/ContractingPages.tsx')
const { MaterialIssuesPage, ClientCollectionsPage } = await import('../src/ui/pages/ProjectOpsPages.tsx')
const { SubcontractorsPage } = await import('../src/ui/pages/ContractingDepthPages.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
const party = (nameAr: string) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })

const ui = (el: React.ReactElement) => render(<MemoryRouter>{el}<ToastHost /></MemoryRouter>)

beforeAll(() => {
  localStorage.clear()
  // إعداد مكتمل لنشاط المقاولات (مصر)
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting', shopName: 'اختبار', ownerName: 'م', features: [], modules: ['contracting'], accountingMode: 'full' },
  })
  // بيانات حية: عملاء وموظفون وموردون وأصناف ومشروع
  S().addCustomer({ ...party('شركة الدلتا للتطوير'), creditLimitMinor: 0 })
  S().addCustomer({ ...party('مؤسسة المنصورة الحديثة'), creditLimitMinor: 0 })
  S().addEmployee({ ...party('حمدي أمين المخزن'), jobTitle: 'أمين مخزن', hireDate: '2025-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true })
  S().addEmployee({ ...party('م. وليد مهندس التنفيذ'), jobTitle: 'مهندس موقع', hireDate: '2025-01-01', baseSalaryMinor: 700000, allowancesMinor: 0, active: true })
  S().addSupplier({ ...party('شركة أسمنت الدلتا'), creditLimitMinor: 0 })
  S().addItem({
    nameAr: 'أسمنت بورتلاندي', sku: 'CEM-01', barcodes: [], categoryId: 1, baseUnit: 'شيكارة', extraUnits: [{ nameAr: 'طن', factor: 20, barcode: '', priceMinor: 0 }],
    costMinor: 21000, stockQty: 80, priceMinor: 26000, minQty: 0, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  S().addProject({ nameAr: 'برج المنصورة', clientName: 'شركة الدلتا للتطوير', clientId: S().customers[0].id, contractValueMinor: 50000000, retentionPercent: 5, startDate: '2026-01-01', notes: '' })
})

afterAll(cleanup)

describe('تكامل الشاشات: المنسدلات تجلب أسماء ومفاتيح حية', () => {
  it('شاشة المشاريع: منسدلة ربط العميل تعرض أسماء العملاء المسجلين فعلاً', async () => {
    const r = ui(<ProjectsPage />)
    fireEvent.click(r.getAllByText('مشروع جديد')[0])
    // المنسدلة يجب أن تحتوي أسماء العملاء الحقيقية من القاعدة
    const clientSelect = (await screen.findByText('— بلا ربط —')).closest('select')!
    const options = within(clientSelect).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('شركة الدلتا للتطوير')
    expect(options).toContain('مؤسسة المنصورة الحديثة')
    // اختيار عميل يملأ الاسم تلقائياً بربط إداري بالمعرف الصحيح
    const dalta = S().customers.find((c) => c.nameAr === 'شركة الدلتا للتطوير')!
    const optionValues = within(clientSelect).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(optionValues).toContain(String(dalta.id)) // المفتاح الأجنبي الحقيقي
    cleanup()
  })

  it('إذن صرف المواد: منسدلات الموظفين والأصناف برصيد حي، والإذن يُنشأ فعلاً وينقص المخزون', async () => {
    const r = ui(<MaterialIssuesPage />)
    fireEvent.click(r.getByText('إذن صرف'))
    // منسدلة المشروع بالاسم الحقيقي
    const projectSelect = (await screen.findAllByText('— اختر —'))[0].closest('select')!
    expect(within(projectSelect).getAllByRole('option').some((o) => o.textContent!.includes('برج المنصورة'))).toBe(true)
    // منسدلتا الصارف والمستلم من سجل الموظفين بالمسمى الوظيفي
    const selects = document.querySelectorAll('select')
    const issuerSelect = [...selects].find((s) => within(s).queryAllByRole('option').some((o) => o.textContent!.includes('حمدي أمين المخزن (أمين مخزن)')))
    expect(issuerSelect, 'منسدلة الصارف تعرض الموظفين الحقيقيين بمسمياتهم').toBeTruthy()
    // منسدلة الأصناف تعرض الرصيد الحي
    const itemSelect = [...selects].find((s) => within(s).queryAllByRole('option').some((o) => o.textContent!.includes('أسمنت بورتلاندي (رصيد 80 شيكارة)')))
    expect(itemSelect, 'منسدلة الأصناف تعرض الرصيد الفعلي').toBeTruthy()

    // تنفيذ سير العمل كاملاً: اختيار وربط وحفظ ثم التحقق من أثر حقيقي في القاعدة
    const project = S().projects.find((p) => p.nameAr === 'برج المنصورة')!
    const issuer = S().employees.find((e) => e.nameAr.includes('حمدي'))!
    const receiver = S().employees.find((e) => e.nameAr.includes('وليد'))!
    const cement = S().items.find((i) => i.nameAr === 'أسمنت بورتلاندي')!
    fireEvent.change(projectSelect, { target: { value: String(project.id) } })
    fireEvent.change(issuerSelect!, { target: { value: String(issuer.id) } })
    // منسدلة المستلم هي التي تحوي وليد وليست نفسها منسدلة الصارف
    const receiverSelect = [...document.querySelectorAll('select')].filter((s) => within(s).queryAllByRole('option').some((o) => o.textContent!.includes('وليد'))).at(-1)!
    fireEvent.change(receiverSelect, { target: { value: String(receiver.id) } })
    fireEvent.change(itemSelect!, { target: { value: String(cement.id) } })
    const qtyInput = document.querySelector('input[type="number"]')!
    fireEvent.change(qtyInput, { target: { value: '2' } })
    // اختيار وحدة الطن (تحويل متعدد الوحدات)
    const unitSelect = [...document.querySelectorAll('select')].find((s) => within(s).queryAllByRole('option').some((o) => o.textContent === 'طن'))!
    fireEvent.change(unitSelect, { target: { value: 'طن' } })
    fireEvent.click(r.getByText('📦 صرف المواد'))

    const req = S().materialRequisitions.at(-1)!
    expect(req.issuedByName).toBe('حمدي أمين المخزن') // الاسم سُحب ديناميكياً من سجل الموظفين
    expect(req.receivedByName).toBe('م. وليد مهندس التنفيذ')
    expect(req.lines[0].baseQty).toBe(40) // 2 طن = 40 شيكارة
    expect(S().items.find((i) => i.id === cement.id)!.stockQty).toBe(40) // المخزون نقص فعلاً
    cleanup()
  })

  it('تحصيلات العملاء: الفواتير المفتوحة تظهر بأرقامها الحقيقية والتحصيل يطفئ FIFO', async () => {
    // مستخلص آجل على مشروع العميل المربوط
    const project = S().projects.find((p) => p.nameAr === 'برج المنصورة')!
    S().addProjectExtract({ projectId: project.id, grossMinor: 500000, vatPercent: 0, payment: 'credit', description: 'مستخلص 1' })
    const extract = S().projectExtracts.at(-1)!

    const r = ui(<ClientCollectionsPage />)
    const dalta = S().customers.find((c) => c.nameAr === 'شركة الدلتا للتطوير')!
    const clientSelect = (await screen.findAllByText('— اختر —'))[0].closest('select')!
    fireEvent.change(clientSelect, { target: { value: String(dalta.id) } })
    // المستند المفتوح يظهر برقمه الحقيقي
    expect(await screen.findByText(`مستخلص ${extract.extractNumber}`)).toBeTruthy()
    // تحصيل فعلي
    const amountInput = [...document.querySelectorAll('input')].find((i) => i.getAttribute('inputmode') === 'decimal')!
    fireEvent.change(amountInput, { target: { value: '4750' } }) // = المستحق بعد المحتجز 5٪
    fireEvent.click(r.getByText('💰 تحصيل وتوزيع تلقائي'))
    const st = S().clientSettlements.at(-1)!
    expect(st.customerId).toBe(dalta.id)
    expect(st.allocations[0].docKey).toBe(`extract:${extract.id}`)
    expect(S().getOpenClientInvoices(dalta.id).length).toBe(0) // أُطفئ بالكامل
    cleanup()
  })

  it('عقد الباطن: منسدلة الموردين تعرض المسجلين فعلاً', async () => {
    const r = ui(<SubcontractorsPage />)
    fireEvent.click(r.getByText('عقد باطن جديد'))
    const supplierSelect = (await screen.findByText('— بلا ربط —')).closest('select')!
    const opts = within(supplierSelect).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toContain('شركة أسمنت الدلتا')
    cleanup()
  })
})
