# Status: phase10-smb-spa
- State: blocked-no-dns
- Pre-state: worktree at 96cecba on branch wip/phase10-smb-spa (post-automations merge). Status committed at 2d8bf7f.
- Worker attempt 1 (2026-06-13 11:20-11:22, Asia/Yerevan): launched `codex --full-auto`. Worker config in /Users/samvelstepanyan/.codex/config.toml has `service_tier = "priority"` but the user's codex version only accepts "fast" or "flex". Codexit panics before any task runs.
- Worker attempt 2 (after I patched the config to `service_tier = "fast"`): the npm `codex` panics in `system-configuration` Rust crate (dynamic_store.rs:154 NULL object). This is a system-level macOS issue with the user's preferences daemon.
- Worker attempt 3 (using /Applications/Codex.app/Contents/Resources/codex, the bundled Mach-O): binary loads, but cannot reach wss://chatgpt.com because DNS resolver 100.100.100.100 is not responding.
- All three attempts blocked by: (a) user's codex config has invalid `service_tier` value (user-side config), (b) macOS DNS resolver is dead (system-side outage).

## Required user actions

1. **Fix codex config**: edit `/Users/samvelstepanyan/.codex/config.toml` line 9, change `service_tier = "priority"` to `service_tier = "fast"` (or `flex`). The user's prior `priority` value is from an older codex build and is no longer accepted.

2. **Restore DNS**: the system resolver at 100.100.100.100 (Tailscale / Hermes / NextDNS) is not responding. Either restart the VPN client, or override the system resolver to 1.1.1.1 (requires sudo: `networksetup -setdnsservice Wi-Fi 1.1.1.1`).

3. **Re-launch worker**: `tmux new-session -d -s phase10-spa -c /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa && tmux send-keys -t phase10-spa "codex --full-auto -C . 2>&1 | tee /tmp/phase10-spa.log" Enter`. Or with the bundled binary: `/Applications/Codex.app/Contents/Resources/codex exec --full-auto -C . 'Read .orchestration/phase10-smb-crm-rebuild/worker-spa/task.md and execute the SPA build. Push commits to ant/wip/phase10-smb-spa when done.'`.

## What the worker needs to deliver

From .orchestration/phase10-smb-crm-rebuild/worker-spa/task.md:
- 8 SPA routes in web-modern/src/routes/app/smb-crm/
- 2 widgets (ChatWidget, PortalAccess)
- App registration in apps.ts + suite-routes.js + main.jsx
- 6 co-located test files
- Single commit: `feat(smb-crm): SPA surface (8 routes + 2 widgets + 6 tests)`
- Push to ant/wip/phase10-smb-spa

## Orchestrator's note

The merge of Track 4 into ant/main is COMPLETE (commit 96cecba on ant/main, 70/70 tests pass). The SPA worker is the only remaining step. Cron `phase10-spa-progress` is already wired and will retry every 15 min — but it can't do anything without (1) a working codex and (2) a working DNS.

If the user resolves both blockers and wants me to relaunch, just say so. Otherwise the cron will keep polling.
