/**
 * دخان كل أنواع النوافذ الحرة غير المغطاة اختبارياً (المطلب 12 — منهجي لا
 * عيّنة): الأنواع السبعة التي لم يفتحها أي اختبار من قبل تُفتح بمساعِدها
 * الرسمي وترسم داخل WindowHost فعلياً بلا انهيار وبمحتوى حقيقي.
 * المغطى في ملفات أخرى (مرجع): sales/purchase-invoice وitem-editor و
 * item-ledger وparty-ledger وparty-editor (app_windows/window_tabs).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const payloads = JSON.parse(readFileSync(join(here, '../demo-db/demo-payloads.json'), 'utf8')) as Record<string, unknown>
const payload = payloads.contracting

vi.stubGlobal('fetch', vi.fn(async (path: unknown) => {
  if (String(path).includes('/__demo/data')) return { ok: true, json: async () => payload } as unknown as Response
  return Promise.reject(new Error('offline')) as unknown as Promise<Response>
}))

beforeAll(() => { Element.prototype.scrollIntoView ||= () => {} })

let store: typeof import('../src/ui/windows/windowStore.ts')
let WindowHost: typeof import('../src/ui/windows/WindowHost.tsx')['WindowHost']

beforeAll(async () => {
  const { loadDemoActivity } = await import('../src/dev/demoDatabase.ts')
  await loadDemoActivity('contracting')
  const { useAppStore } = await import('../src/stores/app.store.ts')
  useAppStore.getState().acceptLegal()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting', shopName: 'م', ownerName: 'مالك' },
  })
  const { useSessionAuthStore } = await import('../src/data/sessionAuth.ts')
  useSessionAuthStore.setState({ authenticated: true })
  store = await import('../src/ui/windows/windowStore.ts')
  ;({ WindowHost } = await import('../src/ui/windows/WindowHost.tsx'))
}, 60_000)

function W() {
  return store.useWindowStore.getState()
}

afterEach(() => cleanup())
beforeEach(() => {
  store.useWindowStore.setState({ windows: [], topZ: 700, tabs: [], viewActiveTabId: null, pendingPath: null, currentPath: '/' })
})

const CASES: Array<{ name: string; kind: string }> = [
  { name: 'item-prices (نوافذ الأسعار)', kind: 'item-prices' },
  { name: 'project-expense (تسجيل مصروف مشروع)', kind: 'project-expense' },
  { name: 'extract-wizard (استخلاص مقاولة)', kind: 'extract-wizard' },
  { name: 'project-editor (محرر مشروع)', kind: 'project-editor' },
  { name: 'employee-editor (محرر موظف)', kind: 'employee-editor' },
  { name: 'item-picker (منتقي الأصناف)', kind: 'item-picker' },
  { name: 'entity-picker (منتقي الكيانات)', kind: 'entity-picker' },
]

function openByKind(kind: string): string {
  switch (kind) {
    case 'item-prices': return store.openItemPricesWindow(1)
    case 'project-expense': return store.openProjectExpenseWindow()
    case 'extract-wizard': return store.openExtractWizardWindow()
    case 'project-editor': return store.openProjectEditorWindow(1)
    case 'employee-editor': return store.openEmployeeEditorWindow(1)
    case 'item-picker': return store.openItemPickerWindow({ items: [], onPick: () => {} })
    case 'entity-picker': return store.openEntityPickerWindow({ entity: 'customer', onPick: () => {} })
    default: throw new Error(`غير معروف: ${kind}`)
  }
}

describe('دخان رسم كل الأنواع غير المغطاة داخل النافذة الحرة', () => {
  it.each(CASES)('$name يُرسم بلا انهيار وبمحتوى حقيقي', async ({ kind }) => {
    const id = openByKind(kind)
    expect(W().windows.find((win) => win.id === id)?.kind).toBe(kind)
    render(<MemoryRouter><WindowHost /></MemoryRouter>)
    await waitFor(
      () => {
        const win = document.querySelector(`[data-app-window="${id}"]`)
        expect(win, `نافذة ${kind} لم تُرسم`).toBeTruthy()
        expect(win!.textContent).not.toContain('جارٍ فتح النافذة')
      },
      { timeout: 10_000 },
    )
    const body = document.querySelector(`[data-app-window="${id}"] .app-window-body`)
    expect(body, `جسم ${kind} مفقود`).toBeTruthy()
    /* محتوى حقيقي (حقول/جداول/أزراف إجراء) — لا غلاف فارغ */
    expect(
      body!.querySelector('input, select, textarea, button, table, [role="listbox"], [role="dialog"], [role="tab"]'),
      `محتوى ${kind} فارغ`,
    ).toBeTruthy()
  })
})
