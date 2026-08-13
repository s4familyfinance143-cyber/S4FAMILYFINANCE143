@echo off
:: Run as Administrator — allow phone Wi-Fi to reach Docker API on port 8000
netsh advfirewall firewall delete rule name="S4 Family Finance API 8000" >nul 2>&1
netsh advfirewall firewall add rule name="S4 Family Finance API 8000" dir=in action=allow protocol=TCP localport=8000
echo.
echo Firewall rule added for TCP 8000.
echo Phone API URL: http://192.168.13.248:8000
echo.
pause
