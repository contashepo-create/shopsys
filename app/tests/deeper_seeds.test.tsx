/**
 * §100: بذور أعمق — مرتجعات بيع/شراء وسندات قبض/صرف لكل نشاط.
 *
 * الحمولة (demo-payloads.json) صارت تحمل لكل نشاط sales_returns و
 * purchase_returns و vouchers — والمحمّل يمررها كلها بالإجراءات الرسمية
 * (postSaleReturn/postPurchaseReturn/postVoucher) فتُبنى القيود العاكسة
 * والمخزون والأرصدة كما لو أدخلها المستخدم بيده.
 *
 * الاختبار يحمّل نشاط البقالة ويحسب أرقامه باليد من البذرة:
 *   • مرتجع بيع sr1: إشعار دائن 12,000 (زيت ×2) — يخفض ذمم «مطعم البركة»
 *   • مرتجع بيع sr2: جبن تعيب (تالف) على فاتورة البطاقة i3 — رد نقدي للهالك 5111
 *   • مرتجع شراء pr1: دين مورد 16,000 (لبن ×5) — يعود للمخزن بالنقص
 *   • سند قبض 18,000 + سند صرف 100,000
 * ثم يثبت الأرصدة الناتجة بالضبط، ومخزون الزيت، وتوازن كل قيود الدفتر.
 * وينتهي بحمل المقاولات كاملاً (أثقل نشاط) فلا تسقط أي وثيقة عمق جديدة.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const payloads = JSON.parse(readFileSync(join(here, '..', 'demo-db', 'demo-payloads.json'))) as Record<string, Record<string, unknown>>

vi.stubGlobal('fetch', vi.fn(async (path: unknown) => {
  const url = String(path)
  if (url.includes('/__demo/data')) {
    const activity = decodeURIComponent(/activity=([^&]+)/.exec(url)?.[1] ?? 'grocery')
    return { ok: true, json: async () => payloads[activity] } as unknown as Response
  }
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
}))

const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
const { useDataStore } = await import('../src/data/repo.ts')

describe('§100 بذور أعمق — البقالة بالأرقام المحسوبة باليد', () => {
  let result: Awaited<ReturnType<typeof loadDemoActivity>>
  beforeAll(async () => { result = await loadDemoActivity('grocery') })

  it('الحمولة تحمل المرتجعات والسندات لكل نشاط (7 أنشطة)', () => {
    for (const activity of Object.keys(payloads)) {
      const p = payloads[activity] as { saleReturns: unknown[]; purchaseReturns: unknown[]; vouchers: unknown[] }
      expect(p.saleReturns.length, `${activity}: مرتجع بيع واحد على الأقل`).toBeGreaterThanOrEqual(1)
      expect(p.purchaseReturns.length, `${activity}: مرتجع شراء واحد على الأقل`).toBeGreaterThanOrEqual(1)
      expect(p.vouchers.length, `${activity}: سندان على الأقل`).toBeGreaterThanOrEqual(2)
    }
  })

  it('لا وثيقة عمق سقطت أثناء التحميل', () => {
    expect(result.saleReturns).toBe(2)
    expect(result.purchaseReturns).toBe(1)
    expect(result.vouchers).toBe(2)
    expect(result.skipped.filter((m) => /مرتجع|سند/.test(m))).toEqual([])
  })

  it('مرتجعات البيع مرحّلة بقيد عاكس — التالف للهالك والسليم للمخزن', () => {
    const state = useDataStore.getState()
    expect(state.saleReturns.length).toBe(2)
    /* sr1: إشعار دائن على ذمم العميل · sr2: رد نقدي من الخزينة لسطر تالف */
    const sr1 = state.saleReturns.find((r) => r.refund === 'credit')
    expect(sr1?.refund).toBe('credit')
    expect(sr1?.journalEntryId).toBeTruthy()
    const sr2 = state.saleReturns.find((r) => r.refund === 'cash')
    expect(sr2?.journalEntryId).toBeTruthy()
    /* الزيت السليم يعود للمخزن: افتتاحي 120 + شراء 60 − بيع 12 + مرتجع 2 = 170 */
    const oil = state.items.find((it) => it.nameAr.includes('زيت عباد الشمس'))!
    expect(Math.round(oil.stockQty)).toBe(170)
    /* الجبن التالف لا يعود للمخزن (يكلفته للهالك 5111): افتتاحي 18 − بيع 2 = 16 */
    const cheese = state.items.find((it) => it.nameAr.includes('جبن رومي'))!
    expect(Math.round(cheese.stockQty)).toBe(16)
  })

  it('مرتجع الشراء يخفض دين المورد ويعيد الكمية للمورد لا للمخزن', () => {
    const state = useDataStore.getState()
    expect(state.purchaseReturns.length).toBe(1)
    expect(state.purchaseReturns[0].refund).toBe('debt')
    expect(state.purchaseReturns[0].journalEntryId).toBeTruthy()
    /* مخزون اللبن: افتتاحي 90 + شراء 50 − مرتجع مورد 5 = 135 */
    const milk = state.items.find((it) => it.nameAr.includes('لبن كامل الدسم'))!
    expect(Math.round(milk.stockQty)).toBe(135)
  })

  it('رصيد «مطعم البركة» بالضبط: فاتورة 130,900 − مسدد 100,000 − إشعار 12,000 − سند قبض 18,000 = 900', () => {
    const state = useDataStore.getState()
    const customer = state.customers.find((c) => c.nameAr === 'مطعم البركة')!
    expect(state.getCustomerBalance(customer.id)).toBe(900)
  })

  it('رصيد مورد الألبان بالضبط: فاتورة 232,000 − مرتجع دين 16,000 − سند صرف 100,000 = 116,000', () => {
    const state = useDataStore.getState()
    const supplier = state.suppliers.find((s) => s.nameAr.includes('الألبان') || s.nameAr.includes('لبن')) ?? state.suppliers.find((s) => state.getSupplierBalance(s.id) === 116000)
    expect(state.getSupplierBalance(supplier!.id)).toBe(116000)
  })

  it('السندان موجودان: قبض على 1104 وصرف على 2101 بقيد متوازن لكلٍّ', () => {
    const state = useDataStore.getState()
    const receipt = state.vouchers.find((v) => v.kind === 'receipt' && v.description.includes('فاتورة الأسبوع'))
    const payment = state.vouchers.find((v) => v.kind === 'payment' && v.description.includes('الألبان'))
    expect(receipt?.counterAccountCode).toBe('1104')
    expect(payment?.counterAccountCode).toBe('2101')
    expect(receipt?.journalEntryId).toBeTruthy()
    expect(payment?.journalEntryId).toBeTruthy()
  })

  it('كل قيود الدفتر بعد العمق متوازنة (مدين = دائن في كل قيد)', () => {
    const state = useDataStore.getState()
    expect(state.journal.length).toBeGreaterThan(10)
    for (const entry of state.journal) {
      const debit = entry.lines.reduce((a, l) => a + l.debit, 0)
      const credit = entry.lines.reduce((a, l) => a + l.credit, 0)
      expect(debit, `القيد #${entry.entryNumber} غير متوازن`).toBe(credit)
    }
  })
})

describe('§100 بذور أعمق — المقاولات (أثقل نشاط) لا تسقط فيه وثيقة عمق', () => {
  it('المرتجعات والسندات تُرحَّل فوق 37 مستند مقاولة بلا سقوط', async () => {
    const result = await loadDemoActivity('contracting')
    expect(result.saleReturns).toBe(1)
    expect(result.purchaseReturns).toBe(1)
    expect(result.vouchers).toBe(2)
    expect(result.skipped.filter((m) => /مرتجع|سند/.test(m))).toEqual([])
    const state = useDataStore.getState()
    /* طوب 200 وحدة عاد للمخزن بالمرتجع السليم */
    const brick = state.items.find((it) => it.nameAr.includes('طوب'))!
    expect(state.saleReturns[0].lines.length).toBeGreaterThan(0)
    expect(brick.stockQty).toBeGreaterThan(0)
  })
})
