@echo off
rem Tat tu dong cap nhat tren may nay (xoa tac vu hen gio). Tien ich van giu nguyen.
schtasks.exe /Delete /F /TN TienIchQueSon_CapNhat
schtasks.exe /Delete /F /TN TienIchQueSon_CapNhat_DangNhap 2>nul
echo Da tat tu dong cap nhat.
pause
