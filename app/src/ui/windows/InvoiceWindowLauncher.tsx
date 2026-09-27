import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { openPurchaseInvoiceWindow, openSalesInvoiceWindow } from './windowStore.ts'

/**
 * مسار «فاتورة جديدة» لم يعد يبتلع الشاشة: يفتح الفاتورة كنافذة مستقلة فوق السجل.
 * أي رابط قديم (/sales/invoices/new?edit=12) يظل يعمل ويفتح النافذة نفسها.
 */
export function InvoiceWindowLauncher({ kind }: { kind: 'sale' | 'purchase' }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const done = useRef(false)
  const editId = Number(searchParams.get('edit') || 0)
  useEffect(() => {
    if (done.current) return
    done.current = true
    if (kind === 'sale') openSalesInvoiceWindow(editId || undefined)
    else openPurchaseInvoiceWindow(editId || undefined)
    navigate(kind === 'sale' ? '/sales/invoices' : '/purchases/invoices', { replace: true })
  }, [kind, editId, navigate])
  return (
    <div className="grid place-items-center p-16 text-sm text-slate-500" data-invoice-launcher={kind}>
      جارٍ فتح الفاتورة في نافذة مستقلة…
    </div>
  )
}
