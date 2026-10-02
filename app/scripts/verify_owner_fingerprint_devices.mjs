/**
 * جولة المالك — استيراد البصمة متعدد الأجهزة (§77 — توجيه المالك:
 * «لا أعرف أي جهاز سيستخدمه العميل — لماذا لا نضع عدة أجهزة»).
 * كان البند ④ مؤجلاً بانتظار ماركة/موديل واحد؛ صار سجل أجهزة + كشفاً تلقائياً.
 * تشغيل: node --experimental-strip-types scripts/verify_owner_fingerprint_devices.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(here + p, 'utf8')

/* ─── ① النواة: سجل الأجهزة والكشف التلقائي ─── */
console.log('① سجل الأجهزة والكشف التلقائي')
{
  const { FINGERPRINT_DEVICES, detectFingerprintDevice, parseFingerprintDeviceCsv } = await import('../src/core/fingerprintImport.ts')
  assert.equal(FINGERPRINT_DEVICES.length, 6, 'خمسة أجهزة + الوضع العام')
  const ids = new Set(FINGERPRINT_DEVICES.map((d) => d.id))
  for (const id of ['generic', 'zkteco', 'hikvision', 'realtime', 'anviz', 'essl']) assert.ok(ids.has(id), `الجهاز ${id} مسجل`)
  /* كل جهاز له تلميح مصدر واسم عربي — تُعرض للعميل في الواجهة */
  for (const d of FINGERPRINT_DEVICES) {
    assert.ok(d.nameAr.trim() && d.hintAr.trim().length > 20, `تلميح ${d.id} وافٍ`)
    assert.ok(Array.isArray(d.signatures), `بصمات ${d.id}`)
  }
  /* الكشف: كل رأس تصدير حقيقي يقود لجهازه الصحيح */
  const cases = [
    ['zkteco', 'No.,EMP Code,Name,Date,Clock In,Clock Out'],
    ['zkteco', 'User ID,Date,Time'],
    ['hikvision', 'Personnel No.,Name,Date,First Check-in,Last Check-out'],
    ['realtime', 'Emp Code,Employee Name,Date,Day,First Punch,Last Punch,Total Hours,Status'],
    ['essl', 'Emp Code,Emp Name,Dept,Date,Day,Shift,In Time,Out Time,Status'],
    ['anviz', 'User ID,Name,Date,Check In,Check Out'],
  ]
  for (const [expected, header] of cases) {
    const { device, matched } = detectFingerprintDevice(`${header}\n1,2026-09-30,08:00,17:00`)
    assert.ok(matched, `رأس ${expected} يجب أن يُطابق`)
    assert.equal(device.id, expected, `رأس «${header.slice(0, 30)}…» ⇒ ${expected}`)
  }
  /* رأس عربي عام لا يدّعي جهازاً */
  const arabic = detectFingerprintDevice('كود الموظف,الاسم,التاريخ,الدخول,الخروج')
  assert.equal(arabic.matched, false)
  assert.equal(arabic.device.id, 'generic')
  console.log('  ✓ 6 أجهزة + 6 رؤوس تُكشف صحيحة + العربي العام لا يُدّعى')
}

/* ─── ② المحلل الحي: تصديرات الأجهزة الفعلية ─── */
console.log('② المحلل الحي: كل جهاز بتصديره الحقيقي')
{
  const { parseFingerprintDeviceCsv } = await import('../src/core/fingerprintImport.ts')
  const { matchImportRows } = await import('../src/core/attendance.ts')
  const employees = [
    { id: 1, nameAr: 'أحمد محمد' }, { id: 2, nameAr: 'سعاد محمود' },
    { id: 3, nameAr: 'منى عبد الله' }, { id: 7, nameAr: 'سعيد رمضان' }, { id: 12, nameAr: 'كريم فؤاد' },
  ]

  /* ZKTeco تقرير — كود محشو بأصفار (0001) يطابق الموظف 1 (إصلاح §77) */
  const zk = parseFingerprintDeviceCsv('No.,EMP Code,Name,Date,Clock In,Clock Out\n1,0001,أحمد,2026-09-30,08:52,17:35\n2,0007,سعيد,2026-09-30,08:00,17:00')
  assert.equal(zk.device.id, 'zkteco')
  assert.equal(zk.errors.length, 0)
  assert.deepEqual(matchImportRows(zk.rows, employees).map((m) => m.employeeId), [1, 7], 'كود ZKTeco المحشو بأصفار يطابق')

  /* ZKTeco سجل نبضات خام: 3 نبضات لموظف واحد ⇒ أول دخول وآخر خروج */
  const punch = parseFingerprintDeviceCsv('User ID,Date,Time\n1,2026-09-30,08:52\n1,2026-09-30,12:00\n1,2026-09-30,17:35')
  assert.equal(punch.rows.length, 1, 'النبضات تُدمج في سجل واحد')
  assert.equal(punch.rows[0].checkIn, '08:52')
  assert.equal(punch.rows[0].checkOut, '17:35')

  /* Hikvision: شهر/يوم/سنة + AM/PM */
  const hik = parseFingerprintDeviceCsv('Personnel No.,Name,Date,First Check-in,Last Check-out\n7,سعيد,09/30/2026,8:05 AM,5:02 PM\n7,سعيد,10/01/2026,08:10,17:00')
  assert.equal(hik.device.id, 'hikvision')
  assert.equal(hik.rows[0].date, '2026-09-30')
  assert.equal(hik.rows[0].checkOut, '17:02')
  assert.equal(hik.rows[1].date, '2026-10-01', '01/10 غير الملتبس يفهم صحيحاً')
  /* التاريخ الصريح يوم/شهر (30/09) لا يُقلب حتى مع اختيار Hikvision يدوياً */
  const hikManual = parseFingerprintDeviceCsv('Personnel No.,Name,Date,First Check-in,Last Check-out\n7,سعيد,30/09/2026,8:05,17:02', 'hikvision')
  assert.equal(hikManual.rows[0].date, '2026-09-30')

  /* Realtime: وقت مضغوط 0852 + E03 يطابق الموظف 3 */
  const rt = parseFingerprintDeviceCsv('Emp Code,Employee Name,Date,Day,First Punch,Last Punch,Total Hours,Status\nE03,منى,30/09/2026,Wed,0852,1735,8.43,Present')
  assert.equal(rt.device.id, 'realtime')
  assert.equal(rt.rows[0].checkIn, '08:52')
  assert.equal(rt.rows[0].checkOut, '17:35')
  assert.equal(matchImportRows(rt.rows, employees)[0].employeeId, 3, 'E03 يطابق الموظف 3')

  /* ANVIZ بالاختيار اليدوي */
  const anviz = parseFingerprintDeviceCsv('User ID,Name,Date,Check In,Check Out\n12,كريم,2026-09-30,09:00,18:00', 'anviz')
  assert.ok(anviz.manual && anviz.device.id === 'anviz')
  assert.equal(matchImportRows(anviz.rows, employees)[0].employeeId, 12)

  /* eSSL متخطياً Dept/Shift + المطابقة بالاسم العربي fallback */
  const essl = parseFingerprintDeviceCsv('Emp Code,Emp Name,Dept,Date,Day,Shift,In Time,Out Time,Status\n5,سعاد محمود,HR,2026-09-30,Wed,GEN,09:15,18:30,Present')
  assert.equal(essl.device.id, 'essl')
  assert.equal(essl.rows[0].employeeKey, '5')
  const esslByName = matchImportRows([{ ...essl.rows[0], employeeKey: 'سعاد محمود' }], employees)
  assert.equal(esslByName[0].employeeId, 2, 'المطابقة بالاسم العربي تعمل بعد فشل الكود')

  /* عام: عربي بلا جهاز — كما كان تماماً (توافق رجعي) */
  const generic = parseFingerprintDeviceCsv('كود الموظف,الاسم,التاريخ,الدخول,الخروج\n3,منى عبد الله,30/09/2026,08:30,17:00')
  assert.equal(generic.device.id, 'generic')
  assert.equal(generic.rows[0].date, '2026-09-30')
  assert.equal(matchImportRows(generic.rows, employees)[0].employeeId, 3)
  console.log('  ✓ ZKTeco تقرير+نبضات · Hikvision شهر-أولاً · Realtime مضغوط · ANVIZ يدوي · eSSL · عام عربي')
}

/* ─── ③ الواجهة والمخزن: القائمة والتلميح وخط الاعتماد ─── */
console.log('③ الواجهة والمخزن')
{
  const hr = read('../src/ui/pages/HrPage.tsx')
  assert.ok(hr.includes('data-fingerprint-device'), 'قائمة اختيار الجهاز في تبويب البصمة')
  assert.ok(hr.includes('FINGERPRINT_DEVICES.map'), 'القائمة تُبنى من سجل الأجهزة نفسه')
  assert.ok(hr.includes('data-fingerprint-detected'), 'سطر الجهاز المكتشف يظهر بعد التحليل')
  assert.ok(hr.includes('parseFingerprintDeviceCsv'), 'التحليل يمر بجهاز البصمة المختار')
  assert.ok(hr.includes('setPreview(null)'), 'تغيير الجهاز يلغي المعاينة القديمة')
  const core = read('../src/core/fingerprintImport.ts')
  assert.ok(core.includes('العميل قد يستخدم أي جهاز'), 'قرار المالك §77 موثق في النواة')
  /* المخزن: importAttendance موقّع كما كان — لم نمسه */
  const repo = read('../src/data/repo.ts')
  assert.ok(/importAttendance: \(args\) =>/.test(repo), 'importAttendance كما هو')
  console.log('  ✓ قائمة الأجهزة + التلميح + سطر الاكتشاف + خط الاعتماد كما هو')
}

/* ─── ④ ملكية الدمج: نبضات عشوائية لا تفقد أول/آخر أبداً ─── */
console.log('④ ملكية دمج النبضات')
{
  const { parseFingerprintDeviceCsv } = await import('../src/core/fingerprintImport.ts')
  let seed = 777
  const ri = (a, b) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return a + seed % (b - a + 1) }
  for (let t = 0; t < 2000; t++) {
    const punches = []
    const nEmp = ri(1, 5)
    for (let e = 1; e <= nEmp; e++) {
      const times = Array.from({ length: ri(1, 8) }, () => `${String(ri(0, 23)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}`)
      for (const time of times) punches.push(`${e},2026-09-30,${time}`)
    }
    const csv = `User ID,Date,Time\n${punches.join('\n')}`
    const r = parseFingerprintDeviceCsv(csv)
    assert.equal(r.rows.length, nEmp, 'موظف واحد = سجل واحد مهما تعددت النبضات')
    for (const row of r.rows) {
      const mine = punches.filter((p) => p.startsWith(`${row.employeeKey},`)).map((p) => p.split(',')[2])
      assert.equal(row.checkIn, mine.slice().sort()[0], `أول نبضة هي الدخول (${row.employeeKey})`)
      assert.equal(row.checkOut, mine.slice().sort().at(-1), `آخر نبضة هي الخروج (${row.employeeKey})`)
    }
  }
  console.log('  ✓ 2,000 سيناريو نبضات — أول دخول وآخر خروج بلا استثناء')
}

console.log('✅ جولة المالك — البصمة متعددة الأجهزة: 4 فحوص ناجحة')
