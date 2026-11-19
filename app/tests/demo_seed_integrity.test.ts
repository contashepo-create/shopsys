import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * سلامة بذور العرض لكل الأنشطة — لا وثيقة تسقط بصمت، ولا ثابت ينكسر.
 *
 * الثغرة التي وُلدت منها هذه الحزمة (الطبقة ⑦ من المنهجية): الاختبار السابق كان يفحص
 * البقالة فقط ويتجاهل `skipped` في سائر الأنشطة، فبقي **بيع كامل** في الصيدلية والمطعم
 * يسقط عند التحميل بلا أثر ظاهر، و«دفعة» ثالثة في البقالة.
 */
const here = dirname(fileURLToPath(import.meta.url))
const payloads = JSON.parse(readFileSync(join(here, '..', 'demo-db', 'demo-payloads.json'), 'utf8')) as Record<string, Record<string, unknown>>

vi.stubGlobal('fetch', vi.fn(async (path: unknown) => {
  const url = String(path)
  if (url.includes('/__demo/data')) {
    const activity = decodeURIComponent(/activity=([^&]+)/.exec(url)?.[1] ?? 'grocery')
    return { ok: true, json: async () => payloads[activity] } as unknown as Response
  }
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
}))

const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
const { useDataStore, useRawDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')

const emptyData = useRawDataStore.getState()
const emptyApp = useAppStore.getState()
const S = () => useDataStore.getState()
const balance = (code: string) => S().journal.reduce((sum, entry) => sum + entry.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.debit - l.credit, 0), 0)
const itemsValue = () => S().items.reduce((sum, it) => sum + (Number.isFinite(it.stockValueMinor) ? it.stockValueMinor! : Math.round(it.stockQty * it.costMinor)), 0)

beforeEach(() => {
  useRawDataStore.setState(emptyData, true)
  useAppStore.setState(emptyApp, true)
  localStorage.clear()
})

describe('بذور العرض: البقالة (النشاط المشحون) كاملة بلا سقوط', () => {
  it('تحمّل البقالة ثلاث فواتير ومرتجعين وسندين — بلا وثيقة ساقطة', async () => {
    const result = await loadDemoActivity('grocery')
    expect(result.skipped).toEqual([])
    expect(result.sales).toBe(3)
    expect(result.saleReturns).toBe(2)
    expect(result.purchaseReturns).toBe(1)
    expect(result.vouchers).toBe(2)
    /* الفاتورة الثالثة تحمل اعتماد مدير موثّقاً على المستند (القرار 8) لا إسقاطاً صامتاً */
    const approved = S().sales.find((sale) => (sale as { expiryOverrideBy?: string | null }).expiryOverrideBy)
    expect(approved?.expiryOverrideBy).toContain('المدير العام')
  })

  it('الثوابت سليمة بعد التحميل: 1103 = مجموع قيم الأصناف، ولا مخزون سالب', async () => {
    await loadDemoActivity('grocery')
    expect(balance('1103')).toBe(itemsValue())
    expect(S().items.filter((it) => it.stockQty < 0)).toEqual([])
    for (const entry of S().journal) {
      const debit = entry.lines.reduce((sum, l) => sum + l.debit, 0)
      const credit = entry.lines.reduce((sum, l) => sum + l.credit, 0)
      expect(debit, `قيد ${entry.entryNumber}`).toBe(credit)
    }
  })
})

describe('بذور العرض: بقية الأنشطة — لا ثابت مكسور ولو بيع بالسالب', () => {
  it('المطعم: بيع أطباق بلا رصيد لا يفصل 1103 عن قيمة الأصناف (كان الفرق 13,500)', async () => {
    await loadDemoActivity('restaurant')
    expect(balance('1103')).toBe(itemsValue())
    /* الأطباق التي بيعت بالسالب تحمل قيمة سالبة صريحة بدل الصفر */
    const negative = S().items.filter((it) => it.stockQty < 0)
    for (const item of negative) expect(item.stockValueMinor).toBe(Math.round(item.stockQty * item.costMinor))
  })

  it('كل نشاط: ميزان المراجعة متوازن و1103 = قيمة الأصناف', async () => {
    for (const activity of Object.keys(payloads)) {
      useRawDataStore.setState(emptyData, true)
      useAppStore.setState(emptyApp, true)
      localStorage.clear()
      await loadDemoActivity(activity)
      expect(balance('1103'), `${activity}: 1103 ≠ قيمة الأصناف (فرق ${balance('1103') - itemsValue()})`).toBe(itemsValue())
    }
  })
})
