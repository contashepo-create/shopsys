/**
 * سلّم طبقات حوار الإغلاق (إصلاح بلاغ المالك 2026-10-26: «حوار الإغلاق لا
 * يظهر فوق كل شيء»): المتغيّر --z-window-ask يجب أن يعلو النوافذ (700..120)
 * والحوارات (1000) والمنتقيات (2000) واعتماد المشرف (3000) ويظل تحت
 * التنبيهات (4000) — يُقرأ من الورقة نفسها فلا يเบาگ الثابت مع أي تغيير.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '../src/index.css'), 'utf8')

function zOf(pattern: RegExp): number {
  const match = css.match(pattern)
  expect(match, `لم يُعثر على ${String(pattern)} في index.css`).toBeTruthy()
  return Number(match![1])
}

describe('طبقات حوار الإغلاق', () => {
  it('window-ask = 3500 أعلى كل الطبقات النشطة وتحت التنبيهات فقط', () => {
    const ask = zOf(/--z-window-ask:\s*(\d+)/)
    const inWindowOverlay = zOf(/--z-in-window-overlay:\s*(\d+)/)
    const modal = zOf(/\.layer-modal\s*\{\s*z-index:\s*(\d+)/)
    const picker = zOf(/\.layer-picker\s*\{\s*z-index:\s*(\d+)/)
    const approval = zOf(/\.layer-approval\s*\{\s*z-index:\s*(\d+)/)
    const toast = zOf(/\.layer-toast\s*\{\s*z-index:\s*(\d+)/)
    expect(ask).toBe(3500)
    expect(ask).toBeGreaterThan(inWindowOverlay) // رؤوس الجداول اللاصقة وما شابه
    expect(ask).toBeGreaterThan(modal)
    expect(ask).toBeGreaterThan(picker)
    expect(ask).toBeGreaterThan(approval)
    expect(ask).toBeLessThan(toast)
  })

  it('عنصر الغطاء يستخدم المتغيّر نفسه بلا قيمة مكررة منفصلة', () => {
    expect(css).toMatch(/\.layer-window-ask\s*\{\s*z-index:\s*var\(--z-window-ask\)/)
    expect(css).toMatch(/\.app-window-ask\s*\{[^}]*z-index:\s*var\(--z-window-ask\)/)
  })
})
