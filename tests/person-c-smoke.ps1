$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    Write-Host "[OK] $Message" -ForegroundColor Green
}

Write-Host "=== Personne C : smoke tests détecteur / RAG ===" -ForegroundColor Cyan

$detectorRaw = & docker compose exec -T detector python -c "import json,urllib.request; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:5100/score'))))"
if ($LASTEXITCODE -ne 0) { throw "Impossible d'interroger le score du détecteur." }
$detector = $detectorRaw | ConvertFrom-Json
Assert-True ($null -ne $detector.score) "Le détecteur expose un score."
Assert-True ($null -ne $detector.features.request_rate) "Le détecteur expose les caractéristiques Prometheus."
Assert-True ($null -ne $detector.features.distinct_source_ips) "Le détecteur expose le nombre d'IP vues dans Loki."

$modelRaw = & docker compose exec -T detector python -c "import json,urllib.request; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:5100/model'))))"
if ($LASTEXITCODE -ne 0) { throw "Impossible d'interroger le modèle du détecteur." }
$model = $modelRaw | ConvertFrom-Json
Assert-True ($model.model -eq "IsolationForest") "Le modèle déclaré est IsolationForest."
Assert-True ($model.min_training_samples -ge 20) "Le modèle attend un historique avant de décider."

$ragRaw = & docker compose exec -T rag python -c "import json,urllib.request; print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:5200/health'))))"
if ($LASTEXITCODE -ne 0) { throw "Impossible d'interroger la santé du RAG." }
$rag = $ragRaw | ConvertFrom-Json
Assert-True ($rag.status -eq "ok") "Le RAG a indexé les documents locaux."
Assert-True ($rag.indexed_chunks -gt 0) "Le RAG expose des passages indexés."
Assert-True ($rag.langchain_available) "Le retrieval LangChain est disponible."

$overview = Invoke-RestMethod -Uri "http://127.0.0.1:8088/api/overview" -TimeoutSec 5
$names = @($overview.services | ForEach-Object { $_.service })
Assert-True ($names -contains "detector") "Le dashboard supervise le détecteur."
Assert-True ($names -contains "rag") "Le dashboard supervise le RAG."

Write-Host "Tous les contrôles Personne C ont réussi." -ForegroundColor Green
