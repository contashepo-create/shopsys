/**
 * طباعة ملصقات الباركود والأرفف (مراجعة نشاط السوبرماركت — ميزة معيارية):
 * شبكة ملصقات A4 (اسم + سعر + باركود Code128) قابلة للعدد لكل صنف.
 */
import type { CurrencyConfig } from '../../core/money.ts'
import { formatMinor } from '../../core/money.ts'
import { barcodeSvg } from '../../core/code128.ts'

export interface LabelItem {
  nameAr: string
  barcode: string
  priceMinor: number
  count: number // عدد النسخ
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderLabelsHtml(shopName: string, items: LabelItem[], cur: CurrencyConfig): string {
  const labels: string[] = []
  for (const it of items) {
    let svg = ''
    try { svg = barcodeSvg(it.barcode, 34, 1.6) } catch { svg = `<div class="nobc">${esc(it.barcode)}</div>` }
    for (let i = 0; i < it.count; i++) {
      labels.push(`<div class="lbl">
        <div class="shop">${esc(shopName)}</div>
        <div class="name">${esc(it.nameAr)}</div>
        <div class="bc">${svg}</div>
        <div class="code" dir="ltr">${esc(it.barcode)}</div>
        <div class="price">${formatMinor(it.priceMinor, cur)}</div>
      </div>`)
    }
  }
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملصقات باركود</title><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 8mm; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .lbl { border: 0.3mm dashed #cbd5e1; border-radius: 2mm; padding: 2mm; text-align: center; page-break-inside: avoid; overflow: hidden; }
  .shop { font-size: 7pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 8.5pt; font-weight: 800; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0.5mm 0; }
  .bc { display: flex; justify-content: center; }
  .bc svg { max-width: 100%; }
  .nobc { font-family: monospace; font-size: 8pt; }
  .code { font-family: monospace; font-size: 7pt; color: #334155; letter-spacing: 0.5px; }
  .price { font-size: 10pt; font-weight: 900; color: #0f766e; margin-top: 0.5mm; }
  @media print { .lbl { border-color: #e2e8f0; } }
  </style></head><body><div class="grid">${labels.join('')}</div></body></html>`
}
