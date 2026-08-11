import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  generateMarkdownFromSarif,
  generateMarkdownFromSarifFile,
} from '../scripts/generate-audit-report'
import * as fs from 'fs'
import type { SarifLog, Result, ReportingDescriptor } from '@microsoft/sarif'

jest.mock('fs')
const mockedFs = jest.mocked(fs)

describe('SARIF to Markdown report generator', () => {
  const repoBase = 'owner/repo'
  const commitSha = 'abc123'

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
                  message: { text: 'Flow location message' },
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
    it('should read file and return empty string when no results', () => {
      const mockSarif: SarifLog = createMockSarifLog([])
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockSarif))

      const result = generateMarkdownFromSarifFile(repoBase, commitSha, 'sarif.json')
      expect(mockedFs.readFileSync).toHaveBeenCalledWith('sarif.json', 'utf8')
      expect(result).toBe('')
    })

    it('should throw an error when file does not exist', () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      expect(() =>
        generateMarkdownFromSarifFile(repoBase, commitSha, 'missing-sarif.json')
      ).toThrow('ENOENT')
    })
  })

  describe('generateMarkdownFromSarif', () => {
    it('should return empty string for empty results', () => {
      const sarif = createMockSarifLog([])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)
      expect(markdown).toBe('')
    })

    it('should correctly group by severity and show counts', () => {
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
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain('| 🔴 High | 2 |')
      expect(markdown).toContain('| 🟢 Low | 1 |')
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
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain('## 📁 Details')
      expect(markdown).toContain('<summary>📄 file1.yml - 🔴High(1)</summary>')
      expect(markdown).toContain('<summary>📄 file2.yml - 🔴High(1)</summary>')
      expect(markdown).toContain('<td align="center">🔴 High</td>')
      expect(markdown).toContain('<td align="center">rule-001</td>')
      expect(markdown).toContain('<td align="center">High</td>')
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
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain('<td align="center">🔴 High</td>')
      expect(markdown).toContain('<td align="center">secret-detected</td>')
      expect(markdown).toContain('<td align="center">High</td>')
    })

    it('should show remediation link when rule has helpUri', () => {
      const rule = createMockRule('zizmor/custom-rule', 'https://docs.example.com/custom')
      const result = createMockResult({ ruleId: 'zizmor/custom-rule' })
      const sarif = createMockSarifLog([result], [rule])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain(
        'Remediation</strong>: <a href="https://docs.example.com/custom">view audit</a>'
      )
    })

    it('should display code flow locations when codeFlows exist', () => {
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
                      message: { text: 'First location' },
                    },
                  },
                  {
                    location: {
                      physicalLocation: {
                        artifactLocation: { uri: 'b.yml' },
                        region: { startLine: 2 },
                      },
                      message: { text: 'Second location' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain(
        `[a.yml#L1](https://github.com/${repoBase}/blob/${commitSha}/a.yml#L1)`
      )
      expect(markdown).toContain('**Audit**: First location')
      expect(markdown).toContain(
        `[b.yml#L2](https://github.com/${repoBase}/blob/${commitSha}/b.yml#L2)`
      )
      expect(markdown).toContain('**Audit**: Second location')
    })

    it('should not display code snippet when no code flow message', () => {
      const result = createMockResult({
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'file.yml' },
              region: { startLine: 5, snippet: { text: '  - name: insecure' } },
            },
          },
        ],
        codeFlows: [],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).not.toContain('```yaml')
    })

    it('should handle missing properties (use default values)', () => {
      const result = createMockResult({
        properties: {},
        level: undefined,
        locations: [],
      })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain('<td align="center">ℹ️ Informational</td>')
      expect(markdown).toContain('<td align="center">rule-001</td>')
      expect(markdown).toContain('<td align="center">Unknown</td>')
    })

    it('should handle missing codeFlows without falling back', () => {
      const result = createMockResult({ codeFlows: undefined })
      const sarif = createMockSarifLog([result])
      const markdown = generateMarkdownFromSarif(repoBase, commitSha, sarif)

      expect(markdown).toContain('<td align="center">🔴 High</td>')
    })
  })
})
