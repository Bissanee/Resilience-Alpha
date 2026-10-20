$ErrorActionPreference = "Stop"

$BaseUrl = "http://localhost"
$Passed = 0
$Failed = 0

function Test-HttpStatus {
    param(
        [string]$Name,
        [string]$Url,
        [int[]]$ExpectedStatus
    )

    try {
        $statusText = & curl.exe `
            --silent `
            --show-error `
            --output NUL `
            --write-out "%{http_code}" `
            --max-time 10 `
            $Url

        $curlExitCode = $LASTEXITCODE

        if ($curlExitCode -ne 0) {
            Write-Host "[FAIL] $Name -> curl a termine avec le code $curlExitCode" -ForegroundColor Red
            $script:Failed++
            return
        }

        $status = [int]$statusText

        if ($ExpectedStatus -contains $status) {
            Write-Host "[OK]   $Name -> HTTP $status" -ForegroundColor Green
            $script:Passed++
        }
        else {
            Write-Host "[FAIL] $Name -> HTTP $status, attendu: $($ExpectedStatus -join ', ')" -ForegroundColor Red
            $script:Failed++
        }
    }
    catch {
        Write-Host "[FAIL] $Name -> $($_.Exception.Message)" -ForegroundColor Red
        $script:Failed++
    }
}

Write-Host ""
Write-Host "=== Tests fonctionnels du WAF ===" -ForegroundColor Cyan

Test-HttpStatus `
    -Name "Sante via le WAF" `
    -Url "$BaseUrl/health" `
    -ExpectedStatus @(200)

Test-HttpStatus `
    -Name "Routage vers Auth" `
    -Url "$BaseUrl/auth/health" `
    -ExpectedStatus @(200)

Test-HttpStatus `
    -Name "Routage vers API Paiement" `
    -Url "$BaseUrl/api/health" `
    -ExpectedStatus @(200)

Write-Host ""
Write-Host "=== Tests de securite ModSecurity ===" -ForegroundColor Cyan

$XssPayload = [uri]::EscapeDataString('<script>alert("xss")</script>')
$SqlPayload = [uri]::EscapeDataString("' OR 1=1 --")

Test-HttpStatus `
    -Name "Blocage tentative XSS" `
    -Url "$BaseUrl/?search=$XssPayload" `
    -ExpectedStatus @(403)

Test-HttpStatus `
    -Name "Blocage tentative injection SQL" `
    -Url "$BaseUrl/?id=$SqlPayload" `
    -ExpectedStatus @(403)

Write-Host ""
Write-Host "=== Resultat ===" -ForegroundColor Cyan
Write-Host "Tests reussis : $Passed" -ForegroundColor Green

if ($Failed -eq 0) {
    Write-Host "Tests echoues : 0" -ForegroundColor Green
    Write-Host ""
    Write-Host "Le routage et la protection du WAF sont operationnels." -ForegroundColor Green
    exit 0
}

Write-Host "Tests echoues : $Failed" -ForegroundColor Red
exit 1