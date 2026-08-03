@echo off
echo Starting FlowTix...
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:3100
start "FlowTix-Frontend" /min cmd /c "cd D:\Projects\FlowTix && npm run dev"
start "FlowTix-Backend" /min cmd /c "cd D:\Projects\FlowTix\extraction-service && npm run dev"
echo Both services started in background.
echo To stop: close the FlowTix-Frontend and FlowTix-Backend windows from taskbar.
pause