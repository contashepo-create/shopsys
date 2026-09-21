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
  printHtml(
    template === 'thermal'
      ? renderReceiptHtml(model, cur, settings)
      : renderInvoiceA4Html(model, cur, settings, template === 'a5' ? 'a5' : 'a4'),
  )
}
