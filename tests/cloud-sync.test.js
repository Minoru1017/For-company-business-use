import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { isAppKey } from '../src/backup.js';
import {
  BUILT_IN_CLOUD,
  CLOUD_SESSION_KEY,
  CLOUD_STATE_KEY,
  CloudError,
  cloudConfig,
  compareSync,
  createCloudClient,
  decryptBytes,
  downloadSnapshot,
  encryptBytes,
  keyForMeta,
  loadRememberedKey,
  localFingerprint,
  newCloudKey,
  rememberKey,
  takeAuthRedirect,
  uploadSnapshot,
  verifyKey,
} from '../src/cloud-sync.js';

class MemoryStorage {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init));
  }
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

const URL_ = 'https://demo.supabase.co';
const CONFIG = { url: URL_, anonKey: 'anon-key-xxxxxxxxxxxxxxxxxxxx', configured: true };

/** 最小 Supabase：OTP 驗證碼 123456、token 換發、使用者資料夾權限 */
function fakeSupabase() {
  const objects = new Map();
  const tokens = new Map();
  let n = 0;
  let lastOtp = null;
  const issue = (email) => {
    n += 1;
    const t = { access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 3600, user: { id: `uid-${email}`, email } };
    tokens.set(t.access_token, t.user);
    tokens.set(`refresh:${t.refresh_token}`, t.user);
    return t;
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body;
    if (u.pathname === '/auth/v1/otp') {
      lastOtp = u.searchParams.get('redirect_to');
      return json(200, {});
    }
    if (u.pathname === '/auth/v1/user') {
      const user = tokens.get(String(init.headers?.Authorization || '').replace('Bearer ', ''));
      return user ? json(200, user) : json(401, { msg: 'invalid JWT' });
    }
    if (u.pathname === '/auth/v1/verify') {
      const b = JSON.parse(body);
      return b.token === '123456' ? json(200, issue(b.email)) : json(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    }
    if (u.pathname === '/auth/v1/token') {
      const user = tokens.get(`refresh:${JSON.parse(body).refresh_token}`);
      return user ? json(200, issue(user.email)) : json(400, { error: 'invalid_grant' });
    }
    if (u.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    const user = tokens.get(String(init.headers?.Authorization || '').replace('Bearer ', ''));
    if (!user) return json(401, { message: 'jwt expired' });
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?callcoach-sync\/(.+)$/);
    if (init.method === 'DELETE') {
      JSON.parse(body).prefixes.forEach((p) => p.startsWith(`${user.id}/`) && objects.delete(p));
      return json(200, []);
    }
    if (!m) return json(404, {});
    const path = decodeURIComponent(m[1]);
    if (!path.startsWith(`${user.id}/`)) return json(403, { message: 'new row violates row-level security policy' });
    if (init.method === 'POST') {
      objects.set(path, new Uint8Array(body));
      return json(200, { Key: path });
    }
    const obj = objects.get(path);
    return obj ? new Response(obj, { status: 200 }) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  };
  return { fetchImpl, objects, tokens, issue, lastRedirect: () => lastOtp };
}

/** 只用 localStorage 的資料；IndexedDB 由 databases: [] 排除，讓兩台「裝置」互不干擾 */
const device = (init) => new MemoryStorage(init);
const opts = (storage) => ({ JSZip, storage, databases: [] });

async function signIn(api, storage, email = 'me@corp.tw') {
  const client = createCloudClient({ storage, fetchImpl: api.fetchImpl, config: CONFIG });
  await client.sendCode(email);
  await client.verifyCode(email, '123456');
  return client;
}

describe('cloud sync', () => {
  let api;
  beforeEach(() => {
    api = fakeSupabase();
  });

  it('keeps device-only cloud keys out of backups', () => {
    expect(isAppKey('callCoachCloudSession')).toBe(false);
    expect(isAppKey('callCoachCloudState')).toBe(false);
    expect(isAppKey('callCoachHistory')).toBe(true);
  });

  it('prefers saved config and falls back to the built-in project', () => {
    const s = device({ callCoachCloudConfig: JSON.stringify({ url: 'https://x.supabase.co/', anonKey: 'k'.repeat(30) }) });
    expect(cloudConfig(s)).toMatchObject({ url: 'https://x.supabase.co', configured: true, custom: true });
    // 公開版的內建專案是空白，此時要回到「尚未設定」而不是壞掉的網址
    expect(BUILT_IN_CLOUD.url).toMatch(/^(https:\/\/[a-z0-9]+\.supabase\.co)?$/);
    expect(cloudConfig(device())).toMatchObject({ url: BUILT_IN_CLOUD.url, configured: !!BUILT_IN_CLOUD.url, custom: false });
  });

  it('encrypts with the sync password and refuses a wrong one', async () => {
    const { key, salt } = await newCloudKey('correct horse');
    const sealed = await encryptBytes(key, new TextEncoder().encode('王小姐 每週四小時'));
    expect(new TextDecoder().decode(sealed)).not.toContain('王小姐');
    const meta = { salt, iterations: 310000 };
    const again = await keyForMeta('correct horse', meta);
    expect(new TextDecoder().decode(await decryptBytes(again, sealed))).toBe('王小姐 每週四小時');
    const wrong = await keyForMeta('wrong', meta);
    await expect(decryptBytes(wrong, sealed)).rejects.toMatchObject({ code: 'bad-key' });

    const s = device();
    await rememberKey(s, key, salt);
    expect(await loadRememberedKey(s, salt)).toBeTruthy();
    expect(await loadRememberedKey(s, 'other-salt')).toBeNull();
  });

  it('rejects a wrong verification code', async () => {
    const client = createCloudClient({ storage: device(), fetchImpl: api.fetchImpl, config: CONFIG });
    await expect(client.verifyCode('me@corp.tw', '000000')).rejects.toMatchObject({ code: 'otp' });
    await expect(client.verifyCode('me@corp.tw', 'abc')).rejects.toBeInstanceOf(CloudError);
  });

  it('syncs one device to another, encrypted, without secrets', async () => {
    const a = device({ callCoachHistory: '[{"id":"h1"}]', call_coach_demo_reviews_v1: '[{"id":"r1","customer":"王小姐"}]', gemini_key: 'AIzaSECRET' });
    const ca = await signIn(api, a);
    expect(await ca.getMeta()).toBeNull();
    const { key, salt } = await newCloudKey('pw-123456');
    const meta = await uploadSnapshot({ client: ca, ...opts(a), key, salt, now: new Date('2026-10-13T10:00:00Z') });
    expect(meta).toMatchObject({ device: expect.any(String), salt });

    const stored = [...api.objects.entries()];
    expect(stored.map(([p]) => p).sort()).toEqual([`uid-me@corp.tw/${meta.file}`, 'uid-me@corp.tw/meta.json'].sort());
    const snapshot = stored.find(([p]) => p.endsWith('.bin'))[1];
    expect(Buffer.from(snapshot).toString('latin1')).not.toContain('AIzaSECRET');

    const fpA = await localFingerprint(opts(a));
    expect(compareSync({ meta, state: JSON.parse(a.getItem(CLOUD_STATE_KEY)), fingerprint: fpA })).toEqual({ status: 'synced' });

    const b = device({ gemini_key: 'AIzaB' });
    const cb = await signIn(api, b);
    const remote = await cb.getMeta();
    expect(compareSync({ meta: remote, state: null, fingerprint: null, hasLocalData: false })).toEqual({ status: 'cloud-ahead' });
    const kb = await keyForMeta('pw-123456', remote);
    expect(await verifyKey(kb, remote)).toBe(true);
    expect(await verifyKey(await keyForMeta('nope', remote), remote)).toBe(false);
    await downloadSnapshot({ client: cb, ...opts(b), key: kb, meta: remote });
    expect(b.getItem('call_coach_demo_reviews_v1')).toContain('王小姐');
    expect(b.getItem('gemini_key')).toBe('AIzaB');
    expect(b.getItem(CLOUD_SESSION_KEY)).toBeTruthy();
    const fpB = await localFingerprint(opts(b));
    expect(compareSync({ meta: remote, state: JSON.parse(b.getItem(CLOUD_STATE_KEY)), fingerprint: fpB })).toEqual({ status: 'synced' });
  });

  it('detects conflicts and replaces the old snapshot file', async () => {
    const a = device({ callCoachHistory: '[1]' });
    const b = device({ callCoachHistory: '[1]' });
    const ca = await signIn(api, a);
    const cb = await signIn(api, b);
    const { key, salt } = await newCloudKey('pw');
    const first = await uploadSnapshot({ client: ca, ...opts(a), key, salt });
    await downloadSnapshot({ client: cb, ...opts(b), key });

    b.setItem('callCoachHistory', '[1,2]');
    const second = await uploadSnapshot({ client: cb, ...opts(b), key, salt });
    expect([...api.objects.keys()].some((p) => p.endsWith(first.file))).toBe(false);

    a.setItem('callCoachHistory', '[1,3]');
    const stateA = JSON.parse(a.getItem(CLOUD_STATE_KEY));
    const fpA = await localFingerprint(opts(a));
    expect(compareSync({ meta: second, state: stateA, fingerprint: fpA })).toEqual({ status: 'conflict', reason: 'both-changed' });
    await expect(uploadSnapshot({ client: ca, ...opts(a), key, salt })).rejects.toMatchObject({ code: 'conflict' });
    const forced = await uploadSnapshot({ client: ca, ...opts(a), key, salt, force: true });
    expect((await cb.getMeta()).rev).toBe(forced.rev);
  });

  it('refreshes an expired session and signs out cleanly', async () => {
    const s = device({ callCoachHistory: '[]' });
    const client = await signIn(api, s);
    const session = JSON.parse(s.getItem(CLOUD_SESSION_KEY));
    s.setItem(CLOUD_SESSION_KEY, JSON.stringify({ ...session, expires_at: 0 }));
    expect(await client.getMeta()).toBeNull();
    expect(JSON.parse(s.getItem(CLOUD_SESSION_KEY)).access_token).not.toBe(session.access_token);
    await client.signOut();
    expect(s.getItem(CLOUD_SESSION_KEY)).toBeNull();
    expect(s.getItem('callCoachHistory')).toBe('[]');
  });

  it('takes login-link tokens out of the URL and signs in with them', async () => {
    const replaced = [];
    const hist = { replaceState: (_s, _t, url) => replaced.push(url) };
    const t = api.issue('link@corp.tw');
    const loc = { hash: `#access_token=${t.access_token}&refresh_token=${t.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`, pathname: '/For-company-business-use/', search: '' };
    const got = takeAuthRedirect(loc, hist);
    expect(got.tokens.access_token).toBe(t.access_token);
    expect(replaced).toEqual(['/For-company-business-use/']);

    const s = device();
    const client = createCloudClient({ storage: s, fetchImpl: api.fetchImpl, config: CONFIG });
    await client.sendCode('link@corp.tw', { redirectTo: 'https://minoru1017.github.io/For-company-business-use/' });
    expect(api.lastRedirect()).toBe('https://minoru1017.github.io/For-company-business-use/');
    const session = await client.completeRedirect(got.tokens);
    expect(session.user.email).toBe('link@corp.tw');
    expect(await client.getMeta()).toBeNull();
    await expect(client.completeRedirect({ access_token: 'bogus' })).rejects.toMatchObject({ code: 'otp' });

    expect(takeAuthRedirect({ hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', pathname: '/' }, hist).error).toContain('已過期');
    expect(takeAuthRedirect({ hash: '#deck', pathname: '/' }, hist)).toBeNull();
  });
});
