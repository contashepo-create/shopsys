/**
 * مفاتيح الطباعة الثلاثة (طلب المالك) — أزرار بمظهر **مفتاح كهرباء**:
 * تُضغط للداخل عند التفعيل ويتغيّر لونها، وكلها مطفأة افتراضياً.
 *
 * ① طباعة مباشرة  : صامتة بلا مربع حوار ويندوز (مطفأة ⇒ يفتح الحوار).
 * ② طباعة كاشير   : إيصال حراري مباشر (مطفأة ⇒ فاتورة كبيرة A4).
 * ③ طباعة بعد الحفظ: تطبع تلقائياً فور الترحيل بالنمط الذي يحدده الزران.
 *
 * الحالة تُحفظ في إعدادات الطباعة فتبقى بين الفواتير والجلسات.
 */
import { Printer, ReceiptText, Zap } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useToast } from './ui.tsx'

export type PrintSwitchState = { silentPrint: boolean; cashierPrint: boolean; printAfterSave: boolean }

export function usePrintSwitches(): PrintSwitchState {
  const receipt = useAppStore((s) => s.receipt)
  return {
    silentPrint: receipt.silentPrint ?? false,
    cashierPrint: receipt.cashierPrint ?? false,
    printAfterSave: receipt.printAfterSave ?? false,
  }
}

export function PrintSwitches({ compact = false }: { compact?: boolean }) {
  const receipt = useAppStore((s) => s.receipt)
  const updateReceipt = useAppStore((s) => s.updateReceipt)
  const toast = useToast()

  const rows: { key: keyof PrintSwitchState; label: string; icon: typeof Printer; on: string; off: string }[] = [
    { key: 'silentPrint', label: 'طباعة مباشرة', icon: Zap,
      on: 'الطباعة صامتة — بلا مربع حوار ويندوز', off: 'يفتح مربع حوار الطباعة قبل الطبع' },
    { key: 'cashierPrint', label: 'طباعة كاشير', icon: ReceiptText,
      on: 'إيصال حراري مباشر', off: 'فاتورة كبيرة (A4)' },
    { key: 'printAfterSave', label: 'طباعة بعد الحفظ', icon: Printer,
      on: 'تُطبع الفاتورة تلقائياً فور الترحيل', off: 'لا طباعة تلقائية بعد الترحيل' },
  ]

  return (
    <span className={`print-switches${compact ? ' is-compact' : ''}`} data-print-switches>
      {rows.map((row) => {
        const active = (receipt[row.key] ?? false) as boolean
        const Icon = row.icon
        return (
          <button
            key={row.key}
            type="button"
            className={`print-switch${active ? ' is-on' : ''}`}
            aria-pressed={active}
            data-print-switch={row.key}
            title={`${row.label}: ${active ? row.on : row.off}`}
            onClick={() => {
              updateReceipt({ [row.key]: !active } as Partial<typeof receipt>)
              toast.show(`${row.label}: ${!active ? row.on : row.off}`)
            }}
          >
            <Icon size={11} />
            <span>{row.label}</span>
            <i className="print-switch-led" aria-hidden="true" />
          </button>
        )
      })}
    </span>
  )
}
