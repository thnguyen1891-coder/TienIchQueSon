@echo off
rem Bam dup file nay 1 lan tren moi may de bat TU DONG CAP NHAT tien ich.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CaiDat_TuDongCapNhat.ps1" %*
echo.
pause
