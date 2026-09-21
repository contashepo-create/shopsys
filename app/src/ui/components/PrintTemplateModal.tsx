/**
 * مودال اختيار قالب الطباعة (تعميم شريط الكاشير — طلب المالك):
 * حراري / A4 / A5 لحظة الطباعة، افتراضيه قالب إعدادات الطباعة الدائمة،
 * والاختيار للجلسة فقط — لا يغيّر الإعدادات الدائمة.
 */
import { useState } from 'react'
import { Printer } from 'lucide-react'
import { INVOICE_TEMPLATE_OPTIONS, type InvoiceTemplate } from '../../core/receipt.ts'
import { Modal, Btn } from './ui.tsx'

export function PrintTemplateModal(props: {
  open: boolean
  onClose: () => void
  /** قالب البداية — عادة receipt.defaultTemplate */
  defaultTemplate: InvoiceTemplate
  title?: string
  onPrint: (template: InvoiceTemplate) => void
}) {
  const [chosen, setChosen] = useState<InvoiceTemplate | null>(null)
  const active = chosen ?? props.defaultTemplate
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.title ?? '🖨️ اختر قالب الطباعة'}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {INVOICE_TEMPLATE_OPTIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => setChosen(t.id)}
              className={`p-3 rounded-2xl border-2 text-center transition-all hover:scale-[1.03] ${
                active === t.id
                  ? 'border-emerald-500/60 bg-emerald-500/10'
                  : 'border-slate-200 dark:border-slate-700 hover:border-emerald-400/40'
              }`}
            >
              <div className={`font-black text-[13px] ${active === t.id ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}`}>{t.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t.sub}</div>
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-slate-400">
          الاختيار لهذه الطبعة فقط — القالب الدائم يُضبط من «الإعدادات ← الطباعة والفواتير».
        </p>
        <Btn className="w-full" onClick={() => { props.onPrint(active); props.onClose() }}>
          <Printer size={15} /> طباعة الآن
        </Btn>
      </div>
    </Modal>
  )
}
