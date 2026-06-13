# Status: phase10-smb-automations-engines
- State: starting
- Worker relaunch: 2026-06-13 10:55 (Asia/Yerevan, UTC+4) by orchestrator (Mavis)
- Branch: wip/phase10-smb-automations
- Worktree: /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations
- Pre-state: 2/5 engines (Automations + Outbound) + 6 smoke tests + 8 tables shipped at commits 897865e + e4b27a7 (rescued by orchestrator at 10:33).
- Watch: cron `phase10-automations-engines-monitor` every 15 min
- Scope: build the 3 missing pure engines (Webhooks, Import, Accounting) + 1 new engine (Integration) + 5 contract tests, then push.
- Sub-task 4b (route layer) is a separate worker — see `worker-automations-routes/task.md`.
