/**
 * الفاتورة الإلكترونية (القرار 30) — ميزة بمفتاح ترخيص فقط:
 * - السعودية (einvoice_sa): رمز QR زاتكا TLV يُطبع تلقائياً على كل فاتورة.
 * - مصر (einvoice_eg): تصدير مستند JSON بصيغة بوابة الضرائب المصرية للرفع.
 * إعدادات الممول هنا: العنوان (محلي لمستند مصر) — أما الرقم الضريبي فيُحرَّر
 * من صفحة «بيانات المنشأة» الموحّدة (مصدر واحد) ويُعرض هنا للقراءة فقط.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileCheck2, Lock, QrCode, FileJson, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore, type SaleInvoice } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { zatcaQrPolicy, egTaxBarcodePolicy } from '../../core/invoiceEdit.ts'
import {
  isValidSaVatNumber, isValidEgTaxNumber, buildEgInvoiceDocument, buildZatcaQr, buildEgReceiptBarcodeText,
} from '../../core/einvoice.ts'
import { Btn, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'

export function EinvoicePage() {
  const { setup, einvoice, updateEinvoice, activatedPayload, trialStartedAt, lastSeenAt, deviceFlags } = useAppStore()
  const { sales, customers, items } = useDataStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const lic = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString(), deviceFlags }),
    [activatedPayload, trialStartedAt, lastSeenAt, deviceFlags],
  )
  const saActive = hasFeature(lic, 'einvoice_sa')
  const egActive = hasFeature(lic, 'einvoice_eg')

  /* حالة الاتصال الحية — سياسة زاتكا الحالية تشترط اتصالاً وقت الطباعة،
     فبدون إظهارها هنا يبحث المستخدم عن سبب غياب الرمز في المكان الخطأ. */
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const refresh = () => setBrowserOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh) }
  }, [])

  const [address, setAddress] = useState(einvoice.address)

  /* بند 4 (طلب المالك): مزامنة حقل العنوان مع المخزن — بلاها بقي الحقل القديم
     معروضاً إذا تغيّرت الإعدادات من موضع آخر أو أُعيد فتح الصفحة. الرقم الضريبي
     لا حقل محلياً له هنا أصلاً (يُقرأ مباشرة من einvoice.taxNumber للعرض فقط —
     تعديله الآن من صفحة «بيانات المنشأة» الموحّدة فلا حاجة لمزامنته هنا).
     النمط: تعديل الحالة أثناء العرض (كما في VouchersPage) — بلا useEffect. */
  const [syncedAddress, setSyncedAddress] = useState(einvoice.address)
  if (syncedAddress !== einvoice.address) { setSyncedAddress(einvoice.address); setAddress(einvoice.address) }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

  /* ─── شاشة القفل: الميزة غير مفعلة بالمفتاح ─── */
  if (!saActive && !egActive) {
    return (
      <div className="max-w-2xl">
        <div className={`anim-up ${card} !p-10 text-center space-y-3`}>
          <Lock className="w-12 h-12 mx-auto text-slate-300" />
          <h1 className="text-xl font-black">الفاتورة الإلكترونية غير مفعّلة</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
            الإصدار الإلكتروني الرسمي والرمز الضريبي غير مفعّلين على هذه المنشأة حالياً.
          </p>
          {/* سياسة المالك: عدم التفعيل لا يوقف الضريبة إطلاقاً — فقط الرمز الضريبي */}
          <div className="text-right max-w-md mx-auto text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed rounded-xl bg-slate-500/5 border border-slate-200 dark:border-slate-700 p-4 space-y-1.5">
            <div>✅ حساب الضريبة وقيودها يعملان طبيعياً حسب بلدك — التعطيل يمنع <b>الرمز الضريبي فقط</b>.</div>
            <div>✅ تعديل الفواتير <b>متاح</b> الآن: يُعكس القيد القديم ويتولد قيد جديد صحيح مع سجل تدقيق.</div>
          </div>
        </div>
      </div>
    )
  }

  const saveSettings = () => {
    updateEinvoice({ address: address.trim() })
    toast.show('حُفظ عنوان المنشأة ✅')
  }

  const exportEgJson = (s: SaleInvoice) => {
    try {
      const customer = s.customerId ? customers.find((c) => c.id === s.customerId) : null
      const doc = buildEgInvoiceDocument({
        issuerName: setup.shopName,
        issuerTaxNumber: einvoice.taxNumber,
        issuerAddress: einvoice.address,
        receiverName: customer?.nameAr ?? '',
        receiverTaxNumber: customer?.taxNumber ?? '',
        invoiceNumber: s.invoiceNumber,
        dateIso: s.date,
        lines: s.lines.map((l) => {
          const item = items.find((it) => it.id === l.itemId)
          const barcode = item?.barcodes?.[0] ?? ''
          const gross = Math.round(l.unitPriceMinor * l.qty)
          const lineNet = Math.round(gross * (1 - l.discountPercent / 100))
          // نصيب السطر من ضريبة الفاتورة بوزنه من الصافي
          const taxShare = s.totals.netMinor > 0 ? Math.round((lineNet / s.totals.netMinor) * s.totals.taxMinor) : 0
          return {
            nameAr: l.nameAr,
            itemCode: barcode || `EG-${l.itemId}`,
            codeType: barcode ? ('GS1' as const) : ('EGS' as const),
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
            discountMinor: gross - lineNet,
            taxMinor: taxShare,
          }
        }),
        totalDiscountMinor: s.totals.discountMinor,
        totalTaxMinor: s.totals.taxMinor,
        totalMinor: s.totals.totalMinor,
        decimals: cur.decimals,
      })
      const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `eta-${s.invoiceNumber}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 3000)
      toast.show(`صُدّر مستند ${s.invoiceNumber} بصيغة البوابة المصرية 📄`)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const qrPreview = (() => {
    if (!saActive || !einvoice.taxNumber || !isValidSaVatNumber(einvoice.taxNumber)) return null
    try {
      return buildZatcaQr({
        sellerName: setup.shopName || 'تَحَكَّم',
        vatNumber: einvoice.taxNumber,
        timestampIso: new Date().toISOString(),
        totalWithVatMinor: 115000,
        vatMinor: 15000,
        decimals: cur.decimals,
      })
    } catch { return null }
  })()

  /* معاينة رمز التحقق المحلي المصري — يُطبع على كل إيصال مصري عند تفعيل المفتاح */
  const egBarcodePreview = (() => {
    if (!egActive || saActive || !einvoice.taxNumber || !isValidEgTaxNumber(einvoice.taxNumber)) return null
    try {
      return buildEgReceiptBarcodeText({
        sellerName: setup.shopName || 'تَحَكَّم',
        taxNumber: einvoice.taxNumber,
        invoiceNumber: 'INV-0001',
        dateIso: new Date().toISOString(),
        totalMinor: 115000,
        decimals: cur.decimals,
      })
    } catch { return null }
  })()

  /* تشخيص «لماذا لا يظهر الباركود؟» — كل شرط على حدة بدل تخمين المستخدم.
     نفس شروط maybeTaxBarcode تماماً (الترخيص + تشغيل الإصدار + الرقم + الاسم + المفتاح + الاتصال). */
  const sellerNameReady = setup.shopName.trim().length > 0
  const taxNumberValid = saActive ? isValidSaVatNumber(einvoice.taxNumber) : isValidEgTaxNumber(einvoice.taxNumber)
  const barcodePolicy = saActive
    ? zatcaQrPolicy({ featureActive: einvoice.enabled === true, online: browserOnline, printEnabled: einvoice.printZatcaQr })
    : egTaxBarcodePolicy({ featureActive: einvoice.enabled === true, printEnabled: einvoice.printZatcaQr })
  const barcodeWillPrint = barcodePolicy.printQr && taxNumberValid && sellerNameReady
  const barcodeBlocker = !einvoice.enabled
    ? 'الإصدار الإلكتروني الرسمي غير مشغَّل — فعّل «تشغيل الإصدار الإلكتروني الرسمي» في بطاقة بيانات الممول أدناه، ثم أعد الطباعة.'
    : !barcodePolicy.printQr
      ? barcodePolicy.reasonAr
      : !taxNumberValid
        ? (saActive ? 'الرقم الضريبي غير مطابق لصيغة زاتكا (15 رقماً يبدأ وينتهي بـ3).' : 'رقم التسجيل الضريبي المصري يجب أن يكون 9 أرقام.')
        : !sellerNameReady
          ? 'اسم المنشأة فارغ — عرّفه من «بيانات المنشأة» ليظهر في رمز زاتكا.'
          : null

  const recentSales = [...sales].reverse().slice(0, 20)

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center gap-2 flex-wrap">
        {saActive && (
          <span className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-emerald-500/10 text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={12} /> زاتكا السعودية مفعلة
          </span>
        )}
        {egActive && (
          <span className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-emerald-500/10 text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={12} /> البوابة المصرية مفعلة
          </span>
        )}
        <span className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-rose-500/10 text-rose-500">
          🔒 تعديل الفواتير موقوف — التصحيح بإشعار دائن/مدين فقط
        </span>
      </div>

      {/* سياسة المرحلة الثانية (زاتكا): الربط يتطلب إنترنت — بلا اتصال لا يُطبع الرمز الضريبي */}
      {saActive && (
        <div className="anim-up rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] p-4 text-[12.5px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1">
          <div className="font-bold text-sky-700 dark:text-sky-400">📡 المرحلة الثانية — الربط والتكامل:</div>
          <div>• الفاتورة الضريبية تتطلب اتصالاً بالإنترنت وقت الطباعة. بلا اتصال: تُطبع فاتورة عادية <b>بدون رمز QR الضريبي</b> — ومبلغ الضريبة يُحسب ويُرحّل في القيود طبيعياً.</div>
          <div>• لأن الفواتير مرتبطة بالمنظومة، لا تُعدَّل بعد الإصدار: التخفيض بإشعار دائن (مرتجع مبيعات) والزيادة بإشعار مدين (فاتورة إضافية).</div>
        </div>
      )}

      {/* تشخيص مباشر: هل سيُطبع الرمز على الفاتورة القادمة؟ وأي شرط يمنعه؟
          أُضيف بعد بلاغ المالك (2026-10-22): فاتورة نقدية بلا باركود رغم تفعيل زاتكا. */}
      <div className={`anim-up rounded-2xl border p-4 text-[12.5px] leading-relaxed space-y-2 ${barcodeWillPrint ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.06]'}`} data-tax-barcode-diagnosis>
        <div className="flex flex-wrap items-center gap-2">
          <QrCode size={16} className={barcodeWillPrint ? 'text-emerald-600' : 'text-amber-600'} />
          <b className={barcodeWillPrint ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
            {barcodeWillPrint ? 'الرمز الضريبي سيُطبع على الفاتورة القادمة ✓' : 'الرمز الضريبي لن يُطبع الآن'}
          </b>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
          <span>{einvoice.enabled === true ? '✓' : '✗'} تشغيل الإصدار الإلكتروني الرسمي</span>
          <span>{taxNumberValid ? '✓' : '✗'} {saActive ? 'الرقم الضريبي (15 رقماً يبدأ وينتهي بـ3)' : 'رقم التسجيل الضريبي (9 أرقام)'}</span>
          <span>{sellerNameReady ? '✓' : '✗'} اسم المنشأة في رمز البائع</span>
          <span>{einvoice.printZatcaQr ? '✓' : '✗'} خيار طباعة الرمز الضريبي</span>
          {saActive && <span className={browserOnline ? '' : 'text-amber-600 font-bold'}>{browserOnline ? '✓' : '✗'} اتصال الإنترنت (تشترطه سياسة زاتكا الحالية)</span>}
        </div>
        {barcodeBlocker && <div className="text-amber-700 dark:text-amber-400 font-bold">السبب: {barcodeBlocker}</div>}
        {barcodeWillPrint && <div className="text-slate-500 dark:text-slate-400">ينطبق على الطباعة من الكاشير ومحرر فاتورة المبيعات وأي إعادة طباعة من قائمة الفواتير.</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* إعدادات الممول — ثلاث مجموعات مرئية واضحة بدل حقول متناثرة بلا تجميع:
            ① تفعيل المنظومة ② بيانات الممول (جنباً لجنب) ③ تفضيلات الطباعة */}
        <div className={`anim-up ${card} space-y-3`}>

          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <FileCheck2 size={17} className="text-slate-500" /> بيانات الممول
          </div>

          <label className="flex items-center gap-2 text-[13px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer rounded-xl bg-slate-50 dark:bg-slate-800/40 p-2.5">
            <input type="checkbox" checked={einvoice.enabled === true} onChange={(e) => updateEinvoice({ enabled: e.target.checked })} className="w-4 h-4 accent-emerald-600 shrink-0" />
            تشغيل الإصدار الإلكتروني الرسمي وربط دورة المستندات
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            <Field
              label={saActive ? 'الرقم الضريبي (زاتكا: 15 رقماً يبدأ وينتهي بـ3)' : 'رقم التسجيل الضريبي (مصر: 9 أرقام)'}
              hint="يُحرَّر من صفحة «بيانات المنشأة» — مصدر واحد لا يتكرر"
            >
              <div className="flex items-center gap-2">
                <input value={einvoice.taxNumber} readOnly placeholder={saActive ? '310122393500003' : '123456789'} className={`${inputCls} opacity-70 cursor-not-allowed`} dir="ltr" />
                <Link to="/settings/company" className="shrink-0 text-[11px] font-bold text-brand-600 hover:underline whitespace-nowrap">تعديل ←</Link>
              </div>
            </Field>
            <Field label="عنوان المنشأة" hint="يظهر في مستند البوابة المصرية">
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="شارع، مدينة" className={inputCls} />
            </Field>
          </div>
          {saActive && einvoice.taxNumber && !isValidSaVatNumber(einvoice.taxNumber) && (
            <div className="text-[12px] text-amber-600 flex items-center gap-1.5 -mt-1"><AlertTriangle size={13} className="shrink-0" /> الرقم المحفوظ غير مطابق لصيغة زاتكا — لن يُطبع الرمز حتى تصحيحه</div>
          )}
          {egActive && !saActive && einvoice.taxNumber && !isValidEgTaxNumber(einvoice.taxNumber) && (
            <div className="text-[12px] text-amber-600 flex items-center gap-1.5 -mt-1"><AlertTriangle size={13} className="shrink-0" /> الرقم المحفوظ غير مطابق لصيغة التسجيل المصري (9 أرقام) — لن يُطبع الرمز حتى تصحيحه</div>
          )}

          {/* مفتاح طباعة الرمز الضريبي — يعيش هنا فقط داخل الفاتورة الإلكترونية،
              لا علاقة له بإعدادات الضريبة العامة. يعمل لأي من البلدين المفعّلين. */}
          {(saActive || egActive) && (
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-2.5">
              <input type="checkbox" checked={einvoice.printZatcaQr} onChange={(e) => updateEinvoice({ printZatcaQr: e.target.checked })} className="w-4 h-4 accent-emerald-600 shrink-0" />
              طباعة الرمز الضريبي ({saActive ? 'QR زاتكا' : 'رمز تحقق محلي'}) على كل فاتورة تلقائياً
            </label>
          )}

          <Btn onClick={saveSettings}>💾 حفظ العنوان</Btn>
        </div>

        {/* معاينة الرمز الضريبي */}
        {saActive && (
          <div className={`anim-up ${card} space-y-3`}>
            <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
              <QrCode size={17} className="text-slate-500" /> معاينة رمز زاتكا
            </div>
            {qrPreview ? (
              <>
                <div className="text-[12px] text-slate-500">سلسلة TLV Base64 لفاتورة تجريبية (1150.00 بضريبة 150.00):</div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 font-mono text-[10px] break-all" dir="ltr">{qrPreview}</div>
                <div className="text-[12px] text-emerald-600 font-bold">✓ الصيغة سليمة — سيُطبع الرمز على الفواتير القادمة</div>
              </>
            ) : (
              <div className="text-[12.5px] text-slate-400">أدخل رقماً ضريبياً سعودياً صالحاً واحفظه لترى المعاينة</div>
            )}
          </div>
        )}
        {egActive && !saActive && (
          <div className={`anim-up ${card} space-y-3`}>
            <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
              <QrCode size={17} className="text-slate-500" /> معاينة رمز التحقق المحلي
            </div>
            {egBarcodePreview ? (
              <>
                <div className="text-[12px] text-slate-500">نص الرمز لفاتورة تجريبية (1150.00 جنيه):</div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 font-mono text-[10px] break-all" dir="ltr">{egBarcodePreview}</div>
                <div className="text-[12px] text-emerald-600 font-bold">✓ الصيغة سليمة — سيُطبع الرمز على الفواتير القادمة</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">رمز تحقق محلي يطبع على الإيصال — منفصل عن رفع مستند JSON لبوابة الضرائب المصرية أدناه.</div>
              </>
            ) : (
              <div className="text-[12.5px] text-slate-400">أدخل رقم تسجيل ضريبي مصري صالحاً (9 أرقام) واحفظه لترى المعاينة</div>
            )}
          </div>
        )}
      </div>

      {/* تصدير مصر */}
      {egActive && (
        <div className={`anim-up ${card} space-y-3`}>
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <FileJson size={17} className="text-slate-500" /> تصدير مستندات البوابة المصرية (آخر 20 فاتورة)
          </div>
          {recentSales.length === 0 ? (
            <EmptyState icon="🧾" title="لا فواتير بعد" sub="أصدر فواتير من الكاشير ثم صدّرها من هنا بصيغة البوابة" />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-white">{s.invoiceNumber}</span>
                    <span className="text-[11px] text-slate-400 mr-2">{s.date.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-black text-[13px]">{fmt(s.totals.totalMinor)} {cur.symbol}</span>
                    <Btn variant="ghost" onClick={() => exportEgJson(s)}><Download size={14} /> JSON</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
