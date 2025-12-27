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
      beadsCheck: (cwd: string) => Promise<{ installed: boolean; initialized: boolean }>
      beadsInit: (cwd: string) => Promise<{ success: boolean; error?: string }>
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
  const initRef = useRef(false)

  // Load workspace on mount and restore tabs
  useEffect(() => {
    // Prevent double initialization from StrictMode
    if (initRef.current) return
    initRef.current = true

    const loadWorkspace = async () => {
      try {
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
    } catch (e) {
      console.error('Failed to spawn PTY:', e)
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
        ) : (
          <div className="empty-state">
            <h2>Claude Terminal</h2>
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
  )
}

export default App
