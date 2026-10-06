import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { OverlayPortal } from './ui.tsx'
import { useDataStore } from '../../data/repo.ts'
import { userPrefsKey } from '../../core/userPreferences.ts'
import {
  SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, resolveShortcuts, shortcutConflicts, shortcutActionFor, freeShortcutKeys,
  isFunctionKey, type ShortcutActionId, type ShortcutMap, type ShortcutOverrides,
} from '../../core/keyboardShortcuts.ts'

const selector = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'
const rowFieldSelector = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && element.getAttribute('aria-hidden') !== 'true'
}

/**
 * يختار زر اختصار واحداً فقط:
 * - تكرار الزر نفسه أعلى/أسفل النموذج مقبول (نفس النص = نفس العملية).
 * - أزرار صفوف متعددة لا تُختار عشوائياً؛ يجب أن يكون التركيز داخل الصف.
 */
function selectShortcutButton(candidates: HTMLButtonElement[]): HTMLButtonElement | null {
  if (!candidates.length) return null
  const active = document.activeElement as HTMLElement | null
  const activeRow = active?.closest('tr,[data-entry-row]')
  if (activeRow) {
    const rowCandidates = candidates.filter((candidate) => activeRow.contains(candidate))
    const globalCandidates = candidates.filter((candidate) => !candidate.closest('tr,[data-entry-row]'))
    // A global invoice action (for example «ترحيل») must still win while the
    // cursor is inside a line row. Restrict to the row only when there is no
    // global action available; this prevents F9 from requiring a blank area.
    candidates = globalCandidates.length ? globalCandidates : rowCandidates
    if (!candidates.length) return null
  } else if (candidates.some((candidate) => candidate.closest('tr,[data-entry-row]'))) {
    return null
  }
  const unique = new Map<string, HTMLButtonElement>()
  for (const candidate of candidates) {
    const label = (candidate.textContent ?? '').replace(/F[0-9]+/g, '').replace(/\s+/g, ' ').trim()
    const key = candidate.dataset.shortcutAction ?? label
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return unique.size === 1 ? unique.values().next().value ?? null : null
}

/** تحكم شامل بلا ماوس: Enter للحقل التالي، Shift+Enter للسابق، وأزرار الوظائف حسب خريطة المستخدم. */
export function KeyboardNavigation() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [helpOpen, setHelpOpen] = useState(false)
  /* خريطة اختصارات المستخدم (طلب المالك): تفضيل منفصل لكل مستخدم — الافتراضي +
     تجاوزاته المحفوظة. F7 يظل مكرراً لبحث الطرف ما لم يُعيّنه المستخدم لغيره. */
  const savedOverrides = useDataStore((s) => s.userPrefs[userPrefsKey(s.currentUserId)]?.keyboardShortcuts)
  const shortcuts = useMemo(() => resolveShortcuts(savedOverrides), [savedOverrides])
  const updateMyPreferences = useDataStore((s) => s.updateMyPreferences)

  /* ══ شاشة التخصيص داخل دليل F12: مسودة + التقاط مفتاح + تبديل تلقائي عند التصادم ══ */
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<ShortcutMap>(DEFAULT_SHORTCUTS)
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null)
  const [note, setNote] = useState('')
  const conflicts = useMemo(() => shortcutConflicts(draft), [draft])
  const freeKeys = useMemo(() => freeShortcutKeys(draft), [draft])

  const openEditor = () => {
    setDraft(resolveShortcuts(savedOverrides))
    setEditMode(true)
    setCapturing(null)
    setNote('')
  }
  const closeEditor = () => { setEditMode(false); setCapturing(null); setNote('') }
  const saveEditor = () => {
    /* نحفظ الفروق عن الافتراضي فقط — فتُورَّث تحسينات الافتراضي مستقبلاً */
    const overrides: ShortcutOverrides = {}
    for (const def of SHORTCUT_ACTIONS) if (draft[def.id] !== def.defaultKey) overrides[def.id] = draft[def.id]
    updateMyPreferences({ keyboardShortcuts: overrides })
    setEditMode(false)
    setCapturing(null)
    setNote('')
  }
  const restoreDefaults = () => {
    setDraft({ ...DEFAULT_SHORTCUTS })
    setNote('أُعيدت الافتراضية — اضغط «حفظ» لتثبيتها')
  }

  /* التقاط: مفتاح وظيفة واحد يُلتقط قبل أي معالج آخر؛ التصادم يُبَدَّل تلقائياً */
  useEffect(() => {
    if (!capturing) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { setCapturing(null); setNote('أُلغي الالتقاط'); return }
      if (!isFunctionKey(event.key)) { setNote('مفاتيح الوظائف F1..F12 فقط — Esc للإلغاء'); return }
      const owner = SHORTCUT_ACTIONS.find((def) => def.id !== capturing && draft[def.id] === event.key)
      const displaced = draft[capturing]
      setDraft((current) => {
        const next = { ...current }
        if (owner) next[owner.id] = displaced
        next[capturing] = event.key as string
        return next
      })
      setNote(owner ? `تبديل: «${SHORTCUT_ACTIONS.find((def) => def.id === owner.id)!.labelAr}» انتقل إلى ${displaced}` : `سُجّل ${event.key as string}`)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, draft])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /* أثناء التخصيص: مفاتيح الوظائح كلها لشاشة الالتقاط — لا تنقل ولا تطبع،
         وتبقى Tab/Enter/الأحرف طبيعية للتنقل بين أزرار المحرر بالكيبورد */
      if (editMode && isFunctionKey(event.key)) { event.preventDefault(); event.stopPropagation(); return }
      /* فعل المفتاح من خريطة المستخدم؛ الغامض (مفتاح بفعلين) يُتجاهل بأمان */
      let action: ShortcutActionId | null = shortcutActionFor(shortcuts, event.key)
      /* توافق قديم: F7 كان مكرراً لبحث الطرف — يظل كذلك حتى يُعيَّنه المستخدم لغيره */
      if (!action && event.key === 'F7' && !Object.values(shortcuts).includes('F7')) action = 'partySearch'
      if (action === 'newInvoice') {
        event.preventDefault()
        // يفتح مستند فاتورة جديداً في **صفحة كاملة** (طلب المالك: لا نافذة منبثقة)
        navigate(pathname.startsWith('/purchases') ? '/purchases/invoices/new' : '/sales/invoices/new')
        return
      }
      if (action === 'partySearch') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:open-party')); return }
      if (action === 'itemSearch') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:open-item')); return }
      if ((action === 'saveDraft' || action === 'post') && !pathname.startsWith('/sales/pos')) {
        const words = action === 'saveDraft'
          ? ['حفظ مسودة', 'حفظ كمسودة']
          : ['اعتماد', 'ترحيل', 'دفع', 'تحصيل', 'صرف', 'تسليم', 'تسجيل', 'حفظ', 'إنشاء', 'إقفال', 'تنفيذ', 'تأكيد وطباعة', 'حفظ وترحيل', 'حفظ واعتماد']
        // The modal is portaled after the page. Limit shortcut lookup to the topmost
        // open dialog so a background page action cannot win while a form is open.
        const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((dialog) => visible(dialog))
        const shortcutScope: ParentNode = dialogs.at(-1) ?? document
        const candidates = [...shortcutScope.querySelectorAll<HTMLButtonElement>('button')].filter((candidate) => visible(candidate))
        const markedCandidates = candidates.filter((candidate) => candidate.dataset.shortcut === event.key)
        const actionCandidates = markedCandidates.length > 0 ? markedCandidates : candidates.filter((candidate) => {
          const text = candidate.textContent ?? ''
          return action === 'post'
            ? (text.includes(event.key) || words.some((word) => text.includes(word))) && !text.includes('مسودة')
            : words.some((word) => text.includes(word))
        })
        const button = selectShortcutButton(actionCandidates)
        if (button) { event.preventDefault(); button.click() }
        return
      }
      if (action === 'print') {
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => visible(candidate) && (candidate.textContent?.includes('طباعة') || candidate.dataset.shortcut === event.key))
        if (button) { event.preventDefault(); button.click() } return
      }
      if (action === 'discount') {
        const discount = [...document.querySelectorAll<HTMLInputElement>('input')].find((candidate) => visible(candidate) && ((candidate.placeholder ?? '').includes('خصم') || (candidate.getAttribute('aria-label') ?? '').includes('خصم')))
        if (discount) { event.preventDefault(); discount.focus(); discount.select() } return
      }
      if (action === 'fullscreen') { event.preventDefault(); if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); return }
      if (action === 'help') { event.preventDefault(); setHelpOpen((open) => !open); if (helpOpen) closeEditor(); return }
      const target = event.target as HTMLElement | null
      /* تحصين: أحداث اصطناعية قد تجعل الهدف document/window (بلا closest) */
      if (!target || event.defaultPrevented || typeof (target as Element).closest !== 'function') return
      if (action === 'quickSearch') {
        event.preventDefault()
        const scope = target.closest('[role="dialog"], main') ?? document.body
        const search = [...scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[placeholder*="بحث"],input[placeholder*="ابحث"]')].find(visible)
        search?.focus(); search?.select()
        return
      }
      const isGridArrow = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      if (isGridArrow && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.hasAttribute('tabindex')) && !target.closest('[data-arrows-native="true"],[data-enter-native="true"]')) {
        const row = target.closest('tr,[data-entry-row]')
        const parent = row?.parentElement
        if (row && parent) {
          const rows = [...parent.querySelectorAll<HTMLElement>(':scope > tr,:scope > [data-entry-row]')]
          const rowIndex = rows.indexOf(row as HTMLElement)
          const rowControls = [...row.querySelectorAll<HTMLElement>(rowFieldSelector)].filter(visible)
          const column = rowControls.indexOf(target)
          const rowStep = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowLeft' ? 1 : -1
          const destination = event.key === 'ArrowDown' || event.key === 'ArrowUp' ? rows[rowIndex + rowStep] : row
          const nextControls = destination ? [...destination.querySelectorAll<HTMLElement>(rowFieldSelector)].filter(visible) : []
          const next = destination === row ? nextControls[column + rowStep] : nextControls[column]
          // In invoice grids arrows are navigation keys, never number-spinner keys.
          event.preventDefault()
          if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select() }
          return
        }
      }
      if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey) return
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target.closest('[data-enter-native="true"]')) return
      const scope = target.closest('[role="dialog"], form, main') ?? document.body
      const controls = [...scope.querySelectorAll<HTMLElement>(selector)].filter(visible)
      const index = controls.indexOf(target)
      if (index < 0) return
      const next = controls[index + (event.shiftKey ? -1 : 1)]
      if (!next) return
      event.preventDefault()
      next.focus()
      if (next instanceof HTMLInputElement && next.type !== 'checkbox' && next.type !== 'radio') next.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, pathname, shortcuts, editMode, helpOpen])

  return helpOpen ? <OverlayPortal><div className="layer-approval pointer-events-none fixed inset-0 flex items-center justify-center p-4" onMouseDown={(event) => event.stopPropagation()} data-shortcut-help>
    <div role="dialog" className="pointer-events-auto w-full max-w-lg rounded-2xl border bg-white dark:bg-card-dark p-5" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex justify-between items-center">
        <h2 className="font-black text-lg">اختصارات لوحة المفاتيح</h2>
        <div className="flex gap-2">
          {!editMode && <button onClick={openEditor} data-shortcut-edit className="px-2 py-1 rounded-lg text-[11px] font-bold text-brand-600 bg-brand-500/10 hover:bg-brand-500/20">✎ تخصيص</button>}
          <button onClick={() => { setHelpOpen(false); closeEditor() }}>Esc</button>
        </div>
      </div>
      {!editMode ? (
        <>
          <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
            {SHORTCUT_ACTIONS.map((def) => (
              <div key={def.id} className="flex items-center gap-2 rounded-lg bg-slate-500/10 p-2" data-shortcut-row={def.id}>
                <kbd className="font-mono font-black text-brand-600" data-shortcut-key={def.id}>{shortcuts[def.id]}</kbd>
                <span title={def.hintAr}>{def.labelAr}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
            الاختصارات مخصصة لكل مستخدم على حدة — اضغط «تخصيص» لإعادة ترتيبها.
            {Object.values(shortcuts).includes('F7') ? '' : ' F7 يعمل كبحث طرف (مكرر تاريخي) ما لم تُعيّنه لغيره.'}
          </p>
        </>
      ) : (
        <div className="mt-4 space-y-2" data-shortcut-editor>
          <p className="text-[11.5px] text-slate-500 leading-relaxed">
            اضغط زر المفتاح بجانب الوظيفة ثم اضغط مفتاح وظيفة جديداً (F1..F12).
            إن كان المفتاح مستخدماً تُبدَّل الوظيفتان تلقائياً.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm max-h-[46vh] overflow-y-auto pl-1">
            {SHORTCUT_ACTIONS.map((def) => (
              <div key={def.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-500/10 p-2" data-shortcut-row={def.id}>
                <span title={def.hintAr}>{def.labelAr}</span>
                <button
                  onClick={() => { setCapturing(def.id); setNote('') }}
                  data-shortcut-capture={def.id}
                  className={`min-w-14 rounded-md px-2 py-1 font-mono font-black text-[12px] border-2 transition-all ${capturing === def.id ? 'border-brand-500 bg-brand-500/10 text-brand-600 animate-pulse' : 'border-slate-300 dark:border-slate-600 hover:border-brand-400'}`}
                >
                  {capturing === def.id ? 'اضغط…' : draft[def.id]}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">مفاتيح حرة: {freeKeys.length ? freeKeys.join('، ') : 'لا شيء — كل المفاتيح مسندة'}</p>
          {note && <p className="text-[11px] font-bold text-brand-600" data-shortcut-note>{note}</p>}
          {conflicts.length > 0 && <p className="text-[11px] font-bold text-rose-500" data-shortcut-conflict>تعارض: {conflicts.map((c) => `${c.key} (${c.actions.length})`).join('، ')} — صحّح قبل الحفظ</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={saveEditor} disabled={conflicts.length > 0} data-shortcut-save className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white bg-gradient-to-l from-brand-600 to-fuchsia-600 disabled:opacity-40">حفظ</button>
            <button onClick={restoreDefaults} data-shortcut-restore className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-500 bg-slate-500/10 hover:bg-slate-500/20">استعادة الافتراضي</button>
            <button onClick={closeEditor} data-shortcut-cancel className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-400 hover:bg-slate-500/10">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  </div></OverlayPortal> : null
}
