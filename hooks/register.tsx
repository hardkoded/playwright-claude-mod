import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TestItem, TestStatus } from '../types'

const PANE = 'playwright'
const TITLE = 'Playwright'
const dir = atom({ plugin: 'playwright-claude-mod', key: 'dir' } as const, '')
const tests = atom({ plugin: 'playwright-claude-mod', key: 'tests' } as const, [])
const isBusy = atom({ plugin: 'playwright-claude-mod', key: 'isBusy' } as const, false)
const message = atom({ plugin: 'playwright-claude-mod', key: 'message' } as const, '')
const needsReporter = atom({ plugin: 'playwright-claude-mod', key: 'needsReporter' } as const, false)

const CONFIGS = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map(ext => `playwright.config.${ext}`)
// Matches `['json', { outputFile: 'results.json' }]` in the config's reporter list.
const JSON_REPORTER = /\[\s*['"]json['"]\s*,\s*\{[^}]*outputFile\s*:\s*['"`]([^'"`]+)['"`]/
// The json reporter's file, set for one run: `PLAYWRIGHT_JSON_OUTPUT_NAME=out.json npx playwright test`.
const JSON_OUTPUT_ENV = /\bPLAYWRIGHT_JSON_OUTPUT_(?:NAME|FILE)=(['"]?)([^'"\s]+)\1/
const HINT = "No json reporter with an outputFile. Add ['json', { outputFile: 'test-results/results.json' }] to reporter in the Playwright config."
const FIX_PROMPT = (cwd: string) =>
  `Add a json reporter to the Playwright config in ${cwd}: ['json', { outputFile: 'test-results/results.json' }]. Keep the existing reporters.`
// A command that starts `playwright test`: at the line start, after ; & | ( or after env assignments,
// optionally through npx, pnpm (exec), yarn or bunx. A mention inside quotes does not match.
const PLAYWRIGHT_TEST = /(?:^|[;&|(]\s*)(?:\w+=\S*\s+)*(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx\s+)?playwright\s+test\b/m
const NO_REPORT = "This run wrote no json report, so the results did not change. A --reporter flag replaces the config's reporters."
// A --reporter flag drops the config's reporters, json included, so the agent is told how to keep it.
const REPORTER_NOTE = {
  id: 'playwright-claude-mod:json-reporter',
  scope: 'session',
  text: "A side panel shows Playwright results from the json reporter's outputFile in the Playwright config. When you pass --reporter to `playwright test`, also include json and set PLAYWRIGHT_JSON_OUTPUT_NAME to that outputFile, for example `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json npx playwright test --reporter=list,json`. Without --reporter, the config's reporters already write it.",
} as const

const ICONS: Record<TestStatus, string> = {
  idle: '○',
  running: '◌',
  passed: '✓',
  failed: '✗',
  skipped: '–',
  flaky: '!',
}
const COLORS: Record<TestStatus, string | undefined> = {
  idle: 'inactive',
  running: 'warning',
  passed: 'success',
  failed: 'error',
  skipped: 'inactive',
  flaky: 'warning',
}

type Spec = {
  id: string
  title: string
  file: string
  line: number
  tests: { status?: string; results: { status: string; duration: number; error?: { message?: string } }[] }[]
}
type Suite = { title: string; file: string; line: number; specs: Spec[]; suites?: Suite[] }

// Playwright prints colored errors; the pane draws plain text.
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

function statusOf(spec: Spec): TestStatus {
  const test = spec.tests[0]
  if (!test || test.results.length === 0) return 'idle'
  if (test.status === 'flaky') return 'flaky'
  if (test.status === 'skipped') return 'skipped'
  return test.status === 'expected' ? 'passed' : 'failed'
}

function flatten(suites: Suite[], parents: string[] = []): TestItem[] {
  return suites.flatMap(suite => {
    // The top suite is the file; its title adds nothing to a test's name.
    const path = suite.line === 0 ? parents : [...parents, suite.title]
    const own = suite.specs.map(spec => {
      const last = spec.tests[0]?.results.at(-1)
      const error = last?.error?.message
      return {
        id: spec.id,
        file: spec.file,
        line: spec.line,
        title: [...path, spec.title].join(' › '),
        status: statusOf(spec),
        durationMs: last?.duration,
        error: error ? stripAnsi(error).split('\n').slice(0, 4).join('\n') : undefined,
      }
    })
    return [...own, ...flatten(suite.suites ?? [], path)]
  })
}

function parseReport(text: string): TestItem[] {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('no JSON report')
  const report = JSON.parse(text.slice(start)) as { suites: Suite[]; errors?: { message: string }[] }
  const fatal = report.errors?.[0]?.message
  if (fatal && report.suites.length === 0) throw new Error(stripAnsi(fatal).split('\n')[0])
  return flatten(report.suites)
}

// 0 when the file does not exist yet.
const modifiedAt = ($: EngineInterface, path: string) => $.fs.stat(path).then(stat => stat.mtimeMs, () => 0)

const projectDir = async ($: EngineInterface) => (await read($, dir)) || (await $.session.cwd())

// The json reporter's outputFile from the project's config, as an absolute path.
async function findReportFile($: EngineInterface, cwd: string): Promise<string | undefined> {
  for (const name of CONFIGS) {
    if (!(await $.fs.exists(`${cwd}/${name}`))) continue
    const outputFile = JSON_REPORTER.exec(await $.fs.read(`${cwd}/${name}`))?.[1]
    return outputFile && absolute(cwd, outputFile)
  }
  return undefined
}

const absolute = (cwd: string, file: string) => (file.startsWith('/') ? file : `${cwd}/${file.replace(/^\.\//, '')}`)

// With a json reporter configured, runs with the config's own reporters and reads its file;
// without one, asks for JSON on stdout.
async function playwright($: EngineInterface, args: string[]): Promise<TestItem[]> {
  const cwd = await projectDir($)
  const reportFile = args.includes('--list') ? undefined : await findReportFile($, cwd)
  const reporter = reportFile ? [] : ['--reporter=json']
  const before = reportFile && (await modifiedAt($, reportFile))
  const run = await $.process.run(['npx', 'playwright', 'test', ...args, ...reporter], {
    cwd,
    // The html reporter serves its report after a failure and waits; that would hold the panel busy.
    env: { PW_TEST_HTML_REPORT_OPEN: 'never' },
    timeoutMs: 600_000,
  })
  try {
    if (reportFile && (await modifiedAt($, reportFile)) === before) throw new Error(NO_REPORT)
    return parseReport(reportFile ? await $.fs.read(reportFile) : run.stdout)
  } catch (error) {
    throw new Error(stripAnsi(run.stderr).trim() || (error as Error).message)
  }
}

// Results of a partial run update the tests they cover and keep the rest.
function merge(list: TestItem[], ran: TestItem[]): TestItem[] {
  const results = new Map(ran.map(test => [test.id, test]))
  const known = new Set(list.map(test => test.id))
  return [...list.map(test => results.get(test.id) ?? test), ...ran.filter(test => !known.has(test.id))]
}

const summary = (ran: TestItem[]) => {
  const failed = ran.filter(test => test.status === 'failed').length
  return failed ? `${failed} of ${ran.length} failed.` : `${ran.length} passed.`
}

// Checked and set with no await between, so two quick presses cannot both start a run.
let isRunning = false

async function busy($: EngineInterface, label: string, work: () => Promise<string>) {
  if (isRunning) return
  isRunning = true
  try {
    await update($, isBusy, () => true)
    await update($, message, () => label)
    const done = await work()
    await update($, message, () => done)
  } catch (error) {
    await update($, message, () => `Error: ${(error as Error).message}`)
  } finally {
    isRunning = false
    await update($, isBusy, () => false)
  }
}

const discover = ($: EngineInterface) =>
  busy($, 'Loading tests…', async () => {
    const found = await playwright($, ['--list'])
    const known = new Map((await read($, tests)).map(test => [test.id, test]))
    // Keep the last result of each test we already ran.
    await update($, tests, () => found.map(test => ({ ...test, ...pick(known.get(test.id)) })))
    const hasReport = await findReportFile($, await projectDir($))
    await update($, needsReporter, () => !hasReport)
    return hasReport ? `Found ${found.length} tests.` : `Found ${found.length} tests. ${HINT}`
  })

const pick = (test: TestItem | undefined) =>
  test && { status: test.status, durationMs: test.durationMs, error: test.error }

// The config can take many shapes, so Claude makes the edit and the person reviews it.
async function fixReporter($: EngineInterface) {
  await update($, needsReporter, () => false)
  await update($, message, () => 'Asked Claude to add the json reporter.')
  await $.prompt.submit({ text: FIX_PROMPT(await projectDir($)), asUser: true })
}

const runTests = ($: EngineInterface, only?: TestItem) =>
  busy($, only ? `Running ${only.title}…` : 'Running all tests…', async () => {
    await update($, tests, list =>
      list.map(test => (!only || test.id === only.id ? { ...test, status: 'running' as const } : test)),
    )
    try {
      const ran = await playwright($, only ? [`${only.file}:${only.line}`] : [])
      await update($, tests, list => (only ? merge(list, ran) : ran))
      return summary(ran)
    } finally {
      // A failed run, or a report that does not hold the test, leaves nothing marked running.
      await update($, tests, list =>
        list.map(test => (test.status === 'running' ? { ...test, status: 'idle' as const } : test)),
      )
    }
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'playwright',
      description: 'Show Playwright tests and results in a side panel',
      argumentHint: '[project folder]',
    })
    return next(e)
  })

  on('command.run', { command: 'playwright' }, async ($, e) => {
    void $.ui.status(undefined)
    const folder = e.args.trim() || (await $.session.cwd())
    await update($, dir, () => folder)
    await $.ui.open({ id: PANE, title: TITLE })
    void discover($)
    return { text: `Playwright panel opened for ${folder}.` }
  })

  // When Claude runs the tests through Bash, show what the json reporter wrote.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // A background run returns before Playwright writes its report, so there is nothing to read yet.
    if (!PLAYWRIGHT_TEST.test(e.command) || /--list\b/.test(e.command) || e.run_in_background) return next(e)
    const cwd = await projectDir($)
    // A file the command names for its run wins over the config's.
    const named = JSON_OUTPUT_ENV.exec(e.command)?.[2]
    const reportFile = named ? absolute(cwd, named) : await findReportFile($, cwd)
    const before = reportFile && (await modifiedAt($, reportFile))
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    try {
      await update($, needsReporter, () => !reportFile)
      if (!reportFile) {
        await update($, message, () => HINT)
      } else if ((await modifiedAt($, reportFile)) === before) {
        await update($, message, () => NO_REPORT)
      } else {
        const results = parseReport(await $.fs.read(reportFile))
        await update($, tests, list => merge(list, results))
        await update($, message, () => `Claude's run: ${summary(results)}`)
      }
    } catch (error) {
      await update($, message, () => `Error: ${(error as Error).message}`)
    }
    // An unasked pane waits on a narrow terminal, or opens as a tab behind another pane (the diff
    // panel), and only `focus` raises it, which takes the keyboard. Anything short of a pane known
    // to be shown, a failed open included, gets the status line.
    const isShown = await $.ui
      .open({ id: PANE, title: TITLE })
      .then(async opened => opened.isPlaced && (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown))
      .catch(() => false)
    void $.ui.status(isShown ? undefined : `Playwright: ${await read($, message)} Open the Playwright tab or type /playwright.`)
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, REPORTER_NOTE] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tests)
    const folder = await read($, dir)
    const working = await read($, isBusy)
    const note = await read($, message)
    const canFix = await read($, needsReporter)
    const count = (status: TestStatus) => list.filter(test => test.status === status).length
    const files = [...new Set(list.map(test => test.file))]

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-start">{folder}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="run-all" hotkey="r" variant="primary" onPress={() => runTests($)}>
            Run all
          </Button>
          <Button key="refresh" hotkey="l" onPress={() => discover($)}>
            Refresh
          </Button>
          {canFix && (
            <Button key="fix-reporter" hotkey="f" onPress={() => fixReporter($)}>
              Fix
            </Button>
          )}
        </Box>
        <Text>
          <Text color="success">✓ {count('passed')}</Text>{'  '}
          <Text color="error">✗ {count('failed')}</Text>{'  '}
          <Text dimColor>○ {count('idle')}  total {list.length}</Text>
        </Text>
        {note !== '' && <Text color={working ? 'warning' : undefined} wrap="wrap">{note}</Text>}
        {files.map(file => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold wrap="truncate-start">{file}</Text>
            {list
              .filter(test => test.file === file)
              .map(test => (
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text color={COLORS[test.status]}>{ICONS[test.status]}</Text>
                    <Button key={test.id} plain dimColor={test.status === 'idle'} onPress={() => runTests($, test)}>
                      {test.title}
                    </Button>
                    {test.durationMs !== undefined && test.status !== 'running' && (
                      <Text dimColor>{test.durationMs}ms</Text>
                    )}
                  </Box>
                  {test.status === 'failed' && test.error && (
                    <Box paddingLeft={2}>
                      <Text color="error" wrap="wrap">{test.error}</Text>
                    </Box>
                  )}
                </Box>
              ))}
          </Box>
        ))}
      </Box>
    )
  })
}
