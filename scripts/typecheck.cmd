@echo off
setlocal

set "ROOT=%~dp0.."
set "PATH=%ROOT%\.tools\pnpm;%ROOT%\node_modules\.bin;%PATH%"

node "%ROOT%\node_modules\typescript\bin\tsc" --build
if errorlevel 1 exit /b %errorlevel%

if exist "%ROOT%\.tools\pnpm\pnpm.exe" (
  "%ROOT%\.tools\pnpm\pnpm.exe" -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck
) else (
  pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck
)

exit /b %errorlevel%
