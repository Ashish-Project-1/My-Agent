# Debug startup script
$ErrorActionPreference = "Continue"

# Load .env
Get-Content ".env" | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
        Write-Host "Set $name"
    }
}

Write-Host "Environment variables loaded"
Write-Host "DATABASE_URL: $([Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process'))"
Write-Host "Starting node..."

node dist/main.js 2>&1 | Tee-Object -FilePath "error.log"

$exitCode = $LASTEXITCODE
Write-Host "Node exited with code: $exitCode"
