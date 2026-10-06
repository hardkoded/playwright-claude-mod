import { expect, test } from 'claude-code/testing'

const PANE = { title: 'Playwright', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const CONFIG = "export default defineConfig({ reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]] })"

const spec = (id: string, title: string, status?: string) => ({
  id,
  title,
  file: 'adding.spec.ts',
  line: 3,
  tests: [{ status, results: status ? [{ status: status === 'expected' ? 'passed' : 'failed', duration: 12, error: status === 'unexpected' ? { message: '\u001b[31mExpected 2\u001b[39m' } : undefined }] : [] }],
})
const report = (specs: unknown[]) =>
  JSON.stringify({ suites: [{ title: 'adding.spec.ts', file: 'adding.spec.ts', line: 0, specs: [], suites: [{ title: 'Adding', file: 'adding.spec.ts', line: 1, specs }] }] })
const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('without a json reporter, the buttons read JSON from stdout', async ($, on) => {
  const calls: string[][] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    const listing = e.argv.includes('--list')
    return ran(report(listing ? [spec('a', 'adds one'), spec('b', 'adds two')] : [spec('a', 'adds one', 'expected'), spec('b', 'adds two', 'unexpected')]))
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface, component: 'Pane', requestId: 'playwright', props: PANE })
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ key: 'a' }))?.text).toBe('Adding › adds one')
    expect(await ui.find({ type: 'Text', text: /No json reporter/ })).toBeDefined()

    await ui.press({ key: 'run-all' })
    expect(calls.at(-1)).toEqual(['npx', 'playwright', 'test', '--reporter=json'])
    expect(await ui.find({ type: 'Text', text: /1 of 2 failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Expected 2' })).toBeDefined()

    await ui.press({ key: 'b' })
    expect(calls.at(-1)).toEqual(['npx', 'playwright', 'test', 'adding.spec.ts:3', '--reporter=json'])
    await ui.unmount()
  }
})

test('the Fix button asks Claude to add the json reporter', async ($, on) => {
  const prompts: string[] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ran(report([spec('a', 'adds one')])))
  on('prompt.submit', (_$, e) => (prompts.push(e.text), { text: e.text }))

  const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'fix-reporter' })
  expect(prompts).toEqual(["Add a json reporter to the Playwright config in /proj: ['json', { outputFile: 'test-results/results.json' }]. Keep the existing reporters."])
  expect(await ui.find({ key: 'fix-reporter' })).toBeUndefined()
  await ui.unmount()
})

test("Claude's Bash run shows the results the json reporter wrote", async ($, on) => {
  let mtime = 1
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: mtime++, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  const reads: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    return { value: e.path === '/proj/playwright.config.ts' ? CONFIG : report([spec('a', 'adds one', 'unexpected')]) }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '1 failed', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(reads).toContain('/proj/test-results/results.json')

  const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: PANE })
  expect((await ui.find({ key: 'a' }))?.text).toBe('Adding › adds one')
  expect(await ui.find({ type: 'Text', text: /Claude's run: 1 of 1 failed/ })).toBeDefined()
  expect(await ui.find({ key: 'fix-reporter' })).toBeUndefined()
  await ui.unmount()
})

test('a run that writes no json report keeps the old results', async ($, on) => {
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 5, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' ? CONFIG : report([spec('a', 'adds one', 'unexpected')]) }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '1 passed', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --reporter=list' })

  const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: PANE })
  expect(await ui.find({ type: 'Text', text: /This run wrote no json report/ })).toBeDefined()
  expect(await ui.find({ key: 'a' })).toBeUndefined()
  await ui.unmount()
})

test('the system prompt tells the agent to keep the json reporter', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hi', scope: 'shared' as const }] }))

  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(sections.map(section => section.id)).toEqual(['intro', 'playwright-claude-mod:json-reporter'])
  expect(sections.at(-1)?.text).toContain('--reporter=list,json')
})

test('a pane that cannot be seated still tells the person the results', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let mtime = 1
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: mtime++, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' ? CONFIG : report([spec('a', 'adds one', 'expected')]) }))
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'under 144 columns' } }))
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '1 passed', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(statuses).toEqual(["Playwright: Claude's run: 1 passed. Open the Playwright tab or type /playwright."])
})

test('a pane behind another tab gets the status line, a shown pane clears it', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let mtime = 1
  let isShown = false
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: mtime++, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' ? CONFIG : report([spec('a', 'adds one', 'unexpected')]) }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [{ id: 'playwright', title: 'Playwright', isShown, isFocused: false, isPlaced: true }] }))
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '1 failed', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  isShown = true
  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(statuses).toEqual(["Playwright: Claude's run: 1 of 1 failed. Open the Playwright tab or type /playwright.", undefined])
})

test('a failed pane open still gets the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let mtime = 1
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: mtime++, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' ? CONFIG : 'not json' }))
  on('ui.open', () => ({ deny: 'no surface' }))
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(statuses).toEqual(['Playwright: Error: no JSON report Open the Playwright tab or type /playwright.'])
})

test('commands that only mention playwright test, and background runs, are left alone', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix playwright test flake"' })
  await $.tool.call({ tool: 'Bash', command: 'npx playwright test', run_in_background: true })
  expect(statuses).toEqual([])
})

test('a panel run that writes no new report keeps the old results', async ($, on) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 5, isLink: false } }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' ? CONFIG : report([spec('a', 'adds one', 'expected')]) }))
  const runs: { argv: string[]; env?: Record<string, string> }[] = []
  on('process.run', (_$, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return ran(e.argv.includes('--list') ? report([spec('a', 'adds one')]) : '')
  })

  const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: PANE })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'run-all' })
  expect(runs.at(-1)).toEqual({ argv: ['npx', 'playwright', 'test'], env: { PW_TEST_HTML_REPORT_OPEN: 'never' } })
  expect(await ui.find({ type: 'Text', text: /This run wrote no json report/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ 1 {2}total 1/ })).toBeDefined()
  await ui.unmount()
})

test('a run that names its json file reads that file, with no reporter in the config', async ($, on) => {
  let mtime = 1
  const reads: string[] = []
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: mtime++, isLink: false } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/proj/playwright.config.ts' }))
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    return { value: e.path === '/proj/playwright.config.ts' ? "export default { reporter: [['html'], ['list']] }" : report([spec('a', 'adds one', 'expected')]) }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '1 passed', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json npx playwright test --reporter=list,json 2>&1 | tail -80' })
  expect(reads).toEqual(['/proj/test-results/results.json'])

  const ui = await $.ui.mount({ plugin: 'playwright-claude-mod', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: PANE })
  expect(await ui.find({ type: 'Text', text: /Claude's run: 1 passed/ })).toBeDefined()
  expect(await ui.find({ key: 'fix-reporter' })).toBeUndefined()
  await ui.unmount()
})
