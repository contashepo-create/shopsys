/**
 * بيانات المنشأة — صفحة موحّدة (طلب المالك):
 * قبلها كانت هوية المنشأة (اسم المالك/الهاتف/البريد/العنوان) تُكتب مرة واحدة
 * فقط في معالج الإعداد الأول بلا أي شاشة لاحقة لتعديلها، والسجل التجاري
 * وصندوق البريد غير موجودين أصلاً كحقول للمنشأة نفسها (كانا فقط لبيانات
 * العملاء/الموردين). هذه الصفحة تجمع كل بيانات المنشأة في مكان واحد وتتيح
 * تعديلها بحرية في أي وقت.
 *
 * الرقم الضريبي للمنشأة يبقى مخزَّناً في مكانه الأصلي (إعدادات الفاتورة
 * الإلكترونية einvoice.taxNumber) — هذه الصفحة تحرّره مباشرة فلا يتكرر
 * التخزين في مكانين، وتتيح تعبئته حتى لو ميزة الفاتورة الإلكترونية غير
 * مفعّلة بالترخيص (كانت شاشتها تُقفَل بالكامل فلا سبيل لإدخاله إطلاقاً).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, User, Phone, MapPin, Hash, Landmark, Image as ImageIcon } from 'lucide-react'
import { branchIdentityMissingFields, useAppStore } from '../../stores/app.store.ts'
import { secureStorage } from '../../data/secureStorage.ts'
import { Btn, Field, inputCls, useToast, useUnsavedChangesGuard } from '../components/ui.tsx'

// عمليات المسودة لنفس الكيان تُنفّذ بترتيبها حتى لو استغرق التشفير أو فكّه
// وقتاً أطول؛ تبقى الطوابير حية بين فك الصفحة وإعادة تركيبها.
const profileDraftQueues = new Map<string, Promise<unknown>>()
function queueProfileDraft<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileDraftQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  profileDraftQueues.set(key, next)
  void next.finally(() => { if (profileDraftQueues.get(key) === next) profileDraftQueues.delete(key) }).catch(() => undefined)
  return next
}

const isValidEmail = (v: string) => !v.trim() || /^\S+@\S+\.\S+$/.test(v.trim())
type CompanyProfileDraft = Record<'shopName' | 'ownerName' | 'phone' | 'email' | 'website' | 'city' | 'street' | 'buildingNo' | 'postalCode' | 'poBox' | 'commercialRegister' | 'taxNumber', string>
const COMPANY_DRAFT_FIELDS: readonly (keyof CompanyProfileDraft)[] = ['shopName', 'ownerName', 'phone', 'email', 'website', 'city', 'street', 'buildingNo', 'postalCode', 'poBox', 'commercialRegister', 'taxNumber']
function readCompanyProfileDraft(serialized: string | null): CompanyProfileDraft | null {
  try {
    const parsed = JSON.parse(serialized ?? 'null') as { version?: unknown; fields?: unknown } | null
    if (parsed?.version !== 1 || !parsed.fields || typeof parsed.fields !== 'object') return null
    const fields = parsed.fields as Record<string, unknown>
    if (!COMPANY_DRAFT_FIELDS.every((field) => typeof fields[field] === 'string')) return null
    return fields as CompanyProfileDraft
  } catch { return null }
}

function CompanyProfileForm() {
  const { setup, updateCompanyProfile, einvoice, updateEinvoice, receipt, activeBranchContext } = useAppStore()
  const toast = useToast()
  // كل فرع يملك هويته القانونية وبيانات اتصاله وعنوانه وسجلّه التجاري
  // بصورة مستقلة. setup/einvoice هنا هما القيم الفعالة للسياق الحالي،
  // وتوجيه الحفظ إلى ملف الفرع أو ملف الرئيسي يتم داخل app.store.
  const isBranchScope = !!activeBranchContext && !activeBranchContext.isMain
  const draftStorageKey = `shopsys-company-profile-draft-v1:${isBranchScope ? activeBranchContext?.id ?? 'branch' : 'main'}`
  const [restoredDraft, setRestoredDraft] = useState<CompanyProfileDraft | null>(null)
  const [draftReady, setDraftReady] = useState(false)

  const [shopName, setShopName] = useState(setup.shopName)
  const [ownerName, setOwnerName] = useState(isBranchScope ? '' : setup.ownerName)
  const [phone, setPhone] = useState(setup.phone)
  const [email, setEmail] = useState(setup.email)
  const [website, setWebsite] = useState(setup.website ?? '')
  const [city, setCity] = useState(setup.city)
  const [street, setStreet] = useState(setup.street)
  const [buildingNo, setBuildingNo] = useState(setup.buildingNo ?? '')
  const [postalCode, setPostalCode] = useState(setup.postalCode ?? '')
  const [poBox, setPoBox] = useState(setup.poBox ?? '')
  const [commercialRegister, setCommercialRegister] = useState(setup.commercialRegister ?? '')
  const [taxNumber, setTaxNumber] = useState(einvoice.taxNumber)
  useEffect(() => {
    let active = true
    void queueProfileDraft(draftStorageKey, () => Promise.resolve(secureStorage.getItem(draftStorageKey))).then((serialized) => {
      const draft = readCompanyProfileDraft(serialized)
      // الكتابة المشفّرة التي تلي التهيئة ترحّل تلقائياً أي مسودة قديمة كانت
      // كنص صريح إلى التنسيق المحمي من دون ترك كتابة ترحيل متسابقة بالخلفية.
      if (!active) return
      if (draft) {
        setShopName(draft.shopName); setOwnerName(draft.ownerName); setPhone(draft.phone); setEmail(draft.email)
        setWebsite(draft.website); setCity(draft.city); setStreet(draft.street); setBuildingNo(draft.buildingNo)
        setPostalCode(draft.postalCode); setPoBox(draft.poBox); setCommercialRegister(draft.commercialRegister); setTaxNumber(draft.taxNumber)
      }
      setRestoredDraft(draft)
      setDraftReady(true)
    }).catch(() => { if (active) setDraftReady(true) })
    return () => { active = false }
  }, [draftStorageKey])
  const profileDraft: CompanyProfileDraft = { shopName, ownerName, phone, email, website, city, street, buildingNo, postalCode, poBox, commercialRegister, taxNumber }
  const profileDraftJson = JSON.stringify(profileDraft)
  const profileDraftStorageJson = JSON.stringify({ version: 1, fields: profileDraft })
  const savedProfileDraft: CompanyProfileDraft = {
    shopName: setup.shopName, ownerName: isBranchScope ? '' : setup.ownerName, phone: setup.phone, email: setup.email,
    website: setup.website ?? '', city: setup.city, street: setup.street, buildingNo: setup.buildingNo ?? '',
    postalCode: setup.postalCode ?? '', poBox: setup.poBox ?? '', commercialRegister: setup.commercialRegister ?? '', taxNumber: einvoice.taxNumber,
  }
  const unsaved = useUnsavedChangesGuard(profileDraftJson, JSON.stringify(savedProfileDraft))
  useEffect(() => {
    if (!draftReady) return
    void queueProfileDraft(draftStorageKey, () => Promise.resolve(secureStorage.setItem(draftStorageKey, profileDraftStorageJson))).catch(() => {
      /* يبقى حارس الإغلاق فعالاً حتى عند تعذر التخزين */
    })
  }, [draftReady, draftStorageKey, profileDraftStorageJson])


  const identityMissing = isBranchScope
    ? branchIdentityMissingFields({ shopName, phone, city, street, commercialRegister }, { taxNumber })
    : []

  const card = 'anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3'
  const h3 = 'font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2'

  const save = () => {
    if (!shopName.trim()) return toast.show('اسم المنشأة مطلوب', 'error')
    if (!isValidEmail(email)) return toast.show('صيغة البريد الإلكتروني غير صحيحة', 'error')
    try {
      updateCompanyProfile({
        shopName: shopName.trim(),
        // اسم مالك الشركة الأم لا يدخل ملف هوية الفرع ولا يُعدَّل منه.
        ...(isBranchScope ? {} : { ownerName: ownerName.trim() }),
        phone: phone.trim(),
        email: email.trim(),
        website: website.trim(),
        city: city.trim(),
        street: street.trim(),
        buildingNo: buildingNo.trim(),
        postalCode: postalCode.trim(),
        poBox: poBox.trim(),
        commercialRegister: commercialRegister.trim(),
      })
      updateEinvoice({ taxNumber: taxNumber.trim() })
      unsaved.markClean()
      setRestoredDraft(null)
      void queueProfileDraft(draftStorageKey, () => Promise.resolve(secureStorage.removeItem(draftStorageKey))).catch(() => { /* لا يؤثر في نجاح حفظ الإعدادات */ })
      toast.show(isBranchScope ? `حُفظت هوية «${shopName.trim()}» المستقلة ✓` : 'حُفظت بيانات المنشأة ✓')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  return (
    <div className="max-w-3xl space-y-4" data-company-profile-page>
      {unsaved.prompt}
      {(unsaved.isDirty || restoredDraft) && <div role="status" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-300" data-settings-unsaved>{restoredDraft ? 'استُعيدت مسودة بيانات المنشأة غير المحفوظة من هذا الجهاز؛ راجعها ثم احفظها.' : 'لديك تغييرات لم تحفظها كإعداد بعد؛ سيطلب التطبيق تأكيداً قبل المغادرة.'}</div>}
      <div className="anim-up flex items-center gap-2">
        <Building2 size={22} className="text-brand-500" />
        <h1 className="text-lg font-black text-slate-800 dark:text-white">
          {isBranchScope ? `بيانات المنشأة — ${activeBranchContext?.nameAr}` : 'بيانات المنشأة'}
        </h1>
      </div>
      <p className="text-[12px] text-slate-500 dark:text-slate-400 -mt-2">
        {isBranchScope
          ? 'هذه الهوية القانونية تخص هذا الكيان وحده وتظهر على فواتيره وتقاريره، ولن تؤثر في هوية أي كيان آخر.'
          : 'كل بيانات منشأتك في مكان واحد — قابلة للتعديل متى شئت. اسم الإيصال المطبوع له حقل مستقل في «إعدادات الطباعة» لو أردت اسماً مختلفاً عن اسم المنشأة الرسمي.'}
      </p>
      {isBranchScope && identityMissing.length > 0 && (
        <p className="flex items-start gap-2 text-[12px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 rounded-xl px-3 py-2" data-branch-identity-warning>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            الهوية غير مكتملة ({identityMissing.join('، ')}). ستُطبع المستندات باسم المنشأة فقط، ولن تُستعار أي بيانات من المنشأة الرئيسية، حتى تستكمل هذه البيانات.
          </span>
        </p>
      )}

      {/* ① هوية المنشأة */}
      <section className={card}>
        <h3 className={h3}><Building2 size={17} className="text-brand-500" /> هوية المنشأة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="اسم المنشأة *">
            <input value={shopName} onChange={(e) => setShopName(e.target.value)} className={inputCls} placeholder="اسم منشأتك" />
          </Field>
          {!isBranchScope && (
            <Field label="اسم المالك" icon={<User size={13} className="ml-1 inline" />}>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={inputCls} placeholder="اسم صاحب المنشأة" />
            </Field>
          )}
        </div>
      </section>

      {/* ② التواصل */}
      <section className={card}>
        <h3 className={h3}><Phone size={17} className="text-sky-500" /> بيانات التواصل</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder="01xxxxxxxxx" /></Field>
          <Field label="البريد الإلكتروني"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} dir="ltr" placeholder="name@example.com" /></Field>
          <Field label="الموقع الإلكتروني"><input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} dir="ltr" placeholder="www.example.com" /></Field>
        </div>
      </section>

      {/* ③ العنوان */}
      <section className={card}>
        <h3 className={h3}><MapPin size={17} className="text-emerald-500" /> العنوان</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="المدينة"><input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} /></Field>
          <Field label="الشارع / الحي"><input value={street} onChange={(e) => setStreet(e.target.value)} className={inputCls} /></Field>
          <Field label="رقم المبنى"><input value={buildingNo} onChange={(e) => setBuildingNo(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label="الرمز البريدي"><input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label="صندوق البريد"><input value={poBox} onChange={(e) => setPoBox(e.target.value)} className={inputCls} dir="ltr" /></Field>
        </div>
      </section>

      {/* ④ البيانات الرسمية */}
      <section className={card}>
        <h3 className={h3}><Landmark size={17} className="text-violet-500" /> البيانات الرسمية</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="السجل التجاري" icon={<Hash size={13} className="ml-1 inline" />}>
            <input value={commercialRegister} onChange={(e) => setCommercialRegister(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
          <Field label="الرقم الضريبي" hint="نفس الرقم المستخدم في الفاتورة الإلكترونية (إن فُعّلت) — مصدر واحد لا يتكرر">
            <input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
        </div>
        <p className="text-[11px] text-slate-400">
          تفعيل إصدار الفاتورة الإلكترونية الرسمي ورمزها الضريبي من <Link to="/settings/einvoice" className="font-bold text-brand-600 hover:underline">شاشة الفاتورة الإلكترونية</Link>.
        </p>
      </section>

      {/* ⑤ الشعار — رابط سريع فقط، لا تخزين مكرر */}
      <section className={card}>
        <h3 className={h3}><ImageIcon size={17} className="text-amber-500" /> {isBranchScope ? 'شعار هذا الكيان' : 'شعار المنشأة'}</h3>
        <div className="flex items-center gap-3">
          {receipt.logoDataUrl ? (
            <img src={receipt.logoDataUrl} alt="الشعار" className="w-14 h-14 object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-1" />
          ) : (
            <div className="w-14 h-14 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 grid place-items-center text-[10px] text-slate-400">بلا شعار</div>
          )}
          <Link to="/settings/printing" className="text-[12px] font-bold text-brand-600 hover:underline">
            {receipt.logoDataUrl ? 'تغيير الشعار من إعدادات الطباعة ←' : 'رفع شعار من إعدادات الطباعة ←'}
          </Link>
        </div>
      </section>

      <div className="flex justify-end">
        <Btn onClick={save}>💾 {isBranchScope ? 'حفظ هوية هذا الكيان' : 'حفظ بيانات المنشأة'}</Btn>
      </div>
    </div>
  )
}

/** إعادة تركيب نموذج التحرير عند تبديل الكيان تمنع بقاء مسودة فرع سابق. */
export function CompanyProfilePage() {
  const activeBranchContext = useAppStore((state) => state.activeBranchContext)
  const scopeKey = activeBranchContext
    ? `${activeBranchContext.id}:${activeBranchContext.isMain ? 'main' : 'branch'}`
    : 'main'
  return <CompanyProfileForm key={scopeKey} />
}
