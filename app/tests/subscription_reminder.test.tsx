/**
 * بند 5 (تدقيق 2026-10-08) — رسالة «غير مزعجة» للعميل بقرب انتهاء اشتراكه.
 *
 * ما كان: شارة سلبية داخل صفحة الترخيص لا يراها إلا من فتحها، ثم شاشة القفل بعد
 * الانتهاء. أي لا شيء بين الاثنين. وما كان مطلوباً صراحةً: تذكير عند 10 أيام.
 *
 * يثبت هذا الاختبار:
 *   ① التدرج: مدى الحياة/بعيدة ⇒ لا شيء · ≤30 ⇒ جرس · ≤10 ⇒ شريط · ≤3 ⇒ عاجل بزر تواصل.
 *   ② يُحسب من الرخصة الموقّعة ⇒ يعمل أوفلاين (fetch مرفوض في كل الملف).
 *   ③ غير مزعج فعلاً: الشريط يُسكت بـ«×» بقية اليوم ولا يعود، والجرس يبقى.
 *   ④ لا يظهر بعد الانتهاء (شاشة القفل هي الواجهة — لا تكرار ولا إهانة).
 *   ⑤ يدخل جرس التنبيهات الموحّد بآلياته الموجودة (غير مقروء/مقروء/نقر).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// أوفلاين صريح: لو احتاج التذكير شبكةً لفشل هذا الملف كله
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { renewalReminder, shouldShowReminderBar, reminderAsNotification, daysWordAr,
  REMINDER_BELL_DAYS, REMINDER_BANNER_DAYS, REMINDER_URGENT_DAYS } = await import('../src/core/subscriptionReminder.ts')
const { collectNotifications } = await import('../src/core/notifications.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { RenewalNoticeBar } = await import('../src/ui/components/RenewalNoticeBar.tsx')

const DAY = 86_400_000
const TODAY = '2026-10-08T09:00:00Z'
const expires = (daysFromToday: number) => new Date(Date.parse(TODAY.slice(0, 10) + 'T00:00:00Z') + daysFromToday * DAY).toISOString().slice(0, 10)

const baseInput = {
  batches: [], itemName: () => 'صنف', installmentPlans: [], customerName: () => 'عميل',
  cheques: [], fmt: (m: number) => `${m / 100}`, todayIso: TODAY,
}

beforeEach(() => {
  useAppStore.setState({ activatedPayload: null, renewalDismissedDay: null })
})
afterEach(() => cleanup())

describe('① التدرج: 30 للجرس · 10 للشريط · 3 للعاجل', () => {
  it('مدى الحياة ⇒ لا تذكير إطلاقاً', () => {
    const r = renewalReminder({ expiresAt: null, todayIso: TODAY })
    expect(r.kind).toBe('none')
    expect(reminderAsNotification(r)).toBeNull()
  })

  it('بعيدة (فوق 30 يوماً) ⇒ لا تذكير', () => {
    expect(renewalReminder({ expiresAt: expires(REMINDER_BELL_DAYS + 1), todayIso: TODAY }).kind).toBe('none')
    expect(renewalReminder({ expiresAt: expires(200), todayIso: TODAY }).kind).toBe('none')
  })

  it('عند 30 يوماً ⇒ إدراج جرس صامت بلا شريط', () => {
    const r = renewalReminder({ expiresAt: expires(30), todayIso: TODAY })
    expect(r.kind).toBe('bell')
    expect(r.severity).toBe('info')
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY })).toBe(false)
  })

  it('عند 10 أيام بالضبط ⇒ شريط (الطلب الصريح للمالك)', () => {
    const r = renewalReminder({ expiresAt: expires(REMINDER_BANNER_DAYS), todayIso: TODAY })
    expect(r.kind).toBe('banner')
    expect(r.severity).toBe('warn')
    expect(r.titleAr).toContain('10 أيام')
    expect(r.showContact).toBe(false) // لا زر تواصل قبل 3 أيام — بلا استعجال
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY })).toBe(true)
  })

  it('عند 11 يوماً ⇒ جرس فقط (لا شريط قبل العتبة)', () => {
    expect(renewalReminder({ expiresAt: expires(REMINDER_BANNER_DAYS + 1), todayIso: TODAY }).kind).toBe('bell')
  })

  it('عند 3 أيام ⇒ عاجل بزر «تواصل للتجديد»', () => {
    const r = renewalReminder({ expiresAt: expires(REMINDER_URGENT_DAYS), todayIso: TODAY })
    expect(r.kind).toBe('urgent')
    expect(r.severity).toBe('danger')
    expect(r.showContact).toBe(true)
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY })).toBe(true)
  })

  it('④ منتهية ⇒ لا تذكير (شاشة القفل هي الواجهة، لا تكرار)', () => {
    expect(renewalReminder({ expiresAt: expires(0), todayIso: TODAY }).kind).toBe('urgent') // ينتهي اليوم
    expect(renewalReminder({ expiresAt: expires(-1), todayIso: TODAY }).kind).toBe('none')
    expect(renewalReminder({ expiresAt: expires(-90), todayIso: TODAY }).kind).toBe('none')
  })

  it('تاريخ انتهاء تالف ⇒ لا تذكير ولا انهيار', () => {
    expect(renewalReminder({ expiresAt: 'ليس تاريخاً', todayIso: TODAY }).kind).toBe('none')
  })

  it('صيغة عربية صحيحة للعدد', () => {
    expect(daysWordAr(1)).toBe('يوم واحد')
    expect(daysWordAr(2)).toBe('يومان')
    expect(daysWordAr(10)).toBe('10 أيام')
    expect(daysWordAr(30)).toBe('30 يوماً')
  })
})

describe('③ غير مزعج فعلاً: الإسكات يسري على الشريط وحده', () => {
  it('الإسكات اليوم يخفي الشريط ولا يخفي إدراج الجرس', () => {
    const r = renewalReminder({ expiresAt: expires(8), todayIso: TODAY })
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: null })).toBe(true)
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: TODAY.slice(0, 10) })).toBe(false)
    // الجرس مستقل عن الإسكات — لا يختفي التنبيه من قائمة التنبيهات
    expect(reminderAsNotification(r)).not.toBeNull()
  })

  it('الإسكات أمس ⇒ الشريط يعود اليوم (لا إسكات دائم)', () => {
    const r = renewalReminder({ expiresAt: expires(8), todayIso: TODAY })
    expect(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: '2026-10-07' })).toBe(true)
  })

  it('إدراج الجرس لا يُطلب صلاحية (perm=null) ومعرفه ثابت لليوم', () => {
    const n = reminderAsNotification(renewalReminder({ expiresAt: expires(8), todayIso: TODAY }))!
    expect(n.perm).toBeNull()
    expect(n.route).toBe('/settings/license')
    expect(n.id).toContain('license:renewal')
    // يومان متتاليان ⇒ معرفان مختلفان (يتجدد ولا يتكدس)
    const tomorrow = renewalReminder({ expiresAt: expires(8), todayIso: new Date(Date.parse(TODAY) + DAY).toISOString() })
    expect(reminderAsNotification(tomorrow)!.id).not.toBe(n.id)
  })
})

describe('⑤ يدخل جرس التنبيهات الموحّد', () => {
  it('يظهر ضمن collectNotifications مرتباً بخطورته', () => {
    const urgent = reminderAsNotification(renewalReminder({ expiresAt: expires(2), todayIso: TODAY }))!
    const all = collectNotifications({ ...baseInput, licenseReminder: urgent })
    expect(all.some((n) => n.id === urgent.id)).toBe(true)
    expect(all[0].severity).toBe('danger') // الأخطر أولاً
  })

  it('بلا تذكير ⇒ لا إدراج (لا ضجيج)', () => {
    const before = collectNotifications(baseInput).length
    const withNone = collectNotifications({ ...baseInput, licenseReminder: null }).length
    expect(withNone).toBe(before)
  })
})

describe('② الشريط في الواجهة — يعمل أوفلاين ويُسكت', () => {
  const renderBar = () => render(<MemoryRouter><RenewalNoticeBar /></MemoryRouter>)
  /* الشريط يحسب اليوم من ساعة الجهاز الحقيقية — فنتعامل معها لا مع TODAY الثابت
     (وإلا صار الاختبار هشاً قرب منتصف الليل بالتوقيت العالمي). */
  const fromNow = (days: number) => {
    const d = new Date()
    d.setUTCHours(0, 0, 0, 0)
    return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10)
  }
  const activate = (daysFromToday: number) => {
    useAppStore.setState({
      activatedPayload: {
        v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', plan: 'basic',
        features: [], issuedAt: '2026-01-01', expiresAt: fromNow(daysFromToday),
      },
    })
  }

  it('لا يظهر لاشتراك مدى الحياة ولا لبعيد', () => {
    activate(400)
    renderBar()
    expect(screen.queryByText(/على انتهاء اشتراكك/)).toBeNull()
    cleanup()
    useAppStore.setState({ activatedPayload: { ...useAppStore.getState().activatedPayload!, expiresAt: null } })
    renderBar()
    expect(screen.queryByText(/على انتهاء اشتراكك/)).toBeNull()
  })

  it('عند 10 أيام يظهر شريط بالعدد والتاريخ، وزر «×» يُسكته', () => {
    activate(10)
    renderBar()
    expect(screen.getByText(/يتبقى 10 أيام على انتهاء اشتراكك/)).toBeTruthy()
    expect(screen.queryByText('تواصل للتجديد')).toBeNull() // لا استعجال قبل 3 أيام

    fireEvent.click(screen.getByLabelText('إسكات تنبيه الاشتراك اليوم'))
    expect(useAppStore.getState().renewalDismissedDay).toBe(new Date().toISOString().slice(0, 10))
    expect(screen.queryByText(/يتبقى 10 أيام على انتهاء اشتراكك/)).toBeNull()
  })

  it('عند 3 أيام يظهر زر «تواصل للتجديد»', () => {
    activate(3)
    renderBar()
    expect(screen.getByText('تواصل للتجديد')).toBeTruthy()
    expect(screen.getByText(/يتبقى 3 أيام على انتهاء اشتراكك/)).toBeTruthy()
  })

  it('الإسكات محفوظ في المتجر فيسري على كل الشاشات', () => {
    activate(5)
    useAppStore.getState().dismissRenewalNotice()
    renderBar()
    expect(screen.queryByText(/على انتهاء اشتراكك/)).toBeNull()
  })
})
