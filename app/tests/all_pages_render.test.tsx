/**
 * §98: مسح «كل صفحات البرنامج ترسم» — جولة مراجعة البرنامج بالكامل.
 *
 * يحمّل نشاط المقاولات التجريبي كاملاً (من demo-payloads.json الجاهزة لjsdom)
 * عبر الجسر الرسمي، ثم يصيّر **كل مسار حرفي في الراوتر (103 مساراً)** داخل
 * التطبيق الفعلي <App/> — مساراً مساراً — ويثبت:
 *   • لا صفحة ترمي أثناء التصيير (عطل أبيض للمستخدم)
 *   • لا صفحة تسقط في شاشة الخطأ (AppErrorBoundary)
 *   • كل صفحة تنتج محتوى فعلياً (DOM غير فارغ)
 *
 * المسارات تُستخرج من App.tsx وقت التشغيل فلا تشيخ هذه القائمة أبداً: أي مسار
 * جديد يدخل المسح تلقائياً.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(join(here, relative), 'utf8')

/* حمولة نشاط المقاولات الجاهزة (نفس ما تقدمه /__demo/data في التطوير) */
const payloads = JSON.parse(read('../demo-db/demo-payloads.json')) as Record<string, unknown>
const payload = payloads.contracting

/* محاكاة fetch: التحميل يعيد الحمولة، وما بعده «لا اتصال» كصفحات حقيقية بلا خادم */
const fetchMock = vi.fn(async (path: unknown) => {
  if (String(path).includes('/__demo/data')) return { ok: true, json: async () => payload } as unknown as Response
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
})
vi.stubGlobal('fetch', fetchMock)

/* المسارات الحرفية من الراوتر نفسه — تستخرج وقت التشغيل فلا تشيخ */
const appSource = read('../src/App.tsx')
const routes = [...appSource.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((path) => !path.includes(':') && !path.includes('*'))
if (routes.length < 90) throw new Error(`المسارات المستخرجة قليلة على غير المعتاد (${routes.length}) — راجع مصدر App.tsx`)

/* كشف شاشة الخطأ بعنوانها الحرفي الكامل — العبارات القصيرة ترد بنصوص عادية
   (مثال: «لو حدث خطأ في الاختيار…» بالإعدادات العامة) فتطابق كذباً */
const BOUNDARY_MARKER = 'حدث خطأ غير متوقع'

/* شيمة بيئة jsdom: لا تطبق scrollIntoView (صفحة الدعم تمرر للمحادثة) — متصفح حقيقي يدعمها دائماً */
beforeAll(() => { Element.prototype.scrollIntoView ||= () => {} })

let App: React.ComponentType
beforeAll(async () => {
  const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
  await loadDemoActivity('contracting')
  ;({ default: App } = await import('../src/App.tsx'))
}, 60_000) // استيراد الشجرة الكاملة للتطبيق بارد قد يتجاوز 10 ثوانٍ الافتراضية على الأجهزة البطيئة

/** يصيّر مساراً واحداً ويعيد نتيجة الفحص (لا يرمي — كي تُجمع كل الأعطال بالتقرير) */
async function renderRoute(path: string): Promise<string> {
  try {
    window.location.hash = `#${path}`
    const view = render(<App />)
    const text = view.container.textContent ?? ''
    if (text.includes(BOUNDARY_MARKER)) return 'سقطت في شاشة الخطأ (AppErrorBoundary)'
    if (text.trim().length < 10) return 'صفحة بيضاء بلا محتوى'
    return ''
  } catch (error) {
    return `رمى أثناء التصيير: ${(error as Error).message.slice(0, 160)}`
  } finally {
    cleanup()
  }
}

describe('مسح كل صفحات البرنامج ببيانات حقيقية (103 مساراً)', () => {
  it('نشاط المقاولات حُمِّل فعلاً قبل المسح', async () => {
    const { useDataStore } = await import('../src/data/repo.ts')
    const data = useDataStore.getState()
    expect(data.projects.length).toBe(2)
    expect(data.projectExtracts.length).toBe(3)
    expect(data.bonds.length).toBe(4)
  })

  /* أرباع المسار: عزل الأعطال وتشغيل متوازٍ، والتقرير النهائي يجمع الكل */
  const chunks = [0, 1, 2, 3].map((i) => routes.filter((_, index) => index % 4 === i))
  for (const [index, chunk] of chunks.entries()) {
    it(`الربع ${index + 1}/٤ — ${chunk.length} مساراً`, async () => {
      const failures: string[] = []
      for (const path of chunk) {
        const problem = await renderRoute(path)
        if (problem) failures.push(`${path}: ${problem}`)
      }
      expect(failures.join('\n')).toBe('')
    }, 120_000)
  }

  it(`كل المسارات مغطاة فعلاً (${routes.length})`, () => {
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(routes.length)
    expect(routes).toContain('/')
    expect(routes).toContain('/contracting/reports')
  })
})
