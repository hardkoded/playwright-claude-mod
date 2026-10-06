# Playwright Claude Mod

See your Playwright tests and their results in a side panel inside Claude Code, like the Playwright extension for VS Code.

When Claude runs `playwright test`, the panel shows which tests passed and which failed, and the first lines of each error. You can also run every test, or one test, from the panel yourself.

```
 Playwright   Diff                                        ✕
[ Run all ] [ Refresh ]
✓ 23  ✗ 1  ○ 0  total 24
Claude's run: 1 of 24 failed.

adding-todos/should-add-single-todo.spec.ts
✓ Adding Todos › should add single todo 749ms

deleting-todos/should-clear-all-completed-todos.spec.ts
✗ Deleting Todos › should clear all completed todos 1204ms
    Error: Property 'toMatchAriaSnapshot' not found
```

This is a Claude Code mod: a plugin of function hooks. It runs only in Claude Code.

## Commands

| Command | What it does |
| --- | --- |
| `/playwright` | Opens the panel for the folder the session runs in, and lists its tests. |
| `/playwright <folder>` | Opens the panel for another Playwright project. |

In the panel:

| Control | Key | What it does |
| --- | --- | --- |
| Run all | `r` | Runs the whole suite. |
| Refresh | `l` | Reloads the test list. |
| Fix | `f` | Shown only when the config has no json reporter. Asks Claude to add one. You review the edit. |
| A test's name | | Runs only that test. |

## Quick start

### 1. Install the plugin

Type this at the Claude Code prompt:

```
/plugin install playwright-claude-mod --marketplace hardkoded/playwright-claude-mod
```

Answer `y` to add the marketplace, then choose the user scope. The plugin is active right away, and in every session after that.

Or add the marketplace first, then install:

```
/plugin marketplace add hardkoded/playwright-claude-mod
/plugin install playwright-claude-mod@playwright-claude-mod
```

If GitHub over SSH fails, use the HTTPS address:

```
/plugin marketplace add https://github.com/hardkoded/playwright-claude-mod.git
/plugin install playwright-claude-mod@playwright-claude-mod
```

### 2. Add a json reporter to your Playwright config

The panel reads the results from the json reporter's output file. Add it next to the reporters you already have:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
```

If you skip this step, the panel shows a **Fix** button. Press it, and Claude adds the reporter for you.

### 3. Run your tests

Ask Claude to run the tests, or type `/playwright`. The panel opens with the results.

## How it works

- **Claude's test runs.** After each Bash command that contains `playwright test`, the mod reads the json report and updates the panel. It changes nothing in the command.
- **Stale reports.** The mod checks the report's modified time before and after the run. If the run wrote no new report, the panel keeps the old results and says so.
- **The `--reporter` flag.** A `--reporter` flag on the command line replaces the reporters in the config, json included. So the mod adds a short note to Claude's system prompt: when you pass `--reporter`, also include json and set `PLAYWRIGHT_JSON_OUTPUT_NAME`. For example:

  ```
  PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json npx playwright test --reporter=list,json
  ```

- **The panel's buttons.** They run `npx playwright test` with your config's own reporters, then read the same report. If the config has no json reporter, they ask Playwright for json on the command output instead.
- **Partial runs.** A run of one file or one test updates only those tests. The other tests keep their last result.

## Good to know

- **Where the panel opens.** A pane that you did not open yourself needs a terminal at least 144 columns wide. If another pane is open, such as the diff panel, the Playwright pane opens as a tab behind it. In both cases the status line shows the result and tells you to open the Playwright tab or type `/playwright`. `/playwright` works at any width.
- **Which config.** The mod finds the config in the panel's folder: the folder you gave `/playwright`, or else the folder the session runs in. Start Claude Code in your Playwright project, or open the panel with that folder.
- **How it finds the report.** If the command sets `PLAYWRIGHT_JSON_OUTPUT_NAME` or `PLAYWRIGHT_JSON_OUTPUT_FILE`, the mod reads that file. If not, it searches the config text for `['json', { outputFile: '...' }]`. It does not find a reporter built in code or imported from another file.
- **The html reporter can hang runs.** When a test fails, the html reporter starts a web server and waits. Claude's run then never ends. Set `['html', { open: 'never' }]` to stop that.
- **Background runs.** A run that Claude starts in the background ends after the hook has checked, so the panel does not show it. Press Run all, or ask Claude to run the tests in the foreground.
- **Large reports.** The mod cannot read a json report larger than 4 MiB.
- **One project only.** With several Playwright projects (chromium, firefox), the panel shows the result of the first one.

## Development

Clone the repository and load the plugin from your clone for one session:

```
git clone https://github.com/hardkoded/playwright-claude-mod.git
claude --plugin-dir /path/to/playwright-claude-mod
```

Or install it from your clone, so every session loads it:

```
claude plugin marketplace add /path/to/playwright-claude-mod
claude plugin install playwright-claude-mod@playwright-claude-mod --scope user
```

Claude Code then reads the plugin straight from your clone. After an edit, run `/reload-plugins`.

Check and test the plugin:

```
claude plugin validate .
claude plugin test .
```

## Project structure

```
playwright-claude-mod/
├── .claude-plugin/
│   ├── plugin.json        # plugin manifest
│   └── marketplace.json   # makes this repository a marketplace
├── hooks/
│   ├── hooks.json         # names the hooks module
│   └── register.tsx       # the command, the panel, the Bash hook, the prompt note
├── types/
│   └── index.d.ts         # the panel's state values
└── tests/
    └── panel.test.ts      # runs with `claude plugin test .`
```

## License

MIT. See [LICENSE](LICENSE).
