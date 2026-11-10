import { useLayoutEffect, useRef } from 'react'
import { buildWarehouseReceiptHtml, type WarehouseReceiptDoc } from '../../core/warehouseReceipt.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { usePrintPreview } from '../components/printPreviewStore.ts'
import { printHtml } from './printReceipt.ts'

type ReceiptData = Omit<WarehouseReceiptDoc, 'settings'>

/** يقبل مسودة ثابتة أو مصدراً حياً؛ الإعدادات تُقرأ لحظة إعادة البناء. */
export function previewWarehouseReceipt(doc: ReceiptData | (() => ReceiptData)): () => string {
  const rebuild = () => buildWarehouseReceiptHtml({ ...(typeof doc === 'function' ? doc() : doc), settings: useAppStore.getState().warehouseReceipt })
  printHtml(rebuild(), { preview: { title: 'معاينة إذن المستودع قبل الطباعة', rebuild } })
  return rebuild
}

/** يربط نافذة المعاينة بالمحرر الأصلي فقط، دون تحديث نافذة مستند آخر. */
export function useLiveWarehouseReceipt(build: () => ReceiptData): () => void {
  const latest = useRef(build)
  const ownedRebuild = useRef<(() => string) | null>(null)
  useLayoutEffect(() => {
    latest.current = build
    const preview = usePrintPreview.getState()
    if (preview.open && preview.handle?.rebuild === ownedRebuild.current) preview.refresh()
  })
  return () => { ownedRebuild.current = previewWarehouseReceipt(() => latest.current()) }
}
