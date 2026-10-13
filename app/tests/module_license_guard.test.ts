/**
 * حارس الترخيص في المتجر (مراجعة الجولة 5): `toggleModule` لا يُظهر وحدة خارج الممنوح.
 * الواجهة تعرض زر «إعادة إظهار» للممنوح فقط، لكن الدالة نفسها كانت تقبل أي وحدة —
 * فاستدعاء مباشر (أو تخزين مُعدَّل) كان يفتح قسماً لم يمنحه الدعم.
 * الإثبات: غير الممنوح يبقى مغلقاً، والممنوح بمفتاح موقّع يُفتح ويُغلق بلا فقد.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')

const pharmacy = ACTIVITY_TEMPLATES.find((a) => a.id === 'pharmacy')!

beforeEach(() => {
  useAppStore.setState({
    ...useAppStore.getState(),
    activatedPayload: null,
    setup: { ...useAppStore.getState().setup, activityId: 'pharmacy', completed: true, modules: [...pharmacy.modules] },
  })
})

describe('حارس الترخيص — toggleModule لا يفتح إلا الممنوح', () => {
  it('وحدة غير ممنوحة لا تُفتح حتى لو استُدعيت الدالة مباشرة', () => {
    expect(pharmacy.modules).not.toContain('maintenance')
    useAppStore.getState().toggleModule('maintenance')
    expect(useAppStore.getState().setup.modules).not.toContain('maintenance')
  })

  it('وحدة ممنوحة بمفتاح موقّع تُفتح ثم تُغلق بلا فقد', () => {
    useAppStore.setState({ activatedPayload: { extraModules: ['maintenance'] } as never })
    useAppStore.getState().toggleModule('maintenance')
    expect(useAppStore.getState().setup.modules).toContain('maintenance')
    useAppStore.getState().toggleModule('maintenance')
    expect(useAppStore.getState().setup.modules).not.toContain('maintenance')
  })

  it('إيقاف وحدة أساسية لنشاطها يبقى مسموحاً (الحارس للإظهار فقط)', () => {
    useAppStore.getState().toggleModule('purchases')
    expect(useAppStore.getState().setup.modules).not.toContain('purchases')
  })
})
