/**
 * طلبات العملاء المعلّقة (طلب خاص لقطعة غير متوفرة بالمخزون) — سد فجوة فورية
 * #2 في تقرير النشاط #7 (قطع غيار): أول مهمة يومية بدليل التشغيل الداخلي
 * لمحل قطع الغيار هي متابعة الطلبات الخاصة للعملاء، ولم يكن لها كيان بيانات
 * من قبل — فقط مذكرة ورقية ضمنية. كيان مستقل وخفيف، لا يمسّ المخزون ولا
 * الدفتر بذاته (مجرد تتبع التزام)، يرتبط اختيارياً بأمر شراء ليتحول تلقائياً
 * إلى «وصلت» عند اكتمال استلام ذلك الأمر (سد فجوة مستقبلية #3: إخطار واتساب).
 */

export type PendingPartOrderStatus = 'pending' | 'arrived' | 'delivered' | 'cancelled'

export const PENDING_PART_ORDER_STATUS_AR: Record<PendingPartOrderStatus, string> = {
  pending: 'بانتظار الوصول',
  arrived: 'وصلت — جاهزة للتسليم',
  delivered: 'سُلّمت للعميل',
  cancelled: 'ملغى',
}

export interface PendingPartOrder {
  id: number
  orderNumber: string // CPO-0001
  itemId: number
  itemNameAr: string
  customerId: number | null
  customerName: string
  customerPhone: string
  qty: number
  orderedAt: string // ISO
  status: PendingPartOrderStatus
  /** أمر شراء اختياري يُغذّي هذا الطلب — عند اكتمال استلامه يتحول الطلب تلقائياً إلى «وصلت» */
  linkedPurchaseOrderId: number | null
  arrivedAt: string | null
  deliveredAt: string | null
  notes: string
}

/**
 * رسالة إخطار العميل بوصول قطعته — نفس أسلوب إخطارات تذاكر الصيانة
 * (`buildTicketStatusMessage`)، يُفتح عبر `waChatLink` المشترك في whatsapp.ts.
 */
export function buildPartArrivedMessage(
  order: Pick<PendingPartOrder, 'orderNumber' | 'customerName' | 'itemNameAr' | 'qty'>,
  shopName: string,
): string {
  const customer = order.customerName.trim() || 'عميلنا العزيز'
  return `${customer}،\nوصلت القطعة التي طلبتها: ${order.itemNameAr} (الكمية ${order.qty}) — أمر ${order.orderNumber}.\nيسعدنا استلامك لها في أقرب فرصة.\n— ${shopName}`
}
