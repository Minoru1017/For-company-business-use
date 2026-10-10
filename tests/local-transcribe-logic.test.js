import { describe, expect, it } from 'vitest';
import {
  bridgeFetchError,
  buildChecklistItems,
  fmtElapsed,
  fmtSize,
  fmtSpeed,
  isGpuSetupEndpoint,
  isOffsiteMode,
  lastErrorLine,
  modeHintTextFor,
  modeShortLabelFor,
  needsFullSetup,
  pickSelectedMp4,
  transcribeBlockReasonFor,
  transcribeButtonLabelFor,
  transcribeFailToast,
  VALID_MODES,
} from '../src/local-transcribe-logic.js';

const READY_LOCAL = { python_ok: true, ffmpeg_ok: true, venv_ok: true, whisperx_ok: true, token_ok: true, mp4_files: ['DEMO.mp4'] };
const labels = (items) => items.map((i) => i.label);
const todo = (items) => items.filter((i) => !i.ok);

describe('local-transcribe-logic：MP4 選擇', () => {
  it('沿用原本選的檔（大小寫不同也算同一個），不在清單就改選 demo.mp4，再不然第一個', () => {
    expect(pickSelectedMp4('demo.MP4', ['a.mp4', 'DEMO.mp4'])).toBe('DEMO.mp4');
    expect(pickSelectedMp4('gone.mp4', ['a.mp4', 'Demo.mp4'])).toBe('Demo.mp4');
    expect(pickSelectedMp4(null, ['b.mp4', 'c.mp4'])).toBe('b.mp4');
    expect(pickSelectedMp4('a.mp4', [])).toBeNull();
    expect(pickSelectedMp4('a.mp4', undefined)).toBeNull();
  });
});

describe('local-transcribe-logic：格式化', () => {
  it('檔案大小、上傳速度、經過時間', () => {
    expect(fmtSize(512 * 1024)).toBe('512.0 KB');
    expect(fmtSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(fmtSpeed(0)).toBe('計算中…');
    expect(fmtSpeed(500)).toBe('計算中…');
    expect(fmtSpeed(200 * 1024)).toBe('200 KB/s');
    expect(fmtSpeed(2.25 * 1024 * 1024)).toBe('2.3 MB/s');
    expect(fmtElapsed(45)).toBe('45 秒');
    expect(fmtElapsed(125)).toBe('2 分 5 秒');
  });

  it('連不上助手時給可照做的步驟，其他錯誤保留原訊息', () => {
    expect(bridgeFetchError(new TypeError('Failed to fetch'))).toContain('Call Coach 本機助手');
    expect(bridgeFetchError(new Error('Load failed'))).toContain('Releases');
    expect(bridgeFetchError(new Error('HTTP 500'))).toBe('HTTP 500');
    expect(bridgeFetchError(null)).toBe('無法連線本機轉錄助手');
  });

  it('從記錄找最後一行錯誤當提示', () => {
    const logs = ['[資訊] 開始', '[錯誤] 第一個', '[資訊] 重試', '[錯誤] ffmpeg 找不到'];
    expect(lastErrorLine(logs)).toBe('[錯誤] ffmpeg 找不到');
    expect(transcribeFailToast(logs)).toBe('轉錄失敗：ffmpeg 找不到');
    expect(lastErrorLine(['ok'])).toBeNull();
    expect(transcribeFailToast(null)).toBe('轉錄失敗，請查看下方記錄');
  });
});

describe('local-transcribe-logic：模式', () => {
  it('每個模式都有按鈕文字、說明與短標籤；Azure／遠端算音訊離開本機', () => {
    VALID_MODES.forEach((m) => {
      expect(transcribeButtonLabelFor(m)).toMatch(/^開始/);
      expect(modeHintTextFor(m).length).toBeGreaterThan(20);
      expect(modeShortLabelFor(m)).toBeTruthy();
    });
    expect(isOffsiteMode('azure')).toBe(true);
    expect(isOffsiteMode('remote')).toBe(true);
    expect(isOffsiteMode('local_gpu')).toBe(false);
    expect(isOffsiteMode('standard')).toBe(false);
  });

  it('GPU 安裝類端點與完整環境判斷', () => {
    expect(isGpuSetupEndpoint('/api/setup-gpu')).toBe(true);
    expect(isGpuSetupEndpoint('/api/repair-gpu-torch')).toBe(true);
    expect(isGpuSetupEndpoint('/api/full-setup')).toBe(false);
    expect(needsFullSetup({ ffmpeg_ok: true, venv_ok: true, whisperx_ok: true })).toBe(false);
    expect(needsFullSetup({ ffmpeg_ok: true, venv_ok: false, whisperx_ok: true })).toBe(true);
  });
});

describe('local-transcribe-logic：首次啟動檢查清單', () => {
  it('本機標準模式：全部就緒', () => {
    const items = buildChecklistItems(READY_LOCAL, { mode: 'standard' });
    expect(todo(items)).toEqual([]);
    expect(labels(items)).toContain('WhisperX 本機轉錄環境');
    expect(labels(items).at(-1)).toBe('DEMO 錄影檔（1 個 MP4）');
  });

  it('缺 ffmpeg：能用 winget 就單裝，否則完整安裝', () => {
    const withWinget = buildChecklistItems({ ...READY_LOCAL, ffmpeg_ok: false, winget_ok: true }, { mode: 'standard' });
    expect(todo(withWinget)[0].fix.action).toBe('install-ffmpeg');
    const noWinget = buildChecklistItems({ ...READY_LOCAL, ffmpeg_ok: false }, { mode: 'standard' });
    expect(todo(noWinget)[0].fix.action).toBe('full-setup');
  });

  it('Azure：要金鑰與知情同意，區域沒有 Fast Transcription 時提醒', () => {
    const st = { ffmpeg_ok: true, azure_ok: true, azure_region: 'eastus', azure_fast_ok: false, mp4_files: ['a.mp4'] };
    const noConsent = buildChecklistItems(st, { mode: 'azure' });
    expect(todo(noConsent).map((i) => i.fix.action)).toEqual(['consent']);
    expect(noConsent.find((i) => i.label.startsWith('Azure')).warn).toContain('southeastasia');
    expect(todo(buildChecklistItems(st, { mode: 'azure', cloudConsent: true }))).toEqual([]);
  });

  it('本機 GPU：WhisperX 已裝但 PyTorch 是 CPU 版時只建議修復 PyTorch', () => {
    const st = { ...READY_LOCAL, cuda_torch_build: false, gpu_available: false };
    const fixes = todo(buildChecklistItems(st, { mode: 'local_gpu' })).map((i) => i.fix.action);
    expect(fixes).toEqual(['repair-gpu-torch', 'repair-gpu-torch']);
  });

  it('遠端主機：設定好後要測試連線，連線結果反映在清單', () => {
    const st = { ffmpeg_ok: true, worker_ok: true, worker_url: 'https://gpu.example.com', mp4_files: ['a.mp4'] };
    const untested = buildChecklistItems(st, { mode: 'remote', cloudConsent: true });
    expect(labels(untested)).toContain('遠端主機（gpu.example.com）');
    expect(todo(untested).map((i) => i.fix.text)).toEqual(['測試連線']);
    const testing = buildChecklistItems(st, { mode: 'remote', cloudConsent: true, workerTesting: true });
    expect(todo(testing)[0].fix.text).toBe('測試中…');
    const ok = buildChecklistItems(st, {
      mode: 'remote',
      cloudConsent: true,
      workerHealth: { reachable: true, health: { gpu: 'RTX 5090', model: 'large-v3', gpu_available: true } },
    });
    expect(todo(ok)).toEqual([]);
  });

  it('沒有 MP4 時最後一項提示開啟 input 資料夾', () => {
    const items = buildChecklistItems({ ...READY_LOCAL, mp4_files: [] }, { mode: 'standard' });
    expect(todo(items).map((i) => i.fix.action)).toEqual(['open-input']);
  });
});

describe('local-transcribe-logic：為什麼還不能開始轉錄', () => {
  const ctx = (o = {}) => ({ mode: 'standard', selectedMp4: 'DEMO.mp4', ...o });

  it('本機模式全部就緒時回傳空字串', () => {
    expect(transcribeBlockReasonFor(READY_LOCAL, ctx())).toBe('');
  });

  it('依序檢查：沒選檔 → 檔案不在 → Python → ffmpeg', () => {
    expect(transcribeBlockReasonFor(READY_LOCAL, ctx({ selectedMp4: null }))).toContain('請先選擇');
    expect(transcribeBlockReasonFor(READY_LOCAL, ctx({ selectedMp4: 'old.mp4' }))).toContain('找不到 old.mp4');
    expect(transcribeBlockReasonFor({ ...READY_LOCAL, python_ok: false }, ctx())).toContain('Python');
    expect(transcribeBlockReasonFor({ ...READY_LOCAL, ffmpeg_ok: false }, ctx())).toContain('ffmpeg');
  });

  it('本機模式缺環境或 Token 時建議改用 Azure', () => {
    expect(transcribeBlockReasonFor({ ...READY_LOCAL, whisperx_ok: false }, ctx())).toContain('Azure');
    expect(transcribeBlockReasonFor({ ...READY_LOCAL, token_ok: false }, ctx())).toContain('HF_TOKEN');
  });

  it('Azure 與遠端主機都要知情同意；舊版助手不支援遠端', () => {
    const azure = { ...READY_LOCAL, azure_ok: true };
    expect(transcribeBlockReasonFor(azure, ctx({ mode: 'azure' }))).toContain('知情同意');
    expect(transcribeBlockReasonFor(azure, ctx({ mode: 'azure', cloudConsent: true }))).toBe('');
    const remote = { ...READY_LOCAL, worker_ok: true };
    expect(transcribeBlockReasonFor(remote, ctx({ mode: 'remote', cloudConsent: true }))).toContain('版本較舊');
    expect(transcribeBlockReasonFor(remote, ctx({ mode: 'remote', cloudConsent: true, supportsRemote: true }))).toBe('');
    expect(
      transcribeBlockReasonFor(remote, ctx({ mode: 'remote', cloudConsent: true, supportsRemote: true, workerHealth: { reachable: false, message: '逾時' } }))
    ).toBe('逾時');
  });

  it('本機 GPU：PyTorch 仍是 CPU 版時優先用助手回報的原因', () => {
    const st = { ...READY_LOCAL, cuda_torch_build: false, gpu_reason: 'torch 2.7 cpu' };
    expect(transcribeBlockReasonFor(st, ctx({ mode: 'local_gpu' }))).toBe('torch 2.7 cpu');
    expect(transcribeBlockReasonFor({ ...READY_LOCAL, cuda_torch_build: true, gpu_available: true }, ctx({ mode: 'local_gpu' }))).toBe('');
  });
});
