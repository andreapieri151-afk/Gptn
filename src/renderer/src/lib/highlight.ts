import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * Curated language set: enough for everyday answers without shipping the entire
 * highlight.js bundle (~1 MB) in the desktop app.
 */
const languages: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml
}

const aliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  shell: 'shell',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  golang: 'go',
  postgres: 'sql',
  postgresql: 'sql'
}

let registered = false

function ensureRegistered(): void {
  if (registered) return
  for (const [name, definition] of Object.entries(languages)) {
    hljs.registerLanguage(name, definition)
  }
  registered = true
}

const DISPLAY_NAMES: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  bash: 'Bash',
  shell: 'Shell',
  json: 'JSON',
  xml: 'HTML',
  cpp: 'C++',
  csharp: 'C#',
  scss: 'SCSS',
  sql: 'SQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  diff: 'Diff'
}

/** Normalises a fence language tag to a registered grammar (or null when unknown). */
export function normalizeLanguage(language: string | undefined): string | null {
  if (!language) return null
  ensureRegistered()
  const clean = language.trim().toLowerCase().split(/[\s:,]/)[0]
  if (!clean) return null
  const resolved = aliases[clean] ?? clean
  return hljs.getLanguage(resolved) ? resolved : null
}

export function languageLabel(language: string | undefined): string {
  const normalized = normalizeLanguage(language)
  if (!normalized) return language?.trim() ? language.trim() : 'Code'
  return DISPLAY_NAMES[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

/** Highlights code and returns HTML safe to inject (hljs escapes the input). */
export function highlightCode(code: string, language: string | undefined): string {
  ensureRegistered()
  const normalized = normalizeLanguage(language)
  try {
    if (normalized) return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
