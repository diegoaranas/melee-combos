@echo off
rem Play a queue of replay segments in Slippi's playback Dolphin.
rem Usage: play.bat out\queue_clipped.json
"%APPDATA%\Slippi Launcher\playback\Slippi Dolphin.exe" -i "%~f1" -e "C:\Games\GC and Wii\Melee v1.02\GALE01\game.iso"
