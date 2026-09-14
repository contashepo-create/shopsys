/**
 * مرسل التليجرام المشترك (القرار 32) — تستخدمه صفحة البوت (يدوياً)
 * وجدولة App.tsx (تلقائياً): تقرير اليوم + النواقص + النسخة الاحتياطية.
 * يرمي أخطاء عربية مفهومة — من يستدعيه يقرر العرض أو الصمت.
 */
import { useAppStore } from '../stores/app.store.ts'
import { useDataStore } from '../data/repo.ts'
import { getCountry } from '../core/countries.ts'
import {
  isValidBotToken, isValidChatId, apiUrl,
  buildDailyReportText, buildLowStockText, buildBackupCaption,
} from '../core/telegram.ts'
import { salesSummary, stockAlerts, type Period } from '../core/reports.ts'
import { buildBackup, backupFileName } from '../core/backup.ts'
import { decryptForDevice } from '../data/secureStorage.ts'

const DATA_VERSION = 6 // إصدار persist لمخزن shopsys-data

/** استدعاء Bot API برسائل خطأ عربية */
export async function callBot(token: string, method: string, body: FormData | Record<string, unknown>): Promise<void> {
  const init: RequestInit = body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  let res: Response
  try {
    res = await fetch(apiUrl(token, method), init)
  } catch {
    throw new Error('تعذر الوصول إلى تليجرام — تحقق من اتصال الإنترنت')
  }
  const data = (await res.json()) as { ok: boolean; description?: string }
  if (!data.ok) {
    if (res.status === 401) throw new Error('التوكن مرفوض — تأكد منه في BotFather')
    if (data.description?.includes('chat not found')) throw new Error('المحادثة غير موجودة — أرسل /start للبوت أولاً ثم أعد المحاولة')
    throw new Error(data.description || 'رفض تليجرام الطلب')
  }
}

/** هل اتصال البوت مكتمل الصيغة؟ */
export function botConnected(): boolean {
  const { telegram } = useAppStore.getState()
  return isValidBotToken(telegram.botToken) && isValidChatId(telegram.chatId)
}

/** إرسال تقرير اليوم (+ النواقص إن فُعّلت) — يقرأ الحالة الحية من المخازن */
export async function sendDailyReportNow(): Promise<void> {
  const app = useAppStore.getState()
  const data = useDataStore.getState()
  const cur = (app.setup.countryCode && getCountry(app.setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const today = new Date().toISOString().slice(0, 10)
  const period: Period = { from: today, to: today }
  const s = salesSummary(data.sales, data.saleReturns, period)
  const alerts = stockAlerts(data.items)
  await callBot(app.telegram.botToken, 'sendMessage', {
    chat_id: app.telegram.chatId,
    text: buildDailyReportText({
      shopName: app.setup.shopName || 'تَحَكَّم',
      dateLabel: today,
      invoiceCount: s.invoiceCount,
      netSalesMinor: s.totalMinor,
      grossProfitMinor: s.netProfitMinor,
      cashInMinor: s.cashMinor,
      creditInMinor: s.creditMinor,
      returnsMinor: s.returnsMinor,
      lowStockCount: alerts.length,
      currencySymbol: cur.symbol,
      currencyDecimals: cur.decimals,
    }),
  })
  if (app.telegram.sendLowStock && alerts.length > 0) {
    await callBot(app.telegram.botToken, 'sendMessage', {
      chat_id: app.telegram.chatId,
      text: buildLowStockText(app.setup.shopName || 'تَحَكَّم', alerts),
    })
  }
}

/** إرسال نسخة احتياطية كاملة كملف مستند */
export async function sendBackupNow(): Promise<void> {
  const app = useAppStore.getState()
  const appRaw = localStorage.getItem('shopsys-app')
  const storeEnc = localStorage.getItem('shopsys-data')
  // قاعدة البيانات مشفرة على القرص (القرار 28) — نفكها قبل بناء ملف النسخة
  const storeRaw = storeEnc == null ? null : await decryptForDevice(storeEnc)
  if (!storeRaw) throw new Error('لا بيانات للنسخ بعد')
  const backup = buildBackup({
    appState: appRaw ? JSON.parse(appRaw) : null,
    storeState: JSON.parse(storeRaw),
    appDataVersion: DATA_VERSION,
    shopName: app.setup.shopName,
  })
  const fd = new FormData()
  fd.set('chat_id', app.telegram.chatId)
  fd.set('caption', buildBackupCaption(app.setup.shopName || 'تَحَكَّم', backup.createdAt))
  fd.set('document', new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }), backupFileName(app.setup.shopName, backup.createdAt))
  await callBot(app.telegram.botToken, 'sendDocument', fd)
}
