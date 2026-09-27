/**
 * سياسة تعديل الفواتير + سياسة الباركود الضريبي (طلب المالك) — دوال خالصة:
 *
 * ① تعديل الفاتورة:
 *    - الفاتورة الضريبية الإلكترونية غير مفعلة من المطور (أو بلد بلا منظومة):
 *      التعديل متاح — يُعكس القيد القديم ويُرحَّل قيد جديد فلا يفسد الدفتر أبداً.
 *    - مفعلة بمفتاح الترخيص: التعديل محظور لأن الفاتورة مرتبطة رسمياً
 *      بمنظومة الضرائب (زاتكا/بوابة مصر) — البديل: إشعار دائن (مرتجع) أو
 *      إشعار مدين (فاتورة إضافية).
 *
 * ② الباركود الضريبي (زاتكا QR):
 *    - يُطبع فقط عندما: الميزة مفعلة + متصل بالإنترنت (المرحلة الثانية تتطلب
 *      الربط الفعلي) + خيار الطباعة مفعل.
 *    - غير متصل أو الميزة غير مفعلة ⇒ لا باركود، لكن **المبلغ الضريبي
 *      يُحسب ويُرحّل ويُطبع طبيعياً دائماً** — الضريبة شأن محاسبي داخلي
 *      لا علاقة له بتفعيل المنظومة الإلكترونية.
 *
 * يسري على كل البلدان: بلد بلا ضريبة (الكويت/قطر…) لا ضريبة أصلاً ولا باركود؛
 * بلد بضريبة بلا منظومة إلكترونية معتمدة عندنا ⇒ ضريبة طبيعية وتعديل متاح.
 */

export function electronicInvoiceLockActive(input: { licensed: boolean; enabled: boolean; taxNumber: string }): boolean {
  return input.licensed && input.enabled && input.taxNumber.trim().length > 0
}

export interface EditPolicyInput {
  /** أي ميزة فاتورة إلكترونية مفعلة بمفتاح الترخيص (einvoice_sa أو einvoice_eg) */
  einvoiceActive: boolean
}

export interface EditPolicy {
  canEdit: boolean
  /** شرح يظهر للمستخدم بجانب الزر (طلب المالك: كل زر له تفسير) */
  reasonAr: string
}

export function invoiceEditPolicy(i: EditPolicyInput): EditPolicy {
  if (i.einvoiceActive) {
    return {
      canEdit: false,
      reasonAr:
        'الفاتورة الضريبية الإلكترونية مفعلة — الفواتير مرتبطة رسمياً بمنظومة الضرائب فلا تُعدَّل بعد إصدارها. ' +
        'للتصحيح: إشعار دائن (مرتجع مبيعات) لتخفيض قيمة، أو إشعار مدين (فاتورة إضافية) لزيادتها.',
    }
  }
  return {
    canEdit: true,
    reasonAr: 'تعديل الفاتورة: يُعكس قيدها القديم ويتولد قيد جديد صحيح تلقائياً — الدفتر يبقى متوازناً بسجل تدقيق كامل.',
  }
}

/* ─── سياسة باركود زاتكا ─── */

export interface QrPolicyInput {
  /** ميزة einvoice_sa مفعلة بمفتاح الترخيص من بوت المطور */
  featureActive: boolean
  /** متصل بالإنترنت الآن؟ (المرحلة الثانية من زاتكا تتطلب الربط) */
  online: boolean
  /** خيار «طباعة رمز زاتكا» في إعدادات الممول */
  printEnabled: boolean
}

export interface QrPolicy {
  printQr: boolean
  /** لماذا لا يُطبع؟ (للعرض في شاشة الفاتورة الإلكترونية) */
  reasonAr: string | null
}

export function zatcaQrPolicy(i: QrPolicyInput): QrPolicy {
  if (!i.featureActive) {
    return { printQr: false, reasonAr: 'الإصدار الإلكتروني غير مفعّل على هذه المنشأة حالياً. الضريبة تُحسب وتُطبع طبيعياً بلا باركود.' }
  }
  if (!i.online) {
    return {
      printQr: false,
      reasonAr:
        'لا اتصال بالإنترنت — المرحلة الثانية من زاتكا تتطلب ربط الفاتورة بالمنظومة، ' +
        'فتُطبع الفاتورة الآن بلا باركود ضريبي (المبلغ الضريبي يظهر طبيعياً).',
    }
  }
  if (!i.printEnabled) {
    return { printQr: false, reasonAr: 'خيار طباعة رمز زاتكا موقوف من إعدادات الممول.' }
  }
  return { printQr: true, reasonAr: null }
}

/* ─── موانع تعديل فاتورة بعينها (سلامة محاسبية) ─── */

export interface SaleEditBlocksInput {
  hasReturns: boolean
  hasSoldSerials: boolean
  hasInstallmentPlan: boolean
  hasSettlementAllocation: boolean
  shiftClosed: boolean
}

/**
 * حتى مع سياسة تعديل مفتوحة، فواتير بعينها لا تُعدَّل لأن مستندات لاحقة
 * بُنيت عليها — التعديل يفسدها. تُعاد قائمة الأسباب (فارغة = يجوز التعديل).
 */
export function saleEditBlocks(i: SaleEditBlocksInput): string[] {
  const blocks: string[] = []
  if (i.hasReturns) blocks.push('عليها مرتجعات مربوطة بسطورها الأصلية — عدّل بمرتجع إضافي أو فاتورة جديدة')
  if (i.hasSoldSerials) blocks.push('بيعت بسيريالات معيّنة — التصحيح بمرتجع يعيد السيريال ثم فاتورة جديدة')
  if (i.hasInstallmentPlan) blocks.push('مرتبطة بخطة أقساط مجدولة — عدّل الخطة أو استخدم مرتجعاً')
  if (i.hasSettlementAllocation) blocks.push('سُدد جزء منها عبر تحصيلات مخصصة — التعديل يفسد المطابقة؛ استخدم مرتجعاً')
  if (i.shiftClosed) blocks.push('ورديتها أُقفلت وعُدّ درجها — فروق ما بعد الإقفال تُعالج بمرتجع لا بتعديل')
  return blocks
}
