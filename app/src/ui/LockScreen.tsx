/**
 * شاشة القفل (القرار 28): عند انتهاء التجربة/الاشتراك أو حرق المفتاح أو
 * مخالفة النشاط، يتحول المستخدم تلقائياً لهذا القسم فقط — وظيفته:
 * 1) التواصل مع المطوّر (تليجرام/هاتف من صفحة «حول» السحابية)
 * 2) إدخال مفتاح تفعيل جديد
 * 3) تنزيل بياناته كاملة (JSON / CSV / Excel-CSV) — حق العميل في بياناته
 * لا سبيل لتجاوزها: كل الشاشات الأخرى غير معروضة أصلاً في هذه الحالة.
 */
import { useMemo, useState } from 'react'
import { KeyRound, Download, MessageCircle, Phone, FileJson, FileSpreadsheet, Copy } from 'lucide-react'
import { useAppStore } from '../stores/app.store.ts'
import { useDataStore } from '../data/repo.ts'
import {
  verifyLicenseKey, activityMatches, isRevoked, PLAN_LABELS, type LicenseState,
} from '../core/license.ts'
import { LOCK_REASON_LABELS, toCsv, type LockReason } from '../core/security.ts'
import { FALLBACK_ABOUT } from '../core/cloud.ts'
import { buildBackup, backupFileName } from '../core/backup.ts'
import { Btn, inputCls, useToast } from './components/ui.tsx'

const DATA_VERSION = 6 // إصدار persist لمخزن shopsys-data
const money = (minor: number) => (minor / 100).toFixed(2)

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

export function LockScreen({ reason, state }: { reason: LockReason; state: LicenseState }) {
  const { deviceId, setup, cloudAbout, revokedKeys, setActivated } = useAppStore()
  const data = useDataStore()
  const toast = useToast()
  const info = LOCK_REASON_LABELS[reason]
  const about = cloudAbout ?? FALLBACK_ABOUT
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => ({
    items: data.items.length, customers: data.customers.length, sales: data.sales.length,
    purchases: data.purchases.length, journal: data.journal.length,
  }), [data])

  const activate = async () => {
    setBusy(true)
    try {
      const trimmed = keyInput.trim()
      if (isRevoked(trimmed, revokedKeys)) throw new Error('هذا المفتاح محروق (مُبطل من المطوّر) — اطلب مفتاحاً جديداً')
      const payload = await verifyLicenseKey(trimmed, deviceId)
      if (!activityMatches(payload, setup.activityId)) throw new Error('المفتاح صادر لنشاط آخر — اطلب مفتاحاً لنشاطك الحالي')
      setActivated(trimmed, payload)
      toast.show(`تم التفعيل — خطة ${PLAN_LABELS[payload.plan]} ✅ يعاد التحميل…`)
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportJson = () => {
    try {
      const appRaw = localStorage.getItem('shopsys-app')
      const backup = buildBackup({
        appState: appRaw ? JSON.parse(appRaw) : null,
        storeState: useDataStore.getState(),
        appDataVersion: DATA_VERSION,
        shopName: setup.shopName,
      })
      downloadBlob(JSON.stringify(backup, null, 1), backupFileName(setup.shopName, backup.createdAt), 'application/json')
      toast.show('نُزّلت بياناتك كاملة بصيغة JSON 💾')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const exportCsv = () => {
    try {
      const d = useDataStore.getState()
      const files: [string, Record<string, unknown>[]][] = [
        ['items', d.items.map((i) => ({ الاسم: i.nameAr, الباركود: i.barcodes[0] ?? '', السعر: money(i.priceMinor), الكمية: i.stockQty }))],
        ['customers', d.customers.map((c) => ({ الاسم: c.nameAr, الهاتف: c.phone }))],
        ['sales', d.sales.map((s) => ({ الفاتورة: s.invoiceNumber, التاريخ: s.date.slice(0, 10), الإجمالي: money(s.totals.totalMinor) }))],
        ['journal', d.journal.map((e) => ({ القيد: e.entryNumber, التاريخ: e.date, البيان: e.description }))],
      ]
      let n = 0
      for (const [name, rows] of files) {
        if (!rows.length) continue
        downloadBlob(toCsv(rows), `shopsys-${name}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
        n++
      }
      toast.show(n ? `نُزّل ${n} ملف CSV (يفتح في Excel مباشرة) 📊` : 'لا بيانات للتصدير')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const copyDevice = async () => {
    try { await navigator.clipboard.writeText(deviceId); toast.show('نُسخ معرف الجهاز 📋') } catch { /* حقل ظاهر للنسخ اليدوي */ }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-4" dir="rtl">
      <div className="w-full max-w-2xl space-y-4">
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3 shadow-xl">
          <img src="/dev-logo.png" alt="شعار المطوّر" className="max-h-24 mx-auto object-contain rounded-xl bg-black px-4 py-2" />
          <div className="text-6xl">{info.icon}</div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">{info.title}</h1>
          <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto">{info.desc}</p>
          {state.status === 'expired' && (
            <div className="text-[12px] font-bold text-slate-400">الخطة السابقة: {PLAN_LABELS[state.payload.plan]}</div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* التفعيل */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h2 className="font-black flex items-center gap-2"><KeyRound className="w-5 h-5 text-emerald-500" /> تفعيل باقة</h2>
            <div className="flex gap-1.5">
              <input value={deviceId} readOnly className={`${inputCls} font-mono !text-[13px] font-bold`} dir="ltr" />
              <button onClick={copyDevice} className="px-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-sky-600 transition-colors"><Copy className="w-4 h-4" /></button>
            </div>
            <p className="text-[11px] text-slate-400">أرسل معرف الجهاز للمطوّر واستلم مفتاح التفعيل</p>
            <textarea value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className={`${inputCls} min-h-[70px] font-mono !text-[11px]`} dir="ltr" placeholder="SHOPSYS1.…" />
            <Btn onClick={activate} disabled={!keyInput.trim() || busy} className="w-full">{busy ? 'جارٍ التحقق…' : 'تفعيل'}</Btn>
          </div>

          {/* التواصل + التصدير */}
          <div className="space-y-4">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <h2 className="font-black flex items-center gap-2"><MessageCircle className="w-5 h-5 text-sky-500" /> تواصل مع المطوّر</h2>
              {about.supportTelegram ? (
                <a href={`https://t.me/${about.supportTelegram.replace('@', '')}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sky-600 font-bold text-sm hover:underline"><MessageCircle className="w-4 h-4" /> {about.supportTelegram}</a>
              ) : <p className="text-[12px] text-slate-400">تليجرام: عبر بوت العملاء المسجل لديك</p>}
              {about.supportPhone && (
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-bold text-sm" dir="ltr"><Phone className="w-4 h-4" /> {about.supportPhone}</div>
              )}
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <h2 className="font-black flex items-center gap-2"><Download className="w-5 h-5 text-violet-500" /> بياناتك ملكك</h2>
              <p className="text-[11px] text-slate-400">
                {counts.items} صنف · {counts.customers} عميل · {counts.sales} فاتورة · {counts.journal} قيد
              </p>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={exportJson} className="flex-1"><FileJson className="w-4 h-4" /> JSON كامل</Btn>
                <Btn variant="ghost" onClick={exportCsv} className="flex-1"><FileSpreadsheet className="w-4 h-4" /> CSV / Excel</Btn>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400">بياناتك محفوظة ومشفرة على جهازك — لن تفقد شيئاً عند التفعيل</p>
      </div>
    </div>
  )
}
