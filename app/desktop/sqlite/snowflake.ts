/**
 * معرّفات Snowflake لصفوف التخزين (وثيقة §101 §3.4 — قرار التوافق الأمامي):
 * كل صف جديد بعد الهجرة يأخذ معرّفاً فريداً عالمياً، والمعرّفات الصغيرة
 * القديمة تبقى كما هي داخل الحمولة (لا تصادم: قيم Snowflake فلكية الحجم).
 *
 * التخطيط 53-بت إجمالاً — يلتزم القيد الصارم «آمنة تحت 2⁵³ في JS»
 * (الوثيقة تذكر 41+10+12=63 كمثال كلاسيكي لكنها تُلزم بالأمان تحت 2⁵³،
 * فالبِتات تُوزَّع: 41 مللي ثانية + 5 جهاز + 7 تسلسل):
 *   • 41 بت مللي ثانية منذ 2026-01-01 → يكفي حتى سنة 2095
 *   • 5 بت جهاز → 32 جهازاً (§103: فرعان بعشرة أجهزة — بهامش)
 *   • 7 بت تسلسل → 128 معرّفاً في المللي ثانية للجهاز الواحد
 *     (هذه هوية صفوف التخزين التفاضلية لا معرّفات المستندات — تكفي وفوقها
 *     فيض التسلسل ينتظر المللي التالية بلا خطأ)
 *
 * دالة خالصة قابلة للفحص: الساعة والجهاز يُحقنان — والفيض (exhausted seq)
 * ينتظر المللي الثانية التالية (سلوك Snowflake القياسي).
 */

export const SNOWFLAKE_EPOCH_MS = Date.UTC(2026, 0, 1)
const MS_BITS = 41
const DEVICE_BITS = 5
const SEQ_BITS = 7
export const SNOWFLAKE_MAX = Number(BigInt(2) ** BigInt(53)) - 1

export interface SnowflakeClock {
  now(): number
}

export class SnowflakeGenerator {
  private lastMs = 0
  private seq = 0
  private readonly deviceId: number
  private readonly clock: SnowflakeClock

  constructor(deviceId: number, clock: SnowflakeClock = { now: () => Date.now() }) {
    if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId >= 1 << DEVICE_BITS)
      throw new Error(`معرّف الجهاز خارج النطاق (0..${(1 << DEVICE_BITS) - 1})`)
    this.deviceId = deviceId
    this.clock = clock
  }

  /** معرّف جديد — رتيب صاعد داخل الجهاز، فريد عالمياً بين الأجهزة */
  next(): number {
    let ms = Math.floor(this.clock.now()) - SNOWFLAKE_EPOCH_MS
    if (ms < 0) ms = 0 /* ساعة جهاز قبل الحقبة: نُثبّت على الصفر بلا انقلاب */
    if (ms >= 2 ** MS_BITS) throw new Error('تجاوز مدى الحقبة الزمنية للمعرّفات (سنة 2095)')
    if (ms === this.lastMs) {
      this.seq += 1
      if (this.seq >= 1 << SEQ_BITS) {
        /* فيض التسلسل: ندور حتى المللي التالية — يحدث فقط في البذر الكثيف */
        while (ms === this.lastMs) ms = Math.floor(this.clock.now()) - SNOWFLAKE_EPOCH_MS
        this.seq = 0
      }
    } else if (ms > this.lastMs) {
      this.seq = 0
    } else {
      /* ساعة رجعت للخلف: نعيد استخدام نفس المللي بترتيب تسلسل صاعد */
      this.seq += 1
      if (this.seq >= 1 << SEQ_BITS) ms = this.lastMs /* قيد الحماية النظري */
    }
    this.lastMs = ms
    return ms * (1 << (DEVICE_BITS + SEQ_BITS)) + this.deviceId * (1 << SEQ_BITS) + this.seq
  }
}
