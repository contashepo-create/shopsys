/**
 * إرسال رسائل التليجرام مع التحقق من النتيجة — إصلاح «التسليم» في مراجعة المرحلة ③.
 * ───────────────────────────────────────────────────────────────────────────────
 * ما كان: `sendTelegram` ينفّذ `fetch` ولا يفحص `res.ok`. فرفض تليجرام — 400 (وسوم
 * HTML مكسورة، رسالة أطول من 4096 حرفاً) أو 429 (تجاوز الحد) — يمرّ **صامتاً**،
 * و`scheduled()` يكتب علامة `digest-sent:<اليوم>` بعد «إرسال» لم يصل، فيضيع تذكير
 * اليوم بلا أي أثر يراه المطوّر.
 *
 * الآن:
 *   • الفشل النهائي **يُرمى**: لا تُكتب علامة اليوم، ويصل خبر الفشل للمطوّر.
 *   • 429 ⇒ ينتظر `retry_after` (بسقف 20 ثانية) ثم يعيد مرة واحدة؛ و5xx ⇒ إعادة مرة واحدة.
 *   • 400 بسبب تحليل الوسوم ⇒ يعيد الإرسال **نصاً عادياً** فتصل الرسالة بلا تنسيق.
 *   • الرسالة الأطول من الحد تُقسَّم عند حدود السطر قبل الإرسال (كل صف سطر مستقل).
 *   • لوحة الأزرار (reply_markup) تُلصق بآخر جزء فقط، حيث يتوقعها المطوّر.
 *
 * وحدة مستقلة بلا استيراد من worker.js (درس الاستيراد الدائري في هذا المجلد)،
 * حتى تُختبر مباشرة بلا تحميل العامل كله.
 */

/** حدّ تليجرام 4096 حرفاً بعد التهريب؛ نترك هامشاً للوسوم عند التقسيم */
export const TG_MAX_CHARS = 3800
const RETRY_CAP_SECONDS = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * يقسم النص إلى أجزاء كل منها ≤ max. الأصل: حدود السطر، فالصفوف مستقلة.
 * سطر أطول من الحد يُقسم عند مسافة، وإن لم توجد فعند موضع آمن (لا داخل وسم أو كيان
 * مثل `&amp;`، فيبقى HTML سليماً في كل جزء).
 */
export function splitForTelegram(text, max = TG_MAX_CHARS) {
  const src = String(text ?? '')
  if (src.length <= max) return [src]
  const parts = []
  let current = ''
  for (const line of src.split('\n')) {
    const pieces = line.length > max ? splitLongLine(line, max) : [line]
    for (const piece of pieces) {
      const joined = current === '' ? piece : `${current}\n${piece}`
      if (joined.length > max && current !== '') {
        parts.push(current)
        current = piece
      } else {
        current = joined
      }
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function splitLongLine(line, max) {
  const out = []
  let rest = line
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max)
    if (cut <= 0) cut = safeCut(rest, max)
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^ +/, '')
  }
  out.push(rest)
  return out
}

/* موضع قطع end (يُستبعد الحرف عند end) لا يقع داخل وسم مفتوح ولا داخل كيان HTML.
   البحث يكون داخل النافذة [0, end) فقط: الخطأ السابق بحث حتى end فلم يرَ `>` التي
   تُغلق الوسم عند الحد نفسه فقطع الوسم في منتصفه. */
function safeCut(s, max) {
  let end = max
  const lt = s.lastIndexOf('<', end - 1)
  if (lt > 0 && lt > s.lastIndexOf('>', end - 1)) end = lt
  const amp = s.lastIndexOf('&', end - 1)
  if (amp > 0 && amp > s.lastIndexOf(';', end - 1)) end = amp
  return end > 0 ? end : max
}

/** نسخة نصية من HTML المرسل: تُزال الوسوم وتُفكّ الكيانات الثلاثة التي نهرّبها */
export function htmlToPlain(html) {
  return String(html ?? '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // آخراً: وإلا تحوّل «&amp;lt;» إلى «<» خطأً
}

async function post(cfg, chatId, text, opts) {
  return fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...opts }),
  })
}

async function failureOf(res) {
  let body = {}
  try { body = await res.json() } catch { /* ليس JSON */ }
  const retry = Number(body?.parameters?.retry_after)
  return {
    status: res.status,
    description: String(body?.description ?? res.statusText ?? 'خطأ غير معروف'),
    retryAfter: Number.isFinite(retry) && retry >= 0 ? retry : 1,
  }
}

async function sendPart(cfg, chatId, text, opts) {
  let res = await post(cfg, chatId, text, { parse_mode: 'HTML', ...opts })
  let err = res.ok ? null : await failureOf(res)
  if (err && err.status === 429) {
    await sleep(Math.min(err.retryAfter, RETRY_CAP_SECONDS) * 1000)
    res = await post(cfg, chatId, text, { parse_mode: 'HTML', ...opts })
    err = res.ok ? null : await failureOf(res)
  } else if (err && err.status >= 500) {
    await sleep(2000)
    res = await post(cfg, chatId, text, { parse_mode: 'HTML', ...opts })
    err = res.ok ? null : await failureOf(res)
  } else if (err && err.status === 400 && /can't parse entities/i.test(err.description)) {
    res = await post(cfg, chatId, htmlToPlain(text), { ...opts }) // بلا parse_mode: نص عادي يصل
    err = res.ok ? null : await failureOf(res)
  }
  if (err) throw new Error(`تليجرام رفض الرسالة (${err.status}): ${err.description}`)
}

/**
 * يرسل رسالة (أو أكثر إن طالت). يرمي خطأً عند الفشل النهائي — المستدعي قرّر
 * ماذا يفعل (مثلاً: `scheduled()` لا يكتب علامة اليوم، والـwebhook يعيد 200 ويبلّغ).
 */
export async function sendTelegram(cfg, chatId, text, opts = {}) {
  const parts = splitForTelegram(text)
  for (let i = 0; i < parts.length; i++) {
    await sendPart(cfg, chatId, parts[i], i === parts.length - 1 ? opts : {})
  }
}
