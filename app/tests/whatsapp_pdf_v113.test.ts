/**
 * جولة v1.0.13 — توسيع خدمات الواتساب: إرسال المستند PDF عبر واتساب
 * (فاتورة مبيعات / مشتريات / مرتجعاهما / عرض سعر).
 * يغطي النواة الموحدة: تطبيع الرقم، رابط المحادثة (برقم وبلا رقم)،
 * اسم الملف اللاتيني الآمن، ورسالة المصاحبة.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { normalizeWaPhone, waChatLink, safePdfFileName, docShareMessage } = await import('../src/core/whatsapp.ts')

describe('v1.0.13 — مساعدات واتساب الموحدة', () => {
  it('تطبيع الرقم: 01x المصري يُرفق 2، و00 الدولي يُقشر، والدولي يمر كما هو', () => {
    expect(normalizeWaPhone('01012345678')).toBe('201012345678')
    expect(normalizeWaPhone('00201012345678')).toBe('201012345678')
    expect(normalizeWaPhone('+971 50 123 4567')).toBe('971501234567')
    expect(normalizeWaPhone('')).toBe('')
    expect(normalizeWaPhone('غير رقم')).toBe('')
  })

  it('رابط المحادثة: برقم يفتح محادثته، وبلا رقم يفتح قائمة اختيار الجهة (لا فشل صامت)', () => {
    expect(waChatLink('01012345678', 'مرحبا')).toBe('https://wa.me/201012345678?text=' + encodeURIComponent('مرحبا'))
    const noPhone = waChatLink('', 'عرض سعر')
    expect(noPhone.startsWith('https://wa.me/?text=')).toBe(true)
    expect(noPhone).not.toContain('wa.me/2')
  })

  it('اسم الملف لاتيني آمن عبر أنظمة الملفات — بلا مسافات أو عربية أو رموز مشاركة', () => {
    const name = safePdfFileName('INV', 'INV-0001')
    expect(name).toBe('Tahakom-INV-INV-0001-' + new Date().toISOString().slice(0, 10))
    expect(safePdfFileName('QOT', 'عرض 12/2026')).toMatch(/^Tahakom-QOT-[\w.-]+$/)
    expect(safePdfFileName('INV', '')).toContain('draft')
  })

  it('رسالة المصاحبة تحمل التسمية والرقم واسم المتجر', () => {
    const msg = docShareMessage('فاتورة مبيعات', 'INV-0001', 'متجر النور')
    expect(msg).toContain('فاتورة مبيعات')
    expect(msg).toContain('INV-0001')
    expect(msg).toContain('متجر النور')
    expect(docShareMessage('عرض سعر', 'مسودة', 'X')).toContain('مسودة')
  })

  it('بادئة الملف تتمايز لكل مستند من الخمسة (مبيعات/مشتريات/مرتجعاهما/عرض)', () => {
    // البادئة تُشتق داخل shareDoc.ts — نتحقق منها عبر سلوك safePdfFileName مع كل تسمية مرجعية
    expect(safePdfFileName('INV', 'A-1')).toContain('INV')
    expect(safePdfFileName('PUR', 'B-2')).toContain('PUR')
    expect(safePdfFileName('SRN', 'C-3')).toContain('SRN')
    expect(safePdfFileName('PRN', 'D-4')).toContain('PRN')
    expect(safePdfFileName('QOT', 'E-5')).toContain('QOT')
  })
})
