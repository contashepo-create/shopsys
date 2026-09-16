/**
 * فاتورة A4 احترافية — ShopSys (المرحلة 5)
 * ─────────────────────────────────────────
 * أربعة أنماط منقولة ومكيّفة من قوالب logistics-web (عصري/كلاسيكي/مدمج/فاخر)
 * مع تحكم كامل من الإعدادات: شعار، علامة مائية، لون رئيسي، وإظهار/إخفاء كل عنصر.
 * دوال خالصة بالكامل — تُفحص في verify_receipt.
 */
import type { ReceiptModel, ReceiptSettings, A4Style } from '../../core/receipt.ts'
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ─── تفقيط عربي (المبلغ كتابةً) ─── */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

function below1000(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(HUNDREDS[h])
  if (r) {
    if (r < 20) parts.push(ONES[r])
    else {
      const o = r % 10
      const t = Math.floor(r / 10)
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t])
    }
  }
  return parts.join(' و')
}

/** تفقيط عدد صحيح حتى مليارات — يكفي أي فاتورة */
export function numberToArabicWords(n: number): string {
  if (n === 0) return 'صفر'
  if (n < 0) return `سالب ${numberToArabicWords(-n)}`
  const scales: [number, string, string, string][] = [
    [1_000_000_000, 'مليار', 'ملياران', 'مليارات'],
    [1_000_000, 'مليون', 'مليونان', 'ملايين'],
    [1_000, 'ألف', 'ألفان', 'آلاف'],
  ]
  const parts: string[] = []
  let rest = Math.floor(n)
  for (const [scale, one, two, many] of scales) {
    const count = Math.floor(rest / scale)
    rest %= scale
    if (!count) continue
    if (count === 1) parts.push(one)
    else if (count === 2) parts.push(two)
    else if (count <= 10) parts.push(`${below1000(count)} ${many}`)
    else parts.push(`${below1000(count)} ${one}`)
  }
  if (rest) parts.push(below1000(rest))
  return parts.join(' و')
}

/** «مائة وثلاثون جنيهاً وخمسون من المائة فقط لا غير» */
export function amountInWords(minor: number, cur: CurrencyConfig): string {
  const major = Math.floor(Math.abs(minor) / 10 ** cur.decimals)
  const frac = Math.abs(minor) % 10 ** cur.decimals
  let s = `${numberToArabicWords(major)} ${cur.name || cur.symbol}`
  if (frac > 0) s += ` و${numberToArabicWords(frac)} من المائة`
  return `${s} فقط لا غير`
}

/* ─── لبنات مشتركة بين الأنماط ─── */

const safeColor = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)

function logoImg(s: ReceiptSettings, size: number, radius: number): string {
  if (!s.showLogo || !s.logoDataUrl) return ''
  // تحكم كامل بالحجم والشفافية (طلب المالك) — الحجم بالمليمتر أدق للطباعة من البكسل
  const h = Math.min(60, Math.max(10, s.logoSizeMm || Math.round(size / 3.78)))
  const op = Math.min(100, Math.max(10, s.logoOpacity || 100)) / 100
  return `<img class="logo" src="${esc(s.logoDataUrl)}" alt="شعار" style="height:${h}mm;width:auto;max-width:70mm;object-fit:contain;border-radius:${radius}px;background:#fff;opacity:${op};"/>`
}

function watermark(s: ReceiptSettings): string {
  if (!s.watermarkEnabled || !s.watermarkText.trim()) return ''
  // إصلاح بلاغ المالك: كانت تُرسم تحت جدول الأصناف فتختفي خلف خلفياته —
  // الآن فوق كل المحتوى (z-index أعلى) بشفافية منخفضة + تحكم كامل بالميل/الحجم/اللون
  const rot = Math.min(90, Math.max(-90, s.watermarkRotation ?? -30))
  const size = Math.min(140, Math.max(24, s.watermarkSizePt || 72))
  const op = Math.min(30, Math.max(3, s.watermarkOpacity || 8)) / 100
  const color = safeColor(s.watermarkColor, '#64748b')
  return `<div class="wm" style="font-size:${size}pt;color:${color};opacity:${op};transform:rotate(${rot}deg);">${esc(s.watermarkText)}</div>`
}

function headerLinesHtml(m: ReceiptModel, s: ReceiptSettings, cls = 'hl'): string {
  if (!s.showHeaderLines) return ''
  return m.headerLines.map((l) => `<div class="${cls}">${esc(l)}</div>`).join('')
}

/**
 * كتلة «الشعار + اسم المحل» بموضع شعار قابل للتحكم (طلب المالك):
 * side = بجانب الاسم · above = فوق الاسم في المنتصف · center = منتصف عرض الرأس كاملاً
 */
function whoBlock(m: ReceiptModel, s: ReceiptSettings, accent: string, size: number, radius: number): string {
  const name = `<div class="shop" style="color:${accent}">${esc(m.shopName)}</div>${headerLinesHtml(m, s)}`
  const pos = s.logoPosition || 'side'
  if (pos === 'above') {
    return `<div class="who" style="display:block;text-align:center;">${logoImg(s, size, radius)}${name}</div>`
  }
  if (pos === 'center') {
    return `<div class="who" style="display:block;text-align:center;flex:1;">${logoImg(s, size, radius)}${name}</div>`
  }
  return `<div class="who">${logoImg(s, size, radius)}<div>${name}</div></div>`
}

function metaRows(m: ReceiptModel, s: ReceiptSettings): string {
  const rows: string[] = [`<tr><td class="k">رقم الفاتورة</td><td class="v">${esc(m.invoiceNumber)}</td></tr>`]
  if (m.refCode) rows.push(`<tr><td class="k">مرجع التتبع</td><td class="v" dir="ltr">${esc(m.refCode)}</td></tr>`)
  if (s.showDate) rows.push(`<tr><td class="k">التاريخ</td><td class="v">${esc(m.dateLabel)}</td></tr>`)
  if (s.showCustomer) rows.push(`<tr><td class="k">العميل</td><td class="v">${esc(m.customerName)}</td></tr>`)
  if (s.showPayment) rows.push(`<tr><td class="k">طريقة الدفع</td><td class="v">${esc(m.paymentLabel)}</td></tr>`)
  return `<table class="meta">${rows.join('')}</table>`
}

function itemsTable(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, opts: { dense?: boolean; classic?: boolean; elegant?: boolean }): string {
  const fmt = (v: number) => formatMinor(v, cur, false)
  const showDisc = s.showDiscount && m.rows.some((r) => r.discountPercent > 0)
  const cols = showDisc ? 6 : 5
  const rows = m.rows
    .map(
      (r, i) => `<tr class="${i % 2 && !opts.elegant ? 'alt' : ''}">
      <td class="c mut">${i + 1}</td>
      <td class="name">${esc(r.nameAr)}${r.serials.length ? `<div style="font-size:9px;color:#64748b;direction:ltr;text-align:right">${r.serials.map(esc).join(' · ')}</div>` : ''}</td>
      <td class="c">${esc(r.qtyLabel)}</td>
      <td class="c">${fmt(r.unitPriceMinor)}</td>
      ${showDisc ? `<td class="c">${r.discountPercent ? `${r.discountPercent}٪` : '—'}</td>` : ''}
      <td class="c b">${fmt(r.totalMinor)}</td>
    </tr>`,
    )
    .join('')
  return `<table class="items" data-cols="${cols}">
    <thead><tr>
      <th style="width:28px">#</th><th class="r">الصنف</th><th>الكمية</th><th>سعر الوحدة</th>
      ${showDisc ? '<th>الخصم</th>' : ''}<th>الإجمالي</th>
    </tr></thead><tbody>${rows}</tbody>
  </table>`
}

function totalsBlock(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, dark = false): string {
  const fmt = (v: number) => formatMinor(v, cur, false)
  const rows: string[] = []
  if (s.showItemCounts) rows.push(`<div class="tr"><span>عدد الأصناف / القطع</span><b>${m.itemCount} / ${m.totalQty}</b></div>`)
  if (s.showDiscount && m.discountMinor > 0) {
    rows.push(`<div class="tr"><span>الإجمالي قبل الخصم</span><b>${fmt(m.grossMinor)}</b></div>`)
    rows.push(`<div class="tr"><span>إجمالي الخصم</span><b>-${fmt(m.discountMinor)}</b></div>`)
  }
  if (m.taxLabel) {
    rows.push(`<div class="tr"><span>الوعاء الضريبي</span><b>${fmt(m.taxBaseMinor)}</b></div>`)
    rows.push(`<div class="tr"><span>${esc(m.taxLabel)}</span><b>${fmt(m.taxMinor)}</b></div>`)
  }
  // الدفع المجزأ (بلاغ المالك): المدفوع والمتبقي يظهران على المطبوعة
  const paidRows = m.remainingMinor > 0
    ? `<div class="tr"><span>المدفوع</span><b>${fmt(m.paidMinor)}</b></div>
       <div class="tr" style="color:#b45309"><span>المتبقي (آجل)</span><b>${fmt(m.remainingMinor)} ${esc(cur.symbol)}</b></div>`
    : ''
  return `<div class="totals ${dark ? 'dark' : ''}">
    ${rows.join('')}
    <div class="grand"><span>الإجمالي المستحق</span><span class="g">${fmt(m.totalMinor)} ${esc(cur.symbol)}</span></div>
    ${paidRows}
  </div>`
}

function wordsBlock(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings): string {
  if (!s.showWords) return ''
  return `<div class="words"><div class="wt">المبلغ كتابةً</div><div class="wv">${esc(amountInWords(m.totalMinor, cur))}</div></div>`
}

function signatures(s: ReceiptSettings): string {
  if (!s.showSignatures) return ''
  return `<div class="sig"><div>توقيع البائع</div><div>توقيع المستلم</div></div>`
}

function footer(m: ReceiptModel, s: ReceiptSettings): string {
  const qr = m.qrDataUrl
    ? `<div style="text-align:center;margin-top:4mm"><img src="${esc(m.qrDataUrl)}" alt="ZATCA QR" style="width:28mm;height:auto"/><div style="font-size:9px;color:#64748b">رمز الفاتورة الضريبية (زاتكا)</div></div>`
    : ''
  if (!s.showFooter || !m.footerText.trim()) return qr
  return `${qr}<div class="foot">${esc(m.footerText)}</div>`
}

/* ─── الأنماط الأربعة ─── */

function renderModern(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, accent: string): string {
  return `
  <div class="sheet modern">
    <div class="topbar"></div>
    <div class="head">
      ${whoBlock(m, s, accent, 64, 12)}
      <div class="title-box">
        <div class="tb" style="background:${accent}">${esc(m.docTitle ?? 'فاتورة مبيعات')}</div>
        ${metaRows(m, s)}
      </div>
    </div>
    ${itemsTable(m, cur, s, {})}
    <div class="bottom">
      ${wordsBlock(m, cur, s)}
      ${totalsBlock(m, cur, s)}
    </div>
    ${signatures(s)}${footer(m, s)}
  </div>`
}

function renderClassic(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, accent: string): string {
  return `
  <div class="sheet classic">
    <div class="head" style="border:1.5pt solid ${accent};padding:12px 16px;">
      ${whoBlock(m, s, accent, 58, 6)}
      <div class="title-box">
        <div class="tb outlined" style="border:2px solid ${accent};color:${accent}">${esc(m.docTitle ?? 'فاتورة مبيعات')}</div>
        ${metaRows(m, s)}
      </div>
    </div>
    ${itemsTable(m, cur, s, { classic: true })}
    <div class="bottom" style="border:1pt solid ${accent};padding:12px;">
      ${wordsBlock(m, cur, s)}
      ${totalsBlock(m, cur, s)}
    </div>
    ${signatures(s)}${footer(m, s)}
  </div>`
}

function renderCompact(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, accent: string): string {
  return `
  <div class="sheet compact">
    <div class="head slim">
      <div class="who">${logoImg(s, 40, 7)}<div>
        <span class="shop sm" style="color:${accent}">${esc(m.shopName)}</span>
        ${s.showHeaderLines && m.headerLines.length ? `<span class="hl inline">${m.headerLines.map(esc).join(' — ')}</span>` : ''}
      </div></div>
      <div class="mini"><b style="color:${accent}">${esc(m.docTitle ?? 'فاتورة مبيعات')}</b>
        <span>${esc(m.invoiceNumber)}${m.refCode ? ` | <span dir="ltr">${esc(m.refCode)}</span>` : ''}${s.showDate ? ` | ${esc(m.dateLabel)}` : ''}</span>
      </div>
    </div>
    ${s.showCustomer || s.showPayment ? `<div class="strip">${s.showCustomer ? `العميل: <b>${esc(m.customerName)}</b>` : ''}${s.showCustomer && s.showPayment ? ' — ' : ''}${s.showPayment ? `الدفع: <b>${esc(m.paymentLabel)}</b>` : ''}</div>` : ''}
    ${itemsTable(m, cur, s, { dense: true })}
    <div class="bottom">
      ${wordsBlock(m, cur, s)}
      ${totalsBlock(m, cur, s)}
    </div>
    ${signatures(s)}${footer(m, s)}
  </div>`
}

function renderElegant(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, accent: string): string {
  return `
  <div class="sheet elegant" style="border:1px solid ${accent}26;">
    <div class="head center" style="border-bottom:1px solid ${accent}26;">
      ${logoImg(s, 62, 16)}
      <div class="shop" style="color:${accent}">${esc(m.shopName)}</div>
      ${headerLinesHtml(m, s)}
      <div class="pill" style="background:${accent}12;color:${accent}">${esc(m.docTitle ?? 'فاتورة مبيعات')} ${esc(m.invoiceNumber)}${m.refCode ? ` • <span dir="ltr">${esc(m.refCode)}</span>` : ''}${s.showDate ? ` • ${esc(m.dateLabel)}` : ''}</div>
    </div>
    ${s.showCustomer || s.showPayment ? `<div class="cards">
      ${s.showCustomer ? `<div class="card" style="background:${accent}0a;border:1px solid ${accent}20"><div class="ct" style="color:${accent}">العميل</div><b>${esc(m.customerName)}</b></div>` : ''}
      ${s.showPayment ? `<div class="card" style="background:${accent}0a;border:1px solid ${accent}20"><div class="ct" style="color:${accent}">طريقة الدفع</div><b>${esc(m.paymentLabel)}</b></div>` : ''}
    </div>` : ''}
    <div class="tbl-wrap" style="border:1px solid ${accent}26;">${itemsTable(m, cur, s, { elegant: true })}</div>
    <div class="bottom dark" style="background:${accent};">
      ${s.showWords ? `<div class="words dark"><div class="wt">المبلغ كتابةً</div><div class="wv">${esc(amountInWords(m.totalMinor, cur))}</div></div>` : '<div></div>'}
      ${totalsBlock(m, cur, s, true)}
    </div>
    ${signatures(s)}${footer(m, s)}
  </div>`
}

/** القالب الملكي (طلب المالك — «قالب احترافي بألوان أجمل»):
 * ترويسة داكنة بتدرج ليلي وخط ذهبي، بطاقات معلومات فاتحة، جدول بإطار ذهبي رقيق */
function renderRoyal(m: ReceiptModel, cur: CurrencyConfig, s: ReceiptSettings, accent: string): string {
  const night = '#1c1917'
  return `
  <div class="sheet royal">
    <div class="head" style="background:linear-gradient(135deg, ${night}, #292524);border-radius:12px;padding:16px 18px;color:#fff;border-bottom:3px solid ${accent}">
      ${whoBlock(m, s, '#fff', 60, 12)}
      <div class="title-box">
        <div class="tb" style="background:${accent};box-shadow:0 2px 8px ${accent}66">${esc(m.docTitle ?? 'فاتورة مبيعات')}</div>
        <div style="color:#e7e5e4">${metaRows(m, s)}</div>
      </div>
    </div>
    ${s.showCustomer || s.showPayment ? `<div class="cards" style="margin-top:10px">
      ${s.showCustomer ? `<div class="card" style="background:${accent}0d;border:1px solid ${accent}33"><div class="ct" style="color:${accent}">العميل</div><b>${esc(m.customerName)}</b></div>` : ''}
      ${s.showPayment ? `<div class="card" style="background:${accent}0d;border:1px solid ${accent}33"><div class="ct" style="color:${accent}">طريقة الدفع</div><b>${esc(m.paymentLabel)}</b></div>` : ''}
    </div>` : ''}
    <div class="tbl-wrap" style="border:1.5px solid ${accent}44;border-radius:10px;overflow:hidden;margin-top:10px">${itemsTable(m, cur, s, { elegant: true })}</div>
    <div class="bottom dark" style="background:linear-gradient(135deg, ${night}, #292524);border-radius:10px;border-inline-start:4px solid ${accent}">
      ${s.showWords ? `<div class="words dark"><div class="wt" style="color:${accent}">المبلغ كتابةً</div><div class="wv">${esc(amountInWords(m.totalMinor, cur))}</div></div>` : '<div></div>'}
      ${totalsBlock(m, cur, s, true)}
    </div>
    ${signatures(s)}${footer(m, s)}
  </div>`
}

/* ─── التجميع النهائي ─── */

const STYLE_ACCENTS: Record<A4Style, string> = {
  modern: '#2563eb', classic: '#1e293b', compact: '#0d9488', elegant: '#7c3aed', royal: '#b45309',
}

/** HTML فاتورة A4 كاملة — دالة خالصة (تُفحص في verify) */
export function renderInvoiceA4Html(model: ReceiptModel, cur: CurrencyConfig, settings: ReceiptSettings): string {
  const style: A4Style = settings.a4Style ?? 'modern'
  const accent = safeColor(settings.accentColor, STYLE_ACCENTS[style] ?? '#6366f1')
  const body =
    style === 'classic' ? renderClassic(model, cur, settings, accent)
    : style === 'compact' ? renderCompact(model, cur, settings, accent)
    : style === 'elegant' ? renderElegant(model, cur, settings, accent)
    : style === 'royal' ? renderRoyal(model, cur, settings, accent)
    : renderModern(model, cur, settings, accent)

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 12px; background: #fff; }
  .sheet { position: relative; overflow: hidden; }
  /* العلامة المائية فوق كل المحتوى (z-index:5) — الشفافية المنخفضة تمنعها من إعاقة القراءة
     (إصلاح: كانت z-index:0 فتختفي خلف خلفيات جدول الأصناف) */
  .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
        font-weight: 800; pointer-events: none; z-index: 5; white-space: nowrap; }
  .sheet > * { position: relative; z-index: 1; }
  .topbar { height: 8px; border-radius: 99px; background: linear-gradient(90deg, ${accent}, #4f46e5, ${accent}); margin-bottom: 14px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 14px; margin-bottom: 14px; }
  .modern .head { border-bottom: 1px solid #e2e8f0; }
  .head.center { display: block; text-align: center; }
  .head.slim { align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 8px; }
  .who { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
  .logo { border: 1px solid #e2e8f0; padding: 4px; }
  .head.center .logo { margin-bottom: 6px; }
  .shop { font-size: 20px; font-weight: 900; line-height: 1.3; }
  .shop.sm { font-size: 15px; }
  .hl { font-size: 10.5px; color: #64748b; line-height: 1.7; }
  .hl.inline { display: inline; margin-inline-start: 8px; }
  .pill { display: inline-block; margin-top: 8px; padding: 5px 16px; border-radius: 999px; font-size: 11px; font-weight: 800; }
  .title-box { min-width: 230px; text-align: center; }
  .tb { color: #fff; border-radius: 10px; padding: 8px 14px; font-size: 16px; font-weight: 900; }
  .tb.outlined { background: transparent; }
  .mini { text-align: left; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
  .meta { width: 100%; margin-top: 7px; font-size: 11px; border-collapse: collapse; }
  .meta .k { padding: 2px; color: #64748b; text-align: right; }
  .meta .v { padding: 2px; text-align: left; font-weight: 800; }
  .strip { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 7px; padding: 6px 10px; margin-bottom: 8px; font-size: 11px; }
  .cards { display: flex; gap: 12px; margin: 14px 0; }
  .card { flex: 1; border-radius: 14px; padding: 10px 13px; font-size: 12px; }
  .card .ct { font-size: 10px; font-weight: 800; margin-bottom: 2px; }
  .tbl-wrap { border-radius: 13px; overflow: hidden; }
  table.items { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .compact table.items { font-size: 10.5px; }
  .items thead th { background: ${accent}; color: #fff; padding: 8px 7px; font-weight: 800; }
  .classic .items thead th { border: 1px solid #475569; }
  .items td { padding: 7px; border-bottom: 1px solid #eef1f6; }
  .classic .items td { border: 1px solid #94a3b8; }
  .elegant .items td { border-bottom: 1px solid #e9e4f5; }
  .compact .items td { padding: 4px 6px; }
  .items .alt td { background: #f8fafc; }
  .items .c { text-align: center; }
  .items .r { text-align: right; }
  .items .b { font-weight: 900; }
  .items .mut { color: #94a3b8; }
  .items .name { font-weight: 800; text-align: right; }
  .bottom { display: flex; gap: 14px; align-items: stretch; margin-top: 14px; }
  .modern .bottom { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
  .bottom.dark { border-radius: 16px; padding: 14px; color: #fff; }
  .words { flex: 1; border: 1px dashed #c7d2fe; background: #f5f7ff; border-radius: 10px; padding: 9px 12px; min-width: 0; }
  .words.dark { border-color: rgba(255,255,255,.35); background: transparent; color: #fff; }
  .words .wt { font-size: 10px; font-weight: 800; color: ${accent}; margin-bottom: 3px; }
  .words.dark .wt { color: rgba(255,255,255,.8); }
  .words .wv { font-size: 11.5px; font-weight: 700; line-height: 1.8; overflow-wrap: anywhere; }
  .totals { min-width: 290px; font-size: 12px; }
  .totals .tr { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; color: #64748b; }
  .totals.dark .tr { color: rgba(255,255,255,.8); }
  .totals .grand { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; padding-top: 8px;
                   border-top: 2px solid ${accent}; font-size: 15px; font-weight: 900; }
  .totals.dark .grand { border-top-color: rgba(255,255,255,.4); }
  .totals .g { color: ${accent}; white-space: nowrap; }
  .totals.dark .g { color: #fde047; }
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 70px; margin-top: 30px; text-align: center; color: #475569; font-size: 11px; }
  .sig div { border-top: 1px dashed #94a3b8; padding-top: 6px; }
  .foot { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; font-size: 10px; color: #64748b; }
</style></head><body>
${watermark(settings)}
${body}
</body></html>`
}
