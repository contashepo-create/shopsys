import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore, EMPTY_EXTENDED } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { NAV_SECTIONS } from '../src/ui/navCatalog.tsx'

const original = useDataStore.getState()

describe('تحديثات اللوجستيات وسندات القبض للمشاريع (النقاط الـ 9)', () => {
  beforeEach(() => {
    localStorage.setItem('shopsys-app', JSON.stringify({ state: { allowNegativeTreasury: true, setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 15 } } }))
    useAppStore.setState((s) => ({
      ...s,
      setup: {
        ...s.setup,
        countryCode: 'SA',
        vatPercent: 15,
        requireOpenShiftForSales: false,
        allowNegativeTreasury: true,
      },
    }))
    useDataStore.setState({
      ...original,
      customers: [],
      employees: [],
      vehicles: [],
      trips: [],
      tripExpenses: [],
      projects: [],
      projectExtracts: [],
      vouchers: [],
      journal: [],
      clientSettlements: [],
      driverDues: [],
      documentFiles: [],
    })
  })

  it('1) يوحد تحصيلات عملاء المقاولات داخل سندات القبض مع أولوية FIFO لمستخلصات المشروع المختار', () => {
    const contractingNav = NAV_SECTIONS.find((s) => s.id === 'contracting')
    expect(contractingNav?.children.some((c) => c.path === '/contracting/collections')).toBe(false)

    const S = () => useDataStore.getState()
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'شركة الإعمار للمقاولات', phone: '0500000001', creditLimitMinor: 0, notes: '' })
    const cust = S().customers[0]!

    const p1 = S().addProject({
      code: 'PRJ-01',
      nameAr: 'مشروع برج النخيل',
      clientId: cust.id,
      clientName: cust.nameAr,
      contractValueMinor: 500_000,
      retentionPercent: 0,
      startDate: '2026-01-01',
      notes: '',
    })
    const p2 = S().addProject({
      code: 'PRJ-02',
      nameAr: 'مشروع مستودعات الشرق',
      clientId: cust.id,
      clientName: cust.nameAr,
      contractValueMinor: 500_000,
      retentionPercent: 0,
      startDate: '2026-02-01',
      notes: '',
    })

    const ex1 = S().addProjectExtract({
      projectId: p1.id,
      description: 'مستخلص 1 برج النخيل',
      grossMinor: 100_000,
      vatPercent: 0,
      payment: 'credit',
    })
    const ex2 = S().addProjectExtract({
      projectId: p2.id,
      description: 'مستخلص 1 مستودعات الشرق',
      grossMinor: 80_000,
      vatPercent: 0,
      payment: 'credit',
    })

    // سند قبض مربوط بالمشروع الثاني (p2) بدون تخصيص يدوي ⇒ يخصص لمستخلص المشروع الثاني أولاً ثم الباقي للأقدم
    S().postVoucher({
      kind: 'receipt',
      treasury: '1101',
      counterAccountCode: '1104',
      amountMinor: 90_000,
      description: 'دفعة على مشروع مستودعات الشرق',
      partyKind: 'customer',
      partyId: cust.id,
      projectId: p2.id,
    })

    const openDocs = S().getOpenClientInvoices(cust.id)
    // مستخلص المشروع الثاني (80,000) سُدّد بالكامل، ومستخلص المشروع الأول سُدّد منه 10,000 وبقي 90,000
    const remEx2 = openDocs.find((d) => d.docKey === `extract:${ex2.id}`)
    expect((remEx2?.dueMinor ?? 0) - (remEx2?.settledMinor ?? 0)).toBe(0)
    const remEx1 = openDocs.find((d) => d.docKey === `extract:${ex1.id}`)
    expect((remEx1?.dueMinor ?? 0) - (remEx1?.settledMinor ?? 0)).toBe(90_000)
    expect(S().getCustomerBalance(cust.id)).toBe(90_000)
  })

  it('2-8) يسجل فاتورة نقلة ببنود خدمية من المخزن وأرقام حاويات وضريبة ومرفقات، ويفصل مصاريف النقلات، ويدعم تعديل النقلة بعد تسجيلها', () => {
    const logisticsNav = NAV_SECTIONS.find((s) => s.id === 'logistics')
    expect(logisticsNav?.children.some((c) => c.path === '/logistics/expenses')).toBe(true)

    const S = () => useDataStore.getState()
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'شركة الموانئ العالمية', phone: '0500000002', creditLimitMinor: 0, notes: '' })
    const cust = S().customers[0]!

    S().addEmployee({
      ...EMPTY_EXTENDED,
      nameAr: 'كابتن سعيد الدوسري',
      phone: '0555555555',
      jobTitle: 'سائق تريلا',
      hireDate: '2026-01-01',
      baseSalaryMinor: 400_000,
      allowancesMinor: 0,
      active: true,
      notes: '',
    })
    const drv = S().employees[0]!

    S().addVehicle({
      plateNumber: 'أ ب ج 1111',
      vehicleType: 'تريلا',
      defaultDriverId: drv.id,
      notes: '',
    })
    const veh = S().vehicles[0]!
    expect(veh.defaultDriverId).toBe(drv.id)

    const svcId = S().ensureServiceItemForFreeLine({
      nameAr: 'خدمة نقل داخلي من الميناء إلى التخزين',
      unitAr: 'نقلة',
      priceMinor: 50_000,
    })

    const trip = S().postTrip({
      customerId: cust.id,
      vehicleId: veh.id,
      driverId: drv.id,
      input: {
        fromLoc: 'الميناء',
        toLoc: 'التخزين',
        qty: 3,
        unitPriceMinor: 50_000,
        vatPercent: 15,
        payment: 'credit',
        containerNumbers: ['CONT-1', 'CONT-2', 'CONT-3'],
        expenses: [],
        lines: [
          {
            itemId: svcId,
            serviceNameAr: 'خدمة نقل داخلي من الميناء إلى التخزين',
            fromLoc: 'الميناء',
            toLoc: 'التخزين',
            qty: 3,
            unitPriceMinor: 50_000,
            containerNumbers: ['CONT-1', 'CONT-2', 'CONT-3'],
          },
        ],
      },
      notes: 'شحنة 3 حاويات',
      driverCommissionMinor: 10_000,
    })

    // مرفق على فاتورة النقلة
    const docFile = S().addDocumentFile({
      documentKind: 'trip',
      documentId: trip.id,
      name: 'waybill.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      addedBy: 'المالك',
    })
    expect(docFile.documentKind).toBe('trip')
    expect(trip.totals.baseMinor).toBe(150_000)
    expect(trip.totals.vatMinor).toBe(22_500)
    expect(trip.totals.grandMinor).toBe(172_500)
    expect(S().getCustomerBalance(cust.id)).toBe(172_500)

    // مصروف داخلي على الشركة (5106) من قسم مصاريف النقلات
    const expCompany = S().addTripExpense({
      tripId: trip.id,
      nameAr: 'سولار وكارتة طريق',
      qty: 1,
      unitAmountMinor: 20_000,
      bearer: 'company',
      paymentSource: 'cash',
      treasury: '1101',
    })
    expect(expCompany.bearer).toBe('company')
    expect(S().getCustomerBalance(cust.id)).toBe(172_500) // لا يتأثر رصيد العميل

    // مصروف محمّل على العميل (1104) من قسم مصاريف النقلات
    const expCust = S().addTripExpense({
      tripId: trip.id,
      nameAr: 'أرضيات ميناء على العميل',
      qty: 1,
      unitAmountMinor: 30_000,
      bearer: 'customer',
      paymentSource: 'cash',
      treasury: '1101',
    })
    expect(expCust.bearer).toBe('customer')
    expect(S().getCustomerBalance(cust.id)).toBe(202_500) // زاد رصيد العميل بـ 30,000

    // تعديل النقلة بعد تسجيلها إلى نقلتين بدون ضريبة
    const updated = S().updateTrip({
      tripId: trip.id,
      customerId: cust.id,
      vehicleId: veh.id,
      driverId: drv.id,
      input: {
        fromLoc: 'الميناء',
        toLoc: 'التخزين',
        qty: 2,
        unitPriceMinor: 60_000,
        vatPercent: 0,
        payment: 'credit',
        containerNumbers: ['CONT-1', 'CONT-2'],
        expenses: [],
        lines: [
          {
            itemId: svcId,
            serviceNameAr: 'خدمة نقل داخلي من الميناء إلى التخزين',
            fromLoc: 'الميناء',
            toLoc: 'التخزين',
            qty: 2,
            unitPriceMinor: 60_000,
            containerNumbers: ['CONT-1', 'CONT-2'],
          },
        ],
      },
      notes: 'تعديل إلى حاويتين بدون ضريبة',
      driverCommissionMinor: 8_000,
    })

    expect(updated.totals.grandMinor).toBe(120_000)
    expect(updated.totals.costMinor).toBe(20_000) // مصروف الشركة محفوظ
    expect(updated.totals.profitMinor).toBe(100_000)
    expect(S().getCustomerBalance(cust.id)).toBe(150_000) // 120,000 النقلة + 30,000 مصروف العميل
    expect(S().getDriverDueBalance(drv.id)).toBe(8_000)

    // عكس مصروف النقلة المحمّل على العميل (reverseTripExpense)
    const revExp = S().reverseTripExpense(expCust.id)
    expect(revExp.reversedByEntryId).toBeTruthy()
    expect(S().getCustomerBalance(cust.id)).toBe(120_000) // عاد رصيد العميل إلى 120,000 بعد عكس المصروف
  })
})
