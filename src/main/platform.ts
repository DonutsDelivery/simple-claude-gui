import * as os from 'os'
import * as path from 'path'

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

// PATH separator: ; on Windows, : on Unix
export const PATH_SEP = isWindows ? ';' : ':'

// Get home directory (works cross-platform via os.homedir())
// Windows: C:\Users\<user>
// Unix: /home/<user>
export const homeDir = os.homedir()

// Get the default shell for the platform
export function getDefaultShell(): string {
  if (isWindows) {
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

// Get PowerShell path on Windows (preferred for Claude Code)
export function getPowerShell(): string {
  // PowerShell Core (cross-platform) or Windows PowerShell
  return process.env.PROGRAMFILES
    ? path.join(process.env.PROGRAMFILES, 'PowerShell', '7', 'pwsh.exe')
    : 'powershell.exe'
}

// Get additional paths to search for executables
export function getAdditionalPaths(): string[] {
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
    return [
      path.join(appData, 'npm'),
      path.join(localAppData, 'Programs', 'nodejs'),
      path.join(homeDir, '.local', 'bin'),
      path.join(homeDir, '.cargo', 'bin'),
    ]
  }

  // Unix paths
  return [
    path.join(homeDir, '.nvm/versions/node/v20.18.1/bin'),
    path.join(homeDir, '.nvm/versions/node/v22.11.0/bin'),
    path.join(homeDir, '.local/bin'),
    path.join(homeDir, '.npm-global/bin'),
    path.join(homeDir, '.cargo/bin'),
    '/usr/local/bin',
  ]
}

// Build enhanced PATH environment variable
export function getEnhancedPath(): string {
  const additionalPaths = getAdditionalPaths()
  const currentPath = process.env.PATH || ''
  return [...additionalPaths, currentPath].join(PATH_SEP)
}
