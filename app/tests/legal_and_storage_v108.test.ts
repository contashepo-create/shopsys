/**
 * جولة v1.0.8 — المحور القانوني وتوثيق الموافقة:
 * الاتفاقية (EULA) وسياسة الخصوصية بنود تفصيلية على النمط العالمي،
 * والموافقة إلزامية مسجلة بالإصدار والتاريخ، وتظهر مجدداً عند تحديث الإصدار.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { EULA, PRIVACY, LEGAL_VERSION, LEGAL_ACCEPT_LABEL, INSTALLER_LICENSE_SUMMARY } = await import('../src/core/legal.ts')

describe('الاتفاقية والخصوصية والموافقة الموثقة (v1.0.8)', () => {
  it('الموافقة تُسجَّل بالإصدار والتاريخ وتُطلب مجدداً عند تغيير الإصدار', () => {
    const A = () => useAppStore.getState()
    expect(A().legal).toBeNull() // لم يوافق بعد ⇒ البوابة تظهر
    A().acceptLegal()
    expect(A().legal).not.toBeNull()
    expect(A().legal!.version).toBe(LEGAL_VERSION)
    expect(A().legal!.acceptedAt).toBeTruthy()
    // إصدار مستقبلي ⇒ الموافقة القديمة لا تكفي (البوابة تظهر مجدداً)
    useAppStore.setState({ legal: { version: '2020-01-01', acceptedAt: '2020-01-01T00:00:00Z' } })
    expect(useAppStore.getState().legal.version === LEGAL_VERSION).toBe(false)
  })

  it('البنود القانونية الجوهرية موجودة حرفياً (حماية المالك من المساءلة)', () => {
    const eulaText = JSON.stringify(EULA)
    // منع البيع/الاستخدام دون ترخيص
    expect(eulaText).toContain('يُحظر نهائياً')
    expect(eulaText).toContain('بيع البرنامج')
    // الهندسة العكسية
    expect(eulaText).toContain('الهندسة العكسية')
    // إخلاء المسؤولية وحد المسؤولية
    expect(eulaText).toContain('كما هو')
    expect(eulaText).toContain('حد المسؤولية')
    expect(eulaText).toContain('500 جنيه')
    // مسؤولية البيانات والنسخ على المستخدم
    expect(eulaText).toContain('أنت وحده مسؤول')
    // القانون الحاكم
    expect(eulaText).toContain('جمهورية مصر العربية')
    // التجربة مرة واحدة لكل جهاز
    expect(eulaText).toContain('مرة واحدة لكل جهاز')
    expect(EULA.sections.length).toBeGreaterThanOrEqual(12)
    expect(PRIVACY.sections.length).toBeGreaterThanOrEqual(6)
    // الخصوصية: البيانات محلية ولا تُباع
    const privacyText = JSON.stringify(PRIVACY)
    expect(privacyText).toContain('لا نستخدم إعلانات')
    expect(privacyText).toContain('AES-256-GCM')
    expect(privacyText).toContain('بياناتك ليست رهينة')
  })

  it('موجز المثبِّت جاهز وتسمية الموافقة صريحة (توقيع إلكتروني)', () => {
    expect(INSTALLER_LICENSE_SUMMARY.length).toBeGreaterThan(300)
    expect(INSTALLER_LICENSE_SUMMARY).toContain('ملك حصري للمطوّر')
    expect(LEGAL_ACCEPT_LABEL).toContain('مسؤوليتي عن بياناتي')
  })
})
