import { ArrowRight, BadgeCheck, CalendarDays, CircleDollarSign, FileCheck2, FileText, Keyboard, PackageSearch, Printer, Save, Search, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Btn } from './ui.tsx'

type InvoicePOSFrameProps = {
  kind: 'sale' | 'purchase'
  modeLabel: string
  currencyLabel: string
  dateLabel: string
  headerFields: ReactNode
  onBack: () => void
  onPartySearch: () => void
  onItemSearch: () => void
  onSaveDraft: () => void
  onRestoreDraft: () => void
  onPrint: () => void
  onPost: () => void
  children: ReactNode
}

/**
 * الغلاف التشغيلي لفاتورة البيع والشراء. هذه ليست بطاقة تجميلية حول المحرر
 * القديم؛ هي سطح POS مستقل يحمل كل محتوى الفاتورة داخل ورقة واحدة كثيفة.
 */
export function InvoicePOSFrame({
  kind,
  modeLabel,
  currencyLabel,
  dateLabel,
  headerFields,
  onBack,
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

  return (
    <div className={`invoice-pos-root invoice-editor invoice-pos-${kind}`} dir="rtl">
      <header className="invoice-pos-topbar">
        <div className="invoice-pos-brand">
          <button type="button" className="invoice-pos-back" onClick={onBack} aria-label="العودة"><ArrowRight size={18} /></button>
          <div className="invoice-pos-logo">T</div>
          <div className="min-w-0">
            <div className="invoice-pos-product">TAHAKAM ERP <span>· نقطة البيع</span></div>
            <h1>{sale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} <small>مسودة جديدة</small></h1>
          </div>
        </div>
        <div className="invoice-pos-document-id"><span>رقم المستند</span><strong>يصدر عند الترحيل</strong><em>غير مرحّل</em></div>
        <div className="invoice-pos-state"><i /> متصل <span>·</span> {modeLabel}</div>
        <div className="invoice-pos-top-actions">
          <Btn variant="ghost" onClick={onRestoreDraft}>استعادة</Btn>
          <Btn variant="ghost" onClick={onPrint} shortcut="F6"><Printer size={14} /> طباعة</Btn>
          <Btn variant="ghost" onClick={onSaveDraft} shortcut="F8"><Save size={14} /> حفظ مسودة</Btn>
          <Btn onClick={onPost} shortcut="F9"><FileCheck2 size={15} /> {sale ? 'ترحيل وتحصيل' : 'ترحيل الفاتورة'}</Btn>
        </div>
      </header>

      <nav className="invoice-pos-commandbar" aria-label="شريط أوامر الفاتورة">
        <div className="invoice-pos-command-title"><Keyboard size={15} /> اختصارات الفاتورة</div>
        <button type="button" onClick={onPartySearch}><kbd>F2</kbd><Search size={14} /> بحث {partyWord}</button>
        <button type="button" onClick={onItemSearch}><kbd>F5</kbd><PackageSearch size={14} /> إضافة صنف</button>
        <span className="invoice-pos-command-hint">ابدأ الكتابة في بحث {partyWord} أو الصنف — الاعتماد بالنقر على زر الترحيل بالأعلى</span>
      </nav>

      <section className="invoice-pos-context" aria-label="حالة المستند">
        <div><CalendarDays size={15} /><span><small>التاريخ</small><b>{dateLabel}</b></span></div>
        <div><BadgeCheck size={15} /><span><small>الحالة</small><b className="warning">مسودة · غير مرحّلة</b></span></div>
        <div><CircleDollarSign size={15} /><span><small>العملة</small><b>{currencyLabel}</b></span></div>
        <div className="invoice-pos-context-sync"><Truck size={15} /><span>الحركة محفوظة محلياً حتى الترحيل</span></div>
      </section>

      <section className="invoice-pos-header-controls" aria-label={`تعديل بيانات ${sale ? 'فاتورة البيع' : 'فاتورة الشراء'}`}>
        <div className="invoice-pos-header-title"><FileText size={17} /><span><b>بيانات الفاتورة</b><small>غيّر الطرف والمخزن والنمط من هذا الرأس مباشرة</small></span></div>
        <div className="invoice-pos-edit-grid">{headerFields}</div>
      </section>

      <main className="invoice-pos-document">{children}</main>
    </div>
  )
}
