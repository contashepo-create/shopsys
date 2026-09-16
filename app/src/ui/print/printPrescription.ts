/**
 * الروشتة الطبية الاحترافية (طلب المالك — ترقية العيادة):
 * كل بند سطر مستقل في جدول كالفاتورة: الدواء | الجرعة (مرات/ساعات + الوجبات)
 * | المدة | الصرف (شريط/علبة + التكرار) | ملاحظات.
 * ترويسة طبيب كاملة + تحذير الحساسية من الملف + توقيع — A5 كما تطبع العيادات.
 */
import { doseText, dispenseText, DISPENSE_FORMS, type RxLine } from '../../core/prescription.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** توافق خلفي: الزيارات القديمة نص حر «دواء | جرعة» — تُحول لبنود بسيطة */
export interface PrescriptionLine {
  medication: string
  dosage: string
}

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

export function renderPrescriptionHtml(args: {
  clinicName: string
  doctorName: string
  doctorTitle: string // «استشاري باطنة» — '' = بلا
  clinicPhone: string
  clinicAddress: string
  patientName: string
  patientAge: string
  patientGender: string
  dateIso: string
  visitNumber: string
  diagnosis: string
  /** البنود المنظمة الجديدة — الأولوية لها */
  rxLines?: RxLine[]
  /** توافق خلفي للزيارات القديمة */
  legacyLines?: PrescriptionLine[]
  allergyWarning: string // تحذير حساسية من الملف
  notes: string
  nextVisit: string // موعد المراجعة — '' = بلا
}): string {
  const hasRx = (args.rxLines?.length ?? 0) > 0

  const rxRows = (args.rxLines ?? [])
    .map((l, i) => {
      const dose = doseText(l)
      const disp = dispenseText(l)
      return `<tr>
        <td class="n">${i + 1}</td>
        <td class="med">
          <div class="med-name">${esc(l.medication)}</div>
          ${l.notes ? `<div class="med-note">📝 ${esc(l.notes)}</div>` : ''}
        </td>
        <td class="dose">${esc(dose) || '—'}</td>
        <td class="disp">${esc(disp) || (l.formQty > 0 ? `${l.formQty} ${DISPENSE_FORMS[l.form]}` : '—')}</td>
      </tr>`
    })
    .join('')

  const legacyRows = (args.legacyLines ?? [])
    .map(
      (l, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td class="med"><div class="med-name">${esc(l.medication)}</div></td>
        <td class="dose" colspan="2">${esc(l.dosage) || '—'}</td>
      </tr>`,
    )
    .join('')

  const bodyRows = hasRx ? rxRows : legacyRows

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A5 portrait; margin: 9mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #0e7490; padding-bottom: 8px; }
    .clinic { font-size: 18px; font-weight: 900; color: #0e7490; letter-spacing: -0.3px; }
    .doctor { font-size: 13.5px; font-weight: 800; color: #1e293b; margin-top: 2px; }
    .dr-title { font-size: 10.5px; color: #64748b; font-weight: 600; }
    .contact { text-align: left; font-size: 10px; color: #64748b; line-height: 1.7; }
    .rx-symbol { font-size: 30px; font-weight: 900; color: #0e7490; opacity: .85; font-family: Georgia, serif; }

    .patient-bar { display: flex; flex-wrap: wrap; gap: 4px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; margin: 8px 0; font-size: 11px; }
    .patient-bar b { color: #0e7490; }

    .allergy { background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 8px; padding: 5px 10px; margin-bottom: 8px; font-size: 11px; font-weight: 800; color: #b91c1c; }
    .dx { background: #f0fdfa; border-right: 3px solid #0e7490; padding: 5px 10px; margin-bottom: 8px; font-weight: 700; font-size: 12px; border-radius: 0 6px 6px 0; }

    table.rx { width: 100%; border-collapse: collapse; margin-top: 2px; }
    table.rx thead th { background: #0e7490; color: #fff; font-size: 10px; font-weight: 800; padding: 5px 7px; text-align: right; }
    table.rx thead th:first-child { border-radius: 0 6px 0 0; width: 22px; text-align: center; }
    table.rx thead th:last-child { border-radius: 6px 0 0 0; }
    table.rx tbody td { border-bottom: 1px solid #e2e8f0; padding: 6px 7px; vertical-align: top; }
    table.rx tbody tr:nth-child(even) td { background: #f8fafc; }
    td.n { text-align: center; font-weight: 900; color: #0e7490; font-size: 11px; }
    .med-name { font-weight: 900; font-size: 12.5px; }
    .med-note { font-size: 9.5px; color: #92400e; margin-top: 2px; }
    td.dose { font-size: 10.5px; color: #334155; line-height: 1.65; min-width: 105px; }
    td.disp { font-size: 10px; color: #475569; min-width: 70px; }

    .footer-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; gap: 10px; }
    .notes { flex: 1; font-size: 10px; color: #64748b; border-top: 1px dashed #94a3b8; padding-top: 5px; }
    .next { font-size: 10.5px; font-weight: 800; color: #0e7490; background: #ecfeff; border: 1px dashed #06b6d4; border-radius: 6px; padding: 4px 10px; }
    .sig { text-align: center; font-size: 11px; font-weight: 700; }
    .sig .line { display: block; border-top: 1.5px solid #334155; padding-top: 4px; min-width: 130px; margin-top: 26px; }
  </style></head><body>
    <div class="head">
      <div>
        <div class="clinic">${esc(args.clinicName)}</div>
        ${args.doctorName ? `<div class="doctor">${esc(args.doctorName)}</div>` : ''}
        ${args.doctorTitle ? `<div class="dr-title">${esc(args.doctorTitle)}</div>` : ''}
      </div>
      <div style="display:flex; align-items:flex-start; gap:12px">
        <div class="contact">
          ${args.clinicPhone ? `📞 <span dir="ltr">${esc(args.clinicPhone)}</span><br>` : ''}
          ${args.clinicAddress ? `📍 ${esc(args.clinicAddress)}` : ''}
        </div>
        <div class="rx-symbol">℞</div>
      </div>
    </div>

    <div class="patient-bar">
      <span>المريض: <b>${esc(args.patientName)}</b></span>
      ${args.patientAge ? `<span>السن: <b>${esc(args.patientAge)}</b></span>` : ''}
      ${args.patientGender ? `<span>${esc(args.patientGender)}</span>` : ''}
      <span>التاريخ: <b>${esc(args.dateIso.slice(0, 10))}</b></span>
      <span style="color:#94a3b8">${esc(args.visitNumber)}</span>
    </div>

    ${args.allergyWarning ? `<div class="allergy">⚠️ ${esc(args.allergyWarning)}</div>` : ''}
    ${args.diagnosis ? `<div class="dx">التشخيص: ${esc(args.diagnosis)}</div>` : ''}

    <table class="rx">
      <thead><tr>
        <th>#</th><th>الدواء</th><th>الجرعة والتعليمات</th><th>الصرف</th>
      </tr></thead>
      <tbody>${bodyRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:14px">— لا أدوية موصوفة —</td></tr>'}</tbody>
    </table>

    <div class="footer-row">
      <div>
        ${args.notes ? `<div class="notes">📝 ${esc(args.notes)}</div>` : ''}
        ${args.nextVisit ? `<div class="next" style="margin-top:6px">🗓️ موعد المراجعة: ${esc(args.nextVisit)}</div>` : ''}
      </div>
      <div class="sig"><span class="line">توقيع الطبيب</span></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
