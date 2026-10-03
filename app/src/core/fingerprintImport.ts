/**
 * ملفات تعريف أجهزة البصمة الشائعة (حضور/انصراف الموظفين).
 *
 * قرار المالك (§77): العميل قد يستخدم أي جهاز — بدل انتظار ماركة واحدة،
 * ندعم عدة أجهزة بملفات تعريف، مع كشف تلقائي من رأس التصدير، ودائماً
 * يبقى الوضع «عام» يفهم أي CSV عربي/إنجليزي بلا جهاز محدد.
 *
 * كل الأجهزة تُصدّر تقاريرها CSV/Excel-CSV — لا حاجة لأي مكتبة خارجية
 * (نفس قرار §72/§73: يُحفظ من Excel بترميز CSV أو يُلصق الجدول مباشرة).
 * محلل النبضات والتقويمات الخاص في attendance.ts (parseFingerprintCsv(opts)).
 */
import { parseFingerprintCsv, type FingerprintRow, type FingerprintParseOptions } from './attendance.ts'

export interface FingerprintDevice {
  /** معرف ثابت يُخزن مع الجلسة */
  id: string
  /** الاسم المعروض بالعربية */
  nameAr: string
  /** المصنّع */
  maker: string
  /** كيف يستخرج العميل التصدير من برنامج هذا الجهاز */
  hintAr: string
  /** بصمات الرأس المميزة للجهاز (كلمات مطبَّعة صغيرة بلا رموز) — تُطابق إذا احتوى الرأس كل كلمات مجموعة منها */
  signatures: string[][]
  /** مرادفات أعمدة خاصة بالجهاز فوق المرادفات العامة */
  synonyms: NonNullable<FingerprintParseOptions['extraSynonyms']>
  /** برنامج الجهاز يصدّر التاريخ شهر/يوم/سنة (ترتيب أمريكي) */
  monthFirst?: boolean
  /** الجهاز يصدّر سجل نبضات (سطر لكل بصمة) — يُفعَّل فقط إن غاب عمودا الدخول/الخروج */
  punchLog?: boolean
}

export const FINGERPRINT_DEVICES: FingerprintDevice[] = [
  {
    id: 'generic',
    nameAr: 'عام (كشف تلقائي)',
    maker: '—',
    hintAr: 'يفهم أي تصدير CSV برؤوس عربية أو إنجليزية (كود/اسم · تاريخ · دخول · خروج)، وبلا رأس بترتيب: كود، تاريخ، دخول، خروج. يعمل مع كل الأجهزة الأخرى غير المذكورة.',
    signatures: [],
    synonyms: {},
  },
  {
    id: 'zkteco',
    nameAr: 'ZKTeco',
    maker: 'ZKTeco',
    hintAr: 'من ZKTime / Attendance Management: تصدير Attendance Report (EMP Code, Name, Date, Clock In, Clock Out) أو سجل البصمات الخام (User ID, Date, Time — سطر لكل بصمة ويدمج أول/آخر تلقائياً). التاريخ يوم/شهر/سنة.',
    signatures: [['empcode', 'clockin'], ['userid', 'time'], ['empcode', 'checkin']],
    synonyms: { code: ['empcode', 'userid'], in: ['clockin', 'firstin'], out: ['clockout', 'lastout'] },
    punchLog: true,
  },
  {
    id: 'hikvision',
    nameAr: 'Hikvision',
    maker: 'Hikvision',
    hintAr: 'من iVMS-4200 / HikCentral: تصدير تقرير الحضور (Personnel No., Name, Date, First Check-in, Last Check-out). برامج Hikvision الإنجليزية تكتب التاريخ شهر/يوم/سنة (9/30/2026) — هذا الملف التعريفي يفهمه كذلك.',
    signatures: [['personnelno'], ['firstcheck', 'lastcheck']],
    synonyms: { code: ['personnelno'], in: ['firstcheck', 'firstin'], out: ['lastcheck', 'lastout'] },
    monthFirst: true,
  },
  {
    id: 'realtime',
    nameAr: 'Realtime',
    maker: 'Realtime Biometrics',
    hintAr: 'من Realtime TA / برنامج الجهاز: تصدير Attendance (Emp Code, Employee Name, Date, Day, First Punch, Last Punch, Total Hours, Status). الوقت قد يرد 0852 مضغوطاً أو 08:52 — كلاهما مفهوم.',
    signatures: [['firstpunch', 'lastpunch'], ['totalhours', 'firstpunch']],
    synonyms: { code: ['empcode'], name: ['employeename'], in: ['firstpunch'], out: ['lastpunch'] },
  },
  {
    id: 'anviz',
    nameAr: 'ANVIZ',
    maker: 'ANVIZ Global',
    hintAr: 'من CrossChex: تصدير Attendance Report (User ID / ID, Name, Date, Check In, Check Out) أو سجل البصمات الخام — سطر لكل بصمة ويدمج أول/آخر تلقائياً. التاريخ يوم/شهر/سنة.',
    signatures: [['anviz'], ['crosschex'], ['userid', 'checkin']],
    synonyms: { code: ['userid'], in: ['checkin', 'firstin'], out: ['checkout', 'lastout'] },
    punchLog: true,
  },
  {
    id: 'essl',
    nameAr: 'eSSL eTimeTrackLite',
    maker: 'Enterprise Systems Solutions',
    hintAr: 'من eTimeTrackLite: تصدير Attendance (Emp Code, Emp Name, Date, Day, Shift, In Time, Out Time, Status). التاريخ يوم/شهر/سنة.',
    signatures: [['intime', 'shift'], ['etime', 'intime']],
    synonyms: { code: ['empcode'], name: ['empname'], in: ['intime', 'firstin'], out: ['outtime', 'lastout'] },
  },
]

/** جهاز عام — يُرجع دائماً كحالة افتراضية آمنة */
export const GENERIC_DEVICE: FingerprintDevice = FINGERPRINT_DEVICES[0]

/** تطبيع خلية رأس مثل المحلل: صغيرة وبلا رموز/مسافات */
const normCell = (cell: string): string => cell.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * كشف الجهاز من رأس التصدير: أول جهاز تُطابق إحدى مجموعات بصماته كلُّ كلماتها
 * الرأسُ. لا تطابق ⇐ الجهاز العام. الكشف استرشادي فقط — المستخدم يختار يدوياً
 * إن أراد، والاختيار اليدوي يتقدم على الكشف.
 */
export function detectFingerprintDevice(text: string): { device: FingerprintDevice; matched: boolean } {
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
  const header = firstLine.includes('\t') ? firstLine.split('\t') : firstLine.split(',')
  const cells = header.map(normCell)
  for (const device of FINGERPRINT_DEVICES) {
    if (!device.signatures.length) continue
    for (const group of device.signatures) {
      if (group.every((word) => cells.some((cell) => cell.includes(word)))) {
        return { device, matched: true }
      }
    }
  }
  return { device: GENERIC_DEVICE, matched: false }
}

export interface DeviceParseResult {
  rows: FingerprintRow[]
  errors: string[]
  /** الجهاز الذي فُهم به الملف فعلياً */
  device: FingerprintDevice
  /** هل مُرّر جهاز محدد يدوياً (يتقدم على الكشف) */
  manual: boolean
  /** الجهاز الذي كُشف تلقائياً قبل أي تفضيل يدوي (للعرض) */
  detected: FingerprintDevice
}

/**
 * تحليل تصدير البصمة بجهاز محدد أو بالكشف التلقائي.
 * deviceId = 'generic' أو غائب ⇐ كشف تلقائي؛ أي جهاز آخر ⇐ ملفه التعريفي.
 */
export function parseFingerprintDeviceCsv(text: string, deviceId?: string): DeviceParseResult {
  const detected = detectFingerprintDevice(text).device
  const requested = FINGERPRINT_DEVICES.find((d) => d.id === deviceId) ?? null
  const manual = requested != null && requested.id !== 'generic'
  const device = manual && requested ? requested : detected
  const parsed = parseFingerprintCsv(text, {
    extraSynonyms: device.synonyms,
    monthFirst: device.monthFirst,
    punchLog: device.punchLog,
  })
  return { rows: parsed.rows, errors: parsed.errors, device, manual, detected }
}
