import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

/**
 * مصفوفة سلوك العمليات التي لم يكن لها دليل تشغيلي (27 عملية).
 *
 * خلفية: بوابة `verify_money_operations_covered.mjs` كانت تطالب كل عملية مالية بدليل،
 * وتبقّى 27 عملية إدارية/مرجعية بلا أي اختبار يثبت سلوكها — لا نجاحاً ولا رفضاً.
 * هذه المصفوفة تغلق الفجوة باختبار سلوكي لكل عملية: أثر مرئي عند النجاح، ورفض صريح
 * عند المدخل غير الصالح، وتوثيق للسكوت المتعمد (حذف idempotent).
 */
const original = useDataStore.getState()
const S = () => useDataStore.getState()
const seed = (patch: Record<string, unknown>) => useDataStore.setState(patch as never)

beforeEach(() => useDataStore.setState(original))
afterEach(() => useDataStore.setState(original))

describe('مصفوفة سلوك: الفئات ومراكز التكلفة والقوالب', () => {
  it('updateCategory يغيّر الاسم، والمعرّف المجهول يمرّ بلا أثر (سكوت موثق)', () => {
    S().addCategory('أغذية', [])
    const category = S().categories[0]
    S().updateCategory(category.id, { nameAr: 'بقالة' })
    expect(S().categories[0].nameAr).toBe('بقالة')
    S().updateCategory(9999, { nameAr: 'لن يظهر' })
    expect(S().categories.map((row) => row.nameAr)).toEqual(['بقالة'])
  })

  it('removeCostCenter يحذف المركز، ويحرس المركز المستخدم في مستند', () => {
    const center = S().addCostCenter({ code: 'CC-9001', nameAr: 'إدارة' })
    S().addCostCenter({ code: 'CC-9002', nameAr: 'تشغيل' })
    seed({ vouchers: [{ id: 1, costCenterId: center.id } as never] })
    expect(() => S().removeCostCenter(center.id)).toThrow(/مستخدم في مستندات/)
    seed({ vouchers: [] })
    S().removeCostCenter(center.id)
    expect(S().costCenters.map((row) => row.code)).toEqual(['CC-9002'])
    S().removeCostCenter(9999) // سكوت متعمد: الحذف idempotent
    expect(S().costCenters).toHaveLength(1)
  })

  it('updateCostCenterBudget يعدّل المبلغ ويرفض المبلغ السالب والموازنة المجهولة', () => {
    const center = S().addCostCenter({ code: 'CC-9003', nameAr: 'صيانة' })
    const budget = S().addCostCenterBudget({ costCenterId: center.id, from: '2026-01-01', to: '2026-12-31', amountMinor: 100_000, notes: '' })
    S().updateCostCenterBudget(budget.id, { amountMinor: 250_000 })
    expect(S().costCenterBudgets[0].amountMinor).toBe(250_000)
    expect(() => S().updateCostCenterBudget(budget.id, { amountMinor: -1 })).toThrow(/غير سالب/)
    expect(() => S().updateCostCenterBudget(9999, { amountMinor: 1 })).toThrow(/الموازنة غير موجودة/)
    S().removeCostCenterBudget(budget.id)
    expect(S().costCenterBudgets).toHaveLength(0)
  })

  it('updateExpenseTemplate يطبّع الكود ويحفظ البند، والحذف يزيله', () => {
    const template = S().addExpenseTemplate({
      code: 'rent9', nameAr: 'إيجار فرع', accountCode: '5102', taxTreatment: 'exempt', taxPercent: 0,
      settlement: 'paid_now', affectsProfit: true, landedCostAllocation: 'none', notes: '',
    })
    S().updateExpenseTemplate(template.id, { code: ' rent10 ', nameAr: 'إيجار مستودع' })
    const updated = S().expenseTemplates.find((row) => row.id === template.id)!
    expect(updated.code).toBe('RENT10')
    expect(updated.nameAr).toBe('إيجار مستودع')
    expect(() => S().updateExpenseTemplate(9999, { nameAr: 'x' })).toThrow(/غير موجود/)
    S().removeExpenseTemplate(template.id)
    expect(S().expenseTemplates).toHaveLength(0)
  })
})

describe('مصفوفة سلوك: الماكينات والمركبات والمعدات', () => {
  const terminal = { id: 't-matrix', code: 'TERM-7001', nameAr: 'ماكينة', providerName: 'visanet', branchId: '', settlementAccountCode: '1102', terminalId: 'T7', status: 'active' as const }

  it('updatePaymentTerminal يعدّل البيانات ويرفض المعرّف المجهول', () => {
    S().addPaymentTerminal(terminal)
    S().updatePaymentTerminal('t-matrix', { nameAr: 'ماكينة الكاشير' })
    expect(S().paymentTerminals[0].nameAr).toBe('ماكينة الكاشير')
    expect(() => S().updatePaymentTerminal('missing', { nameAr: 'x' })).toThrow(/غير موجودة/)
  })

  it('removePaymentTerminal يحذف ماكينة بلا عمليات ويرفض ماكينة لها حركة', () => {
    S().addPaymentTerminal(terminal)
    S().addPaymentTerminal({ ...terminal, id: 't-busy', code: 'TERM-7002', terminalId: 'T8' })
    seed({ paymentTerminalTransactions: [{ id: 'tx-1', terminalId: 't-busy', kind: 'charge', amountMinor: 1000 } as never] })
    expect(() => S().removePaymentTerminal('t-busy')).toThrow(/لها عمليات/)
    S().removePaymentTerminal('t-matrix')
    expect(S().paymentTerminals.map((row) => row.id)).toEqual(['t-busy'])
  })

  it('updateVehicle يعدّل بيانات المركبة في مكانها', () => {
    S().addVehicle({ plateNumber: 'ABC-123', vehicleType: 'قلاب', defaultDriverId: null, notes: '' })
    const vehicle = S().vehicles[0]
    S().updateVehicle(vehicle.id, { notes: 'يحتاج صيانة', licenseExpiryDate: '2026-12-31' })
    expect(S().vehicles[0]).toMatchObject({ notes: 'يحتاج صيانة', licenseExpiryDate: '2026-12-31', plateNumber: 'ABC-123' })
  })

  it('updateEquipment وremoveEquipment: التعديل يمر، والحذف يرفض المعدة المرتبطة بعقد', () => {
    S().addEquipment({ nameAr: 'حفار', code: 'EQ-1', dailyRateMinor: 100_000, hourlyRateMinor: 0, monthlyRateMinor: 0, meterReading: 0, serviceEveryHours: 0, lastServiceMeter: 0 } as never)
    const equipment = S().equipment[0]
    S().updateEquipment(equipment.id, { nameAr: 'حفار كاتربيلر', dailyRateMinor: 120_000 })
    expect(S().equipment[0]).toMatchObject({ nameAr: 'حفار كاتربيلر', dailyRateMinor: 120_000 })
    seed({ rentalContracts: [{ id: 1, equipmentId: equipment.id } as never] })
    expect(() => S().removeEquipment(equipment.id)).toThrow(/مرتبطة بعقود/)
    seed({ rentalContracts: [] })
    S().removeEquipment(equipment.id)
    expect(S().equipment).toHaveLength(0)
  })

  it('addVehiclePart وupdateVehiclePart: التعديل يمر ويحرس الاسم والرصيد والتكلفة', () => {
    const part = S().addVehiclePart({ nameAr: 'فلتر زيت', qty: 4, unitCostMinor: 2500, minQty: 1, notes: '' })
    S().updateVehiclePart(part.id, { qty: 6, unitCostMinor: 2800 })
    expect(S().vehicleParts[0]).toMatchObject({ qty: 6, unitCostMinor: 2800 })
    expect(() => S().updateVehiclePart(part.id, { nameAr: '   ' })).toThrow(/اسم القطعة مطلوب/)
    expect(() => S().updateVehiclePart(part.id, { qty: -1 })).toThrow(/سالب/)
    expect(() => S().updateVehiclePart(part.id, { unitCostMinor: -5 })).toThrow(/سالب/)
    expect(() => S().updateVehiclePart(9999, { qty: 1 })).toThrow(/غير موجودة/)
  })

  it('updateInsuranceProvider يصحّح الاسم والنسبة ويحرس التكرار والنسبة غير الصالحة', () => {
    const provider = S().addInsuranceProvider({ nameAr: 'تأمين أ', coveragePercent: 80 })
    S().addInsuranceProvider({ nameAr: 'تأمين ب', coveragePercent: 70 })
    S().updateInsuranceProvider(provider.id, { nameAr: 'تأمين أ المتحد', coveragePercent: 85, phone: '0500000000' })
    expect(S().insuranceProviders.find((row) => row.id === provider.id)).toMatchObject({ nameAr: 'تأمين أ المتحد', coveragePercent: 85, phone: '0500000000' })
    expect(() => S().updateInsuranceProvider(provider.id, { nameAr: 'تأمين ب', coveragePercent: 85 })).toThrow()
    expect(() => S().updateInsuranceProvider(provider.id, { nameAr: 'تأمين أ المتحد', coveragePercent: 140 })).toThrow()
    expect(() => S().updateInsuranceProvider(9999, { nameAr: 'x', coveragePercent: 10 })).toThrow(/غير موجودة/)
  })

  it('updateMaintenanceService يعدّل السعر والتكلفة والتفعيل', () => {
    const service = S().addMaintenanceService({ nameAr: 'فحص شامل', costMinor: 5000, priceMinor: 9000 })
    S().updateMaintenanceService(service.id, { priceMinor: 12000, isActive: false })
    expect(S().maintenanceServices[0]).toMatchObject({ priceMinor: 12000, isActive: false, costMinor: 5000 })
  })
})

describe('مصفوفة سلوك: تذاكر الصيانة (الفني والإشعار والتوقيع وجلسات العمل)', () => {
  const openTicket = () => {
    seed({ employees: [{ id: 77, nameAr: 'فني أول' } as never, { id: 78, nameAr: 'فني ثانٍ' } as never] })
    return S().openTicket({ customerId: null, customerName: 'عميل', customerPhone: '0500000000', deviceName: 'جوال', issue: 'شاشة', estimateMinor: 0, notes: '' })
  }

  it('setTicketTechnician يعيّن الفنّي ويرفض تذكرة أو موظفاً مجهولاً', () => {
    const ticket = openTicket()
    S().setTicketTechnician(ticket.id, 77)
    expect(S().tickets[0].technicianId).toBe(77)
    S().setTicketTechnician(ticket.id, null)
    expect(S().tickets[0].technicianId).toBeNull()
    expect(() => S().setTicketTechnician(9999, 77)).toThrow(/التذكرة غير موجودة/)
    expect(() => S().setTicketTechnician(ticket.id, 555)).toThrow(/الموظف غير موجود/)
  })

  it('logTicketNotificationSent يراكم سجل الإشعارات ولا يمسّ التذكرة المجهولة', () => {
    const ticket = openTicket()
    S().logTicketNotificationSent(ticket.id, 'ready')
    S().logTicketNotificationSent(ticket.id, 'ready')
    expect(S().tickets[0].notifications).toHaveLength(2)
    expect(S().tickets[0].notifications?.[0].status).toBe('ready')
    expect(() => S().logTicketNotificationSent(9999, 'ready')).toThrow(/التذكرة غير موجودة/)
  })

  it('setTicketSignature يخزّن التوقيع لكل مرحلة ويرفض التوقيع الفارغ', () => {
    const ticket = openTicket()
    S().setTicketSignature(ticket.id, 'received', 'data:image/png;base64,AAA')
    expect(S().tickets[0].receivedSignatureDataUrl).toBe('data:image/png;base64,AAA')
    S().setTicketSignature(ticket.id, 'delivered', 'data:image/png;base64,BBB')
    expect(S().tickets[0].deliveredSignatureDataUrl).toBe('data:image/png;base64,BBB')
    expect(() => S().setTicketSignature(ticket.id, 'received', '')).toThrow(/التوقيع فارغ/)
  })

  it('startTicketWork وstopTicketWork: جلسة واحدة مفتوحة، والإيقاف بلا مفتوحة يُرفض', () => {
    const ticket = openTicket()
    S().startTicketWork(ticket.id)
    expect(S().tickets[0].workSessions).toHaveLength(1)
    expect(S().tickets[0].workSessions?.[0].endedAt).toBeNull()
    expect(() => S().startTicketWork(ticket.id)).toThrow(/جلسة عمل مفتوحة/)
    S().stopTicketWork(ticket.id)
    const session = S().tickets[0].workSessions?.[0]
    expect(session?.endedAt).toBeTruthy()
    expect(session!.endedAt! >= session!.startedAt).toBe(true)
    // الطرفان على أساس زمني واحد: كلاهما محلي بإزاحة، لا UTC مقابل محلي
    expect(session!.startedAt.endsWith('Z')).toBe(false)
    expect(session!.endedAt!.endsWith('Z')).toBe(false)
    S().startTicketWork(ticket.id)
    expect(S().tickets[0].workSessions).toHaveLength(2)
  })
})

describe('مصفوفة سلوك: الموارد البشرية (استيراد الحضور وأنواع الإجازات)', () => {
  it('importAttendance يُدخل صفوفاً بمصدر import ويرفض القائمة الفارغة والموظف خارج الفرع', () => {
    seed({ employees: [{ id: 11, nameAr: 'موظف' } as never] })
    const result = S().importAttendance({
      rows: [{ employeeId: 11, date: '2026-11-01', status: 'present', checkIn: '09:00', checkOut: '17:00' }],
      fileName: 'attend.xlsx', by: 'المدير',
    })
    expect(result).toMatchObject({ inserted: 1, updated: 0 })
    expect(S().attendanceRecords[0]).toMatchObject({ employeeId: 11, date: '2026-11-01', source: 'import' })
    const again = S().importAttendance({ rows: [{ employeeId: 11, date: '2026-11-01', status: 'absent' }], fileName: 'attend.xlsx', by: 'المدير' })
    expect(again.updated).toBe(1)
    expect(S().attendanceRecords).toHaveLength(1)
    expect(() => S().importAttendance({ rows: [], fileName: 'x', by: 'المدير' })).toThrow(/لا صفوف/)
    expect(() => S().importAttendance({ rows: [{ employeeId: 999, date: '2026-11-02', status: 'present' }], fileName: 'x', by: 'المدير' })).toThrow()
  })

  it('updateLeaveTypes يحفظ الأنواع ويرفض الفراغ والرصيد غير السليم', () => {
    const types = [{ id: 'annual', nameAr: 'سنوية', paid: true, annualQuotaDays: 30 }, { id: 'unpaid', nameAr: 'بلا راتب', paid: false, annualQuotaDays: 0 }]
    S().updateLeaveTypes(types as never)
    expect(S().leaveTypes).toHaveLength(2)
    expect(S().leaveTypes?.[0].annualQuotaDays).toBe(30)
    expect(() => S().updateLeaveTypes([])).toThrow(/نوع واحد على الأقل/)
    expect(() => S().updateLeaveTypes([{ id: 'bad', nameAr: 'سيئة', paid: true, annualQuotaDays: -1 }] as never)).toThrow(/غير سليم/)
  })
})

describe('مصفوفة سلوك: ملاحظات الأطراف والاختبارات الجاهزة وقوائم الأسعار والعمولات', () => {
  it('updatePartyNote يحرّر النص ويوقّع بالمحرِّر، وdeletePartyNote يحذف', () => {
    const note = S().addPartyNote({ partyKind: 'customer', partyId: 5, text: 'يفضّل الدفع نقداً', userName: 'الكاشير' })
    S().updatePartyNote(note.id, 'يفضّل التحويل البنكي', 'المحاسب')
    const edited = S().partyNotes[0]
    expect(edited.text).toBe('يفضّل التحويل البنكي')
    expect(edited.editedBy).toBe('المحاسب')
    expect(edited.editedAt).toBeTruthy()
    S().deletePartyNote(note.id)
    expect(S().partyNotes).toHaveLength(0)
  })

  it('seedStarterTests يزرع الاختبارات مرة واحدة فقط (idempotent بالكود)', () => {
    const first = S().seedStarterTests(10_000)
    expect(first).toBeGreaterThan(0)
    expect(S().labTests).toHaveLength(first)
    const second = S().seedStarterTests(10_000)
    expect(second).toBe(0)
    expect(S().labTests).toHaveLength(first)
  })

  it('updatePriceList يعدّل القائمة ويرفض الاسم المكرر والنسبة غير الصالحة', () => {
    const list = S().addPriceList('جملة', 5)
    S().updatePriceList(list.id, 'جملة كبرى', 8)
    expect(S().priceLists[0]).toMatchObject({ nameAr: 'جملة كبرى', defaultDiscountPercent: 8 })
    S().addPriceList('تجزئة', 0)
    expect(() => S().updatePriceList(list.id, 'تجزئة', 8)).toThrow(/بهذا الاسم/)
    expect(() => S().updatePriceList(list.id, 'جملة كبرى', 140)).toThrow()
  })

  it('updateCommissionParty يعدّل الاسم ويرفض التكرار والطرف المجهول', () => {
    const party = S().addCommissionParty({ nameAr: 'سمسار الرياض', phone: '0500000000', kind: 'سمسار', notes: '' })
    S().addCommissionParty({ nameAr: 'مركز أشعة', phone: '', kind: 'مركز', notes: '' })
    S().updateCommissionParty(party.id, { nameAr: 'سمسار الشمال', phone: '0511111111' })
    expect(S().commissionParties.find((row) => row.id === party.id)).toMatchObject({ nameAr: 'سمسار الشمال', phone: '0511111111' })
    expect(() => S().updateCommissionParty(party.id, { nameAr: 'مركز أشعة' })).toThrow(/مسجل من قبل/)
    expect(() => S().updateCommissionParty(9999, { nameAr: 'x' })).toThrow(/الطرف غير موجود/)
  })

  it('previewProjectDeletionFingerprint يرفض مشروعاً غير موجود ويعيد بصمة مستقرة للموجود', () => {
    expect(() => S().previewProjectDeletionFingerprint(9999)).toThrow(/المشروع غير موجود/)
    seed({ projects: [{ id: 42, code: 'PRJ-0042', nameAr: 'مشروع تجريبي', clientId: null, status: 'active', branchId: null } as never] })
    const first = S().previewProjectDeletionFingerprint(42)
    const second = S().previewProjectDeletionFingerprint(42)
    expect(typeof first).toBe('string')
    expect(first.length).toBeGreaterThan(0)
    expect(second).toBe(first)
  })
})
