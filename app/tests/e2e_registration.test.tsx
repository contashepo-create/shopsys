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
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import React from 'react'

// عزل الشبكة: مزامنة السحابة تفشل بصمت (سلوك الأوفلاين المدعوم)
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { default: App } = await import('../src/App.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')

/** ينفّذ معالج التسجيل الأربع خطوات كما يفعل المستخدم (التصميم الجديد: قوائم منسدلة + بيانات إلزامية) */
async function completeWizard(activityNameAr: string, shopName: string) {
  // الخطوة 1: البلد — قائمة منسدلة
  expect(await screen.findByText('اختر بلدك')).toBeTruthy()
  const selects1 = document.querySelectorAll('select')
  fireEvent.change(selects1[0], { target: { value: 'EG' } })
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 2: النشاط — قائمة منسدلة (بالاسم العربي → id)
  const act = ACTIVITY_TEMPLATES.find((a) => a.nameAr === activityNameAr)!
  const selects2 = document.querySelectorAll('select')
  fireEvent.change(selects2[0], { target: { value: act.id } })
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 3: السنة المالية (الافتراضية سليمة)
  fireEvent.click(screen.getByText('التالي'))
  // الخطوة 4: بيانات المنشأة الإلزامية
  fireEvent.change(screen.getByPlaceholderText('مثال: أسواق البركة'), { target: { value: shopName } })
  fireEvent.change(screen.getByPlaceholderText('مثال: محمد عبده'), { target: { value: 'م. محمد عبدة' } })
  fireEvent.change(screen.getByPlaceholderText('01xxxxxxxxx'), { target: { value: '01000000000' } })
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'owner@tahakam.app' } })
  const citySelect = [...document.querySelectorAll('select')].at(-1)!
  fireEvent.change(citySelect, { target: { value: 'القاهرة' } })
  fireEvent.change(screen.getByPlaceholderText('مثال: شارع الجمهورية — حي السلام'), { target: { value: 'شارع التحرير' } })
  fireEvent.click(screen.getByText('🚀 ابدأ العمل'))
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
  useDataStore.setState({ ...useDataStore.getState(), categories: [], items: [], journal: [], seeded: false })
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

  it('كل قوالب الأنشطة الـ20 معرفة بوحدات غير فارغة وأيقونة وقالب فاتورة', () => {
    expect(ACTIVITY_TEMPLATES.length).toBe(20)
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
