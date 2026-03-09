# Codex Live View

This helper serves the latest Codex rollout log to a phone browser.

## What it does

- Watches the newest `%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl` file.
- Tails new JSONL entries as the current Codex session runs.
- Exposes a small local web page that refreshes automatically.

## Start

From `C:\ranchat`:

```powershell
.\scripts\start-codex-live-view.ps1
```

If you need a different port:

```powershell
.\scripts\start-codex-live-view.ps1 -Port 8877
```

Then open the printed `http://<PC-IP>:<PORT>/` URL on the iPhone.

If you want a token-protected local URL:

```powershell
.\scripts\start-codex-live-view.ps1 -Token your-secret-token
```

## Stop

```powershell
.\scripts\stop-codex-live-view.ps1
```

## Remote Access

If the iPhone is not on the same Wi-Fi, start the remote tunnel:

```powershell
.\scripts\start-codex-live-view-remote.ps1
```

That script restarts the local viewer, downloads `cloudflared` if needed, creates a public Cloudflare Quick Tunnel, and prints a full public URL.

If you still want a protected remote URL, pass your own token:

```powershell
.\scripts\start-codex-live-view-remote.ps1 -Token your-secret-token
```

Stop the public tunnel with:

```powershell
.\scripts\stop-codex-live-view-remote.ps1
```

## Notes

- The iPhone must be on the same network unless you expose the PC through the remote tunnel.
- If the page does not open from the iPhone, Windows Firewall is the first thing to check.
- This mirrors the rollout log, not the full interactive terminal surface, so prompt widgets and hidden UI state are not reproduced exactly.
- Anyone who gets the full remote URL can see the live view until you stop the tunnel.
