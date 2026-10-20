param(
    [string]$InputFile = ".env",
    [string]$OutputFile = "secrets/resilience-alpha.enc.env"
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
    throw "Fichier source introuvable : $InputPath"
}

$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$TemporaryPlain = Join-Path ([System.IO.Path]::GetTempPath()) ("resilience-alpha-" + [Guid]::NewGuid().ToString() + ".env")
$TemporaryEncrypted = Join-Path ([System.IO.Path]::GetTempPath()) ("resilience-alpha-" + [Guid]::NewGuid().ToString() + ".enc.env")

try {
    $Lines = [System.IO.File]::ReadAllLines($InputPath) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    [System.IO.File]::WriteAllLines(
        $TemporaryPlain,
        $Lines,
        (New-Object System.Text.UTF8Encoding($false))
    )

    Push-Location $RepoRoot

    try {
        & sops --encrypt --input-type dotenv --output-type dotenv --output $TemporaryEncrypted $TemporaryPlain

        if ($LASTEXITCODE -ne 0) {
            throw "SOPS n'a pas pu chiffrer le fichier."
        }
    }
    finally {
        Pop-Location
    }

    Copy-Item -LiteralPath $TemporaryEncrypted -Destination $OutputPath -Force

    Write-Host "Secrets chiffres vers $OutputFile." -ForegroundColor Green
    Write-Host "Verifiez toujours le fichier avec 'sops filestatus' avant le commit." -ForegroundColor Yellow
}
finally {
    if (Test-Path -LiteralPath $TemporaryPlain) {
        Remove-Item -LiteralPath $TemporaryPlain -Force
    }

    if (Test-Path -LiteralPath $TemporaryEncrypted) {
        Remove-Item -LiteralPath $TemporaryEncrypted -Force
    }
}