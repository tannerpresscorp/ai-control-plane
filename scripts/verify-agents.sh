#!/usr/bin/env bash
# Checks the agent setup is intact. Safe to run locally or in CI.
set -u; fail=0
check() { [ -e "$1" ] && echo "ok   $1" || { echo "MISS $1"; fail=1; }; }
check AGENTS.md
check .gitignore
check .github/pull_request_template.md
check .circleci/config.yml
if [ -f CLAUDE.md ]; then grep -q '@AGENTS.md' CLAUDE.md && echo "ok   CLAUDE.md -> AGENTS.md" || echo "WARN CLAUDE.md doesn't import AGENTS.md"; fi
if grep -q '{{' AGENTS.md; then echo "FAIL unfilled placeholders in AGENTS.md:"; grep -n '{{' AGENTS.md; fail=1; fi
echo "info $(grep -c 'TODO:' AGENTS.md) TODO(s) left in AGENTS.md"
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'; then echo "FAIL .env file is tracked"; fail=1; fi
exit $fail
