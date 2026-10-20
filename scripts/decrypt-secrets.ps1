param(
    [string]$InputFile = "secrets/resilience-alpha.enc.env",
    [string]$OutputFile = ".env",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$InputPath = if ([System.IO.Path]::IsPathRooted($InputFile)) {
    $InputFile
}
else {
    Join-Path $RepoRoot $InputFile
}

$OutputPath = if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    $OutputFile
}
else {
    Join-Path $RepoRoot $OutputFile
}

if (-not (Get-Command sops -ErrorAction SilentlyContinue)) {
    throw "SOPS est introuvable. Installez-le et verifiez le PATH."
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Fichier chiffre introuvable : $InputPath"
}

if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
    throw "$OutputFile existe deja. Utilisez -Force pour le remplacer."
}

$TemporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) ("resilience-alpha-" + [Guid]::NewGuid().ToString() + ".env")

try {
    & sops --decrypt --input-type dotenv --output-type dotenv --output $TemporaryFile $InputPath

    if ($LASTEXITCODE -ne 0) {
        throw "SOPS n'a pas pu dechiffrer le fichier."
    }

    $RequiredVariables = @(
        "COMPOSE_PROJECT_NAME",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "JWT_SECRET",
        "GRAFANA_ADMIN_USER",
        "GRAFANA_ADMIN_PASSWORD",
        "OLLAMA_MODEL",
        "USER_PASSWORD",
        "MONITOR_PASSWORD"
    )

    $Names = [System.IO.File]::ReadAllLines($TemporaryFile) |
        Where-Object { $_ -match "^[A-Za-z_][A-Za-z0-9_]*=" } |
        ForEach-Object { ($_ -split "=", 2)[0] }

    $MissingVariables = $RequiredVariables | Where-Object { $_ -notin $Names }

    if ($MissingVariables.Count -gt 0) {
        throw "Variables manquantes : $($MissingVariables -join ', ')"
    }

    Copy-Item -LiteralPath $TemporaryFile -Destination $OutputPath -Force

    Write-Host "Secrets dechiffres vers $OutputFile." -ForegroundColor Green
    Write-Host "Le fichier reste local et ne doit jamais etre ajoute a Git." -ForegroundColor Yellow
}
finally {
    if (Test-Path -LiteralPath $TemporaryFile) {
        Remove-Item -LiteralPath $TemporaryFile -Force
    }
}