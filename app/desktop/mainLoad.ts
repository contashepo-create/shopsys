/** تصنيف فشل تحميل إطار التطبيق الرئيسي — ERR_ABORTED غالباً إلغاء تنقل عابر. */

export const CHROMIUM_ERR_ABORTED = -3
export const MAIN_FRAME_ABORT_RETRY_LIMIT = 2

export interface MainFrameLoadState {
  appLoaded: boolean
  errorPageShowing: boolean
  retriesUsed: number
}

export type MainFrameLoadFailureAction = 'ignore' | 'retry' | 'show-error'

export function classifyMainFrameLoadFailure(
  code: number,
  state: MainFrameLoadState,
  retryLimit = MAIN_FRAME_ABORT_RETRY_LIMIT,
): MainFrameLoadFailureAction {
  if (state.errorPageShowing) return 'ignore'
  if (code !== CHROMIUM_ERR_ABORTED) return 'show-error'
  if (state.appLoaded) return 'ignore'
  return state.retriesUsed < retryLimit ? 'retry' : 'show-error'
}
