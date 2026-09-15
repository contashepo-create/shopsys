/**
 * الروشتة الطبية (جولة مراجعة العيادة): تُطبع للمريض بعد الزيارة —
 * ترويسة الطبيب/العيادة، بيانات المريض والتاريخ، التشخيص، والأدوية بسطور
 * واضحة قابلة للتعليمات (جرعة/مدة) — A5 كما تطبع العيادات فعلياً.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface PrescriptionLine {
  medication: string
  dosage: string // «قرص كل 12 ساعة بعد الأكل — 7 أيام»
}

export function renderPrescriptionHtml(args: {
  clinicName: string
  doctorName: string
  clinicPhone: string
  patientName: string
  patientAge: string
  dateIso: string
  visitNumber: string
  diagnosis: string
  lines: PrescriptionLine[]
  notes: string
}): string {
  const rows = args.lines
    .map(
      (l, i) => `<div class="med">
        <div class="med-name">℞ ${i + 1}. ${esc(l.medication)}</div>
        ${l.dosage ? `<div class="med-dose">${esc(l.dosage)}</div>` : ''}
      </div>`,
    )
    .join('')
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A5 portrait; margin: 10mm; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 13px; }
    .head { border-bottom: 3px double #0e7490; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
    .clinic { font-size: 17px; font-weight: 900; color: #0e7490; }
    .doctor { font-size: 13px; font-weight: 700; color: #334155; }
    .phone { font-size: 10.5px; color: #64748b; }
    .meta { display: flex; justify-content: space-between; gap: 10px; margin: 10px 0; font-size: 12px; }
    .meta b { color: #0e7490; }
    .dx { background: #f0fdfa; border-right: 3px solid #0e7490; padding: 6px 10px; margin-bottom: 12px; font-weight: 700; }
    .med { margin-bottom: 12px; }
    .med-name { font-size: 15px; font-weight: 900; }
    .med-dose { font-size: 12px; color: #475569; margin-top: 2px; padding-right: 22px; }
    .notes { border-top: 1px dashed #94a3b8; margin-top: 14px; padding-top: 8px; font-size: 11.5px; color: #64748b; }
    .sig { margin-top: 26px; text-align: left; font-size: 12px; font-weight: 700; }
    .sig .line { display: inline-block; border-top: 1.5px solid #334155; padding-top: 4px; min-width: 140px; text-align: center; }
  </style></head><body>
    <div class="head">
      <div>
        <div class="clinic">${esc(args.clinicName)}</div>
        <div class="doctor">${esc(args.doctorName)}</div>
      </div>
      <div class="phone">${esc(args.clinicPhone)}</div>
    </div>
    <div class="meta">
      <span>المريض: <b>${esc(args.patientName)}</b>${args.patientAge ? ` — ${esc(args.patientAge)}` : ''}</span>
      <span>${esc(args.dateIso.slice(0, 10))} — ${esc(args.visitNumber)}</span>
    </div>
    ${args.diagnosis ? `<div class="dx">التشخيص: ${esc(args.diagnosis)}</div>` : ''}
    ${rows || '<div class="med"><div class="med-dose">— لا أدوية موصوفة —</div></div>'}
    ${args.notes ? `<div class="notes">📝 ${esc(args.notes)}</div>` : ''}
    <div class="sig"><span class="line">توقيع الطبيب</span></div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}

/**
 * تحويل نص العلاج الحر إلى سطور روشتة: كل سطر «دواء | جرعة» أو دواء فقط.
 * (المدخل الحالي حقل نصي واحد — الفاصل | يفصل الجرعة، وسطر جديد يفصل الأدوية)
 */
export function parsePrescriptionText(treatment: string): PrescriptionLine[] {
  return treatment
    .split(/\n|،(?=\s*[A-Za-z\u0600-\u06FF])/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const [medication, ...rest] = raw.split('|')
      return { medication: medication.trim(), dosage: rest.join('|').trim() }
    })
    .filter((l) => l.medication)
}
