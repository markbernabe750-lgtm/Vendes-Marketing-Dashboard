$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/markbernabe750-lgtm/Vendes-Marketing-Dashboard.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git is not installed or not available in PATH." -ForegroundColor Red
  Write-Host "Install Git for Windows first: https://git-scm.com/download/win"
  Write-Host "After installing, close and reopen Codex/PowerShell, then run this script again."
  exit 1
}

if (-not (Test-Path ".git")) {
  git init
}

git branch -M main

$remote = $null
try {
  $remote = git remote get-url origin 2>$null
} catch {
  $remote = $null
}

if (-not $remote) {
  git remote add origin $repoUrl
} elseif ($remote.Trim() -ne $repoUrl) {
  git remote set-url origin $repoUrl
}

$userName = git config user.name
$userEmail = git config user.email
if (-not $userName) {
  Write-Host "Git user.name is not set. Run this, then run the script again:" -ForegroundColor Yellow
  Write-Host 'git config --global user.name "Your Name"'
  exit 1
}
if (-not $userEmail) {
  Write-Host "Git user.email is not set. Run this, then run the script again:" -ForegroundColor Yellow
  Write-Host 'git config --global user.email "you@example.com"'
  exit 1
}

git add .

$pending = git status --porcelain
if ($pending) {
  git commit -m "Prepare dashboard for Vercel deployment"
} else {
  Write-Host "No file changes to commit. Continuing to push..."
}

git push -u origin main
