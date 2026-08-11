import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as sarif from '@microsoft/sarif'
import path from 'path'

/**
 * Runs the zizmor security scanner, captures its output and exit code,
 * and saves the output to a file for subsequent steps.
 *
 * Environment variables (inputs):
 * - GH_TOKEN           (optional): GitHub token for zizmor online mode (permissions: `contents: read`)
 * - ZIZMOR_CONFIG      (optional): Path to zizmor configuration file
 * - REPO_OPTIONS       (optional): Additional command-line options to pass to zizmor,
 *                                  e.g., "--persona=pedantic"
 *
 * Outputs (core.setOutput):
 * - zizmor_exit_code   : Exit code from zizmor (0: success, 11-14: findings detected),
 *                        https://docs.zizmor.sh/usage/#exit-codes
 * - zizmor_sarif_file  : Path to the SARIF file
 */
async function run() {
  try {
    const env = {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN || '',
      ZIZMOR_CONFIG: process.env.ZIZMOR_CONFIG || '',
      REPO_OPTIONS: (process.env.REPO_OPTIONS || '').trim(),
    }

    const targetRepoPath = path.join(
      process.env.GITHUB_WORKSPACE || '',
      'security-analysis-target-repo'
    )

    let args = env.REPO_OPTIONS ? env.REPO_OPTIONS.split(/\s+/).filter((s) => s.length > 0) : []
    args = args.filter((arg) => !arg.startsWith('--format'))
    args.push('--format=sarif')
    args.push('.')

    console.info(`🚀 Running: zizmor ${args.join(' ')}`)

    let stdout = ''
    let stderr = ''

    const exitCode = await exec.exec('zizmor', args, {
      cwd: targetRepoPath,
      stdio: 'pipe',
      env: env,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          const chunk = data.toString()
          stdout += chunk
        },
        stderr: (data: Buffer) => {
          const chunk = data.toString()
          stderr += chunk
          // process.stderr.write(chunk)
        },
      },
    })

    const ZIZMOR_ERROR_CODES = new Set([2])
    if (ZIZMOR_ERROR_CODES.has(exitCode)) {
      core.setFailed(`❌ zizmor tool error (exit code ${exitCode}), please check the output log.`)
      return
    }

    let sarifJson: string
    try {
      const emptySarif: sarif.SarifLog = {
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: '' } },
            results: [],
          },
        ],
      }
      const emptySarifJson: string = JSON.stringify(emptySarif, null, 2)
      switch (exitCode) {
        case 1:
          sarifJson = stderr
          break
        case 3:
          sarifJson = emptySarifJson
          break
        default:
          sarifJson = extractSarifJson(stdout)
          break
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      core.warning(`⚠️ Failed to extract SARIF JSON: ${message}`)
      core.setFailed(`❌ zizmor output did not contain valid SARIF JSON. Raw output: ${stdout}`)
      return
    }

    const sarifFilePath = 'zizmor-sarif-output.json'
    const fullSarifPath = path.join(targetRepoPath, sarifFilePath)
    fs.writeFileSync(fullSarifPath, sarifJson, 'utf8')
    core.setOutput('zizmor_sarif_file', fullSarifPath)
    core.info(`✅ SARIF file saved: ${fullSarifPath}`)

    core.setOutput('zizmor_exit_code', exitCode.toString())
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`❌ zizmor scan failed: ${message}`)
  }
}

/**
 * Extracts the SARIF JSON object from a mixed stdout output containing logs
 */
function extractSarifJson(output: string): string {
  // Find the first '{' and last '}' to extract the JSON portion
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No valid JSON object found in zizmor output')
  }
  return output.substring(start, end + 1)
}

run()
