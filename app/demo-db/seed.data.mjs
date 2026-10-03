/**
 * مصدر البيانات التجريبية (وضع التطوير فقط) — تَحَكَّم.
 *
 * هذا الملف هو النص القابل للقراءة والتعديل يدوياً؛ تشغيل `npm run demo:build`
 * يحوّله إلى قاعدة بيانات SQLite حقيقية في `app/demo-db/demo.sqlite`.
 * يمكنك أيضاً تعديل القاعدة مباشرة (أي أداة SQLite أو لوحة «بيانات تجريبية»
 * داخل التطبيق) — البناء لا يتم إلا عند طلبه صراحة فلا تُفقد تعديلاتك.
 *
 * كل المبالغ بالقروش (أصغر وحدة) — لا كسور عشرية في الكود إطلاقاً.
 */

/** أداة مختصرة لبناء صنف */
const item = (ref, name_ar, sku, category_ref, cost, price, stock, extra = {}) => ({
  ref, name_ar, sku, category_ref, cost_minor: cost, price_minor: price, stock_qty: stock, ...extra,
})

/** §96: مستند المقاولات — نوع + مرجع + حقول JSON (يصب في جدول contracting_docs) */
const doc = (kind, ref, data) => ({ kind, ref, data: JSON.stringify(data) })

export const DEMO_ACTIVITIES = [
  {
    id: 'grocery',
    name_ar: 'أغذية / سوبر ماركت',
    shop_name: 'سوبر ماركت المنصورة',
    owner_name: 'محمد عبده',
    note: 'نشاط تجزئة سريع الدوران: باركود، أوزان، صلاحية، وفروع متعددة.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'GR-01', name_ar: 'فرع المنصورة — التشغيل اليومي', notes: '' },
      { ref: 'cc2', code: 'GR-02', name_ar: 'فرع طلخا', notes: '' },
      { ref: 'cc3', code: 'GR-03', name_ar: 'المخزن المركزي والإدارة', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'الفرع الرئيسي — المنصورة', city: 'المنصورة', phone: '0502200110', is_main: 1 },
      { ref: 'talkha', name_ar: 'فرع طلخا', city: 'طلخا', phone: '0502200220' },
    ],
    warehouses: [
      { ref: 'wh-main', name_ar: 'المخزن الرئيسي', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-shelf', name_ar: 'مخزن العرض (الرفوف)', branch_ref: 'main' },
      { ref: 'wh-talkha', name_ar: 'مخزن فرع طلخا', branch_ref: 'talkha' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'الخزينة الرئيسية', kind: 'cash', branch_ref: 'main', opening_minor: 500000 },
      { ref: 'cash-talkha', name_ar: 'خزينة فرع طلخا', kind: 'cash', branch_ref: 'talkha', opening_minor: 150000 },
      { ref: 'bank-cib', name_ar: 'بنك CIB — الحساب الجاري', kind: 'bank', bank_name: 'التجاري الدولي', account_no: '100020003000', opening_minor: 2500000 },
      { ref: 'bank-misr', name_ar: 'بنك مصر — حساب الفروع', kind: 'bank', bank_name: 'بنك مصر', account_no: '400050006000', opening_minor: 800000 },
      { ref: 'wallet-cib', name_ar: 'محفظة CIB الإلكترونية', kind: 'wallet', parent_ref: 'bank-cib', bank_name: 'التجاري الدولي', account_no: '01001234567', opening_minor: 120000 },
      { ref: 'wallet-misr', name_ar: 'محفظة بنك مصر (BM Wallet)', kind: 'wallet', parent_ref: 'bank-misr', bank_name: 'بنك مصر', account_no: '01117654321', opening_minor: 60000 },
    ],
    terminals: [
      { code: 'POS-01', name_ar: 'ماكينة الدفع — الكاشير 1', provider_name: 'CIB', branch_ref: 'main', settlement_ref: 'bank-cib', terminal_id: 'TRM-88001', merchant_id: 'MID-5501', serial_number: 'SN-POS-01' },
      { code: 'POS-02', name_ar: 'ماكينة الدفع — فرع طلخا', provider_name: 'بنك مصر', branch_ref: 'talkha', settlement_ref: 'bank-misr', terminal_id: 'TRM-88002', merchant_id: 'MID-5502', serial_number: 'SN-POS-02' },
    ],
    categories: [
      { ref: 'oils', name_ar: 'زيوت وسمن' },
      { ref: 'grains', name_ar: 'بقالة جافة' },
      { ref: 'dairy', name_ar: 'ألبان ومبردات' },
      { ref: 'detergents', name_ar: 'منظفات' },
    ],
    items: [
      item('oil1', 'زيت عباد الشمس 1 لتر', 'OIL-1', 'oils', 4500, 6000, 120, { barcode: '6221031492016', extra_units: 'كرتونة:12', min_qty: 24 }),
      item('ghee', 'سمن نباتي 700 جم', 'GHE-700', 'oils', 5200, 6900, 64, { barcode: '6221031492023', min_qty: 12 }),
      item('rice', 'أرز مصري 5 كجم', 'RICE-5', 'grains', 12000, 15500, 45, { barcode: '6221031492030', extra_units: 'شيكارة:10' }),
      item('sugar', 'سكر ناعم', 'SUG-KG', 'grains', 2800, 3600, 310, { base_unit: 'كجم', sold_by_weight: 1, min_qty: 50 }),
      item('tea', 'شاي أكياس 100 ظرف', 'TEA-100', 'grains', 5200, 7000, 38, { barcode: '6221031492047' }),
      item('milk', 'لبن كامل الدسم 1 لتر', 'MLK-1', 'dairy', 3200, 4200, 90, { track_expiry: 1, min_qty: 20 }),
      item('yogurt', 'زبادي 105 جم', 'YOG-105', 'dairy', 600, 900, 240, { track_expiry: 1, min_qty: 48 }),
      item('cheese', 'جبن رومي', 'CHS-KG', 'dairy', 21000, 26500, 18, { base_unit: 'كجم', sold_by_weight: 1, track_expiry: 1 }),
      item('soap', 'مسحوق غسيل 2.5 كجم', 'DET-25', 'detergents', 9800, 12500, 52, { barcode: '6221031492054' }),
      item('bleach', 'كلور مركّز 1 لتر', 'DET-CL', 'detergents', 1500, 2200, 0, { min_qty: 24 }),
      item('delivery', 'خدمة توصيل داخل المدينة', 'SRV-DLV', '', 0, 2500, 0, { is_service: 1, base_unit: 'طلب' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'مطعم البركة', phone: '01001110001', credit_limit_minor: 500000, notes: 'يشتري بالجملة أسبوعياً' },
      { ref: 'c2', name_ar: 'كافيتيريا النيل', phone: '01001110002', credit_limit_minor: 200000 },
      { ref: 'c3', name_ar: 'أحمد السيد (تجزئة)', phone: '01001110003' },
      { ref: 'c4', name_ar: 'شركة الأمل للتموين', phone: '01001110004', credit_limit_minor: 1500000, notes: 'سداد 30 يوماً' },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'الشركة المصرية للزيوت', phone: '0502233445' },
      { ref: 's2', name_ar: 'موزع الألبان — دلتا', phone: '0502233446' },
      { ref: 's3', name_ar: 'مستودع البقالة الجافة', phone: '0502233447' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-02', supplier_ref: 's1', warehouse_ref: 'wh-main', supplier_doc: 'SI-9001', paid_minor: 300000, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'oil1', qty: 60, unit_price_minor: 4500 }, { item_ref: 'ghee', qty: 30, unit_price_minor: 5200 }] },
      { ref: 'p2', doc_date: '2026-09-10', supplier_ref: 's2', warehouse_ref: 'wh-main', supplier_doc: 'SI-9002', paid_minor: 0,
        lines: [{ item_ref: 'milk', qty: 50, unit_price_minor: 3200 }, { item_ref: 'yogurt', qty: 120, unit_price_minor: 600 }] },
      /* دفعة زبادي منتهية الصلاحية — تظهر في لوحة فرز «منتهي الصلاحية» بثلاثة إجراءات */
      { ref: 'p3', doc_date: '2026-08-20', supplier_ref: 's2', warehouse_ref: 'wh-main', supplier_doc: 'SI-8990', paid_minor: 36000, treasury_ref: 'cash-main',
        notes: 'دفعة قديمة قصيرة الصلاحية — للفرز',
        lines: [{ item_ref: 'yogurt', qty: 60, unit_price_minor: 600, expiry_date: '2026-09-25' }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'محمود عبد الله', phone: '01001112233', job_title: 'كاشير أول', hire_date: '2025-03-01', base_salary_minor: 900000, allowances_minor: 50000 },
      { ref: 'e2', name_ar: 'فاطمة الزهراء', phone: '01001112244', job_title: 'مشرفة أرفف', hire_date: '2025-06-15', base_salary_minor: 800000, allowances_minor: 30000 },
      { ref: 'e3', name_ar: 'كريم سعيد', phone: '01001112255', job_title: 'عامل مخزن', hire_date: '2026-01-10', base_salary_minor: 650000, allowances_minor: 0 },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'present', check_in: '09:00', check_out: '17:00' },
      { ref: 'a2', employee_ref: 'e1', date: '2026-09-25', status: 'present', check_in: '09:20', check_out: '18:00' },
      { ref: 'a3', employee_ref: 'e1', date: '2026-09-26', status: 'absent' },
      { ref: 'a4', employee_ref: 'e2', date: '2026-09-24', status: 'present', check_in: '08:55', check_out: '17:10' },
      { ref: 'a5', employee_ref: 'e2', date: '2026-09-25', status: 'present', check_in: '09:00', check_out: '19:30' },
      { ref: 'a6', employee_ref: 'e3', date: '2026-09-24', status: 'mission', check_in: '07:00', check_out: '15:00', notes: 'استلام شحنة طلخا' },
      { ref: 'a7', employee_ref: 'e3', date: '2026-09-25', status: 'present', check_in: '09:10', check_out: '17:00' },
    ],
    leaves: [
      { ref: 'l1', employee_ref: 'e1', type_id: 'annual', from_date: '2026-09-27', to_date: '2026-09-28', status: 'approved', reason: 'ظرف عائلي' },
      { ref: 'l2', employee_ref: 'e3', type_id: 'unpaid', from_date: '2026-09-20', to_date: '2026-09-20', status: 'approved', reason: 'نعي' },
    ],
    payroll_months: [
      /* مسير سبتمبر: قسائم الثلاثة تُستحق، وقسيمة الكاشير تُسدد بسند صرف على 2104 */
      { ref: 'pm1', month: '2026-09', pay_employee_refs: 'e1', treasury_ref: 'bank-cib' },
    ],
    /* إتلاف جزئي للزبادي المنتهي — يبقى الباقي في لوحة الفرز لتجربة الأزرار الثلاثة */
    wastage: [
      { ref: 'w1', doc_date: '2026-09-26', reason: 'انتهاء صلاحية', notes: 'فرز أولي — الباقي بانتظار القرار',
        lines: [{ item_ref: 'yogurt', qty: 20 }] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-15', customer_ref: 'c1', warehouse_ref: 'wh-main', payment: 'credit', paid_minor: 100000, notes: 'طلب أسبوعي',
        lines: [{ item_ref: 'oil1', qty: 12, unit_price_minor: 6000 }, { item_ref: 'rice', qty: 4, unit_price_minor: 15500, discount_percent: 5 }] },
      { ref: 'i2', doc_date: '2026-09-18', customer_ref: '', warehouse_ref: 'wh-shelf', payment: 'cash', paid_minor: 16000, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'sugar', qty: 2, unit_price_minor: 3600 }, { item_ref: 'tea', qty: 1, unit_price_minor: 7000 }, { item_ref: 'yogurt', qty: 2, unit_price_minor: 900 }] },
      { ref: 'i3', doc_date: '2026-09-22', customer_ref: 'c4', warehouse_ref: 'wh-main', payment: 'card', paid_minor: 53000, treasury_ref: 'bank-cib',
        lines: [{ item_ref: 'cheese', qty: 2, unit_price_minor: 26500 }] },
    ],
  },

  {
    id: 'pharmacy',
    name_ar: 'صيدلية',
    shop_name: 'صيدلية الشفاء',
    owner_name: 'د. منار حسن',
    note: 'أصناف بتواريخ صلاحية وشرائح دوائية وتأمين طبي.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'PH-01', name_ar: 'الصيدلية الرئيسية', notes: '' },
      { ref: 'cc2', code: 'PH-02', name_ar: 'مستودع الأدوية', notes: '' },
      { ref: 'cc3', code: 'PH-03', name_ar: 'الإدارة والمتابعة', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'صيدلية الشفاء — المركز', city: 'المنصورة', phone: '0502244110', is_main: 1 },
      { ref: 'gomhoria', name_ar: 'فرع شارع الجمهورية', city: 'المنصورة', phone: '0502244220' },
    ],
    warehouses: [
      { ref: 'wh-main', name_ar: 'مخزن الصيدلية', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-cold', name_ar: 'الثلاجة (مبردات)', branch_ref: 'main' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'درج الكاشير', kind: 'cash', branch_ref: 'main', opening_minor: 200000 },
      { ref: 'bank-qnb', name_ar: 'QNB — حساب الصيدلية', kind: 'bank', bank_name: 'QNB الأهلي', account_no: '770088009900', opening_minor: 1800000 },
      { ref: 'wallet-qnb', name_ar: 'محفظة QNB', kind: 'wallet', parent_ref: 'bank-qnb', bank_name: 'QNB الأهلي', account_no: '01223334444', opening_minor: 45000 },
    ],
    terminals: [
      { code: 'POS-PH1', name_ar: 'ماكينة التأمين والدفع', provider_name: 'QNB', branch_ref: 'main', settlement_ref: 'bank-qnb', terminal_id: 'TRM-77001', merchant_id: 'MID-3301', serial_number: 'SN-PH-01' },
    ],
    categories: [
      { ref: 'antibio', name_ar: 'مضادات حيوية' },
      { ref: 'analg', name_ar: 'مسكنات وخافض حرارة' },
      { ref: 'cosm', name_ar: 'مستحضرات تجميل' },
      { ref: 'baby', name_ar: 'أغذية أطفال' },
    ],
    items: [
      item('augm', 'أوجمنتين 1 جم — 14 قرص', 'PH-AUG1', 'antibio', 9500, 12000, 40, { track_expiry: 1, min_qty: 10 }),
      item('zinnat', 'زينات 500 مجم', 'PH-ZIN5', 'antibio', 11000, 13800, 25, { track_expiry: 1 }),
      item('panad', 'بنادول إكسترا 24 قرص', 'PH-PAN24', 'analg', 2600, 3500, 150, { track_expiry: 1, min_qty: 30 }),
      item('brufen', 'بروفين 600 مجم', 'PH-BRU6', 'analg', 3100, 4200, 60, { track_expiry: 1 }),
      item('insulin', 'إنسولين سريع — قلم', 'PH-INS', 'antibio', 21000, 26000, 12, { track_expiry: 1, min_qty: 4 }),
      item('cream', 'كريم مرطب للبشرة', 'PH-CRM', 'cosm', 7800, 10500, 35 ),
      item('shampoo', 'شامبو طبي 200 مل', 'PH-SHM', 'cosm', 9200, 12500, 22 ),
      item('milk1', 'لبن أطفال مرحلة 1', 'PH-ML1', 'baby', 16500, 19900, 18, { track_expiry: 1, min_qty: 6 }),
      item('diaper', 'حفاضات مقاس 3 — 48 قطعة', 'PH-DPR3', 'baby', 21000, 25500, 9 ),
      item('measure', 'قياس ضغط وسكر', 'SRV-MSR', '', 0, 2000, 0, { is_service: 1, base_unit: 'خدمة' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'مستشفى الحياة', phone: '0502255111', credit_limit_minor: 3000000, notes: 'تعاقد شهري' },
      { ref: 'c2', name_ar: 'شركة تأمين مصر', phone: '0502255222', credit_limit_minor: 2000000 },
      { ref: 'c3', name_ar: 'سعاد إبراهيم', phone: '01002223333' },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'ابن سينا فارما', phone: '0502266111' },
      { ref: 's2', name_ar: 'المتحدة للأدوية', phone: '0502266222' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-05', supplier_ref: 's1', warehouse_ref: 'wh-main', supplier_doc: 'INV-4411', paid_minor: 250000, treasury_ref: 'bank-qnb',
        lines: [{ item_ref: 'augm', qty: 20, unit_price_minor: 9500 }, { item_ref: 'panad', qty: 50, unit_price_minor: 2600 }] },
      /* دفعة مسكن قاربت الانتهاء — تظهر في تنبيهات الصلاحية (تنتهي خلال 30 يوماً) */
      { ref: 'p2', doc_date: '2026-09-15', supplier_ref: 's2', warehouse_ref: 'wh-cold', supplier_doc: 'INV-4430', paid_minor: 39000, treasury_ref: 'cash-main',
        notes: 'دفعة قصيرة الصلاحية — للتنبيه',
        lines: [{ item_ref: 'panad', qty: 30, unit_price_minor: 2600, expiry_date: '2026-10-15' }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'د. هالة مصطفى', phone: '01003334455', job_title: 'صيدلية مسؤولة', hire_date: '2024-11-01', base_salary_minor: 1500000, allowances_minor: 100000 },
      { ref: 'e2', name_ar: 'أحمد فتحي', phone: '01003334466', job_title: 'مساعد صيدلي', hire_date: '2025-09-01', base_salary_minor: 850000, allowances_minor: 0 },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'present', check_in: '09:00', check_out: '22:00', notes: 'وردية مزدوجة' },
      { ref: 'a2', employee_ref: 'e2', date: '2026-09-24', status: 'present', check_in: '14:00', check_out: '22:00' },
      { ref: 'a3', employee_ref: 'e2', date: '2026-09-25', status: 'permission', check_in: '16:00', check_out: '22:00', notes: 'إذن دوام ظهر' },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-17', customer_ref: 'c1', warehouse_ref: 'wh-main', payment: 'credit', paid_minor: 0, notes: 'أمر توريد شهري',
        lines: [{ item_ref: 'augm', qty: 10, unit_price_minor: 12000 }, { item_ref: 'brufen', qty: 12, unit_price_minor: 4200 }] },
      { ref: 'i2', doc_date: '2026-09-20', customer_ref: '', warehouse_ref: 'wh-main', payment: 'cash', paid_minor: 7000, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'panad', qty: 2, unit_price_minor: 3500 }] },
    ],
  },

  {
    id: 'restaurant',
    name_ar: 'مطعم / كافيه',
    shop_name: 'مطعم البيت الدمياطي',
    owner_name: 'كريم فؤاد',
    note: 'وجبات وخامات مطبخ: تكلفة وصفة، صالة وتيك أواي وتطبيقات توصيل.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'RS-01', name_ar: 'المطبخ', notes: '' },
      { ref: 'cc2', code: 'RS-02', name_ar: 'الصالة والتيك أواي', notes: '' },
      { ref: 'cc3', code: 'RS-03', name_ar: 'الدليفري', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'الفرع الرئيسي — الصالة', city: 'المنصورة', phone: '0502277110', is_main: 1 },
      { ref: 'cloud', name_ar: 'مطبخ التوصيل (كلاود)', city: 'المنصورة', phone: '0502277220' },
    ],
    warehouses: [
      { ref: 'wh-kitchen', name_ar: 'مخزن المطبخ', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-bar', name_ar: 'مخزن المشروبات', branch_ref: 'main' },
      { ref: 'wh-cloud', name_ar: 'مخزن مطبخ التوصيل', branch_ref: 'cloud' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'خزينة الصالة', kind: 'cash', branch_ref: 'main', opening_minor: 900000 },
      { ref: 'cash-delivery', name_ar: 'خزينة الدليفري', kind: 'cash', branch_ref: 'cloud', opening_minor: 80000 },
      { ref: 'bank-nbe', name_ar: 'البنك الأهلي — حساب المطعم', kind: 'bank', bank_name: 'الأهلي المصري', account_no: '990011002200', opening_minor: 1200000 },
      { ref: 'wallet-nbe', name_ar: 'محفظة الأهلي (Phone Cash)', kind: 'wallet', parent_ref: 'bank-nbe', bank_name: 'الأهلي المصري', account_no: '01555666777', opening_minor: 95000 },
    ],
    terminals: [
      { code: 'POS-RS1', name_ar: 'ماكينة الصالة', provider_name: 'الأهلي المصري', branch_ref: 'main', settlement_ref: 'bank-nbe', terminal_id: 'TRM-66001', merchant_id: 'MID-2201', serial_number: 'SN-RS-01' },
    ],
    categories: [
      { ref: 'meals', name_ar: 'وجبات' },
      { ref: 'drinks', name_ar: 'مشروبات' },
      { ref: 'raw', name_ar: 'خامات المطبخ' },
    ],
    items: [
      item('kofta', 'كفتة مشوية — وجبة', 'RS-KFT', 'meals', 6500, 12000, 0, { is_service: 0, base_unit: 'وجبة', stock_qty: 0 }),
      item('firakh', 'نصف فرخة مشوية', 'RS-FRK', 'meals', 7800, 14500, 0, { base_unit: 'وجبة' }),
      item('mahshi', 'محشي مشكل', 'RS-MHS', 'meals', 4200, 9000, 0, { base_unit: 'وجبة' }),
      item('cola', 'مشروب غازي 330 مل', 'RS-COLA', 'drinks', 900, 2000, 240, { track_expiry: 1 }),
      item('juice', 'عصير طازج', 'RS-JUC', 'drinks', 1500, 3500, 0, { base_unit: 'كوب' }),
      item('rice-raw', 'أرز مصري خام', 'RW-RICE', 'raw', 2400, 0, 180, { base_unit: 'كجم', sold_by_weight: 1, min_qty: 40 }),
      item('meat', 'لحم بتلو', 'RW-MEAT', 'raw', 33000, 0, 42, { base_unit: 'كجم', sold_by_weight: 1, track_expiry: 1, min_qty: 15 }),
      item('chicken', 'دجاج طازج', 'RW-CHK', 'raw', 11000, 0, 60, { base_unit: 'كجم', sold_by_weight: 1, track_expiry: 1 }),
      item('oil-raw', 'زيت قلي 10 لتر', 'RW-OIL', 'raw', 41000, 0, 12 ),
      item('service', 'رسوم خدمة الصالة', 'SRV-TBL', '', 0, 1000, 0, { is_service: 1, base_unit: 'طلب' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'شركة دلتا للبترول (بوفيه)', phone: '0502288111', credit_limit_minor: 1000000, notes: 'فاتورة شهرية' },
      { ref: 'c2', name_ar: 'تطبيق توصيل — طلبات', phone: '0502288222', credit_limit_minor: 400000 },
      { ref: 'c3', name_ar: 'زبون صالة', phone: '' },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'جزارة الدلتا', phone: '0502299111' },
      { ref: 's2', name_ar: 'مزرعة الدواجن الحديثة', phone: '0502299222' },
      { ref: 's3', name_ar: 'موزع المشروبات', phone: '0502299333' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-12', supplier_ref: 's1', warehouse_ref: 'wh-kitchen', supplier_doc: 'MT-330', paid_minor: 400000, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'meat', qty: 20, unit_price_minor: 33000 }] },
      { ref: 'p2', doc_date: '2026-09-14', supplier_ref: 's3', warehouse_ref: 'wh-bar', supplier_doc: 'DR-118', paid_minor: 0,
        lines: [{ item_ref: 'cola', qty: 240, unit_price_minor: 900 }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'الشيف حسن', phone: '01004445566', job_title: 'شيف المطبخ', hire_date: '2024-05-01', base_salary_minor: 1800000, allowances_minor: 150000 },
      { ref: 'e2', name_ar: 'مصطفى علام', phone: '01004445577', job_title: 'كاشير صالة', hire_date: '2025-02-15', base_salary_minor: 950000, allowances_minor: 50000 },
      { ref: 'e3', name_ar: 'إسلام رجب', phone: '01004445588', job_title: 'نادل', hire_date: '2026-03-01', base_salary_minor: 700000, allowances_minor: 20000, notes: 'بالقطعة + إكراميات' },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-25', status: 'present', check_in: '11:00', check_out: '23:30', notes: 'وردية رمضانية' },
      { ref: 'a2', employee_ref: 'e2', date: '2026-09-25', status: 'present', check_in: '12:00', check_out: '23:00' },
      { ref: 'a3', employee_ref: 'e3', date: '2026-09-25', status: 'present', check_in: '15:30', check_out: '23:00' },
      { ref: 'a4', employee_ref: 'e3', date: '2026-09-26', status: 'absent' },
    ],
    /* أمر شراء خضار طازج مفتوح — عبّئ منه فاتورة الشراء عند وصول التوريد */
    purchase_orders: [
      { ref: 'po1', supplier_ref: 's1', order_date: '2026-09-27', expected_date: '2026-09-29', warehouse_ref: 'wh-kitchen', notes: 'توريد خضار بداية الأسبوع',
        lines: [
          { item_ref: 'meat', qty: 25, unit_price_minor: 33500 },
          { item_ref: 'firakh', qty: 40, unit_price_minor: 9500, vat_percent: 0 },
        ] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-19', customer_ref: 'c1', warehouse_ref: 'wh-kitchen', payment: 'credit', paid_minor: 0, notes: 'بوفيه اجتماع',
        lines: [{ item_ref: 'kofta', qty: 15, unit_price_minor: 12000 }, { item_ref: 'cola', qty: 15, unit_price_minor: 2000 }] },
      { ref: 'i2', doc_date: '2026-09-21', customer_ref: '', warehouse_ref: 'wh-kitchen', payment: 'cash', paid_minor: 27000, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'firakh', qty: 1, unit_price_minor: 14500 }, { item_ref: 'mahshi', qty: 1, unit_price_minor: 9000 }, { item_ref: 'juice', qty: 1, unit_price_minor: 3500 }] },
    ],
  },

  {
    id: 'clothing',
    name_ar: 'ملابس وأحذية',
    shop_name: 'بوتيك أزياء الدلتا',
    owner_name: 'هالة مصطفى',
    note: 'ألوان ومقاسات ومخزون معرض ومستودع، وبيع بالتقسيط.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'CL-01', name_ar: 'معرض البيع', notes: '' },
      { ref: 'cc2', code: 'CL-02', name_ar: 'المخزن', notes: '' },
      { ref: 'cc3', code: 'CL-03', name_ar: 'التفصيل والتعديلات', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'المعرض الرئيسي', city: 'المنصورة', phone: '0502300110', is_main: 1 },
      { ref: 'mall', name_ar: 'فرع المول', city: 'المنصورة', phone: '0502300220' },
    ],
    warehouses: [
      { ref: 'wh-store', name_ar: 'مستودع البضاعة', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-display', name_ar: 'معرض العرض', branch_ref: 'main' },
      { ref: 'wh-mall', name_ar: 'مخزن فرع المول', branch_ref: 'mall' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'خزينة المعرض', kind: 'cash', branch_ref: 'main', opening_minor: 250000 },
      { ref: 'bank-aaib', name_ar: 'العربي الأفريقي — جاري', kind: 'bank', bank_name: 'العربي الأفريقي', account_no: '550066007700', opening_minor: 2100000 },
      { ref: 'wallet-aaib', name_ar: 'محفظة العربي الأفريقي', kind: 'wallet', parent_ref: 'bank-aaib', bank_name: 'العربي الأفريقي', account_no: '01098765432', opening_minor: 70000 },
    ],
    terminals: [
      { code: 'POS-CL1', name_ar: 'ماكينة المعرض', provider_name: 'العربي الأفريقي', branch_ref: 'main', settlement_ref: 'bank-aaib', terminal_id: 'TRM-55001', merchant_id: 'MID-1101', serial_number: 'SN-CL-01' },
      { code: 'POS-CL2', name_ar: 'ماكينة فرع المول', provider_name: 'العربي الأفريقي', branch_ref: 'mall', settlement_ref: 'bank-aaib', terminal_id: 'TRM-55002', merchant_id: 'MID-1102', serial_number: 'SN-CL-02' },
    ],
    categories: [
      { ref: 'men', name_ar: 'رجالي' },
      { ref: 'women', name_ar: 'حريمي' },
      { ref: 'shoes', name_ar: 'أحذية' },
    ],
    items: [
      item('shirt', 'قميص قطن رجالي', 'CL-SHT', 'men', 28000, 45000, 60, { colors: 'أبيض,أزرق,أسود', sizes: 'M,L,XL' }),
      item('jeans', 'بنطلون جينز رجالي', 'CL-JNS', 'men', 42000, 68000, 35, { colors: 'أزرق,أسود', sizes: '30,32,34,36' }),
      item('jacket', 'جاكيت شتوي', 'CL-JKT', 'men', 85000, 135000, 14, { colors: 'أسود,بني', sizes: 'L,XL' }),
      item('dress', 'فستان سواريه', 'CL-DRS', 'women', 95000, 165000, 12, { colors: 'أحمر,أسود,ذهبي', sizes: 'S,M,L' }),
      item('blouse', 'بلوزة كاجوال', 'CL-BLS', 'women', 22000, 39000, 48, { colors: 'أبيض,وردي', sizes: 'S,M,L' }),
      item('abaya', 'عباية مطرزة', 'CL-ABY', 'women', 55000, 92000, 20, { colors: 'أسود', sizes: 'M,L,XL' }),
      item('sneaker', 'حذاء رياضي', 'CL-SNK', 'shoes', 62000, 99000, 26, { colors: 'أبيض,أسود', sizes: '41,42,43,44' }),
      item('sandal', 'صندل جلد', 'CL-SND', 'shoes', 31000, 52000, 30, { colors: 'بني,أسود', sizes: '40,41,42,43' }),
      item('tailor', 'خدمة تعديل وتفصيل', 'SRV-TLR', '', 0, 7500, 0, { is_service: 1, base_unit: 'قطعة' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'محل الأناقة (جملة)', phone: '0502311111', credit_limit_minor: 2500000 },
      { ref: 'c2', name_ar: 'نهى عبد الرحمن', phone: '01033334444', credit_limit_minor: 100000, notes: 'تقسيط 3 شهور' },
      { ref: 'c3', name_ar: 'زبون معرض', phone: '' },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'مصنع الغزل — المحلة', phone: '0502322111' },
      { ref: 's2', name_ar: 'مستورد أحذية — بورسعيد', phone: '0502322222' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-03', supplier_ref: 's1', warehouse_ref: 'wh-store', supplier_doc: 'TX-770', paid_minor: 800000, treasury_ref: 'bank-aaib',
        lines: [{ item_ref: 'shirt', qty: 40, unit_price_minor: 28000 }, { item_ref: 'jeans', qty: 20, unit_price_minor: 42000 }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'شريف الجندي', phone: '01005556677', job_title: 'بائع معرض', hire_date: '2025-01-05', base_salary_minor: 850000, allowances_minor: 40000 },
      { ref: 'e2', name_ar: 'منى صابر', phone: '01005556688', job_title: 'كاشير', hire_date: '2025-10-01', base_salary_minor: 750000, allowances_minor: 0 },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'present', check_in: '10:00', check_out: '22:00' },
      { ref: 'a2', employee_ref: 'e2', date: '2026-09-24', status: 'present', check_in: '15:00', check_out: '23:00' },
      { ref: 'a3', employee_ref: 'e1', date: '2026-09-25', status: 'present', check_in: '09:40', check_out: '22:00', notes: 'وردية مول كاملة' },
    ],
    quotations: [
      /* عرض سعر أزياء موحدة لمدرسة — بنود حرة بضريبة 14٪ وسعر تنافسي */
      { ref: 'q1', kind: 'quotation', client_name: 'مدرسة النور الخاصة', client_ref: '', title_ar: 'توريد زي موحد للعام الدراسي', valid_until: '2026-10-31', status: 'submitted', win_probability: 65, notes: 'التسليم على دفعتين',
        lines: [
          { name_ar: 'تيشيرت قطنية', description_ar: 'تيشيرت قطن 100٪ مطرز شعار المدرسة', unit_ar: 'قطعة', qty: 400, unit_price_minor: 22000, est_cost_minor: 16000, vat_percent: 14 },
          { name_ar: 'بنطلون رياضي', description_ar: 'بنطلون تريكو بجيوب جانبية', unit_ar: 'قطعة', qty: 400, unit_price_minor: 28000, est_cost_minor: 21000, vat_percent: 14 },
          { name_ar: 'حذاء رياضي أبيض', description_ar: 'حذاء جلد صناعي مقاسات 32–40', unit_ar: 'زوج', qty: 350, unit_price_minor: 85000, est_cost_minor: 66000, vat_percent: 14 },
        ] },
    ],
    purchase_orders: [
      /* أمر شراء أحذية من المستورد — بانتظار التوريد */
      { ref: 'po1', supplier_ref: 's2', order_date: '2026-09-25', expected_date: '2026-10-10', warehouse_ref: 'wh-store', notes: 'تشغيلة مقاسات جديدة',
        lines: [
          { item_ref: 'sneaker', qty: 30, unit_price_minor: 62000, vat_percent: 14 },
          { item_ref: 'dress', qty: 15, unit_price_minor: 95000, vat_percent: 14 },
        ] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-16', customer_ref: 'c1', warehouse_ref: 'wh-store', payment: 'credit', paid_minor: 200000, notes: 'طلب جملة',
        lines: [{ item_ref: 'shirt', qty: 10, unit_price_minor: 45000, discount_percent: 10 }, { item_ref: 'sneaker', qty: 4, unit_price_minor: 99000 }] },
      { ref: 'i2', doc_date: '2026-09-23', customer_ref: 'c2', warehouse_ref: 'wh-display', payment: 'card', paid_minor: 165000, treasury_ref: 'bank-aaib',
        lines: [{ item_ref: 'dress', qty: 1, unit_price_minor: 165000 }] },
    ],
  },
  /* ─── أنشطة المرحلة ⑥ الجديدة (طلب المالك ㉘): أعلاف · مقاولات · تأجير معدات ─── */

  {
    id: 'feed_trade',
    name_ar: 'تجارة الأعلاف والحبوب',
    shop_name: 'أعلاف الدلتا — المنصورة',
    owner_name: 'سيد أبو العلا',
    city: 'المنصورة',
    phone: '0502334455',
    note: 'بيع بالوزن والشيكارة: أعلاف دواجن ومواشي وحبوب مع خلطات خاصة.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'FD-01', name_ar: 'المطحنة والتعبئة', notes: '' },
      { ref: 'cc2', code: 'FD-02', name_ar: 'مبيعات الجملة', notes: '' },
      { ref: 'cc3', code: 'FD-03', name_ar: 'النقل والتوصيل', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'المخزن الرئيسي — طريق طلخا', city: 'المنصورة', phone: '0502334455', is_main: 1 },
      { ref: 'mitghamr', name_ar: 'فرع ميت غمر', city: 'ميت غمر', phone: '0502334466' },
    ],
    warehouses: [
      { ref: 'wh-main', name_ar: 'مخزن الحبوب', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-silos', name_ar: 'الصوامع', branch_ref: 'main' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'خزينة المكتب', kind: 'cash', branch_ref: 'main', opening_minor: 300000 },
      { ref: 'bank-cbe', name_ar: 'بنك القاهرة — الحساب الجاري', kind: 'bank', bank_name: 'بنك القاهرة', account_no: '660077008800', opening_minor: 12000000 },
      { ref: 'wallet-insta', name_ar: 'محفظة انستاباي', kind: 'wallet', parent_ref: 'bank-cbe', bank_name: 'بنك القاهرة', account_no: '01555222333', opening_minor: 40000 },
    ],
    terminals: [
      { code: 'POS-FD1', name_ar: 'ماكينة المكتب', provider_name: 'بنك القاهرة', branch_ref: 'main', settlement_ref: 'bank-cbe', terminal_id: 'TRM-44001', merchant_id: 'MID-9901', serial_number: 'SN-FD-01' },
    ],
    categories: [
      { ref: 'poultry', name_ar: 'أعلاف دواجن' },
      { ref: 'cattle', name_ar: 'أعلاف مواشي' },
      { ref: 'grains', name_ar: 'حبوب خام' },
    ],
    items: [
      item('broiler5', 'علف بادي 5٪ — شيكارة 25 كجم', 'FD-BR5', 'poultry', 48000, 56000, 200, { barcode: '6221031493010', extra_units: 'طن:40', min_qty: 40 }),
      item('layers', 'علف بياض 17٪ — شيكارة 25 كجم', 'FD-LY17', 'poultry', 46000, 53500, 150, { extra_units: 'طن:40' }),
      item('dairy', 'علف حلاب 21٪ — شيكارة 50 كجم', 'FD-DR21', 'cattle', 92000, 108000, 90, { extra_units: 'طن:20' }),
      item('corn', 'ذرة صفراء (كجم)', 'GRN-KG', 'grains', 1450, 1750, 4200, { base_unit: 'كجم', sold_by_weight: 1, min_qty: 500 }),
      item('soybean', 'كسر صويا 46٪ (كجم)', 'SOY-KG', 'grains', 2100, 2500, 1800, { base_unit: 'كجم', sold_by_weight: 1 }),
      item('wheatbran', 'ردة ناعمة (كجم)', 'WB-KG', 'grains', 900, 1200, 3000, { base_unit: 'كجم', sold_by_weight: 1 }),
      item('grower19', 'علف ناهي 19٪ — شيكارة 25 كجم', 'FD-GR19', 'poultry', 44000, 51500, 120, { extra_units: 'طن:40' }),
      item('cottonseed', 'كسب قطن 32٪ (كجم)', 'CS-KG', 'cattle', 1750, 2100, 1500, { base_unit: 'كجم', sold_by_weight: 1 }),
      item('mixservice', 'خدمة خلطة خاصة', 'SRV-MIX', '', 0, 3500, 0, { is_service: 1, base_unit: 'شيكارة' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'مزرعة النور للدواجن', phone: '01006667711', credit_limit_minor: 2000000, notes: 'توريد أسبوعي بالشيكارة' },
      { ref: 'c2', name_ar: 'مزرعة البركة الحلابة', phone: '01006667722', credit_limit_minor: 3000000 },
      { ref: 'c3', name_ar: 'حسن الجرف (تجزئة)', phone: '01006667733' },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'مصنع أعلاف المنصورة', phone: '0502335566' },
      { ref: 's2', name_ar: 'صراج البحيرة للحبوب', phone: '0502335577' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-08', supplier_ref: 's1', warehouse_ref: 'wh-main', supplier_doc: 'FD-5510', paid_minor: 9600000, treasury_ref: 'bank-cbe',
        lines: [{ item_ref: 'broiler5', qty: 200, unit_price_minor: 48000 }] },
      { ref: 'p2', doc_date: '2026-09-16', supplier_ref: 's2', warehouse_ref: 'wh-silos', supplier_doc: 'GR-2211', paid_minor: 0,
        lines: [{ item_ref: 'corn', qty: 3000, unit_price_minor: 1450 }, { item_ref: 'wheatbran', qty: 2000, unit_price_minor: 900 }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'عبد الرحمن فتحي', phone: '01007778811', job_title: 'عامل صوامع وميزان', hire_date: '2025-04-01', base_salary_minor: 750000, allowances_minor: 25000 },
      { ref: 'e2', name_ar: 'ولاء محسن', phone: '01007778822', job_title: 'محاسبة مكتب', hire_date: '2025-08-15', base_salary_minor: 900000, allowances_minor: 0 },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'present', check_in: '07:30', check_out: '15:30' },
      { ref: 'a2', employee_ref: 'e1', date: '2026-09-25', status: 'present', check_in: '07:10', check_out: '16:00', notes: 'شحنة صوامع إضافية' },
      { ref: 'a3', employee_ref: 'e2', date: '2026-09-24', status: 'present', check_in: '09:00', check_out: '17:00' },
    ],
    purchase_orders: [
      /* أمر شراء ذرة صفراء لصوامع الأسبوع القادم — بانتظار التوريد */
      { ref: 'po1', supplier_ref: 's2', order_date: '2026-09-27', expected_date: '2026-10-02', warehouse_ref: 'wh-silos', notes: 'تعبئة الصوامع قبل موسم التسمين',
        lines: [
          { item_ref: 'corn', qty: 5000, unit_price_minor: 1460 },
          { item_ref: 'soybean', qty: 1500, unit_price_minor: 2120 },
        ] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-18', customer_ref: 'c1', warehouse_ref: 'wh-main', payment: 'credit', paid_minor: 2000000, notes: 'طلب التسمية الأسبوعي',
        lines: [{ item_ref: 'broiler5', qty: 60, unit_price_minor: 56000 }] },
      { ref: 'i2', doc_date: '2026-09-22', customer_ref: 'c3', warehouse_ref: 'wh-main', payment: 'cash', paid_minor: 8750, treasury_ref: 'cash-main',
        lines: [{ item_ref: 'corn', qty: 5, unit_price_minor: 1750 }] },
    ],
  },

  {
    id: 'contracting',
    name_ar: 'مقاولات وإنشاءات',
    shop_name: 'شركة الريان للمقاولات العامة',
    owner_name: 'م. عمار الريان',
    city: 'المنصورة',
    phone: '0502445566',
    note: 'مشاريع إنشاء بجداول كميات ومستخلصات وضمانات — الفائز من العروض يصير مشروعاً كاملاً.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'CN-01', name_ar: 'مشروع جامعة الدلتا — مبنى إداري', notes: '' },
      { ref: 'cc2', code: 'CN-02', name_ar: 'المعدات والمخازن', notes: '' },
      { ref: 'cc3', code: 'CN-03', name_ar: 'الإدارة والمتابعة الفنية', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'المكتب الرئيسي — شارع الجيش', city: 'المنصورة', phone: '0502445566', is_main: 1 },
      { ref: 'talkha', name_ar: 'مكتب موقع طلخا', city: 'طلخا', phone: '0502445570' },
    ],
    warehouses: [
      { ref: 'wh-main', name_ar: 'مخزن الموقع المركزي', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-site', name_ar: 'مخزن موقع الجامعة', branch_ref: 'talkha' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'خزينة المكتب', kind: 'cash', branch_ref: 'main', opening_minor: 500000 },
      { ref: 'bank-nbe', name_ar: 'الأهلي — حساب المشروعات', kind: 'bank', bank_name: 'الأهلي المصري', account_no: '550066007700', opening_minor: 10000000 },
      { ref: 'wallet-fawry', name_ar: 'محفظة فوري', kind: 'wallet', parent_ref: 'bank-nbe', bank_name: 'الأهلي المصري', account_no: '01777888999', opening_minor: 30000 },
    ],
    terminals: [
      { code: 'POS-CN1', name_ar: 'ماكينة التحصيلات', provider_name: 'الأهلي المصري', branch_ref: 'main', settlement_ref: 'bank-nbe', terminal_id: 'TRM-33001', merchant_id: 'MID-7701', serial_number: 'SN-CN-01' },
    ],
    categories: [
      { ref: 'materials', name_ar: 'مواد بناء' },
      { ref: 'rentalsrv', name_ar: 'خدمات موقع' },
    ],
    items: [
      item('cement', 'أسمنت بورتلاندي 50 كجم', 'MT-CEM', 'materials', 9000, 10500, 300, { min_qty: 100 }),
      item('steel', 'حديد تسليح 12مم (طن)', 'MT-ST12', 'materials', 3850000, 4200000, 12, { base_unit: 'طن', min_qty: 4 }),
      item('sand', 'رمل غسيل (م3)', 'MT-SND', 'materials', 35000, 42000, 40, { base_unit: 'م3' }),
      item('brick', 'طوب أحمر مفرغ', 'MT-BRK', 'materials', 1800, 2400, 8000, { extra_units: 'ألف:1000' }),
      item('siteeng', 'إشراف هندسي — يوم موقع', 'SRV-ENG', 'rentalsrv', 0, 150000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('survey', 'مساحة وتوقيع محاور', 'SRV-SRV', 'rentalsrv', 0, 80000, 0, { is_service: 1 }),
      item('gravel', 'زلط خشن (م3)', 'MT-GRV', 'materials', 42000, 51000, 60, { base_unit: 'م3' }),
      item('pvc4', 'ماسورة PVC 4 بوصة', 'MT-PVC4', 'materials', 6500, 8500, 400, { min_qty: 50 }),
      item('paintalkyd', 'دهان ألكيد للحوائط (لتر)', 'MT-PNT', 'materials', 3200, 4200, 180, { base_unit: 'لتر' }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'جامعة الدلتا الخاصة', phone: '0502445577', credit_limit_minor: 200000000, notes: 'مشروع مبنى إداري — دفعات مستخلصات (حد يغطي قيمة العقد والضريبة)' },
      { ref: 'c2', name_ar: 'شركة الإسكان الاجتماعي', phone: '0502445588', credit_limit_minor: 30000000 },
      { ref: 'c3', name_ar: 'م. خالد الشاذلي — فيلا خاصة', phone: '01001234567', credit_limit_minor: 3000000 },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'مصنع أسمنت بني سويف', phone: '0502445599' },
      { ref: 's2', name_ar: 'حديد الدخيلة — موزع الدلتا', phone: '0502445600' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-06', supplier_ref: 's1', warehouse_ref: 'wh-main', supplier_doc: 'CM-8811', paid_minor: 2700000, treasury_ref: 'bank-nbe',
        lines: [{ item_ref: 'cement', qty: 300, unit_price_minor: 9000 }] },
      { ref: 'p2', doc_date: '2026-09-14', supplier_ref: 's2', warehouse_ref: 'wh-main', supplier_doc: 'ST-5520', paid_minor: 0,
        notes: 'قسط حديد أول — الباقي مع المستخلص الثاني',
        lines: [{ item_ref: 'steel', qty: 6, unit_price_minor: 3850000 }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'م. طارق عبد الحي', phone: '01008889911', job_title: 'مهندس موقع', hire_date: '2024-10-01', base_salary_minor: 2000000, allowances_minor: 300000 },
      { ref: 'e2', name_ar: 'أحمد المسيري', phone: '01008889922', job_title: 'مساح كميات', hire_date: '2025-05-01', base_salary_minor: 1500000, allowances_minor: 100000 },
      { ref: 'e3', name_ar: 'رمضان أبو لبن', phone: '01008889933', job_title: 'فراش موقع', hire_date: '2026-02-01', base_salary_minor: 600000, allowances_minor: 0 },
    ],
    attendance: [
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'mission', check_in: '07:00', check_out: '18:00', notes: 'يوم صب كامل بالموقع' },
      { ref: 'a2', employee_ref: 'e2', date: '2026-09-24', status: 'present', check_in: '08:00', check_out: '17:00' },
      { ref: 'a3', employee_ref: 'e3', date: '2026-09-24', status: 'present', check_in: '07:30', check_out: '16:30' },
      { ref: 'a4', employee_ref: 'e3', date: '2026-09-25', status: 'absent' },
    ],
    payroll_months: [
      /* مسير سبتمبر للمهندسين — قسيمة مساح الكميات مسددة من حساب المشروعات */
      { ref: 'pm1', month: '2026-09', pay_employee_refs: 'e2', treasury_ref: 'bank-nbe' },
    ],
    quotations: [
      /* عرض تنفيذ أعمال العزل والمباني لمشروع جامعي — بنود بضريبة 14٪ يتحول فائزاً لمشروع */
      { ref: 'q1', kind: 'quotation', client_name: 'جامعة الدلتا الخاصة', client_ref: 'c1', title_ar: 'أعمال مباني وعزل — مبنى إداري (دور أرضي)', valid_until: '2026-10-20', status: 'submitted', win_probability: 70, bid_bond_minor: 500000, notes: 'التنفيذ 45 يوماً من التسليم', convert: 'project',
        lines: [
          { name_ar: 'أعمال حفر وردم', description_ar: 'حفر حتى منسوب التأسيس مع نقل المخلفات خارج الموقع', unit_ar: 'م3', qty: 850, unit_price_minor: 55000, est_cost_minor: 40000, vat_percent: 14 },
          { name_ar: 'مباني طوب 25سم', description_ar: 'مباني طوب أحمر مفرغ بمونة أسمنتية للوجهين', unit_ar: 'م2', qty: 1200, unit_price_minor: 78000, est_cost_minor: 61000, vat_percent: 14 },
          { name_ar: 'عزل مائي للأسطح', description_ar: 'عزل بيتوميني بارد طبقتين مع فرش حماية', unit_ar: 'م2', qty: 640, unit_price_minor: 95000, est_cost_minor: 72000, vat_percent: 14 },
          { name_ar: 'إشراف هندسي', description_ar: 'إشراف يومي وتقارير تقدم ومستخلصات', unit_ar: 'يوم', qty: 45, unit_price_minor: 150000, est_cost_minor: 100000, vat_percent: 14 },
        ] },
      /* مناقصة صرف صحي قيد الترسية — تخضّع بضريبة وخطاب ضمان ابتدائي */
      { ref: 'q2', kind: 'tender', client_name: 'شركة الإسكان الاجتماعي', client_ref: 'c2', title_ar: 'مناقصة أعمال شبكات صرف صحي — منطقة شرق المدينة', valid_until: '2026-11-15', status: 'submitted', win_probability: 45, bid_bond_minor: 1200000, notes: 'مذكرات الأسعار مطلوبة على 3 دفعات — اعتماد جهة الإشراف شرط جزائي',
        lines: [
          { name_ar: 'حفر شبكات خطوط', description_ar: 'حفر وردم لشبكات صرف صحي بأعماق تصل 3.5 م', unit_ar: 'م طولي', qty: 1800, unit_price_minor: 48000, est_cost_minor: 36000, vat_percent: 14 },
          { name_ar: 'ماسورة صرف 8 بوصة', description_ar: 'توريد وتركيب ماسورة PVC صرف 8 بوصة مع مكوناتها', unit_ar: 'م طولي', qty: 1800, unit_price_minor: 39000, est_cost_minor: 30000, vat_percent: 14 },
          { name_ar: 'غرف تفتيش', description_ar: 'تنفيذ غرف تفتيش خرسانية بغطاء حديد زهر', unit_ar: 'غرفة', qty: 36, unit_price_minor: 950000, est_cost_minor: 720000, vat_percent: 14 },
        ] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-20', customer_ref: 'c1', warehouse_ref: 'wh-main', payment: 'credit', paid_minor: 0, notes: 'ذاتية (خارج المستخلصات) — بيع مواد فائضة',
        lines: [{ item_ref: 'brick', qty: 3000, unit_price_minor: 2400 }] },
      { ref: 'i2', doc_date: '2026-09-23', customer_ref: 'c2', warehouse_ref: 'wh-main', payment: 'credit', paid_minor: 0,
        lines: [{ item_ref: 'siteeng', qty: 5, unit_price_minor: 150000 }] },
    ],
    /* مقاول باطن للحفر: عقد بمحتجز 5٪ ودفعة مقدمة وشهادة أولى — قيود 5110/2101/2108/1111 */
    sub_contracts: [
      { ref: 'sc1', quotation_ref: 'q1', contractor_name: 'أبو الفتوح — مقاول حفر وردم', supplier_ref: 's2', scope_ar: 'أعمال الحفر والردم ونقل المخلفات لبند 1 من جدول الكميات', contract_value_minor: 32000000, retention_percent: 5, tax_withhold_percent: 1, advance_percent: 10, start_date: '2026-09-10', advance_minor: 3200000, advance_treasury_ref: 'bank-nbe', certificate_amount_minor: 16000000, certificate_description: 'شهادة 1 — الحفر مكتمل والردم 80٪' },
      { ref: 'sc2', quotation_ref: 'q1', contractor_name: 'الشيخ مبروك — مقاول عزل', supplier_ref: 's1', scope_ar: 'أعمال العزل المائي البيتوميني لبند 3 من جدول الكميات', contract_value_minor: 28000000, retention_percent: 5, tax_withhold_percent: 1, advance_percent: 0, start_date: '2026-09-20', advance_minor: 0, advance_treasury_ref: '', certificate_amount_minor: 12000000, certificate_description: 'شهادة 1 — عزل 40٪ من المسطح' },
    ],
    /* المستخلصات: الأول آجل 35٪ والثاني 60٪ تراكمياً بعد اعتماد أمر تغيير */
    project_extracts: [
      { ref: 'ex1', quotation_ref: 'q1', percent: 35, vat_percent: 14, payment: 'credit', description: 'المستخلص رقم 1 — أعمال حفر وردم ومباني جزئية', treasury_ref: 'bank-nbe' },
      { ref: 'ex2', quotation_ref: 'q1', percent: 60, vat_percent: 14, payment: 'credit', description: 'المستخلص رقم 2 — مباني وعزل حتى 60٪ تنفيذ', treasury_ref: 'bank-nbe' },
    ],
    /* §96: مستندات كل أقسام المقاولات — مشروع يدوي بجدول كمياته وأوامر تغيير وخطابات
       ضمان وعمال يومية وأذون صرف وتكاليف يدوية ودفعة مقدمة وسندات موسومة بمشروع وتحصيل
       FIFO وشراء مربوط ومهام جدولة ومسارات موافقات — الترتيب مُلزِم (المشروع قبل بنوده) */
    contracting_docs: [
      /* —— مشروع يدوي (بلا عرض سعر) + جدول كمياته —— */
      doc('project', 'p2', { name_ar: 'فيلا م. خالد الشاذلي — تشطيبات داخلية', client_name: 'م. خالد الشاذلي', client_ref: 'c3', contract_value_minor: 30000000, retention_percent: 10, start_date: '2026-09-01', contract_number: 'عقد أشغال 46 لسنة 2026', location: 'منية النصر — الدقهلية', manager_employee_ref: 'e1', notes: 'عميل خاص — تحصيل نقدي مع كل مستخلص' }),
      doc('boq_item', 'p2b1', { project_ref: 'p2', code: '1-1', description_ar: 'محارة داخلية ودهان بلاستيك للحوائط والأسقف', unit: 'م2', qty: 1200, unit_price_minor: 8500, est_cost_minor: 6200 }),
      doc('boq_item', 'p2b2', { project_ref: 'p2', code: '1-2', description_ar: 'توريد وتركيب سيراميك وأرضيات', unit: 'م2', qty: 850, unit_price_minor: 11000, est_cost_minor: 8000 }),
      doc('boq_item', 'p2b3', { project_ref: 'p2', code: '1-3', description_ar: 'تمديدات كهرباء ونقاط إنارة ومفاتيح', unit: 'نقطة', qty: 650, unit_price_minor: 2200, est_cost_minor: 1500 }),

      /* —— موازنة التكاليف بالفئات (نمط pro-acc): تقديرية مقابل الفعلي —— */
      doc('budget', 'bg1', { quotation_ref: 'q1', lines: [ { kind: 'materials', amount_minor: 100000000 }, { kind: 'labor', amount_minor: 20000000 }, { kind: 'equipment', amount_minor: 12000000 }, { kind: 'subcontract', amount_minor: 22000000 }, { kind: 'other', amount_minor: 4000000 } ] }),
      doc('budget', 'bg2', { project_ref: 'p2', lines: [ { kind: 'materials', amount_minor: 12000000 }, { kind: 'labor', amount_minor: 6000000 }, { kind: 'other', amount_minor: 2000000 } ] }),

      /* —— أوامر التغيير على عقد الجامعة: معتمد يوسّع السقف + مسودة —— */
      doc('change_order', 'co1', { quotation_ref: 'q1', title_ar: 'أعمال عزل إضافي لدورات المياه والخزان الأرضي', amount_minor: 18000000, status: 'approved' }),
      doc('change_order', 'co2', { quotation_ref: 'q1', title_ar: 'استبدال دهان الواجهة بمواد سيليكون (تعديل مواصفات)', amount_minor: 6500000, status: 'draft' }),

      /* —— دفعة مقدمة من عميل الجامعة (20٪) ثم شراء مربوط بالمشروع —— */
      doc('client_advance', 'adv1', { quotation_ref: 'q1', amount_minor: 41580000, treasury_ref: 'bank-nbe' }),
      doc('project_purchase', 'pp1', { quotation_ref: 'q1', supplier_ref: 's1', supplier_doc: 'CM-8842', date: '2026-09-18', paid_minor: 0, treasury_ref: 'bank-nbe', warehouse_ref: 'wh-main', notes: 'توريد أسمنت وزلط لأعمال المباني — على حساب مشروع الجامعة', lines: [ { item_ref: 'cement', qty: 250, unit_price_minor: 9000 }, { item_ref: 'gravel', qty: 40, unit_price_minor: 42000 } ] }),

      /* —— أذون صرف المواد: موقع الجامعة ثم الفيلا (لا مخزون سالب) —— */
      doc('material_issue', 'mi1', { quotation_ref: 'q1', issued_by_ref: 'e1', received_by_ref: 'e2', notes: 'صرف أسمنت وحديد ورمل لأعمال مباني الدور الأرضي', lines: [ { item_ref: 'cement', qty: 200, unit_ar: '' }, { item_ref: 'steel', qty: 7, unit_ar: 'طن' }, { item_ref: 'sand', qty: 25, unit_ar: 'م3' } ] }),
      doc('material_issue', 'mi2', { project_ref: 'p2', issued_by_ref: 'e1', received_by_ref: 'e2', notes: 'صرف دهان وطوب لأعمال محارة الفيلا', lines: [ { item_ref: 'paintalkyd', qty: 120, unit_ar: 'لتر' }, { item_ref: 'brick', qty: 2, unit_ar: 'ألف' } ] }),

      /* —— تكلفة يدوية (مصدر manual في بطاقة تكاليف المشروع) —— */
      doc('project_cost', 'pc1', { quotation_ref: 'q1', kind: 'equipment', amount_minor: 5500000, payment: 'cash', paid_minor: 5500000, description: 'إيجار سقالات ومعدات خفيفة للموقع — شهر (تحويل بنكي)', treasury_ref: 'bank-nbe' }),

      /* —— مستخلص نقدي لمشروع الفيلا (تحصيل فوري من البنك) —— */
      doc('extract', 'exp2', { project_ref: 'p2', percent: 25, vat_percent: 14, payment: 'cash', description: 'المستخلص رقم 1 — محارة وتمديدات (تحصيل نقدي)', treasury_ref: 'bank-nbe' }),

      /* —— سندات موسومة بمشروع (§95): قبض من عميل الجامعة وصرف لمورد الأسمنت —— */
      doc('project_receipt', 'vr1', { quotation_ref: 'q1', client_ref: 'c1', amount_minor: 45000000, treasury_ref: 'bank-nbe', description: 'دفعة من مستحقات المستخلص رقم 1 — جامعة الدلتا الخاصة' }),
      doc('project_payment', 'vp1', { quotation_ref: 'q1', client_ref: 's1', amount_minor: 1500000, treasury_ref: 'bank-nbe', description: 'دفعة تحت الحساب لمصنع أسمنت بني سويف — مشروع الجامعة' }),

      /* —— تحصيل FIFO من العميل على فواتيره المفتوحة —— */
      doc('client_collection', 'cc1', { client_ref: 'c1', amount_minor: 20000000, treasury_ref: 'cash-main', notes: 'تحصيل نقدي من إدارة الجامعة — تسوية أقدم مستحق' }),

      /* —— خطابات الضمان: ابتدائي مُرد · نهائي نشط · دفعة مقدمة يقرب انتهاؤه · صيانة عام —— */
      doc('bond', 'b1', { quotation_ref: 'q1', bond_number: 'NBE-G-2026-1201', type: 'bid', beneficiary: 'جامعة الدلتا الخاصة', amount_minor: 4158000, margin_minor: 415800, fees_minor: 41580, bank_ref: 'bank-nbe', issue_date: '2026-09-01', expiry_date: '2026-10-05', settle: 'released' }),
      doc('bond', 'b2', { quotation_ref: 'q1', bond_number: 'NBE-G-2026-1305', type: 'performance', beneficiary: 'جامعة الدلتا الخاصة', amount_minor: 10395000, margin_minor: 1039500, fees_minor: 103950, bank_ref: 'bank-nbe', issue_date: '2026-09-10', expiry_date: '2027-03-31', settle: '' }),
      doc('bond', 'b3', { project_ref: 'p2', bond_number: 'NBE-G-2026-1310', type: 'advance_payment', beneficiary: 'م. خالد الشاذلي', amount_minor: 9000000, margin_minor: 900000, fees_minor: 90000, bank_ref: 'bank-nbe', issue_date: '2026-09-15', expiry_date: '2026-10-25', settle: '' }),
      doc('bond', 'b4', { bond_number: 'NBE-G-2025-0998', type: 'warranty', beneficiary: 'جمعية النور التعليمية — أعمال سابقة', amount_minor: 2000000, margin_minor: 200000, fees_minor: 20000, bank_ref: 'bank-nbe', issue_date: '2025-11-01', expiry_date: '2026-11-01', settle: '' }),

      /* —— عمال اليومية: مسدَّد · مستحق على مشروعين · تشغيل عام (5108) —— */
      doc('daily_worker', 'w1', { name_ar: 'عم صابر حمادة — نجار مسلح', phone: '01007778811', daily_wage_minor: 45000, settle_ref: 'bank-nbe', records: [ { quotation_ref: 'q1', date: '2026-09-21', days: 1 }, { quotation_ref: 'q1', date: '2026-09-22', days: 1 }, { quotation_ref: 'q1', date: '2026-09-23', days: 1 } ] }),
      doc('daily_worker', 'w2', { name_ar: 'عم رجب السمان — حداد تسليح', phone: '01007778822', daily_wage_minor: 50000, records: [ { quotation_ref: 'q1', date: '2026-09-22', days: 1 }, { quotation_ref: 'q1', date: '2026-09-23', days: 1 }, { quotation_ref: 'q1', date: '2026-09-24', days: 1.5 }, { project_ref: 'p2', date: '2026-09-25', days: 1 } ] }),
      doc('daily_worker', 'w3', { name_ar: 'سيد فتحي — نظافة ومساعد موقع', phone: '01007778833', daily_wage_minor: 25000, records: [ { date: '2026-09-24', days: 1 }, { date: '2026-09-25', days: 1 } ] }),

      /* —— الجدول الزمني: مهام المشروعين بروابط بنود جدول الكميات —— */
      doc('project_task', 't1', { quotation_ref: 'q1', name_ar: 'أعمال الحفر والردم', start_date: '2026-09-05', end_date: '2026-09-15', progress_percent: 100, boq_index: 1 }),
      doc('project_task', 't2', { quotation_ref: 'q1', name_ar: 'مباني الطوب 25سم', start_date: '2026-09-10', end_date: '2026-10-08', progress_percent: 55, boq_index: 2 }),
      doc('project_task', 't3', { quotation_ref: 'q1', name_ar: 'العزل المائي للأسطح', start_date: '2026-09-25', end_date: '2026-10-18', progress_percent: 30, boq_index: 3 }),
      doc('project_task', 't4', { quotation_ref: 'q1', name_ar: 'الإشراف الهندسي اليومي', start_date: '2026-09-01', end_date: '2026-10-20', progress_percent: 40, boq_index: 4 }),
      doc('project_task', 't5', { quotation_ref: 'q1', name_ar: 'توريد وتركيب الأبواب والنجارة', start_date: '2026-10-10', end_date: '2026-10-25', progress_percent: 0, boq_index: 0 }),
      doc('project_task', 't6', { project_ref: 'p2', name_ar: 'محارة الحوائط والأسقف', start_date: '2026-09-05', end_date: '2026-09-30', progress_percent: 60, boq_index: 1 }),
      doc('project_task', 't7', { project_ref: 'p2', name_ar: 'توريد وتركيب السيراميك', start_date: '2026-09-20', end_date: '2026-10-10', progress_percent: 20, boq_index: 2 }),
      doc('project_task', 't8', { project_ref: 'p2', name_ar: 'التمديدات الكهربائية', start_date: '2026-09-10', end_date: '2026-10-05', progress_percent: 35, boq_index: 3 }),

      /* —— مسارات الموافقات (بعد كل الإجراءات المحروسة) —— */
      doc('approval_flow', 'af1', { action: 'material_requisition', active: 1, steps: [ { role_ar: 'مهندس الموقع', employee_ref: 'e1' }, { role_ar: 'مدير المشروع', employee_ref: 'e2' } ] }),
      doc('approval_flow', 'af2', { action: 'sub_certificate', active: 1, steps: [ { role_ar: 'محاسب أول', employee_ref: 'e2' }, { role_ar: 'المدير المالي', employee_ref: '' } ] }),
      doc('approval_flow', 'af3', { action: 'project_extract', active: 0, steps: [ { role_ar: 'مدير المشروع', employee_ref: 'e1' } ] }),

      /* —— طلبات اعتماد: معلّق بالمستوى الأول · معتمد بالمستوى الأول وينتظر الثاني —— */
      doc('approval_request', 'ar1', { action: 'material_requisition', subject: 'صرف أسمنت إضافي لأعمال الخزان الأرضي — مشروع الجامعة', quotation_ref: 'q1' }),
      doc('approval_request', 'ar2', { action: 'sub_certificate', subject: 'شهادة أعمال رقم 2 — مقاول العزل (الشيخ مبروك)', sub_contract_ref: 'sc2', decide: 'approved', decided_by: 'م. أحمد المسيري', note: 'مطابق لتقرير الحصر الهندسي' }),
    ],
  },

  {
    id: 'equipment_rental',
    name_ar: 'إيجار معدات ثقيلة',
    shop_name: 'فلوت الدلتا للمعدات الثقيلة',
    owner_name: 'عبد الناصر سليم',
    city: 'المنصورة',
    phone: '0502556677',
    note: 'إيجار لوادر وحفارات باليوم مع سائقين ووقود — عقود شهرية وفواتير خدمة.',
    /* مراكز التكلفة (طلب المالك): شجرة تحليل مصاريف تخص مجال النشاط */
    cost_centers: [
      { ref: 'cc1', code: 'EQ-01', name_ar: 'اللودرات', notes: '' },
      { ref: 'cc2', code: 'EQ-02', name_ar: 'الحفارات والرافعات', notes: '' },
      { ref: 'cc3', code: 'EQ-03', name_ar: 'الورشة والإدارة', notes: '' },
    ],
    branches: [
      { ref: 'main', name_ar: 'الجراج الرئيسي — الطريق الزراعي', city: 'المنصورة', phone: '0502556677', is_main: 1 },
      { ref: 'ringroad', name_ar: 'جراج الطريق الدائري', city: 'المنصورة', phone: '0502556680' },
    ],
    warehouses: [
      { ref: 'wh-parts', name_ar: 'مخزن قطع الغيار', branch_ref: 'main', is_main: 1 },
      { ref: 'wh-ringroad', name_ar: 'مخزن الدائري (معدات جاهزة)', branch_ref: 'ringroad' },
    ],
    treasuries: [
      { ref: 'cash-main', name_ar: 'خزينة الحركة', kind: 'cash', branch_ref: 'main', opening_minor: 4000000 },
      { ref: 'bank-misr', name_ar: 'بنك مصر — حساب الأسطول', kind: 'bank', bank_name: 'بنك مصر', account_no: '330044005500', opening_minor: 25000000 },
      { ref: 'wallet-misr', name_ar: 'محفظة بنك مصر', kind: 'wallet', parent_ref: 'bank-misr', bank_name: 'بنك مصر', account_no: '01223344556', opening_minor: 50000 },
    ],
    terminals: [
      { code: 'POS-EQ1', name_ar: 'ماكينة إيصالات الإيجار', provider_name: 'بنك مصر', branch_ref: 'main', settlement_ref: 'bank-misr', terminal_id: 'TRM-22001', merchant_id: 'MID-6601', serial_number: 'SN-EQ-01' },
    ],
    categories: [
      { ref: 'equip', name_ar: 'خدمات إيجار' },
      { ref: 'parts', name_ar: 'قطع غيار وصيانة' },
    ],
    items: [
      item('loader', 'إيجار لودر كتربيلر 950 — يوم بسائق', 'RENT-LD950', 'equip', 0, 1200000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('excavator', 'إيجار حفار هيونداي 220 — يوم بسائق', 'RENT-EX220', 'equip', 0, 1450000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('roller', 'إيجار حدافة 10 طن — يوم', 'RENT-RL10', 'equip', 0, 900000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('watertruck', 'إيجار ناضحة مياه — يوم', 'RENT-WT', 'equip', 0, 750000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('dieselfilter', 'فلتر ديزل لودر (أصلي)', 'SP-DF50', 'parts', 180000, 0, 14, { min_qty: 4 }),
      item('trackshoe', 'نعلة حاشي حفار', 'SP-TS220', 'parts', 950000, 0, 8, { min_qty: 2 }),
      item('generator', 'إيجار مولد كهرباء 100KVA — يوم', 'RENT-GEN100', 'equip', 0, 850000, 0, { is_service: 1, base_unit: 'يوم' }),
      item('haulage', 'خدمة نقل معدات (نقلة لوح)', 'SRV-HAUL', 'equip', 0, 500000, 0, { is_service: 1, base_unit: 'نقلة' }),
      item('hydraulicoil', 'زيت هيدروليك 208 لتر', 'SP-HO208', 'parts', 2200000, 0, 6, { min_qty: 2 }),
    ],
    customers: [
      { ref: 'c1', name_ar: 'شركة الريان للمقاولات', phone: '0502556688', credit_limit_minor: 60000000, notes: 'عقد إيجار شهري بمعدات ثابتة — الباقي مع المستخلصات' },
      { ref: 'c2', name_ar: 'مقاول الطرق — شركة النيل', phone: '0502556699', credit_limit_minor: 40000000 },
      { ref: 'c3', name_ar: 'الاتحاد للصرف الصحي', phone: '0502556700', credit_limit_minor: 12000000 },
    ],
    suppliers: [
      { ref: 's1', name_ar: 'الوكيل — قطع غيار كتربيلر', phone: '0502556711' },
      { ref: 's2', name_ar: 'محطة وقود الأهرام', phone: '0502556722' },
    ],
    purchases: [
      { ref: 'p1', doc_date: '2026-09-09', supplier_ref: 's1', warehouse_ref: 'wh-parts', supplier_doc: 'CG-7781', paid_minor: 2500000, treasury_ref: 'bank-misr',
        lines: [{ item_ref: 'dieselfilter', qty: 10, unit_price_minor: 180000 }, { item_ref: 'trackshoe', qty: 4, unit_price_minor: 950000 }] },
    ],
    employees: [
      { ref: 'e1', name_ar: 'الأسطى جمال قنديل', phone: '01009990011', job_title: 'سائق لودر أول', hire_date: '2024-06-01', base_salary_minor: 1300000, allowances_minor: 200000, notes: 'بونس يوم تشغيل إضافي' },
      { ref: 'e2', name_ar: 'الأسطى سيد غنيم', phone: '01009990022', job_title: 'سائق حفار', hire_date: '2025-01-15', base_salary_minor: 1250000, allowances_minor: 150000 },
      { ref: 'e3', name_ar: 'مروة السعدني', phone: '01009990033', job_title: 'مسؤولة تعاقدات', hire_date: '2025-09-01', base_salary_minor: 1000000, allowances_minor: 0 },
    ],
    attendance: [
      /* التشغيل بالموقع: ورديات طويلة تُحتسب إضافياً */
      { ref: 'a1', employee_ref: 'e1', date: '2026-09-24', status: 'mission', check_in: '06:00', check_out: '20:00', notes: 'يوم تشغيل كامل بموقع النيل' },
      { ref: 'a2', employee_ref: 'e2', date: '2026-09-24', status: 'mission', check_in: '06:30', check_out: '19:30' },
      { ref: 'a3', employee_ref: 'e2', date: '2026-09-25', status: 'present', check_in: '09:00', check_out: '17:00', notes: 'صيانة دورية بالجراج' },
      { ref: 'a4', employee_ref: 'e3', date: '2026-09-24', status: 'present', check_in: '09:00', check_out: '17:00' },
    ],
    payroll_months: [
      { ref: 'pm1', month: '2026-09', pay_employee_refs: 'e3', treasury_ref: 'bank-misr' },
    ],
    quotations: [
      /* عرض توريد معدات لمشروع صرف صحي — بنود إيجار يومية بضريبة 14٪ */
      { ref: 'q1', kind: 'tender', client_name: 'الاتحاد للصرف الصحي', client_ref: 'c3', title_ar: 'توريد معدات حفر لمشروع خط الصرف الرئيسي', valid_until: '2026-10-15', status: 'submitted', win_probability: 55, bid_bond_minor: 300000, notes: 'السعر شامل السائق والوقود — 60 يوم تشغيل متوقعة',
        lines: [
          { name_ar: 'حفار 220 مع سائق', description_ar: 'حفار هيونداي 220 بسائق ووقود لمدة التشغيل', unit_ar: 'يوم', qty: 60, unit_price_minor: 1450000, est_cost_minor: 1050000, vat_percent: 14 },
          { name_ar: 'ناضحة مياه', description_ar: 'ناضحة 10 طن لترطيب أعمال الحفر ونقل المياه', unit_ar: 'يوم', qty: 40, unit_price_minor: 750000, est_cost_minor: 520000, vat_percent: 14 },
          { name_ar: 'حدافة 10 طن', description_ar: 'حدافة لدمج طبقات الردم حول الخطوط', unit_ar: 'يوم', qty: 25, unit_price_minor: 900000, est_cost_minor: 640000, vat_percent: 14 },
        ] },
    ],
    sales: [
      { ref: 'i1', doc_date: '2026-09-19', customer_ref: 'c1', warehouse_ref: 'wh-parts', payment: 'credit', paid_minor: 0, notes: 'إيجار أسبوع لودر + حفار — مشروع الريان',
        lines: [{ item_ref: 'loader', qty: 7, unit_price_minor: 1200000 }, { item_ref: 'excavator', qty: 7, unit_price_minor: 1450000 }] },
      { ref: 'i2', doc_date: '2026-09-22', customer_ref: 'c2', warehouse_ref: 'wh-parts', payment: 'card', paid_minor: 2700000, treasury_ref: 'bank-misr',
        lines: [{ item_ref: 'roller', qty: 3, unit_price_minor: 900000 }] },
    ],
    /* أسطول المعدات: عدّادات ساعات وخطة صيانة وقائية — أساس ربحية المعدة */
    equipment: [
      { ref: 'eq-ld1', name_ar: 'لودر كتربيلر 950H', code: 'LD-01', daily_rate_minor: 1200000, hourly_rate_minor: 175000, monthly_rate_minor: 28000000, meter_reading: 3450, service_every_hours: 500, notes: 'سائقها الأسطى جمال' },
      { ref: 'eq-ex1', name_ar: 'حفار هيونداي 220', code: 'EX-01', daily_rate_minor: 1450000, hourly_rate_minor: 210000, monthly_rate_minor: 34000000, meter_reading: 2180, service_every_hours: 500, notes: 'سائقها الأسطى سيد' },
      { ref: 'eq-rl1', name_ar: 'حدافة 10 طن', code: 'RL-01', daily_rate_minor: 900000, hourly_rate_minor: 130000, monthly_rate_minor: 21000000, meter_reading: 940, service_every_hours: 400 },
      { ref: 'eq-wt1', name_ar: 'ناضحة مياه 10 طن', code: 'WT-01', daily_rate_minor: 750000, hourly_rate_minor: 110000, monthly_rate_minor: 17000000, meter_reading: 1260, service_every_hours: 400 },
      { ref: 'eq-gn1', name_ar: 'مولد كهرباء 100KVA', code: 'GN-01', daily_rate_minor: 850000, hourly_rate_minor: 120000, monthly_rate_minor: 20000000, meter_reading: 615, service_every_hours: 300 },
    ],
    /* عقود إيجار: عقد شهري مختلط التحصيل · عقد آجل مفتوح · عقد نقدي مقفل بخصم تالفيات */
    rental_contracts: [
      { ref: 'rc1', customer_ref: 'c1', equipment_ref: 'eq-ld1', days: 30, daily_rate_minor: 1200000, deposit_minor: 500000, payment: 'mixed', paid_minor: 20000000, vat_percent: 14, start_date: '2026-09-01', notes: 'تعاقد شهري لودر لمشروع الريان — الباقي مع المستخلص', treasury_ref: 'bank-misr' },
      { ref: 'rc2', customer_ref: 'c2', equipment_ref: 'eq-ex1', days: 14, daily_rate_minor: 1450000, deposit_minor: 400000, payment: 'credit', paid_minor: 0, vat_percent: 14, start_date: '2026-09-15', notes: 'حفار لأعمال طريق النيل — آجل', treasury_ref: 'bank-misr' },
      { ref: 'rc3', customer_ref: 'c3', equipment_ref: 'eq-rl1', days: 3, daily_rate_minor: 900000, deposit_minor: 200000, payment: 'cash', paid_minor: 3078000, vat_percent: 14, start_date: '2026-09-20', notes: 'حدافة دمك ردمية — انتهت وسُلمت', close_deduct_minor: 50000, close_end_date: '2026-09-23', treasury_ref: 'cash-main' },
    ],
    /* مصروفات تشغيل: وقود وصيانة ومشغلات — تخصم من ربحية المعدة */
    equipment_costs: [
      { ref: 'ec1', equipment_ref: 'eq-ld1', date: '2026-09-12', kind: 'fuel', amount_minor: 1850000, description: 'وقود أسبوع تشغيل كامل', treasury_ref: 'cash-main' },
      { ref: 'ec2', equipment_ref: 'eq-ex1', date: '2026-09-18', kind: 'maintenance', amount_minor: 900000, description: 'زيوت وفلاتر 500 ساعة', treasury_ref: 'cash-main' },
      { ref: 'ec3', equipment_ref: 'eq-rl1', date: '2026-09-22', kind: 'repair', amount_minor: 350000, description: 'إصلاح سير دمك', treasury_ref: 'cash-main' },
      { ref: 'ec4', equipment_ref: 'eq-ld1', date: '2026-09-25', kind: 'operator', amount_minor: 600000, description: 'بونس سائق أيام التشغيل الإضافية', treasury_ref: 'cash-main' },
    ],
  },
]
