$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

try {
    $RawConfig = & docker compose config --format json

    if ($LASTEXITCODE -ne 0) {
        throw "docker compose config a echoue."
    }

    $Config = $RawConfig | ConvertFrom-Json
    $Failures = New-Object System.Collections.Generic.List[string]
    $ApplicationServices = @(
        "front",
        "auth",
        "api-paiement",
        "remediation",
        "dashboard",
        "detector",
        "rag"
    )
    $AllowedPublishedServices = @("waf", "dashboard", "grafana")

    foreach ($Property in $Config.services.PSObject.Properties) {
        $Name = $Property.Name
        $Service = $Property.Value

        if (-not $Service.mem_limit) {
            $Failures.Add("$Name : limite memoire absente")
        }

        if (-not $Service.cpus) {
            $Failures.Add("$Name : limite CPU absente")
        }

        if (-not $Service.pids_limit) {
            $Failures.Add("$Name : limite de processus absente")
        }

        if ($Service.security_opt -notcontains "no-new-privileges:true") {
            $Failures.Add("$Name : no-new-privileges absent")
        }

        if ($Name -in $ApplicationServices) {
            if ($Service.read_only -ne $true) {
                $Failures.Add("$Name : systeme de fichiers non configure en lecture seule")
            }

            if ($Service.cap_drop -notcontains "ALL") {
                $Failures.Add("$Name : toutes les capacites Linux ne sont pas supprimees")
            }
        }

        if ($Service.ports -and $Name -notin $AllowedPublishedServices) {
            $Failures.Add("$Name : publication de port non autorisee")
        }
    }

    if ($Failures.Count -gt 0) {
        Write-Host "ECHEC DU CONTROLE DE DURCISSEMENT" -ForegroundColor Red
        $Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
        exit 1
    }

    Write-Host "CONTROLE DE DURCISSEMENT REUSSI" -ForegroundColor Green
    Write-Host " - limites CPU, memoire et processus presentes"
    Write-Host " - no-new-privileges actif sur tous les services"
    Write-Host " - services applicatifs en lecture seule et sans capacite Linux"
    Write-Host " - ports publies limites au WAF, au dashboard et a Grafana"
    exit 0
}
finally {
    Pop-Location
}
