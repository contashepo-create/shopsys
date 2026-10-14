/**
 * أوامر الشراء — طلب المالك.
 * أمر الشراء التزام تجاري لا قيد محاسبي: يوثّق المطلوب من المورد بكمياته
 * وأسعاره وضريبته، ثم تُعبَّأ منه فاتورة الشراء بزر «تعبئة من» فتُرحَّل هي وحدها.
 *
 * **مطابق للفاتورة بالضبط (بلاغ v1.0.2)**: المحرر بالوضع المتقدم نفسه
 * (أعمدة الكود/الوحدة/المستودع لكل سطر/ملاحظات + تخصيص الحقول) وزر الاعتماد
 * يقول «اعتماد أمر الشراء» — لا «ترحيل» — لأن الأمر التزام تجاري لا قيد.
 *
 * **مستندي بالكامل (طلب المالك ㉘)**: المحرر بنفس هيئة فاتورة الشراء —
 * إطار InvoicePOSFrame وجدول بنود الفاتورة — بدل النافذة البسيطة السابقة.
 *
 * **تكافؤ «تسهيلات الاستخدام» مع الفاتورة (بلاغ المالك 2026-10-12)**: كان أمر
 * الشراء يحمل هيئة الفاتورة بلا أدواتها: لا مسحوبة أقسام، ولا بطاقة صنف،
 * ولا تكرار سطر/نقل، ولا مسودات، ولا مفاتيح طباعة، ولا حارس تغييرات.
 * الآن يقرأ **نفس** المكوّنات بنفس الخصائص — وبوابة `verify_purchase_order_parity`
 * تمنع أن يفقد الأمر خاصية موجودة في الفاتورة مرة أخرى.
 *
 * **إصلاح «لا أستطيع الكتابة في أول سطر» (بلاغ المالك 2026-10-12)**: كان
 * المحرر يُفتح بسطر فارغ جاهز (بلا صنف)، فيحتجز السطر الأول بلا خانة بحث،
 * وينزل مربع البحث إلى السطر الثاني. الآن يبدأ الجدول بلا سطور كما في الفاتورة
 * فيحمل السطر الأول نفسه خانة البحث/الباركود.
 */
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { Calculator, CalendarClock, CalendarDays, ClipboardList, Link2, Pencil, Plus, ScrollText, Send, Trash2, Truck, Warehouse as WarehouseIcon, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, Modal, guardNavigation, inputCls, useToast, useUnsavedChangesGuard } from '../components/ui.tsx'
import { QuickSelect, PartyQuickPicker, ItemQuickPicker } from '../components/KeyboardPickers.tsx'
import { formatMinor, toMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import {
  PURCHASE_ORDER_STATUS_AR, poRemainingQty, purchaseOrderTotals, suggestReorderLines,
  type PurchaseOrderLine, type PurchaseOrderStatus,
} from '../../core/purchaseOrders.ts'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { InvoiceLinesTable } from '../components/InvoiceLinesTable.tsx'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { buildWarehouseReceiptHtml } from '../../core/warehouseReceipt.ts'
import { printHtml } from '../print/printReceipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { shareDocPdfViaWhatsapp } from '../print/shareDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { usePrintSwitches } from '../hooks/usePrintSwitches.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { resolveBusinessTax } from '../../core/taxRegistration.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { partyNotesFor } from '../../core/partyNotes.ts'
import { useWindowHost } from '../windows/windowHostContext.ts'
import { openItemEditorWindow, openItemLedgerWindow, openItemPricesWindow, openPartyEditorWindow } from '../windows/windowStore.ts'
import { InvoiceDraftsModal } from '../components/InvoiceDraftsModal.tsx'
import { PrintTemplateModal } from '../components/PrintTemplateModal.tsx'
import { PrintSettingsPopup } from '../components/PrintSettingsPopup.tsx'
import { PartyQuickEditModal } from '../components/PartyQuickEditModal.tsx'
import { PartyNotesLog } from '../components/PartyNotesLog.tsx'

type DraftLine = PurchaseOrderLine & { key: string; warehouseId: number | null }

/** شروط توريد جاهزة تُضاف بضغطة إلى ملاحظات أمر الشراء — نفس نمط لوحة شروط الفاتورة */
const PURCHASE_TERMS = ['السداد بعد المطابقة والاستلام', 'ضمان المورد سنة على العيوب المصنعية', 'التوريد على نفقة المورد حتى المخزن', 'يُرد التالف خلال 7 أيام من الاستلام', 'التوريد على دفعات حسب جدول المشروع']

export function PurchaseOrdersPage() {
  const toast = useToast()
  const nav = useNavigate()
  const host = useWindowHost()
  const printSwitches = usePrintSwitches()
  const {
    purchaseOrders, addPurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder, suppliers, items, warehouses, branches, categories,
    advancedInvoiceDrafts, upsertAdvancedInvoiceDraft, deleteAdvancedInvoiceDraft,
    partyNotes, addPartyNote, appUsers, currentUserId, userPrefs, roleOverrides, customRoles, getSupplierBalance, tickets,
  } = useDataStore()
  const setup = useAppStore((s) => s.setup)
  const warehouseReceipt = useAppStore((s) => s.warehouseReceipt)
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (minor: number) => formatMinor(minor, cur, false)
  const taxPolicy = resolveBusinessTax(setup.taxRegistrationStatus, setup.vatPercent)
  const currentUser = appUsers.find((user) => user.id === currentUserId) ?? null
  const canViewCost = effectivePermissionsFor(currentUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId)).has('inv.cost.view')

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expectedDate, setExpectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [warehouseId, setWarehouseId] = useState<number | null>(setup.defaultWarehouseId ?? null)
  const [notes, setNotes] = useState('')
  /** مرجع داخلي (رقم عرض/طلبية) — يُحفظ مع ملاحظات الأمر كأول سطر */
  const [reference, setReference] = useState('')
  /** ربط أمر الشراء بتذكرة صيانة محددة (سد فجوة النشاط #3: طلب قطعة غيار خاصة لجهاز عميل بعينه) */
  const [linkedTicketId, setLinkedTicketId] = useState('')
  const openMaintenanceTickets = useMemo(() => tickets.filter((t) => t.status !== 'delivered' && t.status !== 'cancelled'), [tickets])
  /** يبدأ الجدول بلا سطور: أول سطر ظاهر يحمل خانة البحث — كما في فاتورة الشراء حرفياً */
  const [lines, setLines] = useState<DraftLine[]>([])
  const [applyTax, setApplyTax] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseOrderStatus>('all')
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const [partyNote, setPartyNote] = useState('')
  const [notesLogOpen, setNotesLogOpen] = useState(false)
  const [partyEditorOpen, setPartyEditorOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState(0)
  const [draftId] = useState(() => crypto.randomUUID())
  /* سطر التدقيق السفلي: متى حُفظت المسودة آخر مرة — كما تعرضه الفاتورة المرحّلة */
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  const totals = useMemo(() => purchaseOrderTotals(lines), [lines])
  const rows = useMemo(
    () => purchaseOrders.filter((order) => statusFilter === 'all' || order.status === statusFilter).slice().reverse(),
    [purchaseOrders, statusFilter],
  )
  // اقتراح أمر شراء تلقائي من حد الطلب (سد فجوة مشتركة: بقالة وأعلاف — طلب يدوي صنفاً صنفاً سابقاً)
  const reorderSuggestions = useMemo(() => suggestReorderLines(items), [items])
  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null
  const selectedSupplierBalance = selectedSupplier ? getSupplierBalance(selectedSupplier.id) : 0
  const focusedItem = (activeItemId != null ? items.find((item) => item.id === activeItemId) : null)
    ?? (lines.length ? items.find((item) => item.id === lines[lines.length - 1].itemId) ?? null : null)

  const patch = (key: string, value: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...value } : line)))

  /**
   * إضافة سطر — **تحترم الإدخال الذكي** كما تفعله فاتورة الشراء بالحرف:
   * «شاي*3@45» ⇒ كمية 3 وسعر وحدة 45، و«شاي» وحدها ⇒ كمية 1 بآخر تكلفة.
   * (كان الأمر يتجاهل الكمية/السعر المكتوبين فيخالف الفاتورة في نفس الكتابة.)
   */
  const addItem = (id: number, smart?: { qty?: number; price?: number; discount?: number }) => {
    const item = items.find((x) => x.id === id)
    if (!item) return
    const qty = smart?.qty && smart.qty > 0 ? smart.qty : 1
    const unitPriceMinor = smart?.price !== undefined ? toMinor(String(smart.price), cur.decimals) : (item.costMinor ?? 0)
    setLines((current) => [...current, {
      key: crypto.randomUUID(), itemId: item.id, nameAr: item.nameAr, qty, receivedQty: 0,
      unitAr: item.baseUnit ?? 'قطعة', unitPriceMinor,
      vatPercent: applyTax ? taxPolicy.effectivePercent : 0, notes: '', warehouseId,
    }])
  }
  /* نقرتان على اسم السطر ⇒ استبدال الصنف (نفس سلوك جدول الفاتورة) */
  const replaceLineItem = (key: string, id: number) => {
    const item = items.find((x) => x.id === id)
    if (!item) return
    patch(key, { itemId: item.id, nameAr: item.nameAr, unitAr: item.baseUnit ?? 'قطعة', unitPriceMinor: item.costMinor ?? 0 })
  }

  const reset = () => {
    setLines([]); setNotes(''); setReference(''); setSupplierId(null); setSupplierName(''); setApplyTax(false); setLastSavedAt(null)
    setActiveItemId(null); setPartyNote(''); setCategoryFilter(0); setLinkedTicketId('')
  }
  const openNew = () => {
    reset(); setDate(new Date().toISOString().slice(0, 10)); setExpectedDate(new Date().toISOString().slice(0, 10)); setOpen(true)
  }
  /** يفتح أمراً جديداً مُعبَّأً تلقائياً بكل الأصناف تحت حد الطلب — يبقى المورد والكميات والأسعار قابلة للمراجعة قبل الاعتماد */
  const openAutoReorder = () => {
    reset()
    const today = new Date().toISOString().slice(0, 10)
    setDate(today); setExpectedDate(today)
    setLines(reorderSuggestions.map((row) => ({
      key: crypto.randomUUID(), itemId: row.itemId, nameAr: row.nameAr, qty: row.suggestedQty, receivedQty: 0,
      unitAr: row.baseUnit, unitPriceMinor: row.costMinor, vatPercent: 0, notes: '', warehouseId,
    })))
    setNotes('أمر مُولَّد تلقائياً من تنبيه نقص المخزون (حد الطلب) — راجع الكميات والمورد قبل الاعتماد')
    setOpen(true)
    toast.show(`جُهِّز أمر شراء بـ ${reorderSuggestions.length} صنف تحت حد الطلب — راجعه قبل الاعتماد`)
  }

  /* ════ المسودات: نفس مخزن مسودات الفواتير بنوع مستقل (طلب المالك: تسهيلات الفاتورة كاملة) ════ */
  const saveDraft = () => {
    upsertAdvancedInvoiceDraft({
      id: draftId, kind: 'purchase_order',
      name: `مسودة أمر شراء — ${supplierId ? selectedSupplier?.nameAr ?? 'مورد' : supplierName.trim() || 'مورد نقدي'}`,
      payload: JSON.stringify({ supplierId, supplierName, date, expectedDate, warehouseId, notes, reference, applyTax, lines }),
    })
    unsaved.markClean()
    setLastSavedAt(new Date().toLocaleString('ar-EG'))
    toast.show('حُفظت مسودة أمر الشراء ✓ — تستعيدها من زر «المسودات»')
  }
  const applyDraft = (draft: { payload: string; name: string }) => {
    try {
      const data = JSON.parse(draft.payload)
      setSupplierId(data.supplierId ?? null); setSupplierName(data.supplierName ?? '')
      setDate(data.date ?? new Date().toISOString().slice(0, 10)); setExpectedDate(data.expectedDate ?? '')
      setWarehouseId(data.warehouseId ?? null); setNotes(data.notes ?? ''); setReference(data.reference ?? '')
      setApplyTax(data.applyTax ?? false); setLines(data.lines ?? [])
      toast.show(`استُعيدت «${draft.name}» ✓`)
    } catch { toast.show('تعذر قراءة المسودة', 'error') }
  }

  /* ════ الطباعة: نفس محرك قوالب الفواتير ومفاتيح الطباعة ════ */
  const buildPrintModel = () => buildSimpleDocModel({
    docTitle: 'أمر شراء (مسودة)',
    invoiceNumber: 'مسودة',
    refCode: 'DRAFT',
    dateIso: date,
    partyLabel: selectedSupplier?.nameAr ?? (supplierName.trim() || 'مورد نقدي'),
    paymentLabel: `التسليم المتوقع ${expectedDate}`,
    rows: lines.filter((l) => l.itemId > 0).map((l) => ({
      nameAr: `${items.find((i) => i.id === l.itemId)?.sku || ''} — ${items.find((i) => i.id === l.itemId)?.nameAr ?? l.nameAr}`,
      qty: l.qty, unitPriceMinor: l.unitPriceMinor, totalMinor: Math.round(l.qty * l.unitPriceMinor),
    })),
    totalMinor: totals.totalMinor,
    paidMinor: 0,
    operatorName: currentUser?.nameAr ?? setup.ownerName ?? 'المالك',
    settings: useAppStore.getState().receipt,
    extraFooter: [reference.trim() && `المرجع: ${reference.trim()}`, notes.trim()].filter(Boolean).join('\n') || undefined,
  })
  const printDraft = (template: InvoiceTemplate) => {
    if (!lines.length) return toast.show('أضف أصنافاً قبل المعاينة', 'error')
    const model = buildPrintModel()
    const live = useAppStore.getState().receipt
    if (!printSwitches.silentPrint) {
      openPrintPreview({
        html: buildModelHtml(model, cur, live, template), wide: template !== 'thermal',
        title: template !== 'thermal' ? 'معاينة أمر الشراء قبل الطباعة' : 'معاينة الإيصال',
        rebuild: () => { const r = useAppStore.getState().receipt; return buildModelHtml(buildPrintModel(), cur, r, template) },
      })
      return
    }
    printModelWithTemplate(model, cur, live, template)
  }
  const exportPdf = () => { if (!lines.length) return toast.show('أضف أصنافاً قبل التصدير', 'error'); toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️'); printDraft('a4') }
  const whatsappPdf = () => {
    if (!lines.length) return toast.show('أضف أصنافاً قبل الإرسال', 'error')
    shareDocPdfViaWhatsapp({
      model: buildPrintModel(), cur, settings: useAppStore.getState().receipt,
      docLabel: 'أمر شراء', docNumber: 'مسودة',
      partyPhone: selectedSupplier?.phone ?? '', shopName: setup.shopName, toast,
    })
  }
  /**
   * إذن استلام بنود الأمر (GRN) — كميات فقط بلا أي سعر، للمطابقة عند التسليم.
   * لا يُحرّك مخزوناً: الحركة الفعلية تُرحَّل مع فاتورة الشراء وحدها.
   */
  const printWarehouseReceipt = () => {
    const clean = lines.filter((line) => line.itemId > 0 && line.qty > 0)
    if (!clean.length) return toast.show('أضف أصنافاً قبل طباعة إذن الاستلام', 'error')
    printHtml(buildWarehouseReceiptHtml({
      title: 'إذن استلام بنود أمر شراء (كميات فقط)',
      docNumber: pendingDraftNumber(purchaseOrders),
      dateLabel: `التسليم المتوقع ${expectedDate}`,
      partyLabel: selectedSupplier?.nameAr ?? (supplierName.trim() || 'مورد نقدي'),
      branchLabel: branches.find((b) => b.warehouseId === warehouseId)?.nameAr ?? branches.find((b) => b.isMain)?.nameAr ?? warehouses.find((w) => w.id === warehouseId)?.nameAr ?? 'الفرع الرئيسي',
      companyName: setup.shopName ?? 'المنشأة',
      userLabel: currentUser?.nameAr ?? setup.ownerName ?? 'المالك',
      lines: clean.map((line) => {
        const item = items.find((row) => row.id === line.itemId)
        return { nameAr: item?.nameAr ?? line.nameAr, qty: line.qty, unit: item?.baseUnit, code: item?.sku, barcode: item?.barcodes?.[0], warehouseAr: warehouses.find((w) => w.id === (line.warehouseId ?? warehouseId))?.nameAr }
      }),
      settings: warehouseReceipt,
    }))
    toast.show('إذن الاستلام جاهز — كميات فقط بلا أسعار 📦 (لا يُحرّك المخزون)')
  }
  const quickPrint = () => printDraft((userPrefs[String(currentUserId ?? 'owner')]?.preferredPrintTemplate) ?? (printSwitches.cashierPrint ? 'thermal' : 'a4'))

  const submit = () => {
    try {
      const clean = lines.filter((line) => line.itemId > 0 && line.qty > 0)
        .map(({ key, warehouseId: _wh, ...line }) => { void key; void _wh; return line })
      const order = addPurchaseOrder({
        supplierId: supplierId ?? null,
        supplierName: selectedSupplier?.nameAr ?? (supplierName.trim() || 'مورد نقدي'),
        date,
        expectedDate,
        warehouseId,
        notes: [reference.trim(), notes.trim()].filter(Boolean).join('\n'),
        lines: clean,
        linkedTicketId: linkedTicketId ? Number(linkedTicketId) : null,
      })
      const text = partyNote.trim()
      if (text && selectedSupplier) { try { addPartyNote({ partyKind: 'supplier', partyId: selectedSupplier.id, text, userName: currentUser?.nameAr ?? setup.ownerName ?? 'المالك', source: order.orderNumber }) } catch { /* الملاحظة لا تمنع اعتماد الأمر */ } }
      try { deleteAdvancedInvoiceDraft(draftId) } catch { /* لا مسودة محفوظة */ }
      toast.show(`سُجّل أمر الشراء ${order.orderNumber} — عبّئ منه فاتورة الشراء عند الاستلام (زر «تعبئة من»)`)
      unsaved.markClean()
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* حارس التغييرات غير المحفوظة — نفس نمط فاتورة الشراء */
  const signature = JSON.stringify({ supplierId, supplierName, date, expectedDate, warehouseId, notes, reference, applyTax, lines, linkedTicketId })
  const unsaved = useUnsavedChangesGuard(signature)
  const closeEditor = () => setOpen(false)
  useEffect(() => {
    if (!host) return
    host.setDirty(unsaved.isDirty)
    host.setClosePrompt({
      hint: 'أمر الشراء لم يُعتمد بعد — «اعتماد» يحفظه في السجل، أو احفظه مسودة وأكمل لاحقاً.',
      saveLabel: 'حفظ كمسودة ثم الإغلاق', discardLabel: 'إغلاق ومسح ما كتبت',
      onSave: () => { saveDraft(); host.close() }, onDiscard: () => { try { deleteAdvancedInvoiceDraft(draftId) } catch { /* لا مسودة */ } host.close() },
    })
    return () => host.setClosePrompt(null)
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- تسجيل حوار الإغلاق مرة لكل نافذة؛ الدوال تقرأ الحالة الحالية عند الاستدعاء
  }, [host])

  /* ════ محرر المستند (نفس هيئة فاتورة الشراء وأدواتها — طلب المالك ㉘ + ٢٠٢٦-١٠-١٢) ════ */
  if (open) {
    const cleanLines = lines.filter((l) => l.itemId > 0)
    return (
      <div data-po-doc-editor>
        <InvoicePOSFrame
          kind="purchase"
          docKind="purchase_order"
          modeLabel="أمر شراء"
          currencyLabel={`${cur.code} · ${cur.symbol}`}
          dateLabel={date}
          branchLabel={branches.find((b) => b.warehouseId === warehouseId)?.nameAr ?? branches.find((b) => b.isMain)?.nameAr ?? warehouses.find((w) => w.id === warehouseId)?.nameAr ?? 'وضع الفرع الواحد'}
          userLabel={currentUser?.nameAr ?? setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber={pendingDraftNumber(purchaseOrders)}
          draftCount={advancedInvoiceDrafts.filter((d) => d.kind === 'purchase_order').length}
          onBack={() => unsaved.requestClose(closeEditor)}
          onNavigate={(path) => { if (!guardNavigation(() => nav(path))) nav(path) }}
          onPartySearch={() => window.dispatchEvent(new Event('shopsys:open-party'))}
          onItemSearch={() => window.dispatchEvent(new Event('shopsys:open-item'))}
          onSaveDraft={saveDraft}
          onRestoreDraft={() => setDraftsOpen(true)}
          onPrint={() => setPrintOpen(true)}
          onOpenPrintSettings={() => setPrintSettingsOpen(true)}
          onQuickPrint={quickPrint}
          onWarehouseReceipt={printWarehouseReceipt}
          auditLabel={lastSavedAt ? `آخر حفظ ${lastSavedAt}` : undefined}
          onExportPdf={exportPdf}
          onWhatsappPdf={whatsappPdf}
          onPost={submit}
          postLabel="اعتماد أمر الشراء"
          headerFields={
            <>
              <Field label="المورد" icon={<Truck size={11} />}>
                <div className="invoice-pos-party-field invoice-doc-infield">
                  <button type="button" className="invoice-pos-edit-party" title="تعديل بيانات المورد"
                    onClick={() => { if (host && selectedSupplier) { openPartyEditorWindow('supplier', selectedSupplier.id, host.windowId); return } setPartyEditorOpen(true) }}
                    disabled={!selectedSupplier}><Pencil size={8} /></button>
                  <PartyQuickPicker
                    parties={suppliers} value={supplierId ?? 0} cashValue={0} cashLabel="مورد نقدي" label="بحث المورد — F4"
                    onChange={(id) => { setSupplierId(id || null); const s = suppliers.find((x) => x.id === id); setSupplierName(s?.nameAr ?? '') }}
                    partyInfo={(party) => ({ code: partyCode('SUP', party.id), balance: `الرصيد ${fmt(Math.abs(getSupplierBalance(party.id)))} ${cur.symbol} ${getSupplierBalance(party.id) > 0 ? 'مستحق له' : getSupplierBalance(party.id) < 0 ? 'لك عنده' : ''}` })}
                    onConfirm={() => window.dispatchEvent(new Event('shopsys:focus-item'))} autoFocus
                  />
                  <span className="invoice-doc-infield-chip">{selectedSupplier ? partyCode('SUP', selectedSupplier.id) : 'CASH'}</span>
                </div>
                {!selectedSupplier && <input className={`${inputCls} mt-1`} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="أو اكتب اسم مورد غير مسجَّل (نقدي إن ترك فارغاً)" aria-label="اسم المورد" />}
              </Field>
              <Field label="تاريخ الأمر" icon={<CalendarDays size={11} />}><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" /></Field>
              <Field label="التسليم المتوقع" icon={<CalendarClock size={11} />}><input type="date" min={date} className={inputCls} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} dir="ltr" /></Field>
              <Field label="مخزن الاستلام" icon={<WarehouseIcon size={11} />}>
                <QuickSelect className={inputCls} value={warehouseId ?? ''} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; setWarehouseId(id); setLines((ls) => ls.map((l) => ({ ...l, warehouseId: id }))) }}>
                  <option value="">كل المخازن — اختيار لكل سطر</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                </QuickSelect>
              </Field>
              <Field label="المرجع" icon={<Link2 size={11} />}>
                <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="مرجع داخلي أو رقم عرض المورد — اختياري" aria-label="مرجع أمر الشراء" />
              </Field>
              {setup.modules.includes('maintenance') && (
                <Field label="تذكرة صيانة مرتبطة" hint="لطلب قطعة غيار خاصة لجهاز عميل بعينه — اختياري">
                  <QuickSelect className={inputCls} value={linkedTicketId} onChange={(e) => setLinkedTicketId(e.target.value)}>
                    <option value="">— بلا ربط —</option>
                    {openMaintenanceTickets.map((t) => <option key={t.id} value={t.id}>{t.ticketNumber} — {t.deviceName}</option>)}
                  </QuickSelect>
                </Field>
              )}
            </>
          }
          partyProfile={
            <>
              <div className="invoice-doc-cardhead"><b><Truck size={11} /> {selectedSupplier ? 'حساب المورد' : 'الشراء النقدي'}</b>
                <span className={`invoice-party-state ${!selectedSupplier ? 'is-cash' : selectedSupplier.active === false ? 'is-off' : ''}`}><i />{!selectedSupplier ? 'نقدي' : selectedSupplier.active === false ? 'موقوف' : 'نشط'}</span></div>
              <div className="invoice-doc-metric"><span>شروط السداد</span><b>{selectedSupplier?.paymentTermsDays ? `${selectedSupplier.paymentTermsDays} يوم` : 'نقدي'}</b></div>
              <div className="invoice-doc-metric"><span>الرصيد السابق</span><b dir="ltr">{selectedSupplier ? `${fmt(Math.abs(selectedSupplierBalance))} ${cur.symbol}` : 'نقدي'}</b></div>
              <div className="invoice-doc-cardfoot"><span>الرصيد بعد ترحيل فاتورته</span><b dir="ltr" title="أمر الشراء لا يُحرّك الرصيد — هذا ما سيصير عليه عند ترحيل فاتورة الشراء المستلمة">{selectedSupplier ? `${fmt(Math.abs(selectedSupplierBalance + totals.totalMinor))} ${cur.symbol}` : 'نقدي'}</b></div>
            </>
          }
          partyMeta={
            <div className="invoice-doc-partymeta">
              <span>المورد: <b>{selectedSupplier?.nameAr ?? (supplierName.trim() || 'مورد نقدي')}</b></span>
              <span>التسليم: <b>{expectedDate}</b></span>
              <span>مخزن الاستلام: <b>{warehouses.find((w) => w.id === warehouseId)?.nameAr ?? 'كل المخازن'}</b></span>
              <span>الأصناف: <b>{cleanLines.length}</b></span>
              <span>الإجمالي: <b className="font-mono">{fmt(totals.totalMinor)} {cur.symbol}</b></span>
              <label className="invoice-doc-stripcheck" title="خضوع أمر الشراء للضريبة — يُنقل إلى الفاتورة عند التعبئة">
                <input type="checkbox" checked={applyTax} onChange={(e) => {
                  const enabled = e.target.checked
                  setApplyTax(enabled)
                  setLines((previous) => previous.map((line) => ({ ...line, vatPercent: enabled ? taxPolicy.effectivePercent : 0 })))
                }} /> خاضعة للضريبة {applyTax ? `${taxPolicy.effectivePercent}%` : ''}
              </label>
              <span className="invoice-doc-stripfield">أمر بلا قيد
                <b className="invoice-doc-strip-v">لا يُحرّك المخزون ولا «الموردون» — يُرحَّل مع فاتورة الشراء</b>
              </span>
            </div>
          }
          itemProfile={focusedItem ? (
            <>
              <span className="invoice-doc-strip-k">الصنف المحدد</span><span className="invoice-doc-strip-v">{focusedItem.nameAr}</span>
              <span className="invoice-doc-stripsep" aria-hidden="true" />
              <span className="invoice-doc-strip-k">المتاح</span><span className="invoice-doc-strip-v" dir="ltr">{focusedItem.isService ? 'خدمة' : `${focusedItem.stockQty ?? 0} ${focusedItem.baseUnit ?? ''}`}</span>
              {canViewCost && <><span className="invoice-doc-stripsep" aria-hidden="true" /><span className="invoice-doc-strip-k">متوسط التكلفة</span><span className="invoice-doc-strip-v" dir="ltr">{fmt(focusedItem.costMinor ?? 0)}</span></>}
              <span className="invoice-doc-stripsep" aria-hidden="true" />
              <span className="invoice-doc-strip-k">سعر البيع الحالي</span><span className="invoice-doc-strip-v is-ok" dir="ltr">{fmt(focusedItem.priceMinor ?? 0)}</span>
            </>
          ) : undefined}
        >
          <section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark" data-po-lines>
            <div className="invoice-body-grid">
              <div className="invoice-lines-column">
                <InvoiceLinesTable
                  entry={<ItemQuickPicker
                    items={items.filter((item) => item.isActive !== false && (categoryFilter === 0 || item.categoryId === categoryFilter))}
                    onPick={addItem}
                    onEdit={(id) => openItemEditorWindow(id, host?.windowId ?? null)}
                    onMovement={(id) => openItemLedgerWindow(id, host?.windowId ?? null)}
                    onPrices={(id) => openItemPricesWindow(id, host?.windowId ?? null)}
                    itemMeta={(item) => ({
                      category: categories.find((cat) => cat.id === item.categoryId)?.nameAr ?? '—',
                      unit: item.baseUnit ?? '',
                      stock: item.isService ? 'خدمة' : String(item.stockQty ?? 0),
                      low: !item.isService && (item.stockQty ?? 0) <= 0,
                      price: fmt(item.priceMinor ?? 0),
                      cost: fmt(item.costMinor ?? 0),
                    })}
                    categories={categories}
                    amountLabel={(item) => `متاح ${item.stockQty ?? 0} · تكلفة ${fmt(item.costMinor ?? 0)}`}
                    placeholder="امسح الباركود أو اكتب اسم الصنف / الكود السريع"
                  />}
                  entryFilter={<QuickSelect className={inputCls} aria-label="تصفية الأصناف بالتصنيف" value={categoryFilter} onChange={(e) => setCategoryFilter(Number(e.target.value))}>
                    <option value={0}>كل الأصناف</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.nameAr}</option>)}
                  </QuickSelect>}
                  kind="purchase"
                  mode="advanced"
                  lines={lines.map((line) => ({ ...line, warehouseId: line.warehouseId ?? warehouseId }))}
                  items={items}
                  warehouses={warehouses}
                  warehouseId={warehouseId}
                  currencyCode={cur.code}
                  currencyDecimals={cur.decimals}
                  currencySymbol={cur.symbol}
                  canViewCost={canViewCost}
                  taxEnabled={applyTax && taxPolicy.effectivePercent > 0}
                  documentTaxPercent={applyTax ? taxPolicy.effectivePercent : 0}
                  onPick={addItem}
                  onActiveItem={setActiveItemId}
                  onPatch={(key, value) => patch(key, value as Partial<DraftLine>)}
                  onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
                  onDuplicate={(key) => setLines((previous) => {
                    const source = previous.find((line) => line.key === key)
                    if (!source) return previous
                    const at = previous.findIndex((line) => line.key === key)
                    return [...previous.slice(0, at + 1), { ...source, key: crypto.randomUUID() }, ...previous.slice(at + 1)]
                  })}
                  onMoveLine={(key, direction) => setLines((previous) => {
                    const at = previous.findIndex((line) => line.key === key)
                    const to = at + direction
                    if (at < 0 || to < 0 || to >= previous.length) return previous
                    const next = [...previous]
                    const [row] = next.splice(at, 1)
                    next.splice(to, 0, row)
                    return next
                  })}
                  onReplaceLine={replaceLineItem}
                  onEdit={(id) => openItemEditorWindow(id, host?.windowId ?? null)}
                  onMovement={(id) => openItemLedgerWindow(id, host?.windowId ?? null)}
                  onPrices={(id) => openItemPricesWindow(id, host?.windowId ?? null)}
                  amountLabel={(item) => `متاح ${item.stockQty ?? 0} · تكلفة ${fmt(item.costMinor ?? 0)}`}
                  placeholder="اكتب اسم الصنف المطلوب؛ ثم اختر بالسهم + Enter"
                  showPicker={false}
                />
              </div>
            </div>

            <section className="invoice-totals-footer">
              <div className="invoice-doc-panel" data-po-notes>
                <div className="invoice-doc-panel-head"><span className="invoice-doc-panel-icon"><ScrollText size={11} /></span><b>شروط التوريد والملاحظات</b><small>تُطبع في نسخة المورد</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-quick">
                    {PURCHASE_TERMS.map((term) => (
                      <button key={term} type="button" onClick={() => setNotes(notes.trim() ? `${notes.trim()}\n${term}` : term)}>+ {term}</button>
                    ))}
                  </div>
                  <textarea className={`${inputCls} invoice-doc-termsbox`} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="شروط التوريد" placeholder="شروط التوريد — تظهر في نسخة المورد" />
                </div>
                <div className="invoice-doc-panel-foot">
                  <span>ملاحظة تُحفظ في سجل ملاحظات <b>{selectedSupplier?.nameAr ?? 'المورد'}</b></span>
                  <Button type="button" className="invoice-doc-notebtn" onClick={() => { if (!selectedSupplier) return toast.show('اختر مورداً مسجَّلاً لعرض سجل ملاحظاته', 'error'); setNotesLogOpen(true) }}>📒 سجل الملاحظات{selectedSupplier && partyNotesFor(partyNotes, 'supplier', selectedSupplier.id).length > 0 ? ` (${partyNotesFor(partyNotes, 'supplier', selectedSupplier.id).length})` : ''}</Button>
                  <input className={inputCls} value={partyNote} onChange={(e) => setPartyNote(e.target.value)} placeholder={selectedSupplier ? `اكتب ملاحظة عن ${selectedSupplier.nameAr} — تُحفظ باسم أمر الشراء` : 'اختر مورداً مسجَّلاً لحفظ الملاحظة في سجله'} aria-label="ملاحظة تُحفظ في سجل ملاحظات المورد" />
                </div>
              </div>
              <div className="invoice-doc-panel" data-po-totals>
                <div className="invoice-doc-panel-head"><span className="invoice-doc-panel-icon"><Calculator size={11} /></span><b>إجماليات الأمر</b><small>التزام تجاري — لا قيد حتى فاتورة الشراء</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-sum-row"><span>قيمة البضاعة</span><i /><b className="font-mono">{fmt(totals.netMinor)}</b></div>
                  {totals.taxMinor > 0 && <div className="invoice-doc-sum-row"><span>ضريبة القيمة المضافة</span><i /><b className="font-mono">{fmt(totals.taxMinor)}</b></div>}
                  <div className="invoice-doc-sum-row is-strong"><span>إجمالي الأمر</span><i /><b className="font-mono">{fmt(totals.totalMinor)} {cur.symbol}</b></div>
                  <div className="invoice-doc-sum-row is-info"><span>الكميات المطلوبة</span><i /><b className="font-mono">{totals.qty}</b></div>
                  <div className="invoice-doc-sum-row is-info"><span>المُستلَم لاحقاً</span><i /><b>تُعبَّأ فاتورة الشراء من هذا الأمر</b></div>
                </div>
                <div className="invoice-doc-panel-foot"><span>بنود السجل</span><b>{cleanLines.length} صنف</b><span className="is-due">المتبقي للاستلام</span><b>{lines.reduce((sum, line) => sum + Math.max(0, line.qty - (line.receivedQty ?? 0)), 0)}</b></div>
              </div>
            </section>
          </section>
        </InvoicePOSFrame>
        {unsaved.prompt}
        <InvoiceDraftsModal
          open={draftsOpen} onClose={() => setDraftsOpen(false)} kind="purchase_order"
          drafts={advancedInvoiceDrafts} currency={cur} currentDraftId={draftId}
          onPick={(draft) => { applyDraft(draft); setDraftsOpen(false) }} onDelete={deleteAdvancedInvoiceDraft}
        />
        <PrintTemplateModal open={printOpen} onClose={() => setPrintOpen(false)} defaultTemplate={useAppStore.getState().receipt.defaultTemplate} title="معاينة نسخة المورد" onPrint={printDraft} />
        <PrintSettingsPopup open={printSettingsOpen} onClose={() => setPrintSettingsOpen(false)} wide={!printSwitches.cashierPrint} />
        <PartyQuickEditModal open={partyEditorOpen} target={selectedSupplier ? { kind: 'supplier', party: selectedSupplier } : null} currencyDecimals={cur.decimals} currencySymbol={cur.symbol} onClose={() => setPartyEditorOpen(false)} />
        <Modal open={notesLogOpen && !!selectedSupplier} onClose={() => setNotesLogOpen(false)} title={`سجل ملاحظات ${selectedSupplier?.nameAr ?? 'المورد'}`}>
          {selectedSupplier && <PartyNotesLog kind="supplier" partyId={selectedSupplier.id} partyName={selectedSupplier.nameAr} />}
        </Modal>
      </div>
    )
  }

  /* ════ قائمة الأوامر ════ */
  return (
    <div className="space-y-4" data-po-list>
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><ClipboardList className="w-6 h-6 text-cyan-500" /> أوامر الشراء</h1>
        <div className="flex items-center gap-2">
          <QuickSelect className={inputCls + ' w-44'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | PurchaseOrderStatus)} aria-label="فلتر الحالة">
            <option value="all">كل الحالات</option>
            {(Object.keys(PURCHASE_ORDER_STATUS_AR) as PurchaseOrderStatus[]).map((status) => <option key={status} value={status}>{PURCHASE_ORDER_STATUS_AR[status]}</option>)}
          </QuickSelect>
          {advancedInvoiceDrafts.some((draft) => draft.kind === 'purchase_order') && (
            <Btn onClick={() => { reset(); setOpen(true); setDraftsOpen(true) }} title="استعادة مسودة أمر شراء محفوظة">📂 المسودات ({advancedInvoiceDrafts.filter((draft) => draft.kind === 'purchase_order').length})</Btn>
          )}
          <Btn onClick={openNew}><Plus size={15} /> أمر شراء</Btn>
        </div>
      </div>

      {reorderSuggestions.length > 0 && (
        <div className="anim-up rounded-2xl border-2 border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[12.5px] font-bold text-amber-700 dark:text-amber-400">
            ⚠️ {reorderSuggestions.length} صنف تحت حد الطلب — يمكن توليد أمر شراء مقترح بكمياته تلقائياً
          </div>
          <Btn variant="soft" onClick={openAutoReorder}>⚡ إنشاء أمر شراء تلقائي</Btn>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-8 text-center text-[13px] text-slate-400">
          لا أوامر شراء بعد — سجّل أمراً جديداً ثم عبّئ منه فاتورة الشراء عند الاستلام.
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">الأمر</th>
                <th className="px-4 py-2.5">المورد</th>
                <th className="px-4 py-2.5">التسليم المتوقع</th>
                <th className="px-4 py-2.5">البنود</th>
                <th className="px-4 py-2.5">الإجمالي</th>
                <th className="px-4 py-2.5">الحالة</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const total = purchaseOrderTotals(order.lines)
                const pending = order.lines.reduce((sum, line) => sum + poRemainingQty(line), 0)
                return (
                  <tr key={order.id} data-po-row={order.orderNumber} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-black text-slate-800 dark:text-white">{order.orderNumber}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{order.date}</div>
                      {order.linkedTicketId != null && (
                        <div className="text-[10px] text-indigo-500 mt-0.5">🧩 {tickets.find((t) => t.id === order.linkedTicketId)?.ticketNumber ?? `#${order.linkedTicketId}`}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{order.supplierName}</td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-400 font-mono">{order.expectedDate}</td>
                    <td className="px-4 py-2.5 text-slate-500">{order.lines.length}{pending > 0 && <span className="text-[10.5px] text-amber-600"> (متبقٍ {pending})</span>}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-white">{fmt(total.totalMinor)} <span className="text-[10px] text-slate-400">{cur.symbol}</span></td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                        order.status === 'closed' ? 'bg-emerald-500/10 text-emerald-600' : order.status === 'partial' ? 'bg-amber-500/10 text-amber-600' : order.status === 'cancelled' ? 'bg-rose-500/10 text-rose-500' : 'bg-green-500/10 text-green-600'
                      }`}>{PURCHASE_ORDER_STATUS_AR[order.status]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-left">
                      <div className="flex gap-1 justify-end">
                        {order.status === 'draft' && (
                          <button onClick={() => { try { setPurchaseOrderStatus(order.id, 'sent'); toast.show('عُلّم الأمر كمُرسل للمورد ✓') } catch (e) { toast.show((e as Error).message, 'error') } }} title="إرسال للمورد" className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-500/10 transition-all"><Send size={14} /></button>
                        )}
                        {order.status !== 'cancelled' && order.status !== 'closed' && (
                          <button onClick={() => { try { setPurchaseOrderStatus(order.id, 'cancelled'); toast.show('أُلغي الأمر') } catch (e) { toast.show((e as Error).message, 'error') } }} title="إلغاء" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><XCircle size={14} /></button>
                        )}
                        {order.status !== 'closed' && order.status !== 'cancelled' && (
                          <button onClick={() => nav(`/purchases/invoices/new?po=${order.id}`)} title="فتح فاتورة شراء معبَّأة من بنود هذا الأمر المتبقية مباشرة" className="px-2 py-1 rounded-lg text-[10.5px] font-bold text-cyan-700 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all dark:text-cyan-300">فاتورة استلام</button>
                        )}
                        {order.status === 'draft' && (
                          <button onClick={() => { try { deletePurchaseOrder(order.id); toast.show('حُذف الأمر') } catch (e) { toast.show((e as Error).message, 'error') } }} title="حذف" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * رقم الأمر القادم كما سيُمنح فعلاً — عرضٌ تعريفي (الترقيم الحقيقي في المخزن عند الاعتماد).
 * يُحسب من **أكبر معرّف موجود + 1** لا من عدد الأوامر: حذف أمر قديم كان يجعل
 * الرقم المعروض يكرر رقماً مسجَّلاً بالفعل (`nextId` في المخزن يستعمل نفس القاعدة).
 */
function pendingDraftNumber(existing: readonly { id: number }[]): string {
  const next = existing.reduce((max, order) => Math.max(max, order.id), 0) + 1
  return `PO-${String(next).padStart(4, '0')} (مسودة)`
}

/** زر نصي بنمط أزرار اللوحات — بلا حد ولا خلفية (نفس شكل «ملاحظات المورد» في الفاتورة) */
function Button(props: ComponentProps<'button'>) {
  return <button {...props} className={`invoice-doc-notebtn ${props.className ?? ''}`} />
}
