/**
 * 一次設定 Call Coach 雲端同步需要的 Supabase 項目（可重複執行）：
 *   1. Storage bucket callcoach-sync＋「只能讀寫自己資料夾」的權限
 *   2. 登入信連結回到 Call Coach 網站；可以的話信件改附數字驗證碼（免費方案＋內建寄信不允許改範本）
 *   3. 印出網站要用的 Project URL 與 anon key
 *
 * 用法：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/supabase-setup.mjs <project-ref>
 * Access token 在 https://supabase.com/dashboard/account/tokens 建立。
 */
const ref = process.argv[2] || process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error('用法：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/supabase-setup.mjs <project-ref>');
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${ref}`;
const SITE = process.env.CALL_COACH_SITE || 'https://minoru1017.github.io/For-company-business-use/';

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const own = "bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text";
const SQL = `
insert into storage.buckets (id, name, public, file_size_limit)
values ('callcoach-sync', 'callcoach-sync', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "callcoach sync read own" on storage.objects;
drop policy if exists "callcoach sync insert own" on storage.objects;
drop policy if exists "callcoach sync update own" on storage.objects;
drop policy if exists "callcoach sync delete own" on storage.objects;

create policy "callcoach sync read own" on storage.objects for select to authenticated using (${own});
create policy "callcoach sync insert own" on storage.objects for insert to authenticated with check (${own});
create policy "callcoach sync update own" on storage.objects for update to authenticated using (${own}) with check (${own});
create policy "callcoach sync delete own" on storage.objects for delete to authenticated using (${own});
`;

const MAIL = `<h2>Call Coach 登入驗證碼</h2>
<p>你的驗證碼是：<b style="font-size:20px">{{ .Token }}</b></p>
<p>或直接點 <a href="{{ .ConfirmationURL }}">這個連結</a> 登入。</p>
<p>幾分鐘內有效；如果不是你本人操作，請忽略這封信。</p>`;

console.log('1/3 建立 Storage bucket 與權限…');
await call('/database/query', { method: 'POST', body: JSON.stringify({ query: SQL, read_only: false }) });
const check = await call('/database/query', {
  method: 'POST',
  body: JSON.stringify({ query: "select policyname from pg_policies where schemaname = 'storage' and policyname like 'callcoach sync%' order by 1" }),
});
console.log(`   權限 ${check.length} 條：${check.map((r) => r.policyname).join('、')}`);

console.log('2/3 設定登入信…');
await call('/config/auth', {
  method: 'PATCH',
  body: JSON.stringify({
    site_url: SITE,
    uri_allow_list: [`${SITE}**`, 'http://localhost:5173/**', 'http://127.0.0.1:5173/**'].join(','),
  }),
});
console.log(`   登入連結會回到 ${SITE}`);
try {
  await call('/config/auth', {
    method: 'PATCH',
    body: JSON.stringify({
      mailer_subjects_confirmation: 'Call Coach 登入驗證碼',
      mailer_templates_confirmation_content: MAIL,
      mailer_subjects_magic_link: 'Call Coach 登入驗證碼',
      mailer_templates_magic_link_content: MAIL,
    }),
  });
  console.log('   信件已改為附數字驗證碼');
} catch (err) {
  console.log(`   信件範本維持預設（只有登入連結）：${err.message.includes('free tier') ? '免費方案需先設定自訂 SMTP 才能改範本' : err.message}`);
}

console.log('3/3 讀取 API key…');
const keys = await call('/api-keys?reveal=false');
const anon = keys.find((k) => k.name === 'anon' && k.api_key)?.api_key || keys.find((k) => k.type === 'publishable')?.api_key;
console.log('\n完成。網站設定：');
console.log(`SUPABASE_URL=https://${ref}.supabase.co`);
console.log(`SUPABASE_ANON_KEY=${anon || '（找不到，請到 Project Settings → API Keys 複製 anon public key）'}`);
