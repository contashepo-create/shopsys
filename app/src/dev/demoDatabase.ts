/**
 * جسر قاعدة البيانات التجريبية (وضع التطوير فقط).
 *
 * القاعدة ملف SQLite حقيقي في `app/demo-db/demo.sqlite` تقدّمه إضافة Vite
 * على مسارات `/__demo/*`. هذا الملف يقرأ نشاطاً كاملاً ويحقنه في متجر التطبيق
 * عبر الإجراءات الرسمية (لا setState أعمى) حتى تبقى القيود المحاسبية سليمة،
 * ويعيد كتابة التعديلات إلى الملف نفسه عند الحفظ.
 *
 * لا شيء هنا يعمل في الإنتاج: كل دالة تتحقق من import.meta.env.DEV.
 */
import { useDataStore } from '../data/repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { ACTIVITY_TEMPLATES } from '../core/activities.ts'
import { getCountry } from '../core/countries.ts'
import { DEMO_WIPE_KEY } from './demoBoot.ts'

export interface DemoActivitySummary {
  id: string
  name_ar: string
  shop_name: string
  owner_name: string
  note: string
  items: number
  customers: number
  suppliers: number
  warehouses: number
  branches: number
  treasuries: number
  terminals: number
  sales: number
  purchases: number
  employees: number
  quotations: number
  purchaseOrders: number
}

interface Row { [key: string]: string | number }
interface DemoPayload {
  activity: Row
  branches: Row[]
  warehouses: Row[]
  treasuries: Row[]
  terminals: Row[]
  categories: Row[]
  items: Row[]
  customers: Row[]
  suppliers: Row[]
  costCenters: Row[]
  sales: (Row & { lines: Row[] })[]
  purchases: (Row & { lines: Row[] })[]
  /* توسعة المرحلة ⑥: موارد بشرية ومستندات تجارية */
  employees?: Row[]
  attendance?: Row[]
  leaves?: Row[]
  payrollMonths?: Row[]
  quotations?: (Row & { lines: Row[] })[]
  purchaseOrders?: (Row & { lines: Row[] })[]
  wastage?: (Row & { lines: Row[] })[]
  equipment?: Row[]
  rentalContracts?: Row[]
  equipmentCosts?: Row[]
  subContracts?: Row[]
  projectExtracts?: Row[]
}

const str = (value: unknown, fallback = '') => (value == null ? fallback : String(value))
const num = (value: unknown, fallback = 0) => (value == null || value === '' ? fallback : Number(value))
const bool = (value: unknown) => Number(value ?? 0) === 1

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'تعذّر الاتصال بقاعدة البيانات التجريبية')
  return body as T
}

export async function fetchDemoActivities(): Promise<{ path: string; activities: DemoActivitySummary[] }> {
  if (!import.meta.env.DEV) return { path: '', activities: [] }
  return api('/__demo/activities')
}

export const DEMO_PENDING_KEY = 'shopsys-demo-pending'

/**
 * التنقل إلى نشاط آخر يبدأ من صفحة بيضاء: تُمسح الحالة المحفوظة ثم تُعاد تهيئة
 * الصفحة، ويُستكمل التحميل تلقائياً بعد الإقلاع — فلا تختلط بيانات نشاطين.
 */
export function switchDemoActivity(activityId: string): void {
  if (!import.meta.env.DEV) return
  localStorage.setItem(DEMO_PENDING_KEY, activityId)
  localStorage.setItem(DEMO_WIPE_KEY, '1') // المسح الفعلي يتم في demoBoot قبل ترطيب المتاجر
  localStorage.removeItem('shopsys-data')
  localStorage.removeItem('shopsys-app')
  location.reload()
}

/** يحمّل نشاطاً كاملاً من قاعدة البيانات إلى المتجر (يستبدل البيانات الحالية للنشاط). */
export async function loadDemoActivity(activityId: string): Promise<{ items: number; sales: number; purchases: number; skipped: string[]; employees: number; attendance: number; leaves: number; payrollMonths: number; quotations: number; purchaseOrders: number; wastage: number; subContracts: number; projectExtracts: number; equipment: number; rentals: number; equipmentCosts: number; costCenters: number }> {
  if (!import.meta.env.DEV) throw new Error('البيانات التجريبية متاحة في وضع التطوير فقط')
  const skipped: string[] = []
  const payload = await api<DemoPayload>(`/__demo/data?activity=${encodeURIComponent(activityId)}`)
  const app = useAppStore.getState()
  const template = ACTIVITY_TEMPLATES.find((activity) => activity.id === activityId) ?? ACTIVITY_TEMPLATES[0]
  const country = getCountry(app.setup.countryCode || 'EG') ?? getCountry('EG')!

  /* 1) تهيئة الحساب على النشاط المطلوب (التنقل بين الأنشطة مطلب المالك) */
  app.completeSetup({
    country,
    activity: template,
    shopName: str(payload.activity.shop_name, template.nameAr),
    ownerName: str(payload.activity.owner_name, 'محمد عبده'),
    fiscalYear: { nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
    contact: { phone: str(payload.activity.phone), email: '', city: str(payload.activity.city), street: '' },
  })

  const data = () => useDataStore.getState()
  data().seed(template.features)

  /* 2) المخازن والفروع */
  const warehouseId = new Map<string, number>()
  for (const row of payload.warehouses) {
    try { data().addWarehouse(str(row.name_ar)) } catch { /* اسم مكرر */ }
    const created = data().warehouses.find((warehouse) => warehouse.nameAr === str(row.name_ar).trim())
    if (created) warehouseId.set(str(row.ref), created.id)
  }

  /* 3) الخزائن والبنوك والمحافظ الإلكترونية (المحفظة فرعية تحت بنكها) */
  const treasuryCode = new Map<string, string>()
  const ordered = [...payload.treasuries].sort((a, b) => Number(str(a.parent_ref) !== '') - Number(str(b.parent_ref) !== ''))
  for (const row of ordered) {
    const kind = str(row.kind) === 'cash' ? 'cash' : 'bank'
    const parent = str(row.parent_ref) ? treasuryCode.get(str(row.parent_ref)) ?? null : null
    try {
      const created = data().addTreasury(str(row.name_ar), kind, {
        parentCode: parent,
        channel: str(row.kind) === 'wallet' ? 'wallet' : str(row.kind) === 'bank' ? 'bank_account' : undefined,
        accountNumber: str(row.account_no) || undefined,
        aliasAr: str(row.bank_name) || undefined,
      } as never)
      treasuryCode.set(str(row.ref), created.code)
    } catch {
      /* الاسم مكرر مع خزائن البذرة الافتراضية ⇒ اربط المرجع بالخزينة الموجودة بدل إهماله */
      const existing = data().treasuries.find((treasury) => treasury.nameAr === str(row.name_ar).trim())
      if (existing) treasuryCode.set(str(row.ref), existing.code)
    }
  }

  /* رصيد افتتاحي حقيقي لكل خزينة/بنك/محفظة (بقيد افتتاحي نظامي لا بحقنة صامتة) */
  for (const row of payload.treasuries) {
    const code = treasuryCode.get(str(row.ref))
    const amount = num(row.opening_minor)
    if (!code || amount <= 0) continue
    try { data().setOpeningBalance({ kind: 'treasury', refId: code, amountMinor: amount, label: str(row.name_ar) }) }
    catch { /* بيانات تجريبية */ }
  }

  for (const row of payload.branches) {
    const branchWarehouse = payload.warehouses.find((warehouse) => str(warehouse.branch_ref) === str(row.ref))
    const branchTreasury = payload.treasuries.find((treasury) => str(treasury.branch_ref) === str(row.ref))
    try {
      data().addBranch({
        nameAr: str(row.name_ar),
        warehouseId: warehouseId.get(str(branchWarehouse?.ref)) ?? data().warehouses[0]?.id ?? 0,
        treasuryCode: treasuryCode.get(str(branchTreasury?.ref)) ?? data().treasuries[0]?.code ?? '',
        address: str(row.city),
        phone: str(row.phone),
      }, 99)
    } catch { /* الفرع الرئيسي موجود بالفعل من البذرة */ }
  }

  /* 4) ماكينات الدفع (سؤال المالك ⑱: الفاتورة تحصّل من ماكينة فعلاً) */
  for (const row of payload.terminals) {
    try {
      data().addPaymentTerminal({
        id: str(row.code).toLowerCase(),
        code: str(row.code),
        nameAr: str(row.name_ar),
        providerName: str(row.provider_name),
        branchId: str(data().branches.find((branch) => branch.nameAr.includes(str(row.branch_ref)))?.id ?? data().branches[0]?.id ?? '1'),
        settlementAccountCode: treasuryCode.get(str(row.settlement_ref)) ?? data().treasuries[0]?.code ?? '',
        terminalId: str(row.terminal_id),
        merchantId: str(row.merchant_id) || undefined,
        serialNumber: str(row.serial_number) || undefined,
        status: 'active',
      })
    } catch { /* كود مكرر */ }
  }

  /* 4.5) مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
  let costCentersAdded = 0
  for (const row of payload.costCenters) {
    try {
      data().addCostCenter({ code: str(row.code), nameAr: str(row.name_ar), notes: str(row.notes) || undefined })
      costCentersAdded++
    } catch { /* كود مكرر */ }
  }

  /* 5) الفئات والأصناف */
  const categoryId = new Map<string, number>()
  for (const row of payload.categories) {
    const name = str(row.name_ar)
    try { data().addCategory(name, template.features) } catch { /* موجودة من البذرة */ }
    const created = data().categories.find((category) => category.nameAr === name.trim()) ?? data().categories.at(-1)
    if (created) categoryId.set(str(row.ref), created.id)
  }
  const itemId = new Map<string, number>()
  for (const row of payload.items) {
    const extraUnits = str(row.extra_units)
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [nameAr, factor] = chunk.split(':')
        return { nameAr: nameAr.trim(), factor: Number(factor) || 1 }
      })
    try { data().addItem({
      nameAr: str(row.name_ar),
      sku: str(row.sku),
      barcodes: str(row.barcode) ? [str(row.barcode)] : [],
      categoryId: categoryId.get(str(row.category_ref)) ?? data().categories[0]?.id ?? 1,
      baseUnit: str(row.base_unit, 'قطعة'),
      extraUnits: extraUnits as never,
      costMinor: num(row.cost_minor),
      stockQty: num(row.stock_qty),
      priceMinor: num(row.price_minor),
      minQty: num(row.min_qty),
      trackExpiry: bool(row.track_expiry),
      trackSerial: bool(row.track_serial),
      warrantyMonths: num(row.warranty_months),
      soldByWeight: bool(row.sold_by_weight),
      variantColors: str(row.colors) ? str(row.colors).split(',').map((color) => color.trim()) : [],
      variantSizes: str(row.sizes) ? str(row.sizes).split(',').map((size) => size.trim()) : [],
      isActive: true,
      isService: bool(row.is_service),
    } as never) } catch (error) { skipped.push(`صنف ${str(row.name_ar)}: ${(error as Error).message}`) }
    const created = data().items.find((item) => item.nameAr === str(row.name_ar).trim())
    if (created) itemId.set(str(row.ref), created.id)
  }

  /* 6) العملاء والموردون */
  const customerId = new Map<string, number>()
  for (const row of payload.customers) {
    try { data().addCustomer({ nameAr: str(row.name_ar), phone: str(row.phone), creditLimitMinor: num(row.credit_limit_minor), notes: str(row.notes) } as never) }
    catch { /* اسم مكرر — نربطه بالموجود */ }
    const created = data().customers.find((customer) => customer.nameAr === str(row.name_ar).trim())
    if (created) customerId.set(str(row.ref), created.id)
  }
  const supplierId = new Map<string, number>()
  for (const row of payload.suppliers) {
    try { data().addSupplier({ nameAr: str(row.name_ar), phone: str(row.phone), notes: str(row.notes) } as never) }
    catch { /* اسم مكرر — نربطه بالموجود */ }
    const created = data().suppliers.find((supplier) => supplier.nameAr === str(row.name_ar).trim())
    if (created) supplierId.set(str(row.ref), created.id)
  }

  /* 7) فواتير الشراء ثم البيع — بالإجراءات الرسمية كي تُبنى القيود والمخزون بصدق */
  let purchasesPosted = 0
  for (const purchase of payload.purchases) {
    const lines = purchase.lines
      .map((line) => ({ itemId: itemId.get(str(line.item_ref)) ?? 0, qty: num(line.qty), unitPriceMinor: num(line.unit_price_minor), warehouseId: warehouseId.get(str(purchase.warehouse_ref)) ?? null, expiryDate: str(line.expiry_date) || null }))
      .filter((line) => line.itemId)
    if (!lines.length) continue
    try {
      data().postPurchase({
        supplierId: supplierId.get(str(purchase.supplier_ref)) ?? 0,
        supplierInvoiceNumber: str(purchase.supplier_doc) || undefined,
        date: str(purchase.doc_date),
        lines: lines as never,
        expenses: [],
        paidMinor: num(purchase.paid_minor),
        treasury: treasuryCode.get(str(purchase.treasury_ref)) as never,
        warehouseId: warehouseId.get(str(purchase.warehouse_ref)) ?? null,
        notes: str(purchase.notes),
      } as never)
      purchasesPosted += 1
    } catch (error) { skipped.push(`شراء ${str(purchase.ref)}: ${(error as Error).message}`) }
  }

  let salesPosted = 0
  for (const sale of payload.sales) {
    const lines = sale.lines
      .map((line) => {
        const id = itemId.get(str(line.item_ref)) ?? 0
        const item = data().items.find((row) => row.id === id)
        return {
          itemId: id,
          nameAr: item?.nameAr ?? '',
          qty: num(line.qty),
          unitPriceMinor: num(line.unit_price_minor),
          unitCostMinor: item?.costMinor ?? 0,
          discountPercent: num(line.discount_percent),
          soldByWeight: item?.soldByWeight ?? false,
        }
      })
      .filter((line) => line.itemId)
    if (!lines.length) continue
    const payment = str(sale.payment, 'cash')
    const grossMinor = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPriceMinor * (1 - line.discountPercent / 100)), 0)
    const paidMinor = payment === 'credit' ? num(sale.paid_minor) : grossMinor
    try {
      data().postSale({
        lines: lines as never,
        customerId: customerId.get(str(sale.customer_ref)) ?? null,
        payment: (payment === 'credit' ? 'credit' : payment === 'card' ? 'card' : 'cash') as never,
        invoiceDiscountPercent: 0,
        taxPercent: 0,
        taxInclusive: false,
        treasury: treasuryCode.get(str(sale.treasury_ref)) as never,
        paidMinor,
        warehouseId: warehouseId.get(str(sale.warehouse_ref)) ?? null,
        documentDate: str(sale.doc_date),
        notes: str(sale.notes),
        allowNegativeStock: true,
      } as never)
      salesPosted += 1
    } catch (error) { skipped.push(`بيع ${str(sale.ref)}: ${(error as Error).message}`) }
  }

  /* 8) توسعة المرحلة ⑥ (طلب المالك ㉘): موظفون وحضور وإجازات ومسير رواتب
        وعروض أسعار وأوامر شراء — كلها بالإجراءات الرسمية فتُبنى الذمم والقيود بصدق */
  const employeeId = new Map<string, number>()
  let employeesAdded = 0
  for (const row of payload.employees ?? []) {
    try {
      data().addEmployee({
        nameAr: str(row.name_ar), phone: str(row.phone), jobTitle: str(row.job_title), hireDate: str(row.hire_date, '2026-01-01'),
        baseSalaryMinor: num(row.base_salary_minor), allowancesMinor: num(row.allowances_minor), active: row.active !== 0, notes: str(row.notes),
      } as never)
      employeesAdded += 1
    } catch (error) { skipped.push(`موظف ${str(row.name_ar)}: ${(error as Error).message}`) }
    const created = data().employees.find((employee) => employee.nameAr === str(row.name_ar).trim())
    if (created) employeeId.set(str(row.ref), created.id)
  }

  let attendanceMarked = 0
  for (const row of payload.attendance ?? []) {
    const id = employeeId.get(str(row.employee_ref))
    if (!id) continue
    try {
      data().setAttendanceDay({
        employeeId: id, date: str(row.date), status: (str(row.status, 'present') || 'present') as never,
        checkIn: str(row.check_in) || null, checkOut: str(row.check_out) || null, notes: str(row.notes) || null,
      } as never)
      attendanceMarked += 1
    } catch (error) { skipped.push(`حضور ${str(row.date)}: ${(error as Error).message}`) }
  }

  let leavesAdded = 0
  for (const row of payload.leaves ?? []) {
    const id = employeeId.get(str(row.employee_ref))
    if (!id) continue
    try {
      const created = data().addLeaveRequest({ employeeId: id, typeId: str(row.type_id, 'annual') || 'annual', from: str(row.from_date), to: str(row.to_date), reason: str(row.reason) } as never)
      if (str(row.status) === 'approved') data().decideLeaveRequest(created.id, true, str(payload.activity?.owner_name) || 'المالك')
      else if (str(row.status) === 'rejected') data().decideLeaveRequest(created.id, false, str(payload.activity?.owner_name) || 'المالك')
      leavesAdded += 1
    } catch (error) { skipped.push(`إجازة ${str(row.ref)}: ${(error as Error).message}`) }
  }

  /* مسير الرواتب: استحقاق قسائم الشهر لكل الموظفين، ثم سداد المحددين بسند صرف على 2104 */
  let payrollMonths = 0
  for (const row of payload.payrollMonths ?? []) {
    const month = str(row.month)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    const rowsOut = data().employees
      .filter((employee) => employee.active)
      .map((employee) => ({ employeeId: employee.id, grossMinor: employee.baseSalaryMinor, allowancesMinor: employee.allowancesMinor, deductionsMinor: 0, advanceMinor: 0 }))
    if (!rowsOut.length) continue
    try {
      data().accruePayrollSlips({ month, rows: rowsOut } as never)
      const payRefs = str(row.pay_employee_refs).split(',').map((chunk) => chunk.trim()).filter(Boolean)
      const slips = data().payrollSlips.filter((slip) => slip.month === month && payRefs.some((ref) => employeeId.get(ref) === slip.employeeId))
      if (slips.length) {
        const amountMinor = slips.reduce((sum, slip) => sum + slip.netMinor, 0)
        data().postVoucher({
          kind: 'payment', treasury: (treasuryCode.get(str(row.treasury_ref)) ?? '1101') as never,
          counterAccountCode: '2104', amountMinor, description: `صرف رواتب ${month} — من البيانات التجريبية`,
          partyKind: 'employee', partyId: slips[0].employeeId, settleSlipIds: slips.map((slip) => slip.id),
        } as never)
      }
      payrollMonths += 1
    } catch (error) { skipped.push(`مسير ${month}: ${(error as Error).message}`) }
  }

  let quotationsAdded = 0
  const quotationProjectId = new Map<string, number>() // مرجع العرض ← مشروع متحول منه
  for (const quotation of payload.quotations ?? []) {
    const lines = (quotation.lines ?? [])
      .map((line) => ({
        nameAr: str(line.name_ar), descriptionAr: str(line.description_ar), qty: num(line.qty, 1),
        unitAr: str(line.unit_ar, 'مقطوعية') || 'مقطوعية', unitPriceMinor: num(line.unit_price_minor),
        estCostMinor: num(line.est_cost_minor), vatPercent: num(line.vat_percent), taxIncluded: !!line.tax_included,
      }))
      .filter((line) => line.descriptionAr)
    if (!lines.length) continue
    try {
      const created = data().addQuotation({
        kind: (str(quotation.kind, 'quotation') || 'quotation') as never, clientName: str(quotation.client_name),
        clientId: customerId.get(str(quotation.client_ref)) ?? null, titleAr: str(quotation.title_ar),
        validUntil: str(quotation.valid_until), lines: lines as never, notes: str(quotation.notes),
        winProbability: num(quotation.win_probability, 50), bidBondMinor: num(quotation.bid_bond_minor),
      } as never)
      const status = str(quotation.status)
      if (status === 'submitted' || status === 'won' || status === 'lost') data().setQuotationStatus(created.id, status)
      /* عرض فائز يُحوَّل مشروعاً كاملاً (المقاولات): بنوده تصير جدول كمياته */
      if (str(quotation.convert) === 'project') {
        try {
          data().setQuotationStatus(created.id, 'won')
          const project = data().convertQuotationToProject(created.id, 5)
          quotationProjectId.set(str(quotation.ref), project.id)
          skipped.push(`مشروع ${project.code} أُنشئ من ${created.quoteNumber} ✓`)
        } catch (error) { skipped.push(`تحويل ${created.quoteNumber} لمشروع: ${(error as Error).message}`) }
      }
      quotationsAdded += 1
    } catch (error) { skipped.push(`عرض ${str(quotation.ref)}: ${(error as Error).message}`) }
  }

  /* 9) تعميق المرحلة ⑥: مقاولو الباطن والمستخلصات (المقاولات) والمعدات
        وعقود الإيجار (التأجير) — كلها بالإجراءات الرسمية فتُبنى القيود والذمم */
  let subContracts = 0
  for (const row of payload.subContracts ?? []) {
    const projectId = quotationProjectId.get(str(row.quotation_ref))
    if (!projectId) { skipped.push(`عقد باطن ${str(row.ref)}: لا مشروع مرتبط`); continue }
    try {
      const contract = data().addSubContract({
        projectId, contractorName: str(row.contractor_name), supplierId: supplierId.get(str(row.supplier_ref)) ?? null,
        scopeAr: str(row.scope_ar), contractValueMinor: num(row.contract_value_minor),
        retentionPercent: num(row.retention_percent, 5), taxWithholdPercent: num(row.tax_withhold_percent),
        advanceRecoveryPercent: num(row.advance_percent), startDate: str(row.start_date, new Date().toISOString().slice(0, 10)),
      } as never)
      if (num(row.advance_minor) > 0)
        data().addSubAdvance({ contractId: contract.id, amountMinor: num(row.advance_minor), treasury: (treasuryCode.get(str(row.advance_treasury_ref)) ?? '1101') as never } as never)
      if (num(row.certificate_amount_minor) > 0)
        data().addSubCertificate({ contractId: contract.id, amountMinor: num(row.certificate_amount_minor), description: str(row.certificate_description, 'شهادة أعمال') } as never)
      subContracts += 1
    } catch (error) { skipped.push(`عقد باطن ${str(row.ref)}: ${(error as Error).message}`) }
  }

  let projectExtracts = 0
  for (const row of payload.projectExtracts ?? []) {
    const projectId = quotationProjectId.get(str(row.quotation_ref))
    if (!projectId) { skipped.push(`مستخلص ${str(row.ref)}: لا مشروع مرتبط`); continue }
    const percent = Math.min(100, Math.max(0, num(row.percent)))
    if (percent <= 0) continue
    try {
      data().addProjectExtract({
        projectId,
        extractLines: data().boqItems.filter((item) => item.projectId === projectId).map((item) => ({ boqItemId: item.id, newProgressPercent: percent })),
        vatPercent: num(row.vat_percent, 14), payment: (str(row.payment, 'credit') === 'cash' ? 'cash' : 'credit') as never,
        description: str(row.description, 'مستخلص'), treasury: (treasuryCode.get(str(row.treasury_ref)) ?? '1101') as never,
      } as never)
      projectExtracts += 1
    } catch (error) { skipped.push(`مستخلص ${str(row.ref)}: ${(error as Error).message}`) }
  }

  const equipmentId = new Map<string, number>()
  let equipmentAdded = 0
  for (const row of payload.equipment ?? []) {
    try {
      data().addEquipment({
        nameAr: str(row.name_ar), code: str(row.code), dailyRateMinor: num(row.daily_rate_minor),
        hourlyRateMinor: num(row.hourly_rate_minor), monthlyRateMinor: num(row.monthly_rate_minor),
        meterReading: num(row.meter_reading), serviceEveryHours: num(row.service_every_hours),
        lastServiceReading: 0, notes: str(row.notes),
      } as never)
      equipmentAdded += 1
    } catch (error) { skipped.push(`معدة ${str(row.name_ar)}: ${(error as Error).message}`) }
    const created = data().equipment.find((row2) => row2.nameAr === str(row.name_ar).trim())
    if (created) equipmentId.set(str(row.ref), created.id)
  }

  let rentalsOpened = 0
  for (const row of payload.rentalContracts ?? []) {
    const eqId = equipmentId.get(str(row.equipment_ref))
    const equipmentRow = data().equipment.find((row2) => row2.id === eqId)
    if (!equipmentRow) { skipped.push(`عقد إيجار ${str(row.ref)}: المعدة غير موجودة`); continue }
    try {
      const contract = data().openRental({
        customerId: customerId.get(str(row.customer_ref)) ?? null, equipmentId: eqId,
        input: {
          equipmentName: equipmentRow.nameAr, days: num(row.days), dailyRateMinor: num(row.daily_rate_minor),
          depositMinor: num(row.deposit_minor), payment: (str(row.payment, 'cash') === 'mixed' ? 'mixed' : str(row.payment) === 'credit' ? 'credit' : 'cash') as never,
          paidMinor: num(row.paid_minor) || undefined, vatPercent: num(row.vat_percent),
        } as never,
        notes: str(row.notes), treasury: (treasuryCode.get(str(row.treasury_ref)) ?? '1101') as never,
      } as never)
      /* عقد مقفل: خصم تالفيات ورد التأمين — بقيد إقفال مستقل؛ تسوية التجاوز
         تُحسب فقط إن كان تاريخ الإرجاع اليوم أو بعده (تاريخ فتح العقد = لحظة التحميل) */
      const endDate = str(row.close_end_date)
      const todayIso = new Date().toISOString().slice(0, 10)
      if (num(row.close_deduct_minor) > 0 || endDate)
        data().closeRental(contract.id, num(row.close_deduct_minor), endDate && endDate >= todayIso ? { endDate } : undefined, (treasuryCode.get(str(row.treasury_ref)) ?? '1101') as never)
      rentalsOpened += 1
    } catch (error) { skipped.push(`عقد إيجار ${str(row.ref)}: ${(error as Error).message}`) }
  }

  let equipmentCosts = 0
  for (const row of payload.equipmentCosts ?? []) {
    const eqId = equipmentId.get(str(row.equipment_ref))
    if (!eqId || num(row.amount_minor) <= 0) continue
    try {
      data().addEquipmentCost({ equipmentId: eqId, kind: (str(row.kind, 'fuel') || 'fuel') as never, amountMinor: num(row.amount_minor), description: str(row.description), treasury: (treasuryCode.get(str(row.treasury_ref)) ?? '1101') as never } as never)
      equipmentCosts += 1
    } catch (error) { skipped.push(`مصروف معدة ${str(row.ref)}: ${(error as Error).message}`) }
  }

  /* مستندات الهالك: من لوحة فرز المنتهي أو الجرد — قيد 5111/1103 يولده postWastage */
  let wastagePosted = 0
  for (const doc of payload.wastage ?? []) {
    const lines = (doc.lines ?? [])
      .map((line) => ({ itemId: itemId.get(str(line.item_ref)) ?? 0, qty: num(line.qty) }))
      .filter((line) => line.itemId && line.qty > 0)
    if (!lines.length) continue
    try {
      data().postWastage({ reason: str(doc.reason, 'انتهاء صلاحية') || 'انتهاء صلاحية', lines: lines as never, notes: str(doc.notes) } as never)
      wastagePosted += 1
    } catch (error) { skipped.push(`إتلاف ${str(doc.ref)}: ${(error as Error).message}`) }
  }

  let ordersAdded = 0
  for (const order of payload.purchaseOrders ?? []) {
    const lines = (order.lines ?? [])
      .map((line) => {
        const id = itemId.get(str(line.item_ref)) ?? 0
        const item = data().items.find((row) => row.id === id)
        return { itemId: id, nameAr: item?.nameAr ?? '', qty: num(line.qty), receivedQty: 0, unitAr: item?.baseUnit ?? 'قطعة', unitPriceMinor: num(line.unit_price_minor), vatPercent: num(line.vat_percent), notes: '' }
      })
      .filter((line) => line.itemId)
    if (!lines.length) continue
    try {
      const supplier = supplierId.get(str(order.supplier_ref))
      data().addPurchaseOrder({
        supplierId: supplier ?? null, supplierName: data().suppliers.find((row) => row.id === supplier)?.nameAr ?? 'مورد نقدي',
        date: str(order.order_date), expectedDate: str(order.expected_date), warehouseId: warehouseId.get(str(order.warehouse_ref)) ?? null,
        notes: str(order.notes), lines: lines as never,
      } as never)
      ordersAdded += 1
    } catch (error) { skipped.push(`أمر شراء ${str(order.ref)}: ${(error as Error).message}`) }
  }

  return { items: itemId.size, sales: salesPosted, purchases: purchasesPosted, skipped, employees: employeesAdded, attendance: attendanceMarked, leaves: leavesAdded, payrollMonths, quotations: quotationsAdded, purchaseOrders: ordersAdded, wastage: wastagePosted, subContracts, projectExtracts, equipment: equipmentAdded, rentals: rentalsOpened, equipmentCosts, costCenters: costCentersAdded }
}

/** يحفظ البيانات الرئيسية الحالية من المتجر إلى ملف قاعدة البيانات (تعديل حقيقي). */
export async function saveDemoActivity(activityId: string): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('البيانات التجريبية متاحة في وضع التطوير فقط')
  const data = useDataStore.getState()
  const app = useAppStore.getState()
  const categoryRef = new Map(data.categories.map((category) => [category.id, `cat-${category.id}`]))
  const payload = {
    activity: { id: activityId, name_ar: app.setup.activityId ?? activityId, shop_name: app.setup.shopName, owner_name: app.setup.ownerName, city: '', phone: '', note: 'محفوظ من داخل التطبيق' },
    branches: data.branches.map((branch, index) => ({ ref: `br-${index + 1}`, name_ar: branch.nameAr, city: branch.address ?? '', phone: branch.phone ?? '', is_main: index === 0 ? 1 : 0 })),
    warehouses: data.warehouses.map((warehouse) => ({ ref: `wh-${warehouse.id}`, name_ar: warehouse.nameAr, branch_ref: '', is_main: warehouse.isMain ? 1 : 0 })),
    treasuries: data.treasuries.map((treasury) => ({
      ref: `tr-${treasury.code}`, name_ar: treasury.nameAr,
      kind: treasury.channel === 'wallet' ? 'wallet' : treasury.kind,
      parent_ref: treasury.parentCode ? `tr-${treasury.parentCode}` : '',
      bank_name: treasury.aliasAr ?? '', account_no: treasury.accountNumber ?? '', branch_ref: '', opening_minor: 0,
    })),
    terminals: data.paymentTerminals.map((terminal) => ({
      code: terminal.code, name_ar: terminal.nameAr, provider_name: terminal.providerName, branch_ref: '',
      settlement_ref: `tr-${terminal.settlementAccountCode}`, terminal_id: terminal.terminalId,
      merchant_id: terminal.merchantId ?? '', serial_number: terminal.serialNumber ?? '', status: terminal.status,
    })),
    categories: data.categories.map((category) => ({ ref: categoryRef.get(category.id)!, name_ar: category.nameAr })),
    items: data.items.map((item) => ({
      ref: `it-${item.id}`, name_ar: item.nameAr, sku: item.sku ?? '', barcode: item.barcodes?.[0] ?? '',
      category_ref: categoryRef.get(item.categoryId ?? 0) ?? '', base_unit: item.baseUnit ?? 'قطعة',
      extra_units: (item.extraUnits ?? []).map((unit) => `${unit.nameAr}:${unit.factor}`).join(','),
      cost_minor: item.costMinor ?? 0, price_minor: item.priceMinor ?? 0, stock_qty: item.stockQty ?? 0, min_qty: item.minQty ?? 0,
      is_service: item.isService ? 1 : 0, track_expiry: item.trackExpiry ? 1 : 0, track_serial: item.trackSerial ? 1 : 0,
      sold_by_weight: item.soldByWeight ? 1 : 0, warranty_months: item.warrantyMonths ?? 0,
      colors: (item.variantColors ?? []).join(','), sizes: (item.variantSizes ?? []).join(','),
    })),
    customers: data.customers.map((customer) => ({ ref: `cu-${customer.id}`, name_ar: customer.nameAr, phone: customer.phone ?? '', credit_limit_minor: customer.creditLimitMinor ?? 0, notes: customer.notes ?? '' })),
    suppliers: data.suppliers.map((supplier) => ({ ref: `su-${supplier.id}`, name_ar: supplier.nameAr, phone: supplier.phone ?? '', notes: supplier.notes ?? '' })),
    /* توسعة المرحلة ⑥: الموظفون والحضور والإجازات والعروض والأوامر تُحفظ أيضاً */
    employees: data.employees.map((employee) => ({ ref: `em-${employee.id}`, name_ar: employee.nameAr, phone: employee.phone ?? '', job_title: employee.jobTitle ?? '', hire_date: employee.hireDate ?? '', base_salary_minor: employee.baseSalaryMinor ?? 0, allowances_minor: employee.allowancesMinor ?? 0, active: employee.active ? 1 : 0, notes: employee.notes ?? '' })),
    attendance: data.attendanceRecords.map((record) => ({ ref: `at-${record.id}`, employee_ref: `em-${record.employeeId}`, date: record.date, status: record.status, check_in: record.checkIn ?? '', check_out: record.checkOut ?? '', notes: record.notes ?? '' })),
    leaves: data.leaveRequests.map((request) => ({ ref: `lv-${request.id}`, employee_ref: `em-${request.employeeId}`, type_id: request.typeId, from_date: request.from, to_date: request.to, status: request.status, reason: request.reason ?? '' })),
    payrollMonths: [],
    quotations: data.quotations.map((quotation) => ({
      ref: `qt-${quotation.id}`, kind: quotation.kind, client_name: quotation.clientName, client_ref: '',
      title_ar: quotation.titleAr, valid_until: quotation.validUntil, status: quotation.status,
      win_probability: quotation.winProbability ?? 0, bid_bond_minor: quotation.bidBondMinor ?? 0, notes: quotation.notes ?? '',
      lines: quotation.lines.map((line) => ({ name_ar: line.nameAr, description_ar: line.descriptionAr, unit_ar: line.unitAr, qty: line.qty, unit_price_minor: line.unitPriceMinor, est_cost_minor: line.estCostMinor ?? 0, vat_percent: line.vatPercent ?? 0, tax_included: line.taxIncluded ? 1 : 0 })),
    })),
    purchaseOrders: data.purchaseOrders.map((order) => ({
      ref: `po-${order.id}`, supplier_ref: order.supplierId ? `su-${order.supplierId}` : '', order_date: order.date,
      expected_date: order.expectedDate ?? '', warehouse_ref: order.warehouseId ? `wh-${order.warehouseId}` : '', notes: order.notes ?? '',
      lines: order.lines.map((line) => ({ item_ref: `it-${line.itemId}`, qty: line.qty, unit_price_minor: line.unitPriceMinor, vat_percent: line.vatPercent ?? 0 })),
    })),
    wastage: data.wastages.map((doc) => ({
      ref: `wd-${doc.id}`, doc_date: doc.date, reason: doc.reason, notes: doc.notes ?? '',
      lines: doc.lines.map((line: any) => ({ item_ref: `it-${line.itemId}`, qty: line.qty })),
    })),
    /* تعميق المرحلة ⑥: المعدات والعقود والباطن والمستخلصات */
    equipment: data.equipment.map((row: any) => ({ ref: `eq-${row.id}`, name_ar: row.nameAr, code: row.code ?? '', daily_rate_minor: row.dailyRateMinor ?? 0, hourly_rate_minor: row.hourlyRateMinor ?? 0, monthly_rate_minor: row.monthlyRateMinor ?? 0, meter_reading: row.meterReading ?? 0, service_every_hours: row.serviceEveryHours ?? 0, notes: row.notes ?? '' })),
    rentalContracts: data.rentalContracts.map((row: any) => ({
      ref: `rc-${row.id}`, customer_ref: row.customerId ? `cu-${row.customerId}` : '', equipment_ref: `eq-${row.equipmentId ?? ''}`,
      days: row.days ?? 0, daily_rate_minor: row.dailyRateMinor ?? 0, deposit_minor: row.totals?.depositMinor ?? 0,
      payment: row.payment ?? 'cash', paid_minor: row.totals?.rentMinor != null ? Math.max(0, (row.totals.grandMinor ?? 0) - (row.totals.collectCreditMinor ?? 0) - (row.totals.depositMinor ?? 0)) : 0,
      vat_percent: row.vatPercent ?? 0,
      start_date: row.date ?? '', notes: row.notes ?? '', close_deduct_minor: row.deductMinor ?? 0,
      close_end_date: row.status === 'closed' ? (row.date ?? '') : '', treasury_ref: '',
    })),
    equipmentCosts: data.equipmentCosts.map((row: any) => ({ ref: `ec-${row.id}`, equipment_ref: `eq-${row.equipmentId}`, date: row.date, kind: row.kind, amount_minor: row.amountMinor, description: row.description ?? '', treasury_ref: row.treasury ?? '' })),
    subContracts: data.subContracts.map((row: any) => ({
      ref: `sc-${row.id}`, quotation_ref: '', contractor_name: row.contractorName, supplier_ref: row.supplierId ? `su-${row.supplierId}` : '',
      scope_ar: row.scopeAr, contract_value_minor: row.contractValueMinor, retention_percent: row.retentionPercent ?? 5,
      tax_withhold_percent: row.taxWithholdPercent ?? 0, advance_percent: row.advanceRecoveryPercent ?? 0,
      start_date: row.startDate ?? '', advance_minor: 0, advance_treasury_ref: '', certificate_amount_minor: 0, certificate_description: '',
    })),
    projectExtracts: [],
    sales: [],
    purchases: [],
  }
  await api('/__demo/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
}

/** يعيد بناء القاعدة من ملف البذور (تراجع عن كل التعديلات). */
export async function resetDemoDatabase(): Promise<void> {
  if (!import.meta.env.DEV) return
  await api('/__demo/reset', { method: 'POST' })
}
