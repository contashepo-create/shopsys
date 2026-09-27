import type { AdvancedInvoiceDraft } from '../../data/repo.ts'

/** ملخّص يُقرأ من حمولة المسودة دون معرفة تفاصيل كل صفحة */
export interface DraftSummary {
  /** اسم العميل/المورد كما يظهر في عنوان المسودة */
  partyLabel: string
  lineCount: number
  totalMinor: number
}

/** يقرأ الحمولة المخزّنة ويستخرج منها ملخصاً آمناً (المسودة نصّ JSON قد يكون قديماً) */
export function summarizeDraft(draft: AdvancedInvoiceDraft): DraftSummary {
  const partyLabel = draft.name.includes('—') ? draft.name.split('—').slice(1).join('—').trim() : draft.name
  try {
    const payload = JSON.parse(draft.payload) as {
      lines?: { qty?: number; unitPriceMinor?: number; discountPercent?: number }[]
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
