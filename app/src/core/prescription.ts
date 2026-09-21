/**
 * الروشتة المنظمة (طلب المالك — ترقية العيادة):
 * كل بند دواء سطر مستقل كالفاتورة: الدواء + الشكل الصيدلي (شريط/علبة…) والكمية +
 * الجرعة (مرات يومياً أو كل X ساعات) + علاقة الوجبات (قبل/بعد/مع — وجبة أو
 * وجبتين أو ثلاث) + مدة الاستخدام + التكرار (كم مرة وكل كم يوم) + ملاحظات.
 * نواة خالصة قابلة للفحص — الطباعة والواجهة تقرآن منها.
 */

/* ─── الشكل الصيدلي المصروف ─── */

export type DispenseForm = 'strip' | 'box' | 'bottle' | 'tube' | 'ampoule' | 'sachet' | 'suppository' | 'other'

export const DISPENSE_FORMS: Record<DispenseForm, string> = {
  strip: 'شريط',
  box: 'علبة',
  bottle: 'زجاجة',
  tube: 'أنبوبة',
  ampoule: 'أمبول',
  sachet: 'أكياس',
  suppository: 'لبوس',
  other: 'أخرى',
}

/* ─── علاقة الوجبات ─── */

export type MealRelation = 'before' | 'after' | 'with' | 'none'

export const MEAL_RELATIONS: Record<MealRelation, string> = {
  before: 'قبل الأكل',
  after: 'بعد الأكل',
  with: 'مع الأكل',
  none: 'بدون قيد وجبات',
}

/** «بعد وجبة» / «بعد وجبتين» / «بعد ثلاث وجبات» (طلب المالك) */
export function mealText(relation: MealRelation, mealsCount: number): string {
  if (relation === 'none') return ''
  const base = MEAL_RELATIONS[relation]
  if (mealsCount === 2) return relation === 'before' ? 'قبل وجبتين' : relation === 'after' ? 'بعد وجبتين' : 'مع وجبتين'
  if (mealsCount === 3) return relation === 'before' ? 'قبل ثلاث وجبات' : relation === 'after' ? 'بعد ثلاث وجبات' : 'مع ثلاث وجبات'
  if (mealsCount === 1) return relation === 'before' ? 'قبل الوجبة' : relation === 'after' ? 'بعد الوجبة' : 'مع الوجبة'
  return base
}

/* ─── بند الروشتة ─── */

export interface RxLine {
  medication: string // اسم الدواء والتركيز
  form: DispenseForm // شريط أم علبة…
  formQty: number // كم شريط/علبة يُصرف (0 = غير محدد)
  timesPerDay: number // مرات التناول يومياً (0 = يُستخدم everyHours بدلاً)
  everyHours: number // أو: كل كم ساعة (0 = يُستخدم timesPerDay)
  mealRelation: MealRelation
  mealsCount: number // 1 | 2 | 3 — «بعد وجبة/وجبتين/ثلاث»
  durationDays: number // مدة الاستخدام بالأيام (0 = مفتوحة/عند اللزوم)
  repeated: boolean // هل الدواء مكرر (يعاد صرفه)؟
  repeatTimes: number // كم مرة يُكرر
  repeatEveryDays: number // كل كم يوم يُكرر
  notes: string // ملاحظات البند
}

export function emptyRxLine(): RxLine {
  return {
    medication: '', form: 'strip', formQty: 1,
    timesPerDay: 2, everyHours: 0,
    mealRelation: 'after', mealsCount: 1,
    durationDays: 5,
    repeated: false, repeatTimes: 0, repeatEveryDays: 0,
    notes: '',
  }
}

/** فحص بنود الروشتة — أخطاء عربية واضحة */
export function validateRxLines(lines: readonly RxLine[]): string[] {
  const errors: string[] = []
  lines.forEach((l, i) => {
    const n = i + 1
    if (!l.medication.trim()) errors.push(`البند ${n}: اسم الدواء مطلوب`)
    if (l.timesPerDay < 0 || l.everyHours < 0) errors.push(`البند ${n}: الجرعة لا تكون سالبة`)
    if (l.timesPerDay === 0 && l.everyHours === 0 && l.durationDays > 0) errors.push(`البند ${n}: حدد مرات التناول يومياً أو كل كم ساعة`)
    if (l.timesPerDay > 0 && l.everyHours > 0) errors.push(`البند ${n}: اختر مرات يومياً أو كل X ساعات — ليس الاثنين`)
    if (![0, 1, 2, 3].includes(l.mealsCount)) errors.push(`البند ${n}: عدد الوجبات 1 أو 2 أو 3`)
    if (l.durationDays < 0 || l.formQty < 0) errors.push(`البند ${n}: الأرقام لا تكون سالبة`)
    if (l.repeated && l.repeatTimes <= 0) errors.push(`البند ${n}: الدواء مكرر — حدد كم مرة`)
    if (l.repeated && l.repeatEveryDays <= 0) errors.push(`البند ${n}: الدواء مكرر — حدد كل كم يوم`)
  })
  return errors
}

/** الجرعة كجملة عربية واحدة: «مرتين يومياً بعد الوجبة — 5 أيام» */
export function doseText(l: RxLine): string {
  const parts: string[] = []
  if (l.timesPerDay > 0) {
    parts.push(l.timesPerDay === 1 ? 'مرة واحدة يومياً' : l.timesPerDay === 2 ? 'مرتين يومياً' : `${l.timesPerDay} مرات يومياً`)
  } else if (l.everyHours > 0) {
    parts.push(`كل ${l.everyHours} ساعات`)
  }
  const meal = mealText(l.mealRelation, l.mealsCount)
  if (meal) parts.push(meal)
  if (l.durationDays > 0) parts.push(`لمدة ${l.durationDays === 1 ? 'يوم' : l.durationDays === 2 ? 'يومين' : `${l.durationDays} أيام`}`)
  else if (l.timesPerDay === 0 && l.everyHours === 0) parts.push('عند اللزوم')
  return parts.join(' — ')
}

/** سطر الصرف: «2 شريط» + التكرار إن وجد */
export function dispenseText(l: RxLine): string {
  const parts: string[] = []
  if (l.formQty > 0) parts.push(`${l.formQty} ${DISPENSE_FORMS[l.form]}`)
  if (l.repeated && l.repeatTimes > 0) parts.push(`يُكرر ${l.repeatTimes === 1 ? 'مرة' : l.repeatTimes === 2 ? 'مرتين' : `${l.repeatTimes} مرات`} كل ${l.repeatEveryDays} يوم`)
  return parts.join(' · ')
}

/** نص كامل للبند (للسجل والبحث) */
export function rxLineText(l: RxLine): string {
  return [l.medication, doseText(l), dispenseText(l), l.notes].filter(Boolean).join(' | ')
}

/* ─── التاريخ المرضي المنظم (طلب المالك: لا مساحة كتابة مفتوحة) ─── */

export interface MedicalHistory {
  bloodType: string // '' = غير معروف — A+ A- B+ B- AB+ AB- O+ O-
  chronicDiseases: string[] // سكري/ضغط/قلب/ربو…
  allergies: string[] // حساسية أدوية/أطعمة
  surgeries: string // عمليات سابقة
  currentMeds: string // أدوية يتناولها حالياً
  familyHistory: string // تاريخ عائلي
  smoker: boolean
  extraNotes: string
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const

/** الأمراض المزمنة الشائعة — تشيك بوكس سريع بدل الكتابة */
export const COMMON_CHRONIC = ['سكري', 'ضغط مرتفع', 'قلب', 'ربو', 'كلى', 'كبد', 'غدة درقية', 'صرع', 'سيولة دم'] as const

export function emptyMedicalHistory(): MedicalHistory {
  return { bloodType: '', chronicDiseases: [], allergies: [], surgeries: '', currentMeds: '', familyHistory: '', smoker: false, extraNotes: '' }
}

/** ملخص سطر واحد للتحذير أعلى الروشتة والملف (حساسية + مزمنة أولاً) */
export function historySummary(h: MedicalHistory): string {
  const parts: string[] = []
  if (h.allergies.length) parts.push(`⚠️ حساسية: ${h.allergies.join('، ')}`)
  if (h.chronicDiseases.length) parts.push(h.chronicDiseases.join('، '))
  if (h.bloodType) parts.push(`فصيلة ${h.bloodType}`)
  if (h.smoker) parts.push('مدخّن')
  return parts.join(' · ')
}

/** ترحيل النص الحر القديم إلى البنية المنظمة (يذهب لملاحظات إضافية بلا فقد) */
export function migrateFreeHistory(freeText: string): MedicalHistory {
  return { ...emptyMedicalHistory(), extraNotes: freeText.trim() }
}

/* ─── مرفقات المريض: أشعة/تحاليل/تقارير (صورة أو PDF) ─── */

export type AttachmentKind = 'xray' | 'lab_report' | 'medical_report' | 'other'

export const ATTACHMENT_KINDS: Record<AttachmentKind, { nameAr: string; icon: string }> = {
  xray: { nameAr: 'أشعة', icon: '🩻' },
  lab_report: { nameAr: 'تقرير تحليل', icon: '🧪' },
  medical_report: { nameAr: 'تقرير طبي', icon: '📄' },
  other: { nameAr: 'أخرى', icon: '📎' },
}

/** أقصى حجم مرفق بعد الضغط — التخزين المحلي محدود (نسخة Electron لاحقاً بلا حد) */
export const MAX_ATTACHMENT_BYTES = 1_800_000

/** فحص مرفق قبل الحفظ: النوع صورة أو PDF فقط، والحجم ضمن الحد */
export function validateAttachment(a: { name: string; mime: string; dataUrl: string }): string[] {
  const errors: string[] = []
  if (!a.name.trim()) errors.push('اسم المستند مطلوب')
  const okMime = a.mime.startsWith('image/') || a.mime === 'application/pdf'
  if (!okMime) errors.push('المسموح: صورة (JPG/PNG) أو ملف PDF فقط')
  // dataUrl base64 ≈ 4/3 الحجم الفعلي
  const approxBytes = Math.floor((a.dataUrl.length * 3) / 4)
  if (approxBytes > MAX_ATTACHMENT_BYTES) errors.push(`الملف كبير (${(approxBytes / 1_048_576).toFixed(1)} م.ب) — الحد ${(MAX_ATTACHMENT_BYTES / 1_048_576).toFixed(1)} م.ب. الصور تُضغط تلقائياً؛ وPDF الكبير صغّره أولاً`)
  if (!a.dataUrl.startsWith('data:')) errors.push('صيغة الملف غير مقروءة')
  return errors
}

/* ─── العلامات الحيوية للزيارة (ترقية الوحدة) ─── */

export interface Vitals {
  bpSys: number // ضغط انقباضي (0 = لم يقس)
  bpDia: number
  pulse: number // نبض
  tempC: number // حرارة ×10 (375 = 37.5) لتجنب الكسور — 0 = لم تقس
  weightKg: number // وزن ×10 (705 = 70.5)
}

export const EMPTY_VITALS: Vitals = { bpSys: 0, bpDia: 0, pulse: 0, tempC: 0, weightKg: 0 }

export function vitalsText(v: Vitals): string {
  const parts: string[] = []
  if (v.bpSys > 0 && v.bpDia > 0) parts.push(`ضغط ${v.bpSys}/${v.bpDia}`)
  if (v.pulse > 0) parts.push(`نبض ${v.pulse}`)
  if (v.tempC > 0) parts.push(`حرارة ${(v.tempC / 10).toFixed(1)}°`)
  if (v.weightKg > 0) parts.push(`وزن ${(v.weightKg / 10).toFixed(1)} كجم`)
  return parts.join(' · ')
}

/** تحذير سريري بسيط للعرض (لا تشخيص — تنبيه بصري فقط) */
export function vitalsFlags(v: Vitals): string[] {
  const flags: string[] = []
  if (v.bpSys >= 140 || v.bpDia >= 90) flags.push('ضغط مرتفع')
  if (v.bpSys > 0 && v.bpSys < 90) flags.push('ضغط منخفض')
  if (v.tempC >= 380) flags.push('حمّى')
  if (v.pulse > 100) flags.push('نبض سريع')
  if (v.pulse > 0 && v.pulse < 50) flags.push('نبض بطيء')
  return flags
}
