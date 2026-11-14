@echo off
rem Play a queue of replay segments in Slippi's playback Dolphin.
rem Usage: play.bat out\queue_clipped.json
cd /d "%~dp0"
node -e "const c=require('./config').load();require('child_process').spawn(c.dolphin,['-i',process.argv[1],'-e',c.iso],{detached:true,stdio:'ignore'}).unref()" "%~f1"
