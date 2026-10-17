// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CHROMIUM_ERR_ABORTED, classifyMainFrameLoadFailure, MAIN_FRAME_ABORT_RETRY_LIMIT } from '../desktop/mainLoad.ts'

describe('تحميل واجهة Electron — عدم اعتبار ERR_ABORTED فشلاً نهائياً', () => {
  it('يعيد محاولة الإلغاء العابر قبل اكتمال أول تحميل', () => {
    expect(classifyMainFrameLoadFailure(CHROMIUM_ERR_ABORTED, {
      appLoaded: false,
      errorPageShowing: false,
      retriesUsed: 0,
    })).toBe('retry')
  })

  it('يتجاهل إلغاء التنقل بعد نجاح تحميل الواجهة', () => {
    expect(classifyMainFrameLoadFailure(CHROMIUM_ERR_ABORTED, {
      appLoaded: true,
      errorPageShowing: false,
      retriesUsed: 0,
    })).toBe('ignore')
  })

  it('لا يعرض صفحة خطأ فوق صفحة الخطأ المضمّنة نفسها', () => {
    expect(classifyMainFrameLoadFailure(-6, {
      appLoaded: false,
      errorPageShowing: true,
      retriesUsed: 0,
    })).toBe('ignore')
  })

  it('يعرض خطأ واضحاً بعد استنفاد محاولتي الإعادة', () => {
    expect(MAIN_FRAME_ABORT_RETRY_LIMIT).toBe(2)
    expect(classifyMainFrameLoadFailure(CHROMIUM_ERR_ABORTED, {
      appLoaded: false,
      errorPageShowing: false,
      retriesUsed: MAIN_FRAME_ABORT_RETRY_LIMIT,
    })).toBe('show-error')
  })

  it('لا يعيد المحاولة لأخطاء تحميل فعلية غير ERR_ABORTED', () => {
    expect(classifyMainFrameLoadFailure(-6, {
      appLoaded: false,
      errorPageShowing: false,
      retriesUsed: 0,
    })).toBe('show-error')
  })
})
