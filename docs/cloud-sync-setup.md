# 雲端同步設定（Supabase）

Call Coach 的「登入雲端」使用 Supabase 的 Auth（Email 驗證碼）與 Storage。資料在瀏覽器裡用使用者自己的「同步密碼」加密後才上傳，Supabase 與管理者都只看得到密文。

只需要做一次，免費方案即可。

## 1. 建立專案

1. 到 <https://supabase.com> 建立專案（Region 建議選 Tokyo 或 Singapore）。
2. **Project Settings → API**，記下：
   - Project URL（例：`https://abcd1234.supabase.co`）
   - `anon` `public` key

## 2. 建立 Storage bucket 與權限

到 **SQL Editor** 執行：

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('callcoach-sync', 'callcoach-sync', false, 52428800)
on conflict (id) do nothing;

-- 每個人只能讀寫自己的資料夾（資料夾名稱＝使用者 id）
create policy "callcoach sync read own"
  on storage.objects for select to authenticated
  using (bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "callcoach sync insert own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "callcoach sync update own"
  on storage.objects for update to authenticated
  using (bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "callcoach sync delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'callcoach-sync' and (storage.foldername(name))[1] = auth.uid()::text);
```

## 3. 讓登入信寄「數字驗證碼」

**Authentication → Emails → Templates → Magic Link**，把內容改成包含 `{{ .Token }}`，例如：

```html
<h2>Call Coach 登入驗證碼</h2>
<p>你的驗證碼是：<b style="font-size:20px">{{ .Token }}</b></p>
<p>幾分鐘內有效；如果不是你本人操作，請忽略這封信。</p>
```

> Supabase 內建寄信每小時只能寄少量信件，正式給多人使用時建議在 **Authentication → Emails → SMTP Settings** 設定公司的 SMTP。

### 只讓特定人登入（選用）

**Authentication → Sign In / Providers** 關閉「Allow new users to sign up」，再到 **Authentication → Users → Invite user** 邀請成員。沒被邀請的 Email 就收不到驗證碼。

## 4. 把設定放進網站

GitHub repo → **Settings → Secrets and variables → Actions → Variables**，新增：

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public key |

重新部署（push 到 main 或手動執行「Deploy to GitHub Pages」）後，側欄的「登入雲端」就會直接可用。

還沒部署前也可以先試：在「登入雲端」視窗手動填 Project URL 與 anon key，只會存在那台裝置。

## 同步規則

- 上傳的內容與「備份／還原」相同，但**不含錄音與 API Key／Token**；單一帳號一份快照，上限約 45 MB。
- 上傳＝用這台裝置取代雲端；下載＝用雲端取代這台裝置。兩邊都有變更時會請使用者選擇，不會自動合併。
- 忘記同步密碼無法取回雲端資料，只能用某台裝置的資料重設。
