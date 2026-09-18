/**
 * تقرير نتائج التحاليل — A4 احترافي RTL (القرار 26)
 * رأس المعمل (شعار/اسم/عناوين) + بيانات المريض والطبيب المُحيل
 * + جدول النتائج مع النطاق المرجعي وأعلام ▲ مرتفع / ▼ منخفض
 * يعاد استخدام printHtml من مطبعة الإيصالات.
 */
import type { ReceiptSettings } from '../../core/receipt.ts'
import type { LabOrder, LabPatient } from '../../data/repo.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function fmtRange(low: number | null, high: number | null): string {
  if (low == null && high == null) return '—'
  if (low == null) return `حتى ${high}`
  if (high == null) return `من ${low}`
  return `${low} – ${high}`
}

export function renderLabReportHtml(
  order: LabOrder,
  patient: LabPatient | null,
  referrerName: string | null,
  settings: ReceiptSettings,
): string {
  const accent = settings.accentColor || '#7c3aed'
  const d = new Date(order.date)
  const dateStr = d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })

  const rows = order.tests
    .map((t) => {
      const flag =
        t.resultFlag === 'critical_high' || t.resultFlag === 'critical_low'
          ? `<span style="color:#fff;background:#dc2626;font-weight:900;padding:2px 8px;border-radius:6px">🚨 قيمة حرجة ${t.resultFlag === 'critical_high' ? 'مرتفعة' : 'منخفضة'}</span>`
          : t.resultFlag === 'high'
            ? '<span style="color:#dc2626;font-weight:800">▲ مرتفع</span>'
            : t.resultFlag === 'low'
              ? '<span style="color:#2563eb;font-weight:800">▼ منخفض</span>'
              : t.resultFlag === 'normal'
                ? '<span style="color:#059669;font-weight:700">طبيعي</span>'
                : ''
      const val = t.resultValue ? esc(t.resultValue) : '<span style="color:#94a3b8">لم تُدخل</span>'
      const bg = t.resultFlag === 'critical_high' || t.resultFlag === 'critical_low' ? 'background:#fee2e2;border-right:4px solid #dc2626' : t.resultFlag === 'high' ? 'background:#fef2f2' : t.resultFlag === 'low' ? 'background:#eff6ff' : ''
      return `<tr style="${bg}">
        <td>${esc(t.code)}</td>
        <td style="font-weight:700">${esc(t.nameAr)}</td>
        <td style="font-weight:800;font-size:14px">${val}</td>
        <td>${esc(t.unit) || '—'}</td>
        <td>${fmtRange(t.refLow, t.refHigh)}</td>
        <td>${flag}</td>
      </tr>`
    })
    .join('')

  const gender = patient?.gender === 'female' ? 'أنثى' : 'ذكر'
  const allApproved = order.tests.every((t) => t.status === 'approved')
  const watermark = settings.watermarkEnabled && settings.watermarkText
    ? `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0">
         <div style="transform:rotate(-30deg);font-size:80px;font-weight:900;color:${accent}12;white-space:nowrap">${esc(settings.watermarkText)}</div>
       </div>`
    : ''

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(order.orderNumber)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 12.5px; position: relative; }
  .head { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid ${accent}; padding-bottom:10px; }
  table.results { width:100%; border-collapse:collapse; margin-top:8px; }
  table.results th { background:${accent}; color:#fff; padding:7px 8px; font-size:12px; text-align:right; }
  table.results td { padding:7px 8px; border-bottom:1px solid #e2e8f0; }
  .meta { display:grid; grid-template-columns:repeat(3,1fr); gap:6px 18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-top:10px; }
  .meta b { color:${accent}; }
</style></head><body>
${watermark}
<div style="position:relative;z-index:1">
  <div class="head">
    <div>
      ${settings.showLogo && settings.logoDataUrl ? `<img src="${settings.logoDataUrl}" style="height:52px;margin-bottom:4px" />` : ''}
      <div style="font-size:20px;font-weight:900;color:${accent}">${esc(settings.shopName || 'المعمل')}</div>
      ${settings.showHeaderLines ? settings.headerLines.filter(Boolean).map((l) => `<div style="color:#475569;font-size:11px">${esc(l)}</div>`).join('') : ''}
    </div>
    <div style="text-align:left">
      <div style="font-size:16px;font-weight:900">تقرير نتائج التحاليل</div>
      <div style="color:#475569">رقم الطلب: <b>${esc(order.orderNumber)}</b></div>
      ${settings.showDate ? `<div style="color:#475569">${dateStr} — ${timeStr}</div>` : ''}
      ${allApproved ? `<div style="display:inline-block;margin-top:4px;background:#05966915;color:#059669;font-weight:800;border-radius:8px;padding:2px 10px">✔ نتائج معتمدة</div>` : `<div style="display:inline-block;margin-top:4px;background:#d9770615;color:#d97706;font-weight:800;border-radius:8px;padding:2px 10px">مسودة — غير معتمدة</div>`}
    </div>
  </div>

  <div class="meta">
    <div>المريض: <b>${esc(order.patientName)}</b></div>
    <div>النوع: <b>${patient ? gender : '—'}</b></div>
    <div>تاريخ الميلاد: <b>${patient?.birthDate || '—'}</b></div>
    <div>الهاتف: <b>${esc(patient?.phone || '—')}</b></div>
    <div>الطبيب المُحيل: <b>${referrerName ? 'د. ' + esc(referrerName) : '—'}</b></div>
    <div>عدد الفحوصات: <b>${order.tests.length}</b></div>
  </div>

  <table class="results">
    <thead><tr><th>الكود</th><th>الفحص</th><th>النتيجة</th><th>الوحدة</th><th>النطاق المرجعي</th><th>التقييم</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${order.notes ? `<div style="margin-top:10px;color:#475569"><b>ملاحظات:</b> ${esc(order.notes)}</div>` : ''}

  ${settings.showSignatures ? `
  <div style="display:flex;justify-content:space-between;margin-top:44px;padding:0 30px">
    <div style="text-align:center"><div style="border-top:2px dotted #94a3b8;width:160px;padding-top:6px;font-weight:700">فني المعمل</div></div>
    <div style="text-align:center"><div style="border-top:2px dotted #94a3b8;width:160px;padding-top:6px;font-weight:700">اعتماد الطبيب</div></div>
  </div>` : ''}

  ${settings.showFooter && settings.footerText ? `<div style="text-align:center;margin-top:24px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px">${esc(settings.footerText)}</div>` : ''}
</div>
</body></html>`
}
