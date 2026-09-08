; Call Coach Assistant — Windows installer (Inno Setup 6)
; Build: iscc /DAppVersion=11.1.0 CallCoachAssistant.iss

#ifndef AppVersion
#define AppVersion "11.1.0"
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
Name: "chinesetrad"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"

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

[Messages]
chinesetrad.WelcomeLabel2=此精靈將安裝 [name] 到您的電腦。%n%n建議使用預設安裝位置 %1（避免中文使用者名稱路徑問題）。%n%n安裝過程會自動準備 ffmpeg 與 WhisperX（需下載約 1～3 GB），請保持網路連線。%n%n安裝完成後，請在 Call Coach 網頁的 DEMO 模式貼上 Hugging Face Token 即可開始轉錄。

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
