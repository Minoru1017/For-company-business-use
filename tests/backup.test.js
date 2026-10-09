import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  BACKUP_APP,
  LAST_BACKUP_KEY,
  backupFileName,
  backupStatus,
  collectLocalStorage,
  createBackup,
  isAppKey,
  markBackedUp,
  readBackup,
  restoreBackup,
  summarizeBackup,
} from '../src/backup.js';
import { getAudio, getCall, getDay, getSettings, openSymptomDb, putAudio, putCall, putDay, saveSettings } from '../src/symptom-store.js';
import { deleteDeckImages, loadAllDeckImages, putDeckImage } from '../src/demo-deck-images.js';
import { appendMeetingAudioChunk, beginMeetingAudioSession, getMeetingAudioBlob } from '../src/meeting-audio-store.js';

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

async function clearAllStores() {
  const db = await openSymptomDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['days', 'calls', 'audio', 'settings'], 'readwrite');
    ['days', 'calls', 'audio', 'settings'].forEach((s) => t.objectStore(s).clear());
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

async function toBytes(backup) {
  return backup.zip.generateAsync({ type: 'uint8array' });
}

const bytesOf = async (blob) => [...new Uint8Array(await blob.arrayBuffer())];

describe('full backup / restore', () => {
  let storage;

  beforeEach(async () => {
    await clearAllStores();
    storage = new MemoryStorage({
      call_coach_reflection_journal_v1: '{"days":{"2026-10-09":{"n":3}}}',
      callCoachHistory: '[{"id":"h1"}]',
      gemini_model: 'gemini-2.5-flash',
      gemini_key: 'AIza-secret',
      callCoachBrowserWorkerToken: 'worker-secret',
      otherSiteKey: 'belongs to another github.io page',
    });
    await putDay({ date: '2026-10-09', dialed: 40, note: { free: '今天卡在破冰' } });
    await putCall({ id: 'c1', date: '2026-10-09', durationSec: 320, createdAt: new Date('2026-10-09T03:00:00Z') });
    await putAudio('c1', new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'audio/mpeg' }));
    await saveSettings({ scriptToken: 'apps-script-secret', shortMin: 6 });
    await putDeckImage('img_1', 'data:image/png;base64,AAAA');
  });

  it('only touches Call Coach keys and leaves secrets out by default', () => {
    expect(isAppKey('otherSiteKey')).toBe(false);
    expect(isAppKey(LAST_BACKUP_KEY)).toBe(false);
    const ls = collectLocalStorage(storage);
    expect(Object.keys(ls)).toEqual(['callCoachHistory', 'call_coach_reflection_journal_v1', 'gemini_model']);
    expect(Object.keys(collectLocalStorage(storage, { includeSecrets: true }))).toContain('gemini_key');
  });

  it('round-trips localStorage, IndexedDB records, Dates and audio blobs', async () => {
    const backup = await createBackup({ JSZip, storage, appVersion: '11.9.14', now: new Date('2026-10-09T08:00:00Z') });
    expect(backup.manifest.app).toBe(BACKUP_APP);
    expect(backup.manifest.databases.callCoachSymptomLog).toEqual({ days: 1, calls: 1, audio: 1, settings: 1 });
    expect(backup.manifest.binaryBytes).toBe(4);
    const settingsJson = await backup.zip.file('idb/callCoachSymptomLog/settings.json').async('string');
    expect(settingsJson).not.toContain('apps-script-secret');
    expect(await backup.zip.file('localStorage.json').async('string')).not.toContain('AIza-secret');

    const bytes = await toBytes(backup);
    await clearAllStores();
    await deleteDeckImages(['img_1']);
    expect((await loadAllDeckImages()).has('img_1')).toBe(false);
    storage = new MemoryStorage({ otherSiteKey: 'keep me', gemini_key: 'new-pc-key', callCoachDrillPrefs: '{"stale":true}' });
    await saveSettings({ scriptToken: 'new-pc-token' });

    const parsed = await readBackup(JSZip, bytes);
    await restoreBackup(parsed, { storage });

    expect(storage.getItem('callCoachHistory')).toBe('[{"id":"h1"}]');
    expect(storage.getItem('call_coach_reflection_journal_v1')).toContain('2026-10-09');
    expect(storage.getItem('callCoachDrillPrefs')).toBeNull();
    expect(storage.getItem('otherSiteKey')).toBe('keep me');
    expect(storage.getItem('gemini_key')).toBe('new-pc-key');
    expect(storage.getItem(LAST_BACKUP_KEY)).toBe('2026-10-09T08:00:00.000Z');
    expect((await getDay('2026-10-09')).note.free).toBe('今天卡在破冰');
    const call = await getCall('c1');
    expect(call.createdAt).toBeInstanceOf(Date);
    expect(call.createdAt.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    const audio = await getAudio('c1');
    expect(audio.type).toBe('audio/mpeg');
    expect(await bytesOf(audio)).toEqual([1, 2, 3, 250]);
    const settings = await getSettings();
    expect(settings.shortMin).toBe(6);
    expect(settings.scriptToken).toBe('new-pc-token');
    expect((await loadAllDeckImages()).get('img_1')).toBe('data:image/png;base64,AAAA');
  });

  it('can include secrets for moving to a new computer', async () => {
    const bytes = await toBytes(await createBackup({ JSZip, storage, includeSecrets: true }));
    storage = new MemoryStorage({ gemini_key: 'other' });
    await restoreBackup(await readBackup(JSZip, bytes), { storage });
    expect(storage.getItem('gemini_key')).toBe('AIza-secret');
    expect(storage.getItem('callCoachBrowserWorkerToken')).toBe('worker-secret');
    expect((await getSettings()).scriptToken).toBe('apps-script-secret');
  });

  it('a backup without audio keeps the recordings already on this computer', async () => {
    const backup = await createBackup({ JSZip, storage, includeAudio: false });
    expect(backup.manifest.databases.callCoachSymptomLog.audio).toBeUndefined();
    expect(backup.manifest.binaryBytes).toBe(0);
    await putAudio('c2', new Blob([new Uint8Array([9])], { type: 'audio/webm' }));
    await restoreBackup(await readBackup(JSZip, await toBytes(backup)), { storage });
    expect(await bytesOf(await getAudio('c2'))).toEqual([9]);
    expect(await getCall('c1')).toBeTruthy();
  });

  it('backs up meeting audio chunks', async () => {
    await beginMeetingAudioSession({ id: 's1', meetingId: 'm1', mimeType: 'audio/webm' });
    await appendMeetingAudioChunk('s1', 0, new Blob([new Uint8Array([5, 6])], { type: 'audio/webm' }));
    const backup = await createBackup({ JSZip, storage });
    expect(backup.manifest.databases.callCoachMeetingAudio.chunks).toBeGreaterThan(0);
    await restoreBackup(await readBackup(JSZip, await toBytes(backup)), { storage });
    expect(await bytesOf(await getMeetingAudioBlob('s1'))).toEqual([5, 6]);
  });

  it('rejects files that are not Call Coach backups, or from a newer format', async () => {
    await expect(readBackup(JSZip, new Uint8Array([1, 2, 3]))).rejects.toThrow('無法解壓縮');
    const other = new JSZip();
    other.file('manifest.json', JSON.stringify({ app: 'something-else', format: 1 }));
    await expect(readBackup(JSZip, await other.generateAsync({ type: 'uint8array' }))).rejects.toThrow('不是 Call Coach 備份檔');
    const newer = new JSZip();
    newer.file('manifest.json', JSON.stringify({ app: BACKUP_APP, format: 99 }));
    await expect(readBackup(JSZip, await newer.generateAsync({ type: 'uint8array' }))).rejects.toThrow('較新版本');
  });

  it('summarizes the backup for the confirmation screen', async () => {
    const { manifest } = await createBackup({ JSZip, storage });
    const rows = summarizeBackup(manifest);
    expect(rows[0].count).toBe(3);
    expect(rows).toContainEqual({ label: '症狀紀錄・通話錄音', count: 1 });
    expect(rows).toContainEqual({ label: 'DEMO 簡報圖片・圖片', count: 1 });
    expect(rows.every((r, i) => i === 0 || r.count > 0)).toBe(true);
  });

  it('reminds when there is data but no backup in the last 7 days', () => {
    const now = Date.parse('2026-10-09T00:00:00Z');
    expect(backupStatus(new MemoryStorage(), now).due).toBe(false);
    expect(backupStatus(storage, now)).toEqual({ lastAt: null, days: null, due: true });
    markBackedUp(storage, new Date('2026-10-05T00:00:00Z'));
    expect(backupStatus(storage, now)).toMatchObject({ days: 4, due: false });
    expect(backupStatus(storage, Date.parse('2026-10-13T00:00:00Z')).due).toBe(true);
    expect(backupFileName(new Date(2026, 9, 9, 8, 5))).toBe('CallCoach-備份-20261009-0805.zip');
  });
});
