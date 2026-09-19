# AGENTS.md — دليل الذكاء الاصطناعي الكامل لمشروع «تَحَكَّم» TAHAKAM ERP

> **اقرأ هذا الملف كاملاً قبل أي تعديل.** هو المرجع الوحيد الذي يحوي كل ما يعرفه من بنى المشروع.
> **قاعدة إلزامية**: حدّث هذا الملف مع كل تغيير جوهري، وادفع (`git push`) بعد كل جلسة تعديل مكتملة — دائماً.

---

## 1) ما هو المشروع

**«تَحَكَّم» TAHAKAM ERP** — نظام محاسبة وكاشير وإدارة عربي متعدد الأنشطة (18 نشاطاً) متعدد الدول (19 دولة عربية)، منافس لـEasy Store وأنظمة الأنشطة الرأسية العالمية (Foodics للمطاعم، RepairDesk للموبايلات، أنظمة الصاغة، pro-acc للمقاولات…). الهدف: **محاسبة متكاملة وإدارة متكاملة لكل نشاط** بمحرك قيود مزدوجة مخفي التعقيد عن المستخدم.

- **المالك**: م/ محمد عبدة — توقيع الملكية «تطوير وملكية حصرية — جميع الحقوق محفوظة م / محمد عبدة» (عبدة بالتاء المربوطة) يظهر في «حول» وشاشة القفل وذيل الشريط الجانبي.
- **شعار المطور**: `app/public/dev-logo.png` (نسر تركوازي/ذهبي + M-A). شعار التطبيق بالإنجليزية ثلاثي الأبعاد.
- **اللغة**: الواجهة والتقارير والرسائل كلها **عربية**. أخطاء الـcore تُرمى بنصوص عربية جاهزة للعرض.
- الفرع الوحيد للعمل: `arena/01a09c43-shopsys` — لا تنشئ فروعاً أخرى.

## 2) البنية والتقنيات

```
/home/user/shopsys
├── AGENTS.md                    ← هذا الملف
├── docs/
│   ├── وثيقة_التصميم_والقرارات.md      ← القرارات 1–36 المعتمدة من المالك
│   └── تقرير_مراجعة_الأنشطة_والمقارنة_المعيارية.md
├── cloud/worker.js + wrangler.toml     ← Cloudflare Worker (shopsys-control.contashepo.workers.dev)
└── app/                         ← تطبيق Vite + React 19 + TypeScript + Tailwind v4 + zustand v5
    ├── scripts/                 ← 54 سكربت تحقق verify_*.mjs + license_tool.mjs
    ├── public/                  ← أيقونات وشعارات
    └── src/
        ├── core/                ← 51 وحدة منطق نقي (بلا React) — كل القيود والحسابات هنا
        ├── data/repo.ts         ← المخزن المركزي zustand (~4400 سطر) + secureStorage (تشفير) + syncClient/syncRunner (Supabase)
        ├── stores/app.store.ts  ← إعدادات التهيئة (دولة/نشاط/ضريبة/ترخيص/مظهر)
        ├── ui/pages/            ← 50 صفحة
        ├── ui/components/       ← ui.tsx (Modal/Field/Btn/EmptyState/useToast/inputCls) + TreasuryPicker + PaySourcePicker
        ├── ui/navCatalog.tsx    ← شجرة القائمة الجانبية (مجموعات بألوان، فلترة بالموديولات المفعلة)
        └── App.tsx              ← المسارات
```

- **4 طبقات جاهزة للـElectron** (core نقي / data / ui / منصة). **المثبّت NSIS/Electron مؤجل حتى يطلبه المالك صراحة.**
- كل المبالغ **أعداد صحيحة بالوحدة الصغرى (minors/مليمات)** — لا كسور عشرية في الحسابات أبداً.
- البيانات في localStorage مشفرة عبر `secureStorage.ts`، `DATA_VERSION = 9` مع ترحيل بافتراضات `?? []` لكل مصفوفة جديدة.
- الترخيص Ed25519 مربوط بـdeviceId + النشاط، ويُحرق عند مسح قاعدة البيانات أو تغيير النشاط. تجربة 14 يوماً. المفتاح العام: `fBHN_qnQPMzYrgYRTYndwwsZUEWfXCASFQHl4G0Td9g`.
- إصدار مفتاح: `SHOPSYS_PRIVATE_KEY=... node scripts/license_tool.mjs issue --device X --plan pro --days 365 --activity pharmacy`.

## 3) حلقة التحقق الإلزامية (قبل أي كوميت)

```bash
cd /home/user/shopsys/app
npx tsc -b                                             # يجب أن يمر صفر أخطاء (شغّله من app/ حصراً)
npx oxlint src                                         # صفر errors (warnings مقبولة)
node --experimental-strip-types scripts/verify_<x>.mjs # سكربت الميزة الجديدة
# الحزمة الكاملة (54 سكربتاً — يجب 0 فشل):
for f in scripts/verify_*.mjs; do node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done
```

**الوضع الحالي: 1822 اختباراً ناجحاً عبر 54 سكربتاً، صفر فشل.** أي ميزة جديدة = سكربت تحقق جديد يغطي القيود والرفض والتوازن.

### قالب سكربت التحقق (Node بلا متصفح)
```js
const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v) => mem.set(k,String(v)), removeItem: k => mem.delete(k) }
globalThis.window = globalThis
const { useDataStore } = await import('../src/data/repo.ts')  // .ts صراحة، لا .tsx أبداً
const S = () => useDataStore.getState()
// bal(code) = Σ debit-credit للحساب؛ balanced() = Σ مدين == Σ دائن — افحصهما بعد كل عملية
```

## 4) دفتر الحسابات (كامل — كما في core/ledger.ts)

| كود | الحساب | كود | الحساب |
|---|---|---|---|
| 1101 | الخزينة الرئيسية | 2101 | الموردون |
| 1102 | البنوك | 2102 | ض.ق.م مستحقة |
| 1103 | المخزون | 2103 | تأمينات مستردة (إيجار) |
| 1104 | العملاء | 2104 | رواتب مستحقة |
| 1105 | محتجزات ضمان أعمال (لنا) | 2105 | عمولات أطباء مستحقة |
| 1106 | أوراق قبض | 2106 | أوراق دفع |
| 1107 | سلف الموظفين | 2107 | مستحق للموظفين (فائض عهد) |
| 1108 | عهد الموظفين | 2108 | محتجزات مقاولي الباطن |
| 1109 | هوامش خطابات الضمان | 2109 | دفعات مقدمة من العملاء |
| 1110 | مطالبات جهات تأمين وتعاقد | 2110 | مستحق لملاك سيارات الأمانة |
| 1111 | دفعات مقدمة لمقاولي الباطن | 2110 | مستحق لملاك سيارات الأمانة |
| 1201/1202 | أصول ثابتة / مجمع إهلاك | 2111 | مستحقات سائقين |
| 2112 | ضريبة استقطاع مستحقة (مقاولو باطن) |
| 3101/3102 | رأس المال / أرباح مرحلة | | |
| 4101–4109 | مبيعات/مرتجعات/صيانة/إيجار/نقلات/تحاليل/مقاولات/كشف/عمولات أمانة | 5101–5110 | COGS/رواتب/إيجار/مرافق/تشغيل معدات/نقلات/إهلاك/عمومية/عمولات محيلين/تكاليف مشاريع |

خزائن إضافية تُنشأ بأكواد جديدة عبر `addTreasury(name, 'cash'|'bank')`. كل عملية نقدية في النظام تتيح اختيار الخزينة/البنك (وأحياناً العهدة) عبر `TreasuryPicker`/`PaySourcePicker`.

**SourceType** (كل قيد يحمل نوع مصدره): sale, sale_return, purchase, purchase_return, receipt_voucher, payment_voucher, adjustment, payroll, rental_contract, logistics_trip, maintenance_ticket, lab_order, lab_commission, lab_commission_payout, clinic_visit, project_extract, project_cost, retention_release, sub_certificate, sub_payment, bond_issue, bond_settle, client_advance, daily_wages, production, scrap_purchase, scrap_sale, equipment_cost, consignment_sale, consignment_payout, driver_settlement, insured_sale, claim_settlement, car_purchase, car_sale, cheque_*.

**refCode**: `PREFIX-YYMMDD-XXXXXC` بأبجدية `23456789ABCDEFGHJKMNPQRSTUVWXYZ` وخانة تحقق. البادئات: SAL, PUR, SRT, PRT, PRD (إنتاج), SCR (كسر ذهب).

## 5) الأنشطة الـ18 وموديولاتها

الموديولات (BusinessModule): pos, inventory, purchases, installments, recipes, processing, jewelry, maintenance, laundry, equipment_rental, logistics, lab, contracting, clinic, cars, wallet_services. تُفعَّل حسب النشاط وقابلة للتبديل من الإعدادات، والقائمة الجانبية تُفلتر بها.

**دفعة الجزارة والتمور (سبتمبر 2026)**: نشاطان جديدان `butcher` 🥩 و`dates` 🌴 (16→18) بوحدة `processing` جديدة (`core/processing.ts` — خام واحد → نواتج متعددة، عكس recipes): توزيع التكلفة على النواتج **بالقيمة البيعية النسبية** (joint cost allocation بالمعيار العالمي) بتقريب «الباقي للأكبر» فيصفّي بالقرش دائماً؛ فاقد موثق بلا تكلفة؛ نسبة تصافٍ لكل أمر؛ حقول توثيق SFDA اختيارية (بلد المنشأ/رقم المسلخ أو منشأة التعبئة/شهادة الحلال/تاريخ الذبح أو الجني/الموسم). القيد: 1103 مدين (نواتج) / 1103 دائن (خام) + خزينة دائن (مصاريف تجهيز) — `sourceType: 'processing'`، بادئات CUT/PKG في refcode. `postProcessing` في repo (فحص رصيد الخام + خام≠ناتج + متوسط مرجح جديد لكل ناتج). الصفحة `ProcessingPage.tsx` على `/inventory/processing` (معاينة توزيع حية + توثيق SFDA)، بند nav «التقطيع والفرز والتعبئة» بوحدة processing. الثيمات: شخصيتان جديدتان `butcher` و`oasis` في activityTheme + لوحتا ألوان `crimson` و`date_palm` في appearance (ACCENTS الآن 13) + ويدجت `yield_today`. كارت الصنف (itemLedger) يعرض حركات processing (الحقل اختياري للتوافق). سكربتات ×16 حُدثت إلى 18 (10 سكربتات + activities_complete + theming + coverage + e2e_registration + appearance=13 لوحة). الفحص الشامل: `scripts/verify_butcher_dates.mjs` (87 فحصاً — دورتان سعوديتان كاملتان بزاتكا QR).

| النشاط | الموديولات | خصائص الأصناف |
|---|---|---|
| grocery سوبر ماركت | pos, inventory, purchases, installments | صلاحية+FEFO، وحدات، ميزان |
| mobile موبايلات | + maintenance | سيريال/IMEI + ضمان |
| clothing ملابس | pos, inventory, purchases, installments | **مصفوفة لون×مقاس بأرصدة مستقلة** |
| pharmacy صيدلية | pos, inventory, purchases | صلاحية+FEFO |
| electronics أجهزة | + maintenance, installments | سيريال + ضمان |
| spare_parts قطع غيار | pos, inventory, purchases | — |
| equipment_rental إيجار معدات | equipment_rental, installments | (مخزون معطل افتراضياً) |
| logistics نقل | logistics | (مخزون معطل افتراضياً) |
| lab معمل تحاليل | lab | — |
| contracting مقاولات | contracting, inventory, purchases | مخزن مواد حقيقي: شراء (1103) ← إذن صرف لمشروع (5110/1103) |
| clinic عيادة | clinic | — |
| cars معرض سيارات | cars, equipment_rental, installments | — |
| restaurant مطعم | pos, inventory, purchases, **recipes** | صلاحية، وحدات، ميزان |
| jewelry ذهب | pos, inventory, purchases, **jewelry** | ميزان، قوائم أسعار، متغيرات |
| laundry مغسلة | maintenance (تذاكر قطع) | — |
| general عام | pos, inventory, purchases, installments | — |

## 6) تفاصيل كل قسم ومعاملاته وقيوده

### 6.1 الكاشير والمبيعات (PosPage)
- سلة بباركود/بحث/شبكة أصناف، باركود ميزان `22XXXXXWWWWW`، تعليق فواتير، خصم سطر وخصم فاتورة، دفع مجزأ (نقدي مقدم + آجل يتطلب عميلاً)، طباعة حرارية/A4.
- **قيد البيع**: خزينة/عملاء مدين بالإجمالي / 4101 + 2102 دائن، وقيد تكلفة 5101 مدين / 1103 دائن **بمتوسط التكلفة لحظة الترحيل** (لقطة تُحدَّث إن تغير المتوسط بين الإضافة للسلة والدفع، بشرط `Number.isInteger`).
- FEFO للأصناف بصلاحية (planFefo/applyFefo) مع حظر بيع المنتهي إلا بتجاوز مدير موثق. سيريالات إلزامية للقطع المسيرلة المتاحة (نمط استشاري إن لم تسجل سيريالات).
- **قوائم الأسعار**: منتقي عميل في رأس السلة — اختيار عميل مربوط بقائمة (جملة/VIP) يعيد تسعير كل السطور عبر `getEffectivePrice(itemId, listId)`؛ الحل: سعر خاص ← خصم القائمة الافتراضي ← تجزئة.
- **الوصفات**: صنف له وصفة `made_to_order` نشطة → البيع يفكك سطوره لاحتياجات خامات (explodeIngredientNeeds) فتُفحص وتُخصم الخامات لا الطبق، وتكلفة السطر = تكلفة خامات الوصفة لحظة البيع.
- المرتجع (postSaleReturn): بنفس أسعار الأصل مع منع تجاوز المتبقي، البضاعة تعود بتكلفتها التاريخية مع إعادة حساب المتوسط بالقيمة. **طبق الوصفة لا تعود خاماته** (طُهيت — تبقى تكلفتها في 5101).
- **معالج المرتجع العالمي (ترقية بطلب المالك)**: شاشة المرتجعات معالج 4 مراحل (فاتورة ← بنود سطر-بسطر ← طريقة رد ← مراجعة). النواة `returns.ts`: `remainingByLine`/`buildReturnLinesPerLine(specs:{lineIndex,qty,condition})` — إرجاع بند واحد أو جزء كمية سطر بعينه (سطران لنفس الصنف بسعرين مستقلان)؛ `ReturnCondition` = resellable|damaged: **التالف لا يدخل المخزون — مدين 5111 هالك** في `buildReturnEntry(..., damagedCostMinor)`؛ `RETURN_REASONS` أكواد أسباب موحدة بحالة افتراضية؛ `postSaleReturn` يقبل `lineSpecs`/`reasonCode`/`treasury` (رد نقدي من أي درج/بنك «تحويل» — يُخزن على المستند ويصحح عدّ الدرج في الورديات). التوافق الخلفي: `qtyByItem` القديمة تعمل. **الاستبدال postExchange**: فاتورة آجلة ⇒ مرتجع credit + بيع جديد credit (الذمم تتحرك لا الدرج)؛ نقدية ⇒ cash كما كان.
- **مرتجع الخدمة بالبنود (كل الأنشطة)**: `computeItemizedRefund({items,selectedKeys,grandMinor,refundedMinor})` في serviceRefund.ts — اختيار بنود المستند (فحص معمل/قطعة مغسلة/خدمة أو قطعة صيانة) يرث الخصم والضريبة نسبياً بسقف المتبقي؛ `buildServiceRefundEntry` تقبل `restockCostMinor` (زوج 1103/5101 متوازن). **الصيانة**: `refundMaintenanceTicket({...returnParts})` يعيد قطع الغيار للمخزون بمتوسط مرجح بالقيمة ويوثق `returnedParts` على التذكرة (منع الإرجاع المزدوج). ServiceRefundBox الموحد: خاصية `refundableItems` تفعّل وضع «رد بنود محددة» + «مبلغ حر» — موصول في معمل (فحوصات) ومغسلة (قطع) وصيانة (أجر/خدمات/قطع بإرجاع مخزني).
- **موافقة المشرف (نمط Square/Toast/Roller)**: كل مرتجع/استبدال/عكس قيد/تسوية/خصم POS/تجاوز صلاحية ينفذه غير المخول يتطلب رقم مشرف سرياً — النواة `core/refundApproval.ts` (needsSupervisorPin/isEligibleApprover/describeShiftContext)، إجراء `approveByPin(pin, permId?)` في repo (يقبل رقم المالك أو رقم مستخدم نشط يملك الصلاحية، ويشارك loginGuard ضد التخمين)، الواجهة `useSupervisorApproval(permId)` في `components/SupervisorPinDialog.tsx`. صلاحية `sales.return.create` تفتح الشاشة و`sales.return.approve` (حساسة) تعفي من الرقم — المالك يمنحها فردياً عبر extraPerms («مرتجع بدون رقم سري»). المستندات تُختم بـapprovedBy/requestedBy (approvalStamp) + حدث تدقيق. **مرتجع وردية مغلقة/كاشير آخر**: يُحتسب في الوردية المفتوحة الحالية مع `crossShiftNote` يوثق الوردية الأصلية وفاتحها (المعيار العالمي — النقدية تخرج من الدرج الحالي).
- **حرية رد القيمة الرباعية (طلب المالك — «رد القيمة اختياري بحرية كاملة»)**: `RefundMode` صار يشمل `'custom'`، والنواة `returns.ts` فيها `RefundAllocation {cashMinor,creditMinor,storeCreditMinor,waivedMinor}` + `validateRefundAllocation(total,alloc,openCredit,received,hasCustomer)` (مجموع = القيمة بالضبط، نقدي ≤ المُحصَّل، خصم ذمم ≤ المفتوح، ذمم/رصيد تتطلب عميلاً مسجلاً) + `allocationOf` (يحوّل cash/credit/store_credit لتوزيع رباعي مطابق للسلوك القديم) + `buildReturnEntryAlloc` (المسار الموحد للقيد — **التنازل waived → دائن 4110 إيرادات أخرى**: «مرتجع بلا رد» البيع يُعكس والمبلغ المتنازل عنه مكسب محقق). `postSaleReturn` يقبل `allocation` مع `refund:'custom'`، ويخزن `storeCreditRefundMinor`/`waivedRefundMinor` على المستند بينما `creditRefundMinor` يظل مجموع كل ما قُيِّد على 1104 (خصم+رصيد) — **فتظل كشوف الحساب/أرصدة العملاء/getOpenClientInvoices/الورديات صحيحة بلا تعديل**. الواجهة: زر «🎛️ توزيع حر / بلا رد» في مرحلة طريقة الرد بأربع خانات + أزرار تعبئة سريعة (كله تنازلاً/أقصى نقدي/إطفاء الدين) + أخطاء فورية. سكربت التحقق `verify_refund_freedom_guides.mjs` (28 فحصاً).
- **قسم الشروحات لكل نشاط (طلب المالك — «اشرح كل شيء حرفياً»)**: نواة محتوى `core/guides.ts` (`GuideTopic`، `COMMON_GUIDES` 8 موضوعات مرتجعات شاملة: معالج خطوة بخطوة/حرية الرد بكل سيناريوهاتها/سليم-تالف/صلاحيات-ورديات/مخازن/استبدال/مرتجع شراء/استرداد خدمة، و`ACTIVITY_GUIDES` موضوع مرتجعات خاص لكل الأنشطة الـ16، و`guidesForActivity` يقدّم موضوعات النشاط أولاً + `searchGuides`). الصفحة `GuidesPage.tsx` على `/settings/guides` (بحث + فتح/طي)، في navCatalog ضمن الإعدادات، **مفتوحة للجميع** (perm: null في ROUTE_PERMISSIONS — التعليم لكل مستخدم). أي موضوع شرح جديد يُضاف للنواة لا للصفحة. سكربتا verify_permissions/verify_returns_wizard_worldclass حُدّثا (مسار guides مفتوح مقصود؛ الصفحة تستخدم allocationOf بدل splitRefund).
- ورديات (فتح/إقفال بعُهدة افتتاحية وفرق تسليم) وكل فاتورة تحمل shiftId.

### 6.2 المخزون
- أصناف: تصنيفات شجرية، وحدات متعددة، باركودات متعددة، **التكلفة لا تُدخل يدوياً** — متوسط مرجح متحرك من فواتير الشراء (تكلفة الإنشاء = افتتاحية فقط). حد إعادة طلب، صلاحية/سيريال/وزن/متغيرات لكل صنف. استيراد/تصدير CSV.
- مخازن وتحويلات بينها، جرد (postStocktake: العجز 5107 والزيادة إيراد).
- **الوصفات والإنتاج (recipes)**: `made_to_order` (طبق بلا مخزون) و`prepped` (أمر إنتاج PRD يحول خامات لمنتج مخزون بقيد 1103 مدين بالإجمالي / 1103 دائن بالخامات + خزينة بمصاريف التشغيل، ويحدّث متوسط المنتج بالقيمة). حواجز: لا وصفة لصنف له وصفة، لا تداخل (طبق «عند الطلب» لا يكون مكوناً؛ المنتج المسبق يصلح مكوناً)، حذف وصفة لها أوامر ممنوع.
- **الصاغة (jewelry)**: `gramPrices` {k18,k21,k24,updatedAt} بتحقق ترتيب منطقي (24>21>18) وتحذير قِدم يومي. `JewelryProfile` {عيار، وزن، مصنعية للقطعة} → السعر = وزن×جرام العيار + مصنعية؛ `repriceJewelry()` يعيد تسعير كل الموصوف. **الكسر**: `buyScrap` دفعة FIFO بقيد 1103/خزينة، `sellScrap` يستهلك FIFO (planScrapConsumption) والفرق ربح 4101 أو خسارة 5101.

### 6.3 المشتريات
- postPurchase: `{supplierId, date, lines:[{itemId,qty,unitPriceMinor,expiryDate}], expenses, paidMinor, treasury, notes}` — مصاريف الشحنة (نقل/جمارك) تُوزع على الأصناف landed cost بالقيمة أو الكمية (اختيار لكل مصروف)، والمتوسط المرجح يُحدَّث. مرتجع شراء بسعر التكلفة المحملة.

### 6.4 الأطراف
- عملاء/موردون: **كل الحقول اختيارية** لكنها تشمل حقول الفاتورة السعودية (رقم ضريبي، سجل، عنوان وطني…). حد ائتمان، كشوف حساب، أعمار ديون.
- `Customer.priceListId` يربط العميل بقائمة أسعار.
- أقساط: جدولة، تحصيل قسط بقيده، متأخرات.
- شيكات قبض/دفع بدورة حالات (استلام←إيداع←تحصيل/ارتداد) بقيود 1106/2106.

### 6.5 الخزينة والمحاسبة
- خزائن وبنوك متعددة + تحويلات بينها، سندات قبض/صرف بحساب مقابل حر، يومية عامة بقيود مرقمة وعكس قيد، ميزان مراجعة، قائمة دخل، مركز مالي، تقارير (ربحية أصناف/عملاء/فترات)، أصول بإهلاك شهري (postMonthlyDepreciation — الشهر الحالي فقط)، فاتورة إلكترونية (مصر/السعودية ZATCA QR) **معطلة افتراضياً ولا يفعلها إلا المطور عبر البوت**.

### 6.6 الموظفون والرواتب
- موظفون، سلف (grantEmployeeAdvance من خزينة/بنك) **تُخصم على شهور بمبلغ يختاره المستخدم شهرياً** مع عرض الإجمالي/المتبقي/السبب في مسير الرواتب.
- postPayroll: `{month:'YYYY-MM', payMode:'cash'|'accrual', treasury, notes, lines:[{employeeId, baseMinor, allowancesMinor, overtimeMinor, deductionsMinor, advancesMinor}]}` — الدفع من خزينة/بنك/عهدة.
- **عهد ملفات كاملة** (نموذج pro-acc): ملف عهدة يُفتح بتمويل، مصروفات منه بتصنيفات، تسوية بفائض (2107) أو عجز، وكل معاملات المقاولات/الرواتب يمكن صرفها من عهدة.

### 6.7 المقاولات (الأعمق — نموذج pro-acc)
| القسم | المنطق | القيد |
|---|---|---|
| عروض أسعار | دورة مسودة←إرسال←قبول/رفض، تتحول مشروعاً | بلا قيد |
| مشاريع | عقد بنسبة محتجزات، مستخلصات، تكاليف ببنود (مواد/عمالة/معدات/باطن/أخرى)، ربحية | مستخلص: خزينة|1104 صافي + 1105 محتجز مدين / 4107 + 2102 دائن |
| **BOQ** | بنود كود/وحدة/كمية/سعر بنسب إنجاز، موازنة المشروع | بلا قيد — يغذي WIP |
| **أوامر تغيير** | مسودة←اعتماد/رفض، زيادة/تخفيض؛ المعتمد يعدل قيمة العقد الفعلية | بلا قيد |
| **دفعات مقدمة** | receiveClientAdvance؛ تُسترد من المستخلصات FIFO (حقل advanceRecoveryMinor) | استلام: خزينة/2109. استرداد: 2109 مدين ضمن قيد المستخلص |
| **مقاولو باطن** | عقد SC-xxxx بمحتجز٪ ← شهادات (سقف العقد) ← دفعات (سقف المستحق) ← إفراج وإقفال | شهادة: 5110 / 2101 صافي + 2108 محتجز (+projectCost تلقائي). دفعة: 2101/خزينة. إفراج: 2108/خزينة |
| **خطابات ضمان** | 7 أنواع، هامش+مصاريف، تلوين انتهاء، رد/مصادرة | إصدار: 1109+5108 / بنك. رد: بنك/1109. مصادرة: 5108/1109 |
| **عمال يومية** | عامل بأجر يومي، سجلات أيام (نصف يوم مقبول) على مشاريع، تسوية مجمعة | 5110/خزينة موزعة على المشاريع كـlabor |
| **أذون صرف مواد** | MRQ-xxxx من المخزن لمشروع: صارف+مستلم إلزاميان، وحدات متعددة، متوسط مرجح، منع سالب صارم، تدقيق حركة | 5110 / 1103 (+projectCost بند materials تلقائي) — **لذا المخزون والمشتريات وحدتان أساسيتان بقالب المقاولات** |
| **WIP** | نسبة الإنجاز = تكاليف ÷ موازنة BOQ (أو العقد)، إيراد مكتسب، فوترة زائدة/ناقصة | تقريري |
| إفراج محتجزات العميل | releaseRetention يقفل المشروع | خزينة/1105 |

### 6.8 الصيانة (موبايل/أجهزة/مغسلة)
- تذاكر: استلام←تشخيص←تسعير←تجهيز←تسليم (التسليم من 'ready' فقط) وتحصيل بإيراد 4103 + قطع غيار من المخزون. المغسلة تستخدم نفس المحرك كتذاكر قطع.

### 6.9 إيجار المعدات
- معدات بأسعار ساعة/يوم/شهر وعداد ساعات، عقود RC-xxxx بأنواع زمنية، تأمين مسترد (2103)، تسوية تجاوز الساعات عند الإقفال، وردانيات مشغلين تقدّم العداد.
- صيانة وقائية كل N ساعة (serviceStatus بشريط تقدم وإنذار تأخر) + `recordEquipmentService`.
- **تكاليف تشغيل**: addEquipmentCost (وقود/صيانة/إصلاح/مشغل/أخرى) بقيد 5105/خزينة.
- **ربحية المعدة**: getEquipmentProfit = إيراد عقودها − تكاليفها + **ربح الساعة** من الساعات الموثقة (عقود ساعية بقراءات + وردانيات).

### 6.10 اللوجستيات
- نقلات TR-xxxx بمصروفات (سولار/طرق/تفويج) من 3 مصادر (نقدي/على العميل/آجل)، أسطول، **ربحية لكل نقلة** وتقرير فترات.
- **عمولة السائق**: postTrip يقبل driverCommissionMinor → قيد استحقاق 5106/2111 بلا نقدية؛ تتجمع في driverDues وتُسوى مجمعة `settleDriverDues` (2111/خزينة). لوحة في TripsPage.

### 6.11 معمل التحاليل
- كتالوج فحوصات بنطاقات مرجعية (جنس/عمر) وتكلفة، مرضى، طلبات LAB-xxxx بدورة فحص: تسجيل←سحب عينة←نتيجة (بعلَم مرتفع/منخفض)←اعتماد←طباعة.
- محيلون بعمولة٪ تُستحق مع الطلب (5109/2105) وتُصرف مجمعة، مع كشف شهري.
- **التأمين**: registerInsuredLabOrder — المريض يدفع نصيبه نقداً ونصيب الجهة مطالبة 1110؛ عمولة المحيل من الصافي كاملاً.

### 6.12 العيادة
- مرضى بملفات، مواعيد، زيارات (كشف/استشارة/إجراء) بإيراد 4108، **خطط علاج بجلسات** (أسنان) بمقدمات تُستهلك، رصيد المريض وتحصيلاته.

### 6.13 معرض السيارات
- كل سيارة وحدة فريدة بشاسيه: شراء (1103/خزينة|2101) + **تجهيزات تُرسمل** على تكلفتها + بيع بربح دقيق لكل سيارة + تحويل للتأجير (تنشأ معدة مرتبطة).
- **بيع بالأمانة**: ConsignmentCar ملك الغير — لا مخزون ولا قيد استلام؛ البيع: خزينة|عملاء بسعر البيع / 2110 صافي المالك + 4109 عمولة (+2102 على العمولة فقط، محسوبة inclusive)؛ سداد المالك: 2110/خزينة؛ رد بلا بيع. دورة: available←sold←paid أو returned. لوحة مكررة ممنوعة إلا بعد الرد.

### 6.14 الصيدلية والتأمين
- صيدلية = نمط تجاري بصلاحية FEFO. **postInsuredSale**: بيع بتغطية جهة (خزينة نصيب المريض + 1110 نصيب الجهة / 4101 + 2102 + قيد تكلفة)، `splitCoverage` يجبر كسور الجهة لأسفل لصالح المريض. المطالبات تتجمع وتُحصل مجمعة `settleInsuranceClaims`. إدارة الجهات حالياً في صفحة المحيلين (LabPages).

### 6.15 قوائم الأسعار (PriceListsPage تحت المبيعات)
- قائمة {اسم فريد، خصم افتراضي٪، نشطة} + PriceListEntry أسعار خاصة. حذف آمن (ممنوع مع عملاء مربوطين). محرر أسعار بتحذير «تحت التكلفة».

### 6.16 النظام
- **صلاحيات** بمربعات بسيطة، المالك يملك كل شيء من اليوم الأول.
- **نسخ احتياطي** مشفر كل ساعة + إرسال لتيليجرام.
- **مزامنة Supabase** للفروع المتعددة — ميزة خطة عليا (cloud_sync gating).
- **بوت تيليجرام للعميل** (send-only): نسخ احتياطي وتنبيهات — TelegramPage يستقبل token+chatId بتحقق getMe.
- **Cloudflare Worker** (GET-only): مفاتيح KV: `about` (محتوى صفحة حول + fallback محلي)، `revoked` (إيقاف أجهزة)، `sub:<deviceId>` (اشتراكات).
- **بوت المطور** (مقترح، نموذجه mobileshop worker.js): شاشات أزرار، توليد تراخيص من المحادثة، بث، دفع إعدادات، heartbeat.
- إعدادات عامة/مظهر (شريط جانبي **يمين**، ألوان لكل قسم، فاتح/داكن)/طباعة (قوالب حرارية وA4 احترافية بإظهار/إخفاء كل عنصر + شعار + علامة مائية)/سنة مالية (تأكيدها جزء من التسجيل الجديد).

### 6.17 مصفوفة المتغيرات لون×مقاس (ملابس — core/variants.ts)
- **النموذج**: دفتر فرعي لمخزون الصنف — الصنف يحتفظ بالرصيد الإجمالي والمتوسط (مصدر الحقيقة للقيود؛ لا تغيير على GL)، وكل تركيبة لون×مقاس لها رصيد مستقل في `variantStocks`.
- **القاعدة الصلبة**: مجموع التركيبات ≤ رصيد الصنف؛ الفارق = «غير موزع» (`getUndistributedQty`) يظهر بعد كل شراء حتى يوزعه المستخدم من نافذة المصفوفة (زر Grid3x3 في صف الصنف بـItemsPage — جدول ألوان×مقاسات يُحفظ عند onBlur).
- **الكاشير**: صنف له مصفوفة برصيد (`hasVariantStock`) ⇒ إضافة للسلة تفتح نافذة اختيار تركيبة (كنمط السيريالات، متاح كل تركيبة بعد خصم ما في السلة)؛ CartLine يحمل `variantColor/variantSize`؛ postSale يخطط `planVariantDeduction` ويخصم من التركيبة والإجمالي معاً. لا مصفوفة ⇒ بيع عادي.
- **المرتجع**: postSaleReturn يعيد الكمية للتركيبة نفسها (سطور البيع تحمل التركيبة) وللإجمالي.
- `setVariantStock` يتحقق: التركيبة من ألوان/مقاسات الصنف المعرفة، ولا سالب، والمجموع لا يتجاوز الإجمالي؛ التصفير يحذف السطر.
- سكربت التحقق: `verify_variants_matrix.mjs` (23 اختباراً).

### 6.17.1 اختبارات E2E بمحاكاة مستخدم (app/tests/ — vitest + jsdom + testing-library)
- `npx vitest run` (أو `npm run test:e2e`) — ملفان: `e2e_registration.test.tsx` (7 اختبارات: تسجيل كامل من المعالج لكل عائلة نشاط بالنقر الفعلي، عزل الأقسام الصارم في Sidebar، لا تلوث بين المستأجرين، سلامة القوالب الـ16) و`e2e_cross_screen.test.tsx` (4: المنسدلات تجلب أسماء/مفاتيح حية — عملاء في المشاريع، موظفون وأصناف برصيد حي في أذون الصرف مع تنفيذ كامل، فواتير مفتوحة حقيقية في التحصيلات، موردون في عقود الباطن).
- **أفخاخ**: يجب `vi.stubGlobal('fetch', reject)` قبل استيراد App (مزامنة السحابة)؛ إعادة الضبط بين الاختبارات تتطلب `seeded: false` وإلا لا يُعاد البذر؛ App يستخدم HashRouter فتُختبر الصفحات المفردة بـMemoryRouter.
- Playwright مثبت لكن تنزيل المتصفح محجوب في بيئة التطوير (ECONNRESET من cdn.playwright.dev) — اختبارات Electron الفعلية مؤجلة مع المثبت بقرار المالك.

### 6.18 أوامر التعديل — عمليات المشاريع المتقدمة (core/projectOps.ts + repo)
- **يوميات مرنة**: `DailyWorkRecord.projectId` أصبح `number | null` — بلا مشروع = تشغيل عام؛ `settleDailyWorker` يقسم القيد آلياً: مشروعي → 5110 (ويدخل projectCosts) وعام → 5108.
- **بنود كاملة (BOQ) للعروض والمناقصات**: QuotationLine = {nameAr, descriptionAr, qty, unitAr, unitPriceMinor, estCostMinor}; BoqItem += estCostMinor (موازنة البند). `convertQuotationToProject` ينقل كل البنود جدولَ كميات للمشروع بضغطة.
- **ربط العملاء إداري بحت**: Quotation.clientId وProject.clientId — لا يمس رصيد العميل إطلاقاً؛ الذمة تنشأ فقط من فاتورة بيع آجلة أو مستخلص آجل.
- **تحصيلات FIFO**: `getOpenClientInvoices(customerId)` (مفاتيح sale:id/extract:id، يخصم مرتجعات credit والتحصيلات السابقة) + `receiveClientPayment({customerId, amountMinor, treasury, specificDocKey?})` — FIFO افتراضياً، مطابقة محددة اختيارية، الفائض «تحت الحساب»؛ قيد خزينة/1104؛ سجل clientSettlements (CLR-xxxx)؛ sourceType='client_payment'. صفحة /contracting/collections.
- **أذون صرف مواد MRQ**: `issueMaterials({projectId, issuedByEmployeeId, receivedByEmployeeId, lines:[{itemId,qty,unitAr}], notes})` — صارف ومستلم إلزاميان ومختلفان من employees؛ تحويل وحدات (extraUnits.factor)؛ منع سالب صارم؛ قيد 5110/1103 بالمتوسط المرجح؛ تكلفة materials على المشروع؛ سجل stockMoves (تدقيق كامل). صفحة /contracting/material-issues.
- **باطن موسع**: SubContract += supplierId (ربط مورد اختياري) + taxWithholdPercent + boqItemIds؛ `addSubAdvance` (1111/خزينة) + `getSubAdvanceBalance`؛ `addSubCertificate` يستقطع آلياً: محتجز (2108) + ضريبة استقطاع (2112) + استرداد دفعة (1111 دائن) والصافي 2101؛ `remitWithholdingTax(treasury)` يورد 2112.
- **EVM**: `getProjectEvm(projectId)` من BOQ (estCost×progress) مقابل projectCosts الفعلية — BAC/EV/الموازنة المكتسبة/CPI/costOverrun. صفحة /contracting/evm.
- **محرك موافقات**: approvalFlows (حتى 6 مستويات تسلسلية) + approvalRequests؛ الإجراءات: quotation_to_project, material_requisition, sub_certificate, project_extract؛ `assertApproved` داخلي — مسار نشط ⇒ يتطلب طلباً approved غير مستهلك ويستهلكه؛ لا مسار = حر. صفحة /contracting/approvals.
- **الموردون مركز كامل**: Supplier += contactPerson?/category?/paymentTermsDays?/bankName?/iban?/active? (اختيارية كلها) — نموذج SuppliersPage موسع.
- **فخ**: buildDailyWorkSettlementEntry الآن (projectTotal, overheadTotal, treasury, label)؛ buildSubCertificateEntry الآن (amount, retention, withhold, advanceRecovery, label).
- DATA_VERSION=10 (ترحيل كل الحقول الجديدة). سكربت التحقق: verify_project_ops.mjs (60 اختباراً).

### 6.19 مصادر دفع مصاريف الشراء + المصروف اللاحق (طلب المالك)
- `PurchaseExpense` صار يحمل `paidBy: 'supplier'|'treasury'|'custody'` (+`payAccount`/`custodyFileId`/`late`). الافتراضي `supplier` = توافق خلفي كامل، بلا ترقية DATA_VERSION.
- `PurchaseInvoice.supplierDueMinor` = بضاعة + مصاريف على حساب المورد فقط؛ كل مستهلكي رصيد المورد (Dashboard/reports.supplierBalances/statements.supplierStatement/PurchaseReturnsPage/repo مرتجعات debt) يستخدمون `p.supplierDueMinor ?? p.grandTotalMinor`.
- `buildPurchaseEntryV2` في core/purchases.ts: مدين 1103 أو 5110 بالإجمالي، دائن (مصدر دفع البضاعة + كل مصروف مدفوع مباشرة على حسابه + 2101 بالباقي). سقف `paidMinor` هو مستحق المورد لا الإجمالي.
- `addLatePurchaseExpense` في repo: مصروف بعد الترحيل → يوزَّع على سطور الفاتورة، نصيب المتبقي بالمخزون → 1103 + رفع متوسط التكلفة، نصيب المَبيع → 5101، فاتورة مشروع → 5110 كلها؛ الدائن مورد/خزينة/عهدة. يُستدعى من عرض الفاتورة (PurchasesPage) ومن سند الصرف (VouchersPage عبر خيار `__purchase_expense__`).
- الفحص: `scripts/verify_purchase_expense_sources.mjs` (32 اختباراً).

## 7) قرارات المالك الملزمة (لا تخالفها أبداً)

1. المثبّت/Electron **آخر شيء** — فقط عند طلب صريح.
2. التكلفة لا تُحرَّر يدوياً — من الشراء فقط.
3. حقول الأطراف كلها اختيارية.
4. الفاتورة الإلكترونية معطلة افتراضياً — تفعيل المطور فقط عبر البوت.
5. تجربة 14 يوماً؛ خطط شهرية/سنوية تختلف بعدد المستخدمين والفروع؛ الإضافي يُباع عبر بوت المطور المربوط بـCloudflare.
6. **ادفع إلى GitHub بعد كل تعديل مكتمل** (`git push origin arena/01a09c43-shopsys`).
7. لا بساطة مخلة: أي قسم يُبنى «متكاملاً» — قارن بالبرنامج الرائد في المجال وسد الفجوة.
8. كل عملية نقدية تتيح اختيار الخزينة/البنك (والعهدة حيث يليق)، والدفع المجزأ نقدي مقدم.
9. **حدّث AGENTS.md مع كل تغيير** — هذه تعليمات المالك النصية.

## 8) أفخاخ تقنية (تعلمناها بالتجربة — لا تكررها)

- `npx tsc -b` **من مجلد app/ فقط** (خارجه يثبّت tsc مزيفاً). بيئة العمل قد تُمسح (node_modules) — الاسترداد: `npm ci` ثم `git fetch origin arena/01a09c43-shopsys && git reset --soft FETCH_HEAD`.
- `node --experimental-strip-types` يتطلب امتداد `.ts` صريحاً و**لا يستورد .tsx**.
- sed متعدد الأسطر يفشل — استخدم python3 استبدال نص حرفي مع `assert old in s`. الاستيرادات متعددة الأسطر في lucide: عدّل السطر الأخير حرفياً، لا regex.
- zustand v5: selector كائن بلا shallow = حلقة رندر لانهائية. بعد إجراء داخل حلقة أعد القراءة بـ`getState()`.
- CartLine في الاختبارات يجب أن يشمل nameAr وunitCostMinor وsoldByWeight. Item الجديد يحتاج **كل** الحقول (baseUnit, sku, barcodes, extraUnits...). addLabTest يحتاج costMinor وrefRanges.
- الاستيرادات غير المستخدمة تفشل tsc — نظّف بعد الدمج. Btn لا يقبل title؛ EmptyState أيقونته إيموجي نص.
- المخزون الافتتاحي عبر addItem بلا قيد GL — في الاختبارات قارن **فروقات** 1103 مع فروقات قيمة المخزون لا القيم المطلقة.
- deliverTicket من 'ready' فقط؛ postMonthlyDepreciation للشهر الحالي فقط؛ receiveCheque ثم setChequeStatus.
- **grep الملف قبل تعديله من الذاكرة** — الأنماط المحفوظة قد تكون قديمة.

## 8.5) سياسة تعديل الفواتير والفاتورة الإلكترونية (طلب المالك — مطبقة)

- **المرجع النقي**: `core/invoiceEdit.ts` — ثلاث دوال خالصة:
  - `invoiceEditPolicy({einvoiceActive})`: المنظومة الإلكترونية مفعلة (einvoice_sa/eg بمفتاح المطور) ⇒ **لا تعديل** — إشعار دائن (مرتجع) أو مدين (فاتورة إضافية). غير مفعلة ⇒ التعديل متاح بعكس القيد + قيد جديد.
  - `zatcaQrPolicy({featureActive, online, printEnabled})`: الباركود الضريبي يُطبع فقط بالشروط الثلاثة معاً (المرحلة الثانية تتطلب إنترنت). **مبلغ الضريبة يُحسب ويُرحّل دائماً** مهما كانت الحالة — يسري على كل البلدان والعملات والأنظمة الضريبية.
  - `saleEditBlocks(...)`: موانع لكل فاتورة (مرتجعات/سيريالات مباعة/أقساط/تحصيلات مخصصة/وردية مقفلة) — قائمة أسباب عربية، فارغة = يجوز.
- **repo.ts**: `editSale` و`editPurchase` — النمط الإلزامي: قيد عاكس (sourceType='reversal') + قيد جديد + `editHistory[]` على الفاتورة + رقم الفاتورة والمرجع ثابتان. البيع: إعادة المخزون بالتكلفة التاريخية ثم خصم الجديد بمتوسط ما بعد الإعادة. الشراء: التراجع عن القيمة المحملة ثم `computeLandedCosts` + متوسط مرجح + استبدال دفعات الصلاحية. **ممنوع التعديل في المكان أبداً — يفسد الدفتر.**
- `maybeZatcaQr` في `ui/print/zatcaQr.ts` يمر عبر zatcaQrPolicy ويقرأ `navigator.onLine` (بارامتر online اختياري للاختبار).
- UI: أزرار قلم/إشعارات في SalesInvoicesPage وPurchasesPage مع tooltip شارح لكل زر (قاعدة المالك)؛ الشروح في EinvoicePage.
- الفحص: `scripts/verify_invoice_edit.mjs` (38 فحصاً).

## 8.6) سجل النشاطات + المستخدمون + البلاغات + الدعم (طلب المالك — مطبقة)

- **`core/audit.ts`**: `sanitizeText` (التعقيم المركزي ضد الحقن — يُستدعى على كل نص وارد من مستخدم/بوت/ووركر)، `auditFromPatch` (توليد أحداث تدقيق تلقائياً من فروقات الحالة: قيود جديدة + إضافة/حذف بالسجلات المراقبة + نمو editHistory)، `appendAudit` (حلقة AUDIT_MAX=3000)، `hashPin/verifyPin` (SHA-256، لا يُخزن PIN نصاً)، `validateIssue`، أنواع AppUser/IssueReport.
- **repo.ts**: `auditLog/appUsers/currentUserId/issues` في الحالة (DATA_VERSION=11 مع migrate) + actions: addAppUser (مالك واحد فقط)، updateAppUser (لا تخفيض دور المالك)، removeAppUser (**تعطيل لا حذف** — يحفظ التاريخ)، setCurrentUser، reportIssue، setIssueStatus. **السجل يُبنى في الـset-wrapper المركزي** — كل كتابة تولد أحداثها تلقائياً باسم المستخدم النشط، لا تسجيل يدوي.
- **`core/applog.ts`**: لوج تقني محلي (حلقة LOG_MAX=800 في shopsys-log) + installErrorHooks (window.error/unhandledrejection) — يُرسل للمطور **فقط بموافقة صريحة** من شاشة الدعم.
- **`core/support.ts` + `cloud/worker.js`**: قناة دعم نصية عميل↔مطوّر عبر الووركر: POST/GET `/support/:deviceId` + ويبهوك تليجرام `/tg-webhook` محمي بـsecret_token؛ رد المطوّر (Reply في البوت) يظهر داخل التطبيق كمحادثة. حماية: نصوص فقط (لا ملفات)، تعقيم بالطرفين، rate limit 10/ساعة/جهاز، حد حجم 200KB، tgmap لربط الرد بالجهاز. أسرار الووركر: DEV_BOT_TOKEN/DEV_CHAT_ID/TG_WEBHOOK_SECRET.
- UI: `AuditLogPage` (للمالك فقط — قفل لغيره)، `IssuesPage` (بلاغ داخلي → جرس المدير → حل موثق)، `SupportPage` (محادثة + checkbox موافقة اللوج)، إدارة المستخدمين داخل PermissionsPage (اسم+دور+PIN، مبدّل «المستخدم النشط»).
- الفحص: `scripts/verify_audit_support.mjs` (44 فحصاً).

## 8.7) دفعة الأوامر 8/13/22/23/24 (batch25 — الجزء الثاني، مطبقة)

- **الأمر 24 — خدمات المحافظ** (`core/walletServices.ts` + `WalletServicesPage` على `/wallets/ops`): الربح **مشتق دائماً** = المحصَّل − المدفوع للمزوّد (لا يُدخل يدوياً)؛ أصل الاستلام مستقل عن أصل التمويل؛ الجزء الآجل (charge − paid) على عميل مسجل حصراً؛ القيد: مدين receiveTreasury(paid)+1104(الباقي) / دائن fundingTreasury(paidToProvider)+4103(الهامش)+2102(ضريبة الهامش الشاملة)؛ الهامش السالب يقلب 4103 مديناً. مرتجع = قيد عاكس كامل + status='returned'. refCode بادئة WLT، sourceType='wallet_service'، module='wallet_services'.
- **الأمر 13 — كارت الصنف** (`core/itemLedger.ts` + `ui/print/printItemLedger.ts` + مودال 📖 في ItemsPage): دفتر حركة الصنف يُبنى من المستندات مباشرة (شراء/مرتجعاته/بيع/مرتجعاته/فروق الجرد/أوامر الإنتاج منتجاً وخامات/أذون الصرف) برصيد جارٍ + فلتر فترة (الافتتاحي للفترة يستوعب ما قبلها) + طباعة A4 احترافية. **الرصيد الافتتاحي الحقيقي يُشتق عكسياً**: stockQty الحالي − صافي كل الحركات.
- **الأمر 8 — مخزن الفاتورة**: `warehouseId?: number|null` على SaleInvoice/PurchaseInvoice + منتقي أعلى الكاشير وفاتورة الشراء (يظهر فقط مع تعدد المخازن) + «مخزن غير محدد» (null = يعامل كالرئيسي) + الافتراضي من الإعدادات العامة (`setup.defaultWarehouseId` أصبح مستخدماً فعلاً). `computeWarehouseStock(items, warehouses, transfers, docs)` اكتسب معامل docs — `buildWarehouseDocs(purchases, sales)` يحوّل الفواتير الموسومة بمخزن غير الرئيسي إلى إزاحات (شراء + / بيع −) والرئيسي يبقى المتبقي، فالإجمالي محفوظ دائماً.
- **الأمر 23 — الصيانة بمستوى موبايل شوب**: كتالوج `maintenanceServices` (تكلفة سرية + سعر بيع، تعطيل بلا حذف)؛ TicketDeliveryInput اكتسب `services[]` و`paidMinor` (تحصيل مجزأ: نقدي الآن + الباقي دين — الجزئي يتطلب عميلاً مسجلاً)؛ TicketTotals اكتسب servicesPrice/servicesCost/paid/credit/profit؛ القيد: خزينة(paid)+1104(credit) / 4103+2102 + قطع 5101/1103؛ طباعة احترافية (`printMaintenanceTicket.ts`): إيصال استلام جهاز + فاتورة تسليم **بلا أي تكلفة/ربح** (سري). migrate يستكمل totals القديمة.
- **الأمر 22 — هامش التقسيط**: حساب جديد **4111 «أرباح تقسيط (هامش تمويل)»**؛ `createInstallmentPlan` يقبل `interestMinor` (جزء من الإجمالي) ويولّد قيد إثبات: مدين 1104 / دائن 4111 — فترتفع ذمة العميل للإجمالي ويظهر ربح التقسيط في قائمة الدخل. حارس: الهامش < الإجمالي.
- **DATA_VERSION=12**. الفحص: `scripts/verify_batch25_part2.mjs` (59). فخ: verify_maintenance القديم كان يحسب totals نقدية ويبني القيد آجلاً — بعد الأمر 23 القيد يتبع paid/credit من totals لا معامل payment.

## 8.8) جولة مراجعة نشاط الأغذية/السوبرماركت (الطلبات 6–9 — الجولة 1، مطبقة)

- **الإتلاف والهالك** (`core/wastage.ts` + `WastagePage` على `/inventory/wastage`): مستند إعدام موثق بسبب (WASTAGE_REASONS) — قيد **5111 «هالك وتوالف مخزون» / 1103** بمتوسط التكلفة، sourceType='wastage'، ترقيم WST-####؛ يخصم الرصيد ويستهلك دفعات الصلاحية الأقدم أولاً؛ الصفحة تعرض المنتهي حالياً بزر «إعدامها كلها بمستند واحد» (يجمّع الدفعات المكررة لنفس الصنف — validateWastage يرفض التكرار).
- **ملصقات الباركود** (`core/code128.ts` + `ui/print/printLabels.ts` + زر 🏷️ في ItemsPage): مولّد Code128 خالص بلا مكتبات (C للأرقام الزوجية/B لغيرها + checksum) يعيد SVG؛ شبكة A4 بأربعة أعمدة (متجر + اسم + باركود + سعر) بعدد نسخ لكل صنف.
- **الأمر 6 مكتمل**: «⚡ صنف جديد سريع» داخل مودال فاتورة الشراء — يسجل صنفاً أدنى (اسم/باركود/سعر بيع/قسم) ويدرج له سطراً فوراً؛ التكلفة تتحدد من الفاتورة نفسها بالمتوسط المرجح.
- الفحص: `scripts/verify_grocery_review.mjs` (28).

## 8.9) جولة مراجعة نشاط الموبايلات (الطلبات 6–9 — الجولة 2، مطبقة)

- **الأرصدة الافتتاحية** (`core/openingBalances.ts` + `OpeningBalancesPage` على `/accounting/opening-balances`): للمنتقل للبرنامج بأرصدة قائمة — عميل/مورد/خزينة/سلفة موظف، كل رصيد قيد متوازن مقابل **رأس المال 3101** (عميل: 1104/3101، مورد: 3101/2101، خزينة: كودها/3101، سلفة: 1107/3101). التعديل يرحّل **قيد الفرق فقط** (delta) ولا يمس القيود القديمة؛ نفس الرصيد = لا قيد. الحالة `openingBalances: Record<'kind:refId', Minor>`. حارس «المعرّف الشبح» (درس mobileshop: نجاح صامت لمعرّف غير موجود) — يرمي «غير موجود». الرصيد الافتتاحي يدخل كشف الحساب كأول صف (`openingMinor` في CustomerStatementInput/SupplierStatementInput).
- **التسويات الشاملة** (`core/settlement.ts` + `SettlementsPage` على `/accounting/settlements`): مطابقة الواقع بالدفاتر للخزائن/العملاء/الموردين (المخزون له شاشة الجرد) — حساب جديد **5112 «فروق تسويات وجرد نقدية»** (systemKey `settlement_variance`): كل فرق **يضرب قائمة الدخل إجبارياً** (درس mobileshop المقاس: عجز 5,000 «تبخّر» بتعديل رصيد صامت). العدّ السالب مرفوض **للخزائن فقط** — أرصدة الأطراف قد تكون سالبة شرعاً (دفعة مقدمة). مستند `SettlementDoc` بترقيم SET-####؛ مطابقة تامة = مستند بلا قيد (journalEntryId=null). الدفتري يُحسب من نفس مصادر الشاشات (statementBalance للأطراف/مجموع القيود للخزينة) وصفوف التسويات السابقة تدخل الحساب — لا تراكم مضاعف. صفوف التسوية تدخل كشوف الحساب عبر `adjustments?` (اتجاه المورد معكوس: الزيادة credit).
- **سجل السيريالات** (`SerialsPage` على `/inventory/serials`): دورة حياة كل IMEI — دخول (فاتورة شراء/تاريخ)، بيع (فاتورة/عميل/تاريخ)، حالة الضمان الآن (سارٍ حتى/انتهى) + عدادات وفلتر حالة وبحث. المرتجع يعود `in_stock` (لا حالة returned في SerialStatus) — شارة «مرتجعة» تُستدل من `saleId != null && in_stock`.
- DATA_VERSION=13. الفحص: `scripts/verify_mobile_review.mjs` (43 فحصاً).
- **قرار جولة الموبايلات**: عقود إيجار المحل بأقساط (نمط rent.handlers) لم تُنقل — سندات المصروفات تغطيها؛ تُبنى إن طلبها المالك.

## 8.10) جولة مراجعة نشاط الملابس (الطلبات 6–9 — الجولة 3، مطبقة)

- **الاستبدال** (`core/exchange.ts` + `ExchangePage` على `/sales/exchange`): أشهر عملية بمحل الملابس — العميل يرجع قطعة ويأخذ غيرها فوراً. `postExchange` = مرتجع نقدي (بنفس خزينة العملية) + بيع نقدي جديد (بنفس المعاملة الضريبية للأصل عبر deriveTaxConfig) مربوطان بمستند **EXC-####** — **لا قيد مختصر**: قيدا العمليتين كاملان فترصد 4102 المرتجعات و4101 المبيعات بلا تشويه، وحركة الخزينة الصافية = الفرق فقط (موجب يدفعه العميل / سالب يُرد له / صفر متكافئ).
- **الذرية**: لقطة snapshot قبل المرتجع + `useDataStore.setState(snapshot, true)` عند فشل البيع الجديد — لا «مرتجع يتيم» نصف استبدال (نفس درس فاتورة الكاشير). فخ فحص: مخزون الصنف بعد استبدال 1↔1 = الأصلي −1 (بيع أصلي 1 + مرتجع 1 − بيع جديد 1) وليس ثابتاً.
- الموجود مسبقاً وكفى النشاط: تشكيلة لون×مقاس (variants.ts + مصفوفة بالأصناف + منتقي بالكاشير)، قوائم أسعار، خصومات سطر/فاتورة، ملصقات باركود، مواسم عبر التقارير.
- DATA_VERSION=14. الفحص: `scripts/verify_clothing_review.mjs` (25 فحصاً).

## 8.11) جولة مراجعة نشاط الصيدلية (الطلبات 6–9 — الجولة 4، مطبقة)

- **البيع متعدد الوحدات (قرص/شريط/علبة)** — أهم خصوصية بيع بالصيدلية: `ItemUnit` اكتسب `priceMinor?` (سعر بيع الوحدة الأكبر مستقلاً — علبة قد تكون أرخص من معاملها×سعر القطعة) و`CartLine` اكتسب `unitFactor?/unitLabel?` + دالة `baseQty(l)=qty×factor` في core/pos.ts.
- **repo**: postSale يخصم المخزون/الدفعات FEFO بالكمية الأساسية (baseQty)، وتثبيت متوسط التكلفة لحظة الترحيل صار بالمعامل (`expected = costMinor×unitFactor`)؛ postSaleReturn يعيد الكمية الأساسية كاملة. حارس المخزون يحسب بالوحدة الأساسية أيضاً.
- **الكاشير**: مسح باركود وحدة أكبر (`extraUnits[].barcode`) يضيف السطر بوحدته وسعره مباشرة (قبل مطابقة باركود الصنف)؛ منتقي وحدة على كل سطر (يظهر فقط لصنف متعدد الوحدات بلا سيريالات) يعيد التسعير والتكلفة. **ItemsPage/UnitEditor**: حقلا سعر بيع وباركود للوحدة الأكبر (toMinor بعملة البلد لا ×100).
- الموجود مسبقاً وكفى النشاط: FEFO + حظر المنتهي بتجاوز مدير، تنبيهات قرب الانتهاء (ReportsPage)، إعدام المنتهي (WastagePage)، بيع بتغطية تأمين postInsuredSale + جهات التأمين (شاشة المعمل)، نواقص المخزون بحد الطلب.
- الفحص: `scripts/verify_pharmacy_review.mjs` (17 فحصاً). لا تغيير DATA_VERSION (حقول اختيارية فقط).

## 8.12) جولة مراجعة نشاط المطعم (الطلبات 6–9 — الجولة 5، مطبقة)

- **أوامر الطاولات والدليفري** (`core/restaurant.ts` + `RestaurantOrdersPage` على `/sales/restaurant-orders`، module='recipes'): الصالة لا تعمل «فاتورة فورية» — الأمر ORD-#### يظل مفتوحاً طوال الجلسة (صالة بطاولة إلزامية لا تُفتح مرتين / تيك أواي / دليفري ببيانات إلزامية) و**لا يلمس الدفاتر إطلاقاً** حتى القفل.
- **القفل** (`settleRestaurantOrder`): رسوم الخدمة (٪ من الأصناف عبر serviceChargeMinor) ورسوم التوصيل تُحقن **سطوراً صناعية itemId=-1** (feeLine: بلا مخزون ولا تكلفة) ثم postSale واحد يتولى الوصفات made_to_order (خصم الخامات + COGS) والضريبة والقيد — فتدخل الرسوم الإيراد 4101 والضريبة والإيصال كأي سطر. الإلغاء يحتاج سبباً موثقاً.
- **بون المطبخ** (`ui/print/printKitchen.ts`): حراري 80mm أصناف/كميات/ملاحظات فقط **بلا أي أسعار**.
- DATA_VERSION=15. الفحص: `scripts/verify_restaurant_review.mjs` (29 فحصاً).

## 8.13) جولة مراجعة نشاطي قطع الغيار والأجهزة الكهربائية (الطلبات 6–9 — الجولة 6، مطبقة)

- **أرقام OEM/بدائل + توافق + درجة** (core/items.ts): `Item` اكتسب `oemNumbers?: string[]` و`fitment?: string` و`grade?: 'original'|'aftermarket'|'used'` (+GRADE_LABELS). `normalizePartNumber` يتجاهل الشرطات/المسافات/النقاط ويرفع الحالة، و`itemMatchesPartQuery` بحث موحد (اسم/SKU/باركود/OEM/توافق) — رقم أقل من 3 حروف لا يطابق OEM (ضد المطابقات العشوائية). مربوط في بحث الكاشير (PosPage filtered) وحقول نموذج الصنف (تظهر تلقائياً لنشاطي spare_parts/electronics أو عند وجود بيانات) وشارات بجدول الأصناف.
- **شهادة الضمان** (`ui/print/printWarranty.ts` + زر 🖨️ بعمود الضمان في SerialsPage): A5 عرضية — جهاز/سيريال/عميل/فاتورة/مدة ونهاية الضمان + شروط، بلا أي تكلفة. esc() ضد حقن HTML.
- الموجود مسبقاً وكفى النشاطين: سيريال+ضمان بالكاشير، صيانة كاملة (order 23)، أقساط بهامش 4111، محافظ (order 24)، وحدات متعددة، قوائم أسعار.
- لا تغيير DATA_VERSION (حقول اختيارية). الفحص: `scripts/verify_parts_electronics_review.mjs` (16 فحصاً).

## 8.14) جولة مراجعة نشاط الذهب والمجوهرات (الطلبات 6–9 — الجولة 7، مطبقة)

- **البيع بمقايضة كسر** (core/jewelry.ts: computeTradeInNet/validateTradeIn + `postGoldTradeIn` + زر «♻️ بيع بمقايضة كسر» وسجل GTI في JewelryPage): العميل يأخذ مشغولاً جديداً ويدفع جزءاً من ثمنه بذهبه القديم — `postGoldTradeIn` = فاتورة بيع كاملة (postSale نقدي بالخزينة) + لوط كسر FIFO (buyScrap بنفس الخزينة) بمستند **GTI-####** — النقدية الصافية بالخزينة = الفرق فقط. ذرية بلقطة استرجاع (نمط الاستبدال). العميل النقدي يوثق بائع الكسر «عميل مقايضة».
- فخ فحص 1103: المقايضة تحرك المخزون −تكلفة المشغول +قيمة الكسر (المثال: −42,000+40,000=−2,000).
- الموجود مسبقاً وكفى النشاط: أسعار جرام يومية + إعادة تسعير المحل بضغطة + تحذير stale، وصف ذهبي (عيار/وزن/مصنعية)، شراء/بيع كسر FIFO بربح ظاهر.
- DATA_VERSION=16. الفحص: `scripts/verify_jewelry_review.mjs` (19 فحصاً).

## 8.15) جولة مراجعة نشاط العيادة (الطلبات 6–9 — الجولة 8، مطبقة)

- **الروشتة المطبوعة ℞** (`ui/print/printPrescription.ts` + زر ℞ على كل زيارة في ClinicPages): A5 — ترويسة العيادة/الطبيب (shopName/ownerName)، المريض وعمره (محسوب من birthDate)، التاريخ ورقم الزيارة، التشخيص، الأدوية مرقمة ℞ بجرعاتها، وتحذير الملف الطبي (حساسية/أمراض) — **بلا أي مبالغ**. حقل العلاج صار textarea بصيغة «دواء | جرعة» لكل سطر و`parsePrescriptionText` يحوله لسطور.
- الموجود مسبقاً وكفى النشاط: ملف مريض بتاريخ مرضي، زيارات كشف/إجراء/متابعة بقيدها، خطط علاج بجلسات مقسطة sessionFees، تحصيل دفعات المرضى، المواعيد.
- الفحص: `scripts/verify_clinic_review.mjs` (11 فحصاً). لا تغيير DATA_VERSION.

## 8.16) جولة مراجعة نشاط إيجار المعدات (الطلبات 6–9 — الجولة 9، مطبقة)

- **إنذار التأخير عن الإرجاع** (core/rental.ts: `rentalExpectedEnd` ساعي زمنياً/يومي وشهري تقويمياً + `isRentalOverdue`): العقود النشطة المتجاوزة موعدها تظهر «⏰ متأخر عن الإرجاع» نابضة بجدول العقود. العقود القديمة بلا rateType تعامل يومياً.
- **عقد الإيجار المطبوع** (`ui/print/printRentalContract.ts` + زر Printer بالجدول): A4 — الطرفان، المعدة وكودها، المدة وموعد الإرجاع المتوقع، قراءة العدّاد عند التسليم، الإيجار/الضريبة/التأمين، 4 بنود التزام (تلف يُخصم من التأمين، التجاوز بسعر الوحدة، لا تأجير من الباطن، رد التأمين بعد المعاينة)، توقيعان.
- الموجود مسبقاً وكفى: عقود ساعي/يومي/شهري، عدّاد ساعات وتجاوز، صيانة وقائية كل N ساعة، وردانيات مشغلين، ربحية معدات، تأمين مسترد بخصومات.
- الفحص: `scripts/verify_rental_review.mjs` (12 فحصاً). لا تغيير DATA_VERSION.

## 8.17) جولة مراجعة نشاط اللوجستيات (الطلبات 6–9 — الجولة 10، مطبقة)

- **بوليصة النقل Waybill** (`ui/print/printWaybill.ts` + زر Printer بجدول النقلات): A5 عرضية تسافر مع السائق — المسار (من ⟵ إلى)، العميل، المركبة/اللوحة/السائق، أرقام الحاويات، أجرة النقل، مصاريف **«على حساب العميل» فقط** (تُطالَب)، الإجمالي المستحق نقدي/آجل، توقيعا السائق والمستلم. **تُخفى التكلفة والربح ومصاريف الخزينة/الآجلة تماماً** (نفس مبدأ إخفاء التكلفة بإيصال الصيانة).
- الموجود مسبقاً وكفى: نقلات TR بمصاريف ثلاثية المصدر (نقدي/عميل/آجل)، ربحية النقلات، عهد سائقين وتسويتها، تقرير ربحية بالفترات.
- الفحص: `scripts/verify_logistics_review.mjs` (10 فحوص). لا تغيير DATA_VERSION.

## 8.18) جولة مراجعة نشاط المغسلة (الطلبات 6–9 — الجولة 11، مطبقة)

- **موعد التسليم الموعود** (`promisedAt?` بتذكرة الصيانة — المغسلة تعمل بوحدة الصيانة، والموبايلات تستفيد أيضاً): حقل datetime-local اختياري عند فتح التذكرة؛ `isTicketOverdue` (core/maintenance.ts) = لها موعد + ليست مسلَّمة/ملغاة + تجاوز الوقت ⇒ شارة «⏰ متأخرة» نابضة بجدول التذاكر، والموعد يظهر تحت الحالة قبل حلوله. الموعد يُطبع بإيصال الاستلام (printMaintenanceTicket: promisedAt بالنموذج).
- حقل اختياري ⇒ لا DATA_VERSION bump. بلا موعد يُخزَّن undefined لا ''.
- الفحص: `scripts/verify_laundry_review.mjs` (11 فحصاً).

## 8.19) جولة مراجعة نشاط معمل التحاليل (الطلبات 6–9 — الجولة 12، مطبقة)

- **السجل التراكمي + Delta Check** (core/lab.ts: `patientResultHistory` + `resultDeltaPercent`؛ LabPages داخل مودال دورة العينة): تحت كل فحص تظهر آخر 3 نتائج سابقة لنفس المريض/الفحص (resulted/approved فقط، الأحدث أولاً، بلقطة العلم والنطاق)، وإذا |Δ| ≥ 20% عن السابقة تظهر شارة «Δ ±% — راجِع» كهربية — أهم أداة جودة بأنظمة LIS.
- `resultDeltaPercent` يقرب لعشر واحد؛ null للنصوص/لا سابقة/سابقة صفر؛ **السالبة تقسم على |السابقة|** (من −100 إلى −50 = +50% ارتفاع — فخ فحص).
- الموجود مسبقاً وكفى: كتالوج فحوصات بنطاقات مرجعية سن/جنس، دورة العينة، تقرير A4، عمولات محيلين استحقاقاً وصرفاً، تأمين.
- الفحص: `scripts/verify_lab_review.mjs` (12 فحصاً). لا تغيير DATA_VERSION (دوال قراءة فقط).

## 8.20) جولة مراجعة نشاط معرض السيارات (الطلبات 6–9 — الجولة 13، مطبقة)

- **عقد بيع السيارة المطبوع** (`ui/print/printCarSale.ts` + زر Printer للسيارات المباعة بجدولي المعرض والأمانة في CarsPage): A4 — طرفا العقد، بيانات السيارة كاملة (ماركة/موديل/سنة/لوحة-شاسيه/عداد بفواصل en)، الثمن نقداً/«بذمة المشتري»، الضريبة إن وجدت، 3 إقرارات (معاينة نافية للجهالة، نقل ملكية، لا تعديل إلا كتابة)، توقيعان. سيارة الأمانة تطبع «بصفته وكيلاً بالعمولة عن المالك». **بلا تكلفة ولا ربح**.
- حيلة استدلال: Car لا يخزن payment/vat — يُستدلان من قيد البيع (`1104` مدين = آجل؛ ضريبة = صافي 2102 بالقيد).
- الموجود مسبقاً وكفى: شراء/تجهيزات مرسملة/بيع بربح، تحويل للتأجير، أمانة بعمولة والتزام 2110 للمالك وسداده.
- الفحص: `scripts/verify_cars_review.mjs` (10 فحوص). لا تغيير DATA_VERSION.

## 8.21) جولة مراجعة نشاط المقاولات (الطلبات 6–9 — الجولة 14، مطبقة)

- **المستخلص المطبوع** (`ui/print/printExtract.ts` + زر Printer بجدول مستخلصات المشروع في ContractingPages): A4 للجهة المالكة — المشروع/العقد/الجهة، أعمال المستخلصات السابقة تراكمياً (Σ gross لمستخلصات نفس المشروع بـ id أصغر) + الحالي + التراكمي، شريط نسبة الإنجاز (تراكمي ÷ قيمة العقد، يُقص عند 100%، يختفي لو العقد بلا قيمة)، الضريبة، المحتجز **خصماً بين قوسين وبنسبته**، صافي المستحق «حُصّل نقداً/مطالبة على الجهة»، توقيعات ثلاثية (مقاول/استشاري/جهة مالكة).
- عمق المقاولات السابق (pro-acc) كان مكتملاً بالفعل: BOQ، أوامر تغيير، دفعات مقدمة وخصمها، مقاولون باطن بمستخلصاتهم ومحتجزاتهم، عهد، تكاليف ببنود، ربحية — الفجوة الوحيدة كانت الوثيقة المطبوعة.
- الفحص: `scripts/verify_contracting_review.mjs` (12 فحصاً). لا تغيير DATA_VERSION.

## 8.22) الجولة الختامية — النشاط العام + مركز التنبيهات (الطلبات 6–9 — الجولة 15، مطبقة)

- **مركز التنبيهات الموحد** (`core/alerts.ts`: collectBusinessAlerts — نواة قراءة خالصة؛ معروض بلوحة اليوم Dashboard كشبكة بطاقات قابلة للنقر lg:col-span-2): يجمع 5 عائلات: نواقص مخزون (minQty>0 و active فقط)، صلاحية منتهية 🔴/تقارب ≤30 يوماً 🟠 (دفعات qty>0 وبتاريخ فقط)، أقساط متأخرة 🔴/تستحق قريباً 🟠 (من collectAlerts في installments)، شيكات قائمة (held/deposited/issued) تستحق ≤7 أيام (متجاوزة = خطر)، عملاء تجاوزوا حد الائتمان (limit>0 فقط؛ الرصيد من statementBalance). ترتيب: danger قبل warn. كل تنبيه route حقيقي: /inventory/items، /parties/installments، /accounting/cheques، /parties/customers.
- بطاقة «تنبيهات» بالداشبورد صارت تعد كل التنبيهات لا النواقص فقط، وتعرض عنوان أهمها.
- **بهذا اكتملت جولات المراجعة للأنشطة الـ16** (الطلبات 6–9): grocery/mobile/clothing/pharmacy/restaurant/parts+electronics/jewelry/clinic/rental/logistics/laundry/lab/cars/contracting/general — كل جولة بنواتها وواجهتها وسكربت فحصها.
- الفحص: `scripts/verify_general_review.mjs` (13 فحصاً). البوابة الكاملة: 74 سكربت تمر جميعها.

## 8.20) دفعة مراجعة المالك: المستخدمون والدخول والإشعارات (سبتمبر 2026 — مطبقة)
- **الدخول بلا قوائم أسماء** (طلب المالك): LoginScreen أعيدت كتابتها — وضعان (موظف/مالك)، الموظف يكتب معرفه بنفسه (اسم كامل/هاتف/بريد) عبر `findUserByIdentifier` في audit.ts (مطابقة حرفية فقط — لا جزئية كي لا تُكشف الحسابات، رسالة خطأ عامة واحدة).
- **الحساب مبني على موظف**: AppUser أضيف له employeeId/phone/email/mustChangePin/initialPin؛ addAppUser يرفض موظفاً غير موجود/غير نشط وحسابين لنفس الموظف؛ نافذة «مستخدم جديد» في PermissionsPage تختار من الموظفين النشطين غير المربوطين + `suggestRoleForJobTitle` يقترح الدور من المسمى الوظيفي (اقتراح قابل للتعديل).
- **أول دخول إجباري التغيير**: login يعيد mustChangePin؛ LoginScreen يفتح Modal إلزامياً؛ `changeOwnPin` يحفظ الجديد ويمسح initialPin (لا يعود أحد يعرفه) ويسجل حدث تدقيق. الرقم المبدئي يظهر للمدير كشارة 🔑 في قائمة المستخدمين حتى يتغير. إعادة تعيين من المدير = mustChangePin+initialPin من جديد.
- **الإشعارات كمقروء**: readNotificationIds في repo (سقف 500) + markNotificationRead/markAllNotificationsRead/restoreNotifications؛ الجرس في Header يعد غير المقروء فقط + زر ✓ لكل تنبيه + «تعليم الكل» + أرشيف قابل للإظهار. المعرف ثابت لكل سبب — سبب جديد (قسط الشهر التالي) يظهر تلقائياً.
- **قيود باسم المنفذ الفعلي**: 88 قيداً كانت `createdBy: 'المالك'` ثابتة — الآن `activeUserName(get())` (اسم المستخدم المسجل). فتح الوردية في ShiftsPage باسم المستخدم النشط أيضاً.
- **الاستبدال بوزن عشري**: ExchangePage — كمية القطع الجديدة نص حر بمنقٍّ عشري (كانت Number فورية تمنع «2.»)، soldByWeight يؤخذ من الصنف (كانت false ثابتة!)، inputMode=decimal للحقلين، NewQtyTexts تُزاح عند حذف سطر. SaleReturnsPage نفس المعاملة للمعالج.
- **اقتراحات المتصفح**: حارس عام في App.tsx (MutationObserver يختم autocomplete=off على كل input بلا سمة صريحة) + datalist المشتريات/المعدات تحولت شرائح اقتراح داخلية مصممة + إزالة مرجع datalist يتيم في MaintenancePage.
- الفحص: `scripts/verify_users_login_notifications.mjs` (40 فحصاً) يشمل أيضاً سيناريو صلاحيات المجموعة (التغيير يسري فوراً على كل مستخدمي الدور، والاستثناءات الفردية extraPerms/deniedPerms تبقى فوقه لأنها تحسب وقت التقييم لا بالنسخ).

## 8.21) دفعة مراجعة المالك: الكاشير والطباعة والنوافذ (سبتمبر 2026 — مطبقة)
- **وجهة إشعار الصلاحية**: المنتهي → `/inventory/wastage` (صفحة الهوالك — فيها زر إعدام فوري للمنتهي)، الموشِك → `/reports` (جدول تنبيهات FEFO). القرار في notifications.ts حسب `a.status`.
- **المودال فوق كل شيء**: Modal في ui.tsx صار `createPortal(document.body)` + `z-[100]` — السبب الجذري أن أغلفة الصفحات anim-in/anim-up (animation) تنشئ stacking context فيُحبس z-50 تحت هيدر sticky z-20. أي مودال جديد يرث الإصلاح تلقائياً.
- **تصنيف المورد مفتوح**: حقل نص حر + شرائح اقتراح (التصنيفات المكتوبة سابقاً في الموردين + قائمة SUPPLIER_CATEGORIES كبذرة). لا select مغلق.
- **أغراض الصرف الداخلي**: CONSUMPTION_PURPOSES وسعت 7→16 غرضاً (عينات، وقود معدات، صرف لموقع، سلامة، تالف تشغيل…) + خيار «✍️ غرض آخر (اكتبه بنفسك)» يظهر حقلاً حراً؛ الترحيل بـ effectivePurpose وحارس يمنع الحر الفارغ. postConsumption كان يقبل نصاً حراً أصلاً — القيد كان في الواجهة.
- **كمية عشرية في POS**: نمط المسودة النصية (qtyDrafts لكل سطر) — «.25» تُكتب بحرية، تحويل أرقام عربية/فاصلة «٫,» لنقطة، inputMode=decimal، تنظيف المسودة عند blur/±/حذف سطر/إفراغ سلة. نفس نمط ExchangePage.
- **شريط قالب الطباعة في الكاشير** (حراري/A4/A5): حصري كراديو بمظهر checkbox، افتراضيه القالب الدائم، **useState محلي — لا يكتب في receipt الدائمة أبداً** (تجاوز مؤقت للفاتورة الطارئة، متاح للكاشير بلا صلاحيات). بجانبه زر ⚙ يفتح «خيارات طباعة سريعة»: الطباعة التلقائية بعد التحصيل (autoPrintAfterSale)، عرض الورق 80/58، نمط A4/A5 — هذه تُحفظ في الإعدادات نفسها (اختصارات لا تعارض).
- **A5 جديد**: `renderInvoiceA4Html(model, cur, settings, 'a5')` — معامل paper اختياري (افتراضي a4)؛ A5 = @page size A5 هامش 7مم + كتلة «تكييف A5» بخطوط/فراغات أصغر لنفس الأنماط الخمسة. InvoiceTemplate صار 'thermal'|'a4'|'a5' و`INVOICE_TEMPLATE_OPTIONS` في receipt.ts للشريط.
- **إجابات معرفية موثقة**: الماسح USB-HID = keyboard wedge (يعمل بمرور الباركود في وضع continuous أو بزر في وضع trigger حسب الطراز — لا إعداد في النظام)؛ الطباعة فور التحصيل موجودة أصلاً (autoPrintAfterSale في إعدادات الطباعة والآن في المودال السريع).
- **المراجعة الثانية (طلب المالك «راجع كل ما طلبته مرة أخرى») كشفت وأصلحت**: (أ) انحدار طبقات — حوار رقم المشرف السري كان z-[80] بلا portal فيُحبس تحت المودال الجديد z-[100] عندما يُستدعى من داخله (صرف/إتلاف/مرتجع) → صار createPortal بـ z-[110]، والتوست رُفع z-[60]→z-[120] ليعلو الجميع؛ ترتيب الطبقات المعتمد: هيدر 20 < مودال 100 < حوار مشرف 110 < توست 120. (ب) اتساق A5 — كان في الكاشير فقط: أضيف زر A5 لكل فاتورة في فواتير المبيعات (printInvoice يقبل 'a5')، وإشعار المرتجع يحترم افتراضي a5، وقسم إعدادات الطباعة صار 3 خيارات افتراضية + زر «تجربة A5»، وشريط الكاشير يبدأ على receipt.defaultTemplate مباشرة. (ج) category تُحفظ بـ trim().
- الفحص: `scripts/verify_owner_batch_pos_print.mjs` (46 فحصاً بعد المراجعة الثانية). البوابة الكاملة: 127 سكربتاً تمر جميعها.

## 8.22) الأدوار المخصصة وتعيين المشرفين + مراجعة 18 نشاطاً (سبتمبر 2026 — مطبقة)
- **فجوة مقابل Square/Toast سُدت**: زر «دور جديد» كان معطلاً (بلا onClick) ولا سبيل لتغيير دور مستخدم قائم إلا بحذفه. الآن:
  - `customRoles` في repo (`addCustomRole(nameAr, basedOnRoleId?)` يعيد `custom_N` وينسخ صلاحيات الأساس + rename + remove المحمي «لا حذف لدور معيّن على مستخدم نشط») — الصلاحيات تعيش في `roleOverrides[custom_N]` فكل مسارات التقييم تعمل تلقائياً.
  - `rolesWithOverrides(overrides, customRoles?)` معامل ثانٍ اختياري — حُدثت كل مواضع الاستدعاء الخمسة (App/Sidebar/SupervisorPinDialog/PermissionsPage/approveByPin).
  - PermissionsPage: مودال «🛡️ دور جديد» (اسم + «ابدأ بصلاحيات دور» أو فارغ) + شارة الدور بجانب كل مستخدم صارت زر «🔄 تغيير دور» يفتح مودال ترقية فورية + زر حذف للأدوار المخصصة فقط (isSystem=false).
- **كيف يصير الموظف مشرفاً (السؤال المجاب)**: رقمه السري نفسه هو رقم الاعتماد — لا رقم منفصل؛ أهليته تُشتق من امتلاك دوره صلاحية العملية (approveByPin يمر على كل المستخدمين النشطين ويقبل من يملكها). الترقية: «تغيير دور» → مدير فرع أو دور مخصص فيه صلاحيات الاعتماد.
- الفحص: `verify_custom_roles_supervisor.mjs` (28) دورة كاملة سلمى كاشير→مشرفة مخصصة→اعتماد→سحب صلاحية يسري فوراً→حمايات؛ `verify_owner_batch_18_activities.mjs` (18/18) لكل نشاط: عشري 0.25 + صرف حر + تصنيف مورد حر + 3 قوالب طباعة + مشرف بدور مخصص + وجهتا إشعار الصلاحية. البوابة: 129 سكربتاً تمر.

## 8.23) دفعة النقاط الثماني: الدخول الموحد والبروفايل والورديات وطباعة المشتريات (سبتمبر 2026 — مطبقة)
- **① باج إجبار تغيير الرقم أول دخول أُصلح**: السبب كان أن `login()` يرفع `loggedOut=false` فتختفي LoginScreen قبل ظهور المودال الإجباري. الإصلاح مزدوج: بوابة App.tsx تحتجز من عليه `mustChangePin` في LoginScreen، وLoginScreen تشتق `effectiveMustSet` من المخزن مباشرة (لا حالة محلية فقط).
- **② دخول موحد بلا زر مالك**: أُلغي زرا «موظف/دخول المالك». `OwnerProfile` (اسم/هاتف/بريد/صورة، الافتراضي «المالك») في audit.ts + `matchesOwnerIdentity()` — المعرف المكتوب يحدد المسار، واسم المالك من ويزارد الإعداد يعمل كمعرف احتياطي. «نسيت رقمي» موحد أيضاً (مالك→تليجرام، موظف→طلب للمالك). `updateOwnerProfile` يمنع تصادم الهوية مع معرفات الموظفين والعكس.
- **③ صفحة «حسابي» `/settings/profile`** (نمط Lightspeed self-service): مفتوحة للجميع (استثناء مقصود في verify_permissions)، فيها `changeMyPin(currentPin, newHash)` بتحقق الرقم الحالي (مالك وموظف) + `updateMyProfile` (هاتف/بريد/صورة avatarDataUrl مضغوطة 160px) + المالك يدير هويته منها. أفاتار الهيدر يفتحها.
- **④ شريط قوالب الكاشير انتقل فوق الفاتورة** (تحت هيدر السلة) بدل أسفل الإجماليات.
- **⑤ تصفية الإشعارات بالصلاحيات**: `AppNotification.perm` (exp→inv.view، ins→party.customer.statement، issue/pinreset→set.users، chq→acc.vouchers) + `visibleNotifications(all, perms)` — الهيدر يفلتر بصلاحيات المستخدم النشط؛ الكاشير لا يرى مالية ولا إدارية.
- **⑥ طباعة المشتريات ومرتجعاتها بالقوالب الثلاثة**: `buildSimpleDocModel` في receipt.ts (بلا ضريبة عرض) + `printModelWithTemplate` في ui/print/printDoc.ts + مكوّن `PrintTemplateModal` (اختيار حراري/A4/A5 لحظة الطباعة، جلسة فقط) — مستخدم في PurchasesPage وPurchaseReturnsPage وSaleReturnsPage.
- **⑦ سياسة «لا بيع بلا وردية»** (نمط Toast/Square): `setup.requireOpenShiftForSales` (الافتراضي **true**) — `postSale` يرمي خطأً عربياً عبر `shiftRequiredForSales()` (يقرأ localStorage كحارس الخزينة). UI: مفتاح في GeneralSettingsPage + شارة الكاشير تصير زر «⛔ افتح وردية أولاً» نابضاً يفتح مودال فتح وردية داخل POS + زر الدفع وF9 يوجهان للمودال. ⚠️ **سكربتات التحقق**: أي سكربت يستدعي postSale يجب أن يضبط `requireOpenShiftForSales: false` في `shopsys-app` (حُقنت في 70 سكربتاً) أو يفتح وردية.
- الفحص: `verify_owner_batch8_points.mjs` — جزء عام (①②③⑤) + 18/18 نشاطاً (⑥ طباعة شراء/مرتجع ×3 قوالب + ⑦ رفض/سماح/ربط shiftId). البوابة: 130 سكربتاً.

## 9) حالة العمل الجارية والتالي

- ✅ منجز: **كل الفجوات المعيارية السبع** (وصفات، صاغة، قوائم أسعار، تكاليف معدات، أمانة، سائقون، تأمين، **مصفوفة لون×مقاس**) + عمق المقاولات الكامل.
- ✅ منجز أيضاً (أوامر التعديل الجديدة): يوميات مرنة، BOQ كامل بموازنات، تحويل عرض→مشروع ناقل للبنود، ربط عملاء إداري، تحصيلات FIFO بمطابقة اختيارية، أذون صرف مواد، باطن باستقطاعات ودفعات مقدمة، EVM، محرك موافقات، مركز موردين.
- ✅ منجز إضافياً: نموذج المشروع المقسّم أقساماً (عقد/عميل/تنفيذ بحقول رقم عقد وموقع وتسليم متوقع ومدير ووسوم — Project fields اختيارية)؛ حزمة E2E (11 اختباراً تشمل تدقيق عزل الأنشطة)؛ تقرير المقارنة مع Odoo/ERPNext في docs/تقرير_المقارنة_مع_Odoo_وERPNext.md (أهم فجوة مرشحة: أوامر شراء PO منفصلة).
- ✅ منجز (دفعة الأوامر الـ25 — الجزء الأول، كوميت c28f46f): دقة الوردية (بنكي خارج الدرج + مجزأ مقسوم)، إصلاح مديونيات العملاء، المدفوع/المتبقي على المطبوعات، تسوية فرق الوردية (مصروف/إيراد/سلفة)، رسوم التحويل بين الخزائن (5108)، حارس الرصيد السالب المركزي (allowNegativeTreasury)، حقول الخزائن الاحترافية، كشوف حساب احترافية، جرس تنبيهات فعّال، تحكم العلامة المائية/اللوجو. فحصها: verify_batch25_core.mjs.
- ✅ منجز (تعديل الفواتير + الفاتورة الإلكترونية): القسم 8.5 أعلاه — editSale/editPurchase + السياسات النقية + UI الأزرار والمودالات + 38 فحصاً.
- ✅ منجز (batch25 — الجزء الثاني): الأوامر 8 و13 و22 و23 و24 كاملة — القسم 8.7 أعلاه. فحصها: verify_batch25_part2.mjs (59).
- ⏳ التالي: المراجعة النشاطية الشاملة (الطلبات 6–9): نماذج الإدخال لكل نشاط، مطابقة الأقسام الظاهرة، البحث عن أقسام ناقصة، مقارنة كل نشاط بأقوى برنامج عمودي — بالترتيب: أغذية/سوبرماركت ← موبايلات ← ملابس ← صيدلية ← مطعم ← البقية.
- ⏳ متبقٍ متدرج: تعميم النماذج المقسمة على بقية الشاشات القديمة؛ توسعة stockMoves لكل الحركات؛ Electron وPlaywright الفعلي مؤجلان مع المثبت (قرار المالك).
- مؤجل بقرار: مثبّت Electron/NSIS؛ بوت المطور التفاعلي الكامل؛ صفحة WIP مستقلة (الشريط موجود في صفحة BOQ).

## 9) دفعة «القوائم المالية وسياسة الأقسام» (مطبقة — eed2599 → 6f1f503)

- **القوائم المالية العالمية** (`core/financialReports.ts`): ميزان مراجعة، قائمة دخل،
  مركز مالي (بأرباح مرحلة تقفل قائمة الدخل)، دفتر أستاذ عام برصيد جارٍ، تدفق نقدي مباشر
  (بالحساب المقابل الأبرز)، تقرير ض.ق.م — كلها من دفتر اليومية الموحد.
  الواجهة: تبويب «القوائم المالية» في مركز التقارير (dropdown + فترة + طباعة/PDF + Excel CSV بـ BOM).
  تحقق: `verify_financial_reports.mjs` (24) + الفحص التقاطعي في `verify_engine_full_audit.mjs`.
- **الرصيد الحي في السندات** (VouchersPage): كشف حساب كامل للطرف المختار قبل الحفظ
  (يشمل النقلات/الصيانة/الإيجار عبر customerUnitDocs + تسويات العملاء).
- **رصيد كل مخزن في كارت الصنف** (ItemsPage): computeWarehouseStock عند تعدد المخازن.
- **سياسة الأقسام**: لا تبديل وحدات من الإعدادات؛ `effectiveModules(activityId, extraModules)`
  = افتراضيات النشاط + ما وقّعه المطوّر في الرخصة (`LicensePayload.extraModules` داخل canonicalPayload؛
  license_tool يدعم `--extra-modules`). التفعيل يعيد الحساب في setActivated.
  تحقق: `verify_sections_policy.mjs` (15).
- **قفل البلد**: أُزيل زر resetSetup من الإعدادات نهائياً — التغيير عبر المطوّر فقط.
- **المعالج الجديد**: بلد/نشاط منسدلة ببطاقات معاينة، حركات wizardSlideIn/orbDrift/anim-glow في index.css،
  بيانات منشأة إلزامية (هاتف/بريد/مدينة منسدلة من `core/cities.ts` لكل الدول الـ19/شارع)،
  تُحفظ في setup.phone/email/city/street عبر completeSetup({contact}).
  ⚠️ تحديث اختبار e2e_registration عند أي تعديل على المعالج (يستخدم querySelectorAll('select')).
- **هوية لونية لكل نشاط**: `ACTIVITY_ACCENTS` + `activityAccentId()` في core/appearance.ts
  (لوحات جديدة orange/cyan/gold — المجموع 11)؛ completeSetup يضبط accentId تلقائياً
  والمستخدم حر يغيّره من المظهر. تحقق: `verify_activity_theming.mjs` (24).
  ⚠️ verify_appearance يفحص ACCENTS.length === 11 الآن.
- **إصلاح ظل المودال**: الحركة كانت على الحاوية واللوحة معاً مع backdrop-blur متحرك — الآن
  التعتيم يتحرك وحده (anim-in على طبقة الخلفية فقط، بلا blur).
- **المراجعة الشاملة للمحرك** (`verify_engine_full_audit.mjs` — 53 فحصاً):
  إعدام/استبدال/مطعم بوصفة/محافظ/تأمين/معمل بعمولة (تستحق على **2105** لا 2111)/
  أقساط بهامش (أصل المديونية من فاتورة البيع لا من الخطة — حركة 1104 للخطة = هامش−مقدم−أقساط)/
  كسر ذهب FIFO/عهدة كاملة/مقاولات/أمانة سيارات/إنتاج مسبق/تحويل وجرد (postStocktake يحتاج
  CountInput كاملاً: nameAr/expectedQty/unitCostMinor) + تطابق القوائم المالية من مسارين مستقلين.
  ⚠️ السكربتات الحية تبدأ بـ `S().seed([])` لإنشاء المخزن الرئيسي.

## 8.23) نقلة المقاولات الكبرى + نشاط العقارات (الجولة الحالية — مطبقة)
### المقاولات (مقارنة pro-acc + اكفليكس + دفترة):
- **المستخلص البندي من BOQ** (نمط AccFlex): `computeExtractLines` في core/contracting.ts — نسب تنفيذ **تراكمية** لكل بند (ترفض التراجع و>100 وبند مشروع آخر)، قيمة الشريحة = الإجمالي×(الجديدة−السابقة). `addProjectExtract` يقبل `extractLines` بدل `grossMinor` ويحدّث `progressPercent` للبنود ذرياً. مودال المستخلص بوضعين (بندي افتراضياً عند وجود BOQ).
- **المستخلص الختامي**: `isFinal` يمنع أي مستخلص لاحق («أفرج عن المحتجز لإقفاله»).
- **موازنة الفئات + الانحراف**: `projectBudgets` (materials/labor/equipment/subcontract/other) + `budgetVarianceReport` (ok / warning≥85٪ / over>100٪ — **فعلي بلا موازنة = over**). صفحة `/contracting/budget`. `setProjectBudget` يستبدل لا يراكم.
- **مهام/جانت مبسط**: `projectTasks` بحالات تلقائية من النسبة (pending/in_progress/done)، تقدم تراكمي لا يتراجع، ربط اختياري ببند BOQ من نفس المشروع. صفحة `/contracting/tasks` بشريط زمني وخط اليوم وتلوين المتأخر.
- **شهادة باطن بنسبة إنجاز**: `SubContract.advanceRecoveryPercent + progressPercent`؛ `addSubCertificate({newProgressPercent})` تحسب الشريحة من قيمة العقد وتخصم المقدمة **تلقائياً** بنسبة العقد بسقف رصيدها.
- **أوامر التغيير**: حالة `invoiced` (approved→invoiced فقط) وتبقى ضمن `effectiveContractValue`.
- **الضمانات**: BondType += `warranty` (ضمان صيانة) و`insurance`.
- **المناقصات**: `Quotation.winProbability + bidBondMinor` + `quotationPipeline` (القيمة المتوقعة للمقدَّمة) — 3 بطاقات ملخص في QuotationsPage.
- **getProjectWip**: الموازنة = الصريحة ← Σ(qty×estCost) للبنود ← Σ إجمالي BOQ.
- تحقق: `verify_contracting_itemized.mjs` (**43 فحصاً**).

### العقارات (النشاط 21 — معايير سند/الوسيط/سمات السعودية):
- `core/realestate.ts` نقية بالكامل: عقار **مملوك** (إيراد 4113، بيع 4115/5116، أصل 1113) أو **مدار** (سعي 4114 بنسبة + نصيب المالك 2115)؛ عقد إيجار بجدول أقساط `generateLeaseSchedule` (شهري/ربع/نصف/سنوي — الباقي على الأخير)؛ تأمين مسترد 2103 يُرد ناقص خصم أضرار (4110)؛ صيانة وحدة على المكتب (5108) أو **خصماً من مستحق المالك** بسقف رصيده؛ `collectLeaseAlerts` (انتهاء ≤60 يوماً + أقساط متأخرة).
- **ض.ق.م**: أجرة السكني معفاة (السعودية) — تُحصَّل على **السعي** دائماً عند تسجيل ض.ق.م، وعلى أجرة المملوك اختيارياً (`vatOnRent`).
- repo: `properties/propertyUnits/leases/ownerTxns` + 9 إجراءات + 7 مصادر قيد جديدة؛ `ejarNumber` لتوثيق منصة إيجار.
- UI: `/realestate/properties` و`/realestate/leases` (قسم teal) + جرس (leaseAlerts) + شروحات + هوية نشاط.
- **العدد الآن 21 نشاطاً** — أي سكربت/اختبار يفحص العدد حُدّث (16 موضعاً). `toggleModuleList` يعد realestate وحدة عمل.
- تحقق: `verify_realestate.mjs` (**37 فحصاً**). ⚠️ حسابات جديدة: 1113، 2115، 4113–4115، 5116.

### 8.24 المراجعة الشاملة الكبرى (5 دفعات — d4f1128 حتى 1a8f931)
- **strict: true مفعل في tsconfig.app.json ويمر بصفر أخطاء** — أي كود جديد يخضع لفحص null/undefined الكامل.
- أُزيلت كل الأكواد الميتة المؤكدة: quotationLineTotal، buildProjectPurchaseEntry (منطق repo أغنى)، clearLog، ALL_UNITS، ComingSoon.tsx.
- مصادر التسميات وحيدة: CHANGE_ORDER_STATUS_LABELS وISSUE_STATUS_LABELS وPARTY_CODE_LABELS مربوطة في الواجهات.
- ACTIVITY_GUIDES الآن 21/21 (سُدّت فجوة butcher وdates).
- تبعيات useMemo الناقصة أُصلحت في VouchersPage/StatementsPage/Dashboard؛ كائن العملة مثبت بمذكرة في Header/ScaleSettingsPage.
- فحوص عرضية موثقة كلها خضراء: توازن القيود المضمنة الثلاثة، migrate يغطي كل الحقول، ROUTE_PERMISSIONS بالبادئات تغطي 83 مساراً، لا حسابات وهمية، لا مفاتيح localStorage يتيمة، آلية العكس متسقة.
- oxlint: 25 تحذيراً متبقياً كلها أنماط مقصودة (react purity على Date.now في العرض، only-export-components، no-control-regex في التعقيم) — لا يُعمل على «تصفيرها» بلا داعٍ وظيفي.

## 8.25) دفعة المالك الكبرى — 18 مطلباً (مطبقة — 09236fd + f7747a7)
- **كلمة السر 8–32 خانة (أرقام+حروف+رموز)**: `PIN_MIN_LENGTH/PIN_MAX_LENGTH/validatePinFormat` في `core/auth.ts` تُفرض **عند التعيين فقط** — `hashPin/verifyPin` في audit.ts محايدة (توافق خلفي: الأرقام القديمة 4-8 تدخل حتى أول تغيير). كل حقول كلمة السر عبر مكوّن **`PinInput`** الموحد في components/ui.tsx (عين إظهار/إخفاء 👁): LoginScreen، SupervisorPinDialog (inline بنفس النمط)، PermissionsPage (3 مودالات)، ProfilePage، FirstRunWizard.
- **هوية المالك من التسجيل**: خطوة 4 في FirstRunWizard تتضمن إنشاء كلمة سر المالك إلزامياً — `finish()` أصبح async: `updateOwnerProfile({nameAr,phone,email})` + `setOwnerPin(hash)` قبل `completeSetup` ⇒ شاشة الدخول مفعلة من اللحظة الأولى واسم المالك/هاتفه/بريده معرفات دخوله. ⚠️ اختبار e2e_registration يملأ حقلي كلمة السر وينتظر `waitFor(setup.completed)`.
- **حفظ بيانات الدخول (بطلب صريح من المالك)**: checkbox في LoginScreen — تُحفظ مشفرة بمفتاح الجهاز (`encryptForDevice`) في `tahakam-saved-login` وتُملأ تلقائياً؛ إلغاء التحديد يمسحها.
- **سنة مالية واحدة مفتوحة فقط**: validateFiscalYear يرفض فتح سنة وأخرى مفتوحة. **تقرير السنة**: `buildFiscalYearReport(journal, fy, closingEntryIds)` في core/fiscal.ts — رصيد أول السنة/حركة الفترة/الختامي لكل حساب + ملخص إيراد/مصروف/صافي (يستثني قيد الإقفال من الملخص). UI: زر «📊 تقرير السنة» لكل سنة في GeneralSettingsPage. ⚠️ حُدّث verify_barcode_fiscal وverify_audit_support للسياسة الجديدة.
- **phoneExample لكل بلد** في countries.ts + `phonePlaceholder(countryCode)` — placeholder الهاتف في: FirstRunWizard، WalletServicesPage، PartiesPages، ClinicPages، LabPages، EmployeesPage، ExternalCommissionsPage، LaundryPage، MaintenancePage، ProfilePage.
- **أدوار حسب النشاط**: `ACTIVITY_ROLES` في permissions.ts (مقاولات: مدير مشاريع+مهندس موقع؛ عيادة: طبيب+استقبال؛ معمل: فني+استقبال؛ عقارات: مدير أملاك+وسيط؛ لوجستيات/سيارات/تأجير/مغسلة/موبايل/مطعم) — `rolesWithOverrides(overrides, customRoles, activityId?)` توقيعها الجديد بوسيط ثالث اختياري، مررناه في 7 مواضع استدعاء.
- **BOQ عند إنشاء المشروع**: مودال المشروع في ContractingPages بوضعين — «بنود جدول كميات» (افتراضي: بنود بخانات مسماة، قيمة العقد تُحسب تلقائياً وتُسجل البنود عبر addBoqItem) أو «قيمة إجمالية» للمقطوعية.
- **عزل الضريبة عن ربحية المشاريع**: `buildProjectCostEntry(..., inputVatMinor)` — الصافي فقط على 5110، الضريبة على 2102؛ `addProjectCost` يقبل `inputVatMinor` (العهدة تُخصم بالإجمالي)؛ خانة ض.ق.م في مودال التكلفة؛ فاتورة الشراء المربوطة بمشروع كانت أصلاً تعزل عبر خانة inputVat (تلميح موسع). جهة الإيراد سليمة أصلاً (4107 صافٍ).
- **QuotationsPage**: بنود بخانات مسماة فوق كل حقل (بطاقة لكل بند) بدل صف عناوين lg-only.
- **فلترة barcode/scale**: barcode-center مربوط `module: 'pos'` وscale مربوط `feature: 'weight_scale'` في navCatalog ⇒ المقاولات ونحوها لا تراهما. ⚠️ تعليقات داخل مصفوفات navCatalog يجب أن تكون `//` لا `{/* */}`.
- **جدولة النسخ**: `backupIntervalMinutes` في app.store (افتراضي 60) + `BACKUP_INTERVAL_CHOICES` في security.ts + `isBackupDue(last, now, intervalMs)` + UI أزرار في BackupPage.
- **الولاء بشرح ديناميكي**: بطاقة «كيف تعمل إعداداتك؟» في GeneralSettingsPage تحسب مثالاً حياً (فاتورة 100 وحدة) من القيم الفعلية وتتحدث مع تغييرها.
- **توسيع سجل النشاطات**: WATCHED في audit.ts صار ~26 سجلاً (مشاريع/عروض/BOQ/باطن/أوامر تغيير/مهام/عقارات/إيجارات/مرضى معمل وعيادة/تحاليل/محيلين/مركبات plateNumber/معدات/عقود تأجير contractNumber/وصفات/قوائم أسعار/ملفات عهدة fileNumber/أقسام) — كل إضافة/حذف يسجل تلقائياً، والقيود تغطي كل العمليات المالية أصلاً.
- ✅ **دُفعت الدفعة كاملة في `bff0ea5`** (كوميت جامع واحد بعد مسح بيئة خامس — git fetch + reset FETCH_HEAD بلا --hard).

## 8.26) مراجعة دقيقة لدفعة الـ18 (بطلب المالك) — إصلاحات ما بعد الدفعة
- **🐛 SupervisorPinDialog**: زر الاعتماد كان `pin.length < PIN_MIN_LENGTH` ⇒ مشرف برقم قديم (4-8 أرقام، توافق خلفي مقصود) **عاجز عن الاعتماد**. أُصلح إلى `< 4` — التحقق الفعلي في `approveByPin` (verifyPin محايدة)، وسياسة 8-32 عند التعيين فقط. نفس المنطق موثق الآن فوق `canSubmit` في LoginScreen (الحد 4 مقصود: أرقام قديمة + رقم مؤقت 6 خانات من تليجرام).
- **🐛 بيانات الدخول المحفوظة لا تُحدَّث عند تغيير كلمة السر خارج شاشة الدخول**: التغيير من «حسابي» (ProfilePage) أو من الصلاحيات (رقم مالك/رقم مبدئي لموظف) كان يترك `tahakam-saved-login` برقم قديم ⇒ ملء تلقائي فاشل يحرق عدّاد القفل. الحل: وحدة مشتركة **`data/savedLogin.ts`** (`loadSavedLogin/storeSavedLogin/clearSavedLogin/updateSavedLoginPin`) — LoginScreen يستهلكها، وProfilePage.savePin + PermissionsPage.saveOwnerPin/saveEmployeePin يستدعون `updateSavedLoginPin(newPin, identifierMatches)` (تُحدَّث فقط إن كانت المحفوظة تخص نفس صاحب التغيير — جهاز مشترك لا يُفسد حفظ مستخدم آخر). لا ترمي أبداً.
- **🐛 كاش tsc خادع**: `npx tsc --noEmit` عاد نظيفاً في مللي ثوانٍ رغم أخطاء حقيقية — **استعمل `npx tsc -b --force` في البوابة** (كشف: useAppStore ناقص الاستيراد + `phonePlaceholder` لا تقبل `string | null` من setup.countryCode — وُسّع توقيعها).
- **نتائج المراجعة السليمة (لا تغيير)**: أدوار مخصصة `custom_N` لا تتصادم مع ids ACTIVITY_ROLES؛ فلترة validBoqLines في UI تطابق validateBoqItem فلا فشل جزئي بعد addProject؛ isBackupDue مستخدمة فعلاً في App.tsx (فحص كل 5 دقائق)؛ closingEntryIds تُبنى من sourceType='year_closing' && sourceId=fy.id؛ العهدة تُخصم بإجمالي صافي+ضريبة بينما projectCosts.amountMinor صافٍ (الربحية نظيفة والقيد متوازن)؛ pinOk في الويزارد يضمن ألا ترمي hashPin في finish.

## 8.27) المراجعة الشاملة الكبرى (بطلب المالك) — كل الأنشطة والأقسام والنواة خمس مرات
- **`scripts/verify_grand_audit_5scenarios.mjs`** (يدخل بوابة run_all تلقائياً): 5 سيناريوهات مستخدم حقيقي عبر 5 أنشطة — S1 سوبرماركت (شراء بمصاريف→كاشير وردية→آجل بحد ائتمان→مرتجع→سلفة ورواتب→إقفال درج)، S2 مقاولات (BOQ→مستخلص بندي بضريبة→تكلفة بعزل ضريبة→عهدة→باطن→ربحية)، S3 عيادة+معمل (زيارة جزئية→تحصيل→محيل بعمولة→سدادها)، S4 عقارات (مملوك+مدار→أقساط→سعي 5٪→صيانة على المالك→سداده→إخلاء→بيع عقار)، S5 لوجستيات+تأجير+صيانة+خزائن. **36 نقطة تفتيش نواة** بعد كل عملية: كل قيد متوازن بمبالغ صحيحة، ميزان مراجعة متزن، 1103 دفتري=فعلي (سماحية نصف قرش×كمية)، كشوف كل الأطراف=دوال الرصيد. الختام: ميزانية عمومية متزنة + قائمة دخل=ميزان بالقرش + تقرير ضريبة سليم البنود.
- **🐛 أُصلح**: `VAT_INPUT_SOURCES` في financialReports.ts لم تشمل `project_cost` بعد دفعة عزل الضريبة ⇒ ض.مدخلات المشاريع كانت تُخصم من بند «المخرجات» في الإقرار (الصافي صحيح والبندان مشوهان). أضيفت.
- **الصلاحيات 87/87**: مالك كامل؛ كاشير محجوب عن الصلاحيات/الرواتب ويفتح POS؛ منح/حجب فردي يسري؛ أدوار الأنشطة تظهر لنشاطها فقط؛ كل صلاحيات ACTIVITY_ROLES معرفة في القاموس؛ لا تصادم ids؛ override دور نشاط يسري؛ كل مسار محمي له صلاحية معرفة.
- **تدقيق الشريط الجانبي للـ21 نشاطاً** (محاكاة فلترة Sidebar نصياً): كل نشاط يحصل على أقسامه الصحيحة (بقالة 8 أقسام/48 رابطاً، مقاولات 8/52 بمخزون+مشتريات بلا كاشير/ميزان، عيادة 6/33، عقارات 6/33...) وكل رابط في NAV_SECTIONS له Route فعلي (82/82).
- **هيكل الكود**: core (90 وحدة نقية بلا react/zustand — الاتجاه core←data←ui محفوظ، صفر دوائر)؛ ui لا يبني قيوداً يدوياً (JournalPage draft يمر عبر postManualEntry)؛ لا TODO/FIXME/console.log منسية؛ `as any` واحدة موثقة (rawSet في وسيط الترحيل)؛ exports «غير المستخدمة» (pushSnapshot/dateInOpenYear/HOURLY_*) هي قيم افتراضية أو دوال نواة مغطاة بالسكربتات — ليست كوداً ميتاً بل API نواة.
- ملاحظة معلوماتية: خصم تأمين التأجير يُعد إيراداً عاماً (4104) لا إيراد تشغيل للمعدة في getEquipmentProfit — تمييز مقصود وسليم.

## 8.28) الجولة الشاملة الثانية (بطلب المالك — نفس الطلب مكرر بعمق أكبر)
- **`scripts/verify_grand_audit_round2.mjs`**: 5 سيناريوهات حافة جديدة غير مغطاة في الجولة الأولى — R1 موبايلات (سيريالات شراء/بيع/رفض تكرار + شيك قبض 1106→إيداع→تحصيل بنكي→شيك آخر يرتد فيعيد الدين + خطة أقساط بمقدم وسداد قسط)، R2 مطعم/مخبز (وصفة made_to_order تستهلك خامات عند البيع + إنتاج مسبق تشغيلتين + هالك + جرد بعجز وزيادة معاً)، R3 حوكمة القيود (يدوي→عكس→منع عكس المعكوس والعكس + أرصدة افتتاحية وتحصيلها + editSale لفاتورة مرحلة ثم حاجز ما بعد المرتجع)، R4 مغسلة (عربون 2109→تسليم→استرداد خدمة→إلغاء بعربون مردود + أصل بتمويل جزئي + إهلاك شهري 1201/1202)، R5 سنة مالية (حواجز الإقفال + تقرير 16 حساباً مجموعه الختامي صفر وصافي الربح=قائمة الدخل + منع سنتين مفتوحتين). النتيجة: **35 تحققاً + 25 نقطة تفتيش، صفر أخطاء في كود المنتج**.
- **`scripts/verify_admin_interlinks.mjs`** (9 تحققات ترابط إداري): حذف موظف له عهدة/عميل عليه رصيد محظور؛ مرتجعات تراكمية فوق المباع/المخزون تُرفض؛ إشعار مخزون منخفض؛ ورديتان معاً ممنوعتان؛ عكس قيد مستند تشغيلي محظور.
- **`scripts/verify_pin_approval_roles.mjs`** (11 تحققاً لمسار الاعتماد الحساس): مالك يعتمد كل شيء؛ كاشير بلا صلاحية يُرفض رقمه الصحيح؛ branch_manager يعتمد المرتجع باسمه؛ مستخدم موقوف مرفوض حتى بدور مشرف؛ قفل 5 دقائق بعد محاولات خاطئة يحجب حتى رقم المالك؛ حدث تدقيق يسجل.
- **🐛 أُصلح (2)**: (1) `collectNotifications` كانت تفحص شيكات بحالة `pending` **غير الموجودة أصلاً** في ChequeStatus ⇒ إشعارات «شيك يستحق خلال 7 أيام» لم تكن تظهر أبداً للوارد في الحافظة أو الصادر — الصحيح `held/deposited/issued`. (2) `addAppUser/updateAppUser` كانا يقبلان `roleId` غير موجود في كتالوج الأدوار بصمت ⇒ مستخدم بلا صلاحيات خفياً — أضيف رفض مبكر برسالة عربية. حُدث verify_owner_batch8_points.mjs (كان يمرر 'pending' في عينة اصطناعية).
- **دروس توقيعات** (لا تكررها): parseSerialsInput لا يقبل المسافات فاصلاً؛ أوراق القبض 1106 (1108=عهد موظفين)؛ createInstallmentPlan يشترط بيعاً آجلاً مسجلاً أولاً؛ editSale يتطلب paidMinor إلزامياً؛ addEmployee يحتاج active:true ليقبل addAppUser ربطه؛ الشيك المستلم يبدأ `held` لا `pending`.
- **احترافية الإدخال (قراءة عرضية)**: autoFocus في 24 شاشة/مكوناً؛ inputMode=decimal في 20؛ placeholder في 63/70؛ hint في 49؛ toast خطأ عربي في 61؛ بحث نصي في كل الشاشات الكثيفة (POS/مشتريات/أصناف/عملاء/موردون)؛ POS يعيد التركيز للباركود بعد كل إضافة + F9؛ core نقي 100% (zustand في core بالتعليقات فقط).

## 8.29) الجولة الشاملة الثالثة (بطلب المالك — التكرار الثالث لنفس الطلب، أقسام لم تدخل الجولتين)
- **`scripts/verify_grand_audit_round3.mjs`** (53 تحققاً + 30 نقطة تفتيش): T1 صاغة (كسر FIFO بدفعتين بسعرين — بيع 12جم استهلكهما بالترتيب وربحه دقيق + مقايضة postGoldTradeIn وحواجزها)، T2 مطعم بالأوامر (أمر مفتوح صفر قيود ← تعديل سطور ← تسوية برسوم خدمة 10٪/توصيل ← إلغاء بلا أثر ← حواجز الفارغ/المقفول/الملغى)، T3 عيادة+معمل بتأمين (مواعيد/خطط علاج/بيع مؤمَّن 70٪/مطالبات وتحصيلها/دورة فحص pending→collected→resulted→approved بحواجز القفز/استرداد مؤمَّن يوزع نسبةً: نصيب الجهة يخفض المطالبة والمريض يسترد نقداً نصيبه فقط)، T4 سيارات+لوجستيات (تجهيز يرفع التكلفة ← بيع بربح بعد التجهيز ← moveCarToRental وحواجزه ← رحلة بعمولة سائق 2111 ← تسويتها ← refundTrip على حساب العميل)، T5 مقاولات كاملة (عرض بدورة حالات draft→submitted→won/lost ← تحويل لمشروع ← BOQ ← موازنة ← أمر تغيير معتمد/مرفوض ← مقدم عميل ← مستخلص ← صرف مواد بموظفين ← يوميات ← باطن بمقدم واسترداده ← WIP/EVM/انحراف).
- **🐛 أُصلح (2 محاسبيان جوهريان)**: (1) **postInsuredSale كان يثق بتكلفة المُستدعي** — تكلفة قديمة/صفرية تفصل قيد 5101/1103 عن المخزون. أضيف تثبيت للمتوسط المرجح لحظة الترحيل (نفس درس postSale 2.7) وبناء saleLines من المثبتة. (2) **postInsuredSale وissueMaterials كانا يخصمان stockQty دون دفعات الصلاحية** ⇒ أرصدة دفعات وهمية وتنبيهات صلاحية كاذبة. أضيف استهلاك FEFO للاثنين + حظر بيع المنتهي للمؤمَّن (لا مسار override له)؛ صرف المواد يقبل المنتهي عمداً (قرار مهندس الموقع).
- **دروس توقيعات جديدة**: حالة LabOrder مشتقة من tests (لا حقل status)؛ 4101 دائن فاستخدم -bal؛ عرض السعر دورة حالات لا قفز؛ refund مؤمَّن يقسم النسبة تلقائياً؛ التاريخ الحقيقي اليوم يهم دفعات الصلاحية في السكربتات (استخدم 2027+).
- **ملاحظة معمارية موثقة**: postInsuredSale بلا شاشة UI مستقلة حالياً — إدارة الجهات والتحصيل في LabPages (كوميت 0af1f1f) والصيدلية تبيع مؤمَّناً عبر النواة فقط. ليست كسراً — API نواة جاهزة لما تُطلب شاشتها.
- هيكل: nav 82/82 مسار موجود؛ core/data/ui نقاء طبقات صفر خرق؛ صفر TODO/console.log.
