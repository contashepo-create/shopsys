/**
 * قسم الشروحات (طلب المالك): شرح حرفي لكل شيء حسب النشاط المفعّل —
 * موضوعات النشاط أولاً ثم الموضوعات العامة، مع بحث فوري وفتح/طي لكل موضوع.
 * المحتوى نواة خالصة في core/guides.ts — الصفحة عرض فقط.
 */
import { useMemo, useState } from 'react'
import { BookOpenText, Search, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { getActivity } from '../../core/activities.ts'
import { guidesForActivity, searchGuides } from '../../core/guides.ts'
import { inputCls, EmptyState } from '../components/ui.tsx'

export function GuidesPage() {
  const { setup } = useAppStore()
  const activity = setup.activityId ? getActivity(setup.activityId) : null
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const topics = useMemo(() => searchGuides(guidesForActivity(setup.activityId), query), [setup.activityId, query])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up">
        <div>
          <div className="text-[15px] font-black flex items-center gap-2">
            <BookOpenText size={18} className="text-teal-500" /> الشروحات
            {activity && <span className="text-[12px] font-bold text-slate-400">— نشاط «{activity.nameAr}» {activity.icon}</span>}
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">شرح حرفي خطوة بخطوة لكل عملية — موضوعات نشاطك أولاً ثم القواعد العامة.</p>
        </div>
      </div>

      <div className="relative anim-up">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث في الشروحات… (مثال: تالف، توزيع حر، وردية)"
          className={`${inputCls} pr-9`}
        />
      </div>

      {topics.length === 0 ? (
        <EmptyState icon="🔍" title="لا نتائج" sub="جرّب كلمة أخرى — أو امسح البحث لعرض كل الموضوعات" />
      ) : (
        <div className="space-y-2">
          {topics.map((t) => {
            const expanded = open === t.id
            return (
              <div key={t.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden anim-up">
                <button
                  onClick={() => setOpen(expanded ? null : t.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-right hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-all"
                >
                  <span className="font-bold text-[13.5px] flex items-center gap-2">
                    <span className="text-[16px]">{t.icon}</span> {t.titleAr}
                  </span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div className="px-5 pb-4 space-y-2.5 anim-pop">
                    {t.paragraphsAr.map((p, i) => (
                      <p key={i} className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 pr-3 border-r-2 border-teal-500/30">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
