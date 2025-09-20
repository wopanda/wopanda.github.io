@echo off
set "MSG=%~1"
if "%MSG%"=="" set "MSG=update"

echo Syncing data folder...
xcopy /E /Y /I data\* static\data\ > nul
echo Data sync done.

echo Building site...
hugo --cleanDestinationDir
echo Build done.

echo Copying public to repo root...
xcopy /E /Y /I public\* . > nul

echo Creating .nojekyll...
echo.> .nojekyll

echo Committing and pushing...
git add -A
git commit -m "%MSG%"
git push
echo Deploy success.