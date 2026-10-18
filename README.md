# pi-ask-user

A [pi](https://github.com/earendil-works/pi) extension package that registers an `ask_user` tool: an interactive question form for the terminal UI.

The agent calls `ask_user` with structured questions while preparing a plan or whenever an answer changes the approach. The user answers through a sequential form — pick an option, toggle several on multi-select questions, type free text (including counter-questions), or defer a decision back to the agent — reviews a summary screen, and submits. Results return to the model as a structured tool result with explicit semantics per answer kind.

## Install

```bash
pi install git:github.com/kcurtet/pi-ask-user
```

Interactive TUI sessions only. In other modes (headless, web) the tool returns an error telling the model to ask in plain chat instead.

## The form

```
Question 1/3 — Deployment
Which database for the fetcher?

  ❯ SQLite        ★
      zero ops, enough for a single operator
  □ Postgres
  □ Neon serverless

  ↑↓ move · enter select · e type · r agent decides · tab skip · esc cancel
```

| Key | Action |
|---|---|
| `↑` `↓` / `k` `j` / `ctrl+p` `ctrl+n` | Move between options |
| `enter` | Pick the highlighted option (or open the text input on free-text questions) |
| `space` | Toggle an option on multi-select questions (`allowMultiple`) |
| `e` | Type free text |
| `r` | Defer the decision to the agent |
| `tab` | Skip for now (answer later from the summary) |
| `esc` `esc` | Cancel the whole form (drafts discarded) |

After the last question a summary screen lists every answer; press `enter` on a row to jump back and edit it, or on `▶ Send` to submit. Unanswered questions block submission.

## Tool contract

Execution is `sequential`: pi blocks other tool calls in the same assistant turn until the user answers, so side effects cannot run before the form is seen. While the form is open the extension emits `herdr:blocked` events (integrations like cockpit dashboards can show the session as waiting on the user).

Parameters (validated, hard limits):

- `title` — short form header, ≤ 80 chars (default `Questions`)
- `questions` — 1–6, unique `id`s
  - `question` ≤ 300 chars, one line
  - `context` ≤ 400 chars, 1–2 lines of why it matters
  - `options` — 2–6 per question; omit for free-text-only
    - `label` ≤ 80, `description` ≤ 200 (shown when highlighted)
    - `recommended` — at most **one** per question, and it **must** carry a `rationale` (≤ 300). Intended for the single technically strongest option with a real basis — not for pure preference calls.
  - `allowMultiple` — multi-select with `space`; the recommended option starts pre-toggled. TUI form only: fallback dialogs treat it as single-select.

Answer kinds in the result:

- `option` — the label the user picked
- `options` — the labels the user toggled (`allowMultiple`)
- `text` — free text; if it ends in `?` the result flags it as a counter-question the model must answer before using it
- `defer` — the user handed the decision back; the result embeds instructions: explain trade-offs and ask what they still need; only if it stays unresolved, pick the most technically sound option and mark it `recommended, not confirmed` in the plan

Long context belongs in chat **before** the call — form text stays short.

## Layout

```
extensions/ask-user/
├── index.ts        # tool definition + TUI form (pi, pi-tui imports)
├── core.ts         # pure validation + result formatting, no pi imports
└── core.test.ts    # node --test unit tests
```

Pure logic lives in `core.ts` so it stays unit-testable with plain `node --test` (no pi runtime needed).

## Development

```bash
npm install
npm exec tsc -- --noEmit   # typecheck against pinned pi packages
node --test extensions/ask-user/core.test.ts
```

## License

[MIT](LICENSE)
