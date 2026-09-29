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

export const DEMO_ACTIVITIES = [
  {
    id: 'grocery',
    name_ar: 'أغذية / سوبر ماركت',
    shop_name: 'سوبر ماركت المنصورة',
    owner_name: 'محمد عبده',
    note: 'نشاط تجزئة سريع الدوران: باركود، أوزان، صلاحية، وفروع متعددة.',
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
    sales: [
      { ref: 'i1', doc_date: '2026-09-16', customer_ref: 'c1', warehouse_ref: 'wh-store', payment: 'credit', paid_minor: 200000, notes: 'طلب جملة',
        lines: [{ item_ref: 'shirt', qty: 10, unit_price_minor: 45000, discount_percent: 10 }, { item_ref: 'sneaker', qty: 4, unit_price_minor: 99000 }] },
      { ref: 'i2', doc_date: '2026-09-23', customer_ref: 'c2', warehouse_ref: 'wh-display', payment: 'card', paid_minor: 165000, treasury_ref: 'bank-aaib',
        lines: [{ item_ref: 'dress', qty: 1, unit_price_minor: 165000 }] },
    ],
  },
]
