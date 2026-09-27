/**
 * طباعة موحدة لأي مستند (طلب المالك — تعميم قوالب الكاشير الثلاثة):
 * فاتورة بيع/مرتجع بيع/فاتورة شراء/مرتجع شراء — كلها تُطبع بنفس المحرك
 * حراري / A4 / A5، والقالب يُختار لحظة الطباعة بلا تغيير الإعدادات الدائمة.
 */
import type { ReceiptModel, ReceiptSettings, InvoiceTemplate } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { renderReceiptHtml, printHtml } from './printReceipt.ts'
import { renderInvoiceA4Html } from './printInvoiceA4.ts'

export function printModelWithTemplate(
  model: ReceiptModel,
  cur: CurrencyConfig,
  settings: ReceiptSettings,
  template: InvoiceTemplate,
): void {
  const effectiveSettings: ReceiptSettings = template === 'delivery'
    ? { ...settings, hidePrices: true, showDiscount: false, showTaxSummary: false, showWords: false, a4Style: 'classic' }
    : template === 'compact'
      ? { ...settings, a4Style: 'compact', showWords: false }
      : template === 'tax'
        ? { ...settings, showTaxSummary: true }
        : settings
  printHtml(
    template === 'thermal'
      ? renderReceiptHtml(model, cur, effectiveSettings)
      : renderInvoiceA4Html(model, cur, effectiveSettings, template === 'a5' ? 'a5' : 'a4'),
  )
}
