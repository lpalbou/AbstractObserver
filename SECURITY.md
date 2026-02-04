# Security policy

We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability
Please **do not** open a public GitHub issue for a suspected vulnerability.

Preferred reporting channel:
- **GitHub Security Advisories** (private): go to the repository’s **Security** tab and use **Report a vulnerability**.

If Security Advisories are not available for this repo:
- Open a GitHub issue with **minimal details** (no proof-of-concept, no sensitive config), and ask for a private channel.

## What to include
To help us triage quickly, please include:
- a clear description of the impact
- steps to reproduce (or a minimal PoC shared privately)
- affected versions / commit SHA
- any suggested mitigations or patches

## Coordinated disclosure
We’ll work with you to confirm the issue, ship a fix, and coordinate disclosure timing.

## Scope notes
AbstractObserver includes optional **high-trust** capabilities (process control, remote tool execution) depending on what your gateway exposes.
Operational guidance for these features: `docs/security.md`.

