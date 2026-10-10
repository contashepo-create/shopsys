/**
 * إغلاق مضمون للبرنامج (بلاغ المالك: التطبيق يبقى حياً في الخلفية بعد الإغلاق
 * ولا تُعاد فتح النافذة إلا بإنهاء العملية يدوياً).
 *
 * المبدأ: الإغلاق **يجب** أن ينتهي بـ exit مهما حدث — نسخة احتياطية متعثرة
 * أو قاعدة لا تُغلق لا يصح أن تُبقي العملية حية. النسخة الاحتياطية لها مهلة،
 * وإغلاق القاعدة في try، والخروج في النهاية دائماً.
 */

export interface ShutdownDeps {
  /** نسخة احتياطية قبل الإغلاق (قد تتعلّق — لذلك لها مهلة) */
  backup: () => Promise<void>
  /** إغلاق اتصال القاعدة */
  closeDb: () => void
  /** إنهاء العملية فعلاً */
  exit: (code: number) => void
  /** تسجيل في سجل التطبيق */
  log: (event: string, message: string) => void
  /** أقصى انتظار للنسخة الاحتياطية بالمللي ثانية */
  timeoutMs: number
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), deps.timeoutMs)
    })
    const backup = deps.backup().then(
      () => 'done' as const,
      (error: unknown) => {
        deps.log('shutdown', `النسخة الاحتياطية عند الإغلاق فشلت: ${errorText(error)}`)
        return 'done' as const
      },
    )
    const outcome = await Promise.race([backup, timeout])
    if (outcome === 'timeout') deps.log('shutdown', 'تجاوزت النسخة الاحتياطية مهلة الإغلاق — يُغلق البرنامج دون انتظارها')
  } catch (error) {
    deps.log('shutdown', `خطأ أثناء تحضير الإغلاق: ${errorText(error)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
  try {
    deps.closeDb()
  } catch (error) {
    deps.log('shutdown', `تعذّر إغلاق القاعدة: ${errorText(error)}`)
  }
  deps.exit(0)
}
