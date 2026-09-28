import { useSearchParams } from 'react-router-dom'
import { AdvancedSalesInvoicePage } from './AdvancedSalesInvoicePage.tsx'
import { AdvancedPurchaseInvoicePage } from './AdvancedPurchaseInvoicePage.tsx'

/**
 * مسار «فاتورة جديدة» = **صفحة كاملة** لا نافذة منبثقة (طلب المالك):
 * المستند يُرسم فوراً بلا شاشة «جارٍ التحميل» — لا تحميل كسول ولا مضيف نوافذ
 * بينه وبين الشاشة. و`key` من رقم الفاتورة يضمن بدء مستند نظيف عند الانتقال
 * من فاتورة إلى أخرى (السابق/التالي) بدل بقاء حالة المستند القديم.
 */
export function InvoiceDocumentRoute({ kind }: { kind: 'sale' | 'purchase' }) {
  const [searchParams] = useSearchParams()
  const documentKey = searchParams.get('edit') ?? 'new'
  return kind === 'sale'
    ? <AdvancedSalesInvoicePage key={documentKey} />
    : <AdvancedPurchaseInvoicePage key={documentKey} />
}
