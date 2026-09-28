import { useState } from 'react'
import { NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { partyNotesFor, formatPartyNoteStamp, type PartyNoteKind } from '../../core/partyNotes.ts'
import { Btn, useToast } from './ui.tsx'

/**
 * سجل ملاحظات الطرف (طلب المالك)
 * ─────────────────────────────
 * تاريخ ملاحظات العميل/المورد: كل ملاحظة كُتبت في ترويسة فاتورة أو هنا مباشرة،
 * بتاريخها وكاتبها ورقم المستند مصدرها. يظهر في صفحة الطرف (كشف الحساب) وفي
 * بروفايله داخل سجل العملاء/الموردين.
 */
export function PartyNotesLog({ kind, partyId, partyName, compact = false }: {
  kind: PartyNoteKind
  partyId: number
  partyName: string
  /** داخل نافذة البروفايل: ارتفاع أقصر وعنوان أصغر */
  compact?: boolean
}) {
  const { partyNotes, addPartyNote, updatePartyNote, deletePartyNote, appUsers, currentUserId } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  /* تعديل ملاحظة قائمة داخل السجل نفسه (طلب المالك: تتبّع · تعديل · حذف) */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const notes = partyNotesFor(partyNotes, kind, partyId)
  const author = appUsers.find((user) => user.id === currentUserId)?.nameAr ?? setup.ownerName ?? 'المالك'
  const partyWord = kind === 'customer' ? 'العميل' : 'المورد'

  const add = () => {
    try {
      addPartyNote({ partyKind: kind, partyId, text: draft, userName: author, source: `بطاقة ${partyWord}` })
      setDraft('')
      toast.show('أُضيفت الملاحظة إلى سجل الملاحظات ✓')
    } catch (error) {
      toast.show((error as Error).message, 'error')
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark p-3 space-y-2" data-party-notes-log={kind}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={`font-extrabold flex items-center gap-1.5 text-slate-700 dark:text-slate-200 ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
          <NotebookPen size={15} /> سجل الملاحظات — {partyName}
        </h3>
        <span className="text-[11px] font-bold text-slate-400">{notes.length} ملاحظة</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim()) { event.preventDefault(); add() } }}
          placeholder={`اكتب ملاحظة عن ${partyName} — تُحفظ بتاريخها واسم كاتبها`}
          aria-label={`ملاحظة جديدة عن ${partyWord}`}
          className="flex-1 min-w-0 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 text-[12px] font-semibold outline-none focus:border-indigo-400"
        />
        <Btn variant="ghost" onClick={add} disabled={!draft.trim()}>إضافة</Btn>
      </div>

      {notes.length === 0 ? (
        <p className="text-[11.5px] font-semibold text-slate-400 py-1">لا ملاحظات مسجَّلة على {partyWord} بعد — كل ملاحظة تُكتب في ترويسة الفاتورة تظهر هنا.</p>
      ) : (
        <ul className={`space-y-1.5 overflow-auto ${compact ? 'max-h-40' : 'max-h-64'}`}>
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/40 px-2.5 py-1.5 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {editingId === note.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && editText.trim()) { event.preventDefault(); updatePartyNote(note.id, editText, author); setEditingId(null); toast.show('عُدّلت الملاحظة ✓') }
                        if (event.key === 'Escape') { event.preventDefault(); setEditingId(null) }
                      }}
                      aria-label="تعديل نص الملاحظة"
                      className="flex-1 min-w-0 h-8 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-transparent px-2 text-[12px] font-semibold outline-none"
                    />
                    <Btn variant="ghost" onClick={() => { if (!editText.trim()) return; updatePartyNote(note.id, editText, author); setEditingId(null); toast.show('عُدّلت الملاحظة ✓') }}>حفظ</Btn>
                    <Btn variant="ghost" onClick={() => setEditingId(null)}>إلغاء</Btn>
                  </div>
                ) : (
                  <p className="text-[12px] font-bold text-slate-700 dark:text-slate-200 break-words">{note.text}</p>
                )}
                <p className="text-[10.5px] font-semibold text-slate-400 mt-0.5">
                  {formatPartyNoteStamp(note.at)} · {note.userName}{note.source ? ` · ${note.source}` : ''}{note.editedAt ? ` · عُدّلت ${formatPartyNoteStamp(note.editedAt)}${note.editedBy ? ` بواسطة ${note.editedBy}` : ''}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditingId(note.id); setEditText(note.text) }}
                aria-label={`تعديل ملاحظة ${formatPartyNoteStamp(note.at)}`}
                title="تعديل الملاحظة"
                className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-600"
              ><Pencil size={13} /></button>
              <button
                type="button"
                onClick={() => deletePartyNote(note.id)}
                title="حذف الملاحظة من السجل"
                aria-label="حذف الملاحظة من السجل"
                className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
