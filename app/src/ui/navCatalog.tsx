/**
 * كتالوج التنقل — كل قسم رئيسي بلونه الخاص مع فروعه
 * (طلب المالك: تقسيم عملي، كل قسم رئيسي بلون مميز)
 */
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Users, BookOpenText,
  BarChart3, Settings, Wrench, Tractor, Route, CreditCard,
  Receipt, RotateCcw, Boxes, ArrowLeftRight, ClipboardList, Warehouse,
  UserRound, Building2, UserCog, Landmark, FileSpreadsheet, Scale,
  PenLine, ListTree, PiggyBank, CalendarClock, Store, Percent,
  Printer, ShieldCheck, DatabaseBackup, Palette, KeyRound, Bot, TrendingDown, CloudUpload,
  Microscope, FlaskConical, HeartPulse, Stethoscope, HardHat, Car, Banknote, Wallet2,
  FileText, ListChecks, Users2, ChefHat, Scissors, Gem, Tags, PackageMinus, HandCoins, Gauge,
  ScrollText, MessageSquareWarning, Headset, Smartphone , Trash2, ScanBarcode, SlidersHorizontal, Repeat, UtensilsCrossed, Shirt , UserCircle2, Gift } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BusinessModule, ItemFeature } from '../core/activities.ts'
import { INVOICE_FIRST_ACTIVITIES } from '../core/activities.ts'

export interface NavChild {
  id: string
  nameAr: string
  icon: LucideIcon
  path: string
  /** يظهر فقط إن كانت هذه الوحدة مفعلة (لعناصر داخل قسم عام) */
  module?: BusinessModule
  /** يظهر فقط إن كانت خاصية الأصناف هذه مفعلة للنشاط (مثل السيريالات) */
  feature?: ItemFeature
  /**
   * يظهر فقط لهذه الأنشطة تحديداً — لشاشات لصيقة بنشاط لا بوحدة:
   * «أوامر الطاولات» للمطاعم فقط وإن فُعّلت وحدة التصنيع لمصنع (تعميم التصنيع)
   */
  activities?: string[]
  /** يختفي لهذه الأنشطة (قائمة سوداء): الكاشير/الورديات لأنشطة «الفاتورة أولاً» */
  hideForActivities?: readonly string[]
}

export interface NavSection {
  id: string
  nameAr: string
  icon: LucideIcon
  /** لون القسم — يصبغ رأس القسم وفروعه عند التفعيل */
  color: string // tailwind hue name
  module?: BusinessModule // يظهر فقط إن كانت الوحدة مفعلة
  accountingOnly?: boolean // يظهر فقط في الوضع المحاسبي الكامل
  children: NavChild[]
}

/** خريطة ألوان الأقسام — مضبوطة يدوياً لتعمل مع Tailwind JIT */
export const SECTION_COLORS: Record<string, {
  text: string; bg: string; bgSoft: string; border: string; dot: string
  activeBg: string; activeText: string; glow: string
}> = {
  sky: { text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500', bgSoft: 'bg-sky-500/10', border: 'border-sky-500/30', dot: 'bg-sky-500', activeBg: 'bg-sky-500/15', activeText: 'text-sky-700 dark:text-sky-300', glow: 'shadow-sky-500/25' },
  emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', bgSoft: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500', activeBg: 'bg-emerald-500/15', activeText: 'text-emerald-700 dark:text-emerald-300', glow: 'shadow-emerald-500/25' },
  amber: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', bgSoft: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-500', activeBg: 'bg-amber-500/15', activeText: 'text-amber-700 dark:text-amber-300', glow: 'shadow-amber-500/25' },
  violet: { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500', bgSoft: 'bg-violet-500/10', border: 'border-violet-500/30', dot: 'bg-violet-500', activeBg: 'bg-violet-500/15', activeText: 'text-violet-700 dark:text-violet-300', glow: 'shadow-violet-500/25' },
  rose: { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500', bgSoft: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-500', activeBg: 'bg-rose-500/15', activeText: 'text-rose-700 dark:text-rose-300', glow: 'shadow-rose-500/25' },
  cyan: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500', bgSoft: 'bg-cyan-500/10', border: 'border-cyan-500/30', dot: 'bg-cyan-500', activeBg: 'bg-cyan-500/15', activeText: 'text-cyan-700 dark:text-cyan-300', glow: 'shadow-cyan-500/25' },
  orange: { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500', bgSoft: 'bg-orange-500/10', border: 'border-orange-500/30', dot: 'bg-orange-500', activeBg: 'bg-orange-500/15', activeText: 'text-orange-700 dark:text-orange-300', glow: 'shadow-orange-500/25' },
  teal: { text: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500', bgSoft: 'bg-teal-500/10', border: 'border-teal-500/30', dot: 'bg-teal-500', activeBg: 'bg-teal-500/15', activeText: 'text-teal-700 dark:text-teal-300', glow: 'shadow-teal-500/25' },
  fuchsia: { text: 'text-fuchsia-600 dark:text-fuchsia-400', bg: 'bg-fuchsia-500', bgSoft: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30', dot: 'bg-fuchsia-500', activeBg: 'bg-fuchsia-500/15', activeText: 'text-fuchsia-700 dark:text-fuchsia-300', glow: 'shadow-fuchsia-500/25' },
  slate: { text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500', bgSoft: 'bg-slate-500/10', border: 'border-slate-500/30', dot: 'bg-slate-500', activeBg: 'bg-slate-500/15', activeText: 'text-slate-700 dark:text-slate-300', glow: 'shadow-slate-500/25' },
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'dashboard', nameAr: 'الرئيسية', icon: LayoutDashboard, color: 'sky',
    children: [{ id: 'home', nameAr: 'لوحة اليوم', icon: LayoutDashboard, path: '/' }],
  },
  {
    id: 'sales', nameAr: 'المبيعات', icon: ShoppingCart, color: 'emerald', module: 'pos',
    children: [
      // أنشطة «الفاتورة أولاً» (تجارة جملة/مصنع/خدمات): نفس الشاشة تظهر لهم باسم
      // «إنشاء فاتورة بيع» عبر ACTIVITY_LABELS (sales.pos) — ولا ورديات ولا استبدال
      { id: 'pos', nameAr: 'شاشة البيع (كاشير)', icon: Store, path: '/pos' },
      { id: 'restaurant-orders', nameAr: 'أوامر الطاولات والدليفري', icon: UtensilsCrossed, path: '/sales/restaurant-orders', module: 'recipes', activities: ['restaurant'] },
      { id: 'invoices', nameAr: 'فواتير المبيعات', icon: Receipt, path: '/sales/invoices' },
      { id: 'returns', nameAr: 'مرتجعات المبيعات', icon: RotateCcw, path: '/sales/returns' },
      { id: 'exchange', nameAr: 'الاستبدال', icon: Repeat, path: '/sales/exchange', hideForActivities: INVOICE_FIRST_ACTIVITIES },
      { id: 'shifts', nameAr: 'الورديات', icon: CalendarClock, path: '/sales/shifts', hideForActivities: INVOICE_FIRST_ACTIVITIES },
      { id: 'price-lists', nameAr: 'قوائم الأسعار', icon: Tags, path: '/sales/price-lists', feature: 'price_lists' },
      // العروض/الباقات: لأنشطة الكاشير أصحاب قوائم الأسعار (بقالة/صيدلية/ملابس…) — لا معنى لها في المقاولات ونحوها
      { id: 'promotions', nameAr: 'العروض والباقات', icon: Gift, path: '/sales/promotions', feature: 'price_lists' },
    ],
  },
  {
    id: 'inventory', nameAr: 'المخزون', icon: Package, color: 'amber', module: 'inventory',
    children: [
      { id: 'items', nameAr: 'الأصناف', icon: Boxes, path: '/inventory/items' },
      { id: 'warehouses', nameAr: 'المخازن', icon: Warehouse, path: '/inventory/warehouses' },
      { id: 'transfers', nameAr: 'التحويلات', icon: ArrowLeftRight, path: '/inventory/transfers' },
      { id: 'counting', nameAr: 'الجرد', icon: ClipboardList, path: '/inventory/counting' },
      { id: 'wastage', nameAr: 'الإتلاف والهالك', icon: Trash2, path: '/inventory/wastage' },
      { id: 'consumption', nameAr: 'الصرف الداخلي', icon: PackageMinus, path: '/inventory/consumption' },
      // فلترة دقيقة حسب النشاط (طلب المالك): الباركود لأنشطة البيع بالكاشير فقط —
      // والميزان لأنشطة خاصية الوزن (بقالة/جزارة/تمور/مخبز…) — المقاولات ونحوها لا تراهما
      { id: 'barcode-center', nameAr: 'الباركود والملصقات', icon: Tags, path: '/inventory/barcode-center', module: 'pos' },
      { id: 'scale', nameAr: 'باركود الميزان', icon: Scale, path: '/inventory/scale', feature: 'weight_scale' },
      { id: 'serials', nameAr: 'سجل السيريالات', icon: ScanBarcode, path: '/inventory/serials', feature: 'serial_warranty' },
      { id: 'recipes', nameAr: 'الوصفات والإنتاج', icon: ChefHat, path: '/inventory/recipes', module: 'recipes' },
      { id: 'processing', nameAr: 'التقطيع والفرز والتعبئة', icon: Scissors, path: '/inventory/processing', module: 'processing' },
      { id: 'jewelry', nameAr: 'الصاغة والكسر', icon: Gem, path: '/inventory/jewelry', module: 'jewelry' },
    ],
  },
  {
    id: 'purchases', nameAr: 'المشتريات', icon: Truck, color: 'cyan', module: 'purchases',
    children: [
      { id: 'invoices', nameAr: 'فواتير الشراء', icon: Receipt, path: '/purchases/invoices' },
      { id: 'returns', nameAr: 'مرتجعات الشراء', icon: RotateCcw, path: '/purchases/returns' },
      { id: 'suppliers', nameAr: 'الموردون', icon: Building2, path: '/purchases/suppliers' },
    ],
  },
  {
    id: 'parties', nameAr: 'العملاء والموظفون', icon: Users, color: 'violet',
    children: [
      { id: 'customers', nameAr: 'العملاء', icon: UserRound, path: '/parties/customers' },
      { id: 'employees', nameAr: 'الموظفون', icon: UserCog, path: '/parties/employees' },
      { id: 'custody', nameAr: 'ملفات عهد الموظفين', icon: Wallet2, path: '/parties/custody' },
      { id: 'installments', nameAr: 'الأقساط', icon: CreditCard, path: '/parties/installments', module: 'installments' },
    ],
  },
  {
    id: 'maintenance', nameAr: 'الصيانة', icon: Wrench, color: 'orange', module: 'maintenance',
    children: [
      { id: 'tickets', nameAr: 'أوامر الصيانة', icon: Wrench, path: '/maintenance/tickets' },
    ],
  },
  {
    id: 'laundry', nameAr: 'المغسلة', icon: Shirt, color: 'sky', module: 'laundry',
    children: [
      { id: 'orders', nameAr: 'أوامر الغسيل', icon: Shirt, path: '/laundry/orders' },
    ],
  },
  {
    id: 'wallets', nameAr: 'خدمات المحافظ', icon: Smartphone, color: 'fuchsia', module: 'wallet_services',
    children: [
      { id: 'wallet-ops', nameAr: 'عمليات المحافظ والدفع', icon: Smartphone, path: '/wallets/ops' },
    ],
  },
  {
    id: 'rental', nameAr: 'إيجار المعدات', icon: Tractor, color: 'teal', module: 'equipment_rental',
    children: [
      { id: 'fleet', nameAr: 'المعدات', icon: Tractor, path: '/rental/fleet' },
      { id: 'contracts', nameAr: 'عقود الإيجار', icon: FileSpreadsheet, path: '/rental/contracts' },
    ],
  },
  {
    id: 'realestate', nameAr: 'العقارات', icon: Building2, color: 'teal', module: 'realestate',
    children: [
      { id: 'properties', nameAr: 'العقارات والملاك', icon: Building2, path: '/realestate/properties' },
      { id: 'leases', nameAr: 'عقود الإيجار', icon: KeyRound, path: '/realestate/leases' },
    ],
  },
  {
    id: 'logistics', nameAr: 'اللوجستيات', icon: Route, color: 'fuchsia', module: 'logistics',
    children: [
      { id: 'trips', nameAr: 'النقلات', icon: Route, path: '/logistics/trips' },
      { id: 'fleet', nameAr: 'الأسطول والسائقون', icon: Truck, path: '/logistics/fleet' },
    ],
  },
  {
    id: 'lab', nameAr: 'معمل التحاليل', icon: Microscope, color: 'violet', module: 'lab',
    children: [
      { id: 'orders', nameAr: 'الطلبات والنتائج', icon: FlaskConical, path: '/lab/orders' },
      { id: 'tests', nameAr: 'كتالوج الفحوصات', icon: Microscope, path: '/lab/tests' },
      { id: 'patients', nameAr: 'المرضى', icon: HeartPulse, path: '/lab/patients' },
      { id: 'referrers', nameAr: 'الأطباء المحيلون', icon: Stethoscope, path: '/lab/referrers' },
    ],
  },
  {
    id: 'contracting', nameAr: 'المقاولات', icon: HardHat, color: 'orange', module: 'contracting',
    children: [
      { id: 'projects', nameAr: 'المشروعات والمستخلصات', icon: HardHat, path: '/contracting/projects' },
      { id: 'quotations', nameAr: 'عروض الأسعار والمناقصات', icon: FileText, path: '/contracting/quotations' },
      { id: 'boq', nameAr: 'جداول الكميات BOQ', icon: ListChecks, path: '/contracting/boq' },
      { id: 'subcontractors', nameAr: 'مقاولو الباطن', icon: Users2, path: '/contracting/subcontractors' },
      { id: 'bonds', nameAr: 'خطابات الضمان', icon: ShieldCheck, path: '/contracting/bonds' },
      { id: 'daily-workers', nameAr: 'عمال اليومية', icon: CalendarClock, path: '/contracting/daily-workers' },
      { id: 'material-issues', nameAr: 'أذون صرف المواد', icon: PackageMinus, path: '/contracting/material-issues' },
      { id: 'collections', nameAr: 'تحصيلات العملاء', icon: HandCoins, path: '/contracting/collections' },
      { id: 'budget', nameAr: 'موازنة المشروع والانحرافات', icon: Scale, path: '/contracting/budget' },
      { id: 'tasks', nameAr: 'الجدول الزمني للمهام', icon: CalendarClock, path: '/contracting/tasks' },
      { id: 'evm', nameAr: 'القيمة المكتسبة EVM', icon: Gauge, path: '/contracting/evm' },
      { id: 'approvals', nameAr: 'الموافقات التسلسلية', icon: ShieldCheck, path: '/contracting/approvals' },
    ],
  },
  {
    id: 'clinic', nameAr: 'العيادة', icon: Stethoscope, color: 'cyan', module: 'clinic',
    children: [
      { id: 'patients', nameAr: 'ملفات المرضى', icon: HeartPulse, path: '/clinic/patients' },
      { id: 'appointments', nameAr: 'المواعيد', icon: CalendarClock, path: '/clinic/appointments' },
    ],
  },
  {
    id: 'cars', nameAr: 'معرض السيارات', icon: Car, color: 'violet', module: 'cars',
    children: [
      { id: 'showroom', nameAr: 'السيارات', icon: Car, path: '/cars' },
    ],
  },
  {
    id: 'accounting', nameAr: 'الحسابات العامة', icon: BookOpenText, color: 'rose', accountingOnly: true,
    children: [
      { id: 'journal', nameAr: 'اليومية العامة', icon: PenLine, path: '/accounting/journal' },
      { id: 'coa', nameAr: 'شجرة الحسابات', icon: ListTree, path: '/accounting/coa' },
      { id: 'trial', nameAr: 'ميزان المراجعة', icon: Scale, path: '/accounting/trial-balance' },
      { id: 'vouchers', nameAr: 'سندات قبض وصرف', icon: Landmark, path: '/accounting/vouchers' },
      { id: 'cheques', nameAr: 'الشيكات', icon: Banknote, path: '/accounting/cheques' },
      { id: 'treasury', nameAr: 'الخزائن والبنوك', icon: PiggyBank, path: '/accounting/treasury' },
      { id: 'assets', nameAr: 'الأصول والإهلاك', icon: TrendingDown, path: '/accounting/assets' },
      { id: 'ext-commissions', nameAr: 'العمولات (لي وعليّ)', icon: HandCoins, path: '/accounting/external-commissions' },
      { id: 'opening', nameAr: 'الأرصدة الافتتاحية', icon: Scale, path: '/accounting/opening-balances' },
      { id: 'settlements', nameAr: 'التسويات الشاملة', icon: SlidersHorizontal, path: '/accounting/settlements' },
    ],
  },
  {
    id: 'reports', nameAr: 'التقارير', icon: BarChart3, color: 'sky',
    children: [
      { id: 'all', nameAr: 'مركز التقارير', icon: BarChart3, path: '/reports' },
      { id: 'statements', nameAr: 'كشوف الحساب', icon: FileSpreadsheet, path: '/reports/statements' },
    ],
  },
  {
    id: 'settings', nameAr: 'الإعدادات', icon: Settings, color: 'slate',
    children: [
      { id: 'general', nameAr: 'عامة (بلد/عملة/ضريبة)', icon: Percent, path: '/settings/general' },
      { id: 'profile', nameAr: 'حسابي (بياناتي ورقمي السري)', icon: UserCircle2, path: '/settings/profile' },
      { id: 'permissions', nameAr: 'المستخدمون والصلاحيات', icon: ShieldCheck, path: '/settings/permissions' },
      { id: 'audit', nameAr: 'سجل النشاطات (للمالك)', icon: ScrollText, path: '/settings/audit' },
      { id: 'issues', nameAr: 'بلاغات المشاكل الداخلية', icon: MessageSquareWarning, path: '/settings/issues' },
      { id: 'guides', nameAr: 'الشروحات (دليل نشاطك)', icon: BookOpenText, path: '/settings/guides' },
      { id: 'support', nameAr: 'الدعم الفني (المطوّر)', icon: Headset, path: '/settings/support' },
      { id: 'printing', nameAr: 'الطباعة', icon: Printer, path: '/settings/printing' },
      { id: 'backup', nameAr: 'النسخ الاحتياطي', icon: DatabaseBackup, path: '/settings/backup' },
      { id: 'sync', nameAr: 'المزامنة السحابية', icon: CloudUpload, path: '/settings/sync' },
      { id: 'telegram', nameAr: 'بوت التليجرام', icon: Bot, path: '/settings/telegram' },
      { id: 'appearance', nameAr: 'المظهر', icon: Palette, path: '/settings/appearance' },
      { id: 'einvoice', nameAr: 'الفاتورة الإلكترونية', icon: FileSpreadsheet, path: '/settings/einvoice' },
      { id: 'license', nameAr: 'الترخيص', icon: KeyRound, path: '/settings/license' },
      { id: 'about', nameAr: 'حول التطبيق', icon: BookOpenText, path: '/settings/about' },
    ],
  },
]
