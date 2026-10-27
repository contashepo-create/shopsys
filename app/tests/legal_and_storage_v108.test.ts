/**
 * جولة v1.0.8 — المحور القانوني وتوثيق الموافقة:
 * الاتفاقية (EULA) وسياسة الخصوصية بنود تفصيلية على النمط العالمي،
 * والموافقة إلزامية مسجلة بالإصدار والتاريخ، وتظهر مجدداً عند تحديث الإصدار.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(useAppStore.getState().legal?.version === LEGAL_VERSION).toBe(false)
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
    // إفصاح صادق: لقطات SQLite الجديدة نصية، والقديمة enc:v1 تحتاج المفتاح الأصلي؛ BitLocker طبقة حماية على القرص.
    expect(privacyText).toContain('نص JSON عادي غير مشفّر على مستوى التطبيق')
    expect(privacyText).toContain('كل من يصل إلى ملفات الجهاز قراءتها')
    expect(privacyText).toContain('enc:v1')
    expect(privacyText).toContain('BitLocker')
    expect(privacyText).toContain('بياناتك ليست رهينة')
    // إفصاح صريح عن رفع حالة المتجر المشفرة عند تفعيل المزامنة اختيارياً.
    expect(privacyText).toContain('المزامنة السحابية الاختيارية')
    expect(privacyText).toContain('AES-256-GCM')
    expect(privacyText).toContain('سر المزامنة نفسه لا يُرسل')
    expect(eulaText).toContain('مشروع Supabase الذي تختاره')

    const lockScreen = readFileSync(join(process.cwd(), 'src/ui/LockScreen.tsx'), 'utf8')
    expect(lockScreen).toContain('isElectronRuntime()')
    expect(lockScreen).toContain('لقطاتها نص JSON غير مشفّر')
    expect(lockScreen).not.toContain('بياناتك محفوظة ومشفرة على جهازك')
    const aboutPage = readFileSync(join(process.cwd(), 'src/ui/pages/AboutPage.tsx'), 'utf8')
    expect(aboutPage).toContain('APP_VERSION')
    expect(aboutPage).toContain('إصدار التطبيق')
  })

  it('موجز المثبِّت جاهز وتسمية الموافقة صريحة (توقيع إلكتروني)', () => {
    expect(INSTALLER_LICENSE_SUMMARY.length).toBeGreaterThan(300)
    expect(INSTALLER_LICENSE_SUMMARY).toContain('ملك حصري للمطوّر')
    expect(LEGAL_ACCEPT_LABEL).toContain('مسؤوليتي عن بياناتي')
  })
})
