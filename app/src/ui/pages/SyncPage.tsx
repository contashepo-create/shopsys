/**
 * المزامنة السحابية متعددة الأجهزة (Supabase) — ميزة cloud_sync المدفوعة (القرار 24)
 * ─────────────────────────────────────────────────────────────────────────────────
 * كاشير الفرع والمحاسب والمالك على نفس القاعدة: قفل تفاؤلي بلا ضياع بيانات،
 * والبيانات تُشفَّر AES-256-GCM على الجهاز قبل الرفع — السحابة لا ترى إلا شفرة.
 */
import { useMemo, useState } from 'react'
import { CloudUpload, Lock, RefreshCw, CheckCircle2, ShieldCheck, Copy, PlugZap, History, Download, Undo2 } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { validateSyncConfig, fetchRemote } from '../../data/syncClient.ts'
import { runSyncCycle, listConflictSnapshots, getConflictSnapshotData, restoreConflictSnapshot } from '../../data/syncRunner.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { deriveArchitectureMode, MODE_LABELS } from '../../core/architecture.ts'
import { isCloudDisabled } from '../../core/featureFlags.ts'

const CREATE_TABLE_SQL = `create table if not exists stores (
  store_id text primary key,
  rev bigint not null default 0,
  device_id text not null default '',
  updated_at timestamptz not null default now(),
  checksum text not null default '',
  data text not null default ''
);
alter table stores enable row level security;
create policy "stores anon access" on stores for all
  to anon using (true) with check (true);`

export function SyncPage() {
  const { sync, updateSync, activatedPayload, trialStartedAt, lastSeenAt, deviceId, deviceFlags } = useAppStore()
  const toast = useToast()

  const licensed = useMemo(() => {
    const state = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    return hasFeature(state, 'cloud_sync')
  }, [activatedPayload, trialStartedAt, lastSeenAt])

  // وضع التشغيل الحالي (البنية الهجينة — 4 أوضاع) مشتق من الرخصة الموقَّعة فقط
  const archMode = useMemo(
    () => deriveArchitectureMode(activatedPayload?.features ?? [], sync.enabled),
    [activatedPayload, sync.enabled],
  )
  const archInfo = MODE_LABELS[archMode]

  // مفتاح الإطفاء السحابي (البند 5): ممنوحة بالمفتاح لكن المطوّر أطفأها مؤقتاً
  const cloudDisabled = isCloudDisabled('cloud_sync', activatedPayload?.features ?? [], deviceFlags)

  const [url, setUrl] = useState(sync.url)
  const [anonKey, setAnonKey] = useState(sync.anonKey)
  const [storeId, setStoreId] = useState(sync.storeId)
  const [secret, setSecret] = useState(sync.secret)
  const [busy, setBusy] = useState<string | null>(null)
  // لقطات التعارض (شبكة الأمان): تُحدَّث بعد كل مزامنة/استرجاع عبر هذا العداد
  const [snapVer, setSnapVer] = useState(0)
  const snapshots = useMemo(() => { void snapVer; return listConflictSnapshots().slice().reverse() }, [snapVer])

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  /* ─── إطفاء سحابي مؤقت (البند 5): رسالة مختلفة عن «غير مشتراة» ─── */
  if (licensed && cloudDisabled) {
    return (
      <div className="max-w-2xl">
        <div className={`anim-up ${card} !p-10 text-center space-y-3 border-amber-400/40`}>
          <Lock className="w-12 h-12 mx-auto text-amber-400" />
          <h1 className="text-xl font-black">المزامنة السحابية معطَّلة مؤقتاً</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
            الميزة ضمن خطتك، لكن المطوّر أوقفها مؤقتاً من لوحة التحكم.
            {deviceFlags?.noteAr ? ` السبب: ${deviceFlags.noteAr}.` : ''} بياناتك المحلية سليمة وتعمل كالمعتاد —
            تواصل مع الدعم من صفحة «حول» لإعادة التفعيل.
          </p>
        </div>
      </div>
    )
  }

  /* ─── شاشة القفل: الميزة تُباع ضمن الخطط الأعلى (القرار 24) ─── */
  if (!licensed) {
    return (
      <div className="max-w-2xl">
        <div className={`anim-up ${card} !p-10 text-center space-y-3`}>
          <Lock className="w-12 h-12 mx-auto text-slate-300" />
          <h1 className="text-xl font-black">المزامنة السحابية — ميزة الخطط الأعلى</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
            عدة أجهزة (كاشير الفرع، المحاسب، جهازك) على نفس قاعدة البيانات لحظياً عبر Supabase —
            بقفل يمنع ضياع أي حركة وتشفير كامل قبل مغادرة الجهاز.
            يفعّلها المطوّر بمفتاح ترخيص يحمل «مزامنة سحابية» — تواصل معه من صفحة «حول التطبيق».
          </p>
        </div>
      </div>
    )
  }

  /* بطاقة وضع التشغيل تُعرض أعلى الصفحة (JSX أدناه) */
  const saveConfig = () => {
    const cfg = { url: url.trim(), anonKey: anonKey.trim(), storeId: storeId.trim(), secret: secret.trim() }
    const errors = validateSyncConfig(cfg)
    if (errors.length) return toast.show(errors[0], 'error')
    updateSync({ ...cfg })
    toast.show('حُفظت إعدادات المزامنة ✅')
  }

  const testConnection = async () => {
    const cfg = { url: url.trim(), anonKey: anonKey.trim(), storeId: storeId.trim(), secret: secret.trim() }
    const errors = validateSyncConfig(cfg)
    if (errors.length) return toast.show(errors[0], 'error')
    setBusy('test')
    try {
      const row = await fetchRemote(cfg)
      toast.show(row === null
        ? 'الاتصال سليم ✅ — سجل المتجر سيُنشأ عند أول مزامنة'
        : `الاتصال سليم ✅ — المتجر عند المراجعة ${row.rev}`)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const syncNow = async () => {
    setBusy('sync')
    try {
      const r = await runSyncCycle()
      toast.show(r.message, r.ok ? undefined : 'error')
    } finally {
      setBusy(null)
      setSnapVer((v) => v + 1) // قد تكون المزامنة حفظت لقطة تعارض جديدة
    }
  }

  const downloadSnapshot = (at: string) => {
    const data = getConflictSnapshotData(at)
    if (!data) return toast.show('اللقطة غير موجودة', 'error')
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `لقطة-تعارض-${at.slice(0, 19).replace(/[T:]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const restoreSnapshot = (at: string) => {
    if (!window.confirm('سيُستبدل ما على هذا الجهاز الآن بحالة اللقطة (وتُحفظ الحالة الحالية كلقطة جديدة أولاً — لا يضيع شيء). متابعة؟')) return
    const r = restoreConflictSnapshot(at)
    toast.show(r.message, r.ok ? undefined : 'error')
    setSnapVer((v) => v + 1)
  }

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(CREATE_TABLE_SQL)
      toast.show('نُسخ SQL — ألصقه في SQL Editor داخل مشروع Supabase ✅')
    } catch {
      toast.show('تعذر النسخ — انسخه يدوياً من الصندوق', 'error')
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* وضع التشغيل الحالي — البنية الهجينة (٤ أوضاع) */}
      <div className={`anim-up ${card} flex items-center gap-4`}>
        <span className="text-3xl">{archInfo.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-black text-slate-800 dark:text-white">وضع التشغيل: {archInfo.nameAr}</div>
          <div className="text-[11.5px] text-slate-400">{archInfo.desc}</div>
        </div>
        <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">يتحدد من رخصتك الموقَّعة</span>
      </div>

      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><CloudUpload className="w-6 h-6 text-sky-500" /> المزامنة السحابية للأجهزة والفروع</h1>
        {sync.enabled && (
          <span className="text-[11px] px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1">
            <CheckCircle2 size={13} /> مفعلة
          </span>
        )}
      </div>

      {/* الحالة الحية */}
      {sync.enabled && (
        <div className={`anim-up ${card} flex items-center justify-between flex-wrap gap-3`}>
          <div className="text-[12.5px] space-y-1">
            <div className="text-slate-500">آخر مزامنة: <b className="text-slate-700 dark:text-slate-200">{sync.lastSyncedAt ? sync.lastSyncedAt.slice(0, 16).replace('T', ' ') : 'لم تتم بعد'}</b> — المراجعة <b>{sync.lastKnownRev}</b></div>
            {sync.lastResult && <div className="text-slate-400">{sync.lastResult}</div>}
            {sync.dirty && <div className="text-amber-600 font-bold">توجد تغييرات محلية بانتظار الدفع…</div>}
          </div>
          <Btn onClick={syncNow} disabled={busy === 'sync'}>
            <RefreshCw size={15} className={busy === 'sync' ? 'animate-spin' : ''} /> زامن الآن
          </Btn>
        </div>
      )}

      {/* الإعداد */}
      <div className={`anim-up ${card} space-y-4`} style={{ animationDelay: '60ms' }}>
        <div className="font-bold text-[13px] flex items-center gap-2"><PlugZap size={15} className="text-sky-500" /> بيانات مشروع Supabase</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="رابط المشروع *" hint="من Settings → API داخل Supabase">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} dir="ltr" placeholder="https://xxxx.supabase.co" />
          </Field>
          <Field label="مفتاح anon *" hint="مفتاح anon public — ليس service_role أبداً">
            <input value={anonKey} onChange={(e) => setAnonKey(e.target.value)} className={inputCls} dir="ltr" placeholder="eyJhbGciOi…" />
          </Field>
          <Field label="معرف المتجر *" hint="نفسه على كل الأجهزة — مثل: matgar-alnour">
            <input value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
          <Field label="سر التشفير المشترك *" hint="8 أحرف فأكثر — يُدخل على كل جهاز ولا يُرفع للسحابة أبداً">
            <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" className={inputCls} dir="ltr" />
          </Field>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn onClick={saveConfig}>حفظ الإعدادات</Btn>
          <Btn variant="soft" onClick={testConnection} disabled={busy === 'test'}>اختبار الاتصال</Btn>
          <button
            onClick={() => {
              if (!sync.enabled) {
                const errors = validateSyncConfig({ url: sync.url, anonKey: sync.anonKey, storeId: sync.storeId, secret: sync.secret })
                if (errors.length) return toast.show('احفظ إعدادات صحيحة أولاً ثم فعّل', 'error')
              }
              updateSync({ enabled: !sync.enabled })
              toast.show(sync.enabled ? 'أُوقفت المزامنة' : 'فُعّلت المزامنة — ستعمل تلقائياً كل دقيقة ✅')
            }}
            className={`px-4 py-2 rounded-xl text-[13px] font-bold border-2 transition-all ${sync.enabled ? 'border-rose-300 text-rose-600 hover:bg-rose-500/5' : 'border-emerald-400 text-emerald-600 hover:bg-emerald-500/5'}`}
          >
            {sync.enabled ? 'إيقاف المزامنة' : 'تفعيل المزامنة'}
          </button>
        </div>
        <div className="text-[11px] text-slate-400">معرف هذا الجهاز: <code dir="ltr">{deviceId}</code></div>
      </div>

      {/* لقطات أمان التعارض: حالة الجهاز قبل تطبيق سحابي فوق تغييرات معلقة */}
      {snapshots.length > 0 && (
        <div className={`anim-up ${card} space-y-3`} style={{ animationDelay: '90ms' }}>
          <div className="font-bold text-[13px] flex items-center gap-2"><History size={15} className="text-amber-500" /> لقطات أمان التعارض ({snapshots.length})</div>
          <p className="text-[11.5px] text-slate-400 leading-relaxed">
            حين يصل من السحابة إدخالُ جهازٍ آخر وعندك هنا تغييرات لم تُدفع بعد، يحفظ التطبيق حالة جهازك كاملةً كلقطة قبل التطبيق —
            فلا يضيع إدخال أي جهاز أبداً. نزّل اللقطة لمراجعتها، أو استرجعها لتصبح هي الحالة الحالية (وتُدفع للسحابة).
          </p>
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div key={s.at} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-400/20">
                <div className="text-[12px]">
                  <div className="font-bold text-slate-700 dark:text-slate-200">{s.at.slice(0, 16).replace('T', ' ')}</div>
                  <div className="text-slate-400 text-[10.5px]">{(s.size / 1024).toFixed(1)} ك.ب</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Btn variant="soft" onClick={() => downloadSnapshot(s.at)}><Download size={13} /> تنزيل</Btn>
                  <Btn variant="ghost" onClick={() => restoreSnapshot(s.at)}><Undo2 size={13} /> استرجاع</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* تجهيز قاعدة Supabase */}
      <div className={`anim-up ${card} space-y-3`} style={{ animationDelay: '120ms' }}>
        <div className="font-bold text-[13px] flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-500" /> تجهيز المشروع (مرة واحدة)</div>
        <p className="text-[12px] text-slate-500 leading-relaxed">
          أنشئ مشروعاً مجانياً على supabase.com، ثم افتح SQL Editor وألصق هذا السكربت لإنشاء جدول المزامنة:
        </p>
        <pre dir="ltr" className="text-[10.5px] leading-relaxed bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-x-auto">{CREATE_TABLE_SQL}</pre>
        <Btn variant="ghost" onClick={copySql}><Copy size={14} /> نسخ SQL</Btn>
        <div className="text-[11.5px] text-slate-400 leading-relaxed space-y-1">
          <div>🔒 <b>الخصوصية:</b> بياناتك تُشفَّر على جهازك قبل الرفع — Supabase يخزن شفرة لا تُقرأ بلا «سر التشفير» الذي لا يغادر أجهزتك.</div>
          <div>⚔️ <b>لا ضياع بيانات:</b> لو دفع جهازان معاً، يُقبل الأول ويسحب الثاني الأحدث ويعيد تلقائياً (قفل تفاؤلي).</div>
          <div>📴 <b>أوفلاين دائماً:</b> انقطاع الإنترنت لا يعطل البيع — التغييرات تُدفع عند عودة الاتصال.</div>
        </div>
      </div>
    </div>
  )
}
