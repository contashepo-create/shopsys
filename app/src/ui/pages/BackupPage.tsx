/**
 * النسخ الاحتياطي (المرحلة 5) — تنزيل نسخة كاملة ببصمة تحقق،
 * واستعادة بمعاينة محتوى النسخة وتأكيد صريح (يستبدل كل البيانات الحالية).
 * نفس صيغة الملف ستُستخدم لاحقاً للنسخ اليومي عبر بوت التليجرام.
 */
import { useRef, useState } from 'react'
import { DatabaseBackup, Download, Upload, AlertTriangle, CheckCircle2, FileJson, CalendarClock } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore, DATA_VERSION } from '../../data/repo.ts'
import { buildBackup, parseBackup, summarizeBackup, backupFileName, type BackupSummary } from '../../core/backup.ts'
import { BACKUP_INTERVAL_CHOICES } from '../../core/security.ts'
import { decryptForDevice, encryptForDevice } from '../../data/secureStorage.ts'
import { Btn, useToast } from '../components/ui.tsx'


export function BackupPage() {
  const { setup, backupIntervalMinutes, setBackupIntervalMinutes, lastHourlyBackupAt } = useAppStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ raw: string; summary: BackupSummary } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [lastVerification, setLastVerification] = useState<{ at: string; bytes: number } | null>(null)

  const verifyRoundTrip = async () => {
    try {
      const appRaw = localStorage.getItem('shopsys-app')
      const storeEnc = localStorage.getItem('shopsys-data')
      const storeRaw = storeEnc == null ? null : await decryptForDevice(storeEnc)
      if (!storeRaw) throw new Error('لا بيانات محلية لفحصها')
      const backup = buildBackup({ appState: appRaw ? JSON.parse(appRaw) : null, storeState: JSON.parse(storeRaw), appDataVersion: DATA_VERSION, shopName: setup.shopName })
      const serialized = JSON.stringify(backup)
      const restored = parseBackup(serialized)
      if (JSON.stringify(restored.data.store) !== JSON.stringify(backup.data.store)) throw new Error('فشل تطابق البيانات بعد الاستعادة التجريبية')
      setLastVerification({ at: new Date().toISOString(), bytes: new Blob([serialized]).size })
      toast.show('نجح فحص النسخ والاستعادة التجريبي دون تغيير بياناتك ✓')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  const download = async () => {
    try {
      // نقرأ من localStorage ونفك تشفير قاعدة البيانات (القرار 28) — النسخة تُحفظ نصاً صريحاً
      // كي تُستعاد على أي جهاز (تشفير القاعدة مربوط بمفتاح الجهاز نفسه)
      const appRaw = localStorage.getItem('shopsys-app')
      const storeEnc = localStorage.getItem('shopsys-data')
      const storeRaw = storeEnc == null ? null : await decryptForDevice(storeEnc)
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

  const restore = async () => {
    if (!pending) return
    try {
      const backup = parseBackup(pending.raw) // تحقق ثانٍ لحظة التنفيذ
      if (backup.data.app != null) localStorage.setItem('shopsys-app', JSON.stringify(backup.data.app))
      // تُكتب القاعدة مشفرة بمفتاح هذا الجهاز — كما يكتبها التطبيق نفسه تماماً
      localStorage.setItem('shopsys-data', await encryptForDevice(JSON.stringify(backup.data.store)))
      toast.show('استُعيدت النسخة — يُعاد تحميل التطبيق…')
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  // ملاحظة: selectors منفصلة — إرجاع كائن جديد كل تصيير يسبب حلقة لانهائية في zustand v5 (صفحة بيضاء)
  const itemsCount = useDataStore((s) => s.items.length)
  const salesCount = useDataStore((s) => s.sales.length)
  const journalCount = useDataStore((s) => s.journal.length)
  const counts = { items: itemsCount, sales: salesCount, journal: journalCount }
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
        <Btn variant="ghost" onClick={() => { void verifyRoundTrip() }} className="w-full"><CheckCircle2 size={15}/> فحص استعادة تجريبي دون تغيير البيانات</Btn>
        {lastVerification && <div className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700">آخر فحص ناجح: {lastVerification.at.slice(0,16).replace('T',' ')} · حجم النسخة {lastVerification.bytes.toLocaleString('ar-EG')} بايت</div>}
      </div>

      {/* جدولة النسخ التلقائي (طلب المالك) — لقطة مشفرة على الجهاز حسب الفاصل المختار */}
      <div className={`anim-up ${card} space-y-4 lg:col-span-2`} style={{ animationDelay: '40ms' }}>
        <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
          <CalendarClock size={17} className="text-violet-500" /> جدولة النسخ التلقائي
        </div>
        <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          التطبيق يأخذ لقطة كاملة مشفرة على هذا الجهاز تلقائياً (حلقة من 3 لقطات — الأقدم يُستبدل)
          حسب الفاصل الذي تختاره. النسخة اليومية إلى تليجرام تُضبط من «بوت التليجرام».
        </div>
        <div className="flex flex-wrap gap-2">
          {BACKUP_INTERVAL_CHOICES.map((c) => (
            <button
              key={c.minutes}
              onClick={() => { setBackupIntervalMinutes(c.minutes); toast.show(`ستُؤخذ لقطة تلقائية ${c.labelAr} ✓`) }}
              className={`px-4 py-2.5 rounded-xl text-[12.5px] font-bold border-2 transition-all duration-200 hover:scale-[1.02] ${
                backupIntervalMinutes === c.minutes
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400'
              }`}
            >
              {c.labelAr}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-400">
          {lastHourlyBackupAt
            ? <>آخر لقطة تلقائية: <b dir="ltr">{lastHourlyBackupAt.slice(0, 16).replace('T', ' ')}</b></>
            : 'لم تُؤخذ لقطة تلقائية بعد — تُؤخذ الأولى خلال دقائق من فتح التطبيق'}
        </div>
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
