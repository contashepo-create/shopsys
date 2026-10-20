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
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, User, Phone, MapPin, Hash, Landmark, Image as ImageIcon } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

const isValidEmail = (v: string) => !v.trim() || /^\S+@\S+\.\S+$/.test(v.trim())

export function CompanyProfilePage() {
  const { setup, updateCompanyProfile, einvoice, updateEinvoice, receipt, activeBranchContext } = useAppStore()
  const toast = useToast()
  // بيانات المنشأة (الاسم/العنوان/السجل التجاري...) عامة للشركة كلها — لا تُعدَّل من داخل فرع مستقل
  // (نفس قاعدة الإعدادات العامة الأخرى في app.store.ts/companySetupPatch). الرقم الضريبي وحده قد
  // يختلف بالفرع فيبقى قابلاً للتعديل دائماً.
  const canEditCompanyWideSettings = !activeBranchContext || activeBranchContext.isMain

  const [shopName, setShopName] = useState(setup.shopName)
  const [ownerName, setOwnerName] = useState(setup.ownerName)
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

  const card = 'anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3'
  const h3 = 'font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2'

  const save = () => {
    if (!shopName.trim()) return toast.show('اسم المنشأة مطلوب', 'error')
    if (!isValidEmail(email)) return toast.show('صيغة البريد الإلكتروني غير صحيحة', 'error')
    try {
      if (canEditCompanyWideSettings) {
        updateCompanyProfile({
          shopName: shopName.trim(),
          ownerName: ownerName.trim(),
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
      }
      updateEinvoice({ taxNumber: taxNumber.trim() })
      toast.show('حُفظت بيانات المنشأة ✓')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  return (
    <div className="max-w-3xl space-y-4" data-company-profile-page>
      <div className="anim-up flex items-center gap-2">
        <Building2 size={22} className="text-brand-500" />
        <h1 className="text-lg font-black text-slate-800 dark:text-white">بيانات المنشأة</h1>
      </div>
      <p className="text-[12px] text-slate-500 dark:text-slate-400 -mt-2">
        كل بيانات منشأتك في مكان واحد — قابلة للتعديل متى شئت. اسم الإيصال المطبوع له حقل مستقل في
        «إعدادات الطباعة» لو أردت اسماً مختلفاً عن اسم المنشأة الرسمي.
      </p>
      {!canEditCompanyWideSettings && (
        <p className="text-[12px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 rounded-xl px-3 py-2">
          أنت داخل فرع «{activeBranchContext?.nameAr}» — بيانات المنشأة عامة للشركة كلها وتُعدَّل من الفرع الرئيسي فقط (الرقم الضريبي وحده يمكن تخصيصه بالفرع).
        </p>
      )}

      {/* ① هوية المنشأة */}
      <section className={card}>
        <h3 className={h3}><Building2 size={17} className="text-brand-500" /> هوية المنشأة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="اسم المنشأة *">
            <input value={shopName} onChange={(e) => setShopName(e.target.value)} className={inputCls} placeholder="اسم منشأتك" disabled={!canEditCompanyWideSettings} />
          </Field>
          <Field label="اسم المالك" icon={<User size={13} className="ml-1 inline" />}>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={inputCls} placeholder="اسم صاحب المنشأة" disabled={!canEditCompanyWideSettings} />
          </Field>
        </div>
      </section>

      {/* ② التواصل */}
      <section className={card}>
        <h3 className={h3}><Phone size={17} className="text-sky-500" /> بيانات التواصل</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder="01xxxxxxxxx" disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="البريد الإلكتروني"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} dir="ltr" placeholder="name@example.com" disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="الموقع الإلكتروني"><input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} dir="ltr" placeholder="www.example.com" disabled={!canEditCompanyWideSettings} /></Field>
        </div>
      </section>

      {/* ③ العنوان */}
      <section className={card}>
        <h3 className={h3}><MapPin size={17} className="text-emerald-500" /> العنوان</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="المدينة"><input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="الشارع / الحي"><input value={street} onChange={(e) => setStreet(e.target.value)} className={inputCls} disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="رقم المبنى"><input value={buildingNo} onChange={(e) => setBuildingNo(e.target.value)} className={inputCls} dir="ltr" disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="الرمز البريدي"><input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={inputCls} dir="ltr" disabled={!canEditCompanyWideSettings} /></Field>
          <Field label="صندوق البريد"><input value={poBox} onChange={(e) => setPoBox(e.target.value)} className={inputCls} dir="ltr" disabled={!canEditCompanyWideSettings} /></Field>
        </div>
      </section>

      {/* ④ البيانات الرسمية */}
      <section className={card}>
        <h3 className={h3}><Landmark size={17} className="text-violet-500" /> البيانات الرسمية</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="السجل التجاري" icon={<Hash size={13} className="ml-1 inline" />}>
            <input value={commercialRegister} onChange={(e) => setCommercialRegister(e.target.value)} className={inputCls} dir="ltr" disabled={!canEditCompanyWideSettings} />
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
        <h3 className={h3}><ImageIcon size={17} className="text-amber-500" /> شعار المنشأة</h3>
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
        <Btn onClick={save}>💾 حفظ بيانات المنشأة</Btn>
      </div>
    </div>
  )
}
