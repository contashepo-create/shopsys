import { useRef, useState } from 'react'
import { Download, Eye, FileText, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react'
import { useDataStore, type DocumentFile } from '../../data/repo.ts'
import { MAX_ATTACHMENT_BYTES, validateAttachment } from '../../core/prescription.ts'
import { attachmentSizeKb, fileToAttachmentDataUrl, type PendingAttachment } from '../attachmentFile.ts'
import { Btn, Modal, useToast } from './ui.tsx'

type Row = { id: string; name: string; mime: string; dataUrl: string; saved: boolean; addedAt?: string; addedBy?: string }

/**
 * خانة «المرفقات والمستندات» في لوحة ملاحظات الفاتورة (التصميم المرجعي).
 *
 * المرفق حقيقي لا شكلي: قبل الترحيل يُحفظ مع المسودة، وبعده يُخزَّن في
 * `documentFiles` مربوطاً برقم الفاتورة — ويُفتح من سجل الفواتير لاحقاً.
 */
export type { PendingAttachment }

export function DocumentAttachmentsBox({
  documentKind, documentId, pending, onPendingChange, addedBy,
}: {
  documentKind: 'sale' | 'purchase'
  /** رقم المستند المرحّل — null في المسودة فتُحفظ المرفقات مؤقتاً */
  documentId: number | null
  pending: PendingAttachment[]
  onPendingChange: (next: PendingAttachment[]) => void
  addedBy: string
}) {
  const { documentFiles, addDocumentFile, removeDocumentFile } = useDataStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const savedRows: Row[] = documentFiles
    .filter((file: DocumentFile) => file.documentKind === documentKind && documentId != null && file.documentId === documentId)
    .map((file: DocumentFile) => ({ id: `saved:${file.id}`, name: file.name, mime: file.mime, dataUrl: file.dataUrl, saved: true, addedAt: file.addedAt, addedBy: file.addedBy }))
  const pendingRows: Row[] = pending.map((row) => ({ id: `pending:${row.key}`, name: row.name, mime: row.mime, dataUrl: row.dataUrl, saved: false }))
  const rows = [...savedRows, ...pendingRows]
  const totalKb = rows.reduce((sum, row) => sum + attachmentSizeKb(row.dataUrl), 0)

  const pick = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await fileToAttachmentDataUrl(file)
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'مستند'
      const mime = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg'
      const errors = validateAttachment({ name, mime, dataUrl })
      if (errors.length) throw new Error(errors.join(' — '))
      if (documentId != null) {
        addDocumentFile({ documentKind, documentId, name, mime, dataUrl, addedBy })
        toast.show(`أُرفق «${name}» بالمستند ✅`)
      } else {
        onPendingChange([...pending, { key: crypto.randomUUID(), name, mime, dataUrl }])
        toast.show(`أُضيف «${name}» — يُحفظ مع الفاتورة عند الترحيل ✅`)
      }
    } catch (error) { toast.show((error as Error).message, 'error') }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const drop = (row: Row) => {
    if (row.saved) removeDocumentFile(Number(row.id.replace('saved:', '')))
    else onPendingChange(pending.filter((item) => `pending:${item.key}` !== row.id))
    if (preview?.id === row.id) setPreview(null)
    toast.show('حُذف المرفق')
  }

  return (
    <>
      <button
        type="button"
        className="invoice-doc-attachbtn"
        data-invoice-attachments
        onClick={() => setOpen(true)}
        title="إرفاق أمر شراء العميل أو بوليصة الشحن أو إيصال التحويل البنكي"
      >
        <Paperclip size={11} /> المرفقات والمستندات ({rows.length})
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="📎 مرفقات المستند" subtitle={documentId != null ? 'تُحفظ فوراً مع الفاتورة المرحّلة' : 'تُحفظ مع المسودة وتُربط بالفاتورة عند الترحيل'} wide>
        <div className="space-y-3">
          <div className="invoice-doc-attachdrop">
            <Upload size={16} />
            <div>
              <b>أضف صورة أو ملف PDF</b>
              <small>أمر شراء العميل · بوليصة الشحن · إيصال تحويل بنكي · عقد موقَّع — الحد {(MAX_ATTACHMENT_BYTES / 1_048_576).toFixed(1)} م.ب للملف، والصور تُضغط تلقائياً.</small>
            </div>
            <Btn variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'جارٍ المعالجة…' : 'اختيار ملف'}</Btn>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(event) => { void pick(event.target.files?.[0] ?? null) }} />
          </div>

          {rows.length === 0
            ? <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700">لا مرفقات بعد — المستند يُرحَّل بلا مرفق بلا مشكلة.</div>
            : <ul className="invoice-doc-attachlist">
              {rows.map((row) => (
                <li key={row.id}>
                  <span className="invoice-doc-attachicon">{row.mime === 'application/pdf' ? <FileText size={13} /> : <ImageIcon size={13} />}</span>
                  <div className="min-w-0">
                    <b>{row.name}</b>
                    <small>{row.mime === 'application/pdf' ? 'PDF' : 'صورة'} · {attachmentSizeKb(row.dataUrl)} ك.ب · {row.saved ? `محفوظ${row.addedBy ? ` — ${row.addedBy}` : ''}` : 'مع المسودة'}</small>
                  </div>
                  <button type="button" title="عرض" aria-label={`عرض ${row.name}`} onClick={() => setPreview(row)}><Eye size={12} /></button>
                  <a href={row.dataUrl} download={`${row.name}.${row.mime === 'application/pdf' ? 'pdf' : 'jpg'}`} title="تنزيل" aria-label={`تنزيل ${row.name}`}><Download size={12} /></a>
                  <button type="button" className="is-danger" title="حذف" aria-label={`حذف ${row.name}`} onClick={() => drop(row)}><Trash2 size={12} /></button>
                </li>
              ))}
            </ul>}

          <div className="invoice-doc-attachfoot">
            <span>{rows.length} مرفقاً · {totalKb} ك.ب</span>
            <span>الترميز UTF-8 · العربية</span>
          </div>
        </div>
      </Modal>

      <Modal open={preview != null} onClose={() => setPreview(null)} title={preview ? `📄 ${preview.name}` : ''} wide>
        {preview && (preview.mime === 'application/pdf'
          ? <iframe title={preview.name} src={preview.dataUrl} className="h-[65vh] w-full rounded-xl border border-slate-200 dark:border-slate-700" />
          : <img src={preview.dataUrl} alt={preview.name} className="max-h-[65vh] w-full rounded-xl object-contain" />)}
      </Modal>
    </>
  )
}
