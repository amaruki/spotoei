# Security Policy

## Supported versions

SPOTOEI is pre-1.0. Security fixes are applied to the latest release on the default branch;
older releases are not maintained.

## Reporting a vulnerability

Do not open a public issue for security problems. Use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected version, platform, reproduction steps, and impact.

If private reporting is unavailable, open a minimal issue asking for a private contact channel
without disclosing details.

Expect an initial response within about a week. Please allow time for a fix before public
disclosure.

## Scope

Reports of interest include:

- credential exposure (OAuth tokens or PKCE material written to config, cache, logs, or IPC);
- leaks of secrets into child processes, diagnostics, or crash output;
- authentication flaws in the loopback PKCE flow;
- arbitrary code execution, path traversal, or command injection;
- memory-safety issues in the Rust player.

Out of scope: vulnerabilities in Spotify's service, librespot, or the terminal emulator; account
or billing issues; and behavior that requires a modified local build or a compromised machine.

## Credential handling expectations

- Persistent credentials belong in the OS keyring; there is no plaintext-token fallback.
- `config.json`, SQLite cache, and logs must never contain access tokens, refresh tokens,
  authorization codes, or PKCE verifiers.
- Report immediately if you find any of the above on disk or in diagnostic output.

## Handling in your own setup

- Treat `SPOTOEI_CLIENT_ID` as public (it is not secret) but keep it out of bug reports if you
  prefer anonymity; it identifies your Spotify Developer application.
- Rotate your Spotify application credentials in the Developer Dashboard if you suspect they
  were exposed.
- Log out from SPOTOEI to clear keyring tokens.
