// تحقق نواة بوت التليجرام — جانب العميل (المرحلة 5 — القرار 7):
// صحة التوكن والمحادثة، إخفاء التوكن، روابط Bot API، صياغة الرسائل الثلاث
// التشغيل: node --experimental-strip-types scripts/verify_telegram.mjs
import {
  isValidBotToken,
  isValidChatId,
  maskToken,
  apiUrl,
  buildDailyReportText,
  buildLowStockText,
  buildBackupCaption,
  DEFAULT_TELEGRAM_SETTINGS,
} from '../src/core/telegram.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const TOKEN = '1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw2'

console.log('— التوكن والمحادثة —')
check('توكن BotFather سليم يمر', isValidBotToken(TOKEN))
check('يقبل مسافات زائدة حول التوكن', isValidBotToken(`  ${TOKEN}  `))
check('يرفض توكناً بلا نقطتين', !isValidBotToken('1234567890AAHdqTcvCH1vGWJxfSeofSAs0K5PALD'))
check('يرفض توكناً قصير الذيل', !isValidBotToken('1234567890:short'))
check('يرفض نصاً عشوائياً', !isValidBotToken('hello world'))
check('chat id خاص (موجب) يمر', isValidChatId('123456789'))
check('chat id مجموعة (سالب -100…) يمر', isValidChatId('-1001234567890'))
check('يرفض chat id نصياً', !isValidChatId('@username'))
check('يرفض chat id قصيراً جداً', !isValidChatId('12'))

console.log('— الإخفاء والروابط —')
const masked = maskToken(TOKEN)
check('الإخفاء يبقي البداية والنهاية فقط', masked.startsWith('1234567890:AA') && masked.endsWith(TOKEN.slice(-4)) && masked.includes('…'))
check('الإخفاء لا يكشف وسط التوكن', !masked.includes('dqTcvCH1'))
check('توكن فارغ ← نص فارغ', maskToken('') === '')
check('رابط sendMessage صحيح', apiUrl(TOKEN, 'sendMessage') === `https://api.telegram.org/bot${TOKEN}/sendMessage`)
check('الرابط يشذّب المسافات', apiUrl(`  ${TOKEN} `, 'getMe').includes(`bot${TOKEN}/getMe`))

console.log('— تقرير اليوم —')
const daily = buildDailyReportText({
  shopName: 'بقالة النور',
  dateLabel: '2026-09-14',
  invoiceCount: 23,
  netSalesMinor: 1250050, // 12,500.50
  grossProfitMinor: 310000,
  cashInMinor: 1000050,
  creditInMinor: 250000,
  returnsMinor: 15000,
  lowStockCount: 3,
  currencySymbol: 'ج.م',
  currencyDecimals: 2,
})
check('يتضمن اسم المحل والتاريخ', daily.includes('بقالة النور') && daily.includes('2026-09-14'))
check('عدد الفواتير', daily.includes('الفواتير: 23'))
check('صافي المبيعات بفواصل الآلاف', daily.includes('12,500.50 ج.م'))
check('نقدي وآجل', daily.includes('نقدي: 10,000.50') && daily.includes('آجل: 2,500.00'))
check('سطر المرتجعات يظهر عند وجودها', daily.includes('مرتجعات: 150.00'))
check('سطر النواقص يظهر عند وجودها', daily.includes('حد الطلب: 3'))
const dailyClean = buildDailyReportText({
  shopName: 'س', dateLabel: '2026-01-01', invoiceCount: 0,
  netSalesMinor: 0, grossProfitMinor: 0, cashInMinor: 0, creditInMinor: 0,
  returnsMinor: 0, lowStockCount: 0, currencySymbol: 'ر.س', currencyDecimals: 2,
})
check('بلا مرتجعات/نواقص: لا سطرين لهما', !dailyClean.includes('مرتجعات') && !dailyClean.includes('حد الطلب'))
const dailyKwd = buildDailyReportText({
  shopName: 'س', dateLabel: '2026-01-01', invoiceCount: 1,
  netSalesMinor: 1500, grossProfitMinor: 0, cashInMinor: 1500, creditInMinor: 0,
  returnsMinor: 0, lowStockCount: 0, currencySymbol: 'د.ك', currencyDecimals: 3,
})
check('عملة بثلاث منازل (دينار): 1.500', dailyKwd.includes('1.500 د.ك'))

console.log('— النواقص والنسخة —')
const rows = Array.from({ length: 25 }, (_, i) => ({ nameAr: `صنف ${i + 1}`, stockQty: i, minQty: 10 }))
const low = buildLowStockText('محل', rows)
check('أول 20 صنفاً فقط', low.includes('صنف 20') && !low.includes('صنف 21:'))
check('سطر «و5 أصناف أخرى»', low.includes('و5 صنفاً آخر'))
const lowFew = buildLowStockText('محل', rows.slice(0, 3))
check('ثلاثة أصناف: لا سطر إضافي', !lowFew.includes('آخر'))
check('تنسيق السطر: المتبقي وحد الطلب', lowFew.includes('صنف 1: المتبقي 0 (حد الطلب 10)'))
const cap = buildBackupCaption('بقالة النور', '2026-09-14T22:10:33.000Z')
check('تعليق النسخة: اسم وتاريخ-وقت', cap.includes('بقالة النور') && cap.includes('2026-09-14 22:10'))

console.log('— الافتراضيات —')
check('افتراضياً: توكن فارغ وكل الإرسالات مفعلة', DEFAULT_TELEGRAM_SETTINGS.botToken === '' && DEFAULT_TELEGRAM_SETTINGS.sendDailyReport && DEFAULT_TELEGRAM_SETTINGS.sendLowStock && DEFAULT_TELEGRAM_SETTINGS.sendBackups)

console.log(`\nالتليجرام: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
