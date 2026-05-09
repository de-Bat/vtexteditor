#!/usr/bin/env pwsh
# Start all VTextStudio services in split Windows Terminal panes
$root = $PSScriptRoot

wt `
  new-tab --title "Server + Client" --startingDirectory $root pwsh -NoExit -Command "npm run dev" `; `
  split-pane --title "Vision Service" --startingDirectory "$root\vision-service" pwsh -NoExit -Command "python -m uvicorn main:app --port 3001 --host 127.0.0.1 --reload"
