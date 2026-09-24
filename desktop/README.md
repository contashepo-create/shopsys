# ShopSys Desktop

قشرة Electron تدريجية لنسخة ShopSys المكتبية. لا تغيّر هذه المرحلة سلوك نسخة الويب أو Zustand؛ تفتح SQLite محلية وتعرض عقداً آمناً عبر `preload` تمهيداً لنقل التخزين دون إعادة كتابة الواجهة دفعة واحدة.

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
- الحفظ يحوي `expectedRevision` لمنع الكتابة فوق نسخة أحدث بصمت.
- اللقطة الحالية هي جسر انتقالي فقط؛ نقل جداول الأعمال يكون لاحقاً مع migrations واختبارات ترحيل/استعادة.
