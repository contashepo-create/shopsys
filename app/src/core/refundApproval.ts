/**
 * موافقة المشرف على المرتجعات (طلب المالك — مطابقة برامج الكاشير العالمية):
 * ─────────────────────────────────────────────────────────────────────────
 * النمط العالمي (Square Manager Passcode / Toast Void-Refund Permission /
 * Roller «POS PIN required for refunds»): الكاشير يسجّل المرتجع لكن التنفيذ
 * يتطلب رقماً سرياً لمشرف معتمد — إلا إذا كان المستخدم نفسه مالكاً أو مُنح
 * صلاحية الاعتماد المباشر.
 *
 * القواعد هنا:
 * - `sales.return.create`: يستطيع فتح شاشة المرتجع وتجهيزه.
 * - `sales.return.approve`: يعتمد المرتجع مباشرة بلا رقم سري (مشرف/مدير فرع).
 * - المالك (roleId=owner أو المستخدم الافتراضي null): دائماً بلا رقم سري.
 * - غير ذلك: حوار «رقم المشرف السري» — يُقبل رقم المالك أو رقم أي مستخدم
 *   نشط يملك صلاحية الاعتماد، ويُسجَّل اسم المعتمد على المستند وفي التدقيق.
 * - المرتجع على فاتورة من وردية مغلقة أو وردية كاشير آخر: يُنفَّذ في الوردية
 *   المفتوحة الحالية (النقدية تخرج من الدرج الحالي — المعيار العالمي)، مع
 *   توثيق الوردية الأصلية في بيان التدقيق.
 * نواة خالصة بلا واجهات ولا كتابة.
 */

/** صلاحية الاعتماد المباشر — من يملكها لا يُسأل عن رقم سري */
export const REFUND_APPROVE_PERM = 'sales.return.approve'
/** صلاحية تسجيل المرتجع (فتح الشاشة وتجهيزه) */
export const REFUND_CREATE_PERM = 'sales.return.create'

export interface RefundApprovalDecision {
  /** هل يحتاج المستخدم الحالي إدخال رقم مشرف سري؟ */
  needsPin: boolean
  /** سبب القرار — يُعرض في الواجهة */
  reasonAr: string
}

/**
 * قرار المطالبة بالرقم السري — عام لأي صلاحية حساسة (permId):
 * - user=null ⇒ المالك الافتراضي على الجهاز: لا رقم.
 * - يملك الصلاحية المطلوبة (دوره أو منحة فردية من المالك) ⇒ لا رقم.
 * - غير ذلك ⇒ رقم مشرف إلزامي.
 */
export function needsSupervisorPin(
  user: { roleId: string } | null,
  effectivePerms: ReadonlySet<string>,
  permId: string,
): RefundApprovalDecision {
  if (user === null || user.roleId === 'owner') {
    return { needsPin: false, reasonAr: 'المالك — اعتماد مباشر' }
  }
  if (effectivePerms.has(permId)) {
    return { needsPin: false, reasonAr: 'يملك صلاحية الاعتماد — بلا رقم سري' }
  }
  return { needsPin: true, reasonAr: 'هذه العملية تتطلب رقم مشرف أو رقم المالك' }
}

/** خصوصية المرتجعات — الدالة الأشهر استخداماً */
export function refundNeedsSupervisorPin(
  user: { roleId: string } | null,
  effectivePerms: ReadonlySet<string>,
): RefundApprovalDecision {
  return needsSupervisorPin(user, effectivePerms, REFUND_APPROVE_PERM)
}

/** مرشّح المعتمدين: من يصلح رقمه لاعتماد العملية؟ (نشط + يملك الصلاحية) */
export function isEligibleApprover(
  user: { roleId: string; active: boolean },
  userPerms: ReadonlySet<string>,
  permId: string = REFUND_APPROVE_PERM,
): boolean {
  if (!user.active) return false
  if (user.roleId === 'owner') return true
  return userPerms.has(permId)
}

/** توقيع الاعتماد — يُخزن على المستند نفسه (مرتجع بيع/خدمة/استبدال) */
export interface RefundApproval {
  /** اسم المعتمد (مالك/مشرف) — «المالك» للرقم الرئيسي */
  approvedBy: string
  /** من نفّذ فعلياً (الكاشير الواقف على الشاشة) */
  requestedBy: string
  at: string // ISO
}

/**
 * بيان سياق الوردية للمرتجع — للتوثيق في التدقيق ووصف المستند:
 * مرتجع على فاتورة ورديتها مغلقة أو لكاشير آخر لا يُمنع (البضاعة رجعت فعلاً)
 * لكن نقديته تخرج من الدرج الحالي ويُدوَّن السياق كاملاً.
 */
export function describeShiftContext(args: {
  saleShiftId: number | null
  saleShiftStatus: 'open' | 'closed' | null // null = فاتورة بلا وردية
  saleShiftOpenedBy: string | null
  currentShiftId: number | null
  currentUserName: string
}): { crossShift: boolean; noteAr: string } {
  if (args.saleShiftId == null) {
    return { crossShift: false, noteAr: '' } // فاتورة بلا وردية (مبيعات مكتبية) — لا سياق
  }
  if (args.saleShiftStatus === 'open' && args.saleShiftId === args.currentShiftId) {
    return { crossShift: false, noteAr: '' } // نفس الوردية المفتوحة — الطبيعي
  }
  const parts: string[] = []
  if (args.saleShiftStatus === 'closed') parts.push(`الفاتورة من وردية مغلقة #${args.saleShiftId}`)
  else if (args.saleShiftId !== args.currentShiftId) parts.push(`الفاتورة من وردية أخرى #${args.saleShiftId}`)
  if (args.saleShiftOpenedBy && args.saleShiftOpenedBy !== args.currentUserName) {
    parts.push(`فتحها «${args.saleShiftOpenedBy}»`)
  }
  const where = args.currentShiftId != null
    ? `يُحتسب المرتجع في الوردية الحالية #${args.currentShiftId}`
    : 'لا وردية مفتوحة الآن — المرتجع خارج الورديات (يُسوّى من الخزينة مباشرة)'
  return { crossShift: true, noteAr: `${parts.join('، ')} — ${where}` }
}
