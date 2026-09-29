/**
 * لوحة الأوامر (Ctrl+K) وخريطة الاختصارات (Ctrl+/)
 * — الموجة ① من خطة UX، ولا تمسّ تقسيم الفاتورة.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandPalette } from '../src/ui/components/CommandPalette.tsx'
import { SHORTCUT_MAP } from '../src/ui/shortcutMap.ts'
import { useDataStore } from '../src/data/repo.ts'

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
const view = () => render(<MemoryRouter><CommandPalette /></MemoryRouter>)

describe('لوحة الأوامر', () => {
  beforeEach(() => {
    cleanup()
    useDataStore.setState({ customers: [], suppliers: [], items: [] } as never)
  })

  it('مغلقة حتى يُضغط Ctrl+K', () => {
    view()
    expect(document.querySelector('[data-command-palette]')).toBeNull()
    openPalette()
    expect(document.querySelector('[data-command-palette]')).not.toBeNull()
  })

  it('تعرض أوامر سريعة وتبحث فيها بالعربية', () => {
    view()
    openPalette()
    const input = screen.getByLabelText('بحث لوحة الأوامر') as HTMLInputElement
    expect(document.querySelectorAll('.command-opt').length).toBeGreaterThan(3)
    fireEvent.change(input, { target: { value: 'فاتورة مبيعات' } })
    const labels = [...document.querySelectorAll('.command-opt-label')].map((e) => e.textContent)
    expect(labels.some((t) => t?.includes('فاتورة مبيعات'))).toBe(true)
  })

  it('البحث يتجاهل اختلاف الهمزات والتاء المربوطة', () => {
    view()
    openPalette()
    const input = screen.getByLabelText('بحث لوحة الأوامر') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'فاتوره مبيعات' } })
    const labels = [...document.querySelectorAll('.command-opt-label')].map((e) => e.textContent)
    expect(labels.some((t) => t?.includes('فاتورة مبيعات'))).toBe(true)
  })

  it('الأسهم تنقل التحديد وEscape يغلق اللوحة', () => {
    view()
    openPalette()
    const input = screen.getByLabelText('بحث لوحة الأوامر')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const active = [...document.querySelectorAll('.command-opt')].findIndex((e) => (e as HTMLElement).dataset.cmdActive === 'true')
    expect(active).toBe(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-command-palette]')).toBeNull()
  })

  it('Ctrl+/ يعرض خريطة الاختصارات ثم Escape يغلقها', () => {
    view()
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    const map = document.querySelector('[data-shortcut-map]')
    expect(map).not.toBeNull()
    expect(map?.querySelectorAll('.shortcut-row').length).toBe(SHORTCUT_MAP.reduce((sum, g) => sum + g.rows.length, 0))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-shortcut-map]')).toBeNull()
  })

  it('خريطة الاختصارات توثّق مفاتيح النوافذ والفاتورة', () => {
    const all = SHORTCUT_MAP.flatMap((g) => g.rows.map(([k]) => k)).join(' ')
    for (const key of ['Ctrl + K', 'Ctrl + Alt + W', 'Ctrl + Alt + 1..9', 'F9', 'F8'])
      expect(all).toContain(key)
  })
})
