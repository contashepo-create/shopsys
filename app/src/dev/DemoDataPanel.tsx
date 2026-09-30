/**
 * لوحة «بيانات تجريبية» — وضع التطوير فقط (البند ⑲ من دفعة المالك ⑩ي).
 *
 * تعرض الأنشطة الموجودة في قاعدة البيانات الحقيقية `app/demo-db/demo.sqlite`،
 * وتتيح: تحميل نشاط كامل للتجربة · التنقل إلى نشاط آخر · حفظ التعديلات الحالية
 * داخل القاعدة · إعادة الضبط من ملف البذور. اللوحة نافذة عادية: لا تُعتّم الخلفية
 * ولا تعزلها، ولها زر إغلاق وتستجيب لـEscape (قاعدة المالك الثابتة).
 *
 * لا تُضمَّن في نسخة الإنتاج: كل الملف محروس بـ import.meta.env.DEV.
 */
import { useEffect, useState } from 'react'
import { Database, RefreshCcw, Save, X, FlaskConical } from 'lucide-react'
import { fetchDemoActivities, loadDemoActivity, saveDemoActivity, resetDemoDatabase, switchDemoActivity, DEMO_PENDING_KEY, type DemoActivitySummary } from './demoDatabase.ts'

/** حارس التحميل مرة واحدة لكل إقلاع صفحة (StrictMode في DEV يشغّل التأثيرات مرتين) */
let pendingLoadStarted = false

export function DemoDataPanel() {
  /* نشاط مُعلَّق من قبل إعادة التحميل النظيف — يُقرأ مرة واحدة عند أول رسم */
  const [pending] = useState(() => {
    if (!import.meta.env.DEV) return ''
    const value = localStorage.getItem(DEMO_PENDING_KEY) ?? ''
    if (value) localStorage.removeItem(DEMO_PENDING_KEY)
    return value
  })
  const [open, setOpen] = useState(!!pending)
  const [activities, setActivities] = useState<DemoActivitySummary[]>([])
  const [dbPath, setDbPath] = useState('')
  const [busy, setBusy] = useState(pending)
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState(pending)

  /* استكمال التنقل بين الأنشطة بعد إعادة التحميل النظيف */
  useEffect(() => {
    if (!pending || pendingLoadStarted) return
    pendingLoadStarted = true
    loadDemoActivity(pending)
      .then((result) => {
        setCurrent(pending)
        setNote(`تم تحميل النشاط: ${result.items} صنفاً · ${result.purchases} فاتورة شراء · ${result.sales} فاتورة بيع`
          + ` · ${result.employees} موظفاً · ${result.attendance} بصمة حضور · ${result.leaves} إجازة · ${result.payrollMonths} مسير رواتب · ${result.quotations} عرض سعر · ${result.purchaseOrders} أمر شراء · ${result.wastage} هالك · ${result.subContracts} باطن · ${result.projectExtracts} مستخلص · ${result.equipment} معدة · ${result.rentals} عقد إيجار.`
          + (result.skipped.length ? ` — تخطّينا: ${result.skipped.join(' | ')}` : ''))
      })
      .catch((error: Error) => setNote(error.message))
      .finally(() => setBusy(''))
  }, [pending])

  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])

  useEffect(() => {
    if (!open) return
    fetchDemoActivities()
      .then((result) => { setActivities(result.activities); setDbPath(result.path) })
      .catch((error: Error) => setNote(error.message))
  }, [open])

  const run = async (label: string, job: () => Promise<string>) => {
    setBusy(label); setNote('')
    try { setNote(await job()) } catch (error) { setNote(`تعذّر التنفيذ: ${(error as Error).message}`) } finally { setBusy('') }
  }

  if (!import.meta.env.DEV) return null

  return (
    <>
      <button
        type="button"
        data-demo-db-toggle
        onClick={() => setOpen((value) => !value)}
        title="بيانات تجريبية (وضع التطوير فقط)"
        className="fixed bottom-3 start-3 z-[860] flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-800 shadow-lg hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
      >
        <FlaskConical size={13} /> بيانات تجريبية
      </button>

      {open && (
        <section
          data-demo-db-panel
          dir="rtl"
          role="dialog"
          aria-label="قاعدة البيانات التجريبية"
          className="fixed bottom-14 start-3 z-[861] w-[min(94vw,30rem)] rounded-2xl border border-amber-300 bg-white p-3 shadow-2xl dark:border-amber-700 dark:bg-card-dark"
        >
          <header className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[12px] font-black text-amber-800 dark:text-amber-200">
              <Database size={14} /> قاعدة بيانات تجريبية — وضع التطوير فقط
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" data-demo-db-close className="rounded-lg p-1 hover:bg-slate-500/10"><X size={14} /></button>
          </header>

          <p className="mb-2 text-[10px] leading-5 text-slate-500">
            ملف SQLite حقيقي يعيش مع الكود: <span dir="ltr" className="font-mono">{dbPath || 'app/demo-db/demo.sqlite'}</span> — عدّله بأي أداة SQLite أو من هنا.
            لكل نشاط بياناته (أصناف · عملاء · موردون · مخازن · فروع · بنوك وخزائن ومحافظ وماكينة دفع · فواتير بيع وشراء).
          </p>

          <div className="max-h-64 space-y-1.5 overflow-auto">
            {activities.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-[11px] text-slate-400">لا توجد أنشطة — شغّل <span dir="ltr" className="font-mono">npm run demo:build</span></div>}
            {activities.map((activity) => (
              <div key={activity.id} data-demo-activity={activity.id} className={`rounded-xl border p-2 ${current === activity.id ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[12px]">{activity.name_ar}</b>
                  <button
                    type="button"
                    data-demo-load={activity.id}
                    disabled={!!busy}
                    onClick={() => {
                      // التنقل إلى نشاط آخر يمسح بيانات النشاط السابق أولاً
                      if (current && current !== activity.id) { switchDemoActivity(activity.id); return }
                      void run(activity.id, async () => {
                        const result = await loadDemoActivity(activity.id)
                        setCurrent(activity.id)
                        return `تم تحميل «${activity.name_ar}»: ${result.items} صنفاً · ${result.purchases} فاتورة شراء · ${result.sales} فاتورة بيع`
                          + ` · ${result.employees} موظفاً · ${result.attendance} بصمة · ${result.payrollMonths} مسير · ${result.quotations} عرض · ${result.purchaseOrders} أمر · ${result.wastage} هالك · ${result.rentals} إيجار · ${result.projectExtracts} مستخلص.`
                          + (result.skipped.length ? ` — تخطّينا: ${result.skipped.join(' | ')}` : '')
                      })
                    }}
                    className="rounded-lg bg-brand-600 px-2 py-1 text-[10px] font-black text-white disabled:opacity-40"
                  >
                    {busy === activity.id ? '…يحمّل' : current === activity.id ? 'إعادة التحميل' : 'جرّب هذا النشاط'}
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9.5px] text-slate-500">
                  <span>{activity.items} صنف</span>·<span>{activity.customers} عميل</span>·<span>{activity.suppliers} مورد</span>
                  ·<span>{activity.warehouses} مخزن</span>·<span>{activity.branches} فرع</span>
                  ·<span>{activity.treasuries} خزينة/بنك/محفظة</span>·<span>{activity.terminals} ماكينة دفع</span>
                  ·<span>{activity.sales} بيع</span>·<span>{activity.purchases} شراء</span>·<span>{activity.employees} موظف</span>·<span>{activity.quotations} عرض</span>·<span>{activity.purchaseOrders} أمر</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-demo-save
              disabled={!current || !!busy}
              onClick={() => run('save', async () => { await saveDemoActivity(current); return 'حُفظت البيانات الحالية داخل قاعدة البيانات التجريبية.' })}
              className="flex items-center gap-1 rounded-lg border border-emerald-300 px-2 py-1 text-[10px] font-bold text-emerald-700 disabled:opacity-40 dark:border-emerald-700 dark:text-emerald-300"
            ><Save size={12} /> حفظ التعديلات في القاعدة</button>
            <button
              type="button"
              data-demo-reset
              disabled={!!busy}
              onClick={() => run('reset', async () => {
                await resetDemoDatabase()
                const result = await fetchDemoActivities()
                setActivities(result.activities)
                return 'أُعيد بناء القاعدة من ملف البذور.'
              })}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
            ><RefreshCcw size={12} /> إعادة الضبط</button>
          </div>

          {note && <p data-demo-note className="mt-2 rounded-lg bg-slate-100 p-2 text-[10.5px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">{note}</p>}
        </section>
      )}
    </>
  )
}
