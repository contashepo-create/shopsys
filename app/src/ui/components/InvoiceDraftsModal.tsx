import { useMemo, useState } from 'react'
import { FileClock, FolderOpen, Trash2, UserRound } from 'lucide-react'
import type { AdvancedInvoiceDraft } from '../../data/repo.ts'
import { summarizeDraft } from './draftSummary.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import { Modal, Btn } from './ui.tsx'

const when = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toLocaleDateString('ar-EG')} · ${date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * متصفّح المسودات (طلب المالك: «زر لمعاينة المسودات كلها واختيار المسودة، واكتبها باسم العميل»).
 *
 * كان الاستعادة تأخذ **آخر** مسودة بلا اختيار، فإن كان لديك ثلاث فواتير معلّقة
 * لثلاثة عملاء فلا سبيل للوصول إلى الأولى. هنا تُعرض كل المسودات باسم الطرف
 * وعدد البنود وقيمتها ووقت آخر حفظ، وتُفتح أو تُحذف بضغطة.
 */
export function InvoiceDraftsModal({
  open, onClose, kind, drafts, currency, currentDraftId, onPick, onDelete, templatesOnly = false,
}: {
  open: boolean
  onClose: () => void
  kind: 'sale' | 'purchase'
  drafts: AdvancedInvoiceDraft[]
  currency: CurrencyConfig
  currentDraftId?: string
  onPick: (draft: AdvancedInvoiceDraft) => void
  onDelete: (id: string) => void
  /** وضع القوالب: يعرض القوالب المحفوظة فقط (سلال متكررة) */
  templatesOnly?: boolean
}) {
  const [query, setQuery] = useState('')
  const partyWord = kind === 'sale' ? 'العميل' : 'المورد'
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return drafts
      .filter((draft) => draft.kind === kind)
      .filter((draft) => (templatesOnly ? draft.isTemplate === true : draft.isTemplate !== true))
      .filter((draft) => !needle || draft.name.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [drafts, kind, query, templatesOnly])

  return (
    <Modal open={open} onClose={onClose} title={templatesOnly ? `قوالب ${kind === 'sale' ? 'المبيعات' : 'المشتريات'} الجاهزة` : `مسودات ${kind === 'sale' ? 'المبيعات' : 'المشتريات'} المحفوظة`} wide>
      <div className="space-y-3" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] leading-6 text-slate-500 dark:text-slate-400">
            المسودة محفوظة محلياً باسم {partyWord} — لا تمسّ المخزون ولا الحسابات حتى تُرحَّل. اختر مسودة لفتحها مكان الفاتورة الحالية.
          </p>
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 sm:w-56"
            placeholder={`ابحث باسم ${partyWord}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="بحث في المسودات"
          />
        </div>

        {!rows.length && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-900/30">
            <FileClock className="mx-auto mb-2 text-slate-400" size={26} />
            <div className="font-black text-slate-700 dark:text-slate-200">لا توجد مسودات محفوظة</div>
            <div className="mt-1 text-xs text-slate-500">احفظ الفاتورة الحالية بزر «حفظ مسودة» (F8) لتجدها هنا باسم {partyWord}.</div>
          </div>
        )}

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pl-1">
          {rows.map((draft) => {
            const summary = summarizeDraft(draft)
            const isCurrent = draft.id === currentDraftId
            return (
              <div
                key={draft.id}
                data-draft-row={draft.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-2.5 transition-colors ${isCurrent ? 'border-brand-400 bg-brand-500/5' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <UserRound size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-black text-slate-800 dark:text-slate-100" title={summary.partyLabel}>
                    {summary.partyLabel}
                    {isCurrent && <span className="mr-2 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-300">المفتوحة الآن</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>{summary.lineCount} بنداً</span>
                    <span dir="ltr" className="font-mono">{formatMinor(summary.totalMinor, currency, false)} {currency.symbol}</span>
                    <span>آخر حفظ: {when(draft.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Btn variant="soft" className="!px-3 !py-1.5 !text-xs" onClick={() => { onPick(draft); onClose() }}>
                    <FolderOpen size={14} /> فتح
                  </Btn>
                  <button
                    type="button"
                    title="حذف المسودة نهائياً"
                    aria-label={`حذف مسودة ${summary.partyLabel}`}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                    onClick={() => onDelete(draft.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
          <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
        </div>
      </div>
    </Modal>
  )
}
