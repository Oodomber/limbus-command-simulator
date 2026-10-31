@echo off
chcp 65001 >nul
cd /d "%~dp0"
title LimBus Command
echo Starting...
npm start
pause
