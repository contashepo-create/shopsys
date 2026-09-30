/**
 * دليل نشاطك (طلب المالك): «الشروحات تخص النشاط الحالي فقط، وشرح مفصل لكل قسم
 * داخله مع مثال لكل شيء — ولا تشرح نشاطاً داخل نشاط آخر».
 * ─────────────────────────────────────────────────────────────────────────────
 * الأقسام المعروضة = نفس أقسام قائمة التنقل بعد فلترتها بوحدات النشاط وخصائصه
 * وصلاحيات المستخدم، فلا يظهر شرح لشاشة لا يراها المستخدم أصلاً.
 * محتوى الشرح نواة خالصة في core/activityGuide.ts، والأمثلة تُملأ بعيّنة النشاط.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpenText, Search, ChevronDown, Target, ListOrdered, Calculator,
  Lightbulb, TriangleAlert, ArrowLeftCircle, CalendarClock, Compass, Sparkles,
} from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getActivity } from '../../core/activities.ts'
import { guidesForActivity, searchGuides, topicsForSetup } from '../../core/guides.ts'
import { screenGuideFor, guideMatches } from '../../core/activityGuide.ts'
import { playbookFor } from '../../core/activityPlaybook.ts'
import { labelFor } from '../../core/activityLabels.ts'
import { NAV_SECTIONS, SECTION_COLORS } from '../navCatalog.tsx'
import { effectivePermissionsFor, rolesWithOverrides, canAccessPath } from '../../core/permissions.ts'
import { inputCls, EmptyState, Btn } from '../components/ui.tsx'

interface GuideRow {
  path: string
  nameAr: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

export function GuidesPage() {
  const navigate = useNavigate()
  const { setup } = useAppStore()
  const { appUsers, currentUserId, roleOverrides, customRoles } = useDataStore()
  const activity = setup.activityId ? getActivity(setup.activityId) : null
  const playbook = playbookFor(setup.activityId)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [openTopic, setOpenTopic] = useState<string | null>(null)

  /** أقسام النشاط: نفس فلترة القائمة حرفياً (وحدات + خصائص + أنشطة + صلاحيات) */
  const sections = useMemo(() => {
    const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
    const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
    const built = NAV_SECTIONS
      .filter((sec) => (!sec.module || setup.modules.includes(sec.module)) && (!sec.accountingOnly || setup.accountingMode === 'full'))
      .map((sec) => ({
        id: sec.id,
        nameAr: labelFor(setup.activityId, sec.id, sec.nameAr),
        icon: sec.icon,
        color: SECTION_COLORS[sec.color] ?? SECTION_COLORS.slate,
        rows: sec.children
          .filter((c) => !c.module || setup.modules.includes(c.module))
          .filter((c) => !c.feature || setup.features.includes(c.feature))
          .filter((c) => !c.activities || c.activities.includes(setup.activityId ?? ''))
          .filter((c) => !c.hideForActivities || !c.hideForActivities.includes(setup.activityId ?? ''))
          .filter((c) => canAccessPath(c.path, perms))
          .map<GuideRow>((c) => ({ path: c.path, nameAr: labelFor(setup.activityId, `${sec.id}.${c.id}`, c.nameAr), icon: c.icon })),
      }))
      .filter((sec) => sec.rows.length > 0)
    return built
  }, [appUsers, currentUserId, roleOverrides, customRoles, setup.activityId, setup.modules, setup.features, setup.accountingMode])

  /** الشرح المفصّل لكل شاشة بعد ملء أمثلته بعيّنة النشاط + تطبيق البحث */
  const filtered = useMemo(() => {
    return sections
      .map((sec) => ({
        ...sec,
        rows: sec.rows
          .map((r) => ({ row: r, guide: screenGuideFor(r.path, setup.activityId) }))
          .filter((x) => guideMatches(x.guide, x.row.nameAr, query)),
      }))
      .filter((sec) => sec.rows.length > 0)
  }, [sections, setup.activityId, query])

  const screenCount = sections.reduce((n, s) => n + s.rows.length, 0)

  /** الموضوعات التفصيلية القديمة — تُصفّى على وحدات النشاط فلا يرى شرحاً لا يخصه */
  const topics = useMemo(
    () => searchGuides(topicsForSetup(guidesForActivity(setup.activityId), setup.modules, setup.activityId), query),
    [setup.activityId, setup.modules, query],
  )

  return (
    <div className="space-y-4" data-guide-activity={setup.activityId ?? 'general'}>
      <div className="flex items-start justify-between gap-3 anim-up">
        <div>
          <div className="text-[15px] font-black flex items-center gap-2">
            <BookOpenText size={18} className="text-teal-500" /> دليل نشاطك
            {activity && <span className="text-[12px] font-bold text-slate-400">— «{activity.nameAr}» {activity.icon}</span>}
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">
            شرح مفصّل لكل قسم تراه في قائمتك: الغرض، الخطوات، مثال بأرقام نشاطك، الأثر المحاسبي، وأخطاء شائعة.
          </p>
        </div>
        <span className="shrink-0 text-[11.5px] font-black px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/25" data-guide-count>
          {screenCount} قسماً مشروحاً
        </span>
      </div>

      {/* دورة العمل اليومية لهذا النشاط */}
      <div className="rounded-2xl border border-teal-500/25 bg-teal-500/[0.06] p-4 space-y-3 anim-up" data-guide-playbook>
        <div className="flex items-center gap-2 text-[13px] font-black text-teal-700 dark:text-teal-300">
          <Compass size={16} /> دورة عملك اليومية
        </div>
        <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{playbook.introAr}</p>
        <ol className="space-y-1.5">
          {playbook.dailyCycleAr.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-slate-700 dark:text-slate-200">
              <span className="shrink-0 w-5 h-5 rounded-full bg-teal-500 text-white text-[11px] font-black grid place-items-center mt-0.5">{i + 1}</span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <div className="pt-1 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[12px] font-black text-amber-600 dark:text-amber-400">
            <Sparkles size={14} /> ركّز على هذه النقاط في نشاطك
          </div>
          {playbook.focusAr.map((f, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 pr-3 border-r-2 border-amber-500/40">{f}</p>
          ))}
        </div>
      </div>

      <div className="relative anim-up">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث داخل دليلك… (مثال: جرد، تحصيل، هالك، ضريبة)"
          className={`${inputCls} pr-9`}
          data-guide-search
        />
      </div>

      {filtered.length === 0 && topics.length === 0 ? (
        <EmptyState icon="🔍" title="لا نتائج" sub="جرّب كلمة أخرى — أو امسح البحث لعرض كل أقسام نشاطك" />
      ) : (
        <div className="space-y-4">
          {filtered.map((sec) => {
            const SecIcon = sec.icon
            return (
              <div key={sec.id} className="space-y-2 anim-up" data-guide-section={sec.id}>
                <div className={`flex items-center gap-2 text-[13px] font-black ${sec.color.text}`}>
                  <span className={`w-7 h-7 rounded-xl grid place-items-center ${sec.color.bgSoft}`}><SecIcon size={15} /></span>
                  {sec.nameAr}
                  <span className="text-[11px] font-bold text-slate-400">({sec.rows.length})</span>
                </div>

                <div className="space-y-2">
                  {sec.rows.map(({ row, guide }) => {
                    const expanded = open === row.path
                    const RowIcon = row.icon
                    return (
                      <div
                        key={row.path}
                        data-guide-screen={row.path}
                        className={`rounded-2xl bg-white dark:bg-card-dark border overflow-hidden transition-all ${expanded ? sec.color.border : 'border-slate-200 dark:border-slate-800'}`}
                      >
                        <button
                          onClick={() => setOpen(expanded ? null : row.path)}
                          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-right hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-all"
                        >
                          <span className="font-bold text-[13px] flex items-center gap-2 min-w-0">
                            <RowIcon size={15} className={sec.color.text} />
                            <span className="truncate">{row.nameAr}</span>
                          </span>
                          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>

                        {expanded && guide && (
                          <div className="px-4 pb-4 space-y-3 anim-pop">
                            <Block icon={<Target size={13} />} title="الغرض" tone="text-teal-600 dark:text-teal-400">
                              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{guide.purposeAr}</p>
                              <p className="text-[12px] leading-relaxed text-slate-500 mt-1 flex items-start gap-1.5">
                                <CalendarClock size={13} className="mt-0.5 shrink-0" /> <span>متى تستخدمه: {guide.whenAr}</span>
                              </p>
                            </Block>

                            <Block icon={<ListOrdered size={13} />} title="خطوات العمل" tone="text-sky-600 dark:text-sky-400">
                              <ol className="space-y-1.5">
                                {guide.stepsAr.map((s, i) => (
                                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
                                    <span className="shrink-0 w-5 h-5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-black grid place-items-center mt-0.5">{i + 1}</span>
                                    <span className="leading-relaxed">{s}</span>
                                  </li>
                                ))}
                              </ol>
                            </Block>

                            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3" data-guide-example>
                              <div className="text-[12px] font-black text-emerald-700 dark:text-emerald-400 mb-1.5">مثال عملي من نشاطك</div>
                              {guide.exampleAr.map((line, i) => (
                                <p key={i} className="text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-200">• {line}</p>
                              ))}
                            </div>

                            <Block icon={<Calculator size={13} />} title="الأثر المحاسبي والمخزني" tone="text-violet-600 dark:text-violet-400">
                              {guide.effectAr.map((line, i) => (
                                <p key={i} className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">{line}</p>
                              ))}
                            </Block>

                            {guide.mistakesAr && guide.mistakesAr.length > 0 && (
                              <Block icon={<TriangleAlert size={13} />} title="أخطاء شائعة تجنّبها" tone="text-rose-600 dark:text-rose-400">
                                {guide.mistakesAr.map((line, i) => (
                                  <p key={i} className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">• {line}</p>
                                ))}
                              </Block>
                            )}

                            {guide.tipsAr && guide.tipsAr.length > 0 && (
                              <Block icon={<Lightbulb size={13} />} title="نصائح" tone="text-amber-600 dark:text-amber-400">
                                {guide.tipsAr.map((line, i) => (
                                  <p key={i} className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">• {line}</p>
                                ))}
                              </Block>
                            )}

                            <div data-guide-open={row.path}>
                              <Btn variant="soft" onClick={() => navigate(row.path)}>
                                <ArrowLeftCircle size={14} /> افتح الشاشة الآن
                              </Btn>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {topics.length > 0 && (
            <div className="space-y-2 anim-up" data-guide-topics>
              <div className="flex items-center gap-2 text-[13px] font-black text-slate-600 dark:text-slate-300">
                <BookOpenText size={15} /> شروحات تفصيلية إضافية تخص نشاطك
              </div>
              {topics.map((t) => {
                const expanded = openTopic === t.id
                return (
                  <div key={t.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <button
                      onClick={() => setOpenTopic(expanded ? null : t.id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-right hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-all"
                    >
                      <span className="font-bold text-[13px] flex items-center gap-2">
                        <span className="text-[15px]">{t.icon}</span> {t.titleAr}
                      </span>
                      <ChevronDown size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="px-5 pb-4 space-y-2.5 anim-pop">
                        {t.paragraphsAr.map((p, i) => (
                          <p key={i} className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 pr-3 border-r-2 border-teal-500/30">{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Block({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`text-[12px] font-black mb-1 flex items-center gap-1.5 ${tone}`}>{icon} {title}</div>
      <div className="pr-3 border-r-2 border-slate-200 dark:border-slate-800 space-y-1">{children}</div>
    </div>
  )
}
