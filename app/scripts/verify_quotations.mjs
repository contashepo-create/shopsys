/**
 * فحص عروض الأسعار/المناقصات (الدفعة 5)
 * ملاحظة: انتقلت اختبارات العُهد إلى verify_custody.mjs (نظام ملفات العهد المتكامل)
 * تشغيل: node --experimental-strip-types scripts/verify_quotations.mjs
 */
import {
  quotationTotal, validateQuotation, QUOTATION_TRANSITIONS, QUOTATION_STATUS_LABELS,
} from '../src/core/contracting.ts'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ خطأ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}`) }
}
const balanced = (lines) => {
  const d = lines.reduce((s, l) => s + l.debit, 0)
  const c = lines.reduce((s, l) => s + l.credit, 0)
  return d === c && d > 0
}

console.log('📋 إجمالي العرض')
ok('سطر واحد 3×1000', quotationTotal([{ descriptionAr: 'حفر', qty: 3, unitAr: 'م3', unitPriceMinor: 1000 }]) === 3000)
ok('سطران يتجمعان', quotationTotal([
  { descriptionAr: 'حفر', qty: 2, unitAr: 'م3', unitPriceMinor: 1500 },
  { descriptionAr: 'مباني', qty: 10, unitAr: 'م2', unitPriceMinor: 250 },
]) === 5500)
ok('كسور تُقرَّب: 2.5×333 = 833 (تقريب)', quotationTotal([{ descriptionAr: 'x', qty: 2.5, unitAr: 'م', unitPriceMinor: 333 }]) === Math.round(2.5 * 333))
ok('قائمة فارغة = 0', quotationTotal([]) === 0)

console.log('📋 التحقق من العرض')
ok('عرض سليم بلا أخطاء', validateQuotation({ titleAr: 'تشطيب', clientName: 'شركة النور', lines: [{ descriptionAr: 'دهانات', qty: 1, unitAr: 'مقطوعية', unitPriceMinor: 50000 }] }).length === 0)
ok('عنوان فارغ يُرفض', validateQuotation({ titleAr: ' ', clientName: 'ش', lines: [{ descriptionAr: 'x', qty: 1, unitAr: 'م', unitPriceMinor: 1 }] }).length > 0)
ok('عميل فارغ يُرفض', validateQuotation({ titleAr: 'ع', clientName: '', lines: [{ descriptionAr: 'x', qty: 1, unitAr: 'م', unitPriceMinor: 1 }] }).length > 0)
ok('بلا بنود يُرفض', validateQuotation({ titleAr: 'ع', clientName: 'ش', lines: [] }).length > 0)
ok('بند بكمية صفر يُرفض', validateQuotation({ titleAr: 'ع', clientName: 'ش', lines: [{ descriptionAr: 'x', qty: 0, unitAr: 'م', unitPriceMinor: 1 }] }).length > 0)

console.log('📋 دورة حالة العرض')
ok('مسودة → مُقدَّم فقط', QUOTATION_TRANSITIONS.draft.length === 1 && QUOTATION_TRANSITIONS.draft.includes('submitted'))
ok('مُقدَّم → فائز أو خاسر', QUOTATION_TRANSITIONS.submitted.includes('won') && QUOTATION_TRANSITIONS.submitted.includes('lost'))
ok('فائز نهائي', QUOTATION_TRANSITIONS.won.length === 0)
ok('خاسر نهائي', QUOTATION_TRANSITIONS.lost.length === 0)
ok('تسميات عربية لكل حالة', ['draft', 'submitted', 'won', 'lost'].every((s) => QUOTATION_STATUS_LABELS[s]?.nameAr))

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 نجح فحص عروض الأسعار')
