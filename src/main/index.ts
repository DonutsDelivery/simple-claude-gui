import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import { PtyManager } from './pty-manager'
import { SessionStore } from './session-store'
import { discoverSessions } from './session-discovery'
import { isWindows, getDefaultShell, getEnhancedPath, getEnhancedPathWithPortable, setPortableBinDirs } from './platform'
import {
  checkDeps,
  getPortableBinDirs,
  getPortableNpmPath,
  getPortablePipPath,
  installPortableNode,
  installPortablePython,
  installClaudeWithPortableNpm,
  installBeadsWithPortablePip
} from './portable-deps'
import { initUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()

function createWindow() {
  const bounds = sessionStore.getWindowBounds()

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#1e1e1e'
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Toggle DevTools with F12
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      sessionStore.saveWindowBounds(mainWindow.getBounds())
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    ptyManager.killAll()
  })
}

app.whenReady().then(() => {
  // Initialize portable deps PATH
  const portableDirs = getPortableBinDirs()
  setPortableBinDirs(portableDirs)
  console.log('Portable bin directories:', portableDirs)

  createWindow()

  // Initialize auto-updater
  if (mainWindow) {
    initUpdater(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  ptyManager.killAll()
})

// IPC Handlers

// Workspace management
ipcMain.handle('workspace:get', () => {
  return sessionStore.getWorkspace()
})

ipcMain.handle('workspace:save', (_, workspace) => {
  sessionStore.saveWorkspace(workspace)
})

ipcMain.handle('workspace:addProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Session discovery
ipcMain.handle('sessions:discover', (_, projectPath: string) => {
  return discoverSessions(projectPath)
})

// PTY management
ipcMain.handle('pty:spawn', (_, { cwd, sessionId }: { cwd: string; sessionId?: string }) => {
  try {
    const id = ptyManager.spawn(cwd, sessionId)

    ptyManager.onData(id, (data) => {
      mainWindow?.webContents.send(`pty:data:${id}`, data)
    })

    ptyManager.onExit(id, (code) => {
      mainWindow?.webContents.send(`pty:exit:${id}`, code)
    })

    return id
  } catch (error: any) {
    console.error('Failed to spawn PTY:', error)
    throw new Error(`Failed to start Claude: ${error.message}`)
  }
})

ipcMain.on('pty:write', (_, { id, data }: { id: string; data: string }) => {
  ptyManager.write(id, data)
})

ipcMain.on('pty:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  ptyManager.resize(id, cols, rows)
})

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id)
})

// Settings management
ipcMain.handle('settings:get', () => {
  return sessionStore.getSettings()
})

ipcMain.handle('settings:save', (_, settings) => {
  sessionStore.saveSettings(settings)
})

ipcMain.handle('settings:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Default Project Directory'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Project creation
ipcMain.handle('project:create', (_, { name, parentDir }: { name: string; parentDir: string }) => {
  const projectPath = join(parentDir, name)
  if (existsSync(projectPath)) {
    return { success: false, error: 'Directory already exists' }
  }
  try {
    mkdirSync(projectPath, { recursive: true })
    return { success: true, path: projectPath }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// Executable management
ipcMain.handle('executable:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    title: 'Select Executable',
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('executable:run', (_, { executable, cwd }: { executable: string; cwd: string }) => {
  try {
    const child = spawn(executable, [], {
      cwd,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// Use platform-aware shell and PATH (dynamic to pick up portable deps)
function getExecOptions() {
  return {
    shell: isWindows ? true : '/bin/bash',  // true uses default shell on Windows
    env: { ...process.env, PATH: getEnhancedPathWithPortable() }
  }
}

// Claude Code installation check and management
let claudeAvailable: boolean | null = null

async function checkClaudeInstalled(): Promise<boolean> {
  if (claudeAvailable !== null) return claudeAvailable
  try {
    await execAsync('claude --version', getExecOptions())
    claudeAvailable = true
  } catch {
    claudeAvailable = false
  }
  return claudeAvailable
}

// Check if npm is available
async function checkNpmInstalled(): Promise<boolean> {
  try {
    await execAsync('npm --version', getExecOptions())
    return true
  } catch {
    return false
  }
}

// Check if winget is available (Windows 10/11)
async function checkWingetInstalled(): Promise<boolean> {
  if (!isWindows) return false
  try {
    await execAsync('winget --version', getExecOptions())
    return true
  } catch {
    return false
  }
}

ipcMain.handle('claude:check', async () => {
  const installed = await checkClaudeInstalled()
  const npmInstalled = await checkNpmInstalled()
  return { installed, npmInstalled }
})

ipcMain.handle('node:install', async () => {
  try {
    // Use portable Node.js (downloads to app data, no admin rights needed)
    const result = await installPortableNode((status, percent) => {
      // Send progress to renderer
      mainWindow?.webContents.send('install:progress', { type: 'node', status, percent })
    })

    if (result.success) {
      // Update portable bin dirs after installation
      const portableDirs = getPortableBinDirs()
      setPortableBinDirs(portableDirs)
      console.log('Updated portable bin directories:', portableDirs)
      return { success: true, method: 'portable' }
    }

    return result
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('claude:install', async () => {
  try {
    // Reset cache so we re-check after install
    claudeAvailable = null

    // Check if portable npm is available
    const portableNpm = getPortableNpmPath()
    if (portableNpm) {
      // Use portable npm
      const result = await installClaudeWithPortableNpm()
      if (result.success) {
        // Update portable bin dirs
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)

        const installed = await checkClaudeInstalled()
        return { success: installed, error: installed ? undefined : 'Installation completed but claude command not found' }
      }
      return result
    }

    // Fallback to system npm
    const hasNpm = await checkNpmInstalled()
    if (!hasNpm) {
      return { success: false, error: 'npm is not installed. Please install Node.js first.', needsNode: true }
    }

    // Install Claude Code globally via npm
    await execAsync('npm install -g @anthropic-ai/claude-code', { ...getExecOptions(), timeout: 120000 })

    // Verify installation
    const installed = await checkClaudeInstalled()
    return { success: installed, error: installed ? undefined : 'Installation completed but claude command not found' }
  } catch (e: any) {
    claudeAvailable = null
    return { success: false, error: e.message }
  }
})

// Beads integration
let beadsAvailable: boolean | null = null

// Backwards compat alias
const getBeadsExecOptions = getExecOptions

async function checkBeadsInstalled(): Promise<boolean> {
  if (beadsAvailable !== null) return beadsAvailable
  try {
    await execAsync('bd --version', getBeadsExecOptions())
    beadsAvailable = true
  } catch {
    beadsAvailable = false
  }
  return beadsAvailable
}

ipcMain.handle('beads:check', async (_, cwd: string) => {
  // First check if bd command is available
  const installed = await checkBeadsInstalled()
  if (!installed) return { installed: false, initialized: false }

  // Then check if beads is initialized in this project
  const beadsDir = join(cwd, '.beads')
  return { installed: true, initialized: existsSync(beadsDir) }
})

ipcMain.handle('beads:init', async (_, cwd: string) => {
  try {
    await execAsync('bd init', { ...getBeadsExecOptions(), cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:ready', async (_, cwd: string) => {
  try {
    const { stdout } = await execAsync('bd ready --json', { ...getBeadsExecOptions(), cwd })
    return { success: true, tasks: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:list', async (_, cwd: string) => {
  try {
    const { stdout } = await execAsync('bd list --json', { ...getBeadsExecOptions(), cwd })
    return { success: true, tasks: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:show', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    const { stdout } = await execAsync(`bd show ${taskId} --json`, { ...getBeadsExecOptions(), cwd })
    return { success: true, task: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:create', async (_, { cwd, title, description, priority }: { cwd: string; title: string; description?: string; priority?: number }) => {
  try {
    let cmd = `bd create "${title.replace(/"/g, '\\"')}"`
    if (description) cmd += ` -d "${description.replace(/"/g, '\\"')}"`
    if (priority !== undefined) cmd += ` -p ${priority}`
    cmd += ' --json'
    const { stdout } = await execAsync(cmd, { ...getBeadsExecOptions(), cwd })
    return { success: true, task: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:complete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    const { stdout } = await execAsync(`bd close ${taskId} --json`, { ...getBeadsExecOptions(), cwd })
    return { success: true, result: JSON.parse(stdout) }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:delete', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    await execAsync(`bd delete ${taskId} --force`, { ...getBeadsExecOptions(), cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:start', async (_, { cwd, taskId }: { cwd: string; taskId: string }) => {
  try {
    await execAsync(`bd update ${taskId} --status in_progress`, { ...getBeadsExecOptions(), cwd })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// Check if pipx is available (preferred for CLI tools)
async function checkPipxInstalled(): Promise<boolean> {
  try {
    await execAsync('pipx --version', getExecOptions())
    return true
  } catch {
    return false
  }
}

// Check if pip/pip3 is available
async function checkPipInstalled(): Promise<boolean> {
  try {
    // Try pip3 first (common on Linux/macOS)
    await execAsync('pip3 --version', getExecOptions())
    return true
  } catch {
    try {
      // Fall back to pip
      await execAsync('pip --version', getExecOptions())
      return true
    } catch {
      return false
    }
  }
}

// Python installation handler (for portable Python on Windows)
ipcMain.handle('python:install', async () => {
  try {
    const result = await installPortablePython((status, percent) => {
      mainWindow?.webContents.send('install:progress', { type: 'python', status, percent })
    })

    if (result.success) {
      // Update portable bin dirs after installation
      const portableDirs = getPortableBinDirs()
      setPortableBinDirs(portableDirs)
      return { success: true, method: 'portable' }
    }

    return result
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('beads:install', async () => {
  const { shell } = await import('electron')

  try {
    // Reset cache so we re-check after install
    beadsAvailable = null

    // Check if portable pip is available (Windows)
    const portablePip = getPortablePipPath()
    if (portablePip) {
      const result = await installBeadsWithPortablePip()
      if (result.success) {
        const portableDirs = getPortableBinDirs()
        setPortableBinDirs(portableDirs)
        const installed = await checkBeadsInstalled()
        return { success: installed, method: 'portable', error: installed ? undefined : 'Installation completed but bd command not found' }
      }
      return result
    }

    // Try pipx first (better for CLI tools - isolated environment)
    const hasPipx = await checkPipxInstalled()
    if (hasPipx) {
      await execAsync('pipx install beads-cli', { ...getExecOptions(), timeout: 120000 })
      const installed = await checkBeadsInstalled()
      return { success: installed, method: 'pipx', error: installed ? undefined : 'Installation completed but bd command not found' }
    }

    // Try pip/pip3
    const hasPip = await checkPipInstalled()
    if (hasPip) {
      // Use --user flag for safety (no sudo required)
      try {
        await execAsync('pip3 install --user beads-cli', { ...getExecOptions(), timeout: 120000 })
      } catch {
        await execAsync('pip install --user beads-cli', { ...getExecOptions(), timeout: 120000 })
      }
      const installed = await checkBeadsInstalled()
      return { success: installed, method: 'pip', error: installed ? undefined : 'Installation completed but bd command not found. You may need to restart the app.' }
    }

    // No pip available - need Python installation
    if (isWindows) {
      return { success: false, needsPython: true, error: 'Python is required. Click "Install Python" to download the portable version.' }
    } else if (process.platform === 'darwin') {
      shell.openExternal('https://www.python.org/downloads/macos/')
      return { success: false, needsPython: true, error: 'Python is required. Please install Python from the download page, then restart Simple Claude GUI.' }
    } else {
      // Linux - suggest package manager
      return { success: false, needsPython: true, error: 'Python/pip is required. Install via: sudo apt install python3-pip (Debian/Ubuntu) or sudo pacman -S python-pip (Arch)' }
    }
  } catch (e: any) {
    beadsAvailable = null
    return { success: false, error: e.message }
  }
})
