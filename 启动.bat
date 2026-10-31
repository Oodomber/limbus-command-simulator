@echo off
REM 控制台默认代码页是 936(GBK)，而 Node/Electron 输出的是 UTF-8，
REM 不切换就会整屏乱码（例如「鑷姩鎺ㄨ繘」）。切到 65001 就能正常显示中文。
chcp 65001 >nul
REM 让控制台按 UTF-8 解析，避免中文标签页标题乱码
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo 正在启动 谨遵指令...
npm start
pause
