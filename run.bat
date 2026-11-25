@echo off
echo Starting BgStudio on http://localhost:8080 ...
docker compose up --build -d
if %ERRORLEVEL% NEQ 0 (
    echo Docker failed. Make sure Docker Desktop is running.
    pause
    exit /b 1
)
start http://localhost:8080
