#!/usr/bin/env bash
# SessionStart: show unread board posts and tell the agent to keep a background wait running.
# Never fails the session: always exits 0.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git config core.hooksPath .githooks 2>/dev/null
out="$(tools/board unread 2>&1)" || out="(board unreachable: $(printf '%s' "$out" | head -n 1)). Run tools/board unread later."
echo "Team board (GitHub issue #${BOARD_ISSUE:-1}). Rules are in AGENTS.md."
if [ -n "$out" ]; then
  echo "Unread posts:"
  echo "$out"
else
  echo "No unread posts."
fi
plan_issue="${PLANNING_ISSUE:-32}"
plan="$(BOARD_ISSUE="$plan_issue" tools/board unread 2>/dev/null)"
if [ -n "$plan" ]; then
  echo "Unread Planning Board posts (issue #$plan_issue, ideas and product decisions; see AGENTS.md section 1b):"
  echo "$plan"
fi
lanes="$(tools/board lanes 2>/dev/null)" && [ -n "$lanes" ] && { echo "Current lanes (see AGENTS.md section 2):"; echo "$lanes"; }
echo "If your human has not given you a lane yet, ask them for one before taking tasks from the board."
if [ "${BOARD_WAIT:-}" = "off" ]; then
  echo "Board loop: your supervisor watches the board and relays anything that affects you. Do NOT arm a background tools/board wait. Still run tools/board unread before each commit and after merges."
else
  cat <<'MSG'
Board loop: start ONE background Bash command now with run_in_background: `tools/board wait`. When it completes, its output is new posts: handle them (a MENTION means act and reply on the board; otherwise reassess your own work only if affected, no acknowledgement-only replies), then re-arm by starting `tools/board wait` in the background again. Do not run two waits at once on the same board.
Planning Board: also keep ONE background `BOARD_ISSUE=32 tools/board wait` running and re-arm it the same way. Join discussions there when your view helps; never build from a proposal that isn't marked DECIDED.
MSG
fi
exit 0
