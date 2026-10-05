/**
 * جولة v1.0.10 — طلب المالك: قسم إضافي لنشاط لا يملكه افتراضياً.
 * القرار المعماري (عقد إضافة قسم خارج النشاط): الفتح بمفتاح موقّع من الدعم فقط
 * (extraModules) — والعميل يدير إظهار ما مُنح له. الإثبات هنا:
 * منح موقّع يضيف القسم، الإيقاف يخفيه دون فقد، إعادة الإظهار تعيده،
 * ولا إيقاف آخر وحدة مفعّلة.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { toggleModuleList, effectiveModules, ACTIVITY_TEMPLATES, ALL_MODULES, MODULE_LABELS } = await import('../src/core/activities.ts')

beforeEach(() => {
  const pharmacy = ACTIVITY_TEMPLATES.find((a) => a.id === 'pharmacy')!
  useAppStore.setState({
    ...useAppStore.getState(),
    setup: { ...useAppStore.getState().setup, activityId: 'pharmacy', completed: true, modules: [...pharmacy.modules] },
  })
})

describe('إدارة الأقسام — قسم إضافي لأي نشاط (v1.0.10)', () => {
  it('منح موقّع (extraModules) يضيف قسماً خارج نشاط الصيدلية — وإدارته إظهار/إيقاف بلا فقد', () => {
    const A = () => useAppStore.getState()
    // القناة الوحيدة: مفتاح الدعم يمنح الصيانة لصيدلية لا تملكها افتراضياً
    const granted = effectiveModules('pharmacy', ['maintenance'])
    expect(granted).toContain('maintenance')
    expect(granted).toContain('pos') // افتراضيات النشاط تبقى
    // العميل يوقف القسم الممنوح (إخفاء شاشات فقط — البيانات بالمتجر) ثم يعيد إظهاره
    useAppStore.setState({ setup: { ...A().setup, modules: [...granted] } })
    A().toggleModule('maintenance')
    expect(A().setup.modules).not.toContain('maintenance')
    A().toggleModule('maintenance')
    expect(A().setup.modules).toContain('maintenance')
  })

  it('لا إيقاف آخر وحدة مفعّلة — التطبيق لا يبقى بلا أقسام', () => {
    useAppStore.setState({ setup: { ...useAppStore.getState().setup, modules: ['pos'] } })
    useAppStore.getState().toggleModule('pos')
    expect(useAppStore.getState().setup.modules).toEqual(['pos']) // لم تتغير
    // التفعيل والإيقاط لوحدة أخرى يعملان طبيعياً
    useAppStore.getState().toggleModule('inventory')
    expect(useAppStore.getState().setup.modules).toEqual(['pos', 'inventory'])
  })

  it('كل الوحدات الـ17 معرفة بوصف عربي — والبطاقة تعرضها جميعاً (المعالج يثق بها)', () => {
    expect(ALL_MODULES.length).toBe(17)
    for (const m of ALL_MODULES) {
      expect(MODULE_LABELS[m].nameAr.length).toBeGreaterThan(1)
      expect(MODULE_LABELS[m].desc.length).toBeGreaterThan(5)
    }
    // حماية الطبقة الدنيا: إطفاء آخر وحدة عمل يُرفض برسالة واضحة (لا تطبيق بلا أقسام)
    expect(() => toggleModuleList(['pos'], 'pos')).toThrow('لا يمكن إلغاء آخر وحدة عمل')
  })
})
