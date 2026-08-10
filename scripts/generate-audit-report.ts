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
export function generateMarkdownFromSarifFile(sarifFilePath: string): string {
  const content = fs.readFileSync(sarifFilePath, 'utf8')
  const sarifLog = JSON.parse(content) as sarif.SarifLog
  return generateMarkdownFromSarif(sarifLog)
}

/**
 * Generates a Markdown audit report from a SarifLog object
 */
export function generateMarkdownFromSarif(sarifLog: sarif.SarifLog): string {
  const run = sarifLog.runs[0]
  const results = run.results || []

  // If no issues found, return empty content
  if (results.length === 0) {
    return ''
  }

  const rulesMap = new Map<string, sarif.ReportingDescriptor>()

  // Build rule index
  for (const rule of run.tool?.driver?.rules || []) {
    if (rule.id) {
      rulesMap.set(rule.id, rule)
    }
  }

  // Group by severity
  const groupedBySeverity = new Map<string, sarif.Result[]>()
  for (const result of results) {
    const severity = getProperty(result, 'zizmor/severity', 'Informational')
    if (!groupedBySeverity.has(severity)) {
      groupedBySeverity.set(severity, [])
    }
    groupedBySeverity.get(severity)!.push(result)
  }

  // Group by file
  const groupedByFile = new Map<string, sarif.Result[]>()
  for (const result of results) {
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
  lines.push(`Total issues: ${results.length}`)
  lines.push('')

  // Per-file details
  lines.push('## 📁 Details')
  lines.push('')

  for (const [uri, items] of groupedByFile) {
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
      const uriShort = getResultUri(result)
      const line = getResultLine(result)
      const snippet = getSnippet(result)
      const ruleInfo = rulesMap.get(result.ruleId || '')

      lines.push('')
      lines.push('| Severity | Audit Rule | Confidence |')
      lines.push('|:---|:---|:---|')
      lines.push(
        `| ${SEVERITY_ICON[severity] || ''} ${severity} | ${shortRuleId} | ${confidence} |`
      )
      lines.push('')
      lines.push(`**Location**: \`${uriShort}:L${line}\``)
      lines.push(`**Message**: ${msg}`)
      if (ruleInfo?.helpUri) {
        lines.push(`**Documentation**: [view](${ruleInfo.helpUri})`)
      }
      lines.push('')

      if (snippet) {
        lines.push('```yaml')
        lines.push(`${snippet}`)
        lines.push('```')
        lines.push('')
      }

      if (result.codeFlows && result.codeFlows.length > 0) {
        lines.push('<details>')
        lines.push('<summary>🔍 Full Path</summary>')
        lines.push('')
        for (const cf of result.codeFlows) {
          const codeFlow = cf as SarifCodeFlow
          for (const tf of codeFlow.threadFlows || []) {
            for (const loc of tf.locations || []) {
              const phys = loc.location?.physicalLocation
              if (phys) {
                const file = phys.artifactLocation?.uri || '?'
                const ln = phys.region?.startLine ?? '?'
                lines.push(`- \`${file}:L${ln}\``)
              }
            }
          }
        }
        lines.push('')
        lines.push('</details>')
        lines.push('')
      }

      lines.push('')
      lines.push('---')
    }

    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  lines.push('')
  lines.push(`*Report generated at: ${new Date().toLocaleString()}*`)

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
