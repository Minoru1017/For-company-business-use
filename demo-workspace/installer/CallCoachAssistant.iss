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
Filename: "{app}\runtime\python\python.exe"; Parameters: """{app}\installer\setup_env.py"""; StatusMsg: "正在安裝 WhisperX 轉錄環境（約 5～15 分鐘，請保持網路連線）..."; Flags: waituntilterminated; Description: "準備轉錄環境（WhisperX）"
Filename: "{app}\CallCoachAssistant.exe"; Description: "啟動 Call Coach 本機助手"; Flags: nowait postinstall skipifsilent

[Code]
procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel1.Caption := '歡迎使用 Call Coach 本機助手安裝精靈';
  WizardForm.WelcomeLabel2.Caption :=
    '此精靈將安裝 Call Coach 本機轉錄助手到您的電腦。' + #13#10 + #13#10 +
    '建議使用預設安裝位置 C:\CallCoachAssistant（避免中文使用者名稱路徑問題）。' + #13#10 + #13#10 +
    '安裝過程會自動準備 ffmpeg 與 WhisperX（需下載約 1～3 GB），請保持網路連線。' + #13#10 + #13#10 +
    '安裝完成後，請在 Call Coach 網頁的 DEMO 模式貼上 Hugging Face Token 即可開始轉錄。';
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
