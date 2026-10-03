/**
 * شريط القوائم العلوي (Menu Bar) — نمط برامج ويندوز وVisual Studio Code.
 * (طلب المالك: يكون هو الافتراضي، وفي نهايته زر صغير يحوّله إلى شريط جانبي)
 *
 * السلوك الكلاسيكي للقوائم المنسدلة مطبَّق بالكامل:
 *  • النقر يفتح القائمة، وبعد فتحها يكفي المرور بالفأرة لتبديل القوائم.
 *  • الأسهم يمين/يسار تتنقل بين القوائم، وأعلى/أسفل داخل بنودها، وEnter يفتح البند.
 *  • Escape أو النقر خارجها يغلقها، والتركيز يعود إلى عنوان القائمة.
 *  • القائمة تُركَّب على body عبر OverlayPortal بطبقة layer-picker فلا يحجبها أي عنصر.
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, PanelRight, Check, MoreHorizontal } from 'lucide-react'
import { NAV_SECTIONS, SECTION_COLORS } from '../navCatalog.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { pendingForUser, canApprove } from '../../core/approvals.ts'
import { effectivePermissionsFor, rolesWithOverrides, canAccessPath } from '../../core/permissions.ts'
import { labelFor } from '../../core/activityLabels.ts'
import { guardNavigation, OverlayPortal, useToast } from '../components/ui.tsx'

/** موضع القائمة تحت عنوانها مباشرة — محاذاة يمينية (RTL) مع انقلاب عند ضيق الشاشة */
function menuStyleFor(anchor: HTMLElement | null): CSSProperties {
  if (!anchor || typeof window === 'undefined') return { position: 'fixed', top: 0, right: 0 }
  const rect = anchor.getBoundingClientRect()
  const viewportHeight = window.innerHeight || 768
  const space = Math.max(180, viewportHeight - rect.bottom - 12)
  return {
    position: 'fixed',
    top: rect.bottom + 2,
    right: Math.max(8, (window.innerWidth || 1024) - rect.right),
    maxHeight: Math.min(space, Math.round(viewportHeight * 0.75)),
  }
}

export function MenuBar({ onSwitchToSidebar }: { onSwitchToSidebar: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { setup } = useAppStore()
  const { appUsers, currentUserId, roleOverrides, customRoles } = useDataStore()
  const docApprovals = useDataStore((state) => state.docApprovals)
  const approvalSettings = useAppStore((state) => state.approvals)
  const [openId, setOpenId] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [, forceReposition] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const titleRefs = useRef(new Map<string, HTMLButtonElement>())
  /* بلاغ المالك: «في الشاشة الصغيرة أقسام تختفي من الشريط».
     لا نخفي شيئاً: ما لا يتسع ينتقل إلى قائمة «المزيد» فيبقى كل قسم على بُعد نقرة. */
  const stripRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const widthsRef = useRef(new Map<string, number>())
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY)

  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
  const sections = NAV_SECTIONS
    .filter((sec) => (!sec.module || setup.modules.includes(sec.module)) && (!sec.accountingOnly || setup.accountingMode === 'full'))
    .map((sec) => ({
      ...sec,
      nameAr: labelFor(setup.activityId, sec.id, sec.nameAr),
      children: sec.children
        .filter((c) => !c.module || setup.modules.includes(c.module))
        .filter((c) => !c.feature || setup.features.includes(c.feature))
        .filter((c) => !c.activities || c.activities.includes(setup.activityId ?? ''))
        .filter((c) => !c.hideForActivities || !c.hideForActivities.includes(setup.activityId ?? ''))
        .filter((c) => canAccessPath(c.path, perms))
        .map((c) => ({ ...c, nameAr: labelFor(setup.activityId, `${sec.id}.${c.id}`, c.nameAr) })),
    }))
    .filter((sec) => sec.children.length > 0)

  /* شارة «طلبات الاعتماد المعلّقة» للمخوَّل (طلب المالك) + إشعار فوري عند
     وصول مستند جديد بانتظاره: يدخل نظام الاعتماد ويعتمد ما أدخله موظف آخر. */
  const toast = useToast()
  const canApproveDocs = canApprove({ settings: approvalSettings, userId: currentUserId, userPermissions: perms })
  const pendingApprovals = canApproveDocs ? pendingForUser(docApprovals, currentUserId, perms.has('docs.approve')).length : 0
  const pendingApprovalsRef = useRef(pendingApprovals)
  const approvalsToastReady = useRef(false)
  useEffect(() => {
    if (!approvalsToastReady.current) { approvalsToastReady.current = true; pendingApprovalsRef.current = pendingApprovals; return }
    if (pendingApprovals > pendingApprovalsRef.current) {
      toast.show(`📥 ${pendingApprovals} مستند بانتظار اعتمادك — من «طلبات الاعتماد» في الشريط العلوي`)
    }
    pendingApprovalsRef.current = pendingApprovals
  }, [pendingApprovals, toast])

  const sectionIds = sections.map((sec) => sec.id).join('|')
  /* قياس عرض كل عنوان مرة واحدة (العناوين ثابتة)، ثم حساب كم عنواناً يتسع فعلاً.
     العناوين الزائدة تنتقل إلى «المزيد» — لا يختفي قسم أبداً مهما صغرت الشاشة. */
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return
    const GAP = 2
    const measure = () => {
      for (const [id, node] of titleRefs.current) {
        const w = node.offsetWidth
        if (w > 0) widthsRef.current.set(id, w)
      }
      const known = sections.filter((sec) => widthsRef.current.has(sec.id))
      if (known.length < sections.length) { setVisibleCount(Number.POSITIVE_INFINITY); return }
      const total = sections.reduce((sum, sec) => sum + (widthsRef.current.get(sec.id) ?? 0) + GAP, 0)
      const available = strip.clientWidth
      if (total <= available) { setVisibleCount(Number.POSITIVE_INFINITY); return }
      const moreWidth = (moreRef.current?.offsetWidth ?? 0) || 74
      let used = moreWidth + GAP
      let fit = 0
      for (const sec of sections) {
        used += (widthsRef.current.get(sec.id) ?? 0) + GAP
        if (used > available) break
        fit += 1
      }
      setVisibleCount(Math.max(1, fit))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [sectionIds, sections])

  const visibleSections = Number.isFinite(visibleCount) ? sections.slice(0, visibleCount) : sections
  const hiddenSections = Number.isFinite(visibleCount) ? sections.slice(visibleCount) : []
  const openSection = sections.find((sec) => sec.id === openId) ?? null
  const overflowOpen = openId === '__more__'

  // إغلاق عند النقر خارج الشريط أو القائمة، وإعادة القياس عند التمرير/تغيير المقاس
  useEffect(() => {
    if (!openId) return
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (barRef.current?.contains(target)) return
      if ((target as HTMLElement)?.closest?.('[data-menubar-menu]')) return
      setOpenId(null)
    }
    const reposition = () => forceReposition((n) => n + 1)
    document.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [openId])

  const focusTitle = (id: string) => titleRefs.current.get(id)?.focus()
  const openMenu = (id: string, el?: HTMLElement | null) => {
    setOpenId(id)
    setActiveIndex(0)
    setAnchorEl(el ?? titleRefs.current.get(id) ?? null)
  }
  const closeMenu = (refocus = true) => {
    const current = openId
    setOpenId(null)
    if (refocus && current) focusTitle(current)
  }
  /** تنقل بين عناوين القوائم — في RTL السهم الأيسر يتقدم للعنوان التالي */
  const stepSection = (delta: number) => {
    if (sections.length === 0) return
    const current = sections.findIndex((sec) => sec.id === openId)
    const next = sections[(current + delta + sections.length) % sections.length]
    openMenu(next.id, titleRefs.current.get(next.id))
    focusTitle(next.id)
  }
  const go = (path: string) => {
    setOpenId(null)
    if (!guardNavigation(() => navigate(path))) navigate(path)
  }
  const onItemClick = (event: ReactMouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    setOpenId(null)
    if (guardNavigation(() => navigate(path))) event.preventDefault()
  }

  const handleBarKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu() }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepSection(1) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepSection(-1) }
    else if (event.key === 'ArrowDown' && openSection) {
      event.preventDefault()
      setActiveIndex((index) => Math.min(openSection.children.length - 1, index + 1))
    } else if (event.key === 'ArrowUp' && openSection) {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && openSection) {
      const child = openSection.children[activeIndex]
      if (child) { event.preventDefault(); go(child.path) }
    }
  }

  return (
    <div
      ref={barRef}
      onKeyDown={handleBarKey}
      role="menubar"
      aria-label="شريط القوائم الرئيسي"
      className="app-menubar sticky top-0 z-40 flex items-center gap-0.5 border-b border-slate-200 bg-white/95 px-2 py-0.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <img src="/app-icon.png?v=3" className="ms-1 me-1.5 h-5 w-5 shrink-0 rounded" alt="TAHAKAM ERP" />

      <div ref={stripRef} className="menubar-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {visibleSections.map((sec) => {
          const colors = SECTION_COLORS[sec.color]
          const isOpen = openId === sec.id
          const hasActive = sec.children.some((child) => child.path === location.pathname)
          return (
            <button
              key={sec.id}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              data-menubar-title={sec.id}
              ref={(node) => { if (node) titleRefs.current.set(sec.id, node); else titleRefs.current.delete(sec.id) }}
              onClick={(event) => (isOpen ? closeMenu(false) : openMenu(sec.id, event.currentTarget))}
              // بعد فتح أي قائمة يكفي المرور بالفأرة لتبديلها — سلوك شريط قوائم ويندوز
              onMouseEnter={(event) => { if (openId && openId !== sec.id) openMenu(sec.id, event.currentTarget) }}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                isOpen ? 'bg-brand-600 text-white'
                  : hasActive ? `${colors.activeBg} ${colors.activeText}`
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <sec.icon size={14} className={isOpen || hasActive ? '' : colors.text} />
              {sec.nameAr}
              <ChevronDown size={11} className="opacity-60" />
            </button>
          )
        })}
        {pendingApprovals > 0 && (
          <button type="button" className="menubar-approvals" data-approvals-alert title={`${pendingApprovals} مستند بانتظار اعتمادك`}
            onClick={() => go('/settings/approvals')}>
            ⏳ اعتماد <span>{pendingApprovals}</span>
          </button>
        )}
        {hiddenSections.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            data-menubar-more="true"
            title={`أقسام إضافية: ${hiddenSections.map((sec) => sec.nameAr).join('، ')}`}
            onClick={(event) => (overflowOpen ? closeMenu(false) : openMenu('__more__', event.currentTarget))}
            onMouseEnter={(event) => { if (openId && !overflowOpen) openMenu('__more__', event.currentTarget) }}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1.5 text-[12.5px] font-bold transition-colors ${
              overflowOpen ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <MoreHorizontal size={14} />
            المزيد
            <span className="rounded bg-slate-200 px-1 font-mono text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">{hiddenSections.length}</span>
          </button>
        )}
      </div>

      <span className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 sm:block dark:bg-slate-700" />
      <span className="hidden max-w-[12rem] shrink-0 truncate text-[11px] text-slate-400 lg:block">{setup.shopName || 'تَحَكَّم في إدارة أعمالك'}</span>
      {/* زر التحويل إلى الشريط الجانبي — في نهاية الشريط (يساره في RTL) */}
      <button
        type="button"
        onClick={onSwitchToSidebar}
        title="تحويل التنقل إلى شريط جانبي"
        aria-label="تحويل التنقل إلى شريط جانبي"
        data-switch-to-sidebar="true"
        className="ms-1 flex shrink-0 items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[10.5px] font-bold text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400"
      >
        <PanelRight size={13} />
        <span className="hidden sm:inline">شريط جانبي</span>
      </button>

      {overflowOpen && hiddenSections.length > 0 && (
        <OverlayPortal>
          <div
            data-menubar-menu="__more__"
            role="menu"
            aria-label="أقسام إضافية"
            style={menuStyleFor(anchorEl)}
            className="layer-picker min-w-[16rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            dir="rtl"
          >
            {hiddenSections.map((sec) => (
              <div key={sec.id} data-menubar-more-section={sec.id}>
                <div className={`mb-1 mt-1 flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-black ${SECTION_COLORS[sec.color].bgSoft} ${SECTION_COLORS[sec.color].text}`}>
                  <sec.icon size={12} /> {sec.nameAr}
                  <span className="ms-auto font-mono opacity-60">{sec.children.length}</span>
                </div>
                {sec.children.map((child) => (
                  <NavLink
                    key={child.id}
                    to={child.path}
                    role="menuitem"
                    data-menubar-item={child.id}
                    onClick={(event) => onItemClick(event, child.path)}
                    className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-[12px] transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      child.path === location.pathname ? 'font-bold' : ''
                    }`}
                  >
                    <child.icon size={14} className="shrink-0 opacity-70" />
                    <span className="flex-1 truncate">{child.nameAr}</span>
                    {child.path === location.pathname && <Check size={13} className="shrink-0 text-emerald-500" />}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </OverlayPortal>
      )}

      {openSection && (
        <OverlayPortal>
          <div
            data-menubar-menu={openSection.id}
            role="menu"
            aria-label={openSection.nameAr}
            style={menuStyleFor(anchorEl)}
            className="layer-picker min-w-[15rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            dir="rtl"
          >
            <div className={`mb-1 flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-black ${SECTION_COLORS[openSection.color].bgSoft} ${SECTION_COLORS[openSection.color].text}`}>
              <openSection.icon size={12} /> {openSection.nameAr}
              <span className="ms-auto font-mono opacity-60">{openSection.children.length}</span>
            </div>
            {openSection.children.map((child, index) => {
              const isCurrent = child.path === location.pathname
              return (
                <NavLink
                  key={child.id}
                  to={child.path}
                  role="menuitem"
                  data-menubar-item={child.id}
                  onClick={(event) => onItemClick(event, child.path)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-[12px] transition-colors ${
                    index === activeIndex ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                  } ${isCurrent ? 'font-bold' : ''}`}
                >
                  <child.icon size={14} className="shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{child.nameAr}</span>
                  {isCurrent && <Check size={13} className="shrink-0 text-emerald-500" />}
                </NavLink>
              )
            })}
          </div>
        </OverlayPortal>
      )}
    </div>
  )
}
