#!/usr/bin/env node
// بوابة الترحيل لرف الإصدارات العام (v1.0.16) — فحوص ملفية offline
// تتحقق أن نافذة الترحيل مغلقة بإحكام قبل وسم v1.0.16:
//   1) publish في electron-builder يشير للرف العام (تغذية العملاء)
//   2) desktop:dist يبني بلا نشر (النشر خطوات صريحة بالسير — لا نشر عميل بGH_TOKEN)
//   3) desktop:publish (المسار اليدوي الكامل) يشير للرف العام عبر إعداد publish
//   4) سير الإصدار: بناء بلا توكن → بوابة app-update.yml → نشر بالسر المحصور → مرآة مؤقتة
//   5) دليل الترحيل موجود للمالك
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
let fails = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { fails++; console.error(`  ✗ ${m}`); };

const builder = read('electron-builder.yml');
const pkg = JSON.parse(read('package.json'));
const wf = read('../.github/workflows/desktop-release.yml');
const guide = read('../docs/الترحيل-لمستودع-خاص.md');

console.log('بوابة الترحيل لرف الإصدارات العام (v1.0.16):');

// 1) وجهة التحديث = الرف العام
if (builder.includes('tahakam-releases') && !/publish:[\s\S]*?shopsys/.test(builder)) {
  ok('publish → tahakam-releases (لا يوجد توجيه قديم لshopsys)');
} else {
  bad('إعداد publish لا يشير حصراً للرف العام tahakam-releases');
}

// 2) desktop:dist بلا نشر — لا يمكن للبناء اليومي أن ينشر بGH_TOKEN للعملاء
if (pkg.scripts['desktop:dist']?.includes('--publish never')) {
  ok('desktop:dist يبني بلا نشر (--publish never)');
} else {
  bad('desktop:dist ينشر ضمنياً — أضف --publish never');
}

// 3) المسار اليدوي الكامل ينشر عبر إعداد publish (الرف العام) — لا توكن صريح
if (pkg.scripts['desktop:publish']?.includes('--publish always')) {
  ok('desktop:publish ينشر عبر إعداد publish (الرف العام) عند الحاجة اليدوية');
} else {
  bad('desktop:publish غيّر سلوكه — راجع');
}

// 4) سير الإصدار — البنية الجديدة
if (wf.includes('npm run desktop:dist')) ok('السير يبني بdesktop:dist (بلا توكن نشر)');
else bad('السير لا يستخدم desktop:dist');

if (/تحقق من توجيه التحديث داخل المثبت/.test(wf) && wf.includes('win-unpacked/resources/app-update.yml')) {
  ok('بوابة داخل السير ترفض المثبت الذي لا يشير للرف العام');
} else {
  bad('بوابة app-update.yml مفقودة من السير');
}

if (wf.includes('secrets.RELEASES_REPO_TOKEN')) {
  ok('النشر للرف العام بسر RELEASES_REPO_TOKEN (محصور برف الإصدارات)');
} else {
  bad('السير لا يستخدم RELEASES_REPO_TOKEN');
}

// فشل صريح لو السر فارغ — لا نشر بلا وجهة تحديث
if (/RELEASES_REPO_TOKEN غير مضبوط/.test(wf)) {
  ok('السر الفارغ = فشل صريح (لا إصدار بلا رف تحديث)');
} else {
  bad('لا فحص صراحة للسر الفارغ في السير');
}

// v1.0.16 (بعد النشر): الإصدار بوسم مقصود حصراً — لا محفز يدوي (التشغيل
// اليدوي على فرع كان سينشر إصداراً باسم الفرع) وحارس نمط الوسم قبل النشر
if (!wf.includes('workflow_dispatch:')) {
  ok('لا محفز يدوي — السير ينطلق بدفع وسم v* حصراً');
} else {
  bad('محفز workflow_dispatch موجود — الدفع اليدوي قد ينشر إصداراً باسم فرع');
}

if (/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/.test(wf)) {
  ok('حارس نمط الوسم يرفض النشر لأي غير vX.Y.Z');
} else {
  bad('حارس نمط الوسم مفقود من خطوة النشر');
}

// المرآة المؤقتة موسومة
if (/مرآة إصدار الترحيل/.test(wf) && /تُزال بعد اكتمال الترحيل/.test(wf)) {
  ok('مرآة العملاء القدامى موجودة وموسومة «تُزال بعد اكتمال الترحيل»');
} else {
  bad('المرآة المؤقتة مفقودة أو غير موسومة');
}

// 5) الدليل
if (guide.includes('tahakam-releases') && guide.includes('RELEASES_REPO_TOKEN') && guide.includes('Make private')) {
  ok('دليل الترحيل موجود (الرف + التوكن + الخصخصة)');
} else {
  bad('دليل الترحيل ناقص');
}

// إصدار التحقق نفسه مضبوط — تراكمي: الإصدار الآلي (v1.0.17+) يرفع package.json
// تلقائياً عند كل دمج، فلا يصح تثبيته على قيمة واحدة
{
  const [ma, mi, pa] = pkg.version.split('.').map(Number)
  const okVersion = ma === 1 && mi === 0 && pa >= 16
  if (okVersion) ok(`إصدار package.json = ${pkg.version} (>= 1.0.16 — يتقدم آلياً مع كل إصدار)`)
  else bad(`إصدار package.json = ${pkg.version} (المتوقع >= 1.0.16)`)
}

// v1.0.17: الإصدار الآلي — أي كود يصل main يوسم ويصل للعملاء
const readOr = (p) => { try { return read(p) } catch { return '' } }
const auto = readOr('../.github/workflows/auto-release.yml')
if (auto.includes('branches: [main]') && auto.includes('chore(release):')) {
  ok('سير auto-release: أي كود يصل main يولّد إصداراً (وحارس دوران يتخطى التزام الإصدار)')
} else {
  bad('سير الإصدار الآلي auto-release.yml مفقود أو ناقص')
}
if (auto.includes("'docs/**'") && auto.includes("'**/*.md'")) {
  ok('تحديثات الوثائق وحدها لا تولّد إصداراً (paths-ignore)')
} else {
  bad('استثناء الوثائق من الإصدار الآلي مفقود')
}

if (fails === 0) console.log('بوابة الترحيل: ✓ مقفلة');
else { console.error(`بوابة الترحيل: ✗ ${fails} فشل`); process.exit(1); }
