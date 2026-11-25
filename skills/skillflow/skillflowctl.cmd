@echo off
rem skillflowctl for Windows: the SkillFlow CLI for a person; "skillflowctl help" lists the commands.
setlocal
set "SKILLFLOW_PROG=skillflowctl"
node "%~dp0scripts/skillflow.mjs" %*
exit /b %ERRORLEVEL%
