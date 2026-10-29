@echo off
rem Play the current top-ranked combos in Slippi Dolphin (double-click, or: play_top.bat 50).
cd /d "%~dp0"
set N=%1
if "%N%"=="" set N=20
python top.py %N% || (pause & exit /b 1)
call "%~dp0play.bat" out\queue_top.json
