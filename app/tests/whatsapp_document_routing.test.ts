import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareDocPdfViaWhatsapp } from '../src/ui/print/shareDoc.ts'
import type { ReceiptModel, ReceiptSettings } from '../src/core/receipt.ts'
import type { CurrencyConfig } from '../src/core/money.ts'

vi.mock('../src/ui/print/printDoc.ts', () => ({ buildModelHtml: () => '<html>pdf</html>' }))
const bridge = vi.fn().mockResolvedValue({ ok: true, copied: false })
const toast = { show: vi.fn() }
const args = { model: {} as ReceiptModel, settings: {} as ReceiptSettings, cur: {} as CurrencyConfig, docLabel: 'فاتورة', docNumber: 'INV-1', shopName: 'متجر', toast }
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('توجيه مستند PDF إلى الطرف الصحيح', () => {
  it.each([
    ['٠٥٠١٢٣٤٥٦٧', 'SA', '966501234567'],
    ['+971 50 123 4567', 'EG', '971501234567'],
    ['01012345678', 'EG', '201012345678'],
  ])('يولّد رابط %s حسب %s', (partyPhone, countryCode, intl) => {
    vi.stubGlobal('shopsysPdfShare', bridge)
    shareDocPdfViaWhatsapp({ ...args, partyPhone, countryCode })
    expect(bridge).toHaveBeenCalledOnce()
    expect(bridge.mock.calls[0][2]).toMatch(new RegExp(`^https://wa\\.me/${intl}\\?text=`))
  })
  it('يوقف إنشاء الملف وفتح المحادثة عند رقم ملتبس', () => {
    vi.stubGlobal('shopsysPdfShare', bridge)
    shareDocPdfViaWhatsapp({ ...args, partyPhone: '0501234567', countryCode: null })
    expect(bridge).not.toHaveBeenCalled()
    expect(toast.show).toHaveBeenCalledWith(expect.stringMatching(/بلد رقم واتساب غير معروف/), 'error')
  })
  it('المستند بلا رقم يترك اختيار الجهة للمستخدم', () => {
    vi.stubGlobal('shopsysPdfShare', bridge)
    shareDocPdfViaWhatsapp(args)
    expect(bridge.mock.calls[0][2]).toMatch(/^https:\/\/wa\.me\/\?text=/)
  })
  it('يعرض قيد نسخة المتصفح ولا يوهم بإرسال ملف', () => {
    vi.stubGlobal('shopsysPdfShare', undefined)
    shareDocPdfViaWhatsapp(args)
    expect(bridge).not.toHaveBeenCalled()
    expect(toast.show).toHaveBeenCalledWith(expect.stringMatching(/نسخة سطح المكتب/), 'error')
  })
})
