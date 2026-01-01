import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Set app name and WM_CLASS for proper Linux taskbar integration
// Must be done before app is ready
app.setName('simple-claude-gui')
if (process.platform === 'linux') {
  // Set the WM_CLASS to match the .desktop file's StartupWMClass
  app.commandLine.appendSwitch('class', 'simple-claude-gui')
  app.commandLine.appendSwitch('name', 'simple-claude-gui')
}
import { PtyManager } from './pty-manager'
import { SessionStore } from './session-store'
import { discoverSessions } from './session-discovery'
import { ApiServerManager } from './api-server'
import { isWindows, getDefaultShell, getEnhancedPath, getEnhancedPathWithPortable, setPortableBinDirs } from './platform'
import {
  checkDeps,
  getPortableBinDirs,
  getPortableNpmPath,
  getPortablePipPath,
  installPortableNode,
  installPortablePython,
  installClaudeWithPortableNpm,
  installBeadsBinary,
  getBeadsBinaryPath
} from './portable-deps'
import { initUpdater } from './updater'

// Single instance lock - prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const sessionStore = new SessionStore()
const apiServerManager = new ApiServerManager()

// Track which PTY belongs to which project
const ptyToProject: Map<string, string> = new Map()  // ptyId -> projectPath

// Set up API server prompt handler
apiServerManager.setPromptHandler((projectPath, prompt) => {
  // Find a PTY for this project
  for (const [ptyId, path] of ptyToProject) {
    if (path === projectPath) {
      // Use \r (carriage return) as that's what terminals send for Enter key
      ptyManager.write(ptyId, prompt + '\r')
      return true
    }
  }
  return false
})

function createWindow() {
  const bounds = sessionStore.getWindowBounds()

  // Resolve icon path - works in both dev and production
  // In dev: __dirname is dist/main, resources is at project root
  // In prod: app is packaged, use process.resourcesPath
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: iconPath,
    show: false, // Don't show until ready to prevent flicker
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#1e1e1e'
  })

  // Show window when ready to prevent flicker and ensure icon is set
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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

  // Block external drag-drop to prevent xterm crashes
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Prevent navigation from dropped URLs/files
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  // Prevent new windows from opening when dropping content
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
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
  apiServerManager.stopAll()
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
    // Get auto-accept tools and permission mode from project settings
    const workspace = sessionStore.getWorkspace()
    const project = workspace.projects.find(p => p.path === cwd)
    const autoAcceptTools = project?.autoAcceptTools
    const permissionMode = project?.permissionMode

    const id = ptyManager.spawn(cwd, sessionId, autoAcceptTools, permissionMode)

    // Track PTY to project mapping
    ptyToProject.set(id, cwd)

    // Start API server if project has a port configured (reuse project from above)
    if (project?.apiPort && !apiServerManager.isRunning(cwd)) {
      apiServerManager.start(cwd, project.apiPort)
    }

    ptyManager.onData(id, (data) => {
      mainWindow?.webContents.send(`pty:data:${id}`, data)
    })

    ptyManager.onExit(id, (code) => {
      mainWindow?.webContents.send(`pty:exit:${id}`, code)
      ptyToProject.delete(id)
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
  ptyToProject.delete(id)
  ptyManager.kill(id)
})

// API Server management
ipcMain.handle('api:start', (_, { projectPath, port }: { projectPath: string; port: number }) => {
  return apiServerManager.start(projectPath, port)
})

ipcMain.handle('api:stop', (_, projectPath: string) => {
  apiServerManager.stop(projectPath)
  return { success: true }
})

ipcMain.handle('api:status', (_, projectPath: string) => {
  return {
    running: apiServerManager.isRunning(projectPath),
    port: apiServerManager.getPort(projectPath)
  }
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

// Check if git-bash is available (required for Claude Code on Windows)
function checkGitBashInstalled(): boolean {
  if (!isWindows) return true // Not needed on Unix

  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
  ]

  for (const bashPath of gitBashPaths) {
    if (existsSync(bashPath)) {
      return true
    }
  }
  return false
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
  const gitBashInstalled = checkGitBashInstalled()
  return { installed, npmInstalled, gitBashInstalled }
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

ipcMain.handle('git:install', async () => {
  if (!isWindows) {
    return { success: false, error: 'Git installation is only needed on Windows. Install via your package manager.' }
  }

  const { shell } = await import('electron')

  try {
    mainWindow?.webContents.send('install:progress', { type: 'git', status: 'Checking winget...', percent: 0 })

    // Try winget first (silent install, no admin needed for user-scope)
    const hasWinget = await checkWingetInstalled()
    if (hasWinget) {
      mainWindow?.webContents.send('install:progress', { type: 'git', status: 'Installing Git via winget...', percent: 20 })
      try {
        await execAsync('winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements', {
          ...getExecOptions(),
          timeout: 300000  // 5 minutes
        })
        mainWindow?.webContents.send('install:progress', { type: 'git', status: 'Git installed!', percent: 100 })
        return { success: true, method: 'winget', message: 'Git installed! Please restart Simple Claude GUI.' }
      } catch (e: any) {
        console.log('Winget install failed, falling back to download:', e.message)
      }
    }

    // Fallback: Open download page
    mainWindow?.webContents.send('install:progress', { type: 'git', status: 'Opening download page...', percent: 50 })
    shell.openExternal('https://git-scm.com/downloads/win')
    return {
      success: false,
      method: 'download',
      message: 'Please download and install Git for Windows, then restart Simple Claude GUI.'
    }
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
  try {
    // Reset cache so we re-check after install
    beadsAvailable = null

    // Install beads binary (Go binary from GitHub releases)
    const result = await installBeadsBinary((status, percent) => {
      if (mainWindow) {
        mainWindow.webContents.send('install:progress', { type: 'beads', status, percent })
      }
    })

    if (result.success) {
      // Update PATH with new beads directory
      const portableDirs = getPortableBinDirs()
      setPortableBinDirs(portableDirs)

      // Verify installation
      const installed = await checkBeadsInstalled()
      return { success: installed, method: 'binary', error: installed ? undefined : 'Installation completed but bd command not found' }
    }

    return result
  } catch (e: any) {
    beadsAvailable = null
    return { success: false, error: e.message }
  }
})

// Clipboard image reading and saving (using Electron's native clipboard)
ipcMain.handle('clipboard:readImage', async () => {
  try {
    const { clipboard } = require('electron')
    const formats = clipboard.availableFormats()

    // Check for text/uri-list (Linux file copy)
    if (formats.includes('text/uri-list')) {
      const uriBuffer = clipboard.readBuffer('text/uri-list')
      const uriList = uriBuffer.toString('utf8').trim()
      if (uriList) {
        const paths = uriList.split('\n')
          .map(uri => uri.trim())
          .filter(uri => uri.startsWith('file://'))
          .map(uri => decodeURIComponent(uri.replace('file://', '')))
        if (paths.length > 0) {
          return { success: true, hasImage: true, path: paths.join(' '), isFile: true }
        }
      }
    }

    // Check for Windows file copy - try reading FileNameW directly (don't rely on availableFormats)
    if (isWindows) {
      try {
        // Method 1: clipboard.read('FileNameW') - recommended by Electron community
        const rawFilePath = clipboard.read('FileNameW')
        if (rawFilePath) {
          const filePath = rawFilePath.replace(new RegExp(String.fromCharCode(0), 'g'), '').trim()
          if (filePath && (filePath.includes(':\\') || filePath.startsWith('\\\\'))) {
            return { success: true, hasImage: true, path: filePath, isFile: true }
          }
        }
      } catch {
        // FileNameW not available
      }

      try {
        // Method 2: Try CF_HDROP for multiple files (uses ucs2 encoding)
        const hdropBuffer = clipboard.readBuffer('CF_HDROP')
        if (hdropBuffer && hdropBuffer.length > 0) {
          const hdropStr = hdropBuffer.toString('ucs2').replace(/\0+/g, '\n').trim()
          // CF_HDROP has a header, file paths start after some offset
          const lines = hdropStr.split('\n').filter(l => l.includes(':\\') || l.startsWith('\\\\'))
          if (lines.length > 0) {
            return { success: true, hasImage: true, path: lines.join(' '), isFile: true }
          }
        }
      } catch {
        // CF_HDROP not available
      }
    }

    // Try to get image from clipboard
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      // Check if HTML contains an img tag with src
      const html = clipboard.readHTML()
      if (html && html.includes('<img')) {
        const srcMatch = html.match(/src="([^"]+)"/)
        if (srcMatch && srcMatch[1]) {
          return { success: true, hasImage: true, path: srcMatch[1], isUrl: true }
        }
      }
      return { success: false, hasImage: false }
    }

    // Save to temp file
    const filename = `clipboard-${Date.now()}.png`
    const filepath = join(tmpdir(), filename)
    const pngBuffer = image.toPNG()
    writeFileSync(filepath, pngBuffer)

    return { success: true, hasImage: true, path: filepath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// Window controls
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})
