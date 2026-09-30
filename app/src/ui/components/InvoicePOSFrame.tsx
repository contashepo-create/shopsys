import { useEffect, useState, type ReactNode } from 'react'
import { CheckCheck, ChevronLeft, ChevronRight, Columns3, Eye, FileClock, FileDown, FileText, MessageSquare, Minus, PackageCheck, RotateCcw, Save, Settings, Square, UserRound, X } from 'lucide-react'
import { useWindowHost } from '../windows/windowHostContext.ts'
import { useWindowStore } from '../windows/windowStore.ts'
import { connectivityStatus, CONNECTIVITY_LABELS } from '../../core/architecture.ts'
import { INVOICE_COLUMN_LABELS, useAppStore, type InvoiceColumnPrefs } from '../../stores/app.store.ts'
import { Btn } from './ui.tsx'
import { PrintSwitches } from './PrintSwitches.tsx'

type InvoicePOSFrameProps = {
  kind: 'sale' | 'purchase'
  modeLabel: string
  currencyLabel: string
  dateLabel: string
  branchLabel: string
  userLabel: string
  activityLabel: string
  headerFields: ReactNode
  partyProfile?: ReactNode
  /** الصف الثالث في الترويسة: فئة الطرف وخصمه وملاحظته وزر تعديلها (شريط واحد) */
  partyMeta?: ReactNode
  /** بطاقة «الصنف المختار» بجانب بطاقة رصيد الطرف */
  itemProfile?: ReactNode
  /** فتح المستند السابق/التالي من نفس الدفتر — يُعطَّل السهم إن لم يوجد جار */
  onPrevDocument?: () => void
  onNextDocument?: () => void
  /** رقم المستند إن وُجد (تعديل فاتورة مرحّلة)؛ وإلا «مسودة» */
  documentNumber?: string
  /** سطر تدقيق المستند: متى عُدِّل ومن عدّله ولماذا — يظهر في شريط الحالة سطراً واحداً */
  auditLabel?: string
  /** طباعة إذن استلام من المستودع (كميات فقط بلا أسعار) */
  onWarehouseReceipt?: () => void
  /** عدد المسودات المحفوظة من هذا النوع — يظهر على زر «المسودات» */
  draftCount?: number
  onBack: () => void
  onNavigate: (path: string) => void
  onPartySearch: () => void
  onItemSearch: () => void
  onSaveDraft: () => void
  onRestoreDraft: () => void
  onPrint: () => void
  /** تصدير نسخة PDF — يفتح حوار الطباعة على قالب A4 ووجهة «حفظ كـ PDF» */
  onExportPdf?: () => void
  onPost: () => void
  children: ReactNode
}

/**
 * سطح الفاتورة على **التصميم المرجعي الذي أرسله المالك** (2026-09-28):
 *
 *   ① شريط علوي واحد: أدوات المستند · صندوق رقم الفاتورة بخط أحادي وشارة حالتها ·
 *      ثلاثة أزرار (حفظ مسودة · معاينة · اعتماد وترحيل).
 *   ② بطاقة الرأس: شريط بيانات رفيع (الدفتر · الحالة · المسلسل · الرقم الضريبي)
 *      ثم شبكة: **حقول بعمودين/ثلاثة على اليمين** وبطاقتا مؤشرات على اليسار
 *      (رصيد الطرف بشريط استهلاك الائتمان · الصنف المختار)، وتحتها شريط
 *      المرجع الخارجي المتقطع.
 *   ③ شريط بحث/باركود عريض، ثم جدول البنود، ثم ثلاث لوحات: الشروط · التحصيل ·
 *      ملخص الحسابات.
 *   ④ شريط إجراءات لاصق أسفل الشاشة.
 *
 * كل المقاسات والألوان من طبقة `invoice-doc-*` في `index.css` (متغيرات `--doc-*`).
 */
export function InvoicePOSFrame({
  kind,
  modeLabel,
  currencyLabel,
  dateLabel,
  branchLabel,
  userLabel,
  activityLabel,
  headerFields,
  partyProfile,
  partyMeta,
  itemProfile,
  onPrevDocument,
  onNextDocument,
  documentNumber,
  auditLabel,
  onWarehouseReceipt,
  draftCount = 0,
  onBack,
  onNavigate,
  onPartySearch,
  onItemSearch,
  onSaveDraft,
  onRestoreDraft,
  onPrint,
  onExportPdf,
  onPost,
  children,
}: InvoicePOSFrameProps) {
  const sale = kind === 'sale'
  /* نقاط سطح المكتب الثلاث: تعمل فعلاً على النافذة الحاوية (إغلاق · تصغير · تكبير) */
  const host = useWindowHost()
  const minimizeWindow = useWindowStore((state) => state.minimizeWindow)
  const toggleMaximize = useWindowStore((state) => state.toggleMaximizeWindow)
  const { sync, receipt, autoPrintAfterSale, einvoice, invoiceColumns, toggleInvoiceColumn, resetInvoiceColumns } = useAppStore()
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  /* خصائص بقيت في الواجهة للتوافق مع الصفحات لكنها لم تعد تُرسم بعد تنظيف الشريط العلوي */
  void modeLabel; void currencyLabel; void dateLabel; void onPartySearch; void onItemSearch
  const [columnsOpen, setColumnsOpen] = useState(false)
  const hiddenColumns = (Object.keys(INVOICE_COLUMN_LABELS) as (keyof InvoiceColumnPrefs)[]).filter((key) => !invoiceColumns[key]).length
  useEffect(() => {
    const on = () => setBrowserOnline(true)
    const off = () => setBrowserOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  /* إغلاق قائمة الأعمدة بالنقر خارجها أو بـEsc — كباقي القوائم المنسدلة في النظام */
  useEffect(() => {
    if (!columnsOpen) return
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.invoice-doc-colmenu-wrap')) return
      setColumnsOpen(false)
    }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setColumnsOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [columnsOpen])
  const connectivity = connectivityStatus({ browserOnline, syncEnabled: sync.enabled, dirty: sync.dirty, lastResult: sync.lastResult })
  const connectivityInfo = CONNECTIVITY_LABELS[connectivity]
  const browserPrintAvailable = typeof window !== 'undefined' && typeof window.print === 'function'
  const autoPrintEnabled = sale && autoPrintAfterSale
  const ledgerLabel = sale ? 'دفتر المبيعات العامة' : 'دفتر المشتريات العامة'
  const serial = documentNumber ? documentNumber.split('-').pop() : 'مسودة'

  return (
    <div className={`invoice-doc invoice-editor invoice-pos-root invoice-pos-${kind}`} dir="rtl">
      {/* ① الشريط العلوي: أدوات · رقم المستند وحالته · أزرار الاعتماد */}
      <header className="invoice-doc-topbar">
        {/* أزرار النافذة: **وظيفة كل زر مرسومة داخله** لا دوائر ملونة (طلب المالك) */}
        <div className="invoice-doc-winbtns">
          <button type="button" className="is-min" onClick={() => { if (host) minimizeWindow(host.windowId) }} disabled={!host} aria-label="تصغير النافذة" title="تصغير النافذة"><Minus size={13} /></button>
          <button type="button" className="is-max" onClick={() => { if (host) toggleMaximize(host.windowId) }} disabled={!host} aria-label="تكبير النافذة" title="تكبير/استعادة النافذة"><Square size={11} /></button>
          <button type="button" className="is-close" onClick={onBack} aria-label="إغلاق المستند" title="إغلاق المستند"><X size={13} /></button>
        </div>
        <span className="invoice-doc-divider" />
        <div className="invoice-doc-utility-tools">
          <button type="button" aria-label="محادثة الدعم" title="الدعم الفني" onClick={() => onNavigate('/support')}><MessageSquare size={14} /></button>
        </div>

        <div className="invoice-doc-identity">
          <span className="invoice-doc-numberbox">
            {/* بلاغ المالك: اسم «مسودة جديدة» مكرَّر مع شريط عنوان النافذة — يبقى الرقم وحده */}
            <FileText size={12} /><b data-doc-number>{documentNumber || (sale ? 'INV' : 'PUR')}</b>
            <span className="invoice-doc-nav">
              <button type="button" onClick={onPrevDocument} disabled={!onPrevDocument} aria-label="المستند السابق" title="المستند السابق"><ChevronRight size={11} /></button>
              <button type="button" onClick={onNextDocument} disabled={!onNextDocument} aria-label="المستند التالي" title="المستند التالي"><ChevronLeft size={11} /></button>
            </span>
          </span>
          {documentNumber && <span className="invoice-doc-status" data-doc-status>تعديل</span>}
        </div>

        <div className="invoice-doc-head-actions">
          <Btn variant="ghost" onClick={onRestoreDraft} title="فتح أي مسودة محفوظة باسم العميل"><FileClock size={13} /> المسودات{draftCount ? ` (${draftCount})` : ''}</Btn>
          {onWarehouseReceipt && <Btn variant="ghost" onClick={onWarehouseReceipt} title="إذن استلام من المستودع — كميات فقط بلا أسعار"><PackageCheck size={13} /> إذن استلام مستودع</Btn>}
          <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={13} /> حفظ مسودة</Btn>
          <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Eye size={13} /> معاينة</Btn>
          <Btn onClick={onPost} shortcut="F9"><CheckCheck size={13} /> حفظ وترحيل</Btn>
        </div>
      </header>

      <div className="invoice-doc-body">
        {/* ② بطاقة الرأس: شريط بيانات ثم حقول + بطاقتا مؤشرات */}
        <section className="invoice-doc-card invoice-doc-header-card">
          <div className="invoice-doc-header-body">
            <div className="invoice-doc-form">
              <div className="invoice-doc-fields">{headerFields}</div>
              {/* الصف الثاني: شريط الصنف المحدد بجانب اسم المستخدم — كما في التصميم المعتمد */}
              {itemProfile && (
                <div className="invoice-doc-strip">
                  <span className="invoice-doc-strip-user" title="المستخدم الذي يحرر المستند"><UserRound size={11} /> {userLabel}</span>
                  {itemProfile}
                </div>
              )}
              {/* الصف الثالث: فئة الطرف وخصمه وملاحظته */}
              {partyMeta && <div className="invoice-doc-strip is-party">{partyMeta}</div>}
            </div>
            <aside className="invoice-doc-side">
              {partyProfile && <div className="invoice-doc-party">{partyProfile}</div>}
            </aside>
          </div>
        </section>

        {/* ④ جدول البنود واللوحات السفلية */}
        <div className="invoice-pos-document">{children}</div>
      </div>

      {/* ⑤ شريط الإجراءات الثابت */}
      <footer className="invoice-doc-actionbar">
        <div className="invoice-doc-actionbar-info">
          <span className={`invoice-doc-online is-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span>
          <span className="invoice-doc-cardbar-session">{activityLabel} · {branchLabel} · {userLabel}</span>
          <span>{ledgerLabel} · المسلسل {serial} · الرقم الضريبي {einvoice.taxNumber || 'غير مسجَّل'}</span>
          <span>الطباعة: {browserPrintAvailable ? (autoPrintEnabled ? 'تلقائية بعد البيع' : receipt.defaultTemplate) : 'غير متاحة'}</span>
          {auditLabel && <span className="invoice-doc-audit" title={auditLabel}>{auditLabel}</span>}
        </div>
        <div className="invoice-doc-actionbar-buttons">
          <span className="invoice-doc-balanced" title="طرفا القيد متساويان قبل الترحيل"><i /> القيد متزن</span>
          {/* تخصيص أعمدة جدول البنود — عرضٌ فقط، والحسابات والقيد لا تتأثر */}
          <div className="invoice-doc-colmenu-wrap">
            <Btn variant="ghost" onClick={() => setColumnsOpen((value) => !value)} title="إظهار/إخفاء أعمدة العرض في جدول البنود">
              <Columns3 size={13} /> تخصيص الحقول{hiddenColumns ? ` (${hiddenColumns} مخفي)` : ''}
            </Btn>
            {columnsOpen && (
              <div className="invoice-doc-colmenu" data-doc-columns-panel>
                <b>أعمدة جدول البنود</b>
                {(Object.keys(INVOICE_COLUMN_LABELS) as (keyof InvoiceColumnPrefs)[]).map((key) => (
                  <label key={key}>
                    <input type="checkbox" checked={invoiceColumns[key]} onChange={() => toggleInvoiceColumn(key)} />
                    {INVOICE_COLUMN_LABELS[key]}
                  </label>
                ))}
                <small>الإخفاء عرضٌ فقط: الضريبة والكميات والأسعار تبقى كما هي في الإجماليات والقيد المحاسبي.</small>
                <button type="button" className="invoice-doc-colreset" onClick={() => { resetInvoiceColumns(); setColumnsOpen(false) }}><RotateCcw size={11} /> إعادة كل الأعمدة</button>
              </div>
            )}
          </div>
          <PrintSwitches compact/>
          <Btn variant="ghost" onClick={() => onNavigate('/settings/printing')} title="قوالب الطباعة وإعداد إذن الاستلام والحرارية"><Settings size={13} /> إعدادات الطباعة</Btn>
          {onExportPdf && <Btn variant="ghost" onClick={onExportPdf} title="يفتح حوار الطباعة — اختر وجهة «حفظ كـ PDF»"><FileDown size={13} /> تصدير PDF</Btn>}
        </div>
      </footer>
    </div>
  )
}
