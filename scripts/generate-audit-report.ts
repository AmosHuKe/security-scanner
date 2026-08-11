import * as sarif from '@microsoft/sarif'
import * as fs from 'fs'

interface SarifCodeFlow {
  threadFlows?: Array<{
    locations?: Array<{
      location?: sarif.Location
    }>
  }>
}

export const SEVERITY_ICON: Record<string, string> = {
  High: '🔴',
  Medium: '🟡',
  Low: '🟢',
  Informational: 'ℹ️',
}

export const SEVERITY_ORDER = ['High', 'Medium', 'Low', 'Informational']

/**
 * Generates a Markdown report from a SARIF file path
 */
export function generateMarkdownFromSarifFile(
  repoBase: string,
  commitSha: string,
  sarifFilePath: string
): string {
  const content = fs.readFileSync(sarifFilePath, 'utf8')
  const sarifLog = JSON.parse(content) as sarif.SarifLog
  return generateMarkdownFromSarif(repoBase, commitSha, sarifLog)
}

/**
 * Generates a Markdown audit report from a SarifLog object
 */
export function generateMarkdownFromSarif(
  repoBase: string,
  commitSha: string,
  sarifLog: sarif.SarifLog,
  maxResults: number = 50
): string {
  const run = sarifLog.runs[0]
  const results = run.results || []

  // If no issues found, return empty content
  if (results.length === 0) {
    return ''
  }

  const sortedResults = results.slice().sort((a, b) => {
    const severityA = getProperty(a, 'zizmor/severity', 'Informational')
    const severityB = getProperty(b, 'zizmor/severity', 'Informational')
    return SEVERITY_ORDER.indexOf(severityA) - SEVERITY_ORDER.indexOf(severityB)
  })
  const truncatedResults = sortedResults.slice(0, maxResults)

  // Build rule index
  const rulesMap = new Map<string, sarif.ReportingDescriptor>()
  for (const rule of run.tool?.driver?.rules || []) {
    if (rule.id) {
      rulesMap.set(rule.id, rule)
    }
  }

  // Group by severity
  const groupedBySeverity = new Map<string, sarif.Result[]>()
  for (const result of truncatedResults) {
    const severity = getProperty(result, 'zizmor/severity', 'Informational')
    if (!groupedBySeverity.has(severity)) {
      groupedBySeverity.set(severity, [])
    }
    groupedBySeverity.get(severity)!.push(result)
  }

  // Group by file
  const groupedByFile = new Map<string, sarif.Result[]>()
  for (const result of truncatedResults) {
    const uri = getResultUri(result)
    if (!groupedByFile.has(uri)) {
      groupedByFile.set(uri, [])
    }
    groupedByFile.get(uri)!.push(result)
  }

  const lines: string[] = []

  // Overview dashboard
  lines.push('## 🔍 Overview')
  lines.push('')
  lines.push('| Severity | Count |')
  lines.push('|:---|:---|')

  for (const severity of SEVERITY_ORDER) {
    const items = groupedBySeverity.get(severity) || []
    if (items.length === 0) continue

    // const confidenceCounts = new Map<string, number>()
    // for (const item of items) {
    //   const confidence = getProperty(item, 'zizmor/confidence', 'Unknown')
    //   confidenceCounts.set(confidence, (confidenceCounts.get(confidence) || 0) + 1)
    // }
    // const confidenceString = Array.from(confidenceCounts.entries())
    //   .map(([k, v]) => `${k}:${v}`)
    //   .join(' / ')

    lines.push(`| ${SEVERITY_ICON[severity] || ''} ${severity} | ${items.length} |`)
  }
  lines.push('')
  // lines.push(`Total issues: ${results.length}`)
  // lines.push('')

  // Per-file details
  lines.push('## 📁 Details')
  lines.push('')

  for (const [uri, items] of groupedByFile) {
    items.sort((a, b) => {
      const sevA = getProperty(a, 'zizmor/severity', 'Informational')
      const sevB = getProperty(b, 'zizmor/severity', 'Informational')
      return SEVERITY_ORDER.indexOf(sevA) - SEVERITY_ORDER.indexOf(sevB)
    })
    const severityCounts = new Map<string, number>()
    for (const item of items) {
      const severity = getProperty(item, 'zizmor/severity', 'Informational')
      severityCounts.set(severity, (severityCounts.get(severity) || 0) + 1)
    }
    const severityTags = Array.from(severityCounts.entries())
      .map(([severity, count]) => `${SEVERITY_ICON[severity] || ''}${severity}(${count})`)
      .join(' ')

    lines.push('<details>')
    lines.push(`<summary>📄 ${uri} - ${severityTags}</summary>`)
    lines.push('')
    lines.push('<br/>')

    for (let idx = 0; idx < items.length; idx++) {
      const result = items[idx]
      const severity = getProperty(result, 'zizmor/severity', 'Informational')
      const confidence = getProperty(result, 'zizmor/confidence', 'Unknown')
      const shortRuleId = getShortRuleId(result.ruleId || 'unknown')
      const msg = result.message?.text || 'No message'
      // const uriShort = getResultUri(result)
      // const line = getResultLine(result)
      // const snippet = getSnippet(result)
      const ruleInfo = rulesMap.get(result.ruleId || '')

      lines.push('')
      lines.push('<table><tbody>')

      lines.push('<tr>')
      lines.push(`<td align="center" rowspan="2"><strong>${idx + 1}</strong></td>`)
      lines.push(`<td align="center"><strong>Severity</strong></td>`)
      lines.push(`<td align="center"><strong>Audit Rule</strong></td>`)
      lines.push(`<td align="center"><strong>Confidence</strong></td>`)
      lines.push('</tr>')

      lines.push('<tr>')
      lines.push(`<td align="center">${SEVERITY_ICON[severity] || ''} ${severity}</td>`)
      lines.push(`<td align="center">${shortRuleId}</td>`)
      lines.push(`<td align="center">${confidence}</td>`)
      lines.push('</tr>')

      lines.push('<tr>')
      lines.push(`<td colspan="4">`)
      lines.push(`<strong>Audit</strong>: ${msg}`)
      if (ruleInfo?.helpUri) {
        lines.push(
          `<br/><strong>Remediation</strong>: <a href="${ruleInfo.helpUri}">view audit</a>`
        )
      }
      lines.push(`</td>`)
      lines.push('</tr>')

      lines.push('</tbody></table>')
      lines.push('')

      if (result.codeFlows && result.codeFlows.length > 0) {
        lines.push('')
        for (const codeFlow of result.codeFlows) {
          const sarifCodeFlow = codeFlow as SarifCodeFlow
          for (const threadFlow of sarifCodeFlow.threadFlows || []) {
            for (const location of threadFlow.locations || []) {
              const physicalLocation = location.location?.physicalLocation
              if (physicalLocation) {
                const file = physicalLocation.artifactLocation?.uri || '?'
                const snippet = physicalLocation.region?.snippet?.text || ''
                const startLine = physicalLocation.region?.startLine
                if (startLine === undefined) continue
                const endLine = physicalLocation.region?.endLine

                const msg = location.location?.message?.text || ''
                if (!msg) continue
                const fileLink = buildGitHubLink(repoBase, commitSha, file, startLine, endLine)
                const fileLinkText = `[${file}#L${startLine}${endLine && endLine > startLine ? `-L${endLine}` : ''}](${fileLink})`

                lines.push(`- ${fileLinkText}`)
                lines.push(`  **Audit**: ${msg}`)
                if (snippet) {
                  const limitedSnippet = limitSnippetLines(snippet, 6).replace(/^/gm, '  ')
                  lines.push('  ')
                  lines.push('  ```yaml')
                  lines.push(`${limitedSnippet}`)
                  lines.push('  ```')
                  lines.push('  ')
                }
              }
            }
          }
        }
      }

      lines.push('---')
      lines.push('')
      lines.push('<br/><br/>')
      lines.push('')
    }

    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  lines.push('<br/>')
  lines.push('')

  return lines.join('\n')
}

/**
 * Safely retrieves an extended property from a SARIF result
 */
export function getProperty<T>(result: sarif.Result, key: string, defaultValue: T): T {
  const value = result.properties?.[key]
  return value !== undefined && value !== null ? (value as T) : defaultValue
}

/**
 * Extracts the short rule ID by removing the prefix (e.g., 'zizmor/')
 */
export function getShortRuleId(ruleId: string): string {
  return ruleId.replace(/^[^\/]+\//, '')
}

/**
 * Returns the URI of the first location of a result
 */
export function getResultUri(result: sarif.Result): string {
  return result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || 'unknown'
}

/**
 * Returns the starting line number of the first location
 */
export function getResultLine(result: sarif.Result): number | string {
  return result.locations?.[0]?.physicalLocation?.region?.startLine ?? '?'
}

/**
 * Returns the full code snippet from the first location
 */
export function getSnippet(result: sarif.Result): string {
  return result.locations?.[0]?.physicalLocation?.region?.snippet?.text || ''
}

function buildGitHubLink(
  repoBase: string,
  commitSha: string,
  filePath: string,
  startLine: number,
  endLine?: number
): string {
  let url = `https://github.com/${repoBase}/blob/${commitSha}/${filePath}#L${startLine}`
  if (endLine && endLine > startLine) {
    url += `-L${endLine}`
  }
  return url
}

function limitSnippetLines(text: string, maxLines: number = 5): string {
  if (!text) return text
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return text
  }
  return lines.slice(0, maxLines).join('\n') + '\n...'
}
