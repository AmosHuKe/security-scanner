import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'

/**
 * Notifies about CI/CD security scan results
 * by creating, updating, or closing GitHub Issues
 *
 * Environment variables (inputs):
 * - GH_TOKEN           (required): GitHub token (permissions: `issues: write`)
 * - REPO_NAME          (required): Full repository name (e.g., "owner/repo")
 * - ZIZMOR_EXIT_CODE   (optional): Exit code from zizmor (0: success, 11-14: findings detected)
 * - ZIZMOR_OUTPUT_FILE (optional): Path to the zizmor output file (default: "zizmor-output.txt")
 */
async function run() {
  try {
    const token = process.env.GH_TOKEN
    if (!token) {
      throw new Error('❌ GH_TOKEN is not set')
    }

    const exitCodeStr = process.env.ZIZMOR_EXIT_CODE
    const exitCode = parseInt(exitCodeStr || '0', 10)
    const outputFile = process.env.ZIZMOR_OUTPUT_FILE || 'zizmor-output.txt'

    const repoName = process.env.REPO_NAME
    if (!repoName) {
      throw new Error('❌ REPO_NAME environment variable is not set')
    }

    let outputBody = ''
    try {
      outputBody = fs.readFileSync(outputFile, 'utf8')
    } catch {
      outputBody = 'No output captured.'
    }

    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo

    const issueMarker = `<!-- security-issue-marker: ${repoName} -->`
    const issueTitle = `[CI/CD Security] ${repoName} - Issue Report`
    const issueBody = `
## Issues detected in \`${repoName}\`

\`\`\`
${outputBody}
\`\`\`

${issueMarker}
`.trim()

    const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })

    const existingOpenIssue = allIssues.find(
      (issue) => !issue.pull_request && issue.body?.includes(issueMarker)
    )
    const isFailure = exitCode !== 0

    if (isFailure) {
      // Findings detected
      if (existingOpenIssue) {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: existingOpenIssue.number,
          title: issueTitle,
          body: issueBody,
        })
        core.info(`✅ Updated open issue #${existingOpenIssue.number} with new scan results`)
      } else {
        await octokit.rest.issues.create({
          owner,
          repo,
          title: issueTitle,
          body: issueBody,
        })
        core.info(`✅ Created new issue for ${repoName}`)
      }
    } else {
      // No findings
      if (existingOpenIssue) {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: existingOpenIssue.number,
          state: 'closed',
        })
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: existingOpenIssue.number,
          body: `✅ Scan passed on ${new Date().toISOString()}. Closing this issue.`,
        })
        core.info(`✅ Closed issue #${existingOpenIssue.number} `)
      } else {
        core.info('✅ No open issue to close.')
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`❌ Issue notification failed: ${message} `)
  }
}

run()
