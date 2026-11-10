import { buildWarehouseReceiptHtml, type WarehouseReceiptDoc } from '../../core/warehouseReceipt.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { printHtml } from './printReceipt.ts'

/** لقطة بيانات الإذن لحظة فتحه، وإعدادات الإذن تُقرأ من المخزن عند كل تحديث. */
export function previewWarehouseReceipt(doc: Omit<WarehouseReceiptDoc, 'settings'>): void {
  const rebuild = () => buildWarehouseReceiptHtml({ ...doc, settings: useAppStore.getState().warehouseReceipt })
  printHtml(rebuild(), { preview: { title: 'معاينة إذن المستودع قبل الطباعة', rebuild } })
}
