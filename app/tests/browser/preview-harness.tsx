import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ThermalPreview } from '../../src/ui/components/ThermalPreview.tsx'
import { openPrintPreview } from '../../src/ui/components/printPreviewStore.ts'

const html = `<!doctype html><html><body><h1 id="report">بيان اختبار</h1>
<script>parent.__previewScriptRan = true</script>
<img src="/does-not-exist" onerror="parent.__previewEventRan = true">
</body></html>`
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <button id="open-preview" onClick={() => openPrintPreview({ html, wide: true, title: 'معاينة اختبار' })}>فتح</button>
    <ThermalPreview />
  </MemoryRouter>,
)

// يولّد اختبار PDF في Chromium مستندات حقيقية من كل قوالب الفاتورة، لا نموذجاً اصطناعياً.
import { A4_STYLES, DEFAULT_RECEIPT_SETTINGS, buildSimpleDocModel } from '../../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../../src/ui/print/printInvoiceA4.ts'
import { applyPreviewScale } from '../../src/ui/print/previewScale.ts'
Object.assign(window, {
  __invoiceStyles: A4_STYLES.map(style => style.id),
  __makeInvoice: (style: typeof A4_STYLES[number]['id'], count: number, scale: number) => {
    const cur = { code: 'EGP', symbol: 'EGP', decimals: 2 as const, name: '' }
    const settings = { ...DEFAULT_RECEIPT_SETTINGS, a4Style: style }
    const rows = Array.from({ length: count }, (_, i) => ({ nameAr: `row-item-${String(i + 1).padStart(3, '0')}`, qty: 1, unitPriceMinor: 1000, totalMinor: 1000 }))
    const model = buildSimpleDocModel({ docTitle: 'Invoice', invoiceNumber: 'INV-1', refCode: 'DRAFT', dateIso: '2026-01-01', partyLabel: 'Customer', paymentLabel: 'Cash', rows, totalMinor: count * 1000, paidMinor: count * 1000, operatorName: 'Operator', settings })
    return applyPreviewScale(renderInvoiceA4Html(model, cur, settings, 'a4'), scale)
  },
})
