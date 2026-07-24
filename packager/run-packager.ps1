# Persistent launcher for the IntuneGet local packager, run via Windows Task
# Scheduler (task "IntuneGetPackager"). Logs to logs\packager.log; exits with
# the node process's code so Task Scheduler's failure-restart policy applies.
Set-Location -Path 'C:\IntuneGet\packager'

if (-not (Test-Path 'logs')) {
    New-Item -ItemType Directory -Path 'logs' | Out-Null
}

$logFile = Join-Path 'logs' 'packager.log'
"[$(Get-Date -Format o)] Starting packager" | Out-File -FilePath $logFile -Append -Encoding utf8

# Use cmd's native redirection (not PowerShell's *>>) so node's UTF-8 stdout
# reaches the file untouched instead of being re-encoded as UTF-16.
& cmd /c "node dist/index.js --verbose >> logs\packager.log 2>&1"
exit $LASTEXITCODE
