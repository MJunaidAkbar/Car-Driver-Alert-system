@echo off
title DriverBlink - Eye Blink & Fatigue Monitor
echo Starting DriverBlink Server...
"%LOCALAPPDATA%\Programs\Python\Python314\python.exe" "%~dp0start_server.py"
pause
