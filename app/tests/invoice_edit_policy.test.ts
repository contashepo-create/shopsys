import { describe, expect, it } from 'vitest'
import { electronicInvoiceLockActive, invoiceEditPolicy } from '../src/core/invoiceEdit.ts'

describe('سياسة تعديل الفاتورة', () => {
  it('يسمح بالتعديل للمنشأة غير المسجلة ضريبياً ولو كانت الإمكانية متاحة', () => {
    const active = electronicInvoiceLockActive({ licensed: true, enabled: true, taxNumber: '' })
    expect(active).toBe(false)
    expect(invoiceEditPolicy({ einvoiceActive: active }).canEdit).toBe(true)
  })
  it('يسمح بالتعديل عند إيقاف الإصدار الإلكتروني من العميل', () => {
    expect(electronicInvoiceLockActive({ licensed: true, enabled: false, taxNumber: '123456789' })).toBe(false)
  })
  it('يقفل التعديل فقط عند تشغيل الربط الرسمي مع تسجيل ضريبي', () => {
    const active = electronicInvoiceLockActive({ licensed: true, enabled: true, taxNumber: '123456789' })
    expect(active).toBe(true)
    expect(invoiceEditPolicy({ einvoiceActive: active }).canEdit).toBe(false)
  })
  it('لا يكشف للمستخدم أي وصف تجاري للميزة', () => {
    expect(invoiceEditPolicy({ einvoiceActive: false }).reasonAr).not.toMatch(/مدفوع|ترخيص|اشتراك/)
    expect(invoiceEditPolicy({ einvoiceActive: true }).reasonAr).not.toMatch(/مدفوع|ترخيص|اشتراك/)
  })
})
