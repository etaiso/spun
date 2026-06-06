# Contributing to Spun

Thanks for your interest in contributing! Spun is a small project and
contributions of all sizes are welcome.

## Getting started

```bash
npm install
npm run dev      # web app at http://localhost:3000
```

See the [README](README.md) for the optional recognizer sidecar and the
desktop (Electron) build, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for how the pieces fit together.

> **Note:** This is not the Next.js you may know — it pins a recent version with
> breaking changes. Read the relevant guide in `node_modules/next/dist/docs/`
> before changing app/server code, and heed deprecation notices.

## Before you open a PR

```bash
npm run lint     # ESLint
npm test         # unit tests (Vitest)
```

Please make sure both pass. Keep changes focused, match the style and comment
density of the surrounding code, and add tests for new behavior where it makes
sense.

## Commit / PR conventions

- Write clear commit messages (the history uses short, conventional-ish
  prefixes like `feat:`, `fix:`, `chore:`, `release:`).
- Open PRs against `main`. Describe what changed and why; link any related
  issue.

## Licensing of contributions

Spun is released under the [MIT License](LICENSE). By submitting a
contribution, you agree that your contribution is licensed under the same MIT
terms (inbound = outbound) and that you have the right to submit it.

## Scope & third-party services

Spun integrates third-party services (radio-browser.info, the iTunes Search
API) and an **unofficial** Shazam client (ShazamIO). Please don't add features
that depend on undocumented or terms-of-service-violating endpoints beyond what
already exists, and keep such integrations optional. See the
[disclaimer](README.md#disclaimer).

## Reporting bugs & security issues

- Functional bugs: open a [GitHub issue](https://github.com/etaiso/spun/issues).
- Security vulnerabilities: please follow [SECURITY.md](SECURITY.md) instead of
  filing a public issue.
