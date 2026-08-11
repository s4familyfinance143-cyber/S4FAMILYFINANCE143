#define MyAppName "S4 FAMILY FINANCE 143"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "S4"
#define StageDir "S:\S4-FAMILY-FINANCE-143-FINAL\WINDOWS_INSTALLER_CLEAN_STAGE_V5_20260708-142414"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\S4 FAMILY FINANCE 143
DefaultGroupName=S4 FAMILY FINANCE 143
OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup-CLEAN-V6
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=S4 FAMILY FINANCE 143
PrivilegesRequired=lowest

[Files]
Source: "{#StageDir}\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\deploy\windows\*"; DestDir: "{app}\deploy\windows"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Run Backend Local SQLite"; Filename: "{app}\deploy\windows\02_run_backend_local_sqlite.bat"
Name: "{group}\Run Frontend Preview"; Filename: "{app}\deploy\windows\04_run_frontend_preview.bat"
Name: "{group}\Production Env Example"; Filename: "{app}\backend\.env.production.example"

[Run]
Filename: "{app}\deploy\windows\01_install_backend_dependencies.bat"; Description: "Install backend dependencies"; Flags: postinstall skipifsilent

