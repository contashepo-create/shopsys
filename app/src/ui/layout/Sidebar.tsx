/**
 * الشريط الجانبي — على اليمين (RTL)، كل قسم رئيسي بلونه مع فروعه،
 * تأثيرات هوفر وانتقالات ناعمة (طلبات المالك).
 */
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { NAV_SECTIONS, SECTION_COLORS } from '../navCatalog.tsx'
import { useAppStore } from '../../stores/app.store.ts'

export function Sidebar() {
  const location = useLocation()
  const { setup } = useAppStore()
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    // القسم الحاوي للمسار الحالي يبدأ مفتوحاً
    const s = new Set<string>(['dashboard'])
    for (const sec of NAV_SECTIONS) {
      if (sec.children.some((c) => c.path === location.pathname)) s.add(sec.id)
    }
    return s
  })

  // إخفاء الأقسام والفروع حسب الوحدات المفعلة للنشاط (طلب المالك):
  // القسم كله يختفي لو وحدته مطفأة، والفرع المرتبط بوحدة يختفي وحده داخل قسم عام
  const visibleSections = NAV_SECTIONS
    .filter((sec) => {
      if (sec.module && !setup.modules.includes(sec.module)) return false
      if (sec.accountingOnly && setup.accountingMode !== 'full') return false
      return true
    })
    .map((sec) => ({
      ...sec,
      children: sec.children.filter((c) => !c.module || setup.modules.includes(c.module)),
    }))
    .filter((sec) => sec.children.length > 0)

  const toggle = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <aside className="w-72 shrink-0 h-screen sticky top-0 flex flex-col border-l border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-card-dark/80 glass">
      {/* الشعار */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <img src="/app-icon.png" alt="قيود" className="w-10 h-10 rounded-xl shadow-lg shadow-brand-500/30 object-cover" />
        <div>
          <div className="font-extrabold text-slate-800 dark:text-white leading-tight">قيود</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[150px]">
            {setup.shopName || 'نظام المحاسبة والكاشير'}
          </div>
        </div>
      </div>

      {/* الأقسام */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {visibleSections.map((sec, i) => {
          const colors = SECTION_COLORS[sec.color]
          const isOpen = openSections.has(sec.id)
          const hasActive = sec.children.some((c) => c.path === location.pathname)
          const single = sec.children.length === 1

          if (single) {
            const child = sec.children[0]
            return (
              <NavLink
                key={sec.id}
                to={child.path}
                style={{ animationDelay: `${i * 35}ms` }}
                className={({ isActive }) =>
                  `anim-up group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                    isActive
                      ? `${colors.activeBg} ${colors.activeText} font-bold shadow-sm`
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:translate-x-[-3px]'
                  }`
                }
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${colors.bgSoft} ${colors.text}`}>
                  <sec.icon size={17} />
                </span>
                <span className="text-sm">{sec.nameAr}</span>
              </NavLink>
            )
          }

          return (
            <div key={sec.id} style={{ animationDelay: `${i * 35}ms` }} className="anim-up">
              {/* رأس القسم الملون */}
              <button
                onClick={() => toggle(sec.id)}
                className={`w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                  hasActive
                    ? `${colors.activeBg} ${colors.activeText} font-bold`
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110 shadow-sm ${colors.bgSoft} ${colors.text}`}>
                  <sec.icon size={17} />
                </span>
                <span className="text-sm flex-1 text-right">{sec.nameAr}</span>
                <ChevronDown
                  size={15}
                  className={`transition-transform duration-300 opacity-50 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* الفروع بنفس لون القسم */}
              <div
                className={`grid transition-all duration-300 ease-in-out ${
                  isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div className={`mr-5 my-1 pr-3 border-r-2 ${colors.border} space-y-0.5`}>
                    {sec.children.map((child) => (
                      <NavLink
                        key={child.id}
                        to={child.path}
                        className={({ isActive }) =>
                          `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-200 ${
                            isActive
                              ? `${colors.activeBg} ${colors.activeText} font-bold`
                              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:translate-x-[-3px]'
                          }`
                        }
                      >
                        <span className={`w-1.5 h-1.5 rounded-full transition-all duration-200 group-hover:scale-150 ${colors.dot}`} />
                        <child.icon size={15} className="opacity-70" />
                        <span>{child.nameAr}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* الإصدار */}
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-600 flex items-center justify-between">
        <span>قيود v0.1.0</span>
        <span className="px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 font-bold">المرحلة 0</span>
      </div>
    </aside>
  )
}
