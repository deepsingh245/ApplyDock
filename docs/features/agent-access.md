# Agent access

ApplyDock exposes a local, pairing-key authenticated API and an MCP stdio bridge for agents that can reach the same computer. The agent API adds typed application, analysis, resume preparation, email preview, and job status commands. `/api/openapi.json` describes these operations; `/llms.txt` and `/agents.md` provide public, secret-free discovery notes.

The helper continues to bind to loopback and requires `X-Local-Key` for API access. Run the MCP bridge with `py -3 -m applydock.mcp_server`, setting `APPLYDOCK_URL` and `APPLYDOCK_KEY` in its environment. The bridge only exposes preparation commands. Approval, Gmail draft or schedule actions, sending, settings, and resume deletion remain human-only.

Application identity is computed from company and role, with post or URL context as a fallback. No identity schema was added. Resume save-and-attach returns the saved version, validation, hash, attachment target, and whether the current draft matches the saved content.

The API binds to loopback by default. To use a user-operated HTTPS tunnel such as ngrok, set `APPLYDOCK_PUBLIC_URL` to that exact origin before starting the helper. ApplyDock then accepts that exact Host/Origin and publishes it in the OpenAPI server URL. The pairing key is not scoped: direct authenticated HTTP access retains the full existing local API permissions. For GPT Actions, use `/api/agent/openapi.json`, which contains only typed preparation commands; it omits approval and delivery routes.

Job status and logs cover analysis runs and resume AI jobs. Pending and running jobs can be cancelled; workers check between stages and terminate the active Codex process when a cancellation arrives. Job status reports stalled work as `stuck` after ten minutes without progress.

## Connect a custom GPT

1. Keep the ngrok tunnel running. Stop and restart ApplyDock with its exact HTTPS origin in `APPLYDOCK_PUBLIC_URL`, for example `https://example.ngrok-free.app`. The helper must be restarted after setting the variable.
2. In PowerShell, fetch the authenticated, preparation-only schema to the clipboard. The key is entered as masked input and is not copied:

   ```powershell
   $secureKey = Read-Host "ApplyDock pairing key" -AsSecureString
   $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
   try {
     $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
     $headers = @{ "X-Local-Key" = $key }
     $spec = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/agent/openapi.json" -Headers $headers
     $spec | ConvertTo-Json -Depth 100 | Set-Clipboard
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
     Remove-Variable key,headers,spec,secureKey,pointer -ErrorAction SilentlyContinue
   }
   ```

3. In the GPT editor, open **Actions** and create an action. Set authentication to **API Key → Custom header**, name the header `X-Local-Key`, and enter the pairing key in the secret field. Paste the clipboard schema into the schema editor and save.
4. In Preview, ask the GPT to list applications. Add GPT instructions to use the ApplyDock action for application work and never approve, create or schedule Gmail drafts, or send. GPT Actions are limited to the preparation-only schema; keep the pairing key out of chat messages.
