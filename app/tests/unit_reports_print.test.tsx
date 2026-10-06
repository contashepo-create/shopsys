/**
 * §99: تصدير PDF/Excel لكل تقارير الوحدات — المقاولات والمعدات والمطعم.
 *
 * كل جدول في مراكز تقارير الوحدات الثلاثة له زرّا تصدير: Excel/CSV (قائم) و
 * «طباعة / PDF» (جديد §99) يبني مطبوعة بالغلاف الموحد renderReportShell عبر
 * printHtml. الاختبار يحمّل بيانات كل نشاط الحقيقية من demo-payloads.json،
 * يفتح كل تقرير (بما فيها بطاقة مشروع/معدة بعد اختيارها من المنتقي)، يضغط
 * زر الطباعة، ويثبت أن المطبوع حمل: العنوان الصحيح + جدولاً + صف الإجمالي +
 * عناوين الأعمدة — ببيانات النشاط لا ببيانات مصطنعة.
 *
 * printHtml مُنكّر بالكامل (يسجل ولا يفتح إطارات) — الفحص على النص المطبوع.
 */
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const payloads = JSON.parse(readFileSync(join(here, '..', 'demo-db', 'demo-payloads.json'))) as Record<string, Record<string, unknown>>

/* منكّر printHtml: يسجل النص المطبوع بدل فتح إطار طباعة */
vi.mock('../src/ui/print/printReceipt.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/print/printReceipt.ts')>()
  return { ...actual, printHtml: vi.fn() }
})

/* محاكاة fetch: تخدم حمولة النشاط المطلوب من معامل الرابط */
vi.stubGlobal('fetch', vi.fn(async (path: unknown) => {
  const url = String(path)
  if (url.includes('/__demo/data')) {
    const activity = decodeURIComponent(/activity=([^&]+)/.exec(url)?.[1] ?? 'contracting')
    return { ok: true, json: async () => payloads[activity] } as unknown as Response
  }
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
}))

const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
const { printHtml } = await import('../src/ui/print/printReceipt.ts')
const printed = () => vi.mocked(printHtml).mock.calls.at(-1)?.[0] ?? ''

/** تنظيف DOM بعد كل اختبار — الاختبار الفاشل لا يلوث من بعده */
afterEach(() => cleanup())

/** يفتح منتقي الأطراف ويختار أول نتيجة حقيقية (الخيار صفر هو «اختر…» النقدي) */
const pickFirstParty = (label: string) => {
  const input = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(input, { target: { value: ' ' } })
  const option = [...document.querySelectorAll('[data-quick-option="true"]')].find((el) => Number((el as HTMLElement).dataset.value) > 0) as HTMLButtonElement | undefined
  expect(option, `لا نتائج حقيقية في منتقي «${label}»`).toBeTruthy()
  fireEvent.doubleClick(option!)
}

describe('§99 مطبوعات تقارير المقاولات (PDF)', () => {
  beforeAll(async () => { await loadDemoActivity('contracting') })

  it('لوحة المشاريع: زر الطباعة يبني مطبوعة الغلاف الموحد بجدول وإجماليات', async () => {
    const { ContractingReportsPage } = await import('../src/ui/pages/ContractingReportsPage.tsx')
    render(<ContractingReportsPage />)
    fireEvent.click(screen.getAllByText('لوحة المشاريع')[0])
    fireEvent.click(document.querySelector('[data-print="projects"]')!)
    const html = printed()
    expect(printHtml).toHaveBeenCalledTimes(1)
    expect(html).toContain('لوحة مشاريع المقاولات')
    expect(html).toContain('<table>')
    expect(html).toContain('العقد الفعلي')
    expect(html).toContain('class="total"')
    expect(html).toContain('الإجمالي')
  })

  it('بطاقة مشروع: تُختار من المنتقي وتُطبع بمؤشراتها ومصادر تكاليفها ومستخلصاتها', async () => {
    const { ContractingReportsPage } = await import('../src/ui/pages/ContractingReportsPage.tsx')
    render(<ContractingReportsPage />)
    fireEvent.click(screen.getAllByText('مشروع بعينه')[0])
    pickFirstParty('بحث المشروع')
    fireEvent.click(document.querySelector('[data-print="project-card"]')!)
    const html = printed()
    expect(html).toContain('بطاقة مشروع —')
    expect(html).toContain('مؤشرات البطاقة')
    expect(html).toContain('مصادر التكاليف')
    expect(html).toContain('إجمالي تكاليف المشروع')
    expect(html).toContain('المستخلص')
  })

  it('§102 بطاقة عميل بعينه: تُختار من القائمة وتُطبع بمؤشراتها ومشاريعها ومستخلصاتها', async () => {
    const { ContractingReportsPage } = await import('../src/ui/pages/ContractingReportsPage.tsx')
    render(<ContractingReportsPage />)
    fireEvent.click(screen.getAllByText('عميل بعينه')[0])
    const select = screen.getByTestId('client-select') as HTMLSelectElement
    const firstClient = [...select.options].find((o) => o.value)
    expect(firstClient, 'لا عملاء بمشاريع في بيانات المقاولات').toBeTruthy()
    fireEvent.change(select, { target: { value: firstClient!.value } })
    fireEvent.click(document.querySelector('[data-print="client-card"]')!)
    const html = printed()
    expect(html).toContain('بطاقة عميل —')
    expect(html).toContain('مؤشرات بطاقة العميل')
    expect(html).toContain('مشاريع العميل (')
    expect(html).toContain('المستحق الصافي')
    /* جدول المستخلصات عبر مشاريعه أو «لا مستخلصات» — أحدهما واجب */
    expect(/مستخلصات العميل \(/.test(html) || /لا مستخلصات/.test(html)).toBe(true)
  })

  it('ذمم العملاء: مطبوعة متابعة التحصيل بإجمالي مصفوف', async () => {
    const { ContractingReportsPage } = await import('../src/ui/pages/ContractingReportsPage.tsx')
    render(<ContractingReportsPage />)
    fireEvent.click(screen.getAllByText('ذمم العملاء')[0])
    fireEvent.click(document.querySelector('[data-print="dues"]')!)
    const html = printed()
    expect(html).toContain('ذمم عملاء المقاولات')
    expect(html).toContain('الأعمال المستخلصة')
    expect(html).toContain('مستخلصات آجلة')
  })
})

describe('§99 مطبوعات تقارير المعدات (PDF)', () => {
  beforeAll(async () => { await loadDemoActivity('equipment_rental') })

  it('لوحة الأسطول: مطبوعة ربحية كل معدة بإجماليات الأسطول', async () => {
    const { EquipmentReportsPage } = await import('../src/ui/pages/EquipmentReportsPage.tsx')
    render(<EquipmentReportsPage />)
    fireEvent.click(screen.getAllByText('لوحة الأسطول')[0])
    fireEvent.click(document.querySelector('[data-print="fleet"]')!)
    const html = printed()
    expect(html).toContain('لوحة أسطول المعدات')
    expect(html).toContain('ربح الساعة')
    expect(html).toContain('تأمينات محتجزة')
    expect(html).toContain('class="total"')
  })

  it('بطاقة معدة: تُختار من المنتقي وتطبع بعقودها ومصاريفها', async () => {
    const { EquipmentReportsPage } = await import('../src/ui/pages/EquipmentReportsPage.tsx')
    render(<EquipmentReportsPage />)
    fireEvent.click(screen.getAllByText('معدة بعينها')[0])
    pickFirstParty('بحث المعدة')
    fireEvent.click(document.querySelector('[data-print="equipment-card"]')!)
    const html = printed()
    expect(html).toContain('بطاقة معدة —')
    expect(html).toContain('مؤشرات البطاقة')
    expect(html).toContain('العقد')
  })

  it('ذمم عملاء التأجير: مطبوعة المتابعة', async () => {
    const { EquipmentReportsPage } = await import('../src/ui/pages/EquipmentReportsPage.tsx')
    render(<EquipmentReportsPage />)
    fireEvent.click(screen.getAllByText('ذمم عملاء التأجير')[0])
    fireEvent.click(document.querySelector('[data-print="dues"]')!)
    const html = printed()
    expect(html).toContain('ذمم عملاء التأجير')
    expect(html).toContain('إيراد الإيجار')
  })
})

describe('§99 مطبوعات تقارير المطعم (PDF)', () => {
  beforeAll(async () => { await loadDemoActivity('restaurant') })

  it('الأطباق والهوامش: مطبوعة Food Cost لفترة التقرير', async () => {
    const { RestaurantReportsPage } = await import('../src/ui/pages/RestaurantReportsPage.tsx')
    render(<RestaurantReportsPage />)
    fireEvent.click(screen.getAllByText('الأطباق والهوامش')[0])
    fireEvent.click(document.querySelector('[data-print="dishes"]')!)
    const html = printed()
    expect(html).toContain('أطباق المطعم وهوامشها')
    expect(html).toContain('فترة:')
    expect(html).toContain('تكلفة المواد')
    expect(html).toContain('الهامش ٪')
  })

  it('أوامر المطعم: ملخص الأنواع الثلاثة + جدول الأوامر', async () => {
    const { RestaurantReportsPage } = await import('../src/ui/pages/RestaurantReportsPage.tsx')
    render(<RestaurantReportsPage />)
    fireEvent.click(screen.getAllByText('أوامر المطعم')[0])
    fireEvent.click(document.querySelector('[data-print="orders"]')!)
    const html = printed()
    expect(html).toContain('أوامر المطعم')
    expect(html).toContain('قيمة المفتوح')
    expect(html).toContain('الطاولة / التوصيل')
  })

  it('الإنتاج المسبق: مؤشرات التكلفة + التشغيلات', async () => {
    const { RestaurantReportsPage } = await import('../src/ui/pages/RestaurantReportsPage.tsx')
    render(<RestaurantReportsPage />)
    fireEvent.click(screen.getAllByText('الإنتاج المسبق')[0])
    fireEvent.click(document.querySelector('[data-print="production"]')!)
    const html = printed()
    expect(html).toContain('أوامر الإنتاج المسبق')
    expect(html).toContain('تكلفة الوحدة')
    expect(html).toContain('التشغيلات وكمياتها وتكلفتها')
  })
})
