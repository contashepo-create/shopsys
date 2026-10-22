/**
 * بوابة «المستند الجديد بتاريخ المستخدم» — تثبت السلوك فعلياً لا بالقراءة العينية.
 *
 * الخلل الذي تمنعه: فاتورة تُرحَّل الساعة 01:00 في القاهرة كانت تأخذ تاريخ أمس
 * (يوم UTC) ويحمل كودها المرجعي SAL-<أمس>، ويُطبع وقتها ناقصاً 2–3 ساعات.
 * الفحص يشغّل **مسار الترحيل الحقيقي** (`postSale`) في منطقتين زمنيتين
 * (UTC+2/+3 شرقاً وUTC-4/−5 غرباً) ويثبت: تاريخ المستند، كود المرجع، تاريخ القيد،
 * وختم الرواتب على يوم محدَّد.
 */
import { spawnSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) pass++
  else { fail++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const probeSource = (absUrl, timeUrl, srcUrl) => `
  const { freshCase } = await import(${JSON.stringify(absUrl)})
  const { localTimestampOn, localIsoTimestamp, calendarDateIso } = await import(${JSON.stringify(timeUrl)})
  const { buildAssetInstallments } = await import(${JSON.stringify(srcUrl + '/core/assets.ts')})
  const { isValidExpiryDate } = await import(${JSON.stringify(srcUrl + '/core/batches.ts')})
  const { retentionReleaseDueDate } = await import(${JSON.stringify(srcUrl + '/core/contracting.ts')})
  const { buildPaymentSchedule } = await import(${JSON.stringify(srcUrl + '/core/paymentTerms.ts')})
  const { generateLeaseSchedule, leaseEndDate } = await import(${JSON.stringify(srcUrl + '/core/realestate.ts')})
  const { warrantyEndDate } = await import(${JSON.stringify(srcUrl + '/core/serials.ts')})
  const { periodPresets } = await import(${JSON.stringify(srcUrl + '/core/reports.ts')})
  const { leaveDates } = await import(${JSON.stringify(srcUrl + '/core/attendance.ts')})
  const c = await freshCase({ activityId: 'grocery' })
  const st = () => c.st()
  st().addItem({
    nameAr: 'أرز', sku: 'R-1', barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [],
    costMinor: 10000, stockQty: 0, priceMinor: 20000, minQty: 0, trackExpiry: false,
    trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [],
    variantSizes: [], isActive: true,
  })
  const item = st().items.at(-1)
  const wh = st().warehouses.find((w) => w.isMain)?.id ?? st().warehouses[0]?.id ?? null
  st().postPurchase({
    supplierId: 0, date: '2026-02-20',
    lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 10000, warehouseId: wh }],
    expenses: [], paidMinor: 100000, treasury: '1101', warehouseId: wh,
  })
  const saleArgs = (extra = {}) => ({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0,
    taxInclusive: false, treasury: '1101', warehouseId: wh, ...extra,
  })
  const dated = st().postSale(saleArgs({ documentDate: '2026-03-01' }))
  const todaySale = st().postSale(saleArgs())
  const entry = st().journal.find((e) => e.sourceType === 'sale' && e.sourceId === dated.id)
  const payrollStamp = localTimestampOn('2026-01-15', 9)
  const stampNow = localIsoTimestamp()
  console.log(JSON.stringify({
    datedDate: dated.date,
    datedRef: dated.refCode,
    entryDate: entry.date,
    entryCreatedAt: entry.createdAt,
    todayDate: todaySale.date,
    todayRef: todaySale.refCode,
    payrollStamp,
    payrollHourLocal: new Date(payrollStamp).getHours(),
    payrollDayLocal: new Date(payrollStamp).getDate(),
    stampNow,
    todayLocal: stampNow.slice(0, 10),
    assetDue: buildAssetInstallments(300000, 3, 1, '2026-01-15').map((r) => r.dueDate),
    expiryValid: isValidExpiryDate('2026-02-28'),
    expiryInvalid: isValidExpiryDate('2026-02-30'),
    calendarFeb29: calendarDateIso(new Date('2028-02-29T00:00:00Z')),
    retention: retentionReleaseDueDate({ actualHandoverDate: '2026-01-10', defectsLiabilityMonths: 12 }),
    terms: buildPaymentSchedule('2026-01-31', 100000, { code: 'T30', nameAr: 'قسطان', installments: [{ dueDays: 0, percent: 50 }, { dueDays: 30, percent: 50 }] }).map((r) => r.dueDate),
    leaseEnd: leaseEndDate('2026-01-31', 1),
    leaseFirst: generateLeaseSchedule('2026-03-01', 12, 'monthly', 1200000).map((r) => r.dueDate).slice(0, 2),
    warranty: warrantyEndDate('2026-01-31T10:00:00.000Z', 2),
    week: periodPresets('2026-03-08').find((r) => r.id === 'week').period.from,
    leave: leaveDates({ from: '2026-10-27', to: '2026-11-02' }),
    offsetMinutes: new Date().getTimezoneOffset(),
  }))
`

/* روابط file:// لا مسارات خام: ويندوز يرفض `import('D:\\...')` بـERR_UNSUPPORTED_ESM_URL_SCHEME */
const auditKitUrl = new URL('./auditKit.mjs', import.meta.url).href
const timeUrl = new URL('../src/core/time.ts', import.meta.url).href
const srcUrl = new URL('../src', import.meta.url).href
const probe = (tz) => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probeSource(auditKitUrl, timeUrl, srcUrl)], {
    encoding: 'utf8', env: tz ? { ...process.env, TZ: tz } : process.env, maxBuffer: 20 * 1024 * 1024,
  })
  if (r.status !== 0) { console.error(r.stderr?.slice(-1500)); return null }
  return JSON.parse(r.stdout.trim().split('\n').at(-1))
}

/* هل يطبّق هذا النظام متغيّر TZ؟ كل فحوص هذا الملف مستقلة عن المنطقة أصلاً،
   فيكفي تشغيل واحد في منطقة النظام حين يتجاهل ويندوز TZ — بدل فشل كاذب. */
const offsetAt = (tz) => {
  const r = spawnSync(process.execPath, ['-e', "console.log(new Date('2026-07-15T12:00:00Z').getTimezoneOffset())"], {
    encoding: 'utf8', env: tz ? { ...process.env, TZ: tz } : process.env,
  })
  return r.status === 0 ? Number(r.stdout.trim()) : NaN
}
const baseOffset = offsetAt(null)
const tzSupported = ['Africa/Cairo', 'America/New_York'].every((tz) => offsetAt(tz) !== baseOffset)
if (!tzSupported) console.log('ℹ️ هذا النظام لا يطبّق متغيّر TZ — تشغيل واحد في منطقة النظام (الفحوص مستقلة عن المنطقة).')

for (const tz of tzSupported ? ['Africa/Cairo', 'America/New_York'] : [null]) {
  const p = probe(tz)
  if (!p) { ok(false, `${tz ?? 'المنطقة الحالية'}: تشغيل مسار الترحيل`); continue }
  const T = tz ?? 'المنطقة الحالية'
  ok(p.datedDate.startsWith('2026-03-01T'), `${T}: تاريخ المستند المحرَّر في الرأس هو تاريخ الفاتورة`, p.datedDate)
  ok(p.datedRef.split('-')[1] === '260301', `${T}: كود المرجع SAL-YYMMDD من يوم المستند لا من UTC`, p.datedRef)
  ok(p.entryDate === '2026-03-01', `${T}: تاريخ القيد = تاريخ المستند`, p.entryDate)
  ok(p.entryCreatedAt.startsWith('2026-03-01T'), `${T}: ختم إنشاء القيد لم ينزلق ليوم آخر`, p.entryCreatedAt)
  ok(!p.datedDate.endsWith('Z') && /[+-]\d{2}:\d{2}$/.test(p.datedDate), `${T}: الختم يحمل إزاحة صريحة لا Z`, p.datedDate)
  ok(p.todayDate.slice(0, 10) === p.todayLocal, `${T}: بيع بلا تاريخ محرَّر يأخذ «اليوم المحلي» للجهاز`, `${p.todayDate} ≠ ${p.todayLocal}`)
  ok(p.todayRef.split('-')[1] === p.todayLocal.slice(2).replaceAll('-', ''), `${T}: كود المرجع اليومي مطابق لليوم المحلي`, p.todayRef)
  ok(p.payrollStamp.startsWith('2026-01-15T09:00:00.000'), `${T}: ختم الرواتب على اليوم المطلوب بالساعة 09:00`, p.payrollStamp)
  ok(p.payrollHourLocal === 9 && p.payrollDayLocal === 15, `${T}: إعادة قراءة ختم الرواتب تعطي 15 يناير 09:00 محلياً`, String(p.payrollHourLocal))
  ok(p.stampNow.slice(0, 10) === p.todayLocal, `${T}: الختم الحالي يبدأ بتاريخ اليوم المحلي`, p.stampNow)
  /* دوال النواة التي كانت تُقرأ بـgetDate/getMonth على كائن UTC فتزحف يوماً غرباً */
  ok(p.assetDue.join(',') === '2026-01-15,2026-02-15,2026-03-15', `${T}: أقساط الأصول تبدأ من تاريخها المطلوب`, p.assetDue.join(','))
  ok(p.expiryValid === true && p.expiryInvalid === false, `${T}: فحص صلاحية تاريخ الانتهاء لا يرفض تاريخاً صحيحاً ولا يقبل 30 فبراير`)
  ok(p.calendarFeb29 === '2028-02-29', `${T}: calendarDateIso يحفظ اليوم التقويمي من كائن UTC`, p.calendarFeb29)
  ok(p.retention === '2027-01-10', `${T}: تاريخ استحقاق محتجز الضمان سنة كاملة`, p.retention)
  ok(p.terms.join(',') === '2026-01-31,2026-03-02', `${T}: استحقاقات شروط الدفع من تاريخ المستند`, p.terms.join(','))
  ok(p.leaseEnd === '2026-02-28', `${T}: نهاية الإيجار تحترم آخر يوم في الشهر`, p.leaseEnd)
  ok(p.leaseFirst.join(',') === '2026-03-01,2026-04-01', `${T}: جدول الإيجار يبدأ من يوم التعاقد`, p.leaseFirst.join(','))
  ok(p.warranty === '2026-03-31', `${T}: نهاية الضمان لا تنزلق يوماً للخلف`, p.warranty)
  ok(p.week === '2026-03-02', `${T}: «آخر 7 أيام» يبدأ من اليوم المحلي −6`, p.week)
  ok(p.leave.join(',') === '2026-10-27,2026-10-28,2026-10-29,2026-10-30,2026-10-31,2026-11-01,2026-11-02', `${T}: أيام الإجازة كاملة عبر تغيير التوقيت الصيفي`, p.leave.join(','))
}

if (fail) { console.error(`\nPASS=${pass} FAIL=${fail}`); process.exit(1) }
console.log(tzSupported
  ? `✅ بوابة المستند الجديد — ${pass} فحصاً في منطقتين زمنيتين`
  : `✅ بوابة المستند الجديد — ${pass} فحصاً في منطقة النظام (هذا النظام يتجاهل TZ؛ المنطقتان تُفحصان على CI لينكس)`)
