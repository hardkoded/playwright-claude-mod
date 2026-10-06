export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped' | 'flaky'

export type TestItem = {
  id: string
  file: string
  line: number
  title: string
  status: TestStatus
  durationMs?: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'playwright-claude-mod': {
      dir: string
      tests: TestItem[]
      isBusy: boolean
      needsReporter: boolean
      message: string
    }
  }
}
