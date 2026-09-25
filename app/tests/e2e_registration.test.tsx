/**
 * E2E — تسجيل مستخدم حقيقي لكل نشاط (أمر الإصلاح):
 * يشغّل التطبيق كاملاً (App) وينقر خطوات المعالج الأربع كمستخدم فعلي،
 * ثم يتحقق أن اختيار النشاط:
 *  1) فعّل وحداته الصحيحة في الإعداد
 *  2) أظهر أقسام القائمة المخصصة له فقط وأخفى غير ذي الصلة تماماً (عزل صارم)
 *  3) القيود المحاسبية والدفتر جاهزان (شجرة الحسابات مبذورة)
 * ملاحظة: غلاف Electron مؤجل بقرار المالك — الاختبار يشمل نفس الواجهة
 * التي ستُحمَّل داخل Electron لاحقاً (HashRouter + localStorage).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import React from 'react'

// عزل الشبكة: مزامنة السحابة تفشل بصمت (سلوك الأوفلاين المدعوم)
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { default: App } = await import('../src/App.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')

/** اختيار من QuickSelect عبر القيمة المخفية في زر الخيار، بلا اعتماد على عنصر select أصلي. */
function chooseQuickSelect(currentLabel: string, value: string) {
  const input = [...document.querySelectorAll('[data-quick-select] input')].find((node) => (node as HTMLInputElement).value === currentLabel) as HTMLInputElement | undefined
  expect(input, `لم يُعثر على المنتقي الحالي «${currentLabel}»`).toBeTruthy()
  fireEvent.focus(input!)
  const option = [...input!.closest('[data-quick-select]')!.querySelectorAll('[data-quick-option]')].find((node) => node.getAttribute('data-value') === value)
  expect(option, `لم يُعثر على خيار ${value}`).toBeTruthy()
  fireEvent.click(option!)
}

/** ينفّذ معالج التسجيل الأربع خطوات كما يفعل المستخدم (التصميم الجديد: قوائم منسدلة + بيانات إلزامية) */
async function completeWizard(activityNameAr: string, shopName: string) {
  // الخطوة 1: البلد — منتقي بحث منبثق
  expect(await screen.findByText('اختر بلدك')).toBeTruthy()
  chooseQuickSelect('— اختر البلد —', 'EG')
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 2: النشاط — منتقي بحث منبثق (بالاسم العربي → id)
  const act = ACTIVITY_TEMPLATES.find((a) => a.nameAr === activityNameAr)!
  chooseQuickSelect('— اختر النشاط —', act.id)
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 3: السنة المالية (الافتراضية سليمة)
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 4: بيانات المنشأة الإلزامية
  fireEvent.change(screen.getByPlaceholderText('مثال: أسواق البركة'), { target: { value: shopName } })
  fireEvent.change(screen.getByPlaceholderText('مثال: محمد عبده'), { target: { value: 'م. محمد عبدة' } })
  // placeholder الهاتف صار حسب البلد (طلب المالك) — مصر: 01012345678
  fireEvent.change(screen.getByPlaceholderText('01012345678'), { target: { value: '01000000000' } })
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'owner@tahakam.app' } })
  chooseQuickSelect('— اختر المدينة —', 'القاهرة')
  fireEvent.change(screen.getByPlaceholderText('مثال: شارع الجمهورية — حي السلام'), { target: { value: 'شارع التحرير' } })
  // كلمة سر المالك تُنشأ مع التسجيل (طلب المالك) — 8-32 خانة
  fireEvent.change(screen.getByPlaceholderText('8 خانات فأكثر'), { target: { value: 'Owner@2026' } })
  fireEvent.change(screen.getByPlaceholderText('أعد كتابتها'), { target: { value: 'Owner@2026' } })
  fireEvent.click(screen.getByText('🚀 ابدأ العمل'))
  // إنهاء المعالج صار غير متزامن (تجزئة كلمة السر) — انتظر اكتمال الإعداد
  await waitFor(() => expect(useAppStore.getState().setup.completed).toBe(true))
}

function sidebar() {
  const nav = document.querySelector('aside') ?? document.body
  return within(nav as HTMLElement)
}

/** أعِد التطبيق لحالة ما قبل التسجيل بالكامل */
function resetApp() {
  cleanup()
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: false, countryCode: null, activityId: null, shopName: '', ownerName: '', features: [], modules: [], accountingMode: 'simple' },
    fiscalYears: [],
  })
  // seeded=false ليعاد بذر النشاط الجديد — محاكاة تثبيت نظيف لكل مستأجر
  useDataStore.setState({ ...useDataStore.getState(), categories: [], items: [], journal: [], seeded: false, ownerPinHash: null, currentUserId: null, loggedOut: false })
}

beforeEach(resetApp)
afterEach(cleanup)

/** الأنشطة الممثِّلة لكل عائلة عزل (تجزئة/خدمية/مشاريع/تأجير/صيانة) */
const PROFILES: { activity: string; mustSee: string[]; mustNotSee: string[] }[] = [
  {
    activity: 'مقاولات وإنشاءات',
    // المخزون والمشتريات أساسيان للمقاولات (أمر المالك): شراء مواد للمخزن ← إذن صرف لمشروع
    mustSee: ['المقاولات', 'المخزون', 'المشتريات'],
    mustNotSee: ['المبيعات', 'إيجار المعدات', 'اللوجستيات', 'العيادة', 'معمل التحاليل', 'الصيانة'],
  },
  {
    activity: 'أغذية / سوبر ماركت',
    mustSee: ['المبيعات', 'المخزون', 'المشتريات'],
    mustNotSee: ['المقاولات', 'اللوجستيات', 'العيادة', 'معمل التحاليل', 'إيجار المعدات', 'الصيانة'],
  },
  {
    activity: 'إيجار معدات ثقيلة',
    mustSee: ['إيجار المعدات'],
    mustNotSee: ['المبيعات', 'المخزون', 'المشتريات', 'المقاولات', 'العيادة'],
  },
  {
    activity: 'موبايلات وصيانة',
    mustSee: ['المبيعات', 'المخزون', 'المشتريات', 'الصيانة'],
    mustNotSee: ['المقاولات', 'اللوجستيات', 'إيجار المعدات', 'معمل التحاليل'],
  },
  {
    activity: 'خدمات لوجستية ونقل',
    mustSee: ['اللوجستيات'],
    mustNotSee: ['المبيعات', 'المخزون', 'المقاولات', 'الصيانة', 'العيادة'],
  },
]

describe('تسجيل حقيقي لكل نشاط + عزل الأقسام (Feature Flagging صارم)', () => {
  for (const profile of PROFILES) {
    it(`نشاط «${profile.activity}»: تسجيل كامل من المعالج وقائمة معزولة`, async () => {
      render(<App />)
      await completeWizard(profile.activity, `متجر اختبار ${profile.activity}`)

      // وصلنا للوحة الرئيسية = التسجيل اكتمل فعلاً
      const setup = useAppStore.getState().setup
      expect(setup.completed).toBe(true)
      const tpl = ACTIVITY_TEMPLATES.find((a) => a.nameAr === profile.activity)!
      expect(setup.modules).toEqual(tpl.modules)
      expect(setup.countryCode).toBe('EG')

      // السنة المالية أُنشئت من المعالج (طلب المالك)
      expect(useAppStore.getState().fiscalYears.length).toBe(1)

      // البذر: قسم افتراضي على الأقل (تهيئة قاعدة البيانات المحلية للنشاط)
      expect(useDataStore.getState().categories.length).toBeGreaterThan(0)

      const sb = sidebar()
      for (const label of profile.mustSee) {
        expect(sb.queryAllByText(label).length, `يجب ظهور قسم «${label}»`).toBeGreaterThan(0)
      }
      for (const label of profile.mustNotSee) {
        expect(sb.queryAllByText(label).length, `يجب إخفاء قسم «${label}» تماماً`).toBe(0)
      }
    })
  }

  it('كل قوالب الأنشطة الـ29 معرفة بوحدات غير فارغة وأيقونة وقالب فاتورة', () => {
    expect(ACTIVITY_TEMPLATES.length).toBe(29)
    for (const a of ACTIVITY_TEMPLATES) {
      expect(a.modules.length, a.id).toBeGreaterThan(0)
      expect(a.nameAr.length).toBeGreaterThan(0)
      expect(['thermal', 'a4']).toContain(a.defaultInvoiceTemplate)
    }
  })

  it('تبديل النشاط لا يلوث الوحدات (لا تسرب بين المستأجرين)', async () => {
    render(<App />)
    await completeWizard('مقاولات وإنشاءات', 'مقاولات أ')
    expect(useAppStore.getState().setup.modules).toEqual(['contracting', 'inventory', 'purchases'])
    // إعادة الضبط ثم تسجيل نشاط آخر — يجب ألا تبقى أي وحدة من النشاط السابق
    resetApp()
    render(<App />)
    await completeWizard('معمل تحاليل طبية', 'معمل ب')
    const mods = useAppStore.getState().setup.modules
    expect(mods).toEqual(['lab'])
    expect(mods).not.toContain('contracting')
    const sb = sidebar()
    expect(sb.queryAllByText('معمل التحاليل').length).toBeGreaterThan(0)
    expect(sb.queryAllByText('المقاولات').length).toBe(0)
  })
})
