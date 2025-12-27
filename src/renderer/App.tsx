import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalTabs } from './components/TerminalTabs'
import { Terminal } from './components/Terminal'
import { SettingsModal } from './components/SettingsModal'
import { MakeProjectModal } from './components/MakeProjectModal'
import { useWorkspaceStore, OpenTab } from './stores/workspace'
import { Theme, getThemeById, applyTheme, themes } from './themes'

declare global {
  interface Window {
    electronAPI: {
      getWorkspace: () => Promise<any>
      saveWorkspace: (workspace: any) => Promise<void>
      addProject: () => Promise<string | null>
      discoverSessions: (projectPath: string) => Promise<any[]>
      getSettings: () => Promise<{ defaultProjectDir: string; theme: string }>
      saveSettings: (settings: { defaultProjectDir: string; theme: string }) => Promise<void>
      selectDirectory: () => Promise<string | null>
      createProject: (name: string, parentDir: string) => Promise<{ success: boolean; path?: string; error?: string }>
      selectExecutable: () => Promise<string | null>
      runExecutable: (executable: string, cwd: string) => Promise<{ success: boolean; error?: string }>
      claudeCheck: () => Promise<{ installed: boolean; npmInstalled: boolean }>
      claudeInstall: () => Promise<{ success: boolean; error?: string; needsNode?: boolean }>
      nodeInstall: () => Promise<{ success: boolean; error?: string; method?: string; message?: string }>
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
    setActiveTab,
    clearTabs
  } = useWorkspaceStore()

  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [makeProjectOpen, setMakeProjectOpen] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0])
  const [viewMode, setViewMode] = useState<'tabs' | 'tiled'>('tabs')
  const [lastFocusedTabId, setLastFocusedTabId] = useState<string | null>(null)
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null)
  const [npmInstalled, setNpmInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState<'node' | 'claude' | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<{
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    progress?: number
    error?: string
  }>({ status: 'idle' })
  const initRef = useRef(false)

  // Load workspace on mount and restore tabs
  useEffect(() => {
    // Prevent double initialization from StrictMode
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
        // Check if Claude and npm are installed
        const claudeStatus = await window.electronAPI.claudeCheck()
        setClaudeInstalled(claudeStatus.installed)
        setNpmInstalled(claudeStatus.npmInstalled)

        // Load and apply theme
        const settings = await window.electronAPI.getSettings()
        const theme = getThemeById(settings.theme || 'default')
        applyTheme(theme)
        setCurrentTheme(theme)

        // Kill any existing PTYs from hot reload
        const existingTabs = useWorkspaceStore.getState().openTabs
        for (const tab of existingTabs) {
          window.electronAPI.killPty(tab.id)
        }
        clearTabs()

        const workspace = await window.electronAPI.getWorkspace()
        if (workspace.projects) {
          setProjects(workspace.projects)
        }

        // Restore previously open tabs (only if not already open)
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
              const ptyId = await window.electronAPI.spawnPty(
                savedTab.projectPath,
                savedTab.sessionId
              )
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
      window.electronAPI.saveWorkspace({
        projects,
        openTabs: openTabs.map(t => ({
          id: t.id,
          projectPath: t.projectPath,
          sessionId: t.sessionId,
          title: t.title
        })),
        activeTabId
      })
    }
  }, [projects, openTabs, activeTabId, loading])

  const handleAddProject = useCallback(async () => {
    const path = await window.electronAPI.addProject()
    if (path) {
      // Split on both / and \ for cross-platform support
      const name = path.split(/[/\\]/).pop() || path
      addProject({ path, name })
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
    removeTab(tabId)
  }, [removeTab])

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
      />
      <div className="main-content">
        {openTabs.length > 0 ? (
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
              <div className={`terminal-tiled terminal-tiled-${Math.min(openTabs.length, 4)}`}>
                {openTabs.map((tab) => (
                  <div key={tab.id} className="terminal-tile">
                    <div className="tile-header">
                      <span className="tile-title" title={tab.title}>{tab.title}</span>
                      <button
                        className="tile-close"
                        onClick={() => handleCloseTab(tab.id)}
                        title="Close"
                      >
                        ×
                      </button>
                    </div>
                    <div className="tile-terminal">
                      <Terminal
                        ptyId={tab.id}
                        isActive={true}
                        theme={currentTheme}
                        onFocus={() => setLastFocusedTabId(tab.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : claudeInstalled === false ? (
          <div className="empty-state">
            <h2>Claude Code Not Found</h2>
            <p>Claude Code needs to be installed to use this application.</p>
            {installError && (
              <p className="error-message">{installError}</p>
            )}
            {installMessage && (
              <p className="install-message">{installMessage}</p>
            )}
            <div className="install-buttons">
              {!npmInstalled && (
                <button
                  className="install-btn"
                  onClick={handleInstallNode}
                  disabled={installing !== null}
                >
                  {installing === 'node' ? 'Installing Node.js...' : '1. Install Node.js'}
                </button>
              )}
              <button
                className="install-btn"
                onClick={handleInstallClaude}
                disabled={installing !== null || !npmInstalled}
              >
                {installing === 'claude' ? 'Installing Claude...' : npmInstalled ? 'Install Claude Code' : '2. Install Claude Code'}
              </button>
            </div>
            {!npmInstalled && (
              <p className="install-note">
                Node.js is required to install Claude Code.
              </p>
            )}
          </div>
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

      {/* Version indicator */}
      {appVersion && (
        <div className="version-indicator">
          <span className="version-text">v{appVersion}</span>
          {updateStatus.status === 'available' && (
            <button
              className="update-btn"
              onClick={() => window.electronAPI.downloadUpdate()}
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
        </div>
      )}
    </div>
  )
}

export default App
