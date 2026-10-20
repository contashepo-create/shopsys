/**
 * صفحة "بيانات المنشأة" (طلب المالك): هوية المنشأة (اسم/مالك)، بيانات التواصل
 * (هاتف/بريد/موقع)، العنوان (مدينة/شارع/رقم مبنى/رمز بريدي/صندوق بريد)،
 * البيانات الرسمية (سجل تجاري + رقم ضريبي موحَّد)، وشعار المنشأة للقراءة فقط
 * كلها قابلة للتعديل من مكان واحد الآن — بعد أن كانت (عدا الرقم الضريبي)
 * تُكتب مرة واحدة فقط في معالج الإعداد الأول بلا أي شاشة لاحقة لتعديلها.
 *
 * الرقم الضريبي موحَّد: هذه الصفحة تحرّره مباشرة في نفس مكان تخزينه الأصلي
 * (einvoice.taxNumber) فلا يتكرر التخزين، وتتيح تعبئته حتى مع عدم تفعيل
 * ميزة الفاتورة الإلكترونية بالترخيص. شاشة الفاتورة الإلكترونية تعرضه للقراءة
 * فقط مع رابط للتعديل من هنا.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { useToast } = await import('../src/ui/components/ui.tsx')
const { CompanyProfilePage } = await import('../src/ui/pages/CompanyProfilePage.tsx')
const { GeneralSettingsPage } = await import('../src/ui/pages/GeneralSettingsPage.tsx')
const { EinvoicePage } = await import('../src/ui/pages/EinvoicePage.tsx')

function resetStore() {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery',
      shopName: 'بقالة الأمل', ownerName: 'المالك', phone: '0100000000', email: 'old@example.com',
      city: 'القاهرة', street: 'شارع النصر',
      commercialRegister: '', poBox: '', postalCode: '', buildingNo: '', website: '',
      features: [], modules: [], accountingMode: 'full',
      vatPercent: 0, taxInclusive: false, taxRegistrationStatus: 'exempt',
    },
    einvoice: { ...app.einvoice, taxNumber: '' },
  })
  useToast.setState({ msg: null, kind: 'success' })
}

beforeEach(() => resetStore())
afterEach(() => cleanup())

describe('صفحة بيانات المنشأة', () => {
  it('تعرض الاسم الحالي ويمكن تعديله وحفظه فيتحدّث في متجر الإعداد فوراً', () => {
    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)
    const input = screen.getByPlaceholderText('اسم منشأتك') as HTMLInputElement
    expect(input.value).toBe('بقالة الأمل')

    fireEvent.change(input, { target: { value: 'سوبر ماركت النور' } })
    fireEvent.click(screen.getByText('💾 حفظ بيانات المنشأة'))

    expect(useAppStore.getState().setup.shopName).toBe('سوبر ماركت النور')
  })

  it('لا يحفظ اسماً فارغاً (مسافات فقط) ويظهر تنبيهاً', () => {
    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)
    const input = screen.getByPlaceholderText('اسم منشأتك') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('💾 حفظ بيانات المنشأة'))

    expect(useAppStore.getState().setup.shopName).toBe('بقالة الأمل')
    expect(useToast.getState().kind).toBe('error')
  })

  it('يرفض صيغة بريد إلكتروني غير صحيحة', () => {
    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)
    const emailInput = screen.getByPlaceholderText('name@example.com') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'ليس بريداً' } })
    fireEvent.click(screen.getByText('💾 حفظ بيانات المنشأة'))

    expect(useAppStore.getState().setup.email).toBe('old@example.com')
    expect(useToast.getState().kind).toBe('error')
  })

  it('يحفظ كل الحقول الجديدة (سجل تجاري، صندوق بريد، رمز بريدي، رقم مبنى، موقع إلكتروني، رقم ضريبي)', () => {
    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)

    fireEvent.change(screen.getByPlaceholderText('www.example.com'), { target: { value: 'www.amal.test' } })
    const [buildingNoInput, postalCodeInput, poBoxInput] = screen.getAllByRole('textbox').filter((el) =>
      (el as HTMLInputElement).value === '' && el.getAttribute('dir') === 'ltr'
    ) as HTMLInputElement[]
    expect(buildingNoInput && postalCodeInput && poBoxInput).toBeTruthy()
    fireEvent.change(buildingNoInput, { target: { value: '12' } })
    fireEvent.change(postalCodeInput, { target: { value: '11511' } })
    fireEvent.change(poBoxInput, { target: { value: '999' } })

    const regInput = document.querySelector('input[dir="ltr"][value=""]') as HTMLInputElement
    // السجل التجاري والرقم الضريبي كلاهما LTR بلا placeholder؛ نحددهما عبر قسم "البيانات الرسمية"
    const officialSection = screen.getByText('البيانات الرسمية').closest('section') as HTMLElement
    const officialInputs = officialSection.querySelectorAll('input') as NodeListOf<HTMLInputElement>
    expect(officialInputs.length).toBe(2)
    fireEvent.change(officialInputs[0], { target: { value: 'CR-55512' } })
    fireEvent.change(officialInputs[1], { target: { value: '123456789' } })

    void regInput
    fireEvent.click(screen.getByText('💾 حفظ بيانات المنشأة'))

    const state = useAppStore.getState()
    expect(state.setup.website).toBe('www.amal.test')
    expect(state.setup.buildingNo).toBe('12')
    expect(state.setup.postalCode).toBe('11511')
    expect(state.setup.poBox).toBe('999')
    expect(state.setup.commercialRegister).toBe('CR-55512')
    expect(state.einvoice.taxNumber).toBe('123456789')
  })

  it('تعرض شعار المنشأة للقراءة فقط مع رابط لإعدادات الطباعة', () => {
    useAppStore.setState((s) => ({ receipt: { ...s.receipt, logoDataUrl: 'data:image/png;base64,abc' } }))
    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)
    const img = screen.getByAltText('الشعار') as HTMLImageElement
    expect(img.src).toContain('data:image/png;base64,abc')
    const link = screen.getByRole('link', { name: /إعدادات الطباعة/ })
    expect(link.getAttribute('href')).toBe('/settings/printing')
  })
})

describe('الإعدادات العامة بعد نقل بيانات المنشأة', () => {
  it('تعرض رابطاً إلى صفحة بيانات المنشأة بدلاً من حقل اسم قابل للتعديل', () => {
    render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
    expect(screen.queryByPlaceholderText('اسم منشأتك')).toBeNull()
    const link = screen.getByText(/بيانات المنشأة/).closest('a')
    expect(link?.getAttribute('href')).toBe('/settings/company')
  })
})

describe('توحيد الرقم الضريبي في شاشة الفاتورة الإلكترونية', () => {
  it('تعرض الرقم الضريبي للقراءة فقط وتحيل التعديل إلى صفحة بيانات المنشأة', () => {
    useAppStore.setState((s) => ({
      einvoice: { ...s.einvoice, taxNumber: '310122393500003' },
      activatedPayload: {
        v: 1, deviceId: 'dev-1', customer: 'بقالة الأمل', plan: 'pro',
        features: ['einvoice_sa'], issuedAt: '2026-01-01', expiresAt: null,
      },
    }))
    render(<MemoryRouter><EinvoicePage /></MemoryRouter>)
    const input = screen.getByDisplayValue('310122393500003') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    const link = screen.getByText('تعديل ←').closest('a')
    expect(link?.getAttribute('href')).toBe('/settings/company')
  })
})
