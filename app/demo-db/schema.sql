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
  unit_price_minor INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_items_activity ON items (activity);
CREATE INDEX IF NOT EXISTS ix_sale_lines ON sale_lines (activity, sale_ref);
CREATE INDEX IF NOT EXISTS ix_purchase_lines ON purchase_lines (activity, purchase_ref);
