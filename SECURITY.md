# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Use GitHub's [private vulnerability reporting](https://github.com/etaiso/spun/security/advisories/new)
  ("Report a vulnerability" under the repo's **Security** tab), or
- email the maintainer (see the commit history / GitHub profile).

Please include reproduction steps and the affected version. We aim to
acknowledge reports within a few days.

## Scope notes

Spun runs local network services on the developer/desktop machine:

- the Next.js app/server (default `http://localhost:3000`), and
- the optional recognizer sidecar (default `http://127.0.0.1:8755`).

Both bind to loopback by default. Reports about loopback services being
reachable from other hosts, the recognizer fetching arbitrary stream URLs, or
SSRF/command-injection in the recognizer's audio capture path are in scope and
welcome.

The recognizer uses a third-party, reverse-engineered Shazam client
(ShazamIO). Issues in that upstream library should be reported to its project;
issues in how Spun *invokes* it are in scope here.
