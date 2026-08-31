# Diagnostic pentru fereastra de administrator.
# Ruleaza asta in fereastra in care ai rulat comanda de inregistrare.
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ''
Write-Host '=== fereastra aceasta ===' -ForegroundColor Cyan
Write-Host "  user            : $($id.Name)"
Write-Host "  ELEVAT          : $elevated" -ForegroundColor $(if ($elevated) { 'Green' } else { 'Red' })
Write-Host "  integrity level : $(
    ($id.Claims | Where-Object { $_.Type -match 'integritylevel' }).Value
)"

if (-not $elevated) {
    Write-Host ''
    Write-Host '  Fereastra NU este elevata. Deschide: Win+X -> Terminal (Administrator)' -ForegroundColor Yellow
    Write-Host '  Titlul ferestrei trebuie sa contina "Administrator".' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host '=== incerc inregistrarea, cu eroarea completa ===' -ForegroundColor Cyan
try {
    & 'E:\gh\vmui\scripts\elevated-maintenance.ps1' -Register
    Write-Host ''
    Write-Host "  exit code: $LASTEXITCODE"
}
catch {
    Write-Host "  EXCEPTIE: $($_.Exception.GetType().Name)" -ForegroundColor Red
    Write-Host "  mesaj   : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  la      : $($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)"
}

Write-Host ''
Write-Host '=== rezultat ===' -ForegroundColor Cyan
$f = @(Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -match '^CodaiMaint-' })
Write-Host "  task-uri CodaiMaint: $($f.Count)"
$f | ForEach-Object { Write-Host "     $($_.TaskName)  $($_.State)" }
