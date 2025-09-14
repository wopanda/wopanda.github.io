@echo off
chcp 65001 > nul
echo "💡 正在生成最新的网站文件..."
hugo --cleanDestinationDir
echo "✅ 文件生成完毕！"

echo "🚀 正在发布到 GitHub Pages（覆盖远端根目录）..."
git add -A
git commit -m "%1"
rem 将 public 子目录作为独立子树推送到远端 main（仅包含站点构建产物）
git subtree split --prefix public -b pages-deploy
git push -f origin pages-deploy:main
git branch -D pages-deploy
echo "✅ 部署成功！"
