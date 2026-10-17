// بنود طلب المالك (دفعة 2026-10-17): (1) أقسام نشاط العميل فقط في الإعدادات العامة،
// (3) سنة مالية واحدة مفتوحة، (4) ترتيب حقول صفحة الفاتورة الإلكترونية، (7) الصنف كنوع «خدمة».
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

/* ذاكرة محلية وهمية (المتجر يحتاج localStorage عند الإقلاع) */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = globalThis

// ── ① أقسام نشاط العميل فقط في الإعدادات العامة ──────────────────────────
const settingsSrc = read('src/ui/pages/GeneralSettingsPage.tsx')
ok('قائمة الأقسام تعتمد granted (نشاط العميل)', /granted\.map\(/.test(settingsSrc))
ok('لا تُعرض أسماء كل الأقسام (ALL_MODULES.map غير موجود)', !/ALL_MODULES\.map\(/.test(settingsSrc))
ok('نص يوضّح أن القائمة(activity) هي المعروضة', /أقسام نشاطك/.test(settingsSrc))
ok('زر «إعادة إظهار» متاح للمنح الموقوف', /إعادة إظهار/.test(settingsSrc))
ok('إرشاد «بكود الدعم» متاح للمالك (بلا زر فتح ذاتي)', /بكود الدعم/.test(settingsSrc) && !/>\{?'تفعيل'?\}</.test(settingsSrc))

const activitiesSrc = read('src/core/activities.ts')
ok('effectiveModules تحسب الممنوح من النشاط + المفتاح الموقّع', /export function effectiveModules/.test(activitiesSrc))

// ── ③ سنة مالية واحدة مفتوحة فقط ─────────────────────────────────────────
const storeSrc = read('src/stores/app.store.ts')
ok('addFiscalYear يرفض فتح سنة والمفتوحة موجودة', /ما زالت مفتوحة/.test(storeSrc))
ok('الحارس داخل set (بلا فتح صامت)', /fiscalYears\.find\(\(y\) => y\.status === 'open'\)/.test(storeSrc))
const { useAppStore } = await import(join(appRoot, 'src/stores/app.store.ts'))
/* وضع سنة مفتوحة (كما بعد إكمال الإعداد) ثم محاولة فتح أخرى */
useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
const before = useAppStore.getState().fiscalYears.length
let blocked = false
let message = ''
try {
  useAppStore.getState().addFiscalYear({ nameAr: '2027', startDate: '2027-01-01', endDate: '2027-12-31' })
} catch (e) { blocked = true; message = e.message }
const openYears = useAppStore.getState().fiscalYears.filter((y) => y.status === 'open')
ok('فتح سنة ثانية مرفوض (سنة واحدة مفتوحة)', blocked && /مفتوحة/.test(message))
ok('عدد السنوات المفتوحة ≤ 1', openYears.length <= 1)
ok('لم تُضَف سنة عند الرفض', useAppStore.getState().fiscalYears.length === before)
/* بعد إقفال السنة المفتوحة تُفتح سنة جديدة بسنة واحدة مفتوحة */
useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
useAppStore.getState().addFiscalYear({ nameAr: '2027', startDate: '2027-01-01', endDate: '2027-12-31' })
ok('بعد إقفال السنة يُفتح سنة جديدة (سنة واحدة مفتوحة)', useAppStore.getState().fiscalYears.filter((y) => y.status === 'open').length === 1)

// ── ④ ترتيب حقول صفحة الفاتورة الإلكترونية ──────────────────────────────
const einvoiceSrc = read('src/ui/pages/EinvoicePage.tsx')
const taxIdx = einvoiceSrc.indexOf('الرقم الضريبي (زاتكا')
const addrIdx = einvoiceSrc.indexOf('عنوان المنشأة')
const saveIdx = einvoiceSrc.indexOf('حفظ البيانات')
const optsIdx = einvoiceSrc.indexOf('خيارات الإصدار')
ok('ترتيب: الرقم الضريبي قبل العنوان', taxIdx > 0 && addrIdx > taxIdx)
ok('ترتيب: زر الحفظ بعد الحقول مباشرة', saveIdx > addrIdx)
ok('ترتيب: الخيارات بعد زر الحفظ (لا تحجب الحفظ)', optsIdx > saveIdx)
ok('مزامنة الحقول مع المخزن', /setTaxNumber\(einvoice\.taxNumber\)/.test(einvoiceSrc))
ok('الخيارات موضوعة في مجموعة «خيارات الإصدار»', /خيارات الإصدار/.test(einvoiceSrc))

// ── ⑦ الصنف: منتج أم خدمة (بلا مخزون) في كل الأنشطة ─────────────────────
const itemsPageSrc = read('src/ui/pages/ItemsPage.tsx')
ok('نموذج الصنف فيه اختيار «نوع الصنف»', /نوع الصنف/.test(itemsPageSrc))
ok('الخيار يعرض «خدمة — بلا مخزون»', /خدمة — بلا مخزون/.test(itemsPageSrc))
ok('شارة «خدمة» في قائمة الأصناف', /label: 'خدمة'/.test(itemsPageSrc))
ok('شارة «خدمة» واحدة فقط في بطاقة الصنف (لا تكرار)', (itemsPageSrc.match(/label: 'خدمة'/g) ?? []).length === 1)
ok('الخدمة بلا صلاحية/سيريال/وزن (المحرّك يمنعها)', /draft\.isService && \(draft\.trackSerial \|\| draft\.trackExpiry \|\| draft\.soldByWeight\)/.test(read('src/core/items.ts')))
ok('حقول المخزون/الصلاحية مخفية للخدمة', /\{!draft\.isService && \(/.test(itemsPageSrc))
/* رفض فتح سنة ثانية: الرسالة تظهر والنموذج يبقى مفتوحاً (المُدخل محفوظ) */
const saveNewYearBlock = settingsSrc.slice(settingsSrc.indexOf('const saveNewYear'), settingsSrc.indexOf('const [specialty'))
const catchBody = saveNewYearBlock.slice(saveNewYearBlock.indexOf('catch (err)'), saveNewYearBlock.indexOf('return toast.show((err as Error).message'))
ok('رفض فتح سنة ثانية لا يُغلق نموذج السنة (يبقى المُدخل)', /catch \(err\) \{/.test(saveNewYearBlock) && catchBody.length > 10 && !/setNewYearOpen\(false\)/.test(catchBody))

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
