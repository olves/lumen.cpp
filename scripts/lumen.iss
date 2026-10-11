; Inno Setup script for lumen.cpp Beta (compiled by scripts\release.ps1).
;   iscc /DSourceDir=<portable folder> /DAppVersion=0.1.0-beta.N /DBuild=N /DOutputDir=<folder> lumen.iss
; Per-user install (no administrator rights) into %LOCALAPPDATA%\Programs\lumen.cpp, so Lumen can update itself.
; User data (%LOCALAPPDATA%\lumen.cpp: chats, models, settings) is never part of the install and is kept on uninstall
; unless the user explicitly chooses to remove it.

#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0-beta.0"
#endif
#ifndef Build
  #define Build "0"
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{D07F95B4-B9ED-4405-A43A-E3C97A4C7453}
AppName=lumen.cpp
AppVersion={#AppVersion}
AppVerName=lumen.cpp Beta (build {#Build})
AppPublisher=olves
AppPublisherURL=https://github.com/olves/lumen.cpp
AppSupportURL=https://github.com/olves/lumen.cpp/issues
AppUpdatesURL=https://github.com/olves/lumen.cpp/releases
VersionInfoVersion=0.1.0.{#Build}
VersionInfoProductName=lumen.cpp Beta
DefaultDirName={localappdata}\Programs\lumen.cpp
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=lumen-beta-setup
SetupIconFile={#SourceDir}\resources\app\lumen.ico
UninstallDisplayIcon={app}\lumen.cpp.exe
UninstallDisplayName=lumen.cpp Beta
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ShowLanguageDialog=auto

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[CustomMessages]
english.NeedsDotNet=Lumen needs .NET Framework 4.8, which is part of current Windows 10 and 11. Install it from Windows Update or microsoft.com, then run this setup again.
turkish.NeedsDotNet=Lumen için .NET Framework 4.8 gerekir; güncel Windows 10 ve 11'de zaten vardır. Windows Update veya microsoft.com üzerinden kurup bu kurulumu yeniden çalıştırın.
english.RemoveData=Also delete your Lumen chats, downloaded models and settings?%n%n%1%n%nChoose No to keep them (recommended if you may reinstall).
turkish.RemoveData=Lumen sohbetlerin, indirilen modeller ve ayarlar da silinsin mi?%n%n%1%n%nSaklamak için Hayır'ı seç (yeniden kurabileceksen önerilir).
english.DesktopIcon=Create a desktop shortcut
turkish.DesktopIcon=Masaüstü kısayolu oluştur

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; An update replaces the app files completely, so files removed in a newer build do not linger.
Type: filesandordirs; Name: "{app}\resources\app"
Type: filesandordirs; Name: "{app}\locales"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "debug.log,ui-check.cjs"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\lumen.cpp"; Filename: "{app}\lumen.cpp.exe"
Name: "{autodesktop}\lumen.cpp"; Filename: "{app}\lumen.cpp.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\lumen.cpp.exe"; Description: "{cm:LaunchProgram,lumen.cpp}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
var
  Release: Cardinal;
begin
  Result := True;
  if not RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) or (Release < 528040) then
  begin
    SuppressibleMsgBox(CustomMessage('NeedsDotNet'), mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  // Only an explicit Yes in an interactive uninstall removes user data; silent uninstalls never do.
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
  begin
    DataDir := ExpandConstant('{localappdata}\lumen.cpp');
    if DirExists(DataDir) then
      if MsgBox(FmtMessage(CustomMessage('RemoveData'), [DataDir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
