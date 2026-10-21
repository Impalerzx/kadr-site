@echo off
setlocal
cd /d "%~dp0"
echo Open http://localhost:8080 in your browser.
echo Keep this window open. Press Ctrl+C to stop.
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 8080 --bind 127.0.0.1
  goto end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m http.server 8080 --bind 127.0.0.1
  goto end
)
python -m http.server 8080 --bind 127.0.0.1
:end
pause
