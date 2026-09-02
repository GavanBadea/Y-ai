; ============================================================
;  setup.iss — Y-ai للمستودعات  v2.5.3
;  Inno Setup 6 — Arabic RTL — DPI Aware — Modern Style
;
;  قبل البناء: شغّل build-installer.bat أولاً
; ============================================================

#define MyAppName      "Y-ai للمستودعات"
#define MyAppNameSafe  "Y-ai-WMS"
#define MyAppVersion   "2.5.3"
#define MyAppPublisher "Gavan"
#define MyAppContact   "07504505340"
#define MyAppID        "{F3A8C9D2-7E1B-4F5A-8B3C-2A9D6E0F1234}"
#define SourceDir      "dist"

; ── ملفات الـ Wizard ──────────────────────────────────────
#define WizardSide   "assets\wizard-side.bmp"
#define WizardIcon   "assets\wizard-icon.bmp"
#define WizardHeader "assets\wizard-header.bmp"
#define AppIcon      "assets\Y-ai.ico"

; ============================================================
[Setup]
; ── الهوية ────────────────────────────────────────────────
AppId={{#MyAppID}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName}  v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppContact={#MyAppContact}
AppCopyright=جميع الحقوق محفوظة © 2024 {#MyAppPublisher}

; ── المسارات ──────────────────────────────────────────────
; نستخدم localappdata ليكون قابلاً للكتابة دائماً بدون صلاحيات مدير
DefaultDirName={localappdata}\{#MyAppNameSafe}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
AllowNoIcons=no

; ── الصلاحيات ─────────────────────────────────────────────
; lowest = لا يحتاج UAC — يعمل بحساب المستخدم العادي
PrivilegesRequired=lowest

; ── المخرجات ──────────────────────────────────────────────
OutputDir=output
OutputBaseFilename={#MyAppNameSafe}-Setup-v{#MyAppVersion}
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\Y-ai.ico
UninstallDisplayName={#MyAppName}

; ── الضغط ─────────────────────────────────────────────────
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

; ── الواجهة والمظهر ───────────────────────────────────────
WizardStyle=modern
WizardSizePercent=120
WizardResizable=no
WizardImageFile={#WizardSide}
WizardSmallImageFile={#WizardIcon}

; ── DPI Awareness — لوضوح عالي على جميع الشاشات ──────────
; Inno Setup 6 يدعم DPI تلقائياً مع WizardStyle=modern
; المانفستو مضمّن في الـ EXE تلقائياً

; ── إعدادات أخرى ──────────────────────────────────────────
ShowLanguageDialog=no
DisableWelcomePage=no
DisableDirPage=no
DisableReadyPage=no
DisableFinishedPage=no
AlwaysShowDirOnReadyPage=yes
AlwaysShowGroupOnReadyPage=yes

; ── Windows الحد الأدنى ───────────────────────────────────
MinVersion=10.0.17763

; ── تشفير Unicode الكامل ─────────────────────────────────
AppMutex={#MyAppNameSafe}_SingleInstance

; ============================================================
[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

; ============================================================
[CustomMessages]
arabic.AppIsRunning=البرنامج يعمل حالياً. أغلقه أولاً ثم أعد التثبيت.
arabic.CreatingDirs=إنشاء مجلدات البرنامج...
arabic.InstallingFiles=نسخ ملفات البرنامج...
arabic.InstallingRuntime=إعداد بيئة التشغيل...
arabic.FinalizingSetup=إنهاء الإعداد...
arabic.SetupComplete=اكتمل التثبيت بنجاح!

; ============================================================
[Messages]
arabic.WelcomeLabel1=مرحباً بك في معالج تثبيت%nY-ai للمستودعات
arabic.WelcomeLabel2=سيقوم هذا المعالج بتثبيت [name/ver] على جهازك.%n%n• البرنامج يعمل عبر المتصفح%n• لا يحتاج إنترنت بعد التثبيت%n• يمكن الوصول إليه من أجهزة الشبكة%n%nأغلق جميع البرامج الأخرى قبل المتابعة.
arabic.FinishedHeadingLabel=اكتمل تثبيت [name]
arabic.FinishedLabel=تم تثبيت [name] بنجاح على جهازك.%n%nانقر "إنهاء" لتشغيل البرنامج.
arabic.ClickFinish=انقر "إنهاء" لإغلاق المعالج.
arabic.SelectDirDesc=أين تريد تثبيت [name]؟
arabic.SelectDirLabel3=سيتم تثبيت [name] في المجلد التالي.%n%nللتغيير انقر "تصفح"، ثم انقر "التالي".
arabic.ReadyLabel1=المعالج جاهز لتثبيت [name] على جهازك.
arabic.ReadyLabel2a=انقر "تثبيت" للمتابعة، أو "رجوع" لمراجعة الإعدادات.
arabic.ButtonInstall=تثبيت
arabic.ButtonNext=التالي >
arabic.ButtonBack=< رجوع
arabic.ButtonCancel=إلغاء
arabic.ButtonFinish=إنهاء
arabic.InstallingLabel=يرجى الانتظار أثناء تثبيت [name] على جهازك...
arabic.UninstallAppFullTitle=إلغاء تثبيت %1

; ============================================================
[Tasks]
Name: "desktopicon";  Description: "إنشاء اختصار على سطح المكتب";     GroupDescription: "اختصارات إضافية:"; Flags: checkedonce
Name: "startmenu";    Description: "إضافة البرنامج لقائمة ابدأ";       GroupDescription: "اختصارات إضافية:"; Flags: checkedonce
Name: "autostart";    Description: "تشغيل البرنامج تلقائياً مع Windows"; GroupDescription: "خيارات التشغيل:";  Flags: unchecked

; ============================================================
[Dirs]
; مجلدات البيانات — تُحفظ عند إلغاء التثبيت وإعادة التثبيت
Name: "{app}\data";    Flags: uninsneveruninstall
Name: "{app}\uploads"; Flags: uninsneveruninstall
Name: "{app}\backups"; Flags: uninsneveruninstall

; ============================================================
[Files]
; ── ملفات التطبيق ─────────────────────────────────────────
Source: "{#SourceDir}\app\*"; \
  DestDir: "{app}\app"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; ── Node.js Runtime ──────────────────────────────────────
Source: "{#SourceDir}\runtime\node\*"; \
  DestDir: "{app}\runtime\node"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; ── Python Runtime ────────────────────────────────────────
Source: "{#SourceDir}\runtime\python\*"; \
  DestDir: "{app}\runtime\python"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; ── ملفات التشغيل ─────────────────────────────────────────
Source: "{#SourceDir}\launcher.bat";        DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\stop.bat";            DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\allow-network.bat";   DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\check-yai.bat";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\check-yai.ps1";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\setup-ollama.bat";    DestDir: "{app}"; Flags: ignoreversion
Source: "fix-database.bat";                 DestDir: "{app}"; Flags: ignoreversion
Source: "Y-ai-launcher.vbs";                DestDir: "{app}"; Flags: ignoreversion

; ── الأيقونة ─────────────────────────────────────────────
Source: "assets\Y-ai.ico"; DestDir: "{app}"; Flags: ignoreversion

; ── قاعدة بيانات القالب — تُنسخ إلى data\ عند التشغيل الأول ──
Source: "{#SourceDir}\warehouse_template.db"; \
  DestDir: "{app}"; \
  Flags: ignoreversion

; ============================================================
[Icons]
; ── سطح المكتب (VBS = بدون نافذة سوداء) ─────────────────
Name: "{autodesktop}\{#MyAppName}"; \
  Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\Y-ai-launcher.vbs"""; \
  IconFilename: "{app}\Y-ai.ico"; \
  Comment: "تشغيل Y-ai للمستودعات"; \
  Tasks: desktopicon

; ── قائمة ابدأ ────────────────────────────────────────────
Name: "{group}\{#MyAppName}"; \
  Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\Y-ai-launcher.vbs"""; \
  IconFilename: "{app}\Y-ai.ico"; \
  Comment: "تشغيل Y-ai للمستودعات"; \
  Tasks: startmenu

Name: "{group}\إيقاف البرنامج"; \
  Filename: "{app}\stop.bat"; \
  IconFilename: "{app}\Y-ai.ico"; \
  Tasks: startmenu

Name: "{group}\فتح الشبكة المحلية"; \
  Filename: "{app}\allow-network.bat"; \
  IconFilename: "{app}\Y-ai.ico"; \
  Comment: "السماح بالدخول من أجهزة أخرى على نفس الواي فاي"; \
  Tasks: startmenu

Name: "{group}\إلغاء التثبيت"; \
  Filename: "{uninstallexe}"; \
  IconFilename: "{app}\Y-ai.ico"; \
  Tasks: startmenu

; ── تشغيل تلقائي مع Windows (بدون نافذة) ────────────────
Name: "{autostartup}\{#MyAppName}"; \
  Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\Y-ai-launcher.vbs"""; \
  IconFilename: "{app}\Y-ai.ico"; \
  Tasks: autostart

; ============================================================
[Registry]
; نستخدم HKCU بدل HKLM لأننا نثبّت بدون صلاحيات مدير
Root: HKCU; \
  Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#MyAppNameSafe}"; \
  ValueType: string; ValueName: "DisplayIcon"; \
  ValueData: "{app}\Y-ai.ico"; \
  Flags: uninsdeletekey

Root: HKCU; \
  Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#MyAppNameSafe}"; \
  ValueType: string; ValueName: "Publisher"; \
  ValueData: "{#MyAppPublisher} — {#MyAppContact}"; \
  Flags: uninsdeletekey

Root: HKCU; \
  Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#MyAppNameSafe}"; \
  ValueType: string; ValueName: "URLInfoAbout"; \
  ValueData: "http://localhost:3000"; \
  Flags: uninsdeletekey

; ── حفظ مسار التثبيت ─────────────────────────────────────
Root: HKCU; \
  Subkey: "Software\{#MyAppNameSafe}"; \
  ValueType: string; ValueName: "InstallPath"; \
  ValueData: "{app}"; \
  Flags: uninsdeletekey

; ============================================================
[Run]
; ── تشغيل البرنامج بعد التثبيت (بدون نافذة سوداء) ────────
Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\Y-ai-launcher.vbs"""; \
  Description: "تشغيل {#MyAppName} الآن وفتح المتصفح"; \
  Flags: nowait postinstall skipifsilent unchecked

; ============================================================
[UninstallRun]
; ── إيقاف الخادم قبل الحذف ────────────────────────────────
Filename: "{app}\stop.bat"; Flags: runhidden; RunOnceId: "StopServer"

; ============================================================
[UninstallDelete]
; ── حذف الملفات المؤقتة (مع الإبقاء على قاعدة البيانات) ──
Type: files; Name: "{app}\app\*.log"

; ============================================================
[Code]

// ── فحص إذا كان البرنامج يعمل قبل التثبيت ────────────────
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // إيقاف الخادم إن كان يعمل
  Exec(ExpandConstant('{sys}\cmd.exe'),
    '/c for /f "tokens=5" %a in (''netstat -aon ^| findstr ":3000 "'') do taskkill /f /pid %a',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;

// ── إعداد عنوان النافذة ────────────────────────────────────
procedure InitializeWizard();
begin
  WizardForm.Caption := 'تثبيت ' + '{#MyAppName}' + '  v{#MyAppVersion}';
  WizardForm.NextButton.Caption   := 'التالي  >';
  WizardForm.BackButton.Caption   := '<  رجوع';
  WizardForm.CancelButton.Caption := 'إلغاء';
  // ملاحظة: FinishButton غير موجود — NextButton يصبح "إنهاء" في الصفحة الأخيرة تلقائياً
end;

// ── رسالة اكتمال مخصصة ────────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  NodePath, AppPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppPath  := ExpandConstant('{app}');
    NodePath := AppPath + '\runtime\node\node.exe';

    // التحقق من وجود Node.js
    if not FileExists(NodePath) then
    begin
      MsgBox(
        'تحذير: لم يُعثر على Node.js في مجلد runtime.' + #13#10 +
        'قد لا يعمل البرنامج بشكل صحيح.' + #13#10 + #13#10 +
        'تأكد من تشغيل build-installer.bat قبل البناء.',
        mbError, MB_OK);
    end;
  end;
end;

// ── صفحة الانتهاء — معلومات مفيدة ────────────────────────
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  S: String;
begin
  S := '';
  S := S + 'مجلد التثبيت:' + NewLine + Space + MemoDirInfo + NewLine + NewLine;
  S := S + 'بعد التثبيت:' + NewLine;
  S := S + Space + '• سيفتح البرنامج في المتصفح على http://localhost:3000' + NewLine;
  S := S + Space + '• للدخول من جهاز آخر: http://IP_الجهاز:3000 (شغّل allow-network.bat إن لزم)' + NewLine;
  S := S + Space + '• عند أول تشغيل ستحتاج تفعيل الترخيص' + NewLine;
  S := S + Space + '• تواصل مع المبرمج: Gavan  07504505340' + NewLine;
  if MemoTasksInfo <> '' then
    S := S + NewLine + 'المهام المختارة:' + NewLine + Space + MemoTasksInfo + NewLine;
  Result := S;
end;
