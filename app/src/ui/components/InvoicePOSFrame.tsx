import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, BadgeCheck, CalendarDays, CircleDollarSign, FileCheck2, FileText, Keyboard, PackageSearch, Printer, Save, Search, Store } from 'lucide-react'
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

/** سطح فاتورة POS مستقل: رأس مرجعي، شريط اختصارات، إدخال سريع، وجدول/حسابات. */
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
  const invoicePath = sale ? '/sales/invoices/new' : '/purchases/invoices/new'
  const { sync, receipt, autoPrintAfterSale } = useAppStore()
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
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
  const printerLabel = browserPrintAvailable
    ? (autoPrintEnabled ? 'متاحة · تلقائية مفعّلة' : `متاحة · ${receipt.defaultTemplate}`)
    : 'غير متاحة في هذا المتصفح'

  return (
    <div className={`invoice-pos-root invoice-editor invoice-pos-${kind}`} dir="rtl">
      <header className="invoice-reference-header">
        <div className="invoice-reference-utility">
          <div className="invoice-reference-brandline">
            <div className="invoice-reference-window-dots"><i /><i /><i /></div>
            <span className="invoice-reference-brand-mark">T</span>
            <span>منظومة الفواتير ونقاط البيع | TAHAKAM ERP</span>
          </div>
          <div className="invoice-reference-session">
            <span><Store size={14} /> {activityLabel}</span>
            <span>الفرع: <b>{branchLabel}</b></span>
            <span>المستخدم: <b>{userLabel}</b></span>
            <span className={`invoice-reference-online invoice-reference-online-${connectivityInfo.tone}`} title={connectivityInfo.nameAr}><i /> {connectivityInfo.icon} {connectivityInfo.nameAr}</span>
          </div>
        </div>
        <div className="invoice-reference-mainnav">
          <div className="invoice-reference-navbrand">TAHAKAM <b>ERP</b></div>
          <nav>
            <button className="active" type="button" onClick={() => onNavigate(invoicePath)}>شاشة الفاتورة السريعة</button>
            <button type="button" onClick={() => onNavigate(sale ? '/sales/invoices' : '/purchases/invoices')}>سجل الفواتير والمردودات</button>
            <button type="button" onClick={() => onNavigate('/parties/customers')}>إدارة العملاء والديون</button>
            <button type="button" onClick={() => onNavigate('/sales/shifts')}>حركة الصندوق واليومية</button>
          </nav>
          <span className="invoice-reference-mode">{sale ? 'مبيعات' : 'مشتريات'} · {modeLabel}</span>
        </div>
        <div className="invoice-reference-shortcutbar">
          <span className="invoice-reference-shortcut-label"><Keyboard size={14} /> اختصارات سريعة:</span>
          <span><kbd>F2</kbd> اختيار {partyWord}</span>
          <span><kbd>F5</kbd> بحث صنف</span>
          <span><kbd>F6</kbd> طباعة</span>
          <span><kbd>F8</kbd> حفظ مسودة</span>
          <span className="primary"><kbd>F9</kbd> ترحيل</span>
          <time>{dateLabel}</time>
        </div>
      </header>

      <div className="invoice-reference-main-area">
        <main className="invoice-reference-content">
          <section className="invoice-reference-document-head">
            <button className="invoice-reference-top-back" type="button" onClick={onBack} title={`العودة إلى قسم ${sale ? 'المبيعات' : 'المشتريات'}`} aria-label={`العودة إلى قسم ${sale ? 'المبيعات' : 'المشتريات'}`}><ArrowRight size={19} /></button>
            <div className="invoice-reference-document-card">
              <FileText size={20} />
              <span><small>رقم الفاتورة الإلكترونية</small><strong>يصدر عند الترحيل</strong></span>
            </div>
            <div className="invoice-reference-meta-card"><CalendarDays size={18} /><span><small>تاريخ ووقت الإصدار</small><strong>{dateLabel}</strong></span></div>
            <div className="invoice-reference-meta-card"><CircleDollarSign size={18} /><span><small>العملة</small><strong>{currencyLabel}</strong></span></div>
            <div className="invoice-reference-state-card"><BadgeCheck size={16} /><span><b>مسودة قيد التحرير</b><small>الطباعة: {printerLabel}</small></span></div>
            <div className="invoice-reference-top-actions">
              <Btn variant="ghost" onClick={onPartySearch} shortcut="F2"><Search size={14} /> {partyWord}</Btn>
              <Btn variant="ghost" onClick={onItemSearch} shortcut="F5"><PackageSearch size={14} /> صنف</Btn>
              <Btn variant="ghost" onClick={onRestoreDraft}>استعادة</Btn>
              <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Printer size={14} /> طباعة</Btn>
              <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={14} /> حفظ</Btn>
              <Btn onClick={onPost} shortcut="F9"><FileCheck2 size={14} /> ترحيل</Btn>
            </div>
          </section>

          {partyProfile && <section className="invoice-reference-party-panel">
            <div className="invoice-reference-party-panel-title"><Search size={17} /><span><b>ملف {partyWord}</b><small>تفاصيل الحساب من السجل الحقيقي</small></span></div>
            <div className="invoice-reference-party-panel-body">{partyProfile}</div>
          </section>}

          <section className="invoice-reference-edit-head">
            <div className="invoice-reference-section-title"><FileText size={18} /><span><b>بيانات الفاتورة</b><small>التعديل يتم من هذا الرأس فقط</small></span></div>
            <div className="invoice-reference-edit-fields">{headerFields}</div>
          </section>

          <section className="invoice-reference-rapid-entry">
            <div className="invoice-reference-rapid-title"><BarcodeIcon /> <span><b>إدخال سريع للأصناف</b><small>امسح الباركود أو ابحث بالاسم والكود</small></span></div>
            <div className="invoice-reference-rapid-input">{itemEntry}</div>
            <div className="invoice-reference-rapid-hint"><kbd>F5</kbd> لفتح البحث · <kbd>Enter</kbd> للإضافة · زر واحد لاختيار الصنف لا يعتمد الإضافة</div>
          </section>

          <div className="invoice-pos-document">{children}</div>
        </main>
      </div>

      <footer className="invoice-reference-statusbar"><span className={`invoice-reference-status-${connectivityInfo.tone}`}><i /> {connectivityInfo.nameAr}</span><span><i /> الطباعة: {browserPrintAvailable ? (autoPrintEnabled ? 'تلقائية' : 'يدوية') : 'غير متاحة'}</span><span>TAHAKAM ERP · {sale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'}</span></footer>
    </div>
  )
}

function BarcodeIcon() { return <span className="invoice-reference-barcode-icon" aria-hidden="true">▥</span> }
