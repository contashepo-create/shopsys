import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CircleHelp, Eye, FileCheck2, FileClock, Fingerprint, Hash, MonitorSmartphone, MoreVertical, Printer, Save, Search, PackageSearch, ReceiptText } from 'lucide-react'
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
  partyProfile?: ReactNode
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
 * سطح الفاتورة بشكل «مستند مكتبي» (طلب المالك — الشكل المرجعي المرفق):
 *
 *   ① شريط علوي **واحد** مضغوط: أدوات المستند · رقم الفاتورة وحالتها · أزرار
 *      حفظ المسودة والمعاينة والاعتماد (كان شريطين متراكمين يأكلان ثلث الشاشة).
 *   ② بطاقة رأس بشريط بيانات رفيع (الدفتر · الحالة · المسلسل · الرقم الضريبي)
 *      ثم شبكة الحقول ويسارها بطاقة مؤشرات الطرف.
 *   ③ شريط إضافة صنف رفيع، ثم جدول البنود، ثم اللوحات الثلاث السفلية.
 *   ④ شريط إجراءات لاصق أسفل الشاشة.
 *
 * كل المقاسات من طبقة `invoice-doc-*` في `index.css` — لا مقاسات محفورة هنا.
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
      {/* ① شريط علوي واحد: أدوات + هوية المستند + أزرار الاعتماد */}
      <header className="invoice-doc-topbar">
        <div className="invoice-doc-utility-tools">
          <button type="button" className="invoice-doc-close" onClick={onBack} aria-label="إغلاق المستند والعودة" title="إغلاق المستند"><ArrowLeft size={15} /></button>
          <button type="button" data-doc-menu aria-label="إجراءات المستند" title="إجراءات المستند" onClick={() => setMenuOpen((v) => !v)}><MoreVertical size={14} /></button>
          <button type="button" aria-label="معاينة الطباعة" title="معاينة الطباعة" onClick={onPrint}><MonitorSmartphone size={14} /></button>
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
          <ReceiptText size={15} />
          <b data-doc-number>{documentNumber || (sale ? 'فاتورة مبيعات جديدة' : 'فاتورة مشتريات جديدة')}</b>
          <span className="invoice-doc-status" data-doc-status>{documentNumber ? 'تعديل' : 'مسودة'}</span>
          <small>{modeLabel} · {currencyLabel} · {dateLabel}</small>
        </div>

        <div className="invoice-doc-head-actions">
          <Btn variant="ghost" onClick={onRestoreDraft} title="فتح أي مسودة محفوظة باسم العميل"><FileClock size={13} /> المسودات{draftCount ? ` (${draftCount})` : ''}</Btn>
          <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={13} /> حفظ مسودة</Btn>
          <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Eye size={13} /> معاينة</Btn>
          <Btn onClick={onPost} shortcut="F9"><FileCheck2 size={13} /> اعتماد وترحيل</Btn>
        </div>
      </header>

      <div className="invoice-doc-body">
        {/* ② بطاقة الرأس: شريط بيانات رفيع ثم الحقول وبطاقة مؤشرات الطرف */}
        <section className="invoice-doc-card invoice-doc-header-card">
          <div className="invoice-doc-cardbar">
            <div className="invoice-doc-cardbar-main">
              <span className="invoice-doc-cardbar-icon"><ReceiptText size={11} /></span>
              <b>بيانات الفاتورة والمعاملة</b>
              <i />
              <span>{ledgerLabel}</span>
              <span className={`invoice-doc-chip ${documentNumber ? 'is-edit' : 'is-live'}`}>{documentNumber ? 'تعديل مستند مرحّل' : 'قيد التحرير'}</span>
            </div>
            <div className="invoice-doc-cardbar-meta">
              <span><Hash size={10} /> المسلسل: <strong>{serial}</strong></span>
              <span><Fingerprint size={10} /> الرقم الضريبي: <strong>{einvoice.taxNumber || 'غير مسجَّل'}</strong></span>
              <span className="invoice-doc-cardbar-session">{activityLabel} · {branchLabel} · {userLabel}</span>
              <span className={`invoice-doc-online is-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span>
            </div>
          </div>
          <div className="invoice-doc-header-body">
            <div className="invoice-doc-fields">{headerFields}</div>
            {partyProfile && <aside className="invoice-doc-party">{partyProfile}</aside>}
          </div>
        </section>

        {/* ③ شريط إضافة صنف سريع */}
        <section className="invoice-doc-card invoice-doc-entry">
          <div className="invoice-doc-entry-label"><PackageSearch size={14} /> إضافة صنف أو خدمة</div>
          <div className="invoice-doc-entry-input">{itemEntry}</div>
          <div className="invoice-doc-entry-hints">
            <button type="button" onClick={onItemSearch}><Search size={12} /> مسح باركود / بحث</button>
            <span><kbd>Enter</kbd> إضافة · <kbd>F5</kbd> بحث · <kbd>F9</kbd> ترحيل</span>
          </div>
        </section>

        {/* ④ جدول البنود واللوحات السفلية */}
        <div className="invoice-pos-document">{children}</div>
      </div>

      {/* ⑤ شريط الإجراءات الثابت */}
      <footer className="invoice-doc-actionbar">
        <div className="invoice-doc-actionbar-info">
          <span className={`invoice-doc-online is-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span>
          <span>الطباعة: {browserPrintAvailable ? (autoPrintEnabled ? 'تلقائية بعد البيع' : receipt.defaultTemplate) : 'غير متاحة'}</span>
        </div>
        <div className="invoice-doc-actionbar-buttons">
          <Btn variant="ghost" onClick={onSaveDraft}>حفظ فقط</Btn>
          <Btn variant="ghost" onClick={onPrint}><Printer size={13} /> حفظ ومعاينة</Btn>
          <Btn onClick={onPost} shortcut="F9" className="invoice-doc-post"><FileCheck2 size={14} /> ترحيل {sale ? 'وتحصيل' : 'وسداد'} {postAmountLabel ?? ''}</Btn>
        </div>
      </footer>
    </div>
  )
}
