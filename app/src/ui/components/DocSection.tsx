import type { ReactNode } from 'react'

/**
 * أقسام «المستند» المشتركة بين نوافذ الإدخال (تدقيق المالك — المرحلة 7).
 *
 * كانت نوافذ المصروفات تُبنى كل مرة بأسلوب مختلف: بعضها بأقسام مرقّمة (مدير مصروفات الشراء)،
 * وبعضها `div` سائب بلا عنوان ولا تسلسل. النتيجة: المستخدم يتعلم الشاشة من جديد في كل نافذة.
 * هنا قطعتان مشتركتان بلغة السند نفسها — عنوان قسم مرقّم، وغلاف قسم بحدود المستند —
 * تُستعملان في كل نافذة إدخال مالية فتتوحد اللغة ويتبع الشكلُ الوضعَ الليلي تلقائياً
 * (ألوان الطبقة `doc-*` في `index.css`).
 */

/** عنوان قسم داخل نافذة إدخال: رقم الخطوة + أيقونة + عنوان + تلميح اختياري */
export function DocSectionHead({ step, icon, title, hint }: { step: string; icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full doc-head text-[10px] font-black">{step}</span>
      <h4 className="flex items-center gap-1.5 text-[12.5px] font-bold doc-ink">{icon}{title}</h4>
      {hint && <span className="text-[10px] doc-faint">{hint}</span>}
    </div>
  )
}

/** غلاف قسم: بطاقة المستند التي تحمل العنوان والمحتوى */
export function DocSection({ step, icon, title, hint, children, className = '' }: {
  step: string
  icon?: ReactNode
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl doc-card doc-ring p-3.5 ${className}`}>
      <DocSectionHead step={step} icon={icon} title={title} hint={hint} />
      {children}
    </section>
  )
}

/** شريط حصيلة أسفل النافذة: «ما الذي سيُرحَّل بالضبط» قبل الضغط على الزر */
export function DocOutcome({ children }: { children: ReactNode }) {
  return <div className="rounded-xl doc-band px-3.5 py-2.5 text-[11.5px] leading-6 doc-ink">{children}</div>
}
