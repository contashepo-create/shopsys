import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilePlus2 } from 'lucide-react'
import { openPurchaseInvoiceWindow, openSalesInvoiceWindow } from '../windows/windowStore.ts'

/**
 * مسار «فاتورة جديدة» = **نافذة حرة** لا صفحة مدمجة (قرار المالك ⑩ي البند ⑮):
 * الفاتورة تُفتح في نافذة مستقلة تُكبَّر وتُصغَّر وتُرسل للخلفية، ويمكن فتح
 * فاتورة بيع أخرى فوقها وحفظ الاثنتين — بلا تعتيم للخلفية وبلا فقد للنافذة الأم.
 * المسار نفسه يفتح النافذة ثم يعود بالخلفية إلى قائمة الفواتير، فالرابط يظل
 * صالحاً للمشاركة والاختصارات بينما المستند يعيش في مضيف النوافذ.
 */
export function InvoiceDocumentRoute({ kind }: { kind: 'sale' | 'purchase' }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const editParam = searchParams.get('edit')
  const editId = editParam && Number.isFinite(Number(editParam)) ? Number(editParam) : undefined
  /* أمر شراء للتعبئة المسبقة: /purchases/invoices/new?po=<id> — زر «فاتورة استلام» */
  const poParam = searchParams.get('po')
  const poId = poParam && Number.isFinite(Number(poParam)) ? Number(poParam) : undefined
  const opened = useRef(false)
  const listPath = kind === 'sale' ? '/sales/invoices' : '/purchases/invoices'
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (kind === 'sale') openSalesInvoiceWindow(editId)
    else openPurchaseInvoiceWindow(editId, poId != null ? { purchaseOrderId: poId } : undefined)
    /* الخلفية تعود لقائمة الفواتير حتى تبقى الشاشة صالحة عند تصغير النافذة */
    navigate(listPath, { replace: true })
  }, [kind, editId, poId, navigate, listPath])
  return (
    <div className="grid place-items-center p-10 text-sm text-slate-500" data-invoice-window-route>
      <span className="inline-flex items-center gap-2"><FilePlus2 size={16} /> جارٍ فتح {kind === 'sale' ? 'فاتورة المبيعات' : 'فاتورة المشتريات'} في نافذة مستقلة…</span>
    </div>
  )
}
