$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

function Invoke-ProxyProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Network,
        [Parameter(Mandatory = $true)][string]$Url,
        [ValidateSet("GET", "POST")][string]$Method = "GET"
    )

    $Arguments = @(
        "run", "--rm",
        "--network", $Network,
        "curlimages/curl:8.10.1",
        "-s", "-o", "/dev/null", "-w", "%{http_code}"
    )

    if ($Method -eq "POST") {
        $Arguments += @("-X", "POST")
    }

    $Arguments += $Url
    $Status = & docker @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "La sonde Docker a echoue pour $Url."
    }

    return ($Status | Select-Object -Last 1).Trim()
}

try {
    Write-Host "`n=== Controle des proxies Docker ===" -ForegroundColor Cyan

    $Checks = @(
        @{
            Name = "Observabilite : inventaire autorise"
            Actual = Invoke-ProxyProbe -Network "resilience-alpha_observability-docker-net" -Url "http://docker-proxy-ro:2375/containers/json"
            Expected = "200"
        },
        @{
            Name = "Observabilite : redemarrage interdit"
            Actual = Invoke-ProxyProbe -Network "resilience-alpha_observability-docker-net" -Url "http://docker-proxy-ro:2375/containers/nonexistent/restart" -Method POST
            Expected = "403"
        },
        @{
            Name = "Remediation : inventaire autorise"
            Actual = Invoke-ProxyProbe -Network "resilience-alpha_remediation-docker-net" -Url "http://docker-socket-proxy:2375/containers/json"
            Expected = "200"
        },
        @{
            Name = "Remediation : creation d'image interdite"
            Actual = Invoke-ProxyProbe -Network "resilience-alpha_remediation-docker-net" -Url "http://docker-socket-proxy:2375/images/create" -Method POST
            Expected = "403"
        }
    )

    $Failures = 0
    foreach ($Check in $Checks) {
        if ($Check.Actual -eq $Check.Expected) {
            Write-Host "[OK] $($Check.Name) -> HTTP $($Check.Actual)" -ForegroundColor Green
        }
        else {
            Write-Host "[FAIL] $($Check.Name) -> HTTP $($Check.Actual), attendu $($Check.Expected)" -ForegroundColor Red
            $Failures++
        }
    }

    if ($Failures -gt 0) {
        throw "$Failures controle(s) de proxy ont echoue."
    }

    Write-Host "`nPROXIES DOCKER CORRECTEMENT RESTREINTS" -ForegroundColor Green
}
finally {
    Pop-Location
}
