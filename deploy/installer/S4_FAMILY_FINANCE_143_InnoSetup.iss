#define MyAppName "S4 FAMILY FINANCE 143"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "S4"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\S4 FAMILY FINANCE 143
DefaultGroupName=S4 FAMILY FINANCE 143
OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\..\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs ignoreversion; Excludes: ".venv\*,__pycache__\*,*.db,*.log,node_modules\*"
Source: "..\..\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs ignoreversion
Source: "..\windows\*"; DestDir: "{app}\deploy\windows"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Run Backend Local SQLite"; Filename: "{app}\deploy\windows\02_run_backend_local_sqlite.bat"
Name: "{group}\Run Frontend Preview"; Filename: "{app}\deploy\windows\04_run_frontend_preview.bat"
Name: "{group}\Production Env Example"; Filename: "{app}\backend\.env.production.example"

[Run]
Filename: "{app}\deploy\windows\01_install_backend_dependencies.bat"; Description: "Install backend dependencies"; Flags: postinstall skipifsilent
