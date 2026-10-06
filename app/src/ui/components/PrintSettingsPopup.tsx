/**
 * نافذة «إعدادات الطباعة» المنبثقة من الفاتورة (طلب المالك 2026-10-01):
 * زر ⚙ بجوار زر الطباعة في شريط الفاتورة يفتح نافذة صغيرة بالإعدادات
 * **السريعة** (ورق/لون/تذييل/مفاتيح إظهار/نمط A4/حجم الخط) — أي تغيير
 * ينعكس فوراً على المعاينة الحية إن كانت مفتوحة. ومن أراد الإعدادات
 * **المتقدمة** فزر «المزيد من إعدادات الطباعة…» ينقله لقسم الطباعة كاملاً.
 */
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings2 } from 'lucide-react'
import { Modal } from './ui.tsx'
import { QuickPrintSettings } from './QuickPrintSettings.tsx'

export function PrintSettingsPopup({ open, onClose, wide = false }: { open: boolean; onClose: () => void; wide?: boolean }) {
  const nav = useNavigate()
  return (
    <Modal open={open} onClose={onClose} title="إعدادات الطباعة السريعة">
      <div dir="rtl" data-print-settings-popup className="space-y-3">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          <Settings2 size={12} className="inline" /> تغييرات فورية — تنعكس على المعاينة الحية إن كانت مفتوحة، وعلى كل فاتورة تُطبع بعدها.
        </p>
        <QuickPrintSettings wide={wide} />
        <button
          type="button"
          className="thermal-preview-quick-extra w-full"
          data-print-settings-more
          onClick={() => { onClose(); nav('/settings/printing') }}
        >
          <ArrowLeft size={12} /> المزيد من إعدادات الطباعة — القوالب والشعار والهوية كاملة
        </button>
      </div>
    </Modal>
  )
}
