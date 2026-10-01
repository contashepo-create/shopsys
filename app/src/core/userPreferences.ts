/**
 * تفضيلات المستخدم الخاصة (طلب المالك 2026-10-01): كل مستخدم يختار طريقة
 * عمله بنفسه — نمط محرر فاتورة البيع/الشراء الذي يُفتح تلقائياً، وقالب
 * الطباعة المفضل لزر الطباعة السريع. **مفصولة لكل مستخدم تماماً**: تُخزَّن
 * في خريطة `userPrefs` بمفتاح مستقل لكل مستخدم (المالك بمفتاح 'owner')
 * فلا يرى مستخدم تفضيلات آخر ولا تتأثر بها.
 */
import type { InvoiceEditorMode } from './advancedInvoice.ts'

export interface UserPreferences {
  /** نمط محرر فاتورة البيع الذي يُفتح به المحرر تلقائياً (بسيط/قياسي/ربحي/متقدم) */
  salesInvoiceMode?: InvoiceEditorMode
  /** نمط محرر فاتورة الشراء الذي يُفتح به المحرر تلقائياً */
  purchaseInvoiceMode?: InvoiceEditorMode
  /**
   * قالب الطباعة المفضل لزر «طباعة» السريع — يُقدَّم على مفتاح «طباعة
   * كاشير» العام إن حُدد؛ غيابه = سلوك المفاتيح العامة كما هو.
   */
  preferredPrintTemplate?: 'thermal' | 'a4'
}

/** مفتاح خريطة التفضيلات لمستخدم — 'owner' للمالك (بلا حساب دخول) */
export const userPrefsKey = (currentUserId: number | null | undefined): string =>
  String(currentUserId ?? 'owner')

/** كائن فارغ ثابت — لتفادي إنشاء مرجع جديد كل رندر في منتقيات zustand */
export const EMPTY_USER_PREFERENCES: UserPreferences = {}

export const INVOICE_MODE_LABELS: Record<InvoiceEditorMode, string> = {
  simple: 'بسيط',
  standard: 'قياسي',
  profit: 'ربحي',
  advanced: 'متقدم',
}
