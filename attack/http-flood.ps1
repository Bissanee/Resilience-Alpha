param(
    [string]$Target = "http://localhost/api/health",

    [ValidateRange(1, 120)]
    [int]$DurationSeconds = 15,

    [ValidateRange(1, 50)]
    [int]$Concurrency = 10,

    [ValidateRange(1, 10000)]
    [int]$MaxRequests = 2000,

    [ValidateRange(0, 5000)]
    [int]$DelayMilliseconds = 50,

    [switch]$AllowRemote
)

$ErrorActionPreference = "Stop"

try {
    $TargetUri = [System.Uri]$Target
}
catch {
    Write-Host "[ERREUR] URL invalide : $Target" -ForegroundColor Red
    exit 1
}

if ($TargetUri.Scheme -notin @("http", "https")) {
    Write-Host "[ERREUR] Seuls HTTP et HTTPS sont autorises." -ForegroundColor Red
    exit 1
}

$LocalHosts = @("localhost", "127.0.0.1", "::1")
$IsLocalTarget = $TargetUri.Host -in $LocalHosts

if (-not $IsLocalTarget) {
    if (-not $AllowRemote) {
        Write-Host "[BLOQUE] La cible distante exige le parametre -AllowRemote." -ForegroundColor Red
        Write-Host "Ce script doit uniquement viser une machine autorisee du laboratoire." -ForegroundColor Yellow
        exit 1
    }

    Write-Host ""
    Write-Host "ATTENTION : cible distante $($TargetUri.Host)" -ForegroundColor Yellow
    Write-Host "N'utilisez ce test que sur une machine explicitement autorisee." -ForegroundColor Yellow
    $Confirmation = Read-Host "Pour confirmer, saisissez exactement le nom ou l'IP de la cible"

    if ($Confirmation -ne $TargetUri.Host) {
        Write-Host "[ANNULE] Confirmation incorrecte." -ForegroundColor Red
        exit 1
    }
}

Add-Type -AssemblyName System.Net.Http
$Handler = [System.Net.Http.HttpClientHandler]::new()
$Client = [System.Net.Http.HttpClient]::new($Handler)
$Client.Timeout = [TimeSpan]::FromSeconds(5)
$Client.DefaultRequestHeaders.UserAgent.ParseAdd("Resilience-Alpha-Lab/1.0")

$Counters = @{
    "200"   = 0
    "403"   = 0
    "429"   = 0
    "Other" = 0
    "Error" = 0
}

$Total = 0
$Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host ""
Write-Host "=== Simulation de flood HTTP controlee ===" -ForegroundColor Cyan
Write-Host "Cible       : $Target"
Write-Host "Duree max.  : $DurationSeconds secondes"
Write-Host "Concurrence : $Concurrency"
Write-Host "Requetes max: $MaxRequests"
Write-Host "Delai       : $DelayMilliseconds ms"
Write-Host ""
Write-Host "Appuyez sur Ctrl+C pour interrompre." -ForegroundColor Yellow
Write-Host ""

try {
    while (
        $Stopwatch.Elapsed.TotalSeconds -lt $DurationSeconds -and
        $Total -lt $MaxRequests
    ) {
        $Remaining = $MaxRequests - $Total
        $BatchSize = [Math]::Min($Concurrency, $Remaining)
        $Tasks = @()

        for ($Index = 0; $Index -lt $BatchSize; $Index++) {
            $Tasks += $Client.GetAsync($TargetUri)
        }

        try {
            [System.Threading.Tasks.Task]::WaitAll(
                [System.Threading.Tasks.Task[]]$Tasks
            )
        }
        catch {
            # Les taches sont analysees individuellement ci-dessous.
        }

        foreach ($Task in $Tasks) {
            $Total++

            if ($Task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
                $Response = $Task.Result
                $Status = [int]$Response.StatusCode
                $Key = [string]$Status

                if ($Counters.ContainsKey($Key)) {
                    $Counters[$Key]++
                }
                else {
                    $Counters["Other"]++
                }

                $Response.Dispose()
            }
            else {
                $Counters["Error"]++
            }
        }

        if ($DelayMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $DelayMilliseconds
        }

        if (($Total % 100) -eq 0) {
            Write-Host ("Progression : {0} requetes en {1:N1} s" -f $Total, $Stopwatch.Elapsed.TotalSeconds)
        }
    }
}
finally {
    $Stopwatch.Stop()
    $Client.Dispose()
    $Handler.Dispose()
}

$Elapsed = [Math]::Max($Stopwatch.Elapsed.TotalSeconds, 0.001)
$Rate = $Total / $Elapsed

Write-Host ""
Write-Host "=== Resultat ===" -ForegroundColor Cyan
Write-Host ("Duree             : {0:N2} s" -f $Elapsed)
Write-Host ("Requetes envoyees : {0}" -f $Total)
Write-Host ("Debit moyen       : {0:N2} req/s" -f $Rate)
Write-Host ("HTTP 200          : {0}" -f $Counters["200"]) -ForegroundColor Green
Write-Host ("HTTP 403          : {0}" -f $Counters["403"]) -ForegroundColor Yellow
Write-Host ("HTTP 429          : {0}" -f $Counters["429"]) -ForegroundColor Yellow
Write-Host ("Autres statuts    : {0}" -f $Counters["Other"])
Write-Host ("Erreurs reseau    : {0}" -f $Counters["Error"])

if ($Counters["429"] -gt 0) {
    Write-Host ""
    Write-Host "Le rate limiting du WAF a ete observe." -ForegroundColor Green
}