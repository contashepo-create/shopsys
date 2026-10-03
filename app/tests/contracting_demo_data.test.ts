/**
 * §96: بيانات تجريبية في كل أقسام المقاولات (طلب المالك).
 *
 * يحمّل نشاط «المقاولات» من قاعدة البيانات التجريبية الحقيقية (demo-db/demo.sqlite)
 * عبر الجسر الرسمي loadDemoActivity — بمحاكاة fetch فقط — ثم يثبت أن كل قسم من
 * أقسام المقاولات صار فيه بيانات حقيقية بقيود متوازنة:
 * المشروعات · العروض والمناقصات · جداول الكميات · المستخلصات · أوامر التغيير ·
 * مقاولو الباطن وشهاداتهم · خطابات الضمان · عمال اليومية · أذون صرف المواد ·
 * فواتير البيع · التحصيلات والسندات الموسومة بمشروع · الموازنة · المهام ·
 * القيمة المكتسبة · الموافقات التسلسلية.
 */
// @vitest-environment node — نقرأ node:sqlite مباشرة (قاعدة التطوير الحقيقية)
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

/* متصفح مصغّر كافٍ لترطيب متاجر zustand المستديمة (localStorage) داخل بيئة node */
vi.hoisted(() => {
  const store = new Map<string, string>()
  const shim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: shim, configurable: true, writable: true })
})

/* قراءة نشاط المقاولات من القاعدة الحقيقية — نفس ما تقدمه إضافة Vite في التطوير */
interface DemoRow { [key: string]: string | number }
const db = new DatabaseSync(fileURLToPath(new URL('../demo-db/demo.sqlite', import.meta.url)))
const readAll = (table: string) => db.prepare(`SELECT * FROM ${table} WHERE activity = ?`).all('contracting') as DemoRow[]
const payload = {
  activity: db.prepare("SELECT * FROM activities WHERE id = 'contracting'").get() as DemoRow,
  branches: readAll('branches'), warehouses: readAll('warehouses'), treasuries: readAll('treasuries'),
  terminals: readAll('payment_terminals'), categories: readAll('categories'), items: readAll('items'),
  customers: readAll('customers'), suppliers: readAll('suppliers'), costCenters: readAll('cost_centers'),
  employees: readAll('employees'), attendance: [], leaves: [], payrollMonths: readAll('payroll_months'),
  quotations: readAll('quotations').map((q) => ({ ...q, lines: db.prepare('SELECT * FROM quotation_lines WHERE activity = ? AND quotation_ref = ?').all('contracting', q.ref) as DemoRow[] })),
  purchaseOrders: [], wastage: [],
  equipment: readAll('equipment'), rentalContracts: [], equipmentCosts: [],
  subContracts: readAll('sub_contracts'), projectExtracts: readAll('project_extracts'),
  contractingDocs: db.prepare('SELECT * FROM contracting_docs WHERE activity = ? ORDER BY sort_order').all('contracting') as DemoRow[],
  sales: readAll('sales').map((s) => ({ ...s, lines: db.prepare('SELECT * FROM sale_lines WHERE activity = ? AND sale_ref = ?').all('contracting', s.ref) as DemoRow[] })),
  purchases: readAll('purchases').map((p) => ({ ...p, lines: db.prepare('SELECT * FROM purchase_lines WHERE activity = ? AND purchase_ref = ?').all('contracting', p.ref) as DemoRow[] })),
}
db.close()

/* محاكاة fetch: كل نداء يعيد حِمل نشاط المقاولات كما تفعل /__demo/data */
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as unknown as Response))

let result: Awaited<ReturnType<typeof loadDemoActivity>>
let data: ReturnType<typeof useDataStore.getState>

beforeAll(async () => {
  const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
  const { useDataStore } = await import('../src/data/repo.ts')
  result = await loadDemoActivity('contracting')
  data = useDataStore.getState()
})

describe('قاعدة البذرة: مستندات المقاولات الشاملة', () => {
  it('تحمل القاعدة كل أنواع المستندات الستة عشر', () => {
    const kinds = new Set(payload.contractingDocs.map((row) => String(row.kind)))
    for (const kind of ['project', 'boq_item', 'budget', 'change_order', 'bond', 'daily_worker', 'material_issue', 'project_cost', 'client_advance', 'project_receipt', 'project_payment', 'client_collection', 'project_purchase', 'extract', 'project_task', 'approval_flow', 'approval_request'])
      expect(kinds, `نوع ${kind} مفقود من contracting_docs`).toContain(kind)
    expect(payload.contractingDocs.length).toBeGreaterThanOrEqual(30)
  })
})

describe('تحميل نشاط المقاولات: كل قسم فيه بيانات', () => {
  it('لا أخطاء تحميل (بعداد المعلومات الإيجابية فقط)', () => {
    const failures = result.skipped.filter((note) => !note.includes('✓'))
    expect(failures, failures.join(' | ')).toEqual([])
  })

  it('المشروعات: محوَّل من عرض فائز + مشروع يدوي بجدول كمياته', () => {
    expect(data.projects).toHaveLength(2)
    const villa = data.projects.find((p) => p.nameAr.includes('الشاذلي'))!
    expect(villa.contractNumber).toBe('عقد أشغال 46 لسنة 2026')
    expect(villa.location).toContain('منية النصر')
    expect(data.boqItems.filter((b) => b.projectId === villa.id)).toHaveLength(3)
    expect(result.contracting.demoProjects).toBe(1)
    expect(result.contracting.demoBoqItems).toBe(3)
  })

  it('العروض والمناقصات: عرض فائز محوَّل + مناقصة قيد الترسية', () => {
    expect(data.quotations.length).toBeGreaterThanOrEqual(2)
    expect(data.quotations.some((q) => q.kind === 'tender' && q.status === 'submitted' && (q.bidBondMinor ?? 0) > 0)).toBe(true)
  })

  it('المستخلصات: اثنان آجلان للمشروع الرئيسي + نقدي للفيلا — وبسقف العقد', () => {
    expect(data.projectExtracts).toHaveLength(3)
    const main = data.projects[0]
    const mainExtracts = data.projectExtracts.filter((e) => e.projectId === main.id)
    expect(mainExtracts).toHaveLength(2)
    const claimed = mainExtracts.reduce((sum, e) => sum + e.totals.grossMinor, 0)
    expect(claimed).toBeLessThanOrEqual(main.contractValueMinor + 18_000_000 /* أمر التغيير المعتمد */)
    expect(data.projectExtracts.some((e) => e.payment === 'cash')).toBe(true)
  })

  it('أوامر التغيير: معتمد يوسّع قيمة العقد + مسودة', () => {
    expect(result.contracting.changeOrders).toBe(2)
    expect(data.changeOrders.filter((o) => o.status === 'approved')).toHaveLength(1)
    expect(data.changeOrders.filter((o) => o.status === 'draft')).toHaveLength(1)
  })

  it('مقاولو الباطن: عقدان بشهادات وقيد 5110 وخصم محتجز', () => {
    expect(result.subContracts).toBe(2)
    expect(data.subCertificates.length).toBeGreaterThanOrEqual(2)
    expect(data.projectCosts.some((c) => c.source === 'sub_certificate')).toBe(true)
  })

  it('خطابات الضمان: أربعة — مُرد ونهائي ودفعة مقدمة وصيانة عامة', () => {
    expect(data.bonds).toHaveLength(4)
    expect(data.bonds.filter((b) => b.status === 'released')).toHaveLength(1)
    expect(data.bonds.filter((b) => b.status === 'active')).toHaveLength(3)
    expect(data.bonds.some((b) => b.projectId === null)).toBe(true) /* عام بلا مشروع */
  })

  it('عمال اليومية: ثلاثة عمال — مسدَّد ومستحق على مشروعين وتشغيل عام', () => {
    expect(data.dailyWorkers).toHaveLength(3)
    expect(data.dailyWorkRecords.length).toBeGreaterThanOrEqual(9)
    expect(data.dailyWorkRecords.some((r) => r.settled)).toBe(true)
    expect(data.dailyWorkRecords.some((r) => r.projectId === null)).toBe(true)
    expect(data.projectCosts.some((c) => c.source === 'daily_work')).toBe(true)
  })

  it('أذون صرف المواد: للمشروعين وبلا مخزون سالب وتدخل 5110 بمصدر material_issue', () => {
    expect(data.materialRequisitions).toHaveLength(2)
    expect(data.projectCosts.filter((c) => c.source === 'material_issue').length).toBe(2)
    for (const item of data.items) expect(item.stockQty, `صنف ${item.nameAr} سالب`).toBeGreaterThanOrEqual(0)
  })

  it('فواتير البيع: فواتير نشاط + شراء مربوط بالمشروع يدخل التكاليف بمصدر purchase', () => {
    expect(data.sales.length).toBeGreaterThanOrEqual(2)
    expect(result.contracting.linkedPurchases).toBe(1)
    expect(data.projectCosts.some((c) => c.source === 'purchase')).toBe(true)
  })

  it('التكاليف اليدوية: مصدر manual في بطاقة تكاليف المشروع', () => {
    expect(result.contracting.manualCosts).toBe(1)
    expect(data.projectCosts.some((c) => c.source === 'manual' || c.source == null)).toBe(true)
  })

  it('التحصيلات وسندات المشاريع: دفعة مقدمة + سند قبض موسوم + سند صرف + تحصيل FIFO', () => {
    expect(data.clientAdvances).toHaveLength(1)
    expect(result.contracting.projectVouchers).toBe(2)
    const tagged = data.vouchers.filter((v) => v.projectId != null)
    expect(tagged.length).toBeGreaterThanOrEqual(2)
    expect(tagged.some((v) => v.kind === 'receipt')).toBe(true)
    expect(tagged.some((v) => v.kind === 'payment')).toBe(true)
    expect(data.clientSettlements.length).toBeGreaterThanOrEqual(1)
  })

  it('الموازنة والقيمة المكتسبة: بنود بتكاليف تقديرية وتقدم فعلي للمشروعين', () => {
    for (const project of data.projects) {
      const budget = data.getProjectBudgetVariance(project.id)
      expect(budget.rows.length).toBeGreaterThanOrEqual(3)
      expect(budget.totalBudgetMinor).toBeGreaterThan(0)
      expect(budget.totalActualMinor).toBeGreaterThan(0)
      const evm = data.getProjectEvm(project.id)
      expect(evm.lines.length).toBeGreaterThanOrEqual(3)
      expect(evm.actualCostMinor).toBeGreaterThan(0)
      expect(evm.budgetAtCompletionMinor).toBeGreaterThan(0)
    }
  })

  it('الجدول الزمني: ثماني مهام بحالات ثلاث للمشروعين', () => {
    expect(data.projectTasks).toHaveLength(8)
    const statuses = new Set(data.projectTasks.map((t) => t.status))
    expect(statuses).toContain('done')
    expect(statuses).toContain('in_progress')
    expect(statuses).toContain('pending')
    expect(data.projectTasks.some((t) => t.boqItemId !== null)).toBe(true)
  })

  it('الموافقات التسلسلية: مساران نشطان وثالث معطل + طلبان (جديد ومتقدم مستوى)', () => {
    expect(result.contracting.approvalFlows).toBe(3)
    expect(data.approvalFlows.filter((f) => f.active)).toHaveLength(2)
    expect(data.approvalRequests).toHaveLength(2)
    const advanced = data.approvalRequests.find((r) => r.decisions.length > 0)!
    expect(advanced.status).toBe('pending')
    expect(advanced.currentStep).toBe(1)
  })

  it('كل القيود متوازنة وذاكرة العملاء نظيفة: القبض الموسوم ينزل رصيد العميل', () => {
    for (const entry of data.journal) {
      const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0)
      const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0)
      expect(debit, `قيد #${entry.entryNumber} غير متوازن`).toBe(credit)
    }
    const c1 = data.customers.find((c) => c.nameAr.includes('جامعة'))!
    const openInvoices = data.getOpenClientInvoices(c1.id)
    expect(openInvoices.length).toBeGreaterThanOrEqual(1) /* مستخلصات آجلة بعد التحصيلات */
  })
})
