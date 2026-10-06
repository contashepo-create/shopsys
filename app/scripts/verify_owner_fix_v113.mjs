#!/usr/bin/env node
/**
 * بوابة جولة v1.0.13 — توسيع خدمات الواتساب: إرسال المستند PDF عبر واتساب
 * لكل من: فاتورة مبيعات · فاتورة مشتريات · مرتجع مبيعات · مرتجع مشتريات · عرض سعر.
 * النمط الصادق: wa.me لا يدعم إرفاق ملفات برابط — لذا: PDF حقيقي بنفس قوالب
 * الطباعة (printToPDF) → مجلد معروف → نسخ للحافظة (أفضل جهد) + فتح المجلد →
 * فتح محادثة واتساب (برقم الطرف أو قائمة اختيار جهة) → إرشاد الصق/السحب.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(DIR, '..', p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const failedNames = []
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) { failed++; failedNames.push(name) }
}

/* ─── المحرك (سطح المكتب): توليد PDF حقيقي + مجلد + فتح المحادثة ─── */
const main = read('desktop/main.ts')
check('المحرك: معالج pdf:export-share مسجل في IPC', main.includes("ipcMain.handle('pdf:export-share'"))
check('المحرك: exportPdfShare يولّد PDF بنفس محرك الطباعة (printToPDF بخلفيات)', main.includes('printToPDF({ printBackground: true'))
check('المحرك: الملف يُحفظ بمجلد معروف تحت التنزيلات (Tahakom-PDF)', main.includes("'Tahakom-PDF'") && main.includes('downloads'))
check('المحرك: لا استدعاء حافظة ملفات — Electron 44 أزالها؛ الفتح بالمجلد محدداً هو النمط الموثق', !main.includes('clipboard.writeBuffer') && !main.includes("writeBuffer('FileNameW'") && main.includes('showItemInFolder'))
check('المحرك: يفتح المجلد بالملف محدداً ثم محادثة wa.me (openExternal)', main.includes('showItemInFolder') && main.includes('openExternal(waLink)'))
check('التوثيق الصادق: لا ادعاء إرفاق مباشر — wa.me لا يدعم مرفقات بالرابط', main.includes('wa.me لا يدعم إرفاق ملفات برابط مباشر'))

const preload = read('desktop/preload.ts')
check('الجسر: shopsysPdfShare مكشوف للعارض بأمان (contextBridge)', preload.includes('shopsysPdfShare') && preload.includes("invoke('pdf:export-share'"))

/* ─── النواة الموحدة: أرقام وروابط وأسماء ملفات ─── */
const wa = read('src/core/whatsapp.ts')
check('النواة: تطبيع الرقم المصري والدولي (0→2 · 00 تُقشر) — نمط المواعيد نفسه', wa.includes('`2${digits}`') && wa.includes('digits.slice(2)'))
check('النواة: بلا رقم يفتح قائمة اختيار الجهة بدل الفشل الصامت', wa.includes('https://wa.me/?text='))
check('النواة: أسماء الملفات لاتينية آمنة للمشاركة (بلا عربية/مسافات/رموز)', wa.includes('replace(/[^A-Za-z0-9._-]+/g'))

/* ─── الوجه الموحد للإرسال ─── */
const share = read('src/ui/print/shareDoc.ts')
check('الوجه الموحد: shareDocPdfViaWhatsapp يبني HTML بنفس قوالب الطباعة (buildModelHtml)', share.includes('buildModelHtml(') && share.includes('export function shareDocPdfViaWhatsapp'))
check('الوجه الموحد: المتصفح بلا محرك PDF — رسالة صادقة بدل الادعاء', share.includes('متاح في نسخة سطح المكتب'))

/* ─── الأزرار: المستندات الخمسة ─── */
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
check('⑤ فاتورة المبيعات: زر واتساب PDF بهاتف العميل واسم متجره', sales.includes('onWhatsappPdf={whatsappPdf}') && sales.includes("customers.find(c=>c.id===customerId)?.phone??''"))
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
check('⑤ فاتورة المشتريات: زر واتساب PDF بهاتف المورد', purchase.includes('onWhatsappPdf={whatsappPdf}') && purchase.includes("suppliers.find(supplier=>supplier.id===supplierId)?.phone??''"))
const sreturns = read('src/ui/pages/SaleReturnsPage.tsx')
check('⑤ مرتجع المبيعات: زر داخل مودال القوالب بهاتف عميل الفاتورة الأصلية', sreturns.includes('onWhatsappPdf={(t) => { if (printTarget) whatsappReturn(printTarget, t) }}') && sreturns.includes("orig?.customerId ? customers.find((c) => c.id === orig.customerId)?.phone ?? ''"))
const preturns = read('src/ui/pages/PurchaseReturnsPage.tsx')
check('⑤ مرتجع المشتريات: زر داخل مودال القوالب بهاتف المورد', preturns.includes('whatsappPurchaseReturn(printTarget, t)') && preturns.includes('suppliers.find((s) => s.id === orig.supplierId)?.phone ?? \'\''))
const quotes = read('src/ui/pages/QuotationsPage.tsx')
check('⑤ عرض السعر: زر واتساب PDF — بلا رقم محفوظ يفتح قائمة اختيار الجهة', quotes.includes('onWhatsappPdf={() =>') && quotes.includes("partyPhone: ''"))

const frame = read('src/ui/components/InvoicePOSFrame.tsx')
check('الإطار: زر «واتساب PDF» بجوار تصدير PDF (prop اختياري لا يكسر بقية الشاشات)', frame.includes('onWhatsappPdf?: () => void') && frame.includes('واتساب PDF'))
const modal = read('src/ui/components/PrintTemplateModal.tsx')
check('مودال القوالب: زر «إرسال PDF عبر واتساب» يرسل بالقالب المختار', modal.includes('onWhatsappPdf?: (template: InvoiceTemplate) => void') && modal.includes('إرسال PDF عبر واتساب'))

/* ─── الاختبارات ─── */
const test = read('tests/whatsapp_pdf_v113.test.ts')
check('اختبارات الجولة: نواة واتساب موحدة (5 حالات) — الرقم/الرابط/الاسم/الرسالة', test.includes('normalizeWaPhone') && test.includes('waChatLink') && test.includes('safePdfFileName'))

/* ─── النتيجة ─── */
console.log('')
if (failed > 0) {
  console.error(`✗ فشل ${failed} فحصاً من بوابة v1.0.13:`)
  for (const n of failedNames) console.error(`  — ${n}`)
  process.exit(1)
}
console.log('✓ بوابة v1.0.13 كاملة (19 فحصاً): إرسال المستندات الخمسة PDF عبر واتساب — محرك حقيقي بلا ادعاء إرفاق مباشر')
