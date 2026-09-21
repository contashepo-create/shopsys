/**
 * طباعة الملصقات الاحترافية (قسم الباركود والسيريال — طلب المالك):
 * يرسم ملصقات أصناف وملصقات سيريال وفق قالب LabelSettings المضبوط مرة واحدة —
 * A4 شبكة (ورق لاصق مقسم) أو رول حراري (كل ملصق صفحة بمقاس الرول نفسه).
 */
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import { barcodeSvg } from '../../core/code128.ts'
import { labelSize, type LabelSettings, type ItemLabelData, type SerialLabelData } from '../../core/labels.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function baseCss(cfg: LabelSettings): string {
  const sz = labelSize(cfg.sizeId)
  const f = sz.fontScale
  const perLabelPage = sz.kind === 'roll'
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; ${perLabelPage ? '' : 'padding: 6mm;'} }
  ${perLabelPage
    ? `@page { size: ${sz.widthMm}mm ${sz.heightMm}mm; margin: 0; }
       .lbl { width: ${sz.widthMm}mm; height: ${sz.heightMm}mm; page-break-after: always; }`
    : `.grid { display: grid; grid-template-columns: repeat(${sz.cols}, 1fr); gap: 2mm; }
       .lbl { height: ${sz.heightMm}mm; border: 0.3mm dashed #cbd5e1; border-radius: 1.5mm; }`}
  .lbl { padding: 1.5mm; text-align: center; page-break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
  .shop { font-size: ${7 * f}pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: ${8.5 * f}pt; font-weight: 800; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bc { display: flex; justify-content: center; margin: 0.5mm 0; }
  .bc svg { max-width: 100%; height: auto; }
  .nobc { font-family: monospace; font-size: ${8 * f}pt; }
  .code { font-family: monospace; font-size: ${7 * f}pt; color: #334155; letter-spacing: 0.5px; direction: ltr; }
  .sku { font-size: ${6.5 * f}pt; color: #94a3b8; direction: ltr; }
  .price { font-size: ${10 * f}pt; font-weight: 900; color: #0f766e; }
  .custom { font-size: ${6.5 * f}pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: ${7 * f}pt; color: #475569; }
  @media print { .lbl { border-color: #e2e8f0; } }`
}

function wrap(cfg: LabelSettings, title: string, labels: string[]): string {
  const sz = labelSize(cfg.sizeId)
  const body = sz.kind === 'roll' ? labels.join('') : `<div class="grid">${labels.join('')}</div>`
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${baseCss(cfg)}</style></head><body>${body}</body></html>`
}

/** ملصقات الأصناف: اسم + باركود + سعر وفق القالب المضبوط */
export function renderItemLabelsHtml(shopName: string, items: ItemLabelData[], cfg: LabelSettings, cur: CurrencyConfig): string {
  const sz = labelSize(cfg.sizeId)
  const bcHeight = Math.max(18, Math.round(sz.heightMm * 1.05))
  const labels: string[] = []
  for (const it of items) {
    let svg = ''
    try { svg = barcodeSvg(it.barcode, bcHeight, 1.6) } catch { svg = `<div class="nobc">${esc(it.barcode)}</div>` }
    const parts = [
      cfg.showShopName && shopName ? `<div class="shop">${esc(shopName)}</div>` : '',
      `<div class="name">${esc(it.nameAr)}</div>`,
      `<div class="bc">${svg}</div>`,
      cfg.showCode ? `<div class="code">${esc(it.barcode)}</div>` : '',
      cfg.showSku && it.sku ? `<div class="sku">${esc(it.sku)}</div>` : '',
      cfg.showPrice ? `<div class="price">${formatMinor(it.priceMinor, cur)}</div>` : '',
      cfg.customLine ? `<div class="custom">${esc(cfg.customLine)}</div>` : '',
    ].filter(Boolean).join('')
    for (let i = 0; i < it.count; i++) labels.push(`<div class="lbl">${parts}</div>`)
  }
  return wrap(cfg, 'ملصقات باركود', labels)
}

/**
 * ملصقات السيريال: السيريال كُتب مرة واحدة (عند الشراء/الإدخال) ويظهر هنا
 * تلقائياً مع بيانات القطعة — بلا إعادة كتابة أبداً (طلب المالك).
 */
export function renderSerialLabelsHtml(shopName: string, units: SerialLabelData[], cfg: LabelSettings): string {
  const sz = labelSize(cfg.sizeId)
  const bcHeight = Math.max(18, Math.round(sz.heightMm * 1.05))
  const labels: string[] = []
  for (const u of units) {
    let svg = ''
    try { svg = barcodeSvg(u.serial, bcHeight, 1.4) } catch { svg = `<div class="nobc">${esc(u.serial)}</div>` }
    const parts = [
      cfg.showShopName && shopName ? `<div class="shop">${esc(shopName)}</div>` : '',
      cfg.serialShowItemName ? `<div class="name">${esc(u.itemNameAr)}</div>` : '',
      `<div class="bc">${svg}</div>`,
      `<div class="code">${esc(u.serial)}</div>`,
      cfg.serialShowWarranty && u.warrantyMonths > 0 ? `<div class="meta">🛡️ ضمان ${u.warrantyMonths} شهراً</div>` : '',
      cfg.serialShowDate ? `<div class="meta">${u.receivedAt.slice(0, 10)}</div>` : '',
      cfg.customLine ? `<div class="custom">${esc(cfg.customLine)}</div>` : '',
    ].filter(Boolean).join('')
    labels.push(`<div class="lbl">${parts}</div>`)
  }
  return wrap(cfg, 'ملصقات سيريال', labels)
}
