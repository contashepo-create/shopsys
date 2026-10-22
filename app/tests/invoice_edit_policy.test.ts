import { describe, expect, it } from 'vitest'
import { electronicInvoiceLockActive, invoiceEditPolicy, zatcaLinkPolicy, zatcaQrPolicy } from '../src/core/invoiceEdit.ts'

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

describe('سياسة رمز زاتكا: الرمز محلي والاتصال للربط فقط', () => {
  it('يُطبع الرمز بلا إنترنت: رمز المرحلة الأولى (Generation) لا يشترط اتصالاً', () => {
    expect(zatcaQrPolicy({ featureActive: true, printEnabled: true }).printQr).toBe(true)
    expect(zatcaQrPolicy({ featureActive: true, printEnabled: true }).reasonAr).toBeNull()
  })
  it('يبقى محكوماً بالميزة ومفتاح الطباعة وحدهما', () => {
    expect(zatcaQrPolicy({ featureActive: false, printEnabled: true }).printQr).toBe(false)
    expect(zatcaQrPolicy({ featureActive: true, printEnabled: false }).printQr).toBe(false)
  })
  it('الربط/الإرسال (المرحلة الثانية) هو ما يتطلب الإنترنت', () => {
    expect(zatcaLinkPolicy({ featureActive: true, online: false }).canLink).toBe(false)
    expect(zatcaLinkPolicy({ featureActive: true, online: false }).reasonAr).toMatch(/اتصال/)
    expect(zatcaLinkPolicy({ featureActive: true, online: true }).canLink).toBe(true)
    expect(zatcaLinkPolicy({ featureActive: false, online: true }).canLink).toBe(false)
  })
  it('سبب منع الربط يوضح أن الطباعة المحلية لا تتأثر', () => {
    expect(zatcaLinkPolicy({ featureActive: true, online: false }).reasonAr).toMatch(/بلا اتصال/)
  })
})
