import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Download, FilePlus2, FileText, Pencil, Plus, Printer, Save, Settings2, Trash2 } from 'lucide-react'
import { getEffectiveActiveBranch, useDataStore, useRawDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { withInvoiceCommitLock } from '../../data/invoiceCommitLock.ts'
import { LETTER_FIELDS, emptyLetterRecipientDetails, letterFieldStyle, letterFilename, newLetterParagraph, validLetterImage, validateLetter, type Letter, type LetterField, type LetterParagraph, type LetterTextStyle } from '../../core/letters.ts'
import { applyCompleteLetterTemplate, captureLetterTemplate, createLetterLayout, defaultLetterBoxes, getLetterBoxes, LETTER_COMPANY_DETAIL_KEYS, LETTER_RECIPIENT_DETAIL_KEYS, isFixedLetterBox, isLetterItemVisible, letterBoxLabel, letterHeaderKeys, letterLayoutItems, letterParagraphKey, LETTER_TEMPLATES, type LetterBox, type LetterTemplate } from '../../core/letterLayout.ts'
import { arrangeHeaderRows, letterColumnGap, letterRowSpacing, setLetterColumnGap } from '../../core/letterHeaderSpacing.ts'
import { LETTER_BACKGROUNDS, readLetterBackgroundFile } from '../../core/letterBackgrounds.ts'
import { distributeLetterText } from '../../core/letterPagination.ts'
import { LetterCanvas } from './LetterCanvas.tsx'
import { LetterSignaturePad } from './LetterSignaturePad.tsx'
import { inspectLetterCanvas, measureLetterHeaderBottom, type LetterCanvasIssue } from './letterCanvasInspection.ts'
import { todayLocalIso } from '../../core/time.ts'
import { printHtml } from '../print/printReceipt.ts'
import { useToast, useUnsavedChangesGuard } from '../components/ui.tsx'
import './letters.css'

const paragraphPresets: Record<string, string> = {
  blank: '', official: 'نود إحاطتكم علماً بأن ...\n\nنأمل منكم التكرم باتخاذ ما يلزم، شاكرين لكم تعاونكم.',
  request: 'نتقدم إليكم بطلب ...\n\nراجين منكم التكرم بالنظر في طلبنا، ولكم جزيل الشكر.',
  certificate: 'نفيدكم نحن بأن السيد / السيدة ...\n\nوقد أُعطي هذا الخطاب بناءً على طلبه لتقديمه إلى من يهمه الأمر.',
}
const safeLogo = (logo: string) => /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length < 2_000_000 ? logo : ''
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function textStyle(style: LetterTextStyle, font: Letter['font']): React.CSSProperties {
  return { textAlign: style.align, fontSize: `${style.size}pt`, color: style.color, fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', fontFamily: `${style.font ?? font}, LetterArabic, sans-serif`, overflowWrap: 'anywhere' }
}
function Sheet({ letter, sheetRef }: { letter: Letter; sheetRef: React.RefObject<HTMLDivElement | null> }) {
  const { identity } = letter
  const details = letter.recipientDetails
  const fields: [LetterField, string][] = [
    ['recipientAddress', details?.address ? `العنوان: ${details.address}` : ''], ['recipientPhone', details?.phone ? `الهاتف: ${details.phone}` : ''],
    ['recipientEmail', details?.email ? `البريد: ${details.email}` : ''], ['recipientTaxNumber', details?.taxNumber ? `الرقم الضريبي: ${details.taxNumber}` : ''],
    ['recipientCommercialReg', details?.commercialReg ? `السجل التجاري: ${details.commercialReg}` : ''], ['recipientNationalId', details?.nationalId ? `الهوية: ${details.nationalId}` : ''],
    ['recipientContactPerson', details?.contactPerson ? `مسؤول التواصل: ${details.contactPerson}` : ''], ['recipientContactRole', details?.contactRole ? `صفة مسؤول التواصل: ${details.contactRole}` : ''],
    ['recipientContactPhone', details?.contactPhone ? `هاتف مسؤول التواصل: ${details.contactPhone}` : ''], ['recipientContactEmail', details?.contactEmail ? `بريد مسؤول التواصل: ${details.contactEmail}` : ''],
  ]
  const footer: [LetterField, string][] = [
    ['identityAddress', identity.address], ['identityPhone', identity.phone], ['identityEmail', identity.email], ['identityPoBox', identity.poBox ? `ص.ب: ${identity.poBox}` : ''], ['identityWebsite', identity.website],
    ['identityCommercialRegister', identity.commercialRegister ? `سجل تجاري: ${identity.commercialRegister}` : ''], ['identityTaxNumber', identity.taxNumber ? `الرقم الضريبي: ${identity.taxNumber}` : ''],
  ]
  const field = (key: LetterField, text: string, margin = '0 0 8px') => <div data-letter-field={key} style={{ ...textStyle(letterFieldStyle(letter, key), letter.font), margin, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{text}</div>
  return <div ref={sheetRef} className="letters-sheet" dir="rtl" style={{ fontFamily: `${letter.font}, LetterArabic, sans-serif` }}>
    <header className="letters-sheet-header" style={{ borderColor: letter.accent }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: letter.accent, fontSize: 10, fontWeight: 700, marginBottom: 6 }}>مراسلات رسمية</div>{field('identityName', identity.name)}</div>
      {safeLogo(identity.logo) && <img className="letters-sheet-logo" src={safeLogo(identity.logo)} alt="شعار المنشأة" />}
    </header>
    <main className="letters-sheet-body">
      {field('reference', `الرقم: ${letter.reference || '................'}`)}
      {field('date', `التاريخ: ${letter.date}`, '0 0 24px')}
      {field('recipient', `إلى السادة / ${letter.recipient || '................................'}`)}
      {fields.filter(([, value]) => value).map(([key, value]) => <div key={key}>{field(key, value)}</div>)}
      {field('subject', `الموضوع: ${letter.subject || 'موضوع الخطاب'}`, '18px 0 24px')}
      {field('salutation', letter.salutation, '0 0 18px')}
      {letter.paragraphs.map(p => <p key={p.id} className="letters-sheet-paragraph" style={textStyle(p, letter.font)}>{p.text || '\u00a0'}</p>)}
      {field('closing', letter.closing, '28px 0 38px')}
      {field('signer', `الاسم: ${letter.signer || '................................'}`)}
      {field('position', `المسمى الوظيفي: ${letter.position || '........................'}`)}
      {field('signature', letter.signatureText ?? 'التوقيع والختم: ........................')}
      {(validLetterImage(letter.signatureImage ?? '') || validLetterImage(letter.stampImage ?? '')) && <div className="letters-legacy-marks">{validLetterImage(letter.signatureImage ?? '') && <img src={letter.signatureImage} alt="صورة التوقيع" />}{validLetterImage(letter.stampImage ?? '') && <img src={letter.stampImage} alt="صورة الختم" />}</div>}
    </main>
    <footer className="letters-sheet-footer" style={{ borderColor: letter.accent }}>{footer.filter(([, value]) => value).map(([key, value]) => <div key={key}>{field(key, value, '0')}</div>)}</footer>
  </div>
}

const printStyles = `.letters-sheet{width:100%;min-height:260mm;box-sizing:border-box;background:#fff;padding:12mm 12mm 8mm;display:flex;flex-direction:column;}.letters-sheet-header{display:flex;justify-content:space-between;align-items:center;gap:20px;padding-bottom:20px;border-bottom:4px solid}.letters-sheet-title{font-size:26px;font-weight:800;margin:0}.letters-sheet-logo{max-width:100px;max-height:90px;object-fit:contain}.letters-sheet-body{flex:1;padding:25px 0 35px}.letters-sheet-footer{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;border-top:1px solid;padding-top:14px;font-size:11px;line-height:1.9;text-align:center;color:#64748b}.letters-legacy-marks{display:flex;gap:15px}.letters-legacy-marks img{max-width:150px;max-height:75px;object-fit:contain}.letters-sheet-paragraph{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin:0 0 14px}@page{size:A4;margin:10mm}body{margin:0}`

export function LettersPage() {
  const { letters, letterTemplates, customers } = useDataStore()
  const { setup, receipt, einvoice } = useAppStore()
  const toast = useToast()
  const [draft, setDraft] = useState<Letter | null>(null)
  const [basis, setBasis] = useState<string | null>(null)
  const [branchAtOpen, setBranchAtOpen] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [filterReference, setFilterReference] = useState('')
  const [headerBottom, setHeaderBottom] = useState<number | null>(null)
  const [layoutIssues, setLayoutIssues] = useState<(LetterCanvasIssue & { page: number })[]>([])
  const [layoutTarget, setLayoutTarget] = useState('reference')
  const [templateControlsOpen, setTemplateControlsOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [includeTemplateContent, setIncludeTemplateContent] = useState(true)
  const [saveAsDefault, setSaveAsDefault] = useState(true)
  const [signatureDrawing, setSignatureDrawing] = useState(false)
  const [formatTarget, setFormatTarget] = useState('paragraph')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [automaticNumber, setAutomaticNumber] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  useLayoutEffect(() => { draftRef.current = draft }, [draft])
  const paragraphRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  useEffect(() => { void document.fonts?.load('16px LetterArabic', 'العربية').catch(() => {}) }, [])
  useEffect(() => {
    const page = sheetRef.current
    if (!draft?.layout || !page) { setLayoutIssues([]); setHeaderBottom(null); return }
    const check = () => {
      const canvases = [...page.querySelectorAll<HTMLElement>('.letters-canvas')]
      setLayoutIssues(canvases.flatMap((canvas, index) => inspectLetterCanvas(canvas).map(issue => ({ ...issue, page: index + 1 }))))
      const linePage = getLetterBoxes(draft).topRule.page ?? 1
      const canvas = canvases.find(node => Number(node.dataset.letterPage) === linePage)
      const bottom = canvas ? measureLetterHeaderBottom(canvas) : null
      setHeaderBottom(bottom === null ? null : Math.round(bottom * 10) / 10)
    }
    check()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    observer?.observe(page)
    page.querySelectorAll('[data-letter-box]').forEach(node => observer?.observe(node))
    return () => observer?.disconnect()
  }, [draft])
  const unsaved = useUnsavedChangesGuard(dirty ? 'dirty' : 'clean', 'clean')
  const visible = useMemo(() => (letters ?? []).filter(letter =>
    (!filterCustomer || String(letter.customerId ?? '') === filterCustomer) &&
    letter.recipient.toLocaleLowerCase().includes(filterName.trim().toLocaleLowerCase()) &&
    letter.subject.toLocaleLowerCase().includes(filterSubject.trim().toLocaleLowerCase()) &&
    letter.reference.toLocaleLowerCase().includes(filterReference.trim().toLocaleLowerCase()),
  ).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [letters, filterCustomer, filterName, filterSubject, filterReference])
  const hasFilters = !!(filterCustomer || filterName || filterSubject || filterReference)
  const filterCustomers = useMemo(() => {
    const entries = new Map((customers ?? []).map(c => [c.id, c.nameAr]))
    for (const letter of letters ?? []) if (letter.customerId && !entries.has(letter.customerId)) entries.set(letter.customerId, `${letter.recipient} (من خطاب محفوظ)`)
    return [...entries].sort((a, b) => a[1].localeCompare(b[1], 'ar'))
  }, [customers, letters])
  const selected = draft?.paragraphs.find(p => p.id === selectedId) ?? draft?.paragraphs[0]
  const branchId = () => getEffectiveActiveBranch(useRawDataStore.getState())?.id ?? null
  const canLeave = () => !dirty || window.confirm('لديك تعديلات غير محفوظة. هل تريد إغلاقها؟')
  const patch = (values: Partial<Letter>) => { setDraft(current => current ? { ...current, ...values } : current); setDirty(true) }
  const selectedStyle = draft ? formatTarget === 'paragraph' ? selected : letterFieldStyle(draft, formatTarget as LetterField) : undefined
  const patchStyle = (values: Partial<LetterTextStyle>) => {
    if (!draft || !selectedStyle) return
    if (formatTarget === 'paragraph') { patchParagraph(values); return }
    const field = formatTarget as LetterField
    patch({ fieldStyles: { ...draft.fieldStyles, [field]: { ...selectedStyle, ...values } } })
  }
  const patchParagraph = (values: Partial<LetterParagraph>) => { if (!draft || !selected) return; patch({ paragraphs: draft.paragraphs.map(p => p.id === selected.id ? { ...p, ...values } : p) }) }
  const start = (existing?: Letter) => {
    if (!canLeave()) return
    if (!existing && (!useRawDataStore.persist.hasHydrated() || !useAppStore.persist.hasHydrated())) { toast.show('لا تزال البيانات تُحمّل — انتظر اكتمالها قبل إنشاء خطاب', 'error'); return }
    const now = new Date().toISOString(), p = newLetterParagraph(paragraphPresets.official)
    const today = todayLocalIso()
    let suggested = ''
    if (!existing) { try { suggested = useRawDataStore.getState().suggestLetterReference(today) } catch { /* الفرع أو التاريخ يراجعان عند الحفظ */ } }
    const value: Letter = existing ? structuredClone(existing) : {
      id: crypto.randomUUID(), subject: '', recipient: '', reference: suggested, date: today, salutation: 'السلام عليكم ورحمة الله وبركاته،', closing: 'وتفضلوا بقبول فائق الاحترام والتقدير،', signer: '', position: '',
      identity: { name: setup.shopName, logo: safeLogo(receipt.logoDataUrl), address: [setup.city, setup.street, setup.buildingNo, setup.postalCode].filter(Boolean).join('، '), phone: setup.phone, email: setup.email, poBox: setup.poBox ?? '', website: setup.website ?? '', commercialRegister: setup.commercialRegister ?? '', taxNumber: einvoice.taxNumber ?? '' },
      customerId: null, recipientDetails: emptyLetterRecipientDetails(),
      accent: '#1c6975', font: 'Arial', paragraphs: [p], createdAt: now, updatedAt: now,
    }
    if (!existing) {
      try {
        const selection = useRawDataStore.getState().getLetterDefaultTemplate()
        const chosen = selection.startsWith('saved:') ? (useRawDataStore.getState().letterTemplates ?? []).find(row => row.id === selection.slice(6)) : undefined
        if (selection.startsWith('saved:') && !chosen) throw new Error('القالب الافتراضي غير موجود — راجع القوالب المحفوظة')
        if (chosen) Object.assign(value, applyCompleteLetterTemplate(value, chosen))
        else value.layout = createLetterLayout(value, selection.slice(8) as LetterTemplate)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تحميل القالب الافتراضي'
        if (!message.startsWith('القالب الافتراضي المحفوظ غير متاح') || !window.confirm(`${message}. هل تريد فتح تصميم جاهز مؤقتاً لتغيير الاختيار؟ لن يُستبدل الافتراضي إلا إذا حفظت اختياراً آخر.`)) { toast.show(message, 'error'); return }
        value.layout = createLetterLayout(value, 'classic')
      }
    }
    setLayoutTarget('reference'); setTemplateControlsOpen(false); setTemplateName(''); setIncludeTemplateContent(true); setSaveAsDefault(true); setSignatureDrawing(false)
    setDraft(value); setBasis(existing ? JSON.stringify(existing) : null); setBranchAtOpen(branchId()); setSelectedId(value.paragraphs[0]?.id ?? ''); setFormatTarget('paragraph'); setAutomaticNumber(!existing); setDirty(false)
  }
  const selectBox = (key: string) => {
    if (draft && isFixedLetterBox(draft, key)) return
    setLayoutTarget(key)
    if (key.startsWith('paragraph:')) { setSelectedId(key.slice('paragraph:'.length)); setFormatTarget('paragraph') }
    else if (Object.hasOwn(LETTER_FIELDS, key)) setFormatTarget(key)
  }
  const selectIssueBox = (page: number, key: string) => {
    selectBox(key)
    const canvas = [...(sheetRef.current?.querySelectorAll<HTMLElement>('.letters-canvas') ?? [])].find(node => Number(node.dataset.letterPage) === page)
    const box = [...(canvas?.querySelectorAll<HTMLElement>('[data-letter-box]') ?? [])].find(node => node.dataset.letterBox === key)
    box?.focus()
  }
  const moveBox = (key: string, box: LetterBox) => {
    if (draft && isFixedLetterBox(draft, key)) return
    setDraft(current => current?.layout ? { ...current, layout: { ...current.layout, boxes: { ...current.layout.boxes, [key]: box } } } : current)
    setDirty(true)
  }
  const applyTemplate = (template: LetterTemplate) => {
    if (!draft || draft.layout?.template === template) return
    if (draft.layout && !window.confirm('تغيير القالب يعيد المواضع وتوزيع الصفحات لافتراضياته. هل تريد المتابعة؟')) return
    patch({ layout: createLetterLayout(draft, template) }); setLayoutTarget('reference'); setFormatTarget('paragraph')
  }
  const updateBackground = (background: NonNullable<NonNullable<Letter['layout']>['background']>) => {
    if (draft?.layout) patch({ layout: { ...draft.layout, background } })
  }
  const uploadBackground = async (file: File | undefined) => {
    if (!file || !draft?.layout) return
    const id = draft.id, previous = JSON.stringify(draft.layout.background)
    try {
      const data = await readLetterBackgroundFile(file)
      const current = draftRef.current
      if (!current?.layout || current.id !== id || JSON.stringify(current.layout.background) !== previous) { toast.show('تغير الخطاب أو الخلفية أثناء تحميل الصورة؛ أعد المحاولة', 'error'); return }
      setDraft({ ...current, layout: { ...current.layout, background: { source: 'custom', data, opacity: 55 } } })
      setDirty(true)
    } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر إضافة الصورة', 'error') }
  }
  const changeSavedTemplate = async (action: 'save' | 'update' | 'delete', id?: string) => {
    if (!draft?.layout || busy) return
    const saved = action !== 'save' ? (letterTemplates ?? []).find(row => row.id === id) : undefined
    if (action !== 'save' && !saved) return
    if (action === 'delete' && !window.confirm(`حذف القالب «${saved!.name}»؟ لا تتغير الخطابات التي استعملته.`)) return
    if (action === 'update' && !window.confirm(`تحديث القالب «${saved!.name}» من هذا الخطاب؟ سيُستخدم التحديث في الخطابات الجديدة إذا كان افتراضياً، ولا يتغير أي خطاب محفوظ.${saved!.content && !includeTemplateContent ? ' ستُزال النصوص والصور المحفوظة سابقاً من القالب لأن خيار تضمينها غير محدد.' : ''}`)) return
    const template = action === 'delete' ? null : captureLetterTemplate(draft, saved?.name ?? templateName, saved?.id ?? crypto.randomUUID(), true, includeTemplateContent, true)
    if (template && !template.name) { toast.show('أدخل اسم القالب أولاً', 'error'); return }
    setBusy(true); let changed = false
    try {
      const defaultBasis = action === 'save' && saveAsDefault ? useRawDataStore.getState().getLetterDefaultDesignBasis() : undefined
      await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => {
        checkBranch()
        if (template && action === 'update' && saved) useRawDataStore.getState().updateLetterTemplate(template, JSON.stringify(saved))
        else if (template) useRawDataStore.getState().saveLetterTemplate(template, defaultBasis)
        else if (saved) useRawDataStore.getState().deleteLetterTemplate(saved.id, JSON.stringify(saved))
        changed = true
      })
      if (template) setTemplateName('')
      toast.show(action === 'update' ? 'حُدّث القالب' : template ? (saveAsDefault ? 'حُفظ التصميم وثُبت افتراضياً للخطابات الجديدة في هذا الفرع' : 'حُفظ القالب لإعادة استخدامه دون تغيير الافتراضي') : 'حُذف القالب')
    } catch (error) { toast.show(changed ? 'تعذر تأكيد حفظ القالب؛ أعد تحميل القائمة قبل المحاولة.' : error instanceof Error ? error.message : 'تعذر حفظ القالب', 'error') }
    finally { setBusy(false) }
  }
  const setDefaultTemplate = async (selection: string) => {
    if (!draft || busy) return
    setBusy(true); let changed = false
    try {
      await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => { checkBranch(); useRawDataStore.getState().setLetterDefaultTemplate(selection); changed = true })
      toast.show('ثُبت القالب الافتراضي للخطابات الجديدة في الفرع')
    } catch (error) { toast.show(changed ? 'تعذر تأكيد حفظ الإعداد؛ أعد تحميل الصفحة.' : error instanceof Error ? error.message : 'تعذر تثبيت القالب', 'error') }
    finally { setBusy(false) }
  }
  const uploadMark = async (kind: 'signatureImage' | 'stampImage', file: File | undefined) => {
    if (!file || !draft) return
    const id = draft.id, previous = draft[kind]
    try {
      const data = await readLetterBackgroundFile(file), current = draftRef.current
      if (!current || current.id !== id || current[kind] !== previous) { toast.show('تغير التوقيع أو الخطاب أثناء تحميل الصورة؛ أعد المحاولة', 'error'); return }
      setDraft({ ...current, [kind]: data }); setDirty(true); setLayoutTarget(kind)
    } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر إضافة الصورة', 'error') }
  }
  const addParagraph = () => {
    if (!draft) return
    if (draft.paragraphs.length >= 100) { toast.show('بلغ الخطاب الحد الأقصى للفقرات', 'error'); return }
    const p = newLetterParagraph(), paragraphs = [...draft.paragraphs, p]
    const prior = selected ? getLetterBoxes(draft)[letterParagraphKey(selected.id)] : undefined
    const nextBox = prior ? { x: prior.x, y: Math.min(296, prior.y + 24), width: prior.width, page: prior.page ?? 1 } : getLetterBoxes({ ...draft, paragraphs })[letterParagraphKey(p.id)]
    patch({ paragraphs, ...(draft.layout ? { layout: { ...draft.layout, boxes: { ...draft.layout.boxes, [letterParagraphKey(p.id)]: nextBox } } } : {}) })
    setSelectedId(p.id); setFormatTarget('paragraph'); setLayoutTarget(letterParagraphKey(p.id))
  }
  const splitParagraph = (paragraph: LetterParagraph) => {
    if (!draft?.layout) return
    const cursor = paragraphRefs.current[paragraph.id]?.selectionStart ?? 0
    if (cursor <= 0 || cursor >= paragraph.text.length) { toast.show('ضع المؤشر داخل نص الفقرة في موضع التقسيم أولاً', 'error'); return }
    if (draft.paragraphs.length >= 100) { toast.show('بلغ الخطاب الحد الأقصى للفقرات', 'error'); return }
    const key = letterParagraphKey(paragraph.id), box = getLetterBoxes(draft)[key], nextPage = (box.page ?? 1) + 1
    if (nextPage > 10) { toast.show('بلغ الخطاب الحد الأقصى للصفحات', 'error'); return }
    const next: LetterParagraph = { ...paragraph, id: crypto.randomUUID(), text: paragraph.text.slice(cursor) }
    const paragraphs = draft.paragraphs.flatMap(p => p.id === paragraph.id ? [{ ...p, text: p.text.slice(0, cursor) }, next] : [p])
    patch({ paragraphs, layout: { ...draft.layout, pageCount: Math.max(draft.layout.pageCount ?? 1, nextPage), boxes: { ...draft.layout.boxes, [letterParagraphKey(next.id)]: { ...box, y: 55, page: nextPage, repeat: false } } } })
    setSelectedId(next.id); setFormatTarget('paragraph'); setLayoutTarget(letterParagraphKey(next.id))
  }
  const distributeParagraph = (paragraph: LetterParagraph) => {
    if (!draft?.layout || !sheetRef.current) return
    const key = letterParagraphKey(paragraph.id), box = getLetterBoxes(draft)[key]
    if (box.repeat) { toast.show('أوقف تكرار الفقرة قبل توزيعها على الصفحات', 'error'); return }
    const element = [...sheetRef.current.querySelectorAll<HTMLElement>('[data-letter-box]')].find(node => node.dataset.letterBox === key)
    const canvas = element?.closest<HTMLElement>('.letters-canvas')
    const rect = element?.getBoundingClientRect(), pageRect = canvas?.getBoundingClientRect()
    if (!element || !rect?.width || !pageRect?.height || !paragraph.text) { toast.show('اكتب الفقرة وتأكد من ظهور المعاينة قبل توزيعها', 'error'); return }
    if (document.fonts?.status === 'loading') { toast.show('انتظر تحميل خطوط المعاينة ثم أعد المحاولة', 'error'); return }
    const computed = getComputedStyle(element)
    const probe = document.createElement('div')
    Object.assign(probe.style, { position: 'fixed', left: '-10000px', top: '0', width: `${rect.width}px`, boxSizing: computed.boxSizing, fontFamily: computed.fontFamily, fontSize: computed.fontSize, fontWeight: computed.fontWeight, fontStyle: computed.fontStyle, lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing, textAlign: computed.textAlign, whiteSpace: computed.whiteSpace, overflowWrap: computed.overflowWrap, wordBreak: computed.wordBreak, padding: computed.padding, visibility: 'hidden' })
    probe.dir = 'rtl'; document.body.appendChild(probe)
    try {
      const parts = distributeLetterText(paragraph.text, box.page ?? 1, box.y, text => { probe.textContent = text; return probe.getBoundingClientRect().height }, pageRect.height / 297)
      if (parts.length === 1 && parts[0].page === (box.page ?? 1)) { toast.show('الفقرة تتسع في صفحتها الحالية'); return }
      if (draft.paragraphs.length + parts.length - 1 > 100) throw new Error('التوزيع يتجاوز الحد الأقصى للفقرات؛ لم يتغير الخطاب')
      if (!window.confirm(`سيُوزّع نص الفقرة على ${parts.length} جزء، ضمن الصفحات حتى ${parts[parts.length - 1].page}. لن تتحرك بقية العناصر تلقائياً، وقد يلزم تعديلها لتجنب التداخل. هل تريد المتابعة؟`)) return
      const paragraphs = parts.map((part, index) => ({ ...paragraph, id: index ? crypto.randomUUID() : paragraph.id, text: part.text }))
      const boxes = { ...draft.layout.boxes }
      paragraphs.forEach((p, index) => { boxes[letterParagraphKey(p.id)] = { ...box, page: parts[index].page, y: parts[index].y, repeat: false } })
      patch({ paragraphs: draft.paragraphs.flatMap(p => p.id === paragraph.id ? paragraphs : [p]), layout: { ...draft.layout, pageCount: Math.max(draft.layout.pageCount ?? 1, parts[parts.length - 1].page), boxes } })
      setSelectedId(paragraphs[0].id); setFormatTarget('paragraph'); setLayoutTarget(letterParagraphKey(paragraphs[0].id))
      toast.show('وُزعت الفقرة؛ راجع مواضع العناصر والتحذيرات ثم احفظ')
    } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر توزيع الفقرة', 'error') }
    finally { probe.remove() }
  }
  const checkBranch = () => { if (branchId() !== branchAtOpen) throw new Error('تغير الفرع منذ فتح الخطاب — أعد فتحه قبل الحفظ') }
  const commit = async (kind: 'save' | 'delete') => {
    if (!draft || busy) return
    if (kind === 'delete' && !window.confirm('هل تريد حذف هذا الخطاب نهائياً؟')) return
    if (kind === 'save') { const errors = validateLetter(draft); if (errors.length) { toast.show(errors.join(' — '), 'error'); return } }
    setBusy(true)
    let changed = false
    try {
      let saved: Letter | undefined
      await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => {
        checkBranch()
        if (kind === 'delete') { if (!basis) throw new Error('الخطاب لم يُحفظ بعد'); useRawDataStore.getState().deleteLetter(draft.id, basis) }
        else {
          const next = { ...draft, updatedAt: new Date().toISOString() }
          useRawDataStore.getState().saveLetter(next, basis, automaticNumber ? 'automatic' : undefined)
          saved = useRawDataStore.getState().letters.find(row => row.id === draft.id)
        }
        changed = true
      })
      if (kind === 'delete') { setDraft(null); setDirty(false); toast.show('حُذف الخطاب') }
      else if (saved) { setDraft(saved); setBasis(JSON.stringify(saved)); setAutomaticNumber(false); setDirty(false); toast.show(automaticNumber && saved.reference !== draft.reference ? `حُفظ الخطاب بالرقم ${saved.reference} بعد تحديث التسلسل` : 'حُفظ الخطاب بنجاح') }
    } catch (error) {
      toast.show(changed ? 'تعذر تأكيد الحفظ بعد تغيير البيانات؛ راجع الخطاب وأعد تحميله قبل المحاولة.' : error instanceof Error ? error.message : 'تعذر حفظ الخطاب', 'error')
    } finally { setBusy(false) }
  }
  const exportFile = async (kind: 'pdf' | 'word' | 'print') => {
    if (!draft || !sheetRef.current || busy) return
    const errors = validateLetter(draft); if (errors.length) { toast.show(errors.join(' — '), 'error'); return }
    if (automaticNumber) { toast.show('احفظ الخطاب أولاً لتثبيت الرقم التلقائي قبل التصدير أو الطباعة', 'error'); return }
    if (draft.layout) {
      if ([...sheetRef.current.querySelectorAll<HTMLElement>('.letters-canvas')].some(canvas => inspectLetterCanvas(canvas).length > 0) && !window.confirm('بعض عناصر التخطيط تتداخل أو تتجاوز الصفحة وقد تُقص عند التصدير. راجع المعاينة أو حرّك العناصر. هل تريد المتابعة؟')) return
      if (kind === 'word' && !window.confirm('يُصدّر Word العناصر في إطارات قابلة للتحرير؛ قد يختلف ترتيبها أو التفاف النص حسب برنامج Word والخطوط. راجع الملف قبل استخدامه. هل تريد المتابعة؟')) return
    }
    if (!draft.layout && kind === 'pdf' && sheetRef.current.scrollHeight > 1123 && !window.confirm('الخطاب يتجاوز صفحة واحدة؛ قد تنقسم السطور بين صفحات PDF ولا تتكرر الترويسة والتذييل. يُنصح باستخدام Word للخطابات الطويلة. هل تريد متابعة التصدير؟')) return
    setBusy(true)
    try {
      const exportPage = sheetRef.current.cloneNode(true) as HTMLElement
      exportPage.querySelectorAll('.is-selected').forEach(node => node.classList.remove('is-selected'))
      const canvasPrintStyles = `.letters-canvas-pages{display:block}.letters-page-label{display:none}.letters-canvas-frame{break-after:page;page-break-after:always}.letters-canvas-frame:last-child{break-after:auto;page-break-after:auto}.letters-canvas{position:relative;width:210mm;height:297mm;overflow:hidden;background:white;box-sizing:border-box;--letter-accent:${draft.accent}}.letters-canvas-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.letters-canvas-line{height:2px;background:var(--letter-accent)}.template-modern [data-letter-box=topRule]{height:5px}.letters-canvas-item{position:absolute;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;margin:0}.letters-canvas-item img{width:100%;height:100%;object-fit:contain}.letters-canvas-fixed{position:absolute;box-sizing:border-box;pointer-events:none}.letters-canvas-footer{white-space:pre-wrap;overflow-wrap:anywhere;text-align:center;line-height:1.25;font-size:9pt;color:#435664}@page{size:A4;margin:0}`
      if (kind === 'print') printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>خطاب</title><style>@font-face{font-family:LetterArabic;src:url('${new URL('../../assets/fonts/NotoNaskhArabic.ttf', import.meta.url).href}') format('truetype');font-weight:100 900}${printStyles}${draft.layout ? canvasPrintStyles : ''}</style></head><body>${exportPage.outerHTML}</body></html>`, { fromPreview: true })
      else if (kind === 'word') { const { createLetterWord } = await import('../../core/letterWord.ts'); download(await createLetterWord(draft), `${letterFilename(draft.subject)}.docx`) }
      else if (draft.layout && (draft.layout.pageCount ?? 1) > 1) {
        const { exportLetterCanvasPdf } = await import('./letterCanvasPdf.ts')
        if (document.fonts) { await document.fonts.load('16px LetterArabic', 'العربية'); await document.fonts.ready }
        await exportLetterCanvasPdf([...sheetRef.current.querySelectorAll<HTMLElement>('.letters-canvas')], `${letterFilename(draft.subject)}.pdf`)
      } else {
        const html2pdf = (await import('html2pdf.js')).default
        if (document.fonts) { await document.fonts.load('16px LetterArabic', 'العربية'); await document.fonts.ready }
        const page = draft.layout ? exportPage.querySelector<HTMLElement>('.letters-canvas')! : exportPage
        page.style.boxShadow = 'none'; page.style.margin = '0'; page.style.width = '794px'
        // تجنب صفحة بيضاء إضافية بسبب تقريب 1123px إلى أكثر من ارتفاع A4.
        if (draft.layout) page.style.height = '1122px'; else page.style.minHeight = '296mm'
        await html2pdf().set({ filename: `${letterFilename(draft.subject)}.pdf`, margin: 0, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: false, backgroundColor: '#ffffff' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(page).save()
      }
    } catch { toast.show('تعذر تصدير الخطاب — تحقق من محتواه وأعد المحاولة', 'error') }
    finally { setBusy(false) }
  }
  return <div className="letters-page" dir="rtl">
    <div className="letters-hero"><div><div style={{ fontSize: 11, letterSpacing: '.14em', color: '#9ad1d4', marginBottom: 8 }}>مركز التقارير / المراسلات</div><h1>الخطابات الرسمية</h1><p>مراسلات تليق بهوية منشأتك، من الكتابة حتى التصدير.</p></div>{!draft && <div className="letters-toolbar"><button className="letters-button" onClick={() => start()}><FilePlus2 size={16} /> إنشاء خطاب جديد</button></div>}</div>
    {!draft ? <section className="letters-card" style={{ marginTop: 20, overflow: 'hidden' }}>
      <div className="letters-list-filters"><div><h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>سجل الخطابات</h2><span style={{ color: '#7b8a9b', fontSize: 12 }}>{visible.length} خطاب</span></div>
        <label>العميل المسجل<select aria-label="تصفية حسب العميل المسجل" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}><option value="">كل العملاء</option>{filterCustomers.map(([id, name]) => <option key={id} value={id}>{name} · #{id}</option>)}</select></label>
        <label>اسم المستلم<input aria-label="البحث باسم المستلم" value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="عميل مسجل أو مستلم حر" /></label>
        <label>الموضوع<input aria-label="البحث بموضوع الخطاب" value={filterSubject} onChange={e => setFilterSubject(e.target.value)} placeholder="موضوع الخطاب" /></label>
        <label>رقم الخطاب<input aria-label="البحث برقم الخطاب" value={filterReference} onChange={e => setFilterReference(e.target.value)} placeholder="الرقم أو المرجع" /></label>
        {hasFilters && <button className="letters-button" onClick={() => { setFilterCustomer(''); setFilterName(''); setFilterSubject(''); setFilterReference('') }}>مسح الفلاتر</button>}
      </div>
      {visible.length === 0 ? <div style={{ textAlign: 'center', padding: '55px 20px', color: '#7c8d9c' }}><FileText size={38} style={{ margin: 'auto auto 12px', color: '#91b6bd' }} /><strong>{hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد خطابات محفوظة بعد'}</strong><p style={{ fontSize: 13, marginTop: 8 }}>ابدأ بخطاب جديد وخصصه حسب احتياجك.</p></div> : visible.map(letter => <div className="letters-list-row" key={letter.id}><div><h3>{letter.subject}</h3><p>{letter.recipient} · {letter.date} {letter.reference && `· ${letter.reference}`}</p></div><button className="letters-button" onClick={() => start(letter)}><Pencil size={14} /> فتح ومعاينة</button></div>)}
    </section> : <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 18 }}><div className="letters-toolbar"><button className="letters-button" onClick={() => { if (canLeave()) { setDraft(null); setDirty(false) } }}><ArrowRight size={15} /> السجل</button><span style={{ fontSize: 12, color: '#748799' }}>{dirty ? 'تعديلات غير محفوظة' : basis ? 'خطاب محفوظ' : 'خطاب جديد'}</span></div><div className="letters-toolbar"><button className="letters-button primary" disabled={busy} onClick={() => void commit('save')}><Save size={15} /> حفظ</button><button className="letters-button" disabled={busy} onClick={() => void exportFile('pdf')}><Download size={15} /> PDF</button><button className="letters-button" disabled={busy} onClick={() => void exportFile('word')}><Download size={15} /> Word</button><button className="letters-button" disabled={busy} onClick={() => void exportFile('print')}><Printer size={15} /> طباعة</button>{basis && <button className="letters-button" disabled={busy} onClick={() => void commit('delete')} style={{ color: '#b34545' }}><Trash2 size={15} /> حذف</button>}</div></div>
      <div className="letters-editor-grid" inert={busy}><section className="letters-card letters-form">
        <div><h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>محرر الخطاب</h2><p style={{ fontSize: 12, color: '#8191a1', margin: '5px 0 0' }}>اختر أي حقل أو فقرة لتنسيقهما بصورة مستقلة. تُحفظ بيانات الأطراف والتنسيقات مع الخطاب.</p></div>
        <div className="letters-layout-controls">
          <label>تصميم جاهز لهذا الخطاب فقط<select aria-label="قالب شكل الخطاب" value={draft.layout?.template ?? 'legacy'} onChange={e => {
            const template = e.target.value as LetterTemplate
            if (!Object.hasOwn(LETTER_TEMPLATES, template)) return
            applyTemplate(template)
          }}><option value="legacy" disabled>التخطيط القديم</option>{Object.entries(LETTER_TEMPLATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {!draft.layout && <div className="letters-layout-warning">هذا الخطاب يستخدم العرض القديم. اختر قالباً لتطبيق الترويسة الجديدة والتذييل الثابت؛ لن يتغير الخطاب المحفوظ حتى تضغط حفظ.</div>}
          {draft.layout && <>
            <button type="button" className="letters-button letters-template-control-button" aria-expanded={templateControlsOpen} onClick={() => setTemplateControlsOpen(open => !open)}><Settings2 size={15} /> التحكم في القوالب والخلفية</button>
            {templateControlsOpen && <div className="letters-template-manager">
              <label>اختيار قالب محفوظ أو جاهز كافتراضي للخطابات الجديدة<select aria-label="القالب الافتراضي للخطابات الجديدة" value={(() => { try { return useRawDataStore.getState().getLetterDefaultTemplate() } catch { return '' } })()} onChange={e => void setDefaultTemplate(e.target.value)}><option value="" disabled>القالب الافتراضي غير متاح — اختر بديلاً</option>{Object.entries(LETTER_TEMPLATES).map(([key, name]) => <option key={key} value={`builtin:${key}`}>{name}</option>)}{(letterTemplates ?? []).map(template => <option key={template.id} value={`saved:${template.id}`}>{template.name} (مخصص)</option>)}</select></label>
              <small>اختيار تصميم جاهز يستخدم شكله الأصلي لا تعديلات هذا الخطاب. لحفظ تعديلاتك استخدم «حفظ التصميم كقالب» أدناه.</small>
              <strong>الخلفية الرسمية</strong>
              <label>خلفية الصفحة<select aria-label="خلفية الصفحة" value={draft.layout.background?.source ?? 'none'} onChange={e => {
                const source = e.target.value as keyof typeof LETTER_BACKGROUNDS
                if (!Object.hasOwn(LETTER_BACKGROUNDS, source)) return
                updateBackground({ source, opacity: source === 'none' ? 0 : draft.layout?.background?.opacity || 55 })
              }}>{Object.entries(LETTER_BACKGROUNDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{draft.layout.background?.source === 'custom' && <option value="custom">صورة مضافة</option>}</select></label>
              <label>شفافية الخلفية: {100 - (draft.layout.background?.opacity ?? 0)}٪ · الظهور: {draft.layout.background?.opacity ?? 0}٪<input aria-label="درجة شفافية الخلفية" type="range" min="0" max="100" step="1" disabled={!draft.layout.background || draft.layout.background.source === 'none'} value={100 - (draft.layout.background?.opacity ?? 0)} onChange={e => { if (draft.layout?.background) updateBackground({ ...draft.layout.background, opacity: 100 - Number(e.target.value) }) }} /></label>
              <label>إضافة خلفية من الجهاز<input aria-label="إضافة خلفية من الجهاز" type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void uploadBackground(file) }} /></label>
              <small>PNG أو JPEG حتى 1 ميغابايت؛ تُمد الصورة على الصفحة وتُحفظ داخل الخطاب. الشفافية 0٪ تعني خلفية كاملة، و100٪ تخفيها.</small>
              <label className="letters-repeat-option"><input type="checkbox" aria-label="حفظ نصوص الخطاب وصور التوقيع والختم في القالب" checked={includeTemplateContent} onChange={e => setIncludeTemplateContent(e.target.checked)} /> تضمين نصوص الخطاب وصور التوقيع والختم في القالب</label>
              <small>يحفظ القالب بيانات المنشأة وشعارها وجميع المواضع والمسافات وتنسيقات النصوص والخلفية وإظهار عناصر الترويسة. عند تحديد الخيار ستظهر النصوص والصور في كل خطاب جديد يستخدمه؛ لا تُنسخ بيانات العميل أو موضوع الخطاب أو رقمه أو التاريخ. لتغيير قالب محفوظ استخدم «تحديث من الخطاب». أزل التحديد إن لم ترد حفظ النصوص والصور.</small>
              <div className="letters-template-save"><label className="letters-repeat-option"><input type="checkbox" aria-label="تثبيت القالب المحفوظ افتراضياً" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} /> استخدام هذا التصميم افتراضياً للخطابات الجديدة في الفرع</label><label>اسم القالب المخصص<input aria-label="اسم القالب المخصص" maxLength={80} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="مثلاً: مراسلات الشركة" /></label><button type="button" className="letters-button" onClick={() => void changeSavedTemplate('save')}>حفظ التصميم كقالب</button></div>
              {(letterTemplates ?? []).length > 0 && <div className="letters-saved-templates"><strong>القوالب المحفوظة</strong>{letterTemplates.map(template => <div className="letters-saved-template" key={template.id}><span>{template.name}</span><button type="button" className="letters-button" onClick={() => { if (window.confirm(`تطبيق القالب «${template.name}» يعيد المواضع والتنسيقات وتوزيع الصفحات${template.content ? ' ويستبدل نصوص الخطاب وصور التوقيع والختم بما في القالب' : ''}${template.identity ? ' ويستبدل بيانات المنشأة وشعارها' : ''}. هل تريد المتابعة؟`)) { patch(applyCompleteLetterTemplate(draft, template)); setLayoutTarget('reference'); setFormatTarget('paragraph') } }}>تطبيق</button><button type="button" className="letters-button" aria-label={`تحديث قالب ${template.name}`} onClick={() => void changeSavedTemplate('update', template.id)}>تحديث من الخطاب</button><button type="button" className="letters-button" aria-label={`حذف قالب ${template.name}`} onClick={() => void changeSavedTemplate('delete', template.id)}>حذف</button></div>)}</div>}
            </div>}
            {draft.layout.contentVersion !== 2 && draft.layout.contentVersion !== 3 && draft.layout.contentVersion !== 4 && <div className="letters-layout-warning">هذا الخطاب يستخدم تخطيطاً محفوظاً سابقاً. لتطبيق الترويسة الجديدة والتذييل الثابت اختر «إعادة ترتيب عناصر القالب»؛ سيعاد ضبط مواضع العناصر بعد التأكيد.</div>}
            <details className="letters-header-visibility"><summary>إظهار أو إخفاء عناصر الترويسة</summary><div className="letters-header-visibility-grid">{letterHeaderKeys(draft).map(key => <label key={key} className="letters-repeat-option"><input type="checkbox" aria-label={`إظهار ${letterBoxLabel(key, draft)}`} checked={isLetterItemVisible(draft, key)} onChange={e => { const hidden = new Set(draft.layout!.hiddenHeader ?? []); if (e.target.checked) hidden.delete(key); else hidden.add(key); patch({ layout: { ...draft.layout!, hiddenHeader: [...hidden] } }) }} /> {letterBoxLabel(key, draft)}</label>)}</div><small>الإخفاء لا يحذف البيانات، ويسري على المعاينة والطباعة وPDF وWord. التذييل مستقل وثابت.</small></details>
            <details className="letters-advanced-layout"><summary>أدوات المواضع والصفحات المتقدمة</summary><div className="letters-advanced-layout-content">
            <button type="button" className="letters-button" onClick={() => { if (window.confirm('إعادة تنسيق عناصر القالب الحالي ستعيد مواضعها وتوزيع الصفحات إلى التصميم الجديد. ستبقى الخلفية والتوقيع والنصوص. هل تريد المتابعة؟')) { const layout = createLetterLayout(draft, draft.layout!.template); layout.background = draft.layout!.background; patch({ layout }); setLayoutTarget('reference'); setFormatTarget('paragraph') } }}>إعادة ترتيب عناصر القالب</button>
            {(draft.layout.contentVersion === 2 || draft.layout.contentVersion === 3 || draft.layout.contentVersion === 4) && <button type="button" className="letters-button" onClick={() => {
              if (!window.confirm('تقريب بيانات المنشأة والجهة يعيد مواضع حقول البيانات في الترويسة إلى التوزيع المدمج؛ لا يغير بقية العناصر أو صفحاتها. هل تريد المتابعة؟')) return
              const defaults = defaultLetterBoxes(draft, draft.layout!.template), current = getLetterBoxes(draft)
              const keys = ['headerAddress', 'headerPhone', 'headerEmail', 'headerPoBox', 'headerWebsite', 'headerCommercialRegister', 'headerTaxNumber', 'recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail']
              const boxes = { ...draft.layout!.boxes }
              keys.forEach(key => { boxes[key] = { ...defaults[key], page: current[key].page, repeat: current[key].repeat } })
              patch({ layout: { ...draft.layout!, boxes } })
            }}>تقريب بيانات الترويسة</button>}
            {(draft.layout.contentVersion === 2 || draft.layout.contentVersion === 3 || draft.layout.contentVersion === 4) && (() => {
              const boxes = getLetterBoxes(draft), companyStep = letterRowSpacing(boxes, LETTER_COMPANY_DETAIL_KEYS), recipientStep = letterRowSpacing(boxes, LETTER_RECIPIENT_DETAIL_KEYS)
              const updateRows = (keys: readonly string[], spacing: number) => {
                try { const updated = arrangeHeaderRows(draft, boxes, keys, spacing); patch({ layout: { ...draft.layout!, boxes: updated } }) }
                catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر ضبط التباعد', 'error') }
              }
              return <div className="letters-spacing-panel"><strong>التحكم في مسافات الترويسة</strong>
                <label>المسافة الأفقية بين الجهتين (مم)<input aria-label="المسافة بين بيانات الجهتين بالملليمتر" type="number" min="0" max="100" step="0.5" value={letterColumnGap(boxes)} onChange={e => { if (!e.target.value) return; try { const updated = setLetterColumnGap(boxes, Number(e.target.value)); patch({ layout: { ...draft.layout!, boxes: updated } }) } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر ضبط المسافة', 'error') } }} /></label>
                <div className="letters-pair"><label>تباعد سطور منشأتي (مم)<input aria-label="تباعد سطور بيانات المنشأة بالملليمتر" type="number" min="3" max="20" step="0.2" value={companyStep} onChange={e => { if (e.target.value) updateRows(LETTER_COMPANY_DETAIL_KEYS, Number(e.target.value)) }} /></label>
                  <label>تباعد سطور الجهة (مم)<input aria-label="تباعد سطور بيانات الجهة بالملليمتر" type="number" min="3" max="20" step="0.2" value={recipientStep} onChange={e => { if (e.target.value) updateRows(LETTER_RECIPIENT_DETAIL_KEYS, Number(e.target.value)) }} /></label></div>
                <label>المسافة بين آخر عنصر ظاهر في الترويسة والخط الفاصل (مم)<input aria-label="المسافة بين البيانات والخط الفاصل بالملليمتر" type="number" min="0" max="100" step="0.5" disabled={headerBottom === null} value={headerBottom === null ? '' : Math.round((boxes.topRule.y - headerBottom) * 10) / 10} onChange={e => { if (!e.target.value || headerBottom === null) return; const value = Number(e.target.value), y = Math.round((headerBottom + value) * 10) / 10; if (!Number.isFinite(value) || value < 0 || value > 100 || y >= 297) { toast.show('المسافة المطلوبة خارج الصفحة', 'error'); return } moveBox('topRule', { ...boxes.topRule, y }) }} /></label>
                <button type="button" className="letters-button" onClick={() => { try { const first = arrangeHeaderRows(draft, boxes, LETTER_COMPANY_DETAIL_KEYS, companyStep), both = arrangeHeaderRows(draft, first, LETTER_RECIPIENT_DETAIL_KEYS, recipientStep); patch({ layout: { ...draft.layout!, boxes: both } }) } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر ترتيب البيانات', 'error') } }}>رص البيانات الظاهرة</button>
                <small>تغيير تباعد السطور يرتب بيانات المجموعة الظاهرة أولاً ثم الفارغة، ويحافظ على صفحاتها. المسافة الأفقية تغيّر عرض عمود الجهة؛ والخط يُضبط وفق آخر عنصر ظاهر في صفحته. بقية العناصر لا تتحرك تلقائياً؛ راجع التنبيهات والتفاف السطور ثم احفظ.</small>
              </div>
            })()}
            <div className="letters-page-controls"><strong>الصفحات: {draft.layout.pageCount ?? 1}</strong><button type="button" className="letters-button" disabled={(draft.layout.pageCount ?? 1) >= 10} onClick={() => patch({ layout: { ...draft.layout!, pageCount: (draft.layout!.pageCount ?? 1) + 1 } })}>+ صفحة</button><button type="button" className="letters-button" disabled={(draft.layout.pageCount ?? 1) <= 1} onClick={() => {
              const count = draft.layout!.pageCount ?? 1
              if (Object.values(getLetterBoxes(draft)).some(box => (box.page ?? 1) === count)) { toast.show('انقل عناصر الصفحة الأخيرة أولاً قبل حذفها، بما فيها الحقول الفارغة.', 'error'); return }
              if (window.confirm('حذف الصفحة الأخيرة؟')) patch({ layout: { ...draft.layout!, pageCount: count - 1 } })
            }}>حذف الصفحة الأخيرة</button></div>
            <button type="button" className="letters-button" onClick={() => {
              const boxes = getLetterBoxes(draft), keys = ['logo', 'identityName', ...(draft.layout?.contentVersion === 1 || draft.layout?.contentVersion === 2 || draft.layout?.contentVersion === 3 || draft.layout?.contentVersion === 4 ? ['headerAddress', 'headerPhone', 'headerEmail', 'headerPoBox', 'headerWebsite', 'headerCommercialRegister', 'headerTaxNumber'] : []), ...((draft.layout?.contentVersion === 2 || draft.layout?.contentVersion === 3 || draft.layout?.contentVersion === 4) ? ['headerRecipientName', 'recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail'] : []), 'topRule', ...((draft.layout?.contentVersion === 2 || draft.layout?.contentVersion === 3 || draft.layout?.contentVersion === 4) ? [] : ['bottomRule', 'identityAddress', 'identityPhone', 'identityEmail', 'identityPoBox', 'identityWebsite', 'identityCommercialRegister', 'identityTaxNumber'])]
              const repeat = !keys.every(key => boxes[key].repeat)
              const updated = { ...draft.layout!.boxes }
              keys.forEach(key => { updated[key] = { ...boxes[key], page: 1, repeat } })
              patch({ layout: { ...draft.layout!, boxes: updated } })
            }}>{(draft.layout.contentVersion === 2 || draft.layout.contentVersion === 3 || draft.layout.contentVersion === 4) ? 'تفعيل / إلغاء تكرار الترويسة' : 'تفعيل / إلغاء تكرار الترويسة والتذييل'}</button>
            <label>العنصر المراد تحريكه<select aria-label="العنصر المراد تحريكه" value={layoutTarget} onChange={e => selectBox(e.target.value)}>{letterLayoutItems(draft).filter(item => !item.fixed).map(item => <option key={item.key} value={item.key}>{letterBoxLabel(item.key, draft)}</option>)}</select></label>
            <label>صفحة العنصر<select aria-label="صفحة العنصر" disabled={!!getLetterBoxes(draft)[layoutTarget]?.repeat} value={getLetterBoxes(draft)[layoutTarget]?.page ?? 1} onChange={e => { const box = getLetterBoxes(draft)[layoutTarget]; if (box) moveBox(layoutTarget, { ...box, page: Number(e.target.value) }) }}>{Array.from({ length: draft.layout.pageCount ?? 1 }, (_, i) => <option value={i + 1} key={i}>{`صفحة ${i + 1}`}</option>)}</select></label>
            <label className="letters-repeat-option"><input type="checkbox" aria-label="تكرار العنصر على كل الصفحات" checked={!!getLetterBoxes(draft)[layoutTarget]?.repeat} onChange={e => { const box = getLetterBoxes(draft)[layoutTarget]; if (box) moveBox(layoutTarget, { ...box, repeat: e.target.checked, page: e.target.checked ? 1 : box.page }) }} /> تكرار العنصر على كل الصفحات بنفس الموضع</label>
            <div className="letters-layout-inputs">{(['x', 'y', 'width'] as const).map(prop => {
              const box = getLetterBoxes(draft)[layoutTarget]
              return <label key={prop}>{prop === 'x' ? 'من اليسار (مم)' : prop === 'y' ? 'من الأعلى (مم)' : 'العرض (مم)'}<input type="number" aria-label={prop === 'x' ? 'الموضع الأفقي بالملليمتر' : prop === 'y' ? 'الموضع الرأسي بالملليمتر' : 'عرض العنصر بالملليمتر'} step="0.5" min={prop === 'width' ? 5 : 0} value={box?.[prop] ?? 0} onChange={e => { if (!box || e.target.value === '') return; const value = Number(e.target.value); if (!Number.isFinite(value)) return; const next = prop === 'x' ? { ...box, x: Math.max(0, Math.min(210 - box.width, value)) } : prop === 'y' ? { ...box, y: Math.max(0, Math.min(297 - (box.height ?? 1), value)) } : { ...box, width: Math.max(5, Math.min(210 - box.x, value)) }; moveBox(layoutTarget, next) }} /></label>
            })}</div>
            {['logo', 'signatureImage', 'stampImage'].includes(layoutTarget) && <label>ارتفاع الصورة (مم)<input aria-label={layoutTarget === 'logo' ? 'ارتفاع الشعار بالملليمتر' : 'ارتفاع الصورة بالملليمتر'} type="number" min="5" step="0.5" value={getLetterBoxes(draft)[layoutTarget].height ?? 22} onChange={e => { const box = getLetterBoxes(draft)[layoutTarget]; if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) moveBox(layoutTarget, { ...box, height: Math.max(5, Math.min(297 - box.y, Number(e.target.value))) }) }} /></label>}
            {layoutIssues.length > 0 && <div className="letters-layout-warning">
              <strong role="status">تنبيهات المعاينة: {layoutIssues.length} — قد تتداخل العناصر أو تُقص. اختر عنصراً لتحديده وتحريكه.</strong>
              <ul>{layoutIssues.slice(0, 20).map((issue, index) => <li key={`${issue.page}-${issue.kind}-${issue.key}-${issue.kind === 'overlap' ? issue.other : ''}-${index}`}>
                صفحة {issue.page}: {issue.kind === 'outside' ? 'خارج حدود الصفحة: ' : 'تداخل: '}
                {isFixedLetterBox(draft, issue.key) ? <b>{letterBoxLabel(issue.key, draft)} (ثابت)</b> : <button type="button" onClick={() => selectIssueBox(issue.page, issue.key)}>{letterBoxLabel(issue.key, draft)}</button>}
                {issue.kind === 'overlap' && <> و {isFixedLetterBox(draft, issue.other) ? <b>{letterBoxLabel(issue.other, draft)} (ثابت)</b> : <button type="button" onClick={() => selectIssueBox(issue.page, issue.other)}>{letterBoxLabel(issue.other, draft)}</button>}</>}
              </li>)}</ul>
              {layoutIssues.length > 20 && <span>توجد {layoutIssues.length - 20} تنبيهات إضافية؛ عالج الظاهرة أولاً.</span>}
            </div>}
            <span className="letters-layout-note">{(draft.layout.contentVersion === 2 || draft.layout.contentVersion === 3 || draft.layout.contentVersion === 4) ? 'اسحب العناصر المتاحة في المعاينة أو حركها بالأسهم؛ تذييل المنشأة ثابت في كل صفحة ولا يمكن تحريكه؛ إذا طال وخرج من الصفحة اختصر بيانات المنشأة.' : 'اسحب العناصر في المعاينة أو حركها بالأسهم.'} اضبط موضع العنصر وعرضه بالأرقام. انقل العنصر إلى صفحة أخرى من القائمة، أو كرره على الصفحات. الحقول الفارغة تظهر عند تعبئتها. استخدم توزيع الفقرة أو تقسيمها، وراجع بقية العناصر؛ لا تتغير الصفحات تلقائياً أثناء الكتابة.</span>
            </div></details>
          </>}
        </div>
        <div className="letters-format-panel">
          <label>تنسيق العنصر المحدد<select aria-label="العنصر المراد تنسيقه" value={formatTarget} onChange={e => setFormatTarget(e.target.value)}><option value="paragraph">الفقرة المحددة</option>{Object.entries(LETTER_FIELDS).filter(([key]) => (draft.layout?.contentVersion !== 2 && draft.layout?.contentVersion !== 3 && draft.layout?.contentVersion !== 4) || !['identityAddress', 'identityPhone', 'identityEmail', 'identityPoBox', 'identityWebsite', 'identityCommercialRegister', 'identityTaxNumber'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="letters-toolbar">
            <button type="button" className="letters-button" aria-label="خط عريض" aria-pressed={selectedStyle?.bold} onClick={() => patchStyle({ bold: !selectedStyle?.bold })} style={{ background: selectedStyle?.bold ? '#d5eff0' : undefined }}>عريض</button>
            <button type="button" className="letters-button" aria-label="خط مائل" aria-pressed={selectedStyle?.italic} onClick={() => patchStyle({ italic: !selectedStyle?.italic })} style={{ background: selectedStyle?.italic ? '#d5eff0' : undefined }}>مائل</button>
            <button type="button" className="letters-button" aria-label="تسطير النص" aria-pressed={selectedStyle?.underline} onClick={() => patchStyle({ underline: !selectedStyle?.underline })} style={{ background: selectedStyle?.underline ? '#d5eff0' : undefined }}>تسطير</button>
            <select aria-label="محاذاة الفقرة" value={selectedStyle?.align ?? 'right'} onChange={e => patchStyle({ align: e.target.value as LetterTextStyle['align'] })}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option><option value="justify">ضبط</option></select>
            <select aria-label="حجم خط الفقرة" value={selectedStyle?.size ?? 14} onChange={e => patchStyle({ size: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => i + 9).map(size => <option key={size} value={size}>{size}</option>)}</select>
            <select aria-label="نوع خط العنصر" value={selectedStyle?.font ?? draft.font} onChange={e => patchStyle({ font: e.target.value as Letter['font'] })}><option>Arial</option><option>Tahoma</option><option>Georgia</option></select>
            <input aria-label="لون الفقرة" type="color" value={selectedStyle?.color ?? '#202b3a'} onChange={e => patchStyle({ color: e.target.value })} />
          </div><small>التنسيق يخص العنصر المحدد فقط، وينعكس في المعاينة وPDF وWord.</small>
        </div>
        <label>مصدر بيانات المستلم<select aria-label="مصدر بيانات المستلم" value={draft.customerId ? String(draft.customerId) : ''} onChange={e => {
          if (!e.target.value) { patch({ customerId: null }); return }
          const c = (customers ?? []).find(row => String(row.id) === e.target.value)
          if (!c) return
          patch({ customerId: c.id, recipient: c.nameAr, recipientDetails: { address: [c.city, c.address, c.buildingNo, c.postalCode].filter(Boolean).join('، '), phone: c.phone ?? '', email: c.email ?? '', taxNumber: c.taxNumber ?? '', commercialReg: c.commercialReg ?? '', nationalId: c.nationalId ?? '', contactPerson: c.contactPerson ?? '', contactRole: c.contactRole ?? '', contactPhone: c.contactPhone ?? '', contactEmail: c.contactEmail ?? '' } })
        }}><option value="">إدخال يدوي / خطاب حر</option>{draft.customerId && !(customers ?? []).some(c => c.id === draft.customerId) && <option value={draft.customerId}>العميل المرتبط غير متاح حالياً</option>}{(customers ?? []).map(c => <option key={c.id} value={c.id}>{c.nameAr} · #{c.id}{c.active === false ? ' (موقوف)' : ''}</option>)}</select></label>
        <div className="letters-pair"><label>الجهة الموجه إليها<input value={draft.recipient} readOnly={!!draft.customerId} onFocus={() => setFormatTarget('recipient')} onChange={e => patch({ recipient: e.target.value })} placeholder="اسم الجهة أو الشخص" /></label><label>التاريخ<input type="date" value={draft.date} onFocus={() => setFormatTarget('date')} onChange={e => {
          const date = e.target.value
          if (!automaticNumber) { patch({ date }); return }
          let reference = ''
          try { reference = useRawDataStore.getState().suggestLetterReference(date, basis ? draft.id : undefined) } catch { /* تاريخ غير مكتمل أو فرع غير متاح */ }
          patch({ date, reference })
        }} /></label></div>
        <details><summary>بيانات المستلم الإضافية</summary><div className="letters-detail-fields">{([
          ['address', 'عنوان المستلم', 'recipientAddress'], ['phone', 'هاتف المستلم', 'recipientPhone'], ['email', 'بريد المستلم', 'recipientEmail'], ['taxNumber', 'الرقم الضريبي للمستلم', 'recipientTaxNumber'], ['commercialReg', 'السجل التجاري للمستلم', 'recipientCommercialReg'], ['nationalId', 'هوية المستلم', 'recipientNationalId'], ['contactPerson', 'مسؤول التواصل لدى المستلم', 'recipientContactPerson'], ['contactRole', 'صفة مسؤول التواصل', 'recipientContactRole'], ['contactPhone', 'هاتف مسؤول التواصل', 'recipientContactPhone'], ['contactEmail', 'بريد مسؤول التواصل', 'recipientContactEmail'],
        ] as const).map(([key, label, styleKey]) => <label key={key}>{label}<input value={draft.recipientDetails?.[key] ?? ''} onFocus={() => setFormatTarget(styleKey)} onChange={e => patch({ recipientDetails: { ...emptyLetterRecipientDetails(), ...draft.recipientDetails, [key]: e.target.value } })} /></label>)}<small>نسخة بيانات هذا الخطاب مستقلة؛ تعديلها هنا لا يغيّر سجل العميل.</small></div></details>
        <label>موضوع الخطاب<input value={draft.subject} onFocus={() => setFormatTarget('subject')} onChange={e => patch({ subject: e.target.value })} placeholder="اكتب موضوعاً واضحاً" /></label><label>رقم الخطاب / المرجع<input value={draft.reference} onFocus={() => setFormatTarget('reference')} onChange={e => { setAutomaticNumber(false); patch({ reference: e.target.value }) }} placeholder="اكتب رقماً يدوياً" /></label>
        <div className="letters-number-help"><span>{automaticNumber ? 'رقم مقترح حسب سنة التاريخ؛ يُثبّت عند الحفظ وقد يتغير إذا حُفظ خطاب آخر قبله.' : 'رقم يدوي أو محفوظ؛ يمكنك تعديله كما تشاء.'}</span><button type="button" className="letters-button" onClick={() => { try { const reference = useRawDataStore.getState().suggestLetterReference(draft.date, basis ? draft.id : undefined); setAutomaticNumber(true); patch({ reference }) } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر اقتراح رقم الخطاب', 'error') } }}>اقتراح ترقيم تلقائي</button></div>
        <label>التحية<input value={draft.salutation} onFocus={() => setFormatTarget('salutation')} onChange={e => patch({ salutation: e.target.value })} /></label>
        <div style={{ borderTop: '1px solid #e9eff3', paddingTop: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><b>نص الخطاب</b><button className="letters-button" onClick={addParagraph}><Plus size={14} /> فقرة</button></div>
          <label>بداية من قالب<select defaultValue="" onChange={e => { if (selected && e.target.value && window.confirm('استبدال نص الفقرة الحالية بالقالب؟')) patchParagraph({ text: paragraphPresets[e.target.value] }); e.target.value = '' }}><option value="">اختر نصاً جاهزاً</option><option value="official">خطاب رسمي عام</option><option value="request">طلب رسمي</option><option value="certificate">إفادة</option></select></label>
          {draft.paragraphs.map((p, index) => <div key={p.id} style={{ marginBottom: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><span style={{ fontSize: 12, color: '#607286' }}>فقرة {index + 1} {selected?.id === p.id ? '· محددة' : ''}</span><div className="letters-toolbar">{draft.layout && <button type="button" className="letters-button" aria-label={`توزيع فقرة ${index + 1} على الصفحات`} onClick={() => distributeParagraph(p)}>توزيع الفقرة</button>}{draft.layout && <button type="button" className="letters-button" aria-label={`تقسيم فقرة ${index + 1} عند المؤشر`} onClick={() => splitParagraph(p)}>تقسيم للصفحة التالية</button>}{draft.paragraphs.length > 1 && <button className="letters-button" aria-label={`حذف فقرة ${index + 1}`} onClick={() => { const paragraphs = draft.paragraphs.filter(row => row.id !== p.id); const boxes = { ...draft.layout?.boxes }; delete boxes[letterParagraphKey(p.id)]; patch({ paragraphs, ...(draft.layout ? { layout: { ...draft.layout, boxes } } : {}) }); setSelectedId(paragraphs[0].id); if (layoutTarget === letterParagraphKey(p.id)) setLayoutTarget('reference') }}><Trash2 size={13}/></button>}</div></div><textarea ref={node => { paragraphRefs.current[p.id] = node }} aria-label={`نص فقرة ${index + 1}`} value={p.text} onFocus={() => { setSelectedId(p.id); setFormatTarget('paragraph'); setLayoutTarget(letterParagraphKey(p.id)) }} onChange={e => { patch({ paragraphs: draft.paragraphs.map(row => row.id === p.id ? { ...row, text: e.target.value } : row) }); setSelectedId(p.id); setFormatTarget('paragraph') }} style={{ borderColor: selected?.id === p.id ? '#29929e' : undefined }} /></div>)}
        </div>
        <label>عبارة الختام<input value={draft.closing} onFocus={() => setFormatTarget('closing')} onChange={e => patch({ closing: e.target.value })} /></label><div className="letters-pair"><label>اسم الموقّع<input value={draft.signer} onFocus={() => setFormatTarget('signer')} onChange={e => patch({ signer: e.target.value })} /></label><label>المسمى الوظيفي<input value={draft.position} onFocus={() => setFormatTarget('position')} onChange={e => patch({ position: e.target.value })} /></label></div><label>نص التوقيع والختم<input value={draft.signatureText ?? 'التوقيع والختم: ........................'} onFocus={() => setFormatTarget('signature')} onChange={e => patch({ signatureText: e.target.value })} /></label>
        <div className="letters-signature-images"><strong>التوقيع والختم</strong>
          <div className="letters-pair">{([['signatureImage', 'صورة التوقيع'], ['stampImage', 'صورة الختم']] as const).map(([kind, label]) => <div key={kind}>
            <label>{label}<input type="file" aria-label={`رفع ${label}`} accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void uploadMark(kind, file) }} /></label>
            {draft[kind] && <><img className="letters-signature-preview" src={draft[kind]} alt={label} /><button type="button" className="letters-button" onClick={() => patch({ [kind]: '' })}>{`إزالة ${label}`}</button></>}
          </div>)}</div>
          <div><button type="button" className="letters-button" onClick={() => setSignatureDrawing(true)}>رسم توقيع حر</button></div>
          {signatureDrawing && <LetterSignaturePad onClose={() => setSignatureDrawing(false)} onUse={data => { patch({ signatureImage: data }); setLayoutTarget('signatureImage'); setSignatureDrawing(false) }} />}
          <small>الصور للتوقيع البصري وليست توقيعاً إلكترونياً معتمداً. اسحب كل صورة داخل المعاينة لتغيير موضعها.</small>
        </div>
        <details style={{ borderTop: '1px solid #e9eff3', paddingTop: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>هوية المنشأة والتصميم</summary><div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label>اسم المنشأة<input value={draft.identity.name} onFocus={() => setFormatTarget('identityName')} onChange={e => patch({ identity: { ...draft.identity, name: e.target.value } })} /></label>
          {([['address', 'العنوان', 'identityAddress'], ['phone', 'الهاتف', 'identityPhone'], ['email', 'البريد الإلكتروني', 'identityEmail'], ['poBox', 'صندوق البريد', 'identityPoBox'], ['website', 'الموقع الإلكتروني', 'identityWebsite'], ['commercialRegister', 'السجل التجاري', 'identityCommercialRegister'], ['taxNumber', 'الرقم الضريبي', 'identityTaxNumber']] as const).map(([key, label, styleKey]) => <label key={key}>{label}<input value={draft.identity[key] ?? ''} onFocus={() => setFormatTarget((draft.layout?.contentVersion === 2 || draft.layout?.contentVersion === 3 || draft.layout?.contentVersion === 4) ? ({ identityAddress: 'headerAddress', identityPhone: 'headerPhone', identityEmail: 'headerEmail', identityPoBox: 'headerPoBox', identityWebsite: 'headerWebsite', identityCommercialRegister: 'headerCommercialRegister', identityTaxNumber: 'headerTaxNumber' } as const)[styleKey] : styleKey)} onChange={e => patch({ identity: { ...draft.identity, [key]: e.target.value } })} /></label>)}
          <div className="letters-pair"><label>خط الخطاب<select value={draft.font} onChange={e => patch({ font: e.target.value as Letter['font'] })}><option>Arial</option><option>Tahoma</option><option>Georgia</option></select></label><label>لون الهوية<input type="color" value={draft.accent} onChange={e => patch({ accent: e.target.value })} /></label></div>
          {!draft.layout && <label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={!!draft.identity.logo} onChange={e => patch({ identity: { ...draft.identity, logo: e.target.checked ? safeLogo(receipt.logoDataUrl) : '' } })} /> إظهار شعار المنشأة من إعدادات الطباعة</label>}
          {!safeLogo(receipt.logoDataUrl) && <span style={{ color: '#8799a9', fontSize: 12 }}>لإضافة الشعار، ارفعه أولاً من بيانات المنشأة.</span>}
        </div></details>
      </section><section><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, color: '#60788a', fontSize: 12 }}><b>معاينة حية · A4</b><span>PDF يُصدَّر كصفحات مصوّرة، وWord قابل للتحرير</span></div><div className="letters-preview-frame">{draft.layout ? <div ref={sheetRef} className="letters-canvas-pages">{Array.from({ length: draft.layout.pageCount ?? 1 }, (_, i) => <div key={i} className="letters-canvas-frame"><div className="letters-page-label">صفحة {i + 1}</div><LetterCanvas letter={draft} pageNumber={i + 1} selected={layoutTarget} onSelect={selectBox} onMove={moveBox} /></div>)}</div> : <Sheet letter={draft} sheetRef={sheetRef} />}</div></section></div>
    </>}
    {unsaved.prompt}
  </div>
}
