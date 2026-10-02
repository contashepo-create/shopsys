import { describe, expect, it } from 'vitest'
import { detectFingerprintDevice, FINGERPRINT_DEVICES, parseFingerprintDeviceCsv } from '../src/core/fingerprintImport.ts'
import { matchImportRows, parseFingerprintCsv } from '../src/core/attendance.ts'

describe('استيراد البصمة متعدد الأجهزة (§77)', () => {
  it('يحوي سجل الأجهزة على الخمسة المدعومة + العام', () => {
    const ids = FINGERPRINT_DEVICES.map((d) => d.id)
    expect(ids).toEqual(['generic', 'zkteco', 'hikvision', 'realtime', 'anviz', 'essl'])
  })

  it('يفهم تصدير ZKTeco التقاريري (Clock In/Out)', () => {
    const csv = 'No.,EMP Code,Name,Date,Clock In,Clock Out\n1,0001,أحمد محمد,2026-09-30,08:52,17:35'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('zkteco')
    expect(r.rows[0]).toMatchObject({ employeeKey: '0001', date: '2026-09-30', checkIn: '08:52', checkOut: '17:35' })
  })

  it('يدمج سجل نبضات ZKTeco الخام: أول بصمة دخولاً وآخرها خروجاً', () => {
    const csv = 'User ID,Date,Time\n1,2026-09-30,08:52\n1,2026-09-30,12:00\n1,2026-09-30,17:35\n2,2026-09-30,09:10\n2,2026-09-30,18:02'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('zkteco')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ employeeKey: '1', checkIn: '08:52', checkOut: '17:35' })
    expect(r.rows[1]).toMatchObject({ employeeKey: '2', checkIn: '09:10', checkOut: '18:02' })
  })

  it('يفهم صيغة Hikvision شهر/يوم/سنة وأوقات AM/PM', () => {
    const csv = 'Personnel No.,Name,Date,First Check-in,Last Check-out\n7,سعيد,09/30/2026,8:05 AM,5:02 PM'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('hikvision')
    expect(r.rows[0]).toMatchObject({ date: '2026-09-30', checkIn: '08:05', checkOut: '17:02' })
  })

  it('لا يقلب تاريخ Hikvision الصريح يوم/شهر/سنة (30/09) بالخطأ', () => {
    const csv = 'Personnel No.,Name,Date,First Check-in,Last Check-out\n7,سعيد,30/09/2026,8:05,17:02'
    const r = parseFingerprintDeviceCsv(csv, 'hikvision')
    expect(r.rows[0].date).toBe('2026-09-30')
  })

  it('يفهم Realtime بالوقت المضغوط 0852', () => {
    const csv = 'Emp Code,Employee Name,Date,Day,First Punch,Last Punch,Total Hours,Status\nE03,منى,30/09/2026,Wed,0852,1735,8.43,Present'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('realtime')
    expect(r.rows[0]).toMatchObject({ employeeKey: 'E03', date: '2026-09-30', checkIn: '08:52', checkOut: '17:35' })
  })

  it('يفهم eSSL (In Time/Out Time) متخطياً Dept وShift', () => {
    const csv = 'Emp Code,Emp Name,Dept,Date,Day,Shift,In Time,Out Time,Status\n5,دينا,SALES,2026-09-30,Wed,GEN,09:15,18:30,Present'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('essl')
    expect(r.rows[0]).toMatchObject({ employeeKey: '5', date: '2026-09-30', checkIn: '09:15', checkOut: '18:30' })
  })

  it('الكشف التلقائي لا يطابق ملفاً عربياً عادياً ⇒ الوضع العام', () => {
    const csv = 'كود الموظف,الاسم,التاريخ,الدخول,الخروج\n3,علي حسن,30/09/2026,08:30,17:00'
    const r = parseFingerprintDeviceCsv(csv)
    expect(r.device.id).toBe('generic')
    expect(detectFingerprintDevice(csv).matched).toBe(false)
    expect(r.rows[0]).toMatchObject({ employeeKey: '3', date: '2026-09-30', checkIn: '08:30', checkOut: '17:00' })
  })

  it('الاختيار اليدوي يتقدم على الكشف ويطبق ملفه التعريفي', () => {
    const csv = 'User ID,Name,Date,Check In,Check Out\n12,كريم,2026-09-30,09:00,18:00'
    const auto = parseFingerprintDeviceCsv(csv)
    const manual = parseFingerprintDeviceCsv(csv, 'anviz')
    expect(auto.device.id).toBe('anviz') /* بصمة userid+checkin التعريفية */
    expect(manual.manual).toBe(true)
    expect(manual.device.id).toBe('anviz')
    expect(manual.rows[0]).toMatchObject({ employeeKey: '12', checkIn: '09:00', checkOut: '18:00' })
  })

  it('توافق رجعي كامل: parseFingerprintCsv بلا خيارات كما كان', () => {
    const rows = parseFingerprintCsv('EMP-0001,2026-09-30,08:52,17:35\nأحمد سعيد,30/09/2026,09:10,18:02')
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows[0]).toMatchObject({ employeeKey: 'EMP-0001', date: '2026-09-30', checkIn: '08:52', checkOut: '17:35' })
    expect(rows.errors).toHaveLength(0)
  })

  it('المطابقة بالموظفين تعمل على مخرجات كل جهاز (كود E03/7/0001)', () => {
    const employees = [
      { id: 1, nameAr: 'أحمد محمد' },
      { id: 3, nameAr: 'منى' },
      { id: 7, nameAr: 'سعيد' },
    ]
    const csv = 'EMP Code,Name,Date,Clock In,Clock Out\n0001,أحمد,2026-09-30,08:52,17:35\nE03,منى,2026-09-30,09:10,18:02\n7,سعيد,2026-09-30,08:00,17:00'
    const r = parseFingerprintDeviceCsv(csv)
    const matches = matchImportRows(r.rows, employees)
    expect(matches.map((m) => m.employeeId)).toEqual([1, 3, 7])
  })

  it('سجل نبضات بلا رأس: كود · تاريخ · وقت', () => {
    const rows = parseFingerprintCsv('1,2026-09-30,08:52\n1,2026-09-30,17:35', { punchLog: true })
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ checkIn: '08:52', checkOut: '17:35' })
  })
})
