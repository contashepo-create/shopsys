/**
 * بوت التليجرام — جانب العميل (المرحلة 5 — القرار 7):
 * القرار 7 يفصل بوتين: بوت المطوّر (إصدار تراخيص وتفعيل ميزات — على خادم
 * المطوّر، خارج هذا التطبيق) وبوت العميل (هذا الملف): يرسل تقرير اليوم،
 * تنبيهات النواقص، والنسخة الاحتياطية إلى محادثة صاحب المحل.
 *
 * نواة خالصة: التحقق من التوكن والمحادثة، بناء روابط Bot API،
 * وصياغة نصوص الرسائل — بلا fetch هنا (الاتصال مسؤولية الواجهة).
 */
import type { Minor } from './money.ts'

export interface TelegramSettings {
  botToken: string // من BotFather
  chatId: string // محادثة المالك (رقم أو ‎-100…‎ لمجموعة)
  sendDailyReport: boolean
  sendLowStock: boolean
  sendBackups: boolean
}

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  botToken: '',
  chatId: '',
  sendDailyReport: true,
  sendLowStock: true,
  sendBackups: true,
}

/** صيغة توكن BotFather: رقم:سلسلة 30+ حرفاً */
export function isValidBotToken(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/.test(token.trim())
}

/** معرف المحادثة: رقم موجب (خاص) أو سالب يبدأ بـ-100 (مجموعة/قناة) */
export function isValidChatId(chatId: string): boolean {
  return /^-?\d{4,20}$/.test(chatId.trim())
}

/** إخفاء التوكن للعرض: 1234567890:AAxx…xxZZ */
export function maskToken(token: string): string {
  const t = token.trim()
  if (t.length < 16) return t ? '•'.repeat(t.length) : ''
  const colon = t.indexOf(':')
  const head = colon > 0 ? t.slice(0, colon + 3) : t.slice(0, 6)
  return `${head}…${t.slice(-4)}`
}

/** رابط استدعاء Bot API — Telegram يدعم CORS فيصلح من المتصفح ومن Electron */
export function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token.trim()}/${method}`
}

/* ─── صياغة الرسائل (نص عادي — بلا Markdown لتجنب مشاكل التهريب) ─── */

const fmtAmount = (minor: Minor, decimals: number, symbol: string) => {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 10 ** decimals)
  const frac = String(abs % 10 ** decimals).padStart(decimals, '0')
  const withSep = major.toLocaleString('en-US')
  return `${sign}${decimals > 0 ? `${withSep}.${frac}` : withSep} ${symbol}`
}

export interface DailyReportInput {
  shopName: string
  dateLabel: string // «2026-09-14»
  invoiceCount: number
  netSalesMinor: Minor
  grossProfitMinor: Minor
  cashInMinor: Minor // نقدي اليوم
  creditInMinor: Minor // آجل اليوم
  returnsMinor: Minor
  lowStockCount: number
  currencySymbol: string
  currencyDecimals: number
}

/** نص تقرير اليوم — يُرسل عبر sendMessage */
export function buildDailyReportText(r: DailyReportInput): string {
  const f = (m: Minor) => fmtAmount(m, r.currencyDecimals, r.currencySymbol)
  const lines = [
    `📊 تقرير اليوم — ${r.shopName}`,
    `📅 ${r.dateLabel}`,
    '',
    `🧾 الفواتير: ${r.invoiceCount}`,
    `💰 صافي المبيعات: ${f(r.netSalesMinor)}`,
    `📈 مجمل الربح: ${f(r.grossProfitMinor)}`,
    `💵 نقدي: ${f(r.cashInMinor)}`,
    `🕐 آجل: ${f(r.creditInMinor)}`,
  ]
  if (r.returnsMinor > 0) lines.push(`↩️ مرتجعات: ${f(r.returnsMinor)}`)
  if (r.lowStockCount > 0) lines.push('', `⚠️ أصناف وصلت حد الطلب: ${r.lowStockCount}`)
  return lines.join('\n')
}

export interface LowStockRow {
  nameAr: string
  stockQty: number
  minQty: number
}

/** نص تنبيه النواقص — أعلى 20 صنفاً كي لا تتضخم الرسالة */
export function buildLowStockText(shopName: string, rows: LowStockRow[]): string {
  const lines = [`⚠️ نواقص المخزون — ${shopName}`, '']
  for (const r of rows.slice(0, 20)) {
    lines.push(`• ${r.nameAr}: المتبقي ${r.stockQty} (حد الطلب ${r.minQty})`)
  }
  if (rows.length > 20) lines.push(`… و${rows.length - 20} صنفاً آخر`)
  return lines.join('\n')
}

/** تعليق ملف النسخة الاحتياطية عند إرسالها sendDocument */
export function buildBackupCaption(shopName: string, nowIso: string): string {
  return `🗄 نسخة احتياطية — ${shopName}\n${nowIso.slice(0, 16).replace('T', ' ')}`
}
