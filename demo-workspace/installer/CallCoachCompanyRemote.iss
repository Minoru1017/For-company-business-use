; Call Coach — company PC remote tools (Inno Setup 6)
; Build: iscc /DAppVersion=11.9.9 CallCoachCompanyRemote.iss

#ifndef AppVersion
#define AppVersion "11.9.9"
#endif

[Setup]
#ifdef SignBuild
SignTool=signtool
SignedUninstaller=yes
#endif
AppId={{B8C4D5E6-F7A8-4901-BCDE-F12345678901}
AppName=Call Coach 公司端遠端工具
AppVersion={#AppVersion}
AppPublisher=Call Coach
DefaultDirName={autopf}\CallCoachCompanyRemote
DisableDirPage=no
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=CallCoachCompanyRemote-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑（新竹遠端睡眠）"; GroupDescription: "其他選項:"; Flags: checkedonce

[Files]
Source: "..\dist\company-remote-payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\新竹遠端睡眠"; Filename: "{sys}\cmd.exe"; Parameters: "/c ""{app}\start_company_remote_sleep.cmd"""; WorkingDir: "{app}"; Comment: "透過 Tailscale 讓新竹主機睡眠（需新竹 host agent）"
Name: "{group}\使用說明（Tailscale + DeskIn）"; Filename: "{app}\REMOTE_HSINCHU.md"
Name: "{autodesktop}\新竹遠端睡眠"; Filename: "{sys}\cmd.exe"; Parameters: "/c ""{app}\start_company_remote_sleep.cmd"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\REMOTE_HSINCHU.md"; Description: "開啟使用說明"; Flags: shellexec postinstall skipifsilent unchecked

[Code]
procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel1.Caption := 'Call Coach 公司端遠端工具';
  WizardForm.WelcomeLabel2.Caption :=
    '此安裝包僅供公司電腦使用，不含 WhisperX 或轉錄引擎。' + #13#10 + #13#10 +
    '內容：' + #13#10 +
    '• 新竹遠端睡眠（Tailscale IP + Host Token）' + #13#10 +
    '• 說明文件（Tailscale、DeskIn、host agent）' + #13#10 + #13#10 +
    '新竹 GPU 主機請安裝「Call Coach 本機助手」，並執行 start_hsinchu_host_agent.cmd。';
end;
