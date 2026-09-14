/**
 * النسخ الاحتياطي (المرحلة 5) — تنزيل نسخة كاملة ببصمة تحقق،
 * واستعادة بمعاينة محتوى النسخة وتأكيد صريح (يستبدل كل البيانات الحالية).
 * نفس صيغة الملف ستُستخدم لاحقاً للنسخ اليومي عبر بوت التليجرام.
 */
import { useRef, useState } from 'react'
import { DatabaseBackup, Download, Upload, AlertTriangle, CheckCircle2, FileJson } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { buildBackup, parseBackup, summarizeBackup, backupFileName, type BackupSummary } from '../../core/backup.ts'
import { Btn, useToast } from '../components/ui.tsx'

const DATA_VERSION = 6 // إصدار persist لمخزن shopsys-data

export function BackupPage() {
  const { setup } = useAppStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ raw: string; summary: BackupSummary } | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const download = () => {
    try {
      // نقرأ الخام من localStorage — نفس ما يحفظه zustand persist بالضبط
      const appRaw = localStorage.getItem('shopsys-app')
      const storeRaw = localStorage.getItem('shopsys-data')
      if (!storeRaw) return toast.show('لا بيانات للنسخ بعد', 'error')
      const backup = buildBackup({
        appState: appRaw ? JSON.parse(appRaw) : null,
        storeState: JSON.parse(storeRaw),
        appDataVersion: DATA_VERSION,
        shopName: setup.shopName,
      })
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = backupFileName(setup.shopName, backup.createdAt)
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 3000)
      toast.show('نُزّلت النسخة الاحتياطية — احفظها في مكان آمن 💾')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onerror = () => toast.show('تعذّرت قراءة الملف', 'error')
    reader.onload = () => {
      try {
        const raw = String(reader.result)
        const backup = parseBackup(raw) // يتحقق من الصيغة والبصمة — يرمي لو تالف
        setPending({ raw, summary: summarizeBackup(backup) })
        setConfirmText('')
      } catch (err) {
        toast.show((err as Error).message, 'error')
      }
    }
    reader.readAsText(file)
  }

  const restore = () => {
    if (!pending) return
    try {
      const backup = parseBackup(pending.raw) // تحقق ثانٍ لحظة التنفيذ
      if (backup.data.app != null) localStorage.setItem('shopsys-app', JSON.stringify(backup.data.app))
      localStorage.setItem('shopsys-data', JSON.stringify(backup.data.store))
      toast.show('استُعيدت النسخة — يُعاد تحميل التطبيق…')
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const counts = useDataStore((s) => ({ items: s.items.length, sales: s.sales.length, journal: s.journal.length }))
  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* تنزيل نسخة */}
      <div className={`anim-up ${card} space-y-4`}>
        <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
          <DatabaseBackup size={17} className="text-slate-500" /> نسخة احتياطية كاملة
        </div>
        <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          ملف واحد يحوي كل شيء: الأصناف، الفواتير، القيود، الأطراف، الإعدادات، والترخيص —
          ببصمة تحقق تكشف أي تلف. احفظه خارج الجهاز (فلاشة/سحابة)،
          ولاحقاً سيُرسل يومياً تلقائياً إلى بوت التليجرام.
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="font-black text-lg">{counts.items}</div><div className="text-slate-400">صنفاً</div></div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="font-black text-lg">{counts.sales}</div><div className="text-slate-400">فاتورة بيع</div></div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="font-black text-lg">{counts.journal}</div><div className="text-slate-400">قيداً</div></div>
        </div>
        <Btn onClick={download} className="w-full"><Download size={15} /> تنزيل نسخة احتياطية الآن</Btn>
      </div>

      {/* استعادة */}
      <div className={`anim-up ${card} space-y-4`} style={{ animationDelay: '80ms' }}>
        <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
          <Upload size={17} className="text-slate-500" /> استعادة من نسخة
        </div>

        {!pending ? (
          <>
            <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
              اختر ملف نسخة — سنعرض محتواها أولاً ولن يتغير شيء قبل تأكيدك الصريح.
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-slate-400 hover:border-brand-400 hover:text-brand-500 transition-colors"
            >
              <FileJson size={28} className="mx-auto mb-2" />
              <div className="text-[13px] font-bold">اضغط لاختيار ملف النسخة (.json)</div>
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
          </>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-600 mb-2"><CheckCircle2 size={14} /> نسخة سليمة — البصمة مطابقة</div>
              <div className="grid grid-cols-2 gap-y-1 text-[12.5px]">
                <span className="text-slate-400">المحل</span><b>{pending.summary.shopName || '—'}</b>
                <span className="text-slate-400">التاريخ</span><b dir="ltr">{pending.summary.createdAt.slice(0, 16).replace('T', ' ')}</b>
                <span className="text-slate-400">الأصناف</span><b>{pending.summary.items}</b>
                <span className="text-slate-400">فواتير البيع</span><b>{pending.summary.sales}</b>
                <span className="text-slate-400">فواتير الشراء</span><b>{pending.summary.purchases}</b>
                <span className="text-slate-400">القيود</span><b>{pending.summary.journalEntries}</b>
                <span className="text-slate-400">العملاء</span><b>{pending.summary.customers}</b>
              </div>
            </div>

            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-rose-600"><AlertTriangle size={14} /> الاستعادة تستبدل كل البيانات الحالية نهائياً</div>
              <div className="text-[11.5px] text-slate-500">للاستمرار اكتب: <b className="text-rose-600">استبدال</b></div>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 bg-transparent text-[13px] outline-none focus:border-rose-500"
                placeholder="اكتب هنا…"
              />
            </div>

            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setPending(null)} className="flex-1">إلغاء</Btn>
              <Btn onClick={restore} disabled={confirmText.trim() !== 'استبدال'} className="flex-1 !bg-rose-600 hover:!bg-rose-700">استعادة الآن</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
