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
        <label className="block text-[11px] font-bold text-slate-500">
          القالب
          <select value={active} onChange={(e) => setChosen(e.target.value as InvoiceTemplate)} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-card-dark text-xs font-bold">
            {INVOICE_TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.sub}</option>)}
          </select>
        </label>
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
