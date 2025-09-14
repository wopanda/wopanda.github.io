@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

rem 提交信息优先级：1) 命令行参数 2) 发布文本.txt 第一行 3) 时间戳
set "MSG=%~1"
if "!MSG!"=="" (
  if exist "发布文本.txt" (
    for /f "usebackq delims=" %%A in ("发布文本.txt") do (
      if "!MSG!"=="" if not "%%A"=="" set "MSG=%%A"
    )
  )
)
if "!MSG!"=="" (
  for /f "tokens=1-4 delims=/-:. " %%a in ("%date% %time%") do set "TS=%%a-%%b-%%c_%%d"
  set "MSG=自动发布-!TS!"
)
echo Building site...
hugo --cleanDestinationDir
echo Build done.

echo Copying public/* to repo root...
xcopy /E /Y /I public\* . > nul

echo Creating .nojekyll...
echo.> .nojekyll

echo Committing and pushing...
git add -A
git commit -m "!MSG!"
git push
echo Deploy success.
