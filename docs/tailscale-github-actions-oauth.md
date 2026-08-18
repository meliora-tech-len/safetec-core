# Tailscale in the Deploy Pipeline — OAuth Client Setup

_Last updated: 2026-08-18_

## What Tailscale is used for

The production server (Hetzner) is not reachable over public SSH. It sits on a private
Tailscale network (a "tailnet"), and the only way to SSH into it is from another device
on that same tailnet.

The GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) therefore does this
on every deploy:

1. **Connect to Tailscale** — the runner joins the tailnet as a temporary (ephemeral)
   device tagged `tag:ci`.
2. **Deploy to Hetzner** — it SSHes to the server via its Tailscale IP
   (`secrets.SERVER_TAILSCALE_IP`) and runs `docker compose pull && docker compose up -d`.

The ephemeral CI device removes itself from the tailnet when the job ends.

## Why the switch to an OAuth client (Aug 2026)

The workflow originally joined the tailnet with a pre-generated **auth key**
(`secrets.TS_AUTH_KEY`, key id `kxDYQfEV1o11CNTRL`). Tailscale auth keys have a maximum
lifetime of 90 days; this one expired on **15 Aug 2026**, which broke every deploy with:

```
backend error: invalid key: API key kxDYQfEV1o11CNTRL not valid
```

Tailscale also deprecated the `authkey` input on `tailscale/github-action@v2` in favour
of **OAuth clients**. An OAuth client never expires — it mints a fresh short-lived auth
key for the runner on every workflow run — so this failure mode goes away permanently.

## Setup steps (as performed)

### 1. Confirm the `tag:ci` tag exists

Admin console → **Access Controls** (or the Tags page). The policy file must have a
top-level `tagOwners` entry:

```jsonc
"tagOwners": {
	"tag:ci": ["autogroup:admin"],
},
```

This already existed (the old auth key was issued for `tag:ci`), so no ACL change was
needed. Note: `tagOwners` is a top-level section of the policy file, a sibling of
`"acls"` and `"ssh"` — not inside either of them.

### 2. Create the OAuth client

1. Go to <https://login.tailscale.com/admin/settings/oauth>
2. **Generate OAuth client**, description e.g. `github-actions-deploy`
3. Scopes: tick **Keys → Auth Keys → Write** only (least privilege — do not grant DNS,
   Policy File, Users, Tailnets, Services, or OAuth applications)
4. When prompted for tags on that scope, select **`tag:ci`**
5. Generate, then copy the **Client ID** and the **Client secret**
   (the secret starts with `tskey-client-…` and is shown **only once**)

### 3. Set the GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | OAuth client ID |
| `TS_OAUTH_SECRET` | OAuth client secret |

Both secret names already existed from an earlier, unused OAuth setup — their **values**
were updated to the new client's credentials. Always update both together; an ID/secret
mismatch from two different clients fails authentication.

### 4. Update the workflow

In `.github/workflows/deploy.yml`, the Tailscale step changed from:

```yaml
- name: Connect to Tailscale
  uses: tailscale/github-action@v2
  with:
    authkey: ${{ secrets.TS_AUTH_KEY }}
    tags: tag:ci
```

to:

```yaml
- name: Connect to Tailscale
  uses: tailscale/github-action@v2
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
    tags: tag:ci
```

### 5. Clean up (after the first green deploy)

- Delete the `TS_AUTH_KEY` repository secret in GitHub (no longer referenced).
- Revoke the expired auth key `kxDYQfEV1o11CNTRL` in the Tailscale admin console
  (**Settings → Keys**) — it is dead anyway, this is just tidiness.

## If the deploy breaks again at the Tailscale step

- **`invalid key` / auth errors** — the OAuth client was likely revoked or its secret
  rotated. Generate a new client (step 2) and update both secrets (step 3).
- **`requested tags [tag:ci] are invalid or not permitted`** — the OAuth client's
  Auth Keys scope is missing the `tag:ci` tag, or `tag:ci` was removed from `tagOwners`.
- **SSH step times out after Tailscale connects** — check the tailnet ACLs allow
  `tag:ci` to reach the server on port 22, and that `SERVER_TAILSCALE_IP` still matches
  the server's Tailscale IP.
