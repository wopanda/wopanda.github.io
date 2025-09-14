@echo off
chcp 65001 > nul
echo "💡 正在生成最新的网站文件..."
hugo --cleanDestinationDir
echo "✅ 文件生成完毕！"

echo "📦 正在将 public 生成内容复制到仓库根目录..."
xcopy /E /Y /I public\* . > nul

echo "🚀 正在提交并推送到远端..."
git add -A
git commit -m "%1"
git push
echo "✅ 部署成功！"
