@echo off
chcp 65001 > nul
echo "💡 正在生成最新的网站文件..."
hugo
echo "✅ 文件生成完毕！"
git add .
git commit -m "%1"
git push
echo "✅ 部署成功！"
