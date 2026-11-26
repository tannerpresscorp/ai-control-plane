# Decisions

Newest first. One entry per meaningful choice.

## 2026-11-25: Agent setup standardized
- **Context:** Several coding agents (Claude Code, GitHub Copilot, Codex) work in this repository and each looks for its own instruction file.
- **Decision:** `AGENTS.md` is the single source of instructions; `CLAUDE.md` and `.github/copilot-instructions.md` are one-line pointers to it. Added a PR template, this decision log, an MIT license, and `scripts/verify-agents.sh`.
- **Why:** One file avoids instructions drifting apart between tools.
