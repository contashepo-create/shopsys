import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Barcode, CheckCheck, CircleHelp, Eye, FileClock, FileText, Fingerprint, Hash, MessageSquare, MoreVertical, Printer, Save, Search, SlidersHorizontal } from 'lucide-react'
import { connectivityStatus, CONNECTIVITY_LABELS } from '../../core/architecture.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn } from './ui.tsx'

type InvoicePOSFrameProps = {
  kind: 'sale' | 'purchase'
  modeLabel: string
  currencyLabel: string
  dateLabel: string
  branchLabel: string
  userLabel: string
  activityLabel: string
  headerFields: ReactNode
  /** شريط المرجع الخارجي أسفل الحقول (أمر شراء العميل / بوليصة شحن) */
  referenceBar?: ReactNode
  partyProfile?: ReactNode
  /** بطاقة «الصنف المختار» بجانب بطاقة رصيد الطرف */
  itemProfile?: ReactNode
  itemEntry: ReactNode
  /** رقم المستند إن وُجد (تعديل فاتورة مرحّلة)؛ وإلا «مسودة» */
  documentNumber?: string
  /** قيمة زر الترحيل: «ترحيل وتحصيل 25,000.00» */
  postAmountLabel?: string
  /** عدد المسودات المحفوظة من هذا النوع — يظهر على زر «المسودات» */
  draftCount?: number
  onBack: () => void
  onNavigate: (path: string) => void
  onPartySearch: () => void
  onItemSearch: () => void
  onSaveDraft: () => void
  onRestoreDraft: () => void
  onPrint: () => void
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
  referenceBar,
  partyProfile,
  itemProfile,
  itemEntry,
  documentNumber,
  postAmountLabel,
  draftCount = 0,
  onBack,
  onNavigate,
  onPartySearch,
  onItemSearch,
  onSaveDraft,
  onRestoreDraft,
  onPrint,
  onPost,
  children,
}: InvoicePOSFrameProps) {
  const sale = kind === 'sale'
  const partyWord = sale ? 'العميل' : 'المورد'
  const { sync, receipt, autoPrintAfterSale, einvoice } = useAppStore()
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    const on = () => setBrowserOnline(true)
    const off = () => setBrowserOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
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
        <div className="invoice-doc-utility-tools">
          <button type="button" className="invoice-doc-close" onClick={onBack} aria-label="إغلاق المستند والعودة" title="إغلاق المستند"><ArrowLeft size={15} /></button>
          <button type="button" data-doc-menu aria-label="إجراءات المستند" title="إجراءات المستند" onClick={() => setMenuOpen((v) => !v)}><MoreVertical size={14} /></button>
          <button type="button" aria-label="معاينة الطباعة" title="معاينة الطباعة" onClick={onPrint}><Printer size={14} /></button>
          <button type="button" aria-label="محادثة الدعم" title="الدعم الفني" onClick={() => onNavigate('/support')}><MessageSquare size={14} /></button>
          <button type="button" data-doc-help aria-label="مساعدة الفاتورة" title="كيف تُحرَّر الفاتورة؟" onClick={() => setHelpOpen((v) => !v)}><CircleHelp size={14} /></button>
          {menuOpen && (
            <div className="invoice-doc-menu" data-doc-menu-panel>
              <button type="button" onClick={() => { setMenuOpen(false); onRestoreDraft() }}>المسودات المحفوظة ({draftCount})</button>
              <button type="button" onClick={() => { setMenuOpen(false); onPartySearch() }}>بحث {partyWord} (F2)</button>
              <button type="button" onClick={() => { setMenuOpen(false); onItemSearch() }}>بحث صنف (F5)</button>
              <button type="button" onClick={() => { setMenuOpen(false); onNavigate(sale ? '/sales/invoices' : '/purchases/invoices') }}>سجل الفواتير</button>
            </div>
          )}
          {helpOpen && (
            <div className="invoice-doc-menu is-help" data-doc-help-panel>
              <b>ترتيب العمل في الفاتورة</b>
              <span>① اختر {partyWord} · ② أضف الأصناف سطراً سطراً · ③ اكتب الخصم والضريبة إن وُجدت · ④ حدد المحصَّل الآن · ⑤ اضغط «اعتماد وترحيل».</span>
              <span>الحفظ كمسودة لا يؤثر على المخزون ولا الحسابات، والترحيل هو ما يُنشئ القيد.</span>
            </div>
          )}
        </div>

        <div className="invoice-doc-identity">
          <span className="invoice-doc-numberbox"><FileText size={12} /><b data-doc-number>{documentNumber || (sale ? 'INV — مسودة جديدة' : 'PUR — مسودة جديدة')}</b></span>
          <span className="invoice-doc-status" data-doc-status>{documentNumber ? 'تعديل' : 'مسودة'}</span>
          <small>{modeLabel} · {currencyLabel} · {dateLabel}</small>
        </div>

        <div className="invoice-doc-head-actions">
          <Btn variant="ghost" onClick={onRestoreDraft} title="فتح أي مسودة محفوظة باسم العميل"><FileClock size={13} /> المسودات{draftCount ? ` (${draftCount})` : ''}</Btn>
          <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={13} /> حفظ مسودة</Btn>
          <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Eye size={13} /> معاينة</Btn>
          <Btn onClick={onPost} shortcut="F9"><CheckCheck size={13} /> اعتماد وترحيل</Btn>
        </div>
      </header>

      <div className="invoice-doc-body">
        {/* ② بطاقة الرأس: شريط بيانات ثم حقول + بطاقتا مؤشرات */}
        <section className="invoice-doc-card invoice-doc-header-card">
          <div className="invoice-doc-cardbar">
            <div className="invoice-doc-cardbar-main">
              <span className="invoice-doc-cardbar-icon"><FileText size={11} /></span>
              <b>بيانات الفاتورة والمعاملة</b>
              <i />
              <span>{ledgerLabel}</span>
              <span className={`invoice-doc-chip ${documentNumber ? 'is-edit' : 'is-live'}`}><em />{documentNumber ? 'تعديل مستند مرحّل' : 'قيد التحرير'}</span>
            </div>
            <div className="invoice-doc-cardbar-meta">
              <span><Hash size={10} /> المسلسل: <strong>{serial}</strong></span>
              <span><Fingerprint size={10} /> الرقم الضريبي: <strong>{einvoice.taxNumber || 'غير مسجَّل'}</strong></span>
            </div>
          </div>
          <div className="invoice-doc-header-body">
            <div className="invoice-doc-form">
              <div className="invoice-doc-fields">{headerFields}</div>
              {referenceBar && <div className="invoice-doc-refbar">{referenceBar}</div>}
            </div>
            <aside className="invoice-doc-side">
              {partyProfile && <div className="invoice-doc-party">{partyProfile}</div>}
              {itemProfile && <div className="invoice-doc-itemcard">{itemProfile}</div>}
            </aside>
          </div>
        </section>

        {/* ③ شريط البحث والباركود */}
        <section className="invoice-doc-card invoice-doc-entry">
          <div className="invoice-doc-entry-input"><Barcode size={14} className="invoice-doc-entry-icon" />{itemEntry}</div>
          <div className="invoice-doc-entry-hints">
            <span className="invoice-doc-kbd">F5</span>
            <span className="invoice-doc-ready"><i /> جاهز للمسح</span>
          </div>
          <div className="invoice-doc-entry-actions">
            <button type="button" className="is-primary" onClick={onItemSearch}><Search size={12} /> بحث وإضافة</button>
            <button type="button" onClick={onPartySearch}><SlidersHorizontal size={12} /> بحث {partyWord}</button>
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
          <span>الطباعة: {browserPrintAvailable ? (autoPrintEnabled ? 'تلقائية بعد البيع' : receipt.defaultTemplate) : 'غير متاحة'}</span>
        </div>
        <div className="invoice-doc-actionbar-buttons">
          <Btn variant="ghost" onClick={onSaveDraft}><Save size={13} /> حفظ فقط</Btn>
          <Btn variant="ghost" onClick={onPrint}><Printer size={13} /> حفظ ومعاينة</Btn>
          <Btn onClick={onPost} shortcut="F9" className="invoice-doc-post"><CheckCheck size={14} /> ترحيل {sale ? 'وتحصيل' : 'وسداد'} {postAmountLabel ?? ''}</Btn>
        </div>
      </footer>
    </div>
  )
}
