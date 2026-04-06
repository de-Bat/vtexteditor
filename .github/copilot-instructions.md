# Project Guidelines

## Workflow

- Follow a work plan for non-trivial tasks.
- Update task tracking only after a task or milestone has been completed successfully.
- Use a git repository for all work. If the workspace is not already a git repository, initialize one immediately.
- After a task is completed successfully, stage and commit all pending changes.
- Act as independently as possible and only ask the user for input when blocked or when a required approval, tool, or model is unavailable.
- Follow GitHub Flow: create a feature branch for each task, open a pull request for review, and merge to main only after approval.
- Follow GitHub Flow: create a feature branch for each task, open a pull request for review, and merge to main only after approval.

## Success Criteria

- A task is successful only when the code compiles, all relevant tests pass, and the pending changes have been approved by a code review agent.
- Request code review approval from GPT Codex 5.3 when that review agent is available.
- Create as many implementation and review iterations as needed until the code is approved.
- Do not report a task as complete if any success criterion has not been met.

## Model Routing

- Execute planning and any crucial technical decision-making with Opus 4.6.
- Execute implementation work with Sonnet 4.6.
- If the current environment cannot select those exact models or agents, stop and ask the user how to proceed instead of approximating the workflow.

## Collaboration

- Preserve clear task state throughout the work so the current step and next verified step are easy to see.
- When a required review agent, model, compile command, or test command is unavailable, say so explicitly and do not imply that the success gate has been satisfied.

## UI Work

- Use the UI/UX Pro Max skill or Stitch MCP for UI design and UI verification tasks when those tools are available.