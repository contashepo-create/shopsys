/**
 * النسخ الاحتياطي (المرحلة 5) — تنزيل نسخة كاملة ببصمة تحقق،
 * واستعادة بمعاينة محتوى النسخة وتأكيد صريح (يستبدل كل البيانات الحالية).
 * نفس صيغة الملف ستُستخدم لاحقاً للنسخ اليومي عبر بوت التليجرام.
 */
import { useRef, useState } from 'react'
import { DatabaseBackup, Download, Upload, AlertTriangle, CheckCircle2, FileJson, CalendarClock, FileSpreadsheet, FileText, HardDrive, FolderOpen, ShieldAlert } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore, DATA_VERSION } from '../../data/repo.ts'
import { buildBackup, parseBackup, summarizeBackup, backupFileName, type BackupSummary } from '../../core/backup.ts'
import { BACKUP_INTERVAL_CHOICES } from '../../core/security.ts'
import { appStorage, settingsAppStorage } from '../../data/persistentStorage.ts'
import { desktopDatabaseStorage, desktopBackupNow, isElectronRuntime } from '../../data/desktopBridge.ts'
import { Btn, useToast } from '../components/ui.tsx'
import { buildFullExportSheets, sheetsToExcelXml, sheetToCsv, downloadTextFile, exportFileName, type ExportSheet } from '../../core/fullExport.ts'


export function BackupPage() {
  const { setup, backupIntervalMinutes, setBackupIntervalMinutes, lastHourlyBackupAt } = useAppStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ raw: string; summary: BackupSummary } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [lastVerification, setLastVerification] = useState<{ at: string; bytes: number } | null>(null)

  const verifyRoundTrip = async () => {
    try {
      /* v1.0.6 (بلاغ المالك): القراءة من طبقة التخزين الحقيقية — في المتصفح
         localStorage/secureStorage وفي سطح المكتب SQLite عبر IPC. القراءة
         النصية المباشرة من localStorage كانت ترجع null دائماً في النسخة
         المثبتة فيظهر «لا بيانات للنسخ بعد» رغم وجود البيانات. */
      const appRaw = await settingsAppStorage().getItem('shopsys-app')
      const storeRaw = await appStorage().getItem('shopsys-data')
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
      // نقرأ من طبقة التخزين الحقيقية ويفك التشفير تلقائياً حيث يلزم (القرار 28) —
      // النسخة تُحفظ نصاً صريحاً كي تُستعاد على أي جهاز (تشفير القاعدة مربوط بمفتاح الجهاز نفسه)
      const appRaw = await settingsAppStorage().getItem('shopsys-app')
      const storeRaw = await appStorage().getItem('shopsys-data')
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
      /* v1.0.6: الكتابة عبر نفس طبقة التخزين التي يقرأ منها التطبيق عند الإقلاع —
         localStorage المباشر كان يكتب في المكان الخطأ في النسخة المثبتة (persist
         يقرأ من SQLite) فلا تنجح الاستعادة. الترقيم المتفائل في DesktopStateStorage
         يمنع أي حفظ متأخر من المتجر القديم من الكتابة فوق النسخة المستعادة. */
      if (backup.data.app != null) await settingsAppStorage().setItem('shopsys-app', JSON.stringify(backup.data.app))
      await appStorage().setItem('shopsys-data', JSON.stringify(backup.data.store))
      toast.show('استُعيدت النسخة — يُعاد تحميل التطبيق…')
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  /* ─── التصدير الشامل (طلب المالك v1.0.6): Excel متعدد الأوراق + CSV لكل جدول ───
     يُبنى من المتجر الحي مباشرة — بلا قراءة تخزين — فلا يتأثر بفرق بيئة الويب/سطح المكتب */
  const [exportSheets, setExportSheets] = useState<ExportSheet[] | null>(null)
  /* ─── v1.0.8 (طلب المالك): مكان قاعدة البيانات + النسخ المزدوجة — سطح المكتب ─── */
  const storage = desktopDatabaseStorage()
  const [storageInfo, setStorageInfo] = useState<Awaited<ReturnType<NonNullable<typeof storage>['getStorageInfo']>> | null>(null)
  const [movingDb, setMovingDb] = useState(false)
  const [fileBackupBusy, setFileBackupBusy] = useState(false)
  const refreshStorage = async () => { if (storage) { try { setStorageInfo(await storage.getStorageInfo()) } catch { /* الجسر القديم */ } } }
  if (storage && storageInfo == null) void refreshStorage()
  const takeFileBackup = async () => {
    const backup = desktopBackupNow()
    if (!backup) return toast.show('النسخة الملفية متاحة في نسخة سطح المكتب فقط', 'error')
    setFileBackupBusy(true)
    try {
      const files = await backup()
      toast.show(`أُخذت نسخة ملفية في ${files.length} مكان ✓ (${files.map((f) => f.split(/[\\/]/).slice(-2, -1)[0] + '/' + f.split(/[\\/]/).pop()).join(' و ')})`)
      await refreshStorage()
    } catch (err) { toast.show((err as Error).message, 'error') } finally { setFileBackupBusy(false) }
  }
  const exportAll = () => {
    const sheets = buildFullExportSheets(useDataStore.getState() as unknown as Record<string, unknown>)
    setExportSheets(sheets)
    downloadTextFile(exportFileName(setup.shopName, 'export', 'xls', new Date().toISOString()), 'application/vnd.ms-excel', sheetsToExcelXml(sheets))
    toast.show(`نُزّل ملف Excel شامل (${sheets.length} أوراق: أصناف/فواتير/قيود/أطراف…) ✓`)
  }
  const exportCsv = (sheet: ExportSheet) => {
    downloadTextFile(exportFileName(setup.shopName, sheet.nameAr.replace(/\s+/g, '-'), 'csv', new Date().toISOString()), 'text/csv;charset=utf-8', sheetToCsv(sheet))
    toast.show(`نُزّل CSV «${sheet.nameAr}» (${sheet.rows.length} صفاً) ✓`)
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

      {/* تصدير شامل — Excel وCSV (طلب المالك v1.0.6) */}
      <div className={`anim-up ${card} space-y-4`} style={{ animationDelay: '60ms' }}>
        <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
          <FileSpreadsheet size={17} className="text-emerald-600" /> تصدير شامل للبيانات — Excel وCSV
        </div>
        <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          ملف Excel واحد يفتح بكل الجداول أوراقاً منفصلة (أصناف، عملاء، موردون، فواتير البيع
          والشراء، قيود اليومية، الخزائن، المخازن، الفروع، الرواتب، السلف، العمولات، السندات) —
          أو نزّل أي جدول منفرداً بصيغة CSV بترميز عربي سليم. المبالغ بالوحدة الكاملة (جنيه) لا بالقروش.
        </div>
        <Btn onClick={exportAll} className="w-full !bg-emerald-600 hover:!bg-emerald-700"><FileSpreadsheet size={15} /> تنزيل Excel شامل (كل الجداول)</Btn>
        <div className="flex flex-wrap gap-2">
          {(exportSheets ?? []).map((sheet) => (
            <button
              key={sheet.nameAr}
              onClick={() => exportCsv(sheet)}
              className="px-3 py-2 rounded-xl text-[11.5px] font-bold border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors flex items-center gap-1.5"
            >
              <FileText size={12} /> {sheet.nameAr} ({sheet.rows.length})
            </button>
          ))}
          {!exportSheets && <div className="text-[11px] text-slate-400">اضغط «تنزيل Excel شامل» أولاً لتظهر أزرار CSV لكل جدول</div>}
        </div>
        <div className="text-[11px] text-slate-400 leading-relaxed">
          تصدير تشغيلي للمحاسبة والمخزون — لا يشمل الحقول السرية (بصمات الدخول والترخيص).
          للنسخ الكاملة القابلة للاستعادة استخدم «نسخة احتياطية كاملة» أعلاه.
        </div>
      </div>

      {/* v1.0.8: مكان القاعدة والنسخ المزدوجة (طلب المالك) — سطح المكتب فقط */}
      {isElectronRuntime() && (
        <div className={`anim-up ${card} space-y-4 lg:col-span-2`} style={{ animationDelay: '50ms' }}>
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <HardDrive size={17} className="text-sky-600" /> مكان قاعدة البيانات والنسخ الاحتياطية
          </div>

          <div className="rounded-2xl border-2 border-amber-400/40 bg-amber-500/[0.06] p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-amber-700 dark:text-amber-400">
              <ShieldAlert size={15} /> تحذير مهم — اقرأه بعناية
            </div>
            <div className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1.5">
              <div>• قاعدة البيانات على <b>قرص C</b> مع الويندوز: <b>فرمتة الويندوز أو إعادة تهيئته = فقدان كل بياناتك</b>. يُنصح بشدة باختيار مكان على قرص آخر (D أو E أو فلاشة خارجية تبقى موصولة).</div>
              <div>• النسخ الاحتياطية تُحفظ تلقائياً في <b>مكانين مختلفين</b>:
                <b> الأول</b> بجوار القاعدة نفسها{storageInfo ? <> (<span dir="ltr" className="text-[11px]">{storageInfo.dbPath.split(/[\\/]/).slice(0, -1).join(' \\ ')}</span>)</> : null}،
                و<b>الثاني</b> في{storageInfo ? <> <span dir="ltr" className="text-[11px]">{storageInfo.secondaryBackupDir}</span></> : ' مجلد المستندات (Tahakom-Backups)'}.
              </div>
              <div>• <b>ضياع النسخ الاحتياطية أو القاعدة مسؤوليتك الكاملة</b> — احرص على حفظ نسخة خارج الجهاز (فلاشة/سحابة) من زر التنزيل أعلاه، فلا يمكن استعادة بيانات لا نسخة منها.</div>
            </div>
          </div>

          {storageInfo && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3.5">
                <div className="text-[11px] text-slate-400 mb-1">مكان القاعدة الحالي {storageInfo.isCustom ? '(مخصص — خارج قرص الويندوز ✓)' : '(الافتراضي — على قرص الويندوز ⚠️)'}</div>
                <div dir="ltr" className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200 break-all">{storageInfo.dbPath}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3.5">
                <div className="text-[11px] text-slate-400 mb-1">النسخة الاحتياطية الثانية {storageInfo.secondaryIsDefault ? '(الافتراضي — المستندات)' : '(مكانك المخصص)'}</div>
                <div dir="ltr" className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200 break-all">{storageInfo.secondaryBackupDir}</div>
              </div>
            </div>
          )}

          {storageInfo && (
            <div className="text-[11px] text-slate-400">
              {storageInfo.lastFileBackupAt
                ? <>آخر نسخة ملفية تلقائية: <b dir="ltr">{storageInfo.lastFileBackupAt.slice(0, 16).replace('T', ' ')}</b> — تُؤخذ تلقائياً مرة يومياً عند فتح التطبيق.</>
                : 'تُؤخذ نسخة ملفية تلقائية مرة يومياً عند فتح التطبيق (في المكانين معاً).'}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" onClick={takeFileBackup} disabled={fileBackupBusy}>
              <DatabaseBackup size={15} /> {fileBackupBusy ? 'جارٍ أخذ النسخة…' : 'نسخة ملفية فورية في المكانين'}
            </Btn>
            {storage && (
              <>
                <Btn variant="ghost" disabled={movingDb} onClick={async () => {
                  setMovingDb(true)
                  try {
                    const result = await storage.chooseDbLocation()
                    if (result.ok && result.restarting) {
                      toast.show(`نُقلت القاعدة إلى المكان الجديد — سيُعاد تشغيل التطبيق الآن ✓`)
                      setTimeout(() => window.location.reload(), 1500)
                    } else if (!result.ok && result.error) toast.show(result.error, 'error')
                  } catch (err) { toast.show((err as Error).message, 'error') } finally { setMovingDb(false) }
                }}>
                  <FolderOpen size={15} /> تغيير مكان قاعدة البيانات…
                </Btn>
                <Btn variant="ghost" onClick={async () => {
                  try {
                    const result = await storage.chooseSecondaryBackupDir()
                    if (result.ok && result.dir) { toast.show(`مكان النسخة الثانية الآن: ${result.dir} ✓`); await refreshStorage() }
                  } catch (err) { toast.show((err as Error).message, 'error') }
                }}>
                  <FolderOpen size={15} /> تغيير مكان النسخة الثانية…
                </Btn>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-400 leading-relaxed">
            تغيير مكان القاعدة: يُغلق الاتصال بأمان، تُنسخ القاعدة كاملة للمكان الجديد (الأصل يبقى نسخة أمان)، ثم يُعاد تشغيل التطبيق تلقائياً.
          </div>
        </div>
      )}

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
