param(
    [ValidateRange(1, 10)]
    [int]$Cycles = 5,

    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$HealthUrl = "http://127.0.0.1/api/health"
$Results = New-Object System.Collections.Generic.List[object]

function Get-HttpStatus {
    param([string]$Url)

    try {
        $Request = [System.Net.HttpWebRequest]::Create($Url)
        $Request.Method = "GET"
        $Request.Timeout = 3000
        $Response = $Request.GetResponse()
        $Status = [int]$Response.StatusCode
        $Response.Close()
        return $Status
    }
    catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $Status = [int]$_.Exception.Response.StatusCode
            $_.Exception.Response.Close()
            return $Status
        }
        return 0
    }
}

Push-Location $Root
try {
    Write-Host "`n=== Test de restauration repete ===" -ForegroundColor Cyan
    Write-Host "Service : api-paiement"
    Write-Host "Cycles  : $Cycles"

    for ($Cycle = 1; $Cycle -le $Cycles; $Cycle++) {
        Write-Host "`nCycle $Cycle/$Cycles : redemarrage cible..." -ForegroundColor Yellow
        $StartedAt = Get-Date
        & docker compose restart api-paiement | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Le redemarrage Docker a echoue au cycle $Cycle."
        }

        $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        $Status = 0
        do {
            Start-Sleep -Seconds 1
            $Status = Get-HttpStatus -Url $HealthUrl
        } while ($Status -ne 200 -and (Get-Date) -lt $Deadline)

        $Duration = [Math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 2)
        $Success = $Status -eq 200
        $Results.Add([pscustomobject]@{
            Cycle = $Cycle
            Restored = $Success
            HttpStatus = $Status
            RecoverySeconds = $Duration
        })

        if (-not $Success) {
            $Results | Format-Table -AutoSize
            throw "Le service n'est pas revenu sain au cycle $Cycle dans le delai imparti."
        }

        Write-Host "[OK] API restauree en $Duration s (HTTP 200)" -ForegroundColor Green
    }

    Write-Host "`n=== Synthese ===" -ForegroundColor Cyan
    $Results | Format-Table -AutoSize
    $Average = [Math]::Round(($Results | Measure-Object -Property RecoverySeconds -Average).Average, 2)
    Write-Host "RESTAURATION REUSSIE : $Cycles/$Cycles cycles, moyenne $Average s" -ForegroundColor Green
}
finally {
    Pop-Location
}
