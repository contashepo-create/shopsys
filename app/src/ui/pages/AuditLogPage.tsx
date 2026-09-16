/**
 * سجل النشاطات (طلب المالك) — «من قام بكل شيء ومتى»:
 * يُبنى تلقائياً من كل كتابة في قاعدة البيانات (قيود، إضافات، حذف، تعديلات فواتير).
 * يظهر فقط لحساب المالك — المستخدم الفرعي يرى شاشة قفل بشرح واضح.
 */
import { useMemo, useState } from 'react'
import { ScrollText, Lock, Search } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { inputCls, EmptyState } from '../components/ui.tsx'

const KIND_META: Record<string, { icon: string; label: string; cls: string }> = {
  journal: { icon: '📒', label: 'قيد', cls: 'bg-sky-500/10 text-sky-600' },
  add: { icon: '➕', label: 'إضافة', cls: 'bg-emerald-500/10 text-emerald-600' },
  remove: { icon: '🗑️', label: 'حذف', cls: 'bg-rose-500/10 text-rose-600' },
  edit: { icon: '✏️', label: 'تعديل', cls: 'bg-amber-500/10 text-amber-600' },
  auth: { icon: '🔑', label: 'دخول', cls: 'bg-violet-500/10 text-violet-600' },
  system: { icon: '⚙️', label: 'نظام', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
}

export function AuditLogPage() {
  const { auditLog, appUsers, currentUserId } = useDataStore()
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')

  // المالك فقط (طلب المالك): currentUserId=null = المالك الافتراضي، أو مستخدم بدور owner
  const activeUser = appUsers.find((u) => u.id === currentUserId)
  const isOwner = currentUserId == null || activeUser?.roleId === 'owner'

  const users = useMemo(() => [...new Set(auditLog.map((e) => e.user))], [auditLog])

  const filtered = useMemo(() => {
    let list = [...auditLog].reverse()
    if (kindFilter) list = list.filter((e) => e.kind === kindFilter)
    if (userFilter) list = list.filter((e) => e.user === userFilter)
    const q = query.trim()
    if (q) list = list.filter((e) => e.title.includes(q) || (e.refKey ?? '').includes(q))
    return list.slice(0, 500)
  }, [auditLog, kindFilter, userFilter, query])

  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-10 text-center space-y-3">
          <Lock className="w-12 h-12 mx-auto text-slate-300" />
          <h1 className="text-xl font-black">سجل النشاطات — للمالك فقط</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
            هذا السجل يعرض كل ما قام به كل مستخدم ومتى — ولحماية الخصوصية والرقابة
            لا يطلع عليه إلا حساب مالك المحل/الشركة.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في الأحداث…" className={inputCls + ' !pr-9'} />
        </div>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={inputCls + ' !w-40'}>
          <option value="">كل الأنواع</option>
          {Object.entries(KIND_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={inputCls + ' !w-44'}>
          <option value="">كل المستخدمين</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="text-[11px] text-slate-400 font-bold">{auditLog.length} حدثاً محفوظاً (أحدث 3000)</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📜" title="لا أحداث بعد" sub="كل عملية بيع وشراء وإضافة وحذف وتعديل ستُسجل هنا تلقائياً باسم من قام بها ووقتها" />
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 text-[12px] font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <ScrollText size={14} /> سجل النشاطات {filtered.length < auditLog.length && <span className="text-slate-400 font-bold">(معروض {filtered.length})</span>}
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <th className="px-4 py-2 w-36">الوقت</th>
                <th className="px-4 py-2 w-28">المستخدم</th>
                <th className="px-4 py-2 w-20">النوع</th>
                <th className="px-4 py-2">الحدث</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const meta = KIND_META[e.kind] ?? KIND_META.system
                return (
                  <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2 text-slate-400 font-mono text-[11px]" dir="ltr">{e.at.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-4 py-2 font-bold text-slate-600 dark:text-slate-300">{e.user}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${meta.cls}`}>{meta.icon} {meta.label}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{e.title}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
