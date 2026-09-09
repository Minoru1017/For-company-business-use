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
Name: "whisperx"; Description: "安裝本機 WhisperX 轉錄環境（下載約 1～3 GB，5～15 分鐘；若團隊已提供 Azure 設定可略過，之後可在網頁按「完整環境安裝」補裝）"; GroupDescription: "轉錄引擎:"
Name: "desktopicon"; Description: "建立桌面捷徑"; GroupDescription: "其他選項:"; Flags: checkedonce

[Files]
Source: "..\dist\installer-payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Admins can drop team-config.env next to Setup.exe; it is copied in and applied on first launch.
Source: "{src}\team-config.env"; DestDir: "{app}"; Flags: external skipifsourcedoesntexist ignoreversion

[Icons]
Name: "{group}\Call Coach 本機助手"; Filename: "{app}\CallCoachAssistant.exe"; Comment: "Call Coach DEMO 本機轉錄"
Name: "{autodesktop}\Call Coach 本機助手"; Filename: "{app}\CallCoachAssistant.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\runtime\python\python.exe"; Parameters: """{app}\installer\setup_env.py"""; StatusMsg: "正在安裝 WhisperX 轉錄環境（約 5～15 分鐘，請保持網路連線）..."; Flags: waituntilterminated; Description: "準備轉錄環境（WhisperX）"; Tasks: whisperx
Filename: "{app}\CallCoachAssistant.exe"; Description: "啟動 Call Coach 本機助手"; Flags: nowait postinstall skipifsilent

[Code]
function TeamConfigPresent(): Boolean;
begin
  Result := FileExists(ExpandConstant('{src}\team-config.env'));
end;

procedure InitializeWizard();
var
  EngineNote: String;
begin
  if TeamConfigPresent() then
    EngineNote := '已偵測到 team-config.env（團隊設定）：安裝後即可直接使用 Azure 雲端轉錄，不需下載 WhisperX、不需 Hugging Face Token。'
  else
    EngineNote := '可選擇安裝本機 WhisperX（需下載約 1～3 GB）；或安裝後在網頁填入 Azure 金鑰使用雲端轉錄（免下載）。';
  WizardForm.WelcomeLabel1.Caption := '歡迎使用 Call Coach 本機助手安裝精靈';
  WizardForm.WelcomeLabel2.Caption :=
    '此精靈將安裝 Call Coach 本機轉錄助手到您的電腦。' + #13#10 + #13#10 +
    '建議使用預設安裝位置 C:\CallCoachAssistant（避免中文使用者名稱路徑問題）。' + #13#10 + #13#10 +
    EngineNote + #13#10 + #13#10 +
    '安裝完成後，助手會自動開啟 Call Coach 網頁；首次啟動檢查清單會告訴您還缺什麼。';
end;

procedure CurPageChanged(CurPageID: Integer);
var
  I: Integer;
begin
  if (CurPageID = wpSelectTasks) and TeamConfigPresent() then
  begin
    for I := 0 to WizardForm.TasksList.Items.Count - 1 do
      if Pos('WhisperX', WizardForm.TasksList.ItemCaption[I]) > 0 then
        WizardForm.TasksList.Checked[I] := False;
  end;
end;

function InitializeSetup(): Boolean;
var
  SacState: Cardinal;
begin
  Result := True;
  if RegQueryDWordValue(HKLM, 'SYSTEM\CurrentControlSet\Control\CI\Policy',
                        'VerifiedAndReputablePolicyState', SacState) then
  begin
    if (SacState = 1) or (SacState = 2) then
    begin
      MsgBox('偵測到 Windows Smart App Control 已開啟（或處於評估模式）。' + #13#10 + #13#10 +
             'Smart App Control 會封鎖未簽章的程式，本機轉錄（WhisperX / ffmpeg）可能無法執行。' + #13#10 + #13#10 +
             '建議：安裝完成後改用「Azure 雲端轉錄」模式，或請 IT 關閉 Smart App Control' + #13#10 +
             '（Windows 安全性 → 應用程式與瀏覽器控制 → Smart App Control 設定）。' + #13#10 + #13#10 +
             '注意：Smart App Control 關閉後無法再開啟。',
             mbInformation, MB_OK);
    end;
  end;
end;
