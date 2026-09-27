import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { CarPurchaseInvoiceModal } = await import('../src/ui/components/CarPurchaseInvoiceModal.tsx')
const { CarsPage } = await import('../src/ui/pages/CarsPage.tsx')
const { PropertiesPage } = await import('../src/ui/pages/RealEstatePages.tsx')
const S = () => useDataStore.getState()
const EMPTY = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: 'جنيه' }

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'cars', shopName: 'معرض', ownerName: 'م', features: [], modules: ['cars', 'realestate'], accountingMode: 'full', allowNegativeTreasury: true, requireOpenShiftForSales: false } })
  S().addSupplier({ ...EMPTY, nameAr: 'معرض المستقبل', phone: '', notes: '' })
  S().addSupplier({ ...EMPTY, nameAr: 'ورشة الإتقان', phone: '', notes: '' })
})

afterEach(() => cleanup())
const lastDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) as HTMLElement
const typeIn = (el: Element | null, value: string) => fireEvent.change(el as HTMLInputElement, { target: { value } })

describe('فاتورة شراء السيارات الكاملة', () => {
  it('سطر مستقل لكل سيارة مع مصاريف موزَّعة وسداد جزئي والباقي على المورد', () => {
    render(<CarPurchaseInvoiceModal open onClose={() => {}} cur={cur} />)
    const dialog = lastDialog()
    expect(dialog.textContent).toContain('فاتورة شراء سيارات')
    expect(dialog.textContent).toContain('② السيارات — سطر مستقل لكل سيارة')

    // سطر ثانٍ = سيارة ثانية في الفاتورة نفسها
    expect(dialog.querySelectorAll('[data-car-line]').length).toBe(1)
    fireEvent.click(dialog.querySelector('[data-add-car-line]') as HTMLElement)
    expect(dialog.querySelectorAll('[data-car-line]').length).toBe(2)

    typeIn(dialog.querySelector('[aria-label="ماركة السيارة 1"]'), 'تويوتا')
    typeIn(dialog.querySelector('[aria-label="موديل السيارة 1"]'), 'كامري')
    typeIn(dialog.querySelector('[aria-label="لوحة السيارة 1"]'), 'AAA-1')
    typeIn(dialog.querySelector('[aria-label="تكلفة السيارة 1"]'), '300000')
    typeIn(dialog.querySelector('[aria-label="ماركة السيارة 2"]'), 'كيا')
    typeIn(dialog.querySelector('[aria-label="موديل السيارة 2"]'), 'سيراتو')
    typeIn(dialog.querySelector('[aria-label="لوحة السيارة 2"]'), 'BBB-2')
    typeIn(dialog.querySelector('[aria-label="تكلفة السيارة 2"]'), '100000')

    // مصروف مرسمل يوزَّع بالقيمة 75/25
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('إضافة مصروف مرسمل')) as HTMLElement)
    typeIn(dialog.querySelector('[aria-label="بند مصروف الفاتورة"]'), 'نقل')
    typeIn(dialog.querySelector('[aria-label="قيمة مصروف الفاتورة"]'), '4000')

    // سداد جزئي: الباقي يتطلب مورداً
    fireEvent.click(dialog.querySelector('[data-pay-mode="mixed"]') as HTMLElement)
    typeIn(dialog.querySelector('[aria-label="المدفوع الآن من الفاتورة"]'), '100000')
    const supplierSearch = dialog.querySelector('[aria-label="بحث المورد"]') as HTMLInputElement
    fireEvent.focus(supplierSearch)
    fireEvent.change(supplierSearch, { target: { value: 'المستقبل' } })
    const option = document.querySelector('[data-quick-option][data-value]:not([data-value="0"])') as HTMLElement
    fireEvent.doubleClick(option)

    const post = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('ترحيل الفاتورة')) as HTMLButtonElement
    expect(post.disabled).toBe(false)
    fireEvent.click(post)

    const invoice = S().carPurchaseInvoices.at(-1)!
    expect(invoice.invoiceNumber).toBe('CPI-0001')
    expect(invoice.carIds.length).toBe(2)
    expect(invoice.totalMinor).toBe(404_000_00)
    expect(invoice.paidMinor).toBe(100_000_00)
    expect(invoice.dueMinor).toBe(304_000_00)
    // توزيع المصروف بالقيمة: 3000 للأولى و1000 للثانية
    const [first, second] = invoice.carIds.map((id) => S().cars.find((car) => car.id === id)!)
    expect(first.purchaseCostMinor).toBe(303_000_00)
    expect(second.purchaseCostMinor).toBe(101_000_00)
    // القيد متوازن والمتبقي على المورد
    const entry = S().journal.find((e) => e.id === invoice.entryId)!
    expect(entry.lines.reduce((sum, l) => sum + l.debit, 0)).toBe(entry.lines.reduce((sum, l) => sum + l.credit, 0))
    expect(entry.lines.filter((l) => l.accountCode === '1103').length).toBe(2)
    expect(S().getSupplierBalance(invoice.supplierId!)).toBe(304_000_00)
  })
})

describe('تجهيز السيارة على حساب ورشة', () => {
  it('نافذة التجهيز تعرض اختيار جهة مسجلة وزر إضافة ورشة جديدة عند الآجل', () => {
    const view = render(<MemoryRouter><CarsPage /></MemoryRouter>)
    const prepButton = view.container.querySelector('[title="تجهيز/إصلاح"], [title^="تجهيز"]') as HTMLElement
    fireEvent.click(prepButton)
    const dialog = lastDialog()
    const creditChip = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'آجل بالكامل') as HTMLElement
    fireEvent.click(creditChip)
    expect(dialog.textContent).toContain('الورشة / المصنع / جهة التجهيز')
    expect(dialog.querySelector('[data-supplier-inline-add]')).toBeTruthy()
    // بلا جهة = لا ترحيل
    typeIn(dialog.querySelector('input[inputmode="decimal"]'), '5000')
    const save = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('رسملة التكلفة')) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('التجهيز الآجل يُحمَّل على الورشة ويدخل كشف حسابها', () => {
    const car = S().cars[0]
    const workshop = S().suppliers.find((s) => s.nameAr === 'ورشة الإتقان')!
    const prep = S().addCarPrep(car.id, 20_000_00, 'mixed', 'سمكرة', '1101', 5_000_00, '', workshop.id)
    expect(prep.supplierId).toBe(workshop.id)
    expect(prep.dueMinor).toBe(15_000_00)
    expect(S().getSupplierBalance(workshop.id)).toBe(15_000_00)
    expect(S().getSupplierStatementRows(workshop.id).some((row) => row.docLabel.includes('تجهيز'))).toBe(true)
  })
})

describe('العقارات: سطر مستقل لكل وحدة', () => {
  it('مستند بيع الوحدات يعرض سطراً لكل وحدة شاغرة ويبيع المختار فقط', () => {
    const property = S().addProperty({
      nameAr: 'مجمع النور', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0,
      address: 'المنصورة', costMinor: 900_000_00, notes: '', acquisitionPayment: 'cash', treasury: '1101',
      initialUnits: [
        { code: 'شقة 1', annualRentMinor: 60_000_00, costMinor: 500_000_00, salePriceMinor: 700_000_00 },
        { code: 'شقة 2', annualRentMinor: 40_000_00, costMinor: 400_000_00, salePriceMinor: 600_000_00 },
      ],
    })
    const view = render(<MemoryRouter><PropertiesPage /></MemoryRouter>)
    fireEvent.click(view.container.querySelector('[data-open-unit-sale]') as HTMLElement)
    const dialog = lastDialog()
    expect(dialog.textContent).toContain('مستند بيع وحدات')
    expect(dialog.querySelectorAll('[data-unit-sale-line]').length).toBe(2)

    const units = S().propertyUnits.filter((u) => u.propertyId === property.id)
    fireEvent.click(dialog.querySelector(`[aria-label="اختيار الوحدة ${units[0].code}"]`) as HTMLElement)
    typeIn(dialog.querySelector(`[aria-label="سعر بيع الوحدة ${units[0].code}"]`), '700000')
    const post = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('ترحيل مستند البيع')) as HTMLButtonElement
    fireEvent.click(post)

    const doc = S().propertySales.at(-1)!
    expect(doc.lines.length).toBe(1)
    expect(doc.lines[0].priceMinor).toBe(700_000_00)
    expect(doc.lines[0].profitMinor).toBe(200_000_00)
    // الوحدة الأخرى باقية للتعامل مستقبلاً والعقار لم يُقفل
    expect(S().propertyUnits.find((u) => u.id === units[1].id)!.status).toBe('vacant')
    expect(S().properties.find((p) => p.id === property.id)!.status).toBe('active')
  })

  it('عقد إيجار واحد على وحدتين يحفظ سطراً لكل وحدة', () => {
    const property = S().addProperty({
      nameAr: 'برج الأمل', kind: 'commercial', ownership: 'owned', ownerName: '', commissionPercent: 0,
      address: 'المنصورة', costMinor: 200_000_00, notes: '', acquisitionPayment: 'cash', treasury: '1101',
      initialUnits: [
        { code: 'محل 1', annualRentMinor: 24_000_00, costMinor: 120_000_00, salePriceMinor: 0 },
        { code: 'محل 2', annualRentMinor: 12_000_00, costMinor: 80_000_00, salePriceMinor: 0 },
      ],
    })
    const units = S().propertyUnits.filter((u) => u.propertyId === property.id)
    const lease = S().addLease({
      propertyId: property.id,
      units: [{ unitId: units[0].id, rentMinor: 24_000_00 }, { unitId: units[1].id, rentMinor: 12_000_00 }],
      tenantName: 'مستأجر', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 0, depositMinor: 0,
    })
    expect(lease.unitLines?.length).toBe(2)
    expect(lease.totalRentMinor).toBe(36_000_00)
    expect(S().propertyUnits.filter((u) => u.propertyId === property.id).every((u) => u.status === 'leased')).toBe(true)
  })
})

describe('المقاولات: تكلفة مشروع على مقاول باطن', () => {
  it('سداد جزئي والباقي على مورد مسجل يظهر في كشف حسابه', () => {
    const project = S().addProject({ nameAr: 'فيلا 12', clientName: 'عميل', clientId: null, managerId: null, contractValueMinor: 1_000_000_00, retentionPercent: 5, startDate: '2026-01-01', endDate: '2026-06-01', notes: '' })
    S().addSupplier({ ...EMPTY, nameAr: 'مقاول باطن — الكهرباء', phone: '', notes: '' })
    const sub = S().suppliers.at(-1)!
    const cost = S().addProjectCost({ projectId: project.id, kind: 'subcontract', amountMinor: 50_000_00, payment: 'mixed', paidMinor: 20_000_00, supplierId: sub.id, description: 'تأسيس كهرباء', treasury: '1101' })
    expect(cost.payment).toBe('mixed')
    expect(cost.dueMinor).toBe(30_000_00)
    expect(S().getSupplierBalance(sub.id)).toBe(30_000_00)
    expect(S().getSupplierStatementRows(sub.id).some((row) => row.docLabel.includes('تكلفة مشروع'))).toBe(true)
    expect(() => S().addProjectCost({ projectId: project.id, kind: 'materials', amountMinor: 10_000_00, payment: 'mixed', paidMinor: 99_000_00, supplierId: sub.id, description: 'خ', treasury: '1101' })).toThrow()
  })
})
