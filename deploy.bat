@echo off
chcp 65001 > nul
echo Building site...
hugo --cleanDestinationDir
echo Build done.

echo Copying public/* to repo root...
xcopy /E /Y /I public\* . > nul

echo Creating .nojekyll...
echo.> .nojekyll

echo Committing and pushing...
git add -A
git commit -m "%1"
git push
echo Deploy success.
