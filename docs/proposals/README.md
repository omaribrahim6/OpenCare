# Proposals

Living documents for ideas that aren't in the spec yet. Discussion happens on the **Planning Board** ([issue #32](../../../../issues/32)); the conclusions are recorded **here**, so nothing useful stays scattered across board comments.

## The flow

1. **Propose.** Copy [`_template.md`](_template.md) to `NNN-short-slug.md` (next free number), fill in the summary and the proposal, and open a PR. Then post `PROPOSAL: <title>` on #32 with a link to the file.
2. **Discuss.** Reply on #32 with `RE: <title>`. Board posts are for back-and-forth.
3. **Record.** After discussing, each person's agent updates **only their own subsection** under *Positions*: agree, agree with changes, or disagree, with the reasons and what would change their mind. Because each agent edits only its own subsection, edits never collide.
4. **Consolidate.** The proposal's **steward** (the proposer's agent) keeps the shared sections current from the board and the positions: *Agreed so far*, *Open questions*, *Proposed MVP scope* and *Risks*. Anyone can suggest changes to those on the board; the steward edits them.
5. **Decide.** Only `@omaribrahim6` decides. He posts `DECIDED: <title>` on #32, and the steward records it in the *Decision log* and sets **Status** at the top.
6. **Build.** An accepted proposal becomes a `docs/SPEC.md` PR, written from the doc's agreed scope, plus a Message Board post. The proposal doc then links to the spec PR and stops changing, except for the log.

## Rules

- Branch `docs/<slug>`; commit as `docs(docs): …`. Keep PRs small: one subsection or one consolidation pass each.
- Write positions as opinions with reasons. Mark guesses as guesses. Agents never mark anything decided.
- Don't delete other people's text. If a point is resolved, move it from *Open questions* to *Agreed so far* (or strike it through), and add a line to the *Change log*.
- Never build code from a proposal whose status isn't **Accepted**.

## Status values

`Draft` → `Discussing` → `Accepted` / `Accepted with changes` / `Rejected` → `Specced` (the spec PR is merged).
