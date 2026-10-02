-- قاعدة البيانات التجريبية (وضع التطوير فقط) — تَحَكَّم
-- ملف SQLite حقيقي يعيش مع الكود ويُحمَّل داخل التطبيق في DEV، وقابل للتعديل
-- بأي أداة SQLite أو من داخل التطبيق (لوحة «بيانات تجريبية»).
-- كل الجداول تحمل عمود activity ليكون لكل نشاط بياناته المستقلة.
-- المبالغ بالقروش (أصغر وحدة) كما يفرض دليل المشروع — لا كسور عشرية أبداً.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,           -- grocery | pharmacy | restaurant | clothing
  name_ar     TEXT NOT NULL,
  shop_name   TEXT NOT NULL,
  owner_name  TEXT NOT NULL,
  city        TEXT NOT NULL DEFAULT 'المنصورة',
  phone       TEXT NOT NULL DEFAULT '01000000000',
  note        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS branches (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  activity  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref       TEXT NOT NULL,                -- مفتاح نصي للربط داخل نفس النشاط
  name_ar   TEXT NOT NULL,
  city      TEXT NOT NULL DEFAULT '',
  phone     TEXT NOT NULL DEFAULT '',
  is_main   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  activity   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,
  name_ar    TEXT NOT NULL,
  branch_ref TEXT NOT NULL DEFAULT '',
  is_main    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (activity, ref)
);

-- الخزائن والبنوك والمحافظ الإلكترونية: kind = cash | bank | wallet
-- المحفظة الإلكترونية تتبع بنكاً أباً عبر parent_ref (مطلب المالك: فرعية تحت البنك).
CREATE TABLE IF NOT EXISTS treasuries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref         TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('cash', 'bank', 'wallet')),
  parent_ref  TEXT NOT NULL DEFAULT '',
  bank_name   TEXT NOT NULL DEFAULT '',
  account_no  TEXT NOT NULL DEFAULT '',
  branch_ref  TEXT NOT NULL DEFAULT '',
  opening_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS payment_terminals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  activity       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name_ar        TEXT NOT NULL,
  provider_name  TEXT NOT NULL,
  branch_ref     TEXT NOT NULL DEFAULT '',
  settlement_ref TEXT NOT NULL DEFAULT '',   -- خزينة/بنك التسوية
  terminal_id    TEXT NOT NULL,
  merchant_id    TEXT NOT NULL DEFAULT '',
  serial_number  TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  UNIQUE (activity, code)
);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  activity TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref      TEXT NOT NULL,
  name_ar  TEXT NOT NULL,
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  activity       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,
  name_ar        TEXT NOT NULL,
  sku            TEXT NOT NULL DEFAULT '',
  barcode        TEXT NOT NULL DEFAULT '',
  category_ref   TEXT NOT NULL DEFAULT '',
  base_unit      TEXT NOT NULL DEFAULT 'قطعة',
  extra_units    TEXT NOT NULL DEFAULT '',   -- «كرتونة:12» مفصولة بفاصلة
  cost_minor     INTEGER NOT NULL DEFAULT 0,
  price_minor    INTEGER NOT NULL DEFAULT 0,
  stock_qty      REAL NOT NULL DEFAULT 0,
  min_qty        REAL NOT NULL DEFAULT 0,
  is_service     INTEGER NOT NULL DEFAULT 0,
  track_expiry   INTEGER NOT NULL DEFAULT 0,
  track_serial   INTEGER NOT NULL DEFAULT 0,
  sold_by_weight INTEGER NOT NULL DEFAULT 0,
  warranty_months INTEGER NOT NULL DEFAULT 0,
  colors         TEXT NOT NULL DEFAULT '',
  sizes          TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS customers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  activity           TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref                TEXT NOT NULL,
  name_ar            TEXT NOT NULL,
  phone              TEXT NOT NULL DEFAULT '',
  credit_limit_minor INTEGER NOT NULL DEFAULT 0,
  notes              TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  activity TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref      TEXT NOT NULL,
  name_ar  TEXT NOT NULL,
  phone    TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  activity      TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref           TEXT NOT NULL,
  doc_date      TEXT NOT NULL,             -- YYYY-MM-DD
  customer_ref  TEXT NOT NULL DEFAULT '',  -- فارغ = عميل نقدي
  warehouse_ref TEXT NOT NULL DEFAULT '',
  payment       TEXT NOT NULL DEFAULT 'cash' CHECK (payment IN ('cash', 'credit', 'card')),
  paid_minor    INTEGER NOT NULL DEFAULT 0,
  treasury_ref  TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  activity         TEXT NOT NULL,
  sale_ref         TEXT NOT NULL,
  item_ref         TEXT NOT NULL,
  qty              REAL NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  discount_percent REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  activity       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,
  doc_date       TEXT NOT NULL,
  supplier_ref   TEXT NOT NULL DEFAULT '',
  warehouse_ref  TEXT NOT NULL DEFAULT '',
  supplier_doc   TEXT NOT NULL DEFAULT '',
  paid_minor     INTEGER NOT NULL DEFAULT 0,
  treasury_ref   TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  activity         TEXT NOT NULL,
  purchase_ref     TEXT NOT NULL,
  item_ref         TEXT NOT NULL,
  qty              REAL NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  expiry_date      TEXT NOT NULL DEFAULT ''   -- تاريخ صلاحية الدفعة (فارغ = بلا تتبع)
);

CREATE INDEX IF NOT EXISTS ix_items_activity ON items (activity);
CREATE INDEX IF NOT EXISTS ix_sale_lines ON sale_lines (activity, sale_ref);
CREATE INDEX IF NOT EXISTS ix_purchase_lines ON purchase_lines (activity, purchase_ref);

-- ─── توسعة المرحلة ⑥: الموارد البشرية والمستندات التجارية (طلب المالك ㉘) ───

CREATE TABLE IF NOT EXISTS employees (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  activity         TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref              TEXT NOT NULL,
  name_ar          TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  job_title        TEXT NOT NULL DEFAULT '',
  hire_date        TEXT NOT NULL DEFAULT '',
  base_salary_minor INTEGER NOT NULL DEFAULT 0,
  allowances_minor INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  notes            TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- بصمات الحضور اليدوية (status: present | absent | leave | permission | holiday | mission)
CREATE TABLE IF NOT EXISTS attendance_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref         TEXT NOT NULL,
  employee_ref TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'present',
  check_in    TEXT NOT NULL DEFAULT '',
  check_out   TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- طلبات الإجازات (type_id: annual | sick | emergency | unpaid · status: pending | approved | rejected)
CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  activity     TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref          TEXT NOT NULL,
  employee_ref TEXT NOT NULL DEFAULT '',
  type_id      TEXT NOT NULL DEFAULT 'annual',
  from_date    TEXT NOT NULL,
  to_date      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'approved',
  reason       TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- مسير رواتب شهر: يُستحق قسائم ثم تُسدَّد المحدد منها بسند صرف على 2104
CREATE TABLE IF NOT EXISTS payroll_months (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  activity     TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref          TEXT NOT NULL,
  month        TEXT NOT NULL,               -- YYYY-MM
  pay_employee_refs TEXT NOT NULL DEFAULT '', -- موظفو القسائم المسددة (مفصولة بفاصلة)
  treasury_ref TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- عروض الأسعار والمناقصات (بنود حرة النص — لا أصناف كتالوج)
CREATE TABLE IF NOT EXISTS quotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'quotation' CHECK (kind IN ('quotation', 'tender')),
  client_name TEXT NOT NULL,
  client_ref  TEXT NOT NULL DEFAULT '',
  title_ar    TEXT NOT NULL,
  valid_until TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  win_probability INTEGER NOT NULL DEFAULT 50,
  bid_bond_minor INTEGER NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  activity         TEXT NOT NULL,
  quotation_ref    TEXT NOT NULL,
  name_ar          TEXT NOT NULL DEFAULT '',
  description_ar   TEXT NOT NULL,
  unit_ar          TEXT NOT NULL DEFAULT 'مقطوعية',
  qty              REAL NOT NULL DEFAULT 1,
  unit_price_minor INTEGER NOT NULL DEFAULT 0,
  est_cost_minor   INTEGER NOT NULL DEFAULT 0,
  vat_percent      REAL NOT NULL DEFAULT 0,
  tax_included     INTEGER NOT NULL DEFAULT 0
);

-- أوامر الشراء: التزام تجاري لا قيد — تُعبَّأ منه فاتورة الشراء عند الاستلام
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  activity       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,
  supplier_ref   TEXT NOT NULL DEFAULT '',
  order_date     TEXT NOT NULL,
  expected_date  TEXT NOT NULL DEFAULT '',
  warehouse_ref  TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  activity         TEXT NOT NULL,
  order_ref        TEXT NOT NULL,
  item_ref         TEXT NOT NULL,
  qty              REAL NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  vat_percent      REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_attendance ON attendance_records (activity, employee_ref);
CREATE INDEX IF NOT EXISTS ix_quotation_lines ON quotation_lines (activity, quotation_ref);
CREATE INDEX IF NOT EXISTS ix_po_lines ON purchase_order_lines (activity, order_ref);

-- مستندات الهالك (طلب المالك ㉘): من المصدر «منتهي الصلاحية» أو الجرد
CREATE TABLE IF NOT EXISTS wastage_docs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  activity   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,
  doc_date   TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'انتهاء صلاحية',
  notes      TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

CREATE TABLE IF NOT EXISTS wastage_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  activity  TEXT NOT NULL,
  doc_ref   TEXT NOT NULL,
  item_ref  TEXT NOT NULL,
  qty       REAL NOT NULL
);

-- ─── تعميق المرحلة ⑥: مقاولو الباطن والمستخلصات وعقود الإيجار ───

-- معدات الإيجار (فعليات الأسطول: عدّاد ساعات وخطة صيانة)
CREATE TABLE IF NOT EXISTS equipment (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  activity           TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref                TEXT NOT NULL,
  name_ar            TEXT NOT NULL,
  code               TEXT NOT NULL DEFAULT '',
  daily_rate_minor   INTEGER NOT NULL DEFAULT 0,
  hourly_rate_minor  INTEGER NOT NULL DEFAULT 0,
  monthly_rate_minor INTEGER NOT NULL DEFAULT 0,
  meter_reading      REAL NOT NULL DEFAULT 0,
  service_every_hours REAL NOT NULL DEFAULT 0,
  notes              TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- عقود الإيجار: payment = cash | credit | mixed · حقول الإقفال الفارغة = عقد مفتوح
CREATE TABLE IF NOT EXISTS rental_contracts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  activity          TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref               TEXT NOT NULL,
  customer_ref      TEXT NOT NULL DEFAULT '',
  equipment_ref     TEXT NOT NULL,
  days              INTEGER NOT NULL,
  daily_rate_minor  INTEGER NOT NULL,
  deposit_minor     INTEGER NOT NULL DEFAULT 0,
  payment           TEXT NOT NULL DEFAULT 'cash',
  paid_minor        INTEGER NOT NULL DEFAULT 0,
  vat_percent       REAL NOT NULL DEFAULT 0,
  start_date        TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  close_deduct_minor INTEGER NOT NULL DEFAULT 0,
  close_end_date    TEXT NOT NULL DEFAULT '',
  treasury_ref      TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- مصروفات تشغيل المعدات: kind = fuel | maintenance | repair | operator | other
CREATE TABLE IF NOT EXISTS equipment_costs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  activity     TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref          TEXT NOT NULL,
  equipment_ref TEXT NOT NULL DEFAULT '',
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'fuel',
  amount_minor INTEGER NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  treasury_ref TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- عقود مقاولي الباطن (تجد المشروع عبر quotation_ref المحوَّل مشروعاً)
CREATE TABLE IF NOT EXISTS sub_contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  activity       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,
  quotation_ref  TEXT NOT NULL DEFAULT '',
  contractor_name TEXT NOT NULL,
  supplier_ref   TEXT NOT NULL DEFAULT '',
  scope_ar       TEXT NOT NULL,
  contract_value_minor INTEGER NOT NULL,
  retention_percent REAL NOT NULL DEFAULT 5,
  tax_withhold_percent REAL NOT NULL DEFAULT 0,
  advance_percent REAL NOT NULL DEFAULT 0,
  start_date     TEXT NOT NULL DEFAULT '',
  advance_minor  INTEGER NOT NULL DEFAULT 0,
  advance_treasury_ref TEXT NOT NULL DEFAULT '',
  certificate_amount_minor INTEGER NOT NULL DEFAULT 0,
  certificate_description TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- مستخلصات المشروع: نسبة إنجاز تراكمية تُطبَّق على بنود جدول الكميات
CREATE TABLE IF NOT EXISTS project_extracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  activity      TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref           TEXT NOT NULL,
  quotation_ref TEXT NOT NULL DEFAULT '',
  percent       REAL NOT NULL DEFAULT 0,
  vat_percent   REAL NOT NULL DEFAULT 14,
  payment       TEXT NOT NULL DEFAULT 'credit',
  description   TEXT NOT NULL DEFAULT '',
  treasury_ref  TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);

-- مراكز التكلفة: شجرة تجميع للمصاريف والتحليل (طلب المالك — بذور لكل نشاط)
CREATE TABLE IF NOT EXISTS cost_centers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  activity  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  ref       TEXT NOT NULL,
  code      TEXT NOT NULL,
  name_ar   TEXT NOT NULL,
  parent_ref TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes     TEXT NOT NULL DEFAULT '',
  UNIQUE (activity, ref)
);
