/**
 * §102 (مراجعة المالك — تعدد الطابعات الحرارية): مسارات الطباعة المسماة —
 * النواة الخالصة normalizePrinterProfiles (دفاعية الهجرة)، المخزن
 * printerProfiles + setPrinterProfile، الجسر (أسماء الطابعات والطباعة
 * الموجهة تعمل عبر shopsysPrint في EXE؛ المتصفح يسقط إلى الحوار)، وقسم
 * «الطابعات والمسارات» في إعدادات الطباعة.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

const { DEFAULT_PRINTER_PROFILES, normalizePrinterProfiles, PRINT_ROUTES } = await import('../src/core/printers.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const printBridge = await import('../src/ui/print/printReceipt.ts')

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ printerProfiles: DEFAULT_PRINTER_PROFILES })
})
afterEach(() => cleanup())

describe('§102 نواة مسارات الطابعات', () => {
  it('الافتراضي: ثلاثة مسارات مطفأة بلا أسماء — لا طباعة آلية قبل تفعيل المالك', () => {
    expect(DEFAULT_PRINTER_PROFILES).toEqual({
      clientReceipt: { printerName: '', autoPrint: false },
      kitchenTicket: { printerName: '', autoPrint: false },
      stationTicket: { printerName: '', autoPrint: false },
    })
    expect(PRINT_ROUTES.map((r) => r.route)).toEqual(['clientReceipt', 'kitchenTicket', 'stationTicket'])
  })

  it('دفاعية الهجرة: الفاسد والناقص يُستكمل بالافتراضي بلا استثناء', () => {
    expect(normalizePrinterProfiles(undefined)).toEqual(DEFAULT_PRINTER_PROFILES)
    expect(normalizePrinterProfiles('فاسد')).toEqual(DEFAULT_PRINTER_PROFILES)
    expect(normalizePrinterProfiles({ clientReceipt: { printerName: '  XP-80  ', autoPrint: true }, kitchenTicket: 42 })).toEqual({
      clientReceipt: { printerName: 'XP-80', autoPrint: true },
      kitchenTicket: { printerName: '', autoPrint: false },
      stationTicket: { printerName: '', autoPrint: false },
    })
    /* الأسماء الطويلة تقص، وautoPrint لا يقبل إلا true الصارمة */
    const out = normalizePrinterProfiles({ stationTicket: { printerName: 'ط'.repeat(300), autoPrint: 'yes' } })
    expect(out.stationTicket.printerName).toHaveLength(120)
    expect(out.stationTicket.autoPrint).toBe(false)
  })
})

describe('§102 مخزن المسارات والجسر', () => {
  it('setPrinterProfile يحدّث مساره فقط ولا يمس البقية', () => {
    useAppStore.getState().setPrinterProfile('kitchenTicket', { printerName: 'TM-T20III', autoPrint: true })
    const profiles = useAppStore.getState().printerProfiles
    expect(profiles.kitchenTicket).toEqual({ printerName: 'TM-T20III', autoPrint: true })
    expect(profiles.clientReceipt).toEqual({ printerName: '', autoPrint: false })
    expect(profiles.stationTicket).toEqual({ printerName: '', autoPrint: false })
  })

  it('printHtml مع printerName يمرر الاسم للجسر (EXE) — وبلا جسر يسقط لحوار المتصفح', () => {
    const bridge = vi.fn()
    ;(globalThis as Record<string, unknown>).shopsysPrint = bridge
    printBridge.printHtml('<b>بون</b>', { silent: true, printerName: 'XP-80' })
    expect(bridge).toHaveBeenCalledWith('<b>بون</b>', true, 'XP-80')
    delete (globalThis as Record<string, unknown>).shopsysPrint
    /* بلا جسر: لا يرمي — يسقط إلى iframe الحوار (لا نستطيع اختبار حوار النظام) */
    expect(() => printBridge.printHtml('<b>بون</b>', { silent: true, printerName: 'XP-80' })).not.toThrow()
  })

  it('listSystemPrinters: بلا جسر يرجع [] — المتصفح لا يرى طابعات الجهاز', async () => {
    expect(await printBridge.listSystemPrinters()).toEqual([])
    ;(globalThis as Record<string, unknown>).shopsysPrinters = async () => ['XP-80', 'TM-T20III', 42]
    expect(await printBridge.listSystemPrinters()).toEqual(['XP-80', 'TM-T20III'])
    delete (globalThis as Record<string, unknown>).shopsysPrinters
  })
})

describe('§102 قسم الطابعات والمسارات في إعدادات الطباعة', () => {
  it('يعرض المسارات الثلاثة بمفاتيحها — التفعيل يكتب في المخزن فوراً', async () => {
    const { PrintSettingsPage } = await import('../src/ui/pages/PrintSettingsPage.tsx')
    render(<PrintSettingsPage />)
    for (const meta of PRINT_ROUTES) {
      expect(screen.getByTestId(`autoprint-${meta.route}`)).toBeTruthy()
      expect(screen.getByTestId(`printer-name-${meta.route}`)).toBeTruthy()
    }
    /* تفعيل بون المطبخ آلياً — ينعكس في المخزن */
    fireEvent.click(screen.getByTestId('autoprint-kitchenTicket'))
    expect(useAppStore.getState().printerProfiles.kitchenTicket.autoPrint).toBe(true)
    /* تسمية الطابعة تُكتب باسمها */
    fireEvent.change(screen.getByTestId('printer-name-kitchenTicket'), { target: { value: 'TM-T20III' } })
    expect(useAppStore.getState().printerProfiles.kitchenTicket.printerName).toBe('TM-T20III')
    expect(screen.getByText('الطابعات والمسارات')).toBeTruthy()
  })
})
