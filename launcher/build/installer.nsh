; Nettoyage supplémentaire à la désinstallation.
; - deleteAppDataOnUninstall (package.json) supprime déjà %APPDATA%\Yuza Launcher
;   et %LOCALAPPDATA%\Yuza Launcher.
; - Ici on retire l'entrée de démarrage automatique posée par l'app au runtime.

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "YuzaLauncher"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Yuza Launcher"
!macroend
