import * as core from '@actions/core'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { z } from 'zod'

const RepoSchema = z.object({
  name: z.string().min(1), // Repository full name (e.g., "owner/repo")
  enabled: z.boolean().optional(), // Whether this repo should be scanned (defaults to true)
  options: z.string().optional(), // Custom command-line options for this repo
})

const ConfigSchema = z.object({
  default_options: z.string().optional(), // Default options applied to all repos
  repositories: z.array(RepoSchema).optional().default([]), // List of repos to scan
})

/**
 * Parses the YAML configuration file, filters repositories, and builds a JSON matrix
 * for GitHub Actions dynamic job matrix.
 *
 * Environment variables (inputs):
 * - CONFIG_PATH (required): Path to the repo list YAML file.
 * - TARGET_REPO (optional): If set, only scan the specified repo (full name, "owner/repo").
 *                           Otherwise, scan all enabled repos.
 *
 * Outputs (core.setOutput):
 * - matrix: A JSON string containing an array of objects for each repository to be scanned.
 */
async function run() {
  try {
    const configPath = process.env.CONFIG_PATH
    if (!configPath) {
      throw new Error('❌ scan_config is not set')
    }
    const fileContents = fs.readFileSync(configPath, 'utf8')
    const configRaw = yaml.load(fileContents)
    const config = ConfigSchema.parse(configRaw)

    const targetRepo = process.env.TARGET_REPO?.trim() || ''

    const defaultOptions = config.default_options || ''
    const repos = (config.repositories || [])
      .filter((repo) => repo.enabled !== false)
      .filter((repo) => {
        if (!targetRepo) return true
        return repo.name === targetRepo
      })
      .map((repo) => {
        const repoOptions = repo.options?.trim()
        const finalOptions = repoOptions && repoOptions.length > 0 ? repoOptions : defaultOptions
        return {
          name: repo.name,
          options: finalOptions,
        }
      })

    const matrixJson = JSON.stringify(repos)
    core.setOutput('matrix', matrixJson)

    console.info(`✅ Generated matrix for ${repos.length} repos:`)
    repos.forEach((repo) => console.info(`  - ${repo.name}`))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`❌ Configuration parsing failed: ${message}`)
  }
}

run()
