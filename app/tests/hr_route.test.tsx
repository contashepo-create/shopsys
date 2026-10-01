import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { HrPage } from '../src/ui/pages/HrPage.tsx'

/**
 * بوابة انحدار لعطل المالك «تاب الحضور والانصراف هو الوحيد الذي يعمل»:
 * المسارات الصريحة المكررة (/hr/leaves …) كانت تُطابَق قبل /hr/:tab فلا يصل
 * :tab إلى useParams — تبقى الصفحة على «الحضور» مهما نقر المستخدم من التابات.
 * الإصلاح: مسار واحد ديناميكي، والاختبار يثبت أن كل تاب يفتح محتواه فعلاً.
 */

function HeaderProbe() {
  const { pathname } = useLocation()
  return <b data-testid="path">{pathname}</b>
}

const TAB_IDS = ['fingerprint', 'leaves', 'shifts', 'reports'] as const

describe('تبويبات شؤون الموظفين', () => {
  beforeEach(() => { cleanup(); window.location.hash = '' })

  it('مصدر الراوتر لا يحوي مسارات صريحة تسبق /hr/:tab', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('<Route path="/hr/:tab" element={<HrPage />} />')
    for (const id of TAB_IDS) expect(app).not.toContain(`<Route path="/hr/${id}"`)
  })

  it('النقر على كل تاب يبدّل المحتوى فعلاً (بنية المسار الوحيد)', async () => {
    window.location.hash = '#/hr/attendance'
    render(
      <HashRouter>
        <HeaderProbe />
        <Routes>
          <Route path="/hr" element={<HrPage />} />
          <Route path="/hr/:tab" element={<HrPage />} />
        </Routes>
      </HashRouter>,
    )
    await waitFor(() => expect(document.querySelector('[data-hr-tabs]')).toBeTruthy())
    expect(document.querySelector('[data-hr-tabs] button[aria-selected="true"]')?.textContent).toContain('الحضور والانصراف')
    for (const id of TAB_IDS) {
      await act(async () => {
        const btn = [...document.querySelectorAll('[data-hr-tabs] button')].find((b) => b.textContent.length > 0 && b.getAttribute('role') === 'tab')
        void btn
        const target = [...document.querySelectorAll('[data-hr-tabs] button')].find((b) => {
          const map: Record<string, string> = { fingerprint: 'استيراد البصمة', leaves: 'الإجازات', shifts: 'الورديات', reports: 'تقارير' }
          return (b.textContent ?? '').includes(map[id])
        })
        target?.click()
      })
      await waitFor(() => expect(screen.getByTestId('path').textContent).toBe(`/hr/${id}`))
      expect(document.querySelector('[data-hr-tabs] button[aria-selected="true"]')?.textContent, `التاب ${id}`).toBeTruthy()
      expect(screen.getByTestId('path').textContent).toBe(`/hr/${id}`)
    }
  })

  it('التحميل المباشر على تاب غير الافتراضي يفتح محتواه (لا ارتداد للحضور)', async () => {
    window.location.hash = '#/hr/shifts'
    render(
      <HashRouter>
        <Routes>
          <Route path="/hr" element={<HrPage />} />
          <Route path="/hr/:tab" element={<HrPage />} />
        </Routes>
      </HashRouter>,
    )
    await waitFor(() => expect(document.querySelector('[data-hr-tabs] button[aria-selected="true"]')?.textContent).toContain('الورديات'))
  })
})
