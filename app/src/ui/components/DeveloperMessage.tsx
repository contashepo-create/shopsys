/**
 * رسالة المطوّر لهذا الجهاز (عرض فقط). تظهر في «حول» وفي شاشة القفل.
 * النص يُعرض كنص عادي (React يعقّمه)، ولا يمنح ولا يسحب أي صلاحية.
 */
export function DeveloperMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div role="note" className="rounded-2xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 p-4 space-y-1 text-start">
      <div className="font-black text-sky-800 dark:text-sky-200 text-sm">رسالة من المطوّر</div>
      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{message}</p>
    </div>
  )
}
