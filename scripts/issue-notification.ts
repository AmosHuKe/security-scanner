import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import { generateMarkdownFromSarifFile } from './generate-audit-report'

/**
 * Notifies about CI/CD security scan results
 * by creating, updating, or closing GitHub Issues
 *
 * Environment variables (inputs):
 * - GH_TOKEN           (required): GitHub token (permissions: `issues: write`)
 * - REPO_NAME          (required): Full repository name (e.g., "owner/repo")
 * - REPO_COMMIT_SHA    (required): Commit SHA of the target repository (e.g., "b904b1c321c6fe714e10a1423265d06276cc0e47")
 * - NOTIFY_USERS       (optional): JSON array of GitHub usernames to @mention in the issue (e.g., '["user1","user2"]' default: "[]")
 * - ZIZMOR_EXIT_CODE   (optional): Exit code from zizmor (0: success, 11-14: findings detected)
 * - ZIZMOR_SARIF_FILE  (optional): SARIF file path (default: "zizmor-sarif-output.json")
 */
async function run() {
  try {
    const token = process.env.GH_TOKEN
    if (!token) {
      throw new Error('❌ GH_TOKEN is not set')
    }

    // const exitCodeStr = process.env.ZIZMOR_EXIT_CODE
    // const exitCode = parseInt(exitCodeStr || '0', 10)
    const sarifFile = process.env.ZIZMOR_SARIF_FILE || 'zizmor-sarif-output.json'

    const repoName = process.env.REPO_NAME
    if (!repoName) {
      throw new Error('❌ REPO_NAME environment variable is not set')
    }
    const repoCommitSha = process.env.REPO_COMMIT_SHA
    if (!repoCommitSha) {
      throw new Error('❌ REPO_COMMIT_SHA environment variable is not set')
    }

    const notifyUsersRaw = process.env.NOTIFY_USERS || '[]'
    let notifyUsers: string[] = []
    try {
      notifyUsers = JSON.parse(notifyUsersRaw)
      if (!Array.isArray(notifyUsers)) {
        notifyUsers = []
      }
    } catch {
      notifyUsers = []
    }

    const mentions =
      notifyUsers.length > 0
        ? `🔔 ${notifyUsers.map((user) => `@${user.trim()}`).join(' | ')} \n\n`
        : ''

    let issueBody: string

    if (sarifFile && fs.existsSync(sarifFile)) {
      try {
        const markdown = generateMarkdownFromSarifFile(repoName, repoCommitSha, sarifFile)
        issueBody = markdown
        core.info(`✅ Generated Markdown report from SARIF file: ${sarifFile}`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        core.info(`⚠️ Failed to generate report from SARIF: ${message}`)
        issueBody = ''
      }
    } else {
      issueBody = ''
    }

    // If body is empty (no issues found)
    const hasFindings = issueBody && issueBody.trim() !== ''

    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo

    const issueMarker = `<!-- security-issue-marker: ${repoName} -->`
    const issueTitle = `[CI/CD Security] ${repoName} - Issue Report`
    const finalIssueBody =
      `${issueMarker} \n\n` +
      `## 📦 ${repoName} \n\n` +
      `📌 Commit SHA: [${repoCommitSha}](https://github.com/${repoName}/tree/${repoCommitSha}) \n\n` +
      `${mentions}` +
      `🕜 Report generated at: ${new Date().toUTCString()}` +
      `\n\n` +
      `${issueBody}`

    const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })

    const existingOpenIssue = allIssues.find(
      (issue) => !issue.pull_request && issue.body?.includes(issueMarker)
    )

    if (hasFindings) {
      // Findings detected
      if (existingOpenIssue) {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: existingOpenIssue.number,
          title: issueTitle,
          body: finalIssueBody,
        })
        core.info(`✅ Updated open issue #${existingOpenIssue.number} with new scan results`)
      } else {
        await octokit.rest.issues.create({
          owner,
          repo,
          title: issueTitle,
          body: finalIssueBody,
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
