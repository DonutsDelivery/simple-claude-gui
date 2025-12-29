import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import { isWindows, getEnhancedPathWithPortable, getAdditionalPaths } from './platform'
import { getPortableBinDirs } from './portable-deps'

interface ClaudeProcess {
  id: string
  pty: pty.IPty
  cwd: string
  sessionId?: string
}

function getEnhancedEnv(): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
  const enhancedPath = getEnhancedPathWithPortable()

  // On Windows, environment variables are case-insensitive but we need to set the right one
  if (isWindows) {
    // Windows uses 'Path' but Node sometimes uses 'PATH' - set both to be safe
    env.PATH = enhancedPath
    env.Path = enhancedPath

    // Claude Code on Windows requires git-bash - try to find and set it
    if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
      ]
      for (const bashPath of gitBashPaths) {
        if (fs.existsSync(bashPath)) {
          env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
          console.log('Found git-bash at:', bashPath)
          break
        }
      }
    }
  } else {
    env.PATH = enhancedPath
  }

  console.log('Enhanced PATH for PTY:', enhancedPath.substring(0, 200) + '...')
  return env
}

// Find claude executable - on Windows, npm installs .cmd files
function findClaudeExecutable(): string {
  if (!isWindows) {
    return 'claude'
  }

  // On Windows, check for claude.cmd in portable npm-global first
  const portableDirs = getPortableBinDirs()
  for (const dir of portableDirs) {
    const claudeCmd = path.join(dir, 'claude.cmd')
    if (fs.existsSync(claudeCmd)) {
      console.log('Found Claude at (portable):', claudeCmd)
      return claudeCmd
    }
  }

  // Then check for claude.cmd in system npm paths
  const additionalPaths = getAdditionalPaths()
  for (const dir of additionalPaths) {
    const claudeCmd = path.join(dir, 'claude.cmd')
    if (fs.existsSync(claudeCmd)) {
      console.log('Found Claude at:', claudeCmd)
      return claudeCmd
    }
  }

  // Fall back to just 'claude' and let PATH resolve it
  return 'claude'
}

export class PtyManager {
  private processes: Map<string, ClaudeProcess> = new Map()
  private dataCallbacks: Map<string, (data: string) => void> = new Map()
  private exitCallbacks: Map<string, (code: number) => void> = new Map()

  spawn(cwd: string, sessionId?: string): string {
    const id = crypto.randomUUID()

    const args: string[] = []
    if (sessionId) {
      args.push('-r', sessionId)
    }

    const claudeExe = findClaudeExecutable()
    console.log('Spawning Claude:', claudeExe, 'in', cwd, 'with args:', args)

    const ptyOptions: pty.IPtyForkOptions = {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: getEnhancedEnv()
    }

    // Windows: try winpty instead of ConPTY for better escape sequence handling
    if (isWindows) {
      (ptyOptions as any).useConpty = false;
    }

    const shell = pty.spawn(claudeExe, args, ptyOptions)

    const proc: ClaudeProcess = {
      id,
      pty: shell,
      cwd,
      sessionId
    }

    this.processes.set(id, proc)

    shell.onData((data) => {
      const callback = this.dataCallbacks.get(id)
      if (callback) {
        callback(data)
      }
    })

    shell.onExit(({ exitCode }) => {
      const callback = this.exitCallbacks.get(id)
      if (callback) {
        callback(exitCode)
      }
      this.processes.delete(id)
      this.dataCallbacks.delete(id)
      this.exitCallbacks.delete(id)
    })

    return id
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.pty.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (proc) {
      try {
        proc.pty.resize(cols, rows)
      } catch (e) {
        // PTY may have already exited, ignore resize errors
        console.log('PTY resize ignored (may have exited):', id)
      }
    }
  }

  kill(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      try {
        // Windows doesn't support SIGKILL, use default signal
        if (isWindows) {
          proc.pty.kill()
        } else {
          proc.pty.kill('SIGKILL')
        }
      } catch (e) {
        // Process may already be dead
      }
      this.processes.delete(id)
      this.dataCallbacks.delete(id)
      this.exitCallbacks.delete(id)
    }
  }

  killAll(): void {
    console.log(`Killing ${this.processes.size} PTY processes`)
    for (const [id] of this.processes) {
      this.kill(id)
    }
    this.processes.clear()
  }

  onData(id: string, callback: (data: string) => void): void {
    this.dataCallbacks.set(id, callback)
  }

  onExit(id: string, callback: (code: number) => void): void {
    this.exitCallbacks.set(id, callback)
  }
}
