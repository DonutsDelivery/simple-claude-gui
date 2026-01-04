import React, { useEffect, useState, useCallback, useRef } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TerminalTabs } from './components/TerminalTabs'
import { Terminal, clearTerminalBuffer } from './components/Terminal'
import { TiledTerminalView, TileLayout } from './components/TiledTerminalView'
import { SettingsModal } from './components/SettingsModal'
import { MakeProjectModal } from './components/MakeProjectModal'
import { useWorkspaceStore, OpenTab } from './stores/workspace'
import { Theme, getThemeById, applyTheme, themes } from './themes'
import { useVoice } from './contexts/VoiceContext'

declare global {
  interface Window {
    electronAPI: {
      getWorkspace: () => Promise<any>
      saveWorkspace: (workspace: any) => Promise<void>
      addProject: () => Promise<string | null>
      discoverSessions: (projectPath: string) => Promise<any[]>
      getSettings: () => Promise<{ defaultProjectDir: string; theme: string; autoAcceptTools?: string[]; permissionMode?: string }>
      saveSettings: (settings: { defaultProjectDir: string; theme: string; autoAcceptTools?: string[]; permissionMode?: string }) => Promise<void>
      selectDirectory: () => Promise<string | null>
      createProject: (name: string, parentDir: string) => Promise<{ success: boolean; path?: string; error?: string }>
      selectExecutable: () => Promise<string | null>
      runExecutable: (executable: string, cwd: string) => Promise<{ success: boolean; error?: string }>
      claudeCheck: () => Promise<{ installed: boolean; npmInstalled: boolean; gitBashInstalled: boolean }>
      claudeInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>
      nodeInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
      gitInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
      pythonInstall: () => Promise<{ success: boolean; error?: string; method?: string }>
      onInstallProgress: (callback: (data: { type: string; status: string; percent?: number }) => void) => () => void
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
      spawnPty: (cwd: string, sessionId?: string, model?: string) => Promise<string>
      writePty: (id: string, data: string) => void
      resizePty: (id: string, cols: number, rows: number) => void
      killPty: (id: string) => void
      onPtyData: (id: string, callback: (data: string) => void) => () => void
      onPtyExit: (id: string, callback: (code: number) => void) => () => void
      // API Server
      apiStart: (projectPath: string, port: number) => Promise<{ success: boolean; error?: string }>
      apiStop: (projectPath: string) => Promise<{ success: boolean }>
      apiStatus: (projectPath: string) => Promise<{ running: boolean; port?: number }>
      onApiOpenSession: (callback: (data: { projectPath: string; autoClose: boolean; model?: string }) => void) => () => void
      // Updater
      getVersion: () => Promise<string>
      checkForUpdate: () => Promise<{ success: boolean; version?: string; error?: string }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => void
      onUpdaterStatus: (callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void) => () => void
      // Clipboard
      readClipboardImage: () => Promise<{ success: boolean; hasImage?: boolean; path?: string; error?: string }>
      // TTS instructions
      ttsInstallInstructions?: (projectPath: string) => Promise<{ success: boolean }>
      ttsRemoveInstructions?: (projectPath: string) => Promise<{ success: boolean }>
      // Window controls
      windowMinimize: () => void
      windowMaximize: () => void
      windowClose: () => void
      windowIsMaximized: () => Promise<boolean>
    }
  }
}

function App() {
  const {
    projects,
    openTabs,
    activeTabId,
    setProjects,
    addProject,
    removeProject,
    updateProject,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    clearTabs
  } = useWorkspaceStore()

  const { voiceOutputEnabled } = useVoice()
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)

  // Keep ref in sync for callbacks
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [makeProjectOpen, setMakeProjectOpen] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [viewMode, setViewMode] = useState<'tabs' | 'tiled'>('tabs')
  const [tileLayout, setTileLayout] = useState<TileLayout[]>([])
  const [lastFocusedTabId, setLastFocusedTabId] = useState<string | null>(null)
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null)
  const [npmInstalled, setNpmInstalled] = useState<boolean | null>(null)
  const [gitBashInstalled, setGitBashInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState<'node' | 'git' | 'claude' | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<{
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    progress?: number
    error?: string
  }>({ status: 'idle' })
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const initRef = useRef(false)
  const hadProjectsRef = useRef(false) // Track if we ever had projects loaded

  // Load workspace on mount and restore tabs
  useEffect(() => {
    // Prevent double initialization from StrictMode
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
        // Check if Claude, npm, and git-bash are installed
        const claudeStatus = await window.electronAPI.claudeCheck()
        setClaudeInstalled(claudeStatus.installed)
        setNpmInstalled(claudeStatus.npmInstalled)
        setGitBashInstalled(claudeStatus.gitBashInstalled)

        // Load and apply theme
        const settings = await window.electronAPI.getSettings()
        const theme = getThemeById(settings.theme || 'default')
        applyTheme(theme)
        setCurrentTheme(theme)

        // Kill any existing PTYs from hot reload (but don't clear buffers - they'll be restored)
        const existingTabs = useWorkspaceStore.getState().openTabs
        for (const tab of existingTabs) {
          window.electronAPI.killPty(tab.id)
          // Note: Don't clear buffers here - they're used for HMR recovery
        }
        clearTabs()

        const workspace = await window.electronAPI.getWorkspace()
        if (workspace.projects) {
          setProjects(workspace.projects)
          if (workspace.projects.length > 0) {
            hadProjectsRef.current = true
          }
          // Install TTS instructions for all existing projects
          for (const project of workspace.projects) {
            await window.electronAPI.ttsInstallInstructions?.(project.path)
          }
        }

        // Restore previously open tabs (only if not already open)
        // Track old ID -> new ID mapping for layout restoration
        const idMapping = new Map<string, string>()

        if (workspace.openTabs && workspace.openTabs.length > 0) {
          const currentTabs = useWorkspaceStore.getState().openTabs
          const openSessionIds = new Set(currentTabs.map(t => t.sessionId).filter(Boolean))

          for (const savedTab of workspace.openTabs) {
            // Skip if this session is already open
            if (savedTab.sessionId && openSessionIds.has(savedTab.sessionId)) {
              console.log('Skipping already open session:', savedTab.sessionId)
              continue
            }

            try {
              // Always install TTS instructions so Claude uses <tts> tags
              await window.electronAPI.ttsInstallInstructions?.(savedTab.projectPath)

              const ptyId = await window.electronAPI.spawnPty(
                savedTab.projectPath,
                savedTab.sessionId
              )
              // Map old tab ID to new ptyId for layout restoration
              if (savedTab.id) {
                idMapping.set(savedTab.id, ptyId)
              }
              addTab({
                id: ptyId,
                projectPath: savedTab.projectPath,
                sessionId: savedTab.sessionId,
                title: savedTab.title,
                ptyId
              })
              // Track this session as now open
              if (savedTab.sessionId) {
                openSessionIds.add(savedTab.sessionId)
              }
            } catch (e) {
              console.error('Failed to restore tab:', savedTab.title, e)
            }
          }
        }

        // Restore view mode (layout auto-generates based on tab count)
        if (workspace.viewMode) {
          setViewMode(workspace.viewMode)
        }
        // Don't restore tileLayout - let it auto-generate for clean grid
      } catch (e) {
        console.error('Failed to load workspace:', e)
      }
      setLoading(false)
    }
    loadWorkspace()

    // Load app version
    window.electronAPI.getVersion().then(setAppVersion).catch(console.error)

    // Subscribe to updater events
    const unsubscribe = window.electronAPI.onUpdaterStatus((data) => {
      setUpdateStatus({
        status: data.status as any,
        version: data.version,
        progress: data.progress,
        error: data.error
      })
    })

    return () => unsubscribe()
  }, [])

  // Save workspace when it changes
  useEffect(() => {
    if (!loading) {
      // Protect against hot reload wiping data:
      // Use sessionStorage to persist flag across HMR (refs get reset)
      const hadProjects = sessionStorage.getItem('hadProjects') === 'true' || hadProjectsRef.current

      if (projects.length === 0 && hadProjects) {
        console.warn('Skipping save: projects empty but previously had projects (likely hot reload)')
        return
      }

      // Track that we have projects (both in ref and sessionStorage for HMR)
      if (projects.length > 0) {
        hadProjectsRef.current = true
        sessionStorage.setItem('hadProjects', 'true')
      }

      window.electronAPI.saveWorkspace({
        projects,
        openTabs: openTabs.map(t => ({
          id: t.id,
          projectPath: t.projectPath,
          sessionId: t.sessionId,
          title: t.title
        })),
        activeTabId,
        viewMode,
        tileLayout
      })
    }
  }, [projects, openTabs, activeTabId, loading, viewMode, tileLayout])

  // Poll for session IDs on tabs that don't have one
  useEffect(() => {
    const tabsWithoutSession = openTabs.filter(t => !t.sessionId)
    if (tabsWithoutSession.length === 0) return

    const pollInterval = setInterval(async () => {
      for (const tab of tabsWithoutSession) {
        try {
          const sessions = await window.electronAPI.discoverSessions(tab.projectPath)
          if (sessions.length > 0) {
            // Get the most recent session
            const mostRecent = sessions[0]
            // Check if we already have this session in another tab
            const alreadyOpen = openTabs.some(t => t.id !== tab.id && t.sessionId === mostRecent.sessionId)
            if (!alreadyOpen) {
              const projectName = tab.projectPath.split(/[/\\]/).pop() || tab.projectPath
              updateTab(tab.id, {
                sessionId: mostRecent.sessionId,
                title: `${projectName} - ${mostRecent.slug}`
              })
            }
          }
        } catch (e) {
          console.error('Failed to discover sessions for tab:', e)
        }
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(pollInterval)
  }, [openTabs, updateTab])

  // Listen for API requests to open new sessions
  useEffect(() => {
    const unsubscribe = window.electronAPI.onApiOpenSession(async ({ projectPath, autoClose, model }) => {
      // Open a new session for this project (API-triggered)
      const projectName = projectPath.split(/[/\\]/).pop() || projectPath
      const modelLabel = model && model !== 'default' ? ` [${model}]` : ''
      const title = `${projectName} - API${modelLabel}${autoClose ? ' (auto-close)' : ''}`

      try {
        // Always install TTS instructions so Claude uses <tts> tags
        await window.electronAPI.ttsInstallInstructions?.(projectPath)

        const ptyId = await window.electronAPI.spawnPty(projectPath, undefined, model)
        addTab({
          id: ptyId,
          projectPath,
          title,
          ptyId
        })
      } catch (e: any) {
        console.error('Failed to spawn PTY for API request:', e)
      }
    })

    return unsubscribe
  }, [addTab])

  const handleAddProject = useCallback(async () => {
    const path = await window.electronAPI.addProject()
    if (path) {
      // Split on both / and \ for cross-platform support
      const name = path.split(/[/\\]/).pop() || path
      addProject({ path, name })
      // Install TTS instructions for the new project
      await window.electronAPI.ttsInstallInstructions?.(path)
    }
  }, [addProject])

  const handleOpenSession = useCallback(async (projectPath: string, sessionId?: string, slug?: string) => {
    // Check if this session is already open
    if (sessionId) {
      const existingTab = openTabs.find(tab => tab.sessionId === sessionId)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }
    }

    // Split on both / and \ for cross-platform support
    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const title = slug ? `${projectName} - ${slug}` : `${projectName} - New`

    try {
      // Always install TTS instructions so Claude uses <tts> tags
      await window.electronAPI.ttsInstallInstructions?.(projectPath)

      const ptyId = await window.electronAPI.spawnPty(projectPath, sessionId)
      addTab({
        id: ptyId,
        projectPath,
        sessionId,
        title,
        ptyId
      })
    } catch (e: any) {
      console.error('Failed to spawn PTY:', e)
      // Show error to user
      const errorMsg = e?.message || String(e)
      alert(`Failed to start Claude session:\n\n${errorMsg}\n\nPlease ensure Claude Code is installed and try restarting the application.`)
    }
  }, [addTab, openTabs, setActiveTab])

  const handleCloseTab = useCallback((tabId: string) => {
    window.electronAPI.killPty(tabId)
    clearTerminalBuffer(tabId)
    removeTab(tabId)
  }, [removeTab])

  const handleCloseProjectTabs = useCallback((projectPath: string) => {
    const tabsToClose = openTabs.filter(tab => tab.projectPath === projectPath)
    tabsToClose.forEach(tab => {
      window.electronAPI.killPty(tab.id)
      clearTerminalBuffer(tab.id)
      removeTab(tab.id)
    })
  }, [openTabs, removeTab])

  const handleProjectCreated = useCallback((projectPath: string, projectName: string) => {
    addProject({ path: projectPath, name: projectName })
    handleOpenSession(projectPath)
  }, [addProject, handleOpenSession])

  const handleInstallNode = useCallback(async () => {
    setInstalling('node')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI.nodeInstall()
      if (result.success) {
        if (result.method === 'download') {
          // User needs to complete manual install
          setInstallMessage(result.message || 'Please complete the Node.js installation and restart Simple Claude GUI.')
        } else {
          // winget install succeeded, re-check npm
          setNpmInstalled(true)
          setInstallMessage('Node.js installed! Click "Install Claude Code" to continue.')
        }
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  const handleInstallClaude = useCallback(async () => {
    setInstalling('claude')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI.claudeInstall()
      if (result.success) {
        setClaudeInstalled(true)
      } else if (result.needsNode) {
        setInstallError('Node.js is required. Click "Install Node.js" first.')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  const handleInstallGit = useCallback(async () => {
    setInstalling('git')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI.gitInstall()
      if (result.success) {
        setGitBashInstalled(true)
        setInstallMessage(result.message || 'Git installed! Please restart Simple Claude GUI.')
      } else if (result.method === 'download') {
        setInstallMessage(result.message || 'Please download and install Git, then restart Simple Claude GUI.')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  if (loading) {
    return (
      <div className="app">
        <div className="empty-state">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-content">
      <Sidebar
        projects={projects}
        openTabs={openTabs}
        activeTabId={activeTabId}
        lastFocusedTabId={lastFocusedTabId}
        onAddProject={handleAddProject}
        onRemoveProject={removeProject}
        onOpenSession={handleOpenSession}
        onSwitchToTab={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenMakeProject={() => setMakeProjectOpen(true)}
        onUpdateProject={updateProject}
        onCloseProjectTabs={handleCloseProjectTabs}
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        onWidthChange={setSidebarWidth}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className="main-content">
        {claudeInstalled === false || gitBashInstalled === false ? (
          <div className="empty-state">
            <h2>{claudeInstalled === false ? 'Claude Code Not Found' : 'Git Required'}</h2>
            <p>{claudeInstalled === false
              ? 'Claude Code needs to be installed to use this application.'
              : 'Claude Code requires Git (git-bash) on Windows.'}</p>
            {installError && (
              <p className="error-message">{installError}</p>
            )}
            {installMessage && (
              <p className="install-message">{installMessage}</p>
            )}
            <div className="install-buttons">
              {gitBashInstalled === false && (
                <button
                  className="install-btn"
                  onClick={handleInstallGit}
                  disabled={installing !== null}
                >
                  {installing === 'git' ? 'Installing Git...' : '1. Install Git'}
                </button>
              )}
              {!npmInstalled && (
                <button
                  className="install-btn"
                  onClick={handleInstallNode}
                  disabled={installing !== null}
                >
                  {installing === 'node' ? 'Installing Node.js...' : gitBashInstalled === false ? '2. Install Node.js' : '1. Install Node.js'}
                </button>
              )}
              {claudeInstalled === false && (
                <button
                  className="install-btn"
                  onClick={handleInstallClaude}
                  disabled={installing !== null || !npmInstalled}
                >
                  {installing === 'claude' ? 'Installing Claude...' :
                    (!npmInstalled && gitBashInstalled === false) ? '3. Install Claude Code' :
                    !npmInstalled ? '2. Install Claude Code' : 'Install Claude Code'}
                </button>
              )}
            </div>
            {(gitBashInstalled === false || !npmInstalled) && (
              <p className="install-note">
                {gitBashInstalled === false && !npmInstalled
                  ? 'Git and Node.js are required for Claude Code.'
                  : gitBashInstalled === false
                    ? 'Git is required for Claude Code on Windows.'
                    : 'Node.js is required to install Claude Code.'}
              </p>
            )}
          </div>
        ) : openTabs.length > 0 ? (
          <>
            <div className="terminal-header">
              {viewMode === 'tabs' && (
                <TerminalTabs
                  tabs={openTabs}
                  activeTabId={activeTabId}
                  onSelectTab={setActiveTab}
                  onCloseTab={handleCloseTab}
                />
              )}
              <button
                className="view-toggle-btn"
                onClick={() => setViewMode(viewMode === 'tabs' ? 'tiled' : 'tabs')}
                title={viewMode === 'tabs' ? 'Switch to tiled view' : 'Switch to tabs view'}
              >
                {viewMode === 'tabs' ? '⊞' : '▭'}
              </button>
            </div>
            {viewMode === 'tabs' ? (
              <div className="terminal-container">
                {openTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`terminal-wrapper ${tab.id === activeTabId ? 'active' : ''}`}
                  >
                    <Terminal
                      ptyId={tab.id}
                      isActive={tab.id === activeTabId}
                      theme={currentTheme}
                      onFocus={() => setLastFocusedTabId(tab.id)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <TiledTerminalView
                tabs={openTabs}
                projects={projects}
                theme={currentTheme}
                onCloseTab={handleCloseTab}
                onFocusTab={setLastFocusedTabId}
                layout={tileLayout}
                onLayoutChange={setTileLayout}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <h2>Simple Claude GUI</h2>
            <p>Add a project from the sidebar, then click a session to open it</p>
          </div>
        )}
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setCurrentTheme}
      />

      <MakeProjectModal
        isOpen={makeProjectOpen}
        onClose={() => setMakeProjectOpen(false)}
        onProjectCreated={handleProjectCreated}
      />
      </div>

      {/* Version indicator */}
      {appVersion && (
        <div className="version-indicator">
          <span className="version-text">v{appVersion}</span>
          {updateStatus.status === 'available' && (
            <button
              className="update-btn"
              onClick={() => {
                setUpdateStatus({ status: 'downloading', version: updateStatus.version, progress: 0 })
                window.electronAPI.downloadUpdate().then(result => {
                  if (!result.success) {
                    setUpdateStatus({ status: 'error', error: result.error })
                  }
                }).catch(e => {
                  setUpdateStatus({ status: 'error', error: String(e) })
                })
              }}
              title={`Update to v${updateStatus.version}`}
            >
              Update available
            </button>
          )}
          {updateStatus.status === 'downloading' && (
            <span className="update-progress">
              Downloading... {Math.round(updateStatus.progress || 0)}%
            </span>
          )}
          {updateStatus.status === 'downloaded' && (
            <button
              className="update-btn ready"
              onClick={() => window.electronAPI.installUpdate()}
              title="Restart and install update"
            >
              Restart to update
            </button>
          )}
          {updateStatus.status === 'error' && (
            <span className="update-error" title={updateStatus.error}>
              Update failed
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default App
