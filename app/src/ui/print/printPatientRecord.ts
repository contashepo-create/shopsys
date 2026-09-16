/**
 * تقرير سجل المريض الكامل (طلب المالك): من بداية التعامل حتى الآن —
 * A4 احترافي يطبعه الطبيب أو يُسلَّم للمريض/جهة تحويل:
 * ترويسة العيادة والطبيب + بطاقة المريض بالكود + التاريخ المرضي الكامل
 * (فصيلة/مزمنة/حساسية/عمليات/أدوية/عائلي) + خط زمني لكل الزيارات
 * (شكوى/تشخيص/علامات حيوية/روشتة بجدول) + خطط العلاج + المستندات المرفقة
 * + الملخص المالي + توقيع الطبيب.
 */
import { doseText, dispenseText, vitalsText, ATTACHMENT_KINDS, type RxLine, type MedicalHistory, type Vitals, type AttachmentKind } from '../../core/prescription.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface RecordVisit {
  visitNumber: string
  date: string // ISO
  kindLabel: string // «كشف» / «استشارة»…
  complaint: string
  diagnosis: string
  treatment: string // نص حر قديم
  rxLines: RxLine[]
  vitals: Vitals | null
  nextVisit: string
  totalMinor: number
  dueMinor: number
}

export interface RecordPlan {
  title: string
  doneSessions: number
  totalSessions: number
  totalFeeMinor: number
}

export interface RecordAttachment {
  kind: AttachmentKind
  name: string
  addedAt: string
}

export function renderPatientRecordHtml(args: {
  clinicName: string
  doctorName: string
  clinicPhone: string
  clinicAddress: string
  patientName: string
  patientCode: string
  patientPhone: string
  patientAge: string
  patientGender: string
  firstVisitDate: string // بداية التعامل
  history: MedicalHistory
  visits: RecordVisit[] // بالترتيب الزمني (الأقدم أولاً)
  plans: RecordPlan[]
  attachments: RecordAttachment[]
  totalFees: string // منسق بالعملة
  totalDue: string
  printedAt: string
}): string {
  const h = args.history

  const historyRows: string[] = []
  if (h.bloodType) historyRows.push(`<tr><td class="hl">فصيلة الدم</td><td><b>${esc(h.bloodType)}</b></td></tr>`)
  if (h.chronicDiseases.length) historyRows.push(`<tr><td class="hl">أمراض مزمنة</td><td>${esc(h.chronicDiseases.join('، '))}</td></tr>`)
  if (h.allergies.length) historyRows.push(`<tr><td class="hl danger">⚠️ حساسية</td><td class="danger"><b>${esc(h.allergies.join('، '))}</b></td></tr>`)
  if (h.surgeries) historyRows.push(`<tr><td class="hl">عمليات سابقة</td><td>${esc(h.surgeries)}</td></tr>`)
  if (h.currentMeds) historyRows.push(`<tr><td class="hl">أدوية حالية</td><td>${esc(h.currentMeds)}</td></tr>`)
  if (h.familyHistory) historyRows.push(`<tr><td class="hl">تاريخ عائلي</td><td>${esc(h.familyHistory)}</td></tr>`)
  historyRows.push(`<tr><td class="hl">التدخين</td><td>${h.smoker ? 'مدخّن' : 'غير مدخّن'}</td></tr>`)
  if (h.extraNotes) historyRows.push(`<tr><td class="hl">ملاحظات</td><td>${esc(h.extraNotes)}</td></tr>`)

  const visitBlocks = args.visits
    .map((v) => {
      const vt = v.vitals ? vitalsText(v.vitals) : ''
      const rxRows = v.rxLines
        .map(
          (l, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td><b>${esc(l.medication)}</b>${l.notes ? `<div class="rx-note">${esc(l.notes)}</div>` : ''}</td>
            <td>${esc(doseText(l)) || '—'}</td>
            <td>${esc(dispenseText(l)) || '—'}</td>
          </tr>`,
        )
        .join('')
      return `<div class="visit">
        <div class="v-head">
          <span class="v-kind">${esc(v.kindLabel)} — ${esc(v.visitNumber)}</span>
          <span class="v-date">${esc(v.date.slice(0, 10))}</span>
        </div>
        <div class="v-body">
          ${vt ? `<div class="v-row"><b>العلامات الحيوية:</b> ${esc(vt)}</div>` : ''}
          ${v.complaint ? `<div class="v-row"><b>الشكوى:</b> ${esc(v.complaint)}</div>` : ''}
          ${v.diagnosis ? `<div class="v-row dx"><b>التشخيص:</b> ${esc(v.diagnosis)}</div>` : ''}
          ${rxRows ? `<table class="rx"><thead><tr><th>#</th><th>الدواء</th><th>الجرعة والتعليمات</th><th>الصرف</th></tr></thead><tbody>${rxRows}</tbody></table>` : ''}
          ${!rxRows && v.treatment ? `<div class="v-row"><b>العلاج:</b> ${esc(v.treatment)}</div>` : ''}
          ${v.nextVisit ? `<div class="v-row next">🗓️ موعد المراجعة: ${esc(v.nextVisit)}</div>` : ''}
        </div>
      </div>`
    })
    .join('')

  const planRows = args.plans
    .map((p) => `<tr><td>${esc(p.title)}</td><td>${p.doneSessions} / ${p.totalSessions} جلسة</td><td>${p.doneSessions >= p.totalSessions ? '<b class="ok">مكتملة ✓</b>' : 'جارية'}</td></tr>`)
    .join('')

  const attRows = args.attachments
    .map((a) => `<tr><td>${ATTACHMENT_KINDS[a.kind].icon} ${esc(ATTACHMENT_KINDS[a.kind].nameAr)}</td><td>${esc(a.name)}</td><td>${esc(a.addedAt.slice(0, 10))}</td></tr>`)
    .join('')

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #0e7490; padding-bottom: 10px; }
    .clinic { font-size: 20px; font-weight: 900; color: #0e7490; }
    .doctor { font-size: 13px; font-weight: 800; color: #1e293b; margin-top: 2px; }
    .contact { text-align: left; font-size: 10px; color: #64748b; line-height: 1.8; }
    .report-title { text-align: center; font-size: 15px; font-weight: 900; color: #0e7490; margin: 12px 0 4px; }
    .report-sub { text-align: center; font-size: 10px; color: #94a3b8; margin-bottom: 12px; }

    .patient-card { display: flex; flex-wrap: wrap; gap: 6px 20px; background: #f0fdfa; border: 1.5px solid #99f6e4; border-radius: 10px; padding: 9px 14px; margin-bottom: 12px; font-size: 11.5px; }
    .patient-card b { color: #0e7490; }
    .code-badge { background: #0e7490; color: #fff; border-radius: 6px; padding: 2px 10px; font-weight: 900; letter-spacing: .5px; }

    h3.sec { font-size: 12.5px; font-weight: 900; color: #0e7490; border-right: 4px solid #0e7490; padding-right: 8px; margin: 16px 0 7px; }

    table.info { width: 100%; border-collapse: collapse; }
    table.info td { border: 1px solid #e2e8f0; padding: 5px 10px; font-size: 11px; }
    td.hl { background: #f8fafc; font-weight: 800; width: 110px; color: #475569; }
    .danger { color: #b91c1c !important; background: #fef2f2 !important; }

    .visit { border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 8px; overflow: hidden; page-break-inside: avoid; }
    .v-head { display: flex; justify-content: space-between; background: #f1f5f9; padding: 5px 12px; font-size: 11px; }
    .v-kind { font-weight: 900; color: #0e7490; }
    .v-date { color: #64748b; font-weight: 700; }
    .v-body { padding: 7px 12px; }
    .v-row { margin-bottom: 3px; font-size: 11px; }
    .v-row.dx { background: #f0fdfa; border-radius: 5px; padding: 3px 8px; }
    .v-row.next { color: #0e7490; font-weight: 800; }

    table.rx { width: 100%; border-collapse: collapse; margin: 5px 0 3px; }
    table.rx th { background: #0e7490; color: #fff; font-size: 9px; font-weight: 800; padding: 3px 7px; text-align: right; }
    table.rx td { border-bottom: 1px solid #e2e8f0; padding: 4px 7px; font-size: 10px; vertical-align: top; }
    td.n { text-align: center; font-weight: 900; color: #0e7490; width: 20px; }
    .rx-note { font-size: 8.5px; color: #92400e; }

    table.list { width: 100%; border-collapse: collapse; }
    table.list th { background: #f1f5f9; font-size: 10px; font-weight: 800; padding: 4px 10px; text-align: right; color: #475569; }
    table.list td { border-bottom: 1px solid #e2e8f0; padding: 4px 10px; font-size: 10.5px; }
    .ok { color: #059669; }

    .money { display: flex; gap: 10px; margin-top: 6px; }
    .money > div { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 12px; text-align: center; }
    .money .lbl { font-size: 9.5px; color: #64748b; }
    .money .val { font-size: 13px; font-weight: 900; margin-top: 2px; }
    .money .due { color: #d97706; }

    .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; }
    .printed { font-size: 9px; color: #94a3b8; }
    .sig { text-align: center; font-size: 11px; font-weight: 700; }
    .sig .line { display: block; border-top: 1.5px solid #334155; padding-top: 4px; min-width: 150px; margin-top: 30px; }
  </style></head><body>
    <div class="head">
      <div>
        <div class="clinic">${esc(args.clinicName)}</div>
        ${args.doctorName ? `<div class="doctor">${esc(args.doctorName)}</div>` : ''}
      </div>
      <div class="contact">
        ${args.clinicPhone ? `📞 <span dir="ltr">${esc(args.clinicPhone)}</span><br>` : ''}
        ${args.clinicAddress ? `📍 ${esc(args.clinicAddress)}` : ''}
      </div>
    </div>

    <div class="report-title">📋 السجل الطبي الكامل للمريض</div>
    <div class="report-sub">من بداية التعامل ${esc(args.firstVisitDate || '—')} حتى تاريخ الطباعة</div>

    <div class="patient-card">
      <span class="code-badge">${esc(args.patientCode)}</span>
      <span>الاسم: <b>${esc(args.patientName)}</b></span>
      ${args.patientAge ? `<span>السن: <b>${esc(args.patientAge)}</b></span>` : ''}
      ${args.patientGender ? `<span>${esc(args.patientGender)}</span>` : ''}
      ${args.patientPhone ? `<span>الهاتف: <b dir="ltr">${esc(args.patientPhone)}</b></span>` : ''}
      <span>عدد الزيارات: <b>${args.visits.length}</b></span>
    </div>

    <h3 class="sec">⚕️ التاريخ المرضي</h3>
    <table class="info"><tbody>${historyRows.join('')}</tbody></table>

    <h3 class="sec">🩺 سجل الزيارات والروشتات (${args.visits.length})</h3>
    ${visitBlocks || '<div style="color:#94a3b8;font-size:11px;padding:8px">لا زيارات مسجلة بعد</div>'}

    ${planRows ? `<h3 class="sec">📋 خطط العلاج</h3>
    <table class="list"><thead><tr><th>الخطة</th><th>الجلسات</th><th>الحالة</th></tr></thead><tbody>${planRows}</tbody></table>` : ''}

    ${attRows ? `<h3 class="sec">📎 المستندات المرفقة بالملف</h3>
    <table class="list"><thead><tr><th>النوع</th><th>الاسم</th><th>التاريخ</th></tr></thead><tbody>${attRows}</tbody></table>` : ''}

    <h3 class="sec">💰 الملخص المالي</h3>
    <div class="money">
      <div><div class="lbl">إجمالي الأتعاب منذ البداية</div><div class="val">${esc(args.totalFees)}</div></div>
      <div><div class="lbl">المستحق حالياً</div><div class="val due">${esc(args.totalDue)}</div></div>
    </div>

    <div class="footer">
      <div class="printed">طُبع في ${esc(args.printedAt)} — هذا التقرير سجل طبي سري، تداوله مسؤولية حامله</div>
      <div class="sig"><span class="line">توقيع وختم الطبيب</span></div>
    </div>
    <script>window.onload = () => { window.print() }</script>
  </body></html>`
}
