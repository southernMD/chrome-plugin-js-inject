@echo off
echo Unregistering Native Host...

:: Delete registry key
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.wise.chrome_plugin_host" /f >nul 2>&1

:: Delete manifest file
del "%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.wise.chrome_plugin_host.json" /f /q >nul 2>&1

echo Native host successfully unregistered.
pause
