import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  generateMarkdownFromSarif,
  generateMarkdownFromSarifFile,
  SEVERITY_ORDER,
  SEVERITY_ICON,
} from '../scripts/generate-audit-report'
import * as fs from 'fs'
import type { SarifLog, Result, ReportingDescriptor } from '@microsoft/sarif'

jest.mock('fs')
const mockedFs = jest.mocked(fs)

describe('SARIF to Markdown report generator', () => {
  // Mock base SARIF data
  const createMockResult = (overrides: Partial<Result> = {}): Result => ({
    ruleId: 'zizmor/rule-001',
    level: 'warning',
    message: { text: 'Test message' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'src/main.yml' },
          region: { startLine: 10, snippet: { text: '  - name: test' } },
        },
      },
    ],
    properties: {
      'zizmor/severity': 'High',
      'zizmor/confidence': 'High',
      'zizmor/persona': 'Pedantic',
    },
    codeFlows: [
      {
        threadFlows: [
          {
            locations: [
              {
                location: {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/main.yml' },
                    region: { startLine: 1 },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  })

  const createMockRule = (id: string, helpUri?: string): ReportingDescriptor => ({
    id,
    helpUri: helpUri || `https://example.com/rule/${id}`,
  })

  const createMockSarifLog = (results: Result[], rules: ReportingDescriptor[] = []): SarifLog => ({
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'zizmor',
            rules: rules.length ? rules : results.map((r) => createMockRule(r.ruleId || 'unknown')),
          },
        },
        results,
      },
    ],
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('generateMarkdownFromSarifFile', () => {
    it('should read file and call generateMarkdownFromSarif', () => {
      const mockSarif: SarifLog = createMockSarifLog([])
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockSarif))

      const result = generateMarkdownFromSarifFile('dummy.sarif')
      expect(mockedFs.readFileSync).toHaveBeenCalledWith('dummy.sarif', 'utf8')
      expect(result).not.toContain('# 🔍 Security Audit Report')
    })

    it('should throw an error when file does not exist', () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      expect(() => generateMarkdownFromSarifFile('missing.sarif')).toThrow('ENOENT')
    })
  })

  describe('generateMarkdownFromSarif', () => {
    it('should generate correct header and overview for empty results', () => {
      const sarif = createMockSarifLog([])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).not.toContain('## 📊 Overview')
      expect(markdown).not.toContain('| Severity | Count | Confidence Distribution |')
      SEVERITY_ORDER.forEach((sev) => {
        expect(markdown).not.toContain(`| ${SEVERITY_ICON[sev]} ${sev} |`)
      })
    })

    it('should correctly group by severity and show confidence distribution', () => {
      const results = [
        createMockResult({
          properties: { 'zizmor/severity': 'High', 'zizmor/confidence': 'High' },
        }),
        createMockResult({
          properties: { 'zizmor/severity': 'High', 'zizmor/confidence': 'Medium' },
        }),
        createMockResult({ properties: { 'zizmor/severity': 'Low', 'zizmor/confidence': 'Low' } }),
      ]
      const sarif = createMockSarifLog(results)
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('| 🔴 High | 2 | High:1 / Medium:1 |')
      expect(markdown).toContain('| 🟢 Low | 1 | Low:1 |')
      expect(markdown).not.toContain('| ℹ️ Informational')
    })

    it('should group by file and display issue details under each file', () => {
      const results = [
        createMockResult({
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'file1.yml' },
                region: { startLine: 5 },
              },
            },
          ],
        }),
        createMockResult({
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'file2.yml' },
                region: { startLine: 10 },
              },
            },
          ],
        }),
      ]
      const sarif = createMockSarifLog(results)
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('## 📁 Details')
      expect(markdown).toContain('### 📄 `file1.yml`')
      expect(markdown).toContain('### 📄 `file2.yml`')
      expect(markdown).toContain('#### 🔴 #1 `rule-001`')
      expect(markdown).not.toContain('#### 🔴 #2 `rule-001`')
    })

    it('should correctly display the attribute table for each issue', () => {
      const result = createMockResult({
        ruleId: 'zizmor/secret-detected',
        level: 'error',
        message: { text: 'Hardcoded secret found' },
        properties: {
          'zizmor/severity': 'High',
          'zizmor/confidence': 'High',
          'zizmor/persona': 'Pedantic',
        },
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('| 🔴 High | High |')
    })

    it('should show documentation link when rule has helpUri', () => {
      const rule = createMockRule('zizmor/custom-rule', 'https://docs.example.com/custom')
      const result = createMockResult({ ruleId: 'zizmor/custom-rule' })
      const sarif = createMockSarifLog([result], [rule])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('📖 [View Documentation](https://docs.example.com/custom)')
    })

    it('should generate collapsible full path when codeFlows exist', () => {
      const result = createMockResult({
        codeFlows: [
          {
            threadFlows: [
              {
                locations: [
                  {
                    location: {
                      physicalLocation: {
                        artifactLocation: { uri: 'a.yml' },
                        region: { startLine: 1 },
                      },
                    },
                  },
                  {
                    location: {
                      physicalLocation: {
                        artifactLocation: { uri: 'b.yml' },
                        region: { startLine: 2 },
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('<details>')
      expect(markdown).toContain('<summary>🔍 Full Path</summary>')
      expect(markdown).toContain('- `a.yml:L1`')
      expect(markdown).toContain('- `b.yml:L2`')
      expect(markdown).toContain('</details>')
    })

    it('should display code snippet', () => {
      const result = createMockResult({
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'file.yml' },
              region: { startLine: 5, snippet: { text: '  - name: insecure' } },
            },
          },
        ],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('```yaml')
      expect(markdown).toContain('5 |   - name: insecure')
      expect(markdown).toContain('```')
    })

    it('should handle missing properties (use default values)', () => {
      const result = createMockResult({
        properties: {},
        level: undefined,
        locations: [],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(sarif)

      expect(markdown).toContain('| ℹ️ Informational | Unknown |')
    })

    it('should handle missing codeFlows or locations gracefully', () => {
      const result = createMockResult({ codeFlows: undefined })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(sarif)
      expect(markdown).not.toContain('<details>')
    })
  })
})
