@echo off
REM Start the CS Assistant (Windows). Double-click this file.
cd /d "%~dp0"
if not exist .venv (
  echo First run: setting up, this takes a minute...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\pip install -q -r requirements.txt
)
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:8080"
.venv\Scripts\python app.py
pause
