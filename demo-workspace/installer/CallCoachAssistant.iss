; Call Coach Assistant — Windows installer (Inno Setup 6)
; Build: iscc /DAppVersion=11.1.1 CallCoachAssistant.iss

#ifndef AppVersion
#define AppVersion "11.1.1"
#endif

[Setup]
AppId={{A7B3C4D5-E6F7-4890-ABCD-EF1234567890}
AppName=Call Coach 本機助手
AppVersion={#AppVersion}
AppPublisher=Call Coach
DefaultDirName=C:\CallCoachAssistant
DisableDirPage=no
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=CallCoachAssistant-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\CallCoachAssistant.exe

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑"; GroupDescription: "其他選項:"; Flags: checkedonce

[Files]
Source: "..\dist\installer-payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Call Coach 本機助手"; Filename: "{app}\CallCoachAssistant.exe"; Comment: "Call Coach DEMO 本機轉錄"
Name: "{autodesktop}\Call Coach 本機助手"; Filename: "{app}\CallCoachAssistant.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\CallCoachAssistant.exe"; Description: "啟動 Call Coach 本機助手"; Flags: nowait postinstall skipifsilent

[Code]
var
  SetupEnvOk: Boolean;

procedure InitializeWizard();
begin
  SetupEnvOk := False;
  WizardForm.WelcomeLabel1.Caption := '歡迎使用 Call Coach 本機助手安裝精靈';
  WizardForm.WelcomeLabel2.Caption :=
    '此精靈將安裝 Call Coach 本機轉錄助手到您的電腦。' + #13#10 + #13#10 +
    '建議使用預設安裝位置 C:\CallCoachAssistant（避免中文使用者名稱路徑問題）。' + #13#10 + #13#10 +
    '安裝過程會自動準備 ffmpeg 與 WhisperX（需下載約 1～3 GB），請保持網路連線。' + #13#10 + #13#10 +
    '安裝完成後，請在 Call Coach 網頁的 DEMO 模式貼上 Hugging Face Token 即可開始轉錄。';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  WizardForm.StatusLabel.Caption := '正在安裝 WhisperX 轉錄環境（約 5～15 分鐘，請保持網路連線）...';
  WizardForm.ProgressGauge.Style := npbstMarquee;

  if Exec(
    ExpandConstant('{app}\runtime\python\python.exe'),
    ExpandConstant('"{app}\installer\setup_env.py"'),
    ExpandConstant('{app}'),
    SW_SHOW,
    ewWaitUntilTerminated,
    ResultCode) then
  begin
    SetupEnvOk := (ResultCode = 0);
    if not SetupEnvOk then
      MsgBox(
        '轉錄環境安裝未成功（常見原因：公司網路封鎖下載）。' + #13#10 + #13#10 +
        '請安裝完成後從開始選單啟動「Call Coach 本機助手」，' + #13#10 +
        '按「安裝／修復轉錄環境」重試。' + #13#10 + #13#10 +
        '日誌：' + ExpandConstant('{app}\logs\install-setup.log'),
        mbError, MB_OK);
  end else
  begin
    SetupEnvOk := False;
    MsgBox('無法啟動轉錄環境安裝程序。', mbError, MB_OK);
  end;

  WizardForm.ProgressGauge.Style := npbstNormal;
end;
