#!/usr/bin/env bash
# UserPromptSubmit: surface board posts that arrived since the last check. Silent when none. Never fails.
# Checks the Message Board (BOARD_ISSUE, default 1) and the Planning Board (PLANNING_ISSUE, default 32).
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
out="$(tools/board unread 2>/dev/null)" && [ -n "$out" ] && printf 'New board posts (issue #%s):\n%s\n' "${BOARD_ISSUE:-1}" "$out"
plan_issue="${PLANNING_ISSUE:-32}"
plan="$(BOARD_ISSUE="$plan_issue" tools/board unread 2>/dev/null)" && [ -n "$plan" ] && printf 'New planning posts (issue #%s):\n%s\n' "$plan_issue" "$plan"
exit 0
