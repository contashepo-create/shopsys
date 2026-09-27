import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CircleHelp, Eye, FileCheck2, MonitorSmartphone, MoreVertical, Printer, Save, Search, PackageSearch } from 'lucide-react'
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
 * سطح الفاتورة بشكل «مستند» مرتب (طلب المالك — الشكل المرفق):
 * شريط علوي فيه رقم المستند وحالته وأزرار الحفظ/المعاينة/الاعتماد، ثم بطاقة رأس
 * فيها الطرف والتواريخ وملف الحساب، ثم جدول البنود، ثم صف سفلي بثلاث لوحات
 * (ملاحظات · التحصيل الآن · الإجماليات) وشريط إجراءات ثابت أسفل الشاشة.
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
  const { sync, receipt, autoPrintAfterSale } = useAppStore()
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

  return (
    <div className={`invoice-doc invoice-editor invoice-pos-root invoice-pos-${kind}`} dir="rtl">
      {/* ① الشريط العلوي: أدوات صغيرة يميناً/يساراً كما في نوافذ البرامج */}
      <div className="invoice-doc-utility">
        <div className="invoice-doc-utility-tools">
          <button type="button" data-doc-menu aria-label="إجراءات المستند" title="إجراءات المستند" onClick={() => setMenuOpen((v) => !v)}><MoreVertical size={15} /></button>
          <button type="button" aria-label="معاينة الطباعة" title="معاينة الطباعة" onClick={onPrint}><MonitorSmartphone size={15} /></button>
          <button type="button" data-doc-help aria-label="مساعدة الفاتورة" title="كيف تُحرَّر الفاتورة؟" onClick={() => setHelpOpen((v) => !v)}><CircleHelp size={15} /></button>
          {menuOpen && (
            <div className="invoice-doc-menu" data-doc-menu-panel>
              <button type="button" onClick={() => { setMenuOpen(false); onRestoreDraft() }}>استعادة آخر مسودة</button>
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
        <div className="invoice-doc-utility-session">
          <span>{activityLabel}</span>
          <span>الفرع: <b>{branchLabel}</b></span>
          <span>المستخدم: <b>{userLabel}</b></span>
          <span className={`invoice-doc-online is-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span>
        </div>
        <button type="button" className="invoice-doc-close" onClick={onBack} aria-label="إغلاق المستند والعودة" title="إغلاق المستند"><ArrowLeft size={17} /></button>
      </div>

      {/* ② رأس المستند: الرقم والحالة وأزرار الحفظ والاعتماد */}
      <header className="invoice-doc-head">
        <div className="invoice-doc-identity">
          <b data-doc-number>{documentNumber || (sale ? 'فاتورة مبيعات جديدة' : 'فاتورة مشتريات جديدة')}</b>
          <span className="invoice-doc-status" data-doc-status>{documentNumber ? 'تعديل' : 'مسودة'}</span>
          <small>{modeLabel} · {currencyLabel} · {dateLabel}</small>
        </div>
        <div className="invoice-doc-head-actions">
          <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={14} /> حفظ مسودة</Btn>
          <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Eye size={14} /> معاينة</Btn>
          <Btn onClick={onPost} shortcut="F9"><FileCheck2 size={14} /> اعتماد وترحيل</Btn>
        </div>
      </header>

      <div className="invoice-doc-body">
        {/* ③ بطاقة الرأس: الطرف والتواريخ والمخزن + ملف الحساب */}
        <section className="invoice-doc-card invoice-doc-header-card">
          <div className="invoice-doc-fields">{headerFields}</div>
          {partyProfile && <aside className="invoice-doc-party">{partyProfile}</aside>}
        </section>

        {/* ④ شريط إضافة صنف سريع */}
        <section className="invoice-doc-card invoice-doc-entry">
          <div className="invoice-doc-entry-label"><PackageSearch size={15} /> إضافة صنف أو خدمة</div>
          <div className="invoice-doc-entry-input">{itemEntry}</div>
          <div className="invoice-doc-entry-hints">
            <button type="button" onClick={onItemSearch}><Search size={12} /> مسح باركود / بحث</button>
            <span><kbd>Enter</kbd> إضافة · <kbd>F5</kbd> بحث · <kbd>F9</kbd> ترحيل</span>
          </div>
        </section>

        {/* ⑤ جدول البنود واللوحات السفلية */}
        <div className="invoice-pos-document">{children}</div>
      </div>

      {/* ⑥ شريط الإجراءات الثابت */}
      <footer className="invoice-doc-actionbar">
        <div className="invoice-doc-actionbar-info">
          <span className={`invoice-doc-online is-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span>
          <span>الطباعة: {browserPrintAvailable ? (autoPrintEnabled ? 'تلقائية بعد البيع' : receipt.defaultTemplate) : 'غير متاحة'}</span>
        </div>
        <div className="invoice-doc-actionbar-buttons">
          <Btn variant="ghost" onClick={onSaveDraft}>حفظ فقط</Btn>
          <Btn variant="ghost" onClick={onPrint}><Printer size={14} /> حفظ ومعاينة</Btn>
          <Btn onClick={onPost} shortcut="F9" className="invoice-doc-post"><FileCheck2 size={15} /> ترحيل {sale ? 'وتحصيل' : 'وسداد'} {postAmountLabel ?? ''}</Btn>
        </div>
      </footer>
    </div>
  )
}
