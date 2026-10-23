/**
 * طباعة موحدة لأي مستند (طلب المالك — تعميم قوالب الكاشير الثلاثة):
 * فاتورة بيع/مرتجع بيع/فاتورة شراء/مرتجع شراء — كلها تُطبع بنفس المحرك
 * حراري / A4 / A5، والقالب يُختار لحظة الطباعة بلا تغيير الإعدادات الدائمة.
 */
import type { ReceiptModel, ReceiptSettings, InvoiceTemplate } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { renderReceiptHtml, printHtml } from './printReceipt.ts'
import { renderInvoiceA4Html } from './printInvoiceA4.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { useAppStore } from '../../stores/app.store.ts'

/** يبني HTML المستند بالقالب المطلوب بلا طباعة — للمعاينة قبل الطبع (طلب المالك) */
export function buildModelHtml(
  model: ReceiptModel,
  cur: CurrencyConfig,
  settings: ReceiptSettings,
  template: InvoiceTemplate,
): string {
  const effective: ReceiptSettings = template === 'delivery'
    ? { ...settings, hidePrices: true, showDiscount: false, showTaxSummary: false, showWords: false, a4Style: 'classic' }
    : template === 'compact'
      ? { ...settings, a4Style: 'compact', showWords: false }
      : template === 'tax'
        ? { ...settings, showTaxSummary: true }
        : settings
  return template === 'thermal'
    ? renderReceiptHtml(model, cur, effective)
    : renderInvoiceA4Html(model, cur, effective, template === 'a5' ? 'a5' : 'a4')
}

export function printModelWithTemplate(
  model: ReceiptModel,
  cur: CurrencyConfig,
  settings: ReceiptSettings,
  template: InvoiceTemplate,
): void {
  /* قاعدة المالك الموحدة في كل الأنشطة: أي طباعة مستند تفتح معاينة قبل
     الطباعة أولاً — إلا إذا اختار «طباعة مباشرة» (صامتة) فيخرج المستند
     فوراً بالقالب/الحجم المطلوب لهذه الطبعة. */
  const html = buildModelHtml(model, cur, settings, template)
  if (settings.silentPrint) {
    printHtml(html, { silent: true })
    return
  }
  openPrintPreview({
    html,
    wide: template !== 'thermal',
    title: template !== 'thermal' ? 'معاينة المستند قبل الطباعة' : 'معاينة الإيصال الحراري',
    rebuild: () => buildModelHtml(model, cur, useAppStore.getState().receipt, template),
  })
}
