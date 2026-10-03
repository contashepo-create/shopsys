/* بوابة دفعة ⑲: ربط الفاتورة بالمشروع · ضريبة بنود عرض السعر · الالتقاط بالحواف */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑲ — المشروع والضريبة والالتقاط بالحواف')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const repo = read('data/repo.ts')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const contracting = read('core/contracting.ts')
const quotes = read('ui/pages/QuotationsPage.tsx')
const floating = read('ui/windows/FloatingWindow.tsx')
const css = read('index.css')

{
  assert.ok(/projectId\?: number \| null\n  \}\) => SaleInvoice/.test(repo) || /ربط فاتورة البيع بمشروع مقاولات/.test(repo),
    'postSale لا يقبل مشروعاً')
  assert.ok(/projectId: args\.projectId \?\? null/.test(repo), 'المشروع لا يُحفظ على فاتورة البيع')
  assert.ok(/aria-label="مشروع الفاتورة"/.test(sales), 'لا حقل مشروع في فاتورة البيع')
  /* بعد بوابة الاعتماد (خطة ③): الوسيط يُبنى كاملاً في saleArgs ثم يُرحَّل — المشروع ما زال أول حقوله */
  assert.ok(/projectId:projectId\|\|null/.test(sales) && /postSale\(saleArgs\)/.test(sales), 'المشروع لا يُمرَّر عند الترحيل')
  R.ok('فاتورة البيع تُربط بمشروع مقاولات ويُحفظ على المستند')
}
{
  for (const rx of [/vatPercent\?: number/, /taxIncluded\?: boolean/, /export function quotationLineNetMinor/, /export function quotationLineTaxMinor/, /export function quotationTotals/])
    assert.ok(rx.test(contracting), 'حساب ضريبة بنود عرض السعر ناقص')
  assert.ok(/line\.taxIncluded \? Math\.round\(gross \* 100 \/ \(100 \+ percent\)\) : gross/.test(contracting),
    'السعر الشامل لا يُستخرج منه الصافي بالطريقة الصحيحة')
  assert.ok(/vat: string; incl: boolean/.test(quotes), 'شاشة العرض بلا حقلي ضريبة/شامل')
  assert.ok(/الإجمالي شامل الضريبة/.test(quotes) && /draftTax\.netMinor/.test(quotes), 'العرض لا يعرض صافياً وضريبة وإجمالياً')
  R.ok('بنود عرض السعر بكميات وأسعار وضريبة — شامل أو مضاف — كالفاتورة')
}
{
  assert.ok(/const zoneAt = useCallback/.test(floating) && /const snapRect = useCallback/.test(floating), 'لا التقاط بالحواف')
  assert.ok(/case 'max': return \{ x: 8, y: 8/.test(floating), 'السحب لأعلى لا يملأ المساحة')
  assert.ok(/data-window-snap=\{snapZone\}/.test(floating), 'لا معاينة للالتقاط قبل الإفلات')
  assert.ok(/if \(rect\) setWindowRect\(win\.id, rect\)/.test(floating), 'الإفلات لا يثبّت النافذة')
  assert.ok(/\.app-window-snap \{[\s\S]{0,260}position: fixed/.test(css), 'معاينة الالتقاط بلا تنسيق على مستوى الشاشة')
  R.ok('الالتقاط بالحواف: نصف · ربع · ملء المساحة بمعاينة قبل الإفلات')
}
R.done()
