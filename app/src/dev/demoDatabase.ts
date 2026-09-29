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
  sales: (Row & { lines: Row[] })[]
  purchases: (Row & { lines: Row[] })[]
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
export async function loadDemoActivity(activityId: string): Promise<{ items: number; sales: number; purchases: number; skipped: string[] }> {
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
      .map((line) => ({ itemId: itemId.get(str(line.item_ref)) ?? 0, qty: num(line.qty), unitPriceMinor: num(line.unit_price_minor), warehouseId: warehouseId.get(str(purchase.warehouse_ref)) ?? null }))
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

  return { items: itemId.size, sales: salesPosted, purchases: purchasesPosted, skipped }
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
