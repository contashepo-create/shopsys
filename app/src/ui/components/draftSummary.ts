import type { AdvancedInvoiceDraft } from '../../data/repo.ts'
import { quotationLineGrossMinor } from '../../core/contracting.ts'
import { toMinor } from '../../core/money.ts'

/** ملخّص يُقرأ من حمولة المسودة دون معرفة تفاصيل كل صفحة */
export interface DraftSummary {
  /** اسم العميل/المورد كما يظهر في عنوان المسودة */
  partyLabel: string
  lineCount: number
  totalMinor: number
}

/** يقرأ الحمولة المخزّنة ويستخرج منها ملخصاً آمناً (المسودة نصّ JSON قد يكون قديماً) */
export function summarizeDraft(draft: AdvancedInvoiceDraft, currencyDecimals = 2): DraftSummary {
  const partyLabel = draft.name.includes('—') ? draft.name.split('—').slice(1).join('—').trim() : draft.name
  try {
    const payload = JSON.parse(draft.payload) as {
      lines?: { qty?: number; unitPriceMinor?: number; discountPercent?: number }[]
      qLines?: { qty?: string; unitPrice?: string; descriptionAr?: string; vat?: string; incl?: boolean }[]
    }
    if (draft.kind === 'quotation' && Array.isArray(payload.qLines)) {
      const lines = payload.qLines.filter(line => line && typeof line.descriptionAr === 'string' && line.descriptionAr.trim() && Number.isFinite(Number(line.qty)) && Number(line.qty) > 0)
      const totalMinor = lines.reduce((sum, line) => {
        let price = 0
        try { price = Math.max(0, toMinor(line.unitPrice ?? '0', currencyDecimals)) } catch { /* المسودة قد تكون غير مكتملة */ }
        const rate = Number(line.vat)
        const vat = Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0
        return sum + quotationLineGrossMinor({ nameAr: '', descriptionAr: '', unitAr: '', qty: Number(line.qty), unitPriceMinor: price, estCostMinor: 0, vatPercent: vat, taxIncluded: !!line.incl })
      }, 0)
      return { partyLabel, lineCount: lines.length, totalMinor: Number.isSafeInteger(totalMinor) ? totalMinor : 0 }
    }
    const lines = Array.isArray(payload.lines) ? payload.lines : []
    const totalMinor = lines.reduce((sum, line) => {
      const qty = Number(line?.qty) || 0
      const price = Number(line?.unitPriceMinor) || 0
      const discount = Number(line?.discountPercent) || 0
      return sum + Math.round(qty * price * (1 - discount / 100))
    }, 0)
    return { partyLabel, lineCount: lines.length, totalMinor }
  } catch {
    return { partyLabel, lineCount: 0, totalMinor: 0 }
  }
}
