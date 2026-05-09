#!/usr/bin/env pwsh
# Start all VTextStudio services in split Windows Terminal panes
$root = $PSScriptRoot

# Resolve Python: prefer 'py' launcher (Windows), fall back to python3 then python
$python = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } `
  elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } `
  else { "python" }

wt `
  new-tab --title "Server + Client" --startingDirectory $root pwsh -NoExit -Command "npm run dev" `; `
  split-pane --title "Vision Service" --startingDirectory "$root\vision-service" pwsh -NoExit -Command "$python -m uvicorn main:app --port 3001 --host 127.0.0.1 --reload"
