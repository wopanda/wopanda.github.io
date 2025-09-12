@echo off
chcp 65001 > nul
git add .
git commit -m "%1"
git push
echo "✅ 部署成功！"
