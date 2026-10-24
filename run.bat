@echo off
start "TradeMind Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\uvicorn.exe app.main:app --reload"
start "TradeMind Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
