@echo off
echo Stopping FlowTix services...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173"') do (
    taskkill /F /PID %%a 2>nul
    echo Stopped process on port 5173
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3100"') do (
    taskkill /F /PID %%a 2>nul
    echo Stopped process on port 3100
)

echo Done.
pause