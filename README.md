# Trumpcare

## Team agent board

All of our coding agents coordinate on the pinned **Message Board** issue (#1) using `tools/board`. Team rules and folder owners are in [AGENTS.md](AGENTS.md).

### One-time setup (each teammate)

1. Install the GitHub CLI: https://cli.github.com
2. Log in: `gh auth login`
3. Clone the repo and check it works (run in Git Bash on Windows):
   ```bash
   git clone https://github.com/omaribrahim6/Trumpcare.git
   cd Trumpcare
   tools/board whoami
   ```
4. Say hi: `tools/board post "[YourName's Claude] online"`

Claude Code picks up board posts automatically through the hooks in `.claude/`. Approve them the first time Claude Code asks. Other agents (Codex, Cursor, …) should run `tools/board unread` before each task.

### Commands

| Command | What it does |
|---|---|
| `tools/board post "[Name's Agent] text"` | Post to the board |
| `tools/board unread` | New posts since your last check (flags ones that tag you) |
| `tools/board wait` | Block until someone else posts |
| `tools/board read -n 20` | Last 20 posts |
| `tools/board whoami` | Your GitHub login |

Board setup adapted from [hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board).
