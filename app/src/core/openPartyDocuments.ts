/**
 * مستندات الأنشطة المتخصصة القابلة للتخصيص في سندات القبض والصرف.
 *
 * البند الأول المتبقي من تقرير التدقيق (§8/٢): «تخصيص السند على **مستندات نشاط
 * متخصص** (مستخلص/طلب معمل) من شاشة السندات — اليوم يتم من شاشة النشاط أو FIFO».
 *
 * القاعدة التي يقوم عليها هذا الملف: **مصدر حقيقة واحد**. قواعد الاستحقاق هنا هي
 * نفسها قواعد كشف الحساب في `statements.ts` حرفياً (نفس الاستثناءات: المغسلة
 * تُحصَّل عند التسليم فلا تصير ذمة، التذكرة لا تُستحق قبل التسليم، المستخلص
 * يُخصم منه المسترد من الدفعة المقدمة…)، حتى لا يظهر في شاشة السندات مستندٌ
 * مفتوح لا يقابله دين في الكشف أو العكس.
 *
 * كل مستند يخرج بمفتاح ثابت `نوع:رقم` يُخزَّن داخل توزيع السند (`FifoAllocation`)،
 * فيصير دفتر التخصيص هو السجل الفرعي الوحيد لهذه المستندات.
 */

export type Minor = number

export interface OpenPartyDocument {
  docKey: string
  docLabel: string
  date: string
  dueMinor: Minor
  settledMinor: Minor
}

const positive = (value: number | undefined | null) => Math.max(0, value ?? 0)

/** خصم مرتجعات «على حساب العميل» من ذمة المستند نفسه */
const creditRefunds = (refunds?: readonly { mode: string; amountMinor: Minor }[]) =>
  (refunds ?? []).filter((refund) => refund.mode === 'customer_credit').reduce((sum, refund) => sum + positive(refund.amountMinor), 0)

export interface CustomerSpecializedInput {
  customerId: number
  /** ما خُصِّص سابقاً لكل مفتاح مستند من سندات القبض/سجلات التحصيل */
  settledOf: (docKey: string) => Minor
  labOrders?: readonly { id: number; orderNumber: string; date: string; patientId: number; payment: string; paidMinor?: number; totals: { totalMinor: Minor }; refunds?: readonly { mode: string; amountMinor: Minor }[] }[]
  linkedLabPatientIds?: readonly number[]
  clinicVisits?: readonly { id: number; visitNumber: string; date: string; patientId: number; totals: { totalMinor: Minor; paidMinor: Minor; dueMinor: Minor } }[]
  /** كل تحصيلات العيادة (بسند أو بدونه) — دفتر تسوية الزيارات الوحيد */
  clinicCollections?: readonly { patientId: number; date: string; amountMinor: Minor }[]
  linkedPatientIds?: readonly number[]
  rentals?: readonly { id: number; contractNumber: string; date: string; customerId: number | null; totals: { grandMinor: Minor; collectCreditMinor: Minor }; refunds?: readonly { mode: string; amountMinor: Minor }[] }[]
  trips?: readonly { id: number; tripNumber: string; date: string; customerId: number | null; payment: string; paidMinor?: number; totals: { grandMinor: Minor }; refunds?: readonly { mode: string; amountMinor: Minor }[] }[]
  tickets?: readonly { id: number; ticketNumber: string; customerId: number | null; deliveredAt: string | null; totals: { grandMinor: Minor; paidMinor: Minor } | null; refunds?: readonly { mode: string; amountMinor: Minor }[] }[]
  walletOps?: readonly { id: number; opNumber: string; date: string; customerId: number | null; status: string; chargeMinor: Minor; paidMinor: Minor }[]
  cars?: readonly { id: number; make: string; model: string; plateOrVin: string; buyerCustomerId?: number | null; salePayment?: string | null; salePaidMinor?: number | null; saleTotalMinor?: number | null; soldAt?: string | null }[]
  propertySales?: readonly { id: number; saleNumber: string; date: string; buyerCustomerId: number | null; dueMinor: Minor }[]
}

/**
 * زيارات العيادة: التحصيلات مسجَّلة على **المريض** لا على الزيارة، فتُطبَّق
 * على زياراته بالأقدم أولاً — وهي نفس طريقة `patientBalance` في ملف المريض،
 * حتى لا يختلف ما تراه شاشة السندات عمّا يراه ملف المريض.
 */
function openClinicVisits(input: CustomerSpecializedInput): OpenPartyDocument[] {
  const patients = new Set(input.linkedPatientIds ?? [])
  if (!patients.size) return []
  const rows: OpenPartyDocument[] = []
  for (const patientId of patients) {
    let pool = (input.clinicCollections ?? [])
      .filter((collection) => collection.patientId === patientId)
      .reduce((sum, collection) => sum + positive(collection.amountMinor), 0)
    const visits = (input.clinicVisits ?? [])
      .filter((visit) => visit.patientId === patientId && positive(visit.totals.dueMinor) > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    for (const visit of visits) {
      const due = positive(visit.totals.dueMinor)
      const covered = Math.min(due, pool)
      pool -= covered
      if (due - covered <= 0) continue
      rows.push({ docKey: `visit:${visit.id}`, docLabel: `زيارة عيادة ${visit.visitNumber}`, date: visit.date.slice(0, 10), dueMinor: due - covered, settledMinor: 0 })
    }
  }
  return rows
}

/** مستندات العميل المتخصصة المفتوحة (بلا فواتير البيع والمستخلصات — لها مساراهما في repo) */
export function openCustomerSpecializedDocuments(input: CustomerSpecializedInput): OpenPartyDocument[] {
  const rows: OpenPartyDocument[] = []
  const push = (docKey: string, docLabel: string, date: string, dueMinor: Minor) => {
    if (dueMinor <= 0) return
    rows.push({ docKey, docLabel, date: date.slice(0, 10), dueMinor, settledMinor: input.settledOf(docKey) })
  }

  const labPatients = new Set(input.linkedLabPatientIds ?? [])
  for (const order of input.labOrders ?? []) {
    if (!labPatients.has(order.patientId) || order.totals.totalMinor <= 0) continue
    const paid = order.paidMinor ?? (order.payment === 'cash' ? order.totals.totalMinor : 0)
    push(`lab:${order.id}`, `طلب معمل ${order.orderNumber}`, order.date, order.totals.totalMinor - positive(paid) - creditRefunds(order.refunds))
  }

  rows.push(...openClinicVisits(input))

  for (const rental of input.rentals ?? []) {
    if (rental.customerId !== input.customerId) continue
    push(`rental:${rental.id}`, `عقد إيجار ${rental.contractNumber}`, rental.date, positive(rental.totals.collectCreditMinor) - creditRefunds(rental.refunds))
  }

  for (const trip of input.trips ?? []) {
    if (trip.customerId !== input.customerId || trip.totals.grandMinor <= 0) continue
    const paid = trip.paidMinor ?? (trip.payment === 'cash' ? trip.totals.grandMinor : 0)
    push(`trip:${trip.id}`, `نقلة ${trip.tripNumber}`, trip.date, trip.totals.grandMinor - positive(paid) - creditRefunds(trip.refunds))
  }

  for (const ticket of input.tickets ?? []) {
    // التذكرة لا تصير ذمة قبل التسليم — إيرادها لم يُعترف به بعد (نفس قاعدة الكشف)
    if (ticket.customerId !== input.customerId || !ticket.deliveredAt || !ticket.totals || ticket.totals.grandMinor <= 0) continue
    push(`ticket:${ticket.id}`, `أمر صيانة ${ticket.ticketNumber}`, ticket.deliveredAt, ticket.totals.grandMinor - positive(ticket.totals.paidMinor) - creditRefunds(ticket.refunds))
  }

  for (const op of input.walletOps ?? []) {
    if (op.customerId !== input.customerId || op.status === 'returned' || op.chargeMinor <= 0) continue
    push(`wallet:${op.id}`, `خدمة محفظة ${op.opNumber}`, op.date, op.chargeMinor - positive(op.paidMinor))
  }

  for (const car of input.cars ?? []) {
    if (car.buyerCustomerId !== input.customerId || car.salePayment === 'cash' || !car.soldAt) continue
    const total = positive(car.saleTotalMinor)
    if (total <= 0) continue
    push(`carsale:${car.id}`, `بيع سيارة ${car.make} ${car.model} (${car.plateOrVin})`, car.soldAt, total - Math.min(total, positive(car.salePaidMinor)))
  }

  for (const sale of input.propertySales ?? []) {
    if (sale.buyerCustomerId !== input.customerId) continue
    push(`propsale:${sale.id}`, `بيع عقاري ${sale.saleNumber}`, sale.date, positive(sale.dueMinor))
  }

  return rows
}

export interface SupplierSpecializedInput {
  supplierId: number
  settledOf: (docKey: string) => Minor
  carPurchaseInvoices?: readonly { id: number; invoiceNumber: string; date: string; supplierId: number | null; dueMinor: Minor; carIds: readonly number[] }[]
  carPrepCosts?: readonly { id: number; carId: number; date: string; description: string; supplierId: number | null; dueMinor: Minor }[]
  projectCosts?: readonly { id: number; date: string; description: string; supplierId?: number | null; dueMinor?: number }[]
  carLabel?: (carId: number) => string
}

/** مستندات المورد المتخصصة المفتوحة (بلا فواتير الشراء وشراء السيارة المفردة — لهما مساراهما) */
export function openSupplierSpecializedDocuments(input: SupplierSpecializedInput): OpenPartyDocument[] {
  const rows: OpenPartyDocument[] = []
  const push = (docKey: string, docLabel: string, date: string, dueMinor: Minor) => {
    if (dueMinor <= 0) return
    rows.push({ docKey, docLabel, date: date.slice(0, 10), dueMinor, settledMinor: input.settledOf(docKey) })
  }

  for (const invoice of input.carPurchaseInvoices ?? []) {
    if (invoice.supplierId !== input.supplierId) continue
    push(`carinv:${invoice.id}`, `فاتورة شراء سيارات ${invoice.invoiceNumber} (${invoice.carIds.length} سيارة)`, invoice.date, positive(invoice.dueMinor))
  }

  for (const cost of input.carPrepCosts ?? []) {
    if (cost.supplierId !== input.supplierId) continue
    const carLabel = input.carLabel?.(cost.carId) ?? `سيارة #${cost.carId}`
    push(`carprep:${cost.id}`, `تجهيز ${carLabel} — ${cost.description}`, cost.date, positive(cost.dueMinor))
  }

  for (const cost of input.projectCosts ?? []) {
    if (cost.supplierId !== input.supplierId) continue
    push(`projcost:${cost.id}`, `تكلفة مشروع — ${cost.description}`, cost.date, positive(cost.dueMinor))
  }

  return rows
}

/** وسم نوع المستند بالعربية لعرضه في شاشة السندات (من مفتاحه) */
export function documentKindLabel(docKey: string): string {
  const prefix = docKey.split(':')[0]
  const labels: Record<string, string> = {
    sale: 'فاتورة بيع',
    purchase: 'فاتورة شراء',
    extract: 'مستخلص مقاولات',
    lab: 'معمل تحاليل',
    visit: 'عيادة',
    rental: 'تأجير',
    trip: 'نقل ورحلات',
    ticket: 'صيانة',
    wallet: 'محافظ إلكترونية',
    carsale: 'معرض سيارات',
    propsale: 'وحدات عقارية',
    car: 'شراء سيارة',
    carinv: 'فاتورة سيارات',
    carprep: 'تجهيز سيارة',
    projcost: 'تكلفة مشروع',
  }
  return labels[prefix] ?? 'مستند'
}
