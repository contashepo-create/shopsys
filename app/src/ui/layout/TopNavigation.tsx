import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { NAV_SECTIONS } from '../navCatalog.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { effectivePermissionsFor, rolesWithOverrides, canAccessPath } from '../../core/permissions.ts'
import { labelFor } from '../../core/activityLabels.ts'

export function TopNavigation() {
  const location = useLocation()
  const { setup } = useAppStore()
  const [open, setOpen] = useState<string | null>(null)
  const { appUsers, currentUserId, roleOverrides, customRoles } = useDataStore()
  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
  const sections = NAV_SECTIONS.filter((sec) => (!sec.module || setup.modules.includes(sec.module)) && (!sec.accountingOnly || setup.accountingMode === 'full')).map((sec) => ({
    ...sec,
    nameAr: labelFor(setup.activityId, sec.id, sec.nameAr),
    children: sec.children.filter((c) => !c.module || setup.modules.includes(c.module)).filter((c) => !c.feature || setup.features.includes(c.feature)).filter((c) => !c.activities || c.activities.includes(setup.activityId ?? '')).filter((c) => !c.hideForActivities || !c.hideForActivities.includes(setup.activityId ?? '')).filter((c) => canAccessPath(c.path, perms)).map((c) => ({ ...c, nameAr: labelFor(setup.activityId, `${sec.id}.${c.id}`, c.nameAr) })),
  })).filter((sec) => sec.children.length)

  return <nav className="sticky top-0 z-40 flex items-center gap-1 px-3 py-2 border-b bg-white/95 dark:bg-card-dark/95 backdrop-blur flex-wrap" onMouseLeave={()=>setOpen(null)}>
    <img src="/app-icon.png?v=3" className="w-8 h-8 rounded-lg ml-2" alt="TAHAKAM ERP"/>
    {sections.map((sec)=><div key={sec.id} className="relative shrink-0">
      <button onClick={()=>setOpen(open===sec.id?null:sec.id)} className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold ${sec.children.some(c=>c.path===location.pathname)?'bg-brand-500/10 text-brand-700':'hover:bg-slate-100 dark:hover:bg-slate-800'}`}><sec.icon size={15}/>{sec.nameAr}<ChevronDown size={12}/></button>
      {open===sec.id&&<div className="absolute right-0 mt-1 min-w-56 max-h-[70vh] overflow-y-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1.5">{sec.children.map(child=><NavLink key={child.id} to={child.path} onClick={()=>setOpen(null)} className={({isActive})=>`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${isActive?'bg-brand-500/10 text-brand-700 font-bold':'hover:bg-slate-100 dark:hover:bg-slate-800'}`}><child.icon size={14}/>{child.nameAr}</NavLink>)}</div>}
    </div>)}
  </nav>
}
