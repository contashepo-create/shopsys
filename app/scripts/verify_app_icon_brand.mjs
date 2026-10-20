#!/usr/bin/env node
/**
 * بوابة البند ٦ — أيقونة سطح المكتب بصيغة العلامة التجارية (لا حرف T).
 *
 * ما الذي تفحصه:
 *   ① الأصول: `public/app-icon.png` (شارة بيضاء ٥١٢) و`public/app-mark.png`
 *      (العلامة وحدها بخلفية شفافة) و`desktop/build/icon.ico` + `icon-1024.png`
 *      + `icon.png` (موارد electron-builder).
 *   ② الألوان: الأيقونة تحتوي على الأخضر الزمردي (شارة الصح) والأزرق الكحلي
 *      (الدرع) والأبيض — أي أنها العلامة المعتمدة، لا الأيقونة القديمة (حرف T).
 *   ③ الشفافية: أركان الشارة شفافة (مربّع بزوايا دائرية) لا مستطيل أبيض.
 *   ④ الاستخدام داخل التطبيق: الشعار المصغّر في الشريط الجانبي وشريط القوائم
 *      ورمز التبويب = العلامة (app-mark) بمسار نسبي (يعمل عبر file://).
 *
 * يُقرأ PNG بمُرمِّز صغير داخل السكربت (بلا اعتماديات) — البوابة تعمل في CI
 * بلا مكتبات صور.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const APP = join(DIR, '..')
let failed = 0
const failedNames = []
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) { failed++; failedNames.push(name) }
}

/* ── مُرمِّز PNG مصغّر (RGBA 8-bit) ─────────────────────────────────────── */
function decodePng(buffer) {
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`صيغة PNG غير مدعومة (depth=${bitDepth} color=${colorType})`)
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      const v = line[x]
      let value
      if (filter === 0) value = v
      else if (filter === 1) value = v + a
      else if (filter === 2) value = v + b
      else if (filter === 3) value = v + ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      cur[x] = value & 0xff
    }
  }
  return { width, height, data: out }
}

const at = (img, x, y) => {
  const o = (y * img.width + x) * 4
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3] }
}

/** هل توجد بكسلات بالشرط المعطى؟ (نمطBrand: أخضر زمردي / كحلي / أبيض) */
function hasPixel(img, predicate) {
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      if (predicate(at(img, x, y))) return true
    }
  }
  return false
}

const isEmerald = (p) => p.a > 120 && p.g > 110 && p.g > p.r + 40 && p.g > p.b + 15
const isNavy = (p) => p.a > 120 && p.b > 70 && p.b > p.r + 25 && p.b > p.g - 10
const isWhite = (p) => p.a > 200 && p.r > 242 && p.g > 242 && p.b > 242

/* ─── ① الأصول ─────────────────────────────────────────────────────────── */
const readAsset = (rel) => {
  try { return readFileSync(join(APP, rel)) } catch { return null }
}

const iconBuf = readAsset('public/app-icon.png')
check('① public/app-icon.png موجودة', !!iconBuf)
let icon = null
if (iconBuf) {
  try { icon = decodePng(iconBuf) } catch (err) { check('① app-icon.png تُقرأ كـPNG', false, String(err.message ?? err)) }
}
if (icon) {
  check('① app-icon.png بمقاس 512×512', icon.width === 512 && icon.height === 512, `${icon.width}×${icon.height}`)
  check('① app-icon.png بقناة شفافية (الزوايا شفافة)', at(icon, 1, 1).a < 60 && at(icon, 510, 1).a < 60)
  check('① الشارة بيضاء', hasPixel(icon, isWhite))
}

const markBuf = readAsset('public/app-mark.png')
check('① public/app-mark.png موجودة', !!markBuf)
let mark = null
if (markBuf) {
  try { mark = decodePng(markBuf) } catch (err) { check('① app-mark.png تُقرأ كـPNG', false, String(err.message ?? err)) }
}
if (mark) {
  check('① app-mark.png بمقاس 512×512', mark.width === 512 && mark.height === 512, `${mark.width}×${mark.height}`)
  check('① app-mark.png بخلفية شفافة', at(mark, 2, 2).a < 60)
}

const icoBuf = readAsset('desktop/build/icon.ico')
check('① desktop/build/icon.ico موجودة', !!icoBuf)
if (icoBuf) {
  const count = icoBuf.readUInt16LE(4)
  const sizes = []
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    sizes.push(icoBuf[off] === 0 ? 256 : icoBuf[off])
  }
  check('① icon.ico متعدد الأحجام (≥٦)', count >= 6, `${count} أحجام: ${sizes.join(' · ')}`)
  check('① icon.ico حجمه سليم (>50KB)', icoBuf.length > 50_000, `${(icoBuf.length / 1024).toFixed(0)}KB`)
}

const bigBuf = readAsset('desktop/build/icon-1024.png')
if (bigBuf) {
  const big = decodePng(bigBuf)
  check('① icon-1024.png بمقاس 1024×1024', big.width === 1024 && big.height === 1024, `${big.width}×${big.height}`)
} else check('① desktop/build/icon-1024.png موجودة', false)

const deskBuf = readAsset('desktop/build/icon.png')
check('① desktop/build/icon.png موجودة وحجمها ≥20KB', !!deskBuf && deskBuf.length > 20_000, deskBuf ? `${(deskBuf.length / 1024).toFixed(0)}KB` : 'مفقودة')

/* ─── ② العلامة التجارية (لا حرف T) ───────────────────────────────────── */
if (icon) {
  check('② الأيقونة تحمل الأخضر الزمردي (شارة الصح)', hasPixel(icon, isEmerald))
  check('② الأيقونة تحمل الأزرق الكحلي (الدرع)', hasPixel(icon, isNavy))
}
if (mark) {
  check('② العلامة تحمل الأخضر الزمردي', hasPixel(mark, isEmerald))
  check('② العلامة تحمل الأزرق الكحلي', hasPixel(mark, isNavy))
}

/* ─── ③ الاستخدام داخل التطبيق ────────────────────────────────────────── */
const readText = (rel) => {
  try { return readFileSync(join(APP, rel), 'utf8').replace(/\r\n/g, '\n') } catch { return '' }
}
const sidebar = readText('src/ui/layout/Sidebar.tsx')
const menubar = readText('src/ui/layout/MenuBar.tsx')
const html = readText('index.html')
check('③ الشعار في الشريط الجانبي = العلامة بمسار نسبي', sidebar.includes('src="./app-mark.png'))
check('③ الشعار في شريط القوائم = العلامة بمسار نسبي', menubar.includes('src="./app-mark.png'))
check('③ رمز التبويب (favicon) = العلامة', html.includes('/app-mark.png'))
check('③ أيقونة نافذة سطح المكتب من مجلد dist', readText('desktop/main.ts').includes("icon: join(__dirname, '../dist/app-icon.png')"))

if (failed === 0) console.log('\nبوابة البند ٦: ✓ أيقونة العلامة التجارية مكتملة (شارة + علامة + موارد سطح المكتب)')
else {
  console.log(`\nبوابة البند ٦: ✗ ${failed} فحص فاشل — ${failedNames.join(' · ')}`)
  process.exit(1)
}
