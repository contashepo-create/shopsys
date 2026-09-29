/* تحقق حي من بلاغ المالك: عمولة سائق النقلات تظهر في شاشة إصدار مسير الرواتب.
   يبذر سائقاً ونقلتين بعمولة ⇐ يفتح الموظفون/الرواتب ⇐ يفتح «مسير رواتب لكل الموظفين»
   ⇐ يقرأ عمود العمولات ⇐ يرحّل المسير ⇐ يتحقق من تصفية 2111 وصفر مستحقات السائق. */
import { open } from './lib.mjs'
const PORT = process.env.PORT || 5173
const out = process.env.OUT ?? '/home/user/payroll-driver.png'
const { browser, page } = await open(`http://localhost:${PORT}/#/parties/payroll`, 1600, 1000, 8000)

const seeded = await page.evaluate(() => {
  const store = globalThis.__shopsysDev?.data
  const app = globalThis.__shopsysDev?.app
  if (!store || !app) return { dev: false }
  const s = () => store.getState()
  if (!s().items.length) s().seed(['logistics'])
  const a = app.getState()
  app.setState({ ...a, setup: { ...a.setup, completed: true, features: [...new Set([...(a.setup.features ?? []), 'logistics'])] } })
  try { s().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500_000_00, label: 'رصيد افتتاحي' }) } catch { /* موجود */ }
  const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0, creditLimitMinor: 0 })
  let customer = s().customers.find((c) => c.nameAr === 'مصنع الدلتا')
  if (!customer) { s().addCustomer(party('مصنع الدلتا')); customer = s().customers.at(-1) }
  let driver = s().employees.find((e) => e.nameAr === 'محمود السائق')
  if (!driver) {
    s().addEmployee({
      nameAr: 'محمود السائق', phone: '01000000009', jobTitle: 'سائق نقل ثقيل', hireDate: '2026-01-01',
      baseSalaryMinor: 600000, allowancesMinor: 50000, active: true, notes: '', taxNumber: '', commercialReg: '',
      email: '', address: '', city: '', postalCode: '', building: '', district: '', openingBalanceMinor: 0,
    })
    driver = s().employees.at(-1)
  }
  if (s().getDriverDueBalance(driver.id) === 0) {
    const trip = (toLoc, price, commission) => s().postTrip({
      customerId: customer.id, vehicleId: null, driverId: driver.id, notes: '', treasury: '1101',
      driverCommissionMinor: commission,
      input: { fromLoc: 'طنطا', toLoc, qty: 1, unitPriceMinor: price, expenses: [], payment: 'cash', vatPercent: 0, containerNumbers: [] },
    })
    trip('القاهرة', 500000, 7500)
    trip('الإسكندرية', 420000, 6200)
  }
  return { dev: true, driverId: driver.id, dues: s().getDriverDueBalance(driver.id), acc2111: s().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '2111').reduce((a, l) => a + l.debit - l.credit, 0) }
})
console.log('البذر:', JSON.stringify(seeded))

// إعادة تحميل بعد اكتمال الإعداد لتخرج الشاشة من المعالج إلى صفحة الموظفين
await page.evaluate(() => { globalThis.location.hash = '#/parties/payroll' })
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 6000))
console.log('الأزرار:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40))))
await new Promise((r) => setTimeout(r, 600))
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('مسير رواتب لكل الموظفين'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1500))

const ui = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const marker = dialog?.querySelector('[data-driver-dues]')
  const row = marker?.closest('tr')
  return {
    dialog: !!dialog,
    driverMarker: marker?.textContent?.trim() ?? null,
    rowText: row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 180) : null,
    effect: [...(dialog?.querySelectorAll('*') ?? [])].map((el) => el.textContent).find((t) => t?.includes('2111'))?.replace(/\s+/g, ' ').slice(0, 220) ?? null,
  }
})
console.log('الشاشة:', JSON.stringify(ui, null, 1))

// تفعيل مربع صرف العمولات ثم قراءة صافي المصروف
await page.evaluate(() => {
  const marker = document.querySelector('[data-driver-dues]')
  marker?.closest('label')?.querySelector('input[type="checkbox"]')?.click()
})
await new Promise((r) => setTimeout(r, 700))
const afterTick = await page.evaluate(() => {
  const marker = document.querySelector('[data-driver-dues]')
  const row = marker?.closest('tr')
  const dialog = document.querySelector('[role="dialog"]')
  return {
    payout: row ? row.textContent.replace(/\s+/g, ' ').trim().slice(-90) : null,
    effect: [...(dialog?.querySelectorAll('*') ?? [])].map((el) => el.textContent).find((t) => t?.includes('2111'))?.replace(/\s+/g, ' ').slice(0, 260) ?? null,
  }
})
console.log('بعد تفعيل الصرف:', JSON.stringify(afterTick, null, 1))
await page.screenshot({ path: out })

// ترحيل المسير والتحقق من الأثر المحاسبي
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('ترحيل المسير'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 2000))
const posted = await page.evaluate(() => {
  const s = globalThis.__shopsysDev.data.getState()
  const run = s.payrollRuns.at(-1)
  const entry = run ? s.journal.find((e) => e.id === run.journalEntryId) : null
  return {
    runs: s.payrollRuns.length,
    driverDuesPaidMinor: run?.totals?.driverDuesPaidMinor ?? null,
    entry2111: entry?.lines?.filter((l) => l.accountCode === '2111').map((l) => `${l.debit}/${l.credit}`) ?? null,
    duesLeft: s.employees.filter((e) => e.jobTitle.includes('سائق')).map((e) => s.getDriverDueBalance(e.id)),
    settled: s.driverDues.every((d) => d.settled),
    balanced: (() => { let d = 0, c = 0; for (const e of s.journal) for (const l of e.lines) { d += l.debit; c += l.credit } return d === c })(),
  }
})
console.log('بعد الترحيل:', JSON.stringify(posted, null, 1))
await browser.close()
