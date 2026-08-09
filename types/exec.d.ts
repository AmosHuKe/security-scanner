import { StdioOptions } from 'child_process'

declare module '@actions/exec' {
  export interface ExecOptions {
    stdio?: StdioOptions
  }
}
