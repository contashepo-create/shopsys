import { BadgeCheck, Barcode, CalendarDays, CircleDollarSign, FileText, Keyboard, PackageSearch, Search, ShieldCheck, Truck } from 'lucide-react'

/**
 * كروم موحّد لمحررات البيع والشراء.
 * يبقى هذا الجزء بلا بيانات تجريبية: كل قيمة تعرضها الصفحة الأم من الـ store.
 */
export function InvoiceReferenceChrome({
  kind,
  modeLabel,
  partyLabel,
  warehouseLabel,
  currencyLabel,
  dateLabel,
  onPartySearch,
  onItemSearch,
  onSaveDraft,
  onPrint,
  onPost,
}: {
  kind: 'sale' | 'purchase'
  modeLabel: string
  partyLabel: string
  warehouseLabel: string
  currencyLabel: string
  dateLabel: string
  onPartySearch: () => void
  onItemSearch: () => void
  onSaveDraft: () => void
  onPrint: () => void
  onPost: () => void
}) {
  const isSale = kind === 'sale'

  return (
    <>
      <div className="invoice-reference-meta" aria-label="بيانات الفاتورة الحالية">
        <div className="invoice-reference-id">
          <span className="invoice-reference-icon"><FileText size={17} /></span>
          <div>
            <span className="invoice-reference-eyebrow">{isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'}</span>
            <strong>مسودة جديدة</strong>
            <small>رقم يصدر عند الترحيل</small>
          </div>
        </div>
        <div className="invoice-reference-cell"><CalendarDays size={15} /><span><b>التاريخ</b><strong>{dateLabel}</strong></span></div>
        <div className="invoice-reference-cell"><BadgeCheck size={15} /><span><b>الحالة</b><strong className="text-amber-600 dark:text-amber-300">مسودة · غير مرحّلة</strong></span></div>
        <div className="invoice-reference-cell"><CircleDollarSign size={15} /><span><b>العملة</b><strong>{currencyLabel}</strong></span></div>
        <div className="invoice-reference-cell"><Truck size={15} /><span><b>المستودع</b><strong>{warehouseLabel}</strong></span></div>
        <div className="invoice-reference-cell"><ShieldCheck size={15} /><span><b>{isSale ? 'العميل' : 'المورد'}</b><strong>{partyLabel}</strong></span></div>
      </div>

      <nav className="invoice-reference-shortcuts" aria-label="اختصارات الفاتورة">
        <span className="invoice-shortcut-caption"><Keyboard size={15} /> إجراءات سريعة</span>
        <button type="button" onClick={onPartySearch}><kbd>F2</kbd><Search size={14} /> بحث {isSale ? 'العميل' : 'المورد'}</button>
        <button type="button" onClick={onItemSearch}><kbd>F5</kbd><PackageSearch size={14} /> بحث صنف</button>
        <button type="button" onClick={onSaveDraft}><kbd>F8</kbd> حفظ مسودة</button>
        <button type="button" onClick={onPrint}><kbd>F6</kbd> طباعة</button>
        <button type="button" className="invoice-shortcut-primary" onClick={onPost}><kbd>F9</kbd> اعتماد وترحيل</button>
        <span className="invoice-connection-status"><i /> متصل · البيانات محلية</span>
        <span className="invoice-mode-status">النمط: <b>{modeLabel}</b></span>
      </nav>
      <div className="invoice-reference-helper"><Barcode size={14} /> اكتب أول حرف لفتح نافذة البحث، حدّد بالسهم، والاعتماد بالنقر المزدوج أو Enter.</div>
    </>
  )
}
