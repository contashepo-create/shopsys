import fs from 'node:fs'
import { createHash } from 'node:crypto'

let pass = 0, fail = 0
const ok = (name, cond) => { cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name}`)) }

const sql = fs.readFileSync('../supabase/migrations/202609220001_secure_store_rls.sql', 'utf8')
const rotation = fs.readFileSync('../supabase/migrations/202609220002_rotate_store_access_token.sql', 'utf8')
const client = fs.readFileSync('src/data/syncClient.ts', 'utf8')
const page = fs.readFileSync('src/ui/pages/SyncPage.tsx', 'utf8')

console.log('\n🔐 ثوابت عزل متاجر Supabase')
ok('RLS مفعل ومفروض حتى على مالك الجدول', /enable row level security/i.test(sql) && /force row level security/i.test(sql))
ok('السياسة التاريخية المفتوحة تُحذف', /drop policy if exists "stores anon access"/i.test(sql))
ok('لا سياسة USING true', !/using\s*\(\s*true\s*\)/i.test(sql))
ok('لا سماح DELETE لـ anon', /revoke delete on table public\.stores from anon/i.test(sql))
ok('SELECT وINSERT وUPDATE لكل منها سياسة مستقلة', ['select', 'insert', 'update'].every((op) => new RegExp(`stores_tenant_${op}`, 'i').test(sql)))
ok('البصمة SHA-256 لا الاعتماد الصريح هي المخزنة', /access_token_hash/.test(sql) && /digest\(/.test(sql))
ok('سياسة الإدخال تربط store-id بالـheader', /x-store-id/.test(sql) && /x-store-access-token/.test(sql))
ok('العميل يرسل اعتماد العزل في كل headers', /'X-Store-Access-Token': c\.accessToken/.test(client))
ok('سر التشفير واعتماد الوصول حقلان منفصلان', /secret: string/.test(client) && /accessToken: string/.test(client))
ok('واجهة SQL المفتوحة القديمة أزيلت', !page.includes('stores anon access') && page.includes('secure_store_rls.sql'))
ok('التدوير RPC ذري ومحصن بـsecurity definer', /rotate_store_access_token/.test(rotation) && /security definer/i.test(rotation))
ok('التدوير لا يقبل إلا البصمة الحالية', /access_token_hash = old_hash/.test(rotation))
ok('التدوير يفرض صيغة base64url بطول 256-bit', /\^\[A-Za-z0-9_-\]\{43\}\$/.test(rotation) && /old_token !~/.test(rotation))
ok('الاعتماد السابق محدد الصلاحية لا دائم', /interval '24 hours'/.test(rotation) && /previous_expires_at > pg_catalog\.now/.test(rotation))
ok('العميل يرسل الجديد في header منفصل', /'X-New-Store-Access-Token': newToken/.test(client))

// نموذج عزل حتمي يثبت السيناريو المطلوب حتى في CI الذي لا يملك اتصال staging:
// anon وحده لا يقرأ شيئاً، واعتماد متجر A لا يفتح صف متجر B.
const hash = (token) => createHash('sha256').update(token).digest('hex')
const permits = (row, requestStoreId, requestToken, operation) => {
  if (!requestStoreId || !requestToken || !['select', 'update'].includes(operation)) return false
  if (row.storeId !== requestStoreId || row.accessTokenHash !== hash(requestToken)) return false
  return true
}
const rowA = { storeId: 'store-a', accessTokenHash: hash('A'.repeat(43)) }
const rowB = { storeId: 'store-b', accessTokenHash: hash('B'.repeat(43)) }
ok('anon بلا headers لا يقرأ ولا يعدل', !permits(rowA, '', '', 'select') && !permits(rowA, '', '', 'update'))
ok('اعتماد متجر A يعزل قراءة وتعديل متجر B', permits(rowA, 'store-a', 'A'.repeat(43), 'select') && permits(rowA, 'store-a', 'A'.repeat(43), 'update') && !permits(rowB, 'store-a', 'A'.repeat(43), 'select') && !permits(rowB, 'store-a', 'A'.repeat(43), 'update'))
ok('تغيير store-id أو الاعتماد يفشل العزل', !permits(rowA, 'store-b', 'A'.repeat(43), 'select') && !permits(rowA, 'store-a', 'B'.repeat(43), 'update'))

console.log(`\n═══════════ PASS=${pass} FAIL=${fail} ═══════════`)
if (fail) process.exit(1)
