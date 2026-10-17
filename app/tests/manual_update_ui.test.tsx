/**
 * زر فحص التحديث وشريط التنزيل (طلب المالك: استرجاعهما كما كان مع بقاء
 * الفحص التلقائي والتحديث الصامت كما هما).
 *
 * يثبت هذا الاختبار:
 *   ① قرار الفحص اليدوي نقي: لا فحص فوق فحص جارٍ أو تنزيل جارٍ أو تحديث جاهز.
 *   ② الواجهة تعرض زر «فحص التحديثات» ويستدعي الجسر.
 *   ③ شريط التنزيل يعرض نسبة التقدم القادمة من العملية الرئيسية.
 *   ④ الفحص الدوري التلقائي والتثبيت الصامت في العملية الرئيسية بقيا كما هما.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'

const { decideManualCheck } = await import('../desktop/updateLifecycle.ts')
const { DesktopUpdater } = await import('../src/ui/components/DesktopUpdater.tsx')

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

describe('قرار الفحص اليدوي', () => {
  it('يبدأ فحصاً فورياً في الحالة النظيفة', () => {
    expect(decideManualCheck({ packaged: true, inFlight: false, downloading: false, downloaded: false })).toEqual({ kind: 'check' })
  })

  it('لا يفحص فوق فحص جارٍ أو تنزيل جارٍ أو تحديث جاهز', () => {
    expect(decideManualCheck({ packaged: true, inFlight: true, downloading: false, downloaded: false }).kind).toBe('in_flight')
    expect(decideManualCheck({ packaged: true, inFlight: false, downloading: true, downloaded: false }).kind).toBe('downloading')
    expect(decideManualCheck({ packaged: true, inFlight: false, downloading: false, downloaded: true }).kind).toBe('downloaded')
  })

  it('نسخة غير مثبَّتة (تطوير) بلا فحص', () => {
    expect(decideManualCheck({ packaged: false, inFlight: false, downloading: false, downloaded: false }).kind).toBe('unavailable')
  })
})

describe('واجهة التحديث اليدوي', () => {
  const listeners: ((state: unknown) => void)[] = []
  const check = vi.fn(async () => undefined)
  const install = vi.fn(async () => undefined)

  beforeEach(() => {
    listeners.length = 0
    check.mockClear()
    install.mockClear()
    ;(window as unknown as { shopsysUpdater: unknown }).shopsysUpdater = {
      state: async () => ({ status: 'idle' }),
      check,
      install,
      onState: (listener: (state: unknown) => void) => { listeners.push(listener); return () => { /* إلغاء */ } },
    }
    ;(globalThis as unknown as { shopsysAppInfo: unknown }).shopsysAppInfo = async () => ({ version: '1.0.30' })
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { shopsysUpdater?: unknown }).shopsysUpdater
    delete (globalThis as unknown as { shopsysAppInfo?: unknown }).shopsysAppInfo
  })

  it('يعرض زر فحص التحديثات ويستدعي الجسر', async () => {
    render(React.createElement(DesktopUpdater))
    const button = await screen.findByText('فحص التحديثات')
    fireEvent.click(button)
    await waitFor(() => expect(check).toHaveBeenCalled())
  })

  it('يعرض شريط التنزيل بنسبة التقدم من العملية الرئيسية', async () => {
    render(React.createElement(DesktopUpdater))
    await screen.findByText('فحص التحديثات')
    listeners.forEach((listener) => listener({ status: 'downloading', percent: 42 }))
    await waitFor(() => expect(screen.getByTestId('desktop-updater-progress')).toBeTruthy())
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('يعرض رسالة الخطأ القادمة من العملية الرئيسية', async () => {
    render(React.createElement(DesktopUpdater))
    await screen.findByText('فحص التحديثات')
    listeners.forEach((listener) => listener({ status: 'error', message: 'تعذّر الوصول لخادم التحديثات' }))
    await waitFor(() => expect(screen.getByText('تعذّر الوصول لخادم التحديثات')).toBeTruthy())
  })

  it('يخفي نفسه خارج سطح المكتب (المتصفح)', () => {
    delete (window as unknown as { shopsysUpdater?: unknown }).shopsysUpdater
    const { container } = render(React.createElement(DesktopUpdater))
    expect(container.innerHTML).toBe('')
  })
})

describe('الفحص التلقائي والتحديث الصامت بقيا كما هما', () => {
  const main = read('desktop/main.ts')
  const lifecycle = read('desktop/updateLifecycle.ts')

  it('الفحص الدوري التلقائي قائم', () => {
    expect(main).toContain('autoUpdater.autoDownload = true')
    expect(main).toContain('scheduleUpdateCheck(autoUpdater, UPDATE_CHECK_INTERVAL_MS)')
    expect(main).toContain('scheduleUpdateRetry(autoUpdater)')
  })

  it('التثبيت الصامت عند الإغلاق قائم بترتيب الحُرّاس', () => {
    expect(main).toContain('await installSilentUpdate(')
    expect(main).toContain('flush: flushRenderer')
    expect(main).toContain('backupBeforeUpdate(downloadedUpdateVersion!)')
    const order = ['await deps.flush()', 'await deps.protect()', 'await deps.backup()', 'deps.close()', 'await deps.install()', 'deps.exit()']
      .map((step) => lifecycle.indexOf(step))
    expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true)
  })
})
