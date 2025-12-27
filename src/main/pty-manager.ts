import * as pty from 'node-pty'
import { isWindows, getEnhancedPath } from './platform'

interface ClaudeProcess {
  id: string
  pty: pty.IPty
  cwd: string
  sessionId?: string
}

function getEnhancedEnv(): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }
  env.PATH = getEnhancedPath()
  return env
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

    const shell = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: getEnhancedEnv()
    })

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
      proc.pty.resize(cols, rows)
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
