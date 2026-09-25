# ShopSys Desktop

قشرة Electron تدريجية لنسخة ShopSys المكتبية. نسخة الويب تبقى على تخزينها المشفر الحالي، بينما تستخدم نسخة Electron الآن جسر SQLite للقطة Zustand نفسها دون إعادة كتابة الواجهة دفعة واحدة. نقل جداول الأعمال التفصيلية يأتي لاحقاً.

## التشغيل المحلي

من جذر المشروع:

```bash
cd app && npm install && npm run build
cd ../desktop && npm install && npm start
```

للتطوير مع خادم Vite يعمل على `http://localhost:5173`:

```bash
cd desktop && npm run dev
```

## ضمانات القشرة

- `contextIsolation: true` و`nodeIntegration: false` و`sandbox: true`.
- لا يخرج SQLite أو Node إلى نافذة المتصفح؛ الاتصال يمر عبر `preload.cjs` وعمليات IPC محددة.
- ملف البيانات يحفظ في `app.getPath('userData')/shopsys.sqlite`، لا داخل مجلد المشروع.
- SQLite تستخدم WAL وforeign keys ومعاملة واحدة للترحيل والحفظ.
- الحفظ يحوي `expectedRevision` لمنع الكتابة فوق نسخة أحدث بصمت، والحذف له الحارس نفسه.
- payload اللقطة يستخدم `safeStorage` عند توفر مخزن مفاتيح النظام، مع وسم صريح لحالة fallback في بيئات Linux التي لا توفر keyring.
- التخزين المتصفح/الإلكترون موحد في `app/src/data/persistentStorage.ts`: خارج Electron = `secureStorage`، وداخله = SQLite عبر IPC مع طابور كتابة لكل مخزن.
- عند وجود لقطة ويب قديمة، تُنسخ إلى SQLite بنجاح قبل حذفها؛ فشل SQLite لا يحذف الأصل.
- اللقطة الحالية هي جسر انتقالي فقط؛ نقل جداول الأعمال يكون لاحقاً مع migrations واختبارات ترحيل/استعادة.
