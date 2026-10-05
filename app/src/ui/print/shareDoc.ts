/**
 * إرسال مستند PDF عبر واتساب (v1.0.13) — الوجه الموحّد لكل المستندات:
 * فاتورة مبيعات / فاتورة مشتريات / مرتجع مبيعات / مرتجع مشتريات / عرض سعر.
 *
 * الحقيقة التقنية الصريحة: wa.me لا يقبل إرفاق ملفات برابط — لذا النمط هو:
 * يولّد نسخة سطح المكتب PDF حقيقياً بنفس قوالب الطباعة (printToPDF)،
 * يحفظه بمجلد «التنزيلات/Tahakom-PDF»، ينسخ مساره للحافظة (أفضل جهد)،
 * يفتح المجلد بملف محدد ويفتح محادثة واتساب — ثم يرشد للصق/السحب.
 * في المتصفح لا يوجد محرك PDF — رسالة صادقة بدل الادعاء.
 */
import type { ReceiptModel, ReceiptSettings, InvoiceTemplate } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { buildModelHtml } from './printDoc.ts'
import { waChatLink, safePdfFileName, docShareMessage } from '../../core/whatsapp.ts'

type ToastLike = { show: (msg: string, kind?: 'success' | 'error') => void }

interface ShareDocPdfArgs {
  model: ReceiptModel
  cur: CurrencyConfig
  settings: ReceiptSettings
  /** قالب الطباعة للـ PDF — الافتراضي A4 (الأنسب للإرسال) */
  template?: InvoiceTemplate
  docLabel: string
  docNumber: string
  /** رقم الطرف (عميل/مورد) — فارغ = يفتح واتساب لاختيار الجهة */
  partyPhone?: string
  shopName: string
  toast: ToastLike
}

export function shareDocPdfViaWhatsapp(args: ShareDocPdfArgs): void {
  const { model, cur, settings, template = 'a4', docLabel, docNumber, partyPhone = '', shopName, toast } = args
  const bridge = (globalThis as { shopsysPdfShare?: (html: string, fileName: string, waLink?: string) => Promise<{ ok: boolean; path?: string; copied: boolean; error?: string }> }).shopsysPdfShare
  if (typeof bridge !== 'function') {
    toast.show('إرسال PDF واتساب متاح في نسخة سطح المكتب — من المتصفح استخدم «طباعة ← حفظ كـ PDF»', 'error')
    return
  }
  const html = buildModelHtml(model, cur, settings, template)
  const fileName = safePdfFileName(docLabelToPrefix(docLabel), docNumber)
  const link = waChatLink(partyPhone, docShareMessage(docLabel, docNumber, shopName))
  toast.show(`جارٍ توليد PDF لـ ${docLabel} ${docNumber}…`)
  void bridge(html, fileName, link).then((result) => {
    if (!result.ok) { toast.show(`تعذر توليد PDF: ${result.error ?? 'خطأ غير معروف'}`, 'error'); return }
    if (result.copied) toast.show('✅ الملف في الحافظة والمجلد مفتوح — الصق (Ctrl+V) في المحادثة أو اسحبه')
    else toast.show('✅ الملف جاهز في مجلد التنزيلات/Tahakom-PDF — اسحبه إلى المحادثة')
  }).catch((e: unknown) => toast.show(`تعذر الإرسال: ${(e as Error).message}`, 'error'))
}

/** يحوّل التسمية العربية لبادئة ملف لاتينية — بلا عربية بأسماء الملفات المشاركة */
function docLabelToPrefix(docLabel: string): string {
  if (docLabel.includes('مرتجع') && docLabel.includes('شراء')) return 'PRN'
  if (docLabel.includes('مرتجع')) return 'SRN'
  if (docLabel.includes('شراء')) return 'PUR'
  if (docLabel.includes('عرض') || docLabel.includes('مناقصة')) return 'QOT'
  return 'INV'
}
