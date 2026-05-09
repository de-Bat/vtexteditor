#!/usr/bin/env pwsh
# Start all VTextStudio services in split Windows Terminal panes
$root = $PSScriptRoot

wt `
  new-tab --title "Server + Client" --startingDirectory $root pwsh -NoExit -Command "npm run dev" `; `
  split-pane --title "Vision Service" --startingDirectory "$root\vision-service" pwsh -NoExit -Command "python main.py"
