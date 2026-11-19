/**
 * methodology_manifest.mjs — تعريف **منهجية الفحص** كبيانات لا كنصّ.
 *
 * الطبقات الست مُرتَّبة من الأرخص إلى الأغلى، وكل طبقة تُغلق باباً مختلفاً من أبواب
 * «العيب الذي يمرّ دون علمك»:
 *
 *  ① الحصر الآلي   : ماذا يوجد أصلاً؟ (لا نفحص ما نعرفه فقط)
 *  ② عقد المستند   : هل المستند يقول عن نفسه الحقيقة؟ (الإجمالي = أجزاؤه)
 *  ③ مطابقة الدفتر : هل كل رقم في المستند له أثر دفترب بالقرش؟
 *  ④ تحصين المدخل  : هل كل مدخل فاسد يُرفض بلا أثر جزئي؟
 *  ⑤ سلاسل العمليات: هل يبقى النظام سليماً بعد عشرات المستندات المترابطة؟
 *  ⑥ مطابقة التقارير: هل ما يراه المالك يطابق الدفتر؟
 *
 * البوابة `verify_methodology_manifest.mjs` تُشغّل هذه الطبقات وتفشل إن اختفى سكربت،
 * أو ظهر سكربت فحص غير مُصنَّف، أو خرجت الوثيقة عن التعريف.
 */
export const LAYERS = [
  {
    id: 1,
    numeral: '①',
    title: 'الحصر الآلي للأسطح',
    question: 'ماذا يوجد في الكود أصلاً؟ هل نُفِّذ كل سطح، وهل استُدعي في فحص؟',
    scripts: ['verify_surface_coverage.mjs', 'verify_rare_surfaces.mjs', 'verify_typecheck.mjs'],
    minChecks: 3,
    closes: 'الأسطح النادرة التي لا يمرّ عليها أي فحص (4 أسطح كانت خارج كل تغطية) + أنواع الشيفرة والاختبارات (كان tsc --noEmit يخرج بنجاح وهو لا يقرأ ملفاً)',
  },
  {
    id: 2,
    numeral: '②',
    title: 'عقد المستند الذاتي',
    question: 'هل إجمالي المستند يساوي مجموع أجزائه، وكل بند مُعلن داخل الإجمالي؟',
    scripts: ['verify_document_contracts.mjs'],
    minChecks: 30,
    closes: 'المصروف الذي يُقبل ويُهمل: مستند بإجمالي لا يحتوي بنداً معلناً (D9)',
  },
  {
    id: 3,
    numeral: '③',
    title: 'مطابقة المستند بالدفتر',
    question: 'هل كل رقم في المستند له حركة حساب بالقرش — في الاتجاه الصحيح؟',
    scripts: ['verify_document_ledger.mjs'],
    minChecks: 40,
    closes: 'الحالة المتوازنة الخاطئة: قيد متوازن لكنه لا يمثّل المستند',
  },
  {
    id: 4,
    numeral: '④',
    title: 'تحصين المدخلات',
    question: 'هل كل مدخل فاسد (NaN/سالب/نص/enum مجهول) يُرفض بلا أثر جزئي؟',
    scripts: ['verify_input_hardening.mjs'],
    minChecks: 60,
    closes: 'القيمة التي تُقبل ثم تُقصّ إلى صفر بصمت (ضريبة سالبة، نوع سند مجهول، كمية جرد نكرة)',
  },
  {
    id: 5,
    numeral: '⑤',
    title: 'سلاسل العمليات المترابطة',
    question: 'هل تبقى الثوابت سليمة بعد 26 خطوة عشوائية مترابطة؟',
    scripts: ['verify_operation_chains.mjs'],
    minChecks: 10,
    closes: 'العيب الذي لا يظهر في مستند منفرد بل في تراكم عشرات المستندات',
  },
  {
    id: 6,
    numeral: '⑥',
    title: 'مطابقة التقارير بالدفتر',
    question: 'هل ميزان المراجعة وقائمة الدخل والمركز المالي والإقرار والكشوف تطابق الدفتر بالقرش؟',
    scripts: ['verify_reports_reconcile.mjs'],
    minChecks: 40,
    closes: 'الحساب الصحيح والعرض الخاطئ: تقرير يخالف الدفتر الذي بُني منه',
  },
  {
    id: 7,
    numeral: '⑦',
    title: 'حمولات الأنشطة التجريبية',
    question: 'هل يُحمَّل كل نشاط بذرته كاملة — بلا وثيقة ساقطة، وبلا ثابت مكسور؟',
    scripts: ['verify_demo_activities_load.mjs'],
    minChecks: 14,
    closes: 'فاتورة كاملة تسقط بصمت عند فتح النشاط التجريبي (البقالة كانت تفقد فاتورة كاملة، والمطعم يفصل 1103 بـ13,500)',
  },
  {
    id: 8,
    numeral: '⑧',
    title: 'مراجعة الشجرة بأكملها',
    question: 'هل كل ملف مصدري سليم بنيوياً — شاشة موصولة، بلا أداة لا تعمل في التوزيع، وبلا كود لا يُستدعى؟',
    scripts: ['verify_whole_tree_review.mjs'],
    minChecks: 13,
    closes: 'الكود الموجود ولا يُستدعى: 29 شاشة بلا أي فحص، و3 أزرار تعتمد window.prompt الذي لا يعمل في نسخة Electron فتُعطّل عند المالك',
  },
]

/** أسماء الأعداد بالعربية لعدد الطبقات (لعناوين الوثيقة) */
export const LAYER_COUNT_WORD = { 1: 'طبقة واحدة', 2: 'طبقتان', 3: 'ثلاث طبقات', 4: 'أربع طبقات', 5: 'خمس طبقات', 6: 'ست طبقات', 7: 'سبع طبقات', 8: 'ثماني طبقات' }

/** الحكم النهائي: بوابات الجودة العامة التي تُشغَّل قبل كل تسليم. */
export const FINAL_GATES = [
  { name: 'vitest', command: 'npx vitest run', note: 'كل اختبارات الوحدة والتكامل' },
  { name: 'verify:all', command: 'npm run verify:all', note: 'كل بوابات الفحص + رحلات المستخدم' },
  { name: 'verify:fuzz', command: 'npm run verify:fuzz', note: 'المزعزعات العشوائية ببذور ثابتة' },
  { name: 'tsc', command: 'npx tsc --noEmit', note: 'سلامة الأنواع' },
  { name: 'oxlint', command: 'npx oxlint src --deny-warnings', note: 'لا تحذيرات' },
]

/** عائلات المستندات التي يجب أن تُمارَس داخل طبقة واحدة على الأقل. */
export const DOCUMENT_FAMILIES = [
  { name: 'شراء', markers: ['postPurchase'], sourceType: 'purchase' },
  { name: 'بيع', markers: ['postSale'], sourceType: 'sale' },
  { name: 'مرتجع بيع', markers: ['postSaleReturn'], sourceType: 'sale_return' },
  { name: 'مرتجع شراء', markers: ['postPurchaseReturn'], sourceType: 'purchase_return' },
  { name: 'إتلاف', markers: ['postWastage'], sourceType: 'wastage' },
  { name: 'جرد', markers: ['postStocktake'], sourceType: 'adjustment' },
  { name: 'تحويل مخازن', markers: ['postTransfer'], sourceType: 'transfer' },
  { name: 'سند قبض/صرف', markers: ['postVoucher'], sourceType: 'receipt_voucher' },
  { name: 'إنتاج', markers: ['postProduction'], sourceType: 'production' },
  { name: 'استهلاك داخلي', markers: ['postConsumption'], sourceType: 'consumption' },
]

/** سكربتات الفحص الموجودة قبل المنهجية — تُعامَل كبوابات قديمة (رَتشِت: لا جديد بلا تصنيف). */
export const LEGACY_SNAPSHOT = '../docs/بوابات_قديمة.txt'

export const DOC_PATH = '../docs/منهجية_الفحص.md'
