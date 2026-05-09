#!/usr/bin/env pwsh
# Start all VTextStudio services — server auto-spawns the vision service
$root = $PSScriptRoot

wt new-tab --title "VTextStudio" --startingDirectory $root pwsh -NoExit -Command "npm run dev"
