@echo off
REM Builds dist\UEH-WebSEM.exe: a self-contained Windows launcher that starts
REM the app locally and opens it in the default browser. No Python install
REM needed on the machine that runs the .exe — everything is bundled.
REM
REM Requires (on the machine doing the BUILD only): a Python venv with this
REM project's requirements.txt installed, plus pyinstaller (pip install pyinstaller).

setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Could not find .venv\Scripts\python.exe — create the venv and
  echo "pip install -r requirements.txt" first.
  exit /b 1
)

.venv\Scripts\python.exe -m PyInstaller ^
  --name UEH-WebSEM ^
  --onefile ^
  --console ^
  --noconfirm ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "sample_data;sample_data" ^
  --hidden-import semopy ^
  --collect-submodules semopy ^
  --collect-data semopy ^
  desktop_launcher.py

echo.
echo Done. The executable is at dist\UEH-WebSEM.exe
endlocal
