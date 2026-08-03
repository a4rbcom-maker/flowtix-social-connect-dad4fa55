# FlowTix Dev Server — auto-restart script
# Usage: Right-click → Run with PowerShell, or run from terminal:
#   powershell -ExecutionPolicy Bypass -File "D:\Projects\FlowTix\dev-start.ps1"

$port = 5173
$projectDir = "D:\Projects\FlowTix"

# Kill any process already on the port
$existing = netstat -ano | Select-String ":$port " | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
foreach ($pid in $existing) {
    if ($pid) {
        try { Stop-Process -Id $pid -Force -ErrorAction Stop } catch {}
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting FlowTix on port $port..." -ForegroundColor Cyan
Set-Location $projectDir

while ($true) {
    $proc = Start-Process -FilePath "npm" -ArgumentList "run","dev" -PassThru -NoNewWindow
    Write-Host "Dev server PID: $($proc.Id)" -ForegroundColor Green
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
    Write-Host "Dev server stopped (exit code: $exitCode). Restarting in 3s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
