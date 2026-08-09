import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as fs from 'fs'
import path from 'path'

/**
 * Runs the zizmor security scanner, captures its output and exit code,
 * and saves the output to a file for subsequent steps.
 *
 * Environment variables (inputs):
 * - GH_TOKEN       (optional): GitHub token for zizmor online mode (permissions: `contents: read`)
 * - ZIZMOR_CONFIG  (optional): Path to zizmor configuration file
 * - REPO_OPTIONS   (optional): Additional command-line options to pass to zizmor,
 *                              e.g., "--persona=pedantic"
 *
 * Outputs (core.setOutput):
 * - zizmor_exit_code   : Exit code from zizmor (0: success, 11-14: findings detected),
 *                        https://docs.zizmor.sh/usage/#exit-codes
 * - zizmor_output_file : Path to the file containing the combined stdout and stderr output
 */
async function run() {
  try {
    const env = {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN || '',
      ZIZMOR_CONFIG: process.env.ZIZMOR_CONFIG || '',
    }

    const options = (process.env.REPO_OPTIONS || '').trim()
    const args = options ? options.split(/\s+/).filter((s) => s.length > 0) : []
    args.push('.')

    console.info(`🚀 Running: zizmor ${args.join(' ')}`)

    let stdout = ''
    let stderr = ''

    const targetRepoPath = path.join(
      process.env.GITHUB_WORKSPACE || '',
      'security-analysis-target-repo'
    )
    const exitCode = await exec.exec('zizmor', args, {
      cwd: targetRepoPath,
      stdio: 'inherit',
      env: env,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          const chunk = data.toString()
          stdout += chunk
          process.stdout.write(chunk)
        },
        stderr: (data: Buffer) => {
          const chunk = data.toString()
          stderr += chunk
          process.stderr.write(chunk)
        },
      },
    })

    const ZIZMOR_ERROR_CODES = new Set([1, 2, 3])
    if (ZIZMOR_ERROR_CODES.has(exitCode)) {
      core.setFailed(`❌ zizmor tool error (exit code ${exitCode}), please check the output log.`)
      return
    }

    const outputFile = 'zizmor-output.txt'
    fs.writeFileSync(outputFile, stdout + stderr)

    core.setOutput('zizmor_exit_code', exitCode.toString())
    core.setOutput('zizmor_output_file', outputFile)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`❌ zizmor scan failed: ${message}`)
  }
}

run()
