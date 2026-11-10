; ============================================================
; Durchblick - Windows-Installer (Inno Setup 6)
; ------------------------------------------------------------
; Erzeugt Durchblick-Setup-<Version>.exe aus dist\Durchblick
; (vorher: pyinstaller installer\durchblick.spec --noconfirm)
;
;   iscc /DAppVersion=2.1 installer\durchblick.iss
;
; - Installation pro Benutzer, KEINE Admin-Rechte nötig
;   (nach %LOCALAPPDATA%\Programs\Durchblick)
; - Config und eigene Gestaltung liegen in Dokumente\Durchblick
;   und bleiben bei Updates und Deinstallation erhalten
; ============================================================

#ifndef AppVersion
  #define AppVersion "2.1"
#endif

[Setup]
AppId={{A59EFC4B-7ADB-4443-8719-620EF2A73B18}
AppName=Durchblick
AppVersion={#AppVersion}
AppVerName=Durchblick {#AppVersion}
AppPublisher=Durchblick · Modul 141
AppPublisherURL=https://github.com/vonam-git/durchblick
AppSupportURL=https://github.com/vonam-git/durchblick/blob/main/docs/HILFE.md
DefaultDirName={autopf}\Durchblick
DefaultGroupName=Durchblick
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=Durchblick-Setup-{#AppVersion}
SetupIconFile=durchblick.ico
UninstallDisplayIcon={app}\Durchblick.exe
UninstallDisplayName=Durchblick {#AppVersion}
LicenseFile=..\LICENSE
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Durchblick Installer

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Verknüpfung auf dem Desktop erstellen"; GroupDescription: "Zusätzliche Verknüpfungen:"

[Files]
Source: "..\dist\Durchblick\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Durchblick"; Filename: "{app}\Durchblick.exe"; Comment: "Durchblick Control Panel starten"
Name: "{group}\Durchblick-Ordner (Config und Design)"; Filename: "{userdocs}\Durchblick"
Name: "{group}\Anleitung"; Filename: "{userdocs}\Durchblick\docs\ANLEITUNG.md"
Name: "{group}\Durchblick deinstallieren"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Durchblick"; Filename: "{app}\Durchblick.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Durchblick.exe"; Description: "Durchblick jetzt starten"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Laufenden Webserver beenden, damit die Deinstallation alle Dateien entfernen kann
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM durchblick-server.exe"; Flags: runhidden; RunOnceId: "StopServer"

[Messages]
de.WelcomeLabel2=Dieses Programm installiert [name/ver] auf deinem Computer.%n%nPython und alle Module sind bereits enthalten. Es werden keine Admin-Rechte benötigt.%n%nDeine Config und deine eigene Gestaltung findest du nach dem ersten Start im Ordner «Dokumente\Durchblick».
de.FinishedLabel=Durchblick wurde installiert. Du findest es im Startmenü%nund – falls gewählt – auf dem Desktop.
