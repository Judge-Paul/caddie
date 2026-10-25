import { tmpdir } from 'node:os'

const ALLOWED = [
  'FONTCONFIG_FILE',
  'FONTCONFIG_PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PATH',
  'TMPDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
] as const

/**
 * Renderer and PDF helpers are untrusted parsers. Give them the executable
 * path and font configuration they need, but never the application's secrets.
 */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || tmpdir(),
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8',
    SAL_USE_VCLPLUGIN: 'headless',
    ...extra,
  }
  for (const name of ALLOWED) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  return env
}
