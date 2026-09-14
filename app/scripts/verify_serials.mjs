// تحقق تتبع السيريال/IMEI والضمان (نمط موبايل شوب) + تبديل وحدات الأنشطة
// التشغيل: node --experimental-strip-types scripts/verify_serials.mjs
import {
  normalizeSerial, isValidSerial, parseSerialsInput, availableSerials,
  findBySerial, markSold, markReturned, warrantyEndDate, warrantyLookup,
} from '../src/core/serials.ts'
import { ACTIVITY_TEMPLATES, toggleModuleList, getActivity, ALL_MODULES, MODULE_LABELS } from '../src/core/activities.ts'
import { effectiveLimits, PLAN_LIMITS, canonicalPayload } from '../src/core/license.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('— تطبيع السيريال والتحقق —')
check('يزيل الفراغات ويكبّر الحروف', normalizeSerial(' abc-123 ') === 'ABC-123')
check('يطبع الأرقام العربية', normalizeSerial('٣٥٦٧٨٩٠١٢٣٤٥٦٧٨') === '356789012345678')
check('IMEI 15 رقماً صحيح', isValidSerial('356789012345678'))
check('يرفض أقل من 4', !isValidSerial('AB1'))
check('يرفض رموزاً غريبة', !isValidSerial('ABC@123'))

console.log('— فرز إدخال جماعي —')
const r1 = parseSerialsInput('IMEI-001\nIMEI-002, IMEI-001\nX@Y', new Set(['IMEI-002']))
check('يقبل الجديد الصحيح فقط', r1.accepted.length === 1 && r1.accepted[0] === 'IMEI-001')
check('يرفض المكرر والمسجل والغلط بأسباب', r1.errors.length === 3)
const r2 = parseSerialsInput('٣٥٦٧٨٩٠١٢٣٤٥٦٧٨', new Set())
check('إدخال عربي الأرقام يُطبَّع ويُقبل', r2.accepted[0] === '356789012345678')

console.log('— المتاح والبحث والبيع —')
const mk = (id, itemId, serial, status, receivedAt, saleId = null, soldAt = null, wm = 12) =>
  ({ id, itemId, serial, status, purchaseId: 1, saleId, soldAt, warrantyMonths: wm, receivedAt })
const pool = [
  mk(1, 10, 'AAA-1', 'in_stock', '2026-01-02T10:00:00Z'),
  mk(2, 10, 'AAA-2', 'in_stock', '2026-01-01T10:00:00Z'),
  mk(3, 10, 'AAA-3', 'sold', '2026-01-01T09:00:00Z', 5, '2026-06-01T12:00:00Z'),
  mk(4, 20, 'BBB-1', 'in_stock', '2026-02-01T10:00:00Z'),
]
const avail = availableSerials(pool, 10)
check('المتاح لصنف 10 = قطعتان، الأقدم أولاً (FIFO)', avail.length === 2 && avail[0].serial === 'AAA-2')
check('البحث بسيريال خام (بفراغ وحروف صغيرة)', findBySerial(pool, ' aaa-1 ')?.id === 1)
const sold = markSold(pool, [{ itemId: 10, serial: 'AAA-2' }], 99, '2026-09-14T10:00:00Z')
check('markSold يعلّم القطعة مباعة بفاتورتها', sold.find((u) => u.serial === 'AAA-2').status === 'sold' && sold.find((u) => u.serial === 'AAA-2').saleId === 99)
let threw = false
try { markSold(pool, [{ itemId: 10, serial: 'AAA-3' }], 99, '2026-09-14T10:00:00Z') } catch { threw = true }
check('يرفض بيع قطعة مباعة', threw)
threw = false
try { markSold(pool, [{ itemId: 20, serial: 'AAA-1' }], 99, '2026-09-14T10:00:00Z') } catch { threw = true }
check('يرفض سيريالاً يخص صنفاً آخر', threw)
threw = false
try { markSold(pool, [{ itemId: 10, serial: 'AAA-1' }, { itemId: 10, serial: 'AAA-1' }], 99, '2026-09-14T10:00:00Z') } catch { threw = true }
check('يرفض تكرار السيريال في نفس الفاتورة', threw)
const returned = markReturned(sold, 99, ['AAA-2'])
check('المرتجع يعيد القطعة متاحة', returned.find((u) => u.serial === 'AAA-2').status === 'in_stock' && returned.find((u) => u.serial === 'AAA-2').saleId === null)
check('المرتجع لا يمس قطعة من فاتورة أخرى', markReturned(sold, 77, ['AAA-2']).find((u) => u.serial === 'AAA-2').status === 'sold')

console.log('— الضمان —')
check('نهاية الضمان: +12 شهراً', warrantyEndDate('2026-06-01T12:00:00Z', 12) === '2027-06-01')
check('تشبع نهاية الشهر: 31/1 + شهر = 28/2', warrantyEndDate('2026-01-31T00:00:00Z', 1) === '2026-02-28')
const w = warrantyLookup(pool, 'aaa-3', '2026-09-14T00:00:00Z')
check('استعلام ضمان قطعة مباعة: سارٍ حتى 2027-06-01', w?.active === true && w.warrantyUntil === '2027-06-01')
check('أيام متبقية موجبة', w.daysLeft > 200)
check('قطعة متاحة (لم تُبع) → لا ضمان بعد', warrantyLookup(pool, 'AAA-1', '2026-09-14') === undefined)
const wExpired = warrantyLookup([mk(9, 10, 'OLD-1', 'sold', '2024-01-01', 5, '2024-06-01T00:00:00Z')], 'OLD-1', '2026-09-14')
check('ضمان منتهٍ: active=false وdaysLeft=0', wExpired.active === false && wExpired.daysLeft === 0)

console.log('— قوالب الأنشطة والوحدات —')
check('كل نشاط له قالب فاتورة افتراضي', ACTIVITY_TEMPLATES.every((a) => a.defaultInvoiceTemplate === 'thermal' || a.defaultInvoiceTemplate === 'a4'))
check('البقالة حراري واللوجستيات A4', getActivity('grocery').defaultInvoiceTemplate === 'thermal' && getActivity('logistics').defaultInvoiceTemplate === 'a4')
check('اللوجستيات بلا مخزون ولا كاشير', !getActivity('logistics').modules.includes('inventory') && !getActivity('logistics').modules.includes('pos'))
check('إيجار المعدات بلا مخازن افتراضياً', !getActivity('equipment_rental').modules.includes('inventory'))
check('البقالة والموبايلات بمخزون ومشتريات', ['grocery', 'mobile'].every((id) => getActivity(id).modules.includes('inventory') && getActivity(id).modules.includes('purchases')))
check('الموبايلات: سيريال وضمان + صيانة', getActivity('mobile').features.includes('serial_warranty') && getActivity('mobile').modules.includes('maintenance'))
check('كل الوحدات لها تسمية ووصف', ALL_MODULES.every((m) => MODULE_LABELS[m].nameAr && MODULE_LABELS[m].desc))
const toggled = toggleModuleList(['pos', 'inventory'], 'inventory')
check('إلغاء المخزون مع بقاء الكاشير مسموح', !toggled.includes('inventory') && toggled.includes('pos'))
check('التفعيل يضيف الوحدة', toggleModuleList(['pos'], 'maintenance').includes('maintenance'))
threw = false
try { toggleModuleList(['pos', 'inventory'], 'pos') } catch { threw = true }
check('يمنع إلغاء آخر وحدة عمل', threw)
check('إلغاء وحدة عمل مع بقاء أخرى مسموح', !toggleModuleList(['pos', 'logistics'], 'pos').includes('pos'))

console.log('— حدود الباقات والزيادات من البوت —')
check('التجريبي والأساسي: مستخدم واحد وفرع واحد (التعدد خدمة مدفوعة — قرار 28)', PLAN_LIMITS.trial.maxUsers === 1 && PLAN_LIMITS.basic.maxBranches === 1)
check('الاحترافي وما فوق: نسخ متعددة على الشبكة', PLAN_LIMITS.pro.multiInstance && PLAN_LIMITS.lifetime.multiInstance && !PLAN_LIMITS.basic.multiInstance)
const payloadBase = { v: 1, deviceId: 'SHOP-TEST', customer: 'X', plan: 'basic', features: [], issuedAt: '2026-09-14', expiresAt: null }
check('بلا ترخيص = حدود التجريبي', effectiveLimits(null).maxUsers === 1)
const withExtras = { ...payloadBase, plan: 'pro', extraUsers: 3, extraBranches: 2 }
const lim = effectiveLimits(withExtras)
check('الزيادات من البوت تُضاف فوق حد الباقة', lim.maxUsers === 8 && lim.maxBranches === 4)
check('الصيغة القانونية بلا زيادات مطابقة للقديمة (توافق المفاتيح الصادرة)',
  canonicalPayload(payloadBase) === JSON.stringify({ v: 1, deviceId: 'SHOP-TEST', customer: 'X', plan: 'basic', features: [], issuedAt: '2026-09-14', expiresAt: null }))
check('الصيغة القانونية تشمل الزيادات عند وجودها', canonicalPayload(withExtras).includes('"extraUsers":3'))

console.log(`\nالسيريالات والأنشطة: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
