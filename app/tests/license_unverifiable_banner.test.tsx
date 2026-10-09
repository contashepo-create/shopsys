/**
 * ث9 (مراجعة المرحلة ②، 2026-10-08) — صدق الحكم على صفحة الترخيص.
 *
 * ما كان: `reverifyActivation` يعامل **أي** استثناء من `verifyLicenseKey` كتلاعب
 * فيحذف المفتاح. وبيئة بلا WebCrypto (سياق غير آمن http:// مثلاً) تجعل التحقق
 * مستحيلاً لا مزوّراً ⇒ عميل مدفوع يفقد مفتاحه لسبب لا يد له فيه، ولا يستعيده
 * إلا بإعادة إصدار من المطوّر. والأسوأ أن الصفحة تعرض حكماً كاذباً: بلا حمولة
 * معتمدة تعود الحالة إلى «تجربة» أو «انتهت التجربة» رغم وجود مفتاح صالح محفوظ.
 *
 * القاعدة الآن: التلاعب يُحذف، وتعذّر التحقق **يحفظ المفتاح** ويقفل/يُعلن بسبب
 * صادق (`unverifiable` + `license_unverifiable`)، ويعود التفعيل تلقائياً متى
 * توفّرت البيئة.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import React from 'react'

const { LicensePage } = await import('../src/ui/pages/LicensePage.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { lockReasonFor, LOCK_REASON_LABELS } = await import('../src/core/security.ts')

const BANNER = 'تعذّر التحقق من مفتاح التفعيل في بيئة التشغيل الحالية'

describe('لافتة تعذّر التحقق — صفحة الترخيص', () => {
  beforeEach(() => {
    useAppStore.setState({
      activatedKey: 'SHOPSYS1.cGF5bG9hZA.c2ln',
      activatedPayload: null,
      licenseAudit: { status: 'no_key' },
    })
  })
  afterEach(() => { cleanup() })

  it('حالة unverifiable ⇒ اللافتة تظهر وتطمئن أن المفتاح لم يُحذف', () => {
    useAppStore.setState({
      licenseAudit: { status: 'unverifiable', reason: 'WebCrypto غير متاح', at: new Date().toISOString() },
    })
    render(<LicensePage />)
    expect(screen.getByText(BANNER)).toBeTruthy()
    /* الرسالة تذكر السبب البيئي لا حكماً على العميل */
    expect(screen.getByText(/WebCrypto غير متاح/)).toBeTruthy()
    expect(screen.getByText(/مفتاحك محفوظ ولم يُحذف/)).toBeTruthy()
  })

  it('حالة verified أو no_key ⇒ لا لافتة (لا تخويف بلا سبب)', () => {
    useAppStore.setState({ licenseAudit: { status: 'verified', at: new Date().toISOString() } })
    const { unmount } = render(<LicensePage />)
    expect(screen.queryByText(BANNER)).toBeNull()
    unmount()

    useAppStore.setState({ licenseAudit: { status: 'no_key' } })
    render(<LicensePage />)
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('سبب القفل صادق، والحرق يبقى أسبق من تعذّر التحقق', () => {
    const trialExpired = { status: 'trial_expired' } as never
    expect(lockReasonFor(trialExpired, { unverifiable: true })).toBe('license_unverifiable')
    expect(lockReasonFor(trialExpired, {})).toBe('trial_expired')
    expect(lockReasonFor(trialExpired, { revoked: true, unverifiable: true })).toBe('revoked')
    expect(LOCK_REASON_LABELS.license_unverifiable.title).toBeTruthy()
  })
})
