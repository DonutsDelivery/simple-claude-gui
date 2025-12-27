import { contextBridge, ipcRenderer } from 'electron'

export interface Settings {
  defaultProjectDir: string
  theme: string
}

export interface ElectronAPI {
  // Workspace
  getWorkspace: () => Promise<any>
  saveWorkspace: (workspace: any) => Promise<void>
  addProject: () => Promise<string | null>

  // Sessions
  discoverSessions: (projectPath: string) => Promise<any[]>

  // Settings
  getSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  selectDirectory: () => Promise<string | null>

  // Project creation
  createProject: (name: string, parentDir: string) => Promise<{ success: boolean; path?: string; error?: string }>

  // Executable
  selectExecutable: () => Promise<string | null>
  runExecutable: (executable: string, cwd: string) => Promise<{ success: boolean; error?: string }>

  // Claude Code & Node.js & Python
  claudeCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
  claudeInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>
  nodeInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
  pythonInstall: () => Promise<{ success: boolean; error?: string; method?: string }>
  onInstallProgress: (callback: (data: { type: string; status: string; percent?: number }) => void) => () => void

  // Beads
  beadsCheck: (cwd: string) => Promise<{ installed: boolean; initialized: boolean }>
  beadsInit: (cwd: string) => Promise<{ success: boolean; error?: string }>
  beadsInstall: () => Promise<{ success: boolean; error?: string; method?: string; needsPython?: boolean }>
  beadsReady: (cwd: string) => Promise<{ success: boolean; tasks?: any[]; error?: string }>
  beadsList: (cwd: string) => Promise<{ success: boolean; tasks?: any[]; error?: string }>
  beadsShow: (cwd: string, taskId: string) => Promise<{ success: boolean; task?: any; error?: string }>
  beadsCreate: (cwd: string, title: string, description?: string, priority?: number) => Promise<{ success: boolean; task?: any; error?: string }>
  beadsComplete: (cwd: string, taskId: string) => Promise<{ success: boolean; result?: any; error?: string }>
  beadsDelete: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>
  beadsStart: (cwd: string, taskId: string) => Promise<{ success: boolean; error?: string }>

  // PTY
  spawnPty: (cwd: string, sessionId?: string) => Promise<string>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void
  onPtyData: (id: string, callback: (data: string) => void) => () => void
  onPtyExit: (id: string, callback: (code: number) => void) => () => void

  // Updater
  getVersion: () => Promise<string>
  checkForUpdate: () => Promise<{ success: boolean; version?: string; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdaterStatus: (callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void) => () => void
}

const api: ElectronAPI = {
  // Workspace management
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  addProject: () => ipcRenderer.invoke('workspace:addProject'),

  // Session discovery
  discoverSessions: (projectPath) => ipcRenderer.invoke('sessions:discover', projectPath),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),

  // Project creation
  createProject: (name, parentDir) => ipcRenderer.invoke('project:create', { name, parentDir }),

  // Executable
  selectExecutable: () => ipcRenderer.invoke('executable:select'),
  runExecutable: (executable, cwd) => ipcRenderer.invoke('executable:run', { executable, cwd }),

  // Claude Code & Node.js & Python
  claudeCheck: () => ipcRenderer.invoke('claude:check'),
  claudeInstall: () => ipcRenderer.invoke('claude:install'),
  nodeInstall: () => ipcRenderer.invoke('node:install'),
  pythonInstall: () => ipcRenderer.invoke('python:install'),
  onInstallProgress: (callback) => {
    const handler = (_: any, data: { type: string; status: string; percent?: number }) => callback(data)
    ipcRenderer.on('install:progress', handler)
    return () => ipcRenderer.removeListener('install:progress', handler)
  },

  // Beads
  beadsCheck: (cwd) => ipcRenderer.invoke('beads:check', cwd),
  beadsInit: (cwd) => ipcRenderer.invoke('beads:init', cwd),
  beadsInstall: () => ipcRenderer.invoke('beads:install'),
  beadsReady: (cwd) => ipcRenderer.invoke('beads:ready', cwd),
  beadsList: (cwd) => ipcRenderer.invoke('beads:list', cwd),
  beadsShow: (cwd, taskId) => ipcRenderer.invoke('beads:show', { cwd, taskId }),
  beadsCreate: (cwd, title, description, priority) => ipcRenderer.invoke('beads:create', { cwd, title, description, priority }),
  beadsComplete: (cwd, taskId) => ipcRenderer.invoke('beads:complete', { cwd, taskId }),
  beadsDelete: (cwd, taskId) => ipcRenderer.invoke('beads:delete', { cwd, taskId }),
  beadsStart: (cwd, taskId) => ipcRenderer.invoke('beads:start', { cwd, taskId }),

  // PTY management
  spawnPty: (cwd, sessionId) => ipcRenderer.invoke('pty:spawn', { cwd, sessionId }),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.send('pty:kill', id),

  onPtyData: (id, callback) => {
    const handler = (_: any, data: string) => callback(data)
    ipcRenderer.on(`pty:data:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
  },

  onPtyExit: (id, callback) => {
    const handler = (_: any, code: number) => callback(code)
    ipcRenderer.on(`pty:exit:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
  },

  // Updater
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => {
    const handler = (_: any, data: { status: string; version?: string; progress?: number; error?: string }) => callback(data)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
