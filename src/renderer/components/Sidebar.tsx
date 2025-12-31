import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Project } from '../stores/workspace'
import { ProjectIcon } from './ProjectIcon'
import { BeadsPanel } from './BeadsPanel'

interface ClaudeSession {
  sessionId: string
  slug: string
  lastModified: number
}

interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
}

interface SidebarProps {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
  lastFocusedTabId: string | null
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId?: string, slug?: string) => void
  onSwitchToTab: (tabId: string) => void
  onOpenSettings: () => void
  onOpenMakeProject: () => void
  onUpdateProject: (path: string, updates: Partial<Project>) => void
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ projects, openTabs, activeTabId, lastFocusedTabId, onAddProject, onRemoveProject, onOpenSession, onSwitchToTab, onOpenSettings, onOpenMakeProject, onUpdateProject, width, collapsed, onWidthChange, onCollapsedChange }: SidebarProps) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [apiPortModal, setApiPortModal] = useState<{ project: Project; currentPort: string; status?: 'checking' | 'success' | 'error'; error?: string } | null>(null)
  const [apiStatus, setApiStatus] = useState<Record<string, { running: boolean; port?: number }>>({})
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.min(Math.max(e.clientX, 200), 500)
      onWidthChange(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onWidthChange])

  // Get project path from last focused tab (or active tab as fallback)
  const focusedTabId = lastFocusedTabId || activeTabId
  const focusedProjectPath = openTabs.find(t => t.id === focusedTabId)?.projectPath || null
  // Use expanded project if viewing sessions, otherwise use focused/active tab's project
  const beadsProjectPath = expandedProject || focusedProjectPath

  const handleSelectExecutable = async (project: Project) => {
    const executable = await window.electronAPI.selectExecutable()
    if (executable) {
      onUpdateProject(project.path, { executable })
    }
    setContextMenu(null)
  }

  const handleClearExecutable = (project: Project) => {
    onUpdateProject(project.path, { executable: undefined })
    setContextMenu(null)
  }

  const handleRunExecutable = async (project: Project) => {
    if (project.executable) {
      const result = await window.electronAPI.runExecutable(project.executable, project.path)
      if (!result.success) {
        console.error('Failed to run executable:', result.error)
      }
    }
    setContextMenu(null)
  }

  const handleContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, project })
  }

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  // Check API status when context menu opens
  useEffect(() => {
    if (contextMenu) {
      window.electronAPI.apiStatus(contextMenu.project.path).then((status) => {
        setApiStatus(prev => ({ ...prev, [contextMenu.project.path]: status }))
      })
    }
  }, [contextMenu])

  const handleConfigureApi = (project: Project) => {
    setApiPortModal({ project, currentPort: project.apiPort?.toString() || '' })
    setContextMenu(null)
  }

  const handleSaveApiPort = async () => {
    if (!apiPortModal) return
    const port = parseInt(apiPortModal.currentPort, 10)

    if (apiPortModal.currentPort && (isNaN(port) || port < 1024 || port > 65535)) {
      setApiPortModal({ ...apiPortModal, status: 'error', error: 'Please enter a valid port number (1024-65535)' })
      return
    }

    const newPort = apiPortModal.currentPort ? port : undefined

    if (!newPort) {
      // Just clearing the port, stop server and close
      await window.electronAPI.apiStop(apiPortModal.project.path)
      onUpdateProject(apiPortModal.project.path, { apiPort: undefined })
      setApiPortModal(null)
      return
    }

    // Test if port is available by trying to start the server
    setApiPortModal({ ...apiPortModal, status: 'checking' })

    const result = await window.electronAPI.apiStart(apiPortModal.project.path, newPort)
    if (!result.success) {
      setApiPortModal({ ...apiPortModal, status: 'error', error: result.error || 'Port may already be in use' })
      return
    }

    // Success - save the port and show checkmark briefly
    onUpdateProject(apiPortModal.project.path, { apiPort: newPort })
    setApiStatus(prev => ({ ...prev, [apiPortModal.project.path]: { running: true, port: newPort } }))
    setApiPortModal({ ...apiPortModal, status: 'success' })

    // Close modal after showing success
    setTimeout(() => setApiPortModal(null), 800)
  }

  const handleToggleApi = async (project: Project) => {
    const status = apiStatus[project.path]
    if (status?.running) {
      await window.electronAPI.apiStop(project.path)
      setApiStatus(prev => ({ ...prev, [project.path]: { running: false } }))
    } else if (project.apiPort) {
      const result = await window.electronAPI.apiStart(project.path, project.apiPort)
      if (result.success) {
        setApiStatus(prev => ({ ...prev, [project.path]: { running: true, port: project.apiPort } }))
      } else {
        alert(`Failed to start API server: ${result.error}`)
      }
    }
    setContextMenu(null)
  }

  // Check API status for focused project
  useEffect(() => {
    if (focusedProjectPath) {
      window.electronAPI.apiStatus(focusedProjectPath).then((status) => {
        setApiStatus(prev => ({ ...prev, [focusedProjectPath]: status }))
      })
    }
  }, [focusedProjectPath])

  useEffect(() => {
    const loadSessions = async () => {
      if (expandedProject) {
        try {
          const projectSessions = await window.electronAPI.discoverSessions(expandedProject)
          setSessions((prev) => ({ ...prev, [expandedProject]: projectSessions }))
        } catch (e) {
          console.error('Failed to discover sessions:', e)
        }
      }
    }
    loadSessions()
  }, [expandedProject])

  const toggleProject = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setExpandedProject(expandedProject === path ? null : path)
  }

  const openMostRecentSession = async (projectPath: string) => {
    // First check if any session from this project is already open
    const existingTab = openTabs.find(tab => tab.projectPath === projectPath)
    if (existingTab) {
      onSwitchToTab(existingTab.id)
      return
    }

    // Load sessions if not already loaded
    let projectSessions = sessions[projectPath]
    if (!projectSessions) {
      try {
        projectSessions = await window.electronAPI.discoverSessions(projectPath)
        setSessions((prev) => ({ ...prev, [projectPath]: projectSessions }))
      } catch (e) {
        console.error('Failed to discover sessions:', e)
        projectSessions = []
      }
    }

    if (projectSessions && projectSessions.length > 0) {
      // Open most recent session (first in list since sorted by lastModified)
      const mostRecent = projectSessions[0]
      onOpenSession(projectPath, mostRecent.sessionId, mostRecent.slug)
    } else {
      // No existing sessions, start a new one
      onOpenSession(projectPath)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) {
      return 'Just now'
    } else if (minutes < 60) {
      return `${minutes}m ago`
    } else if (hours < 24) {
      return `${hours}h ago`
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return `${days}d ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  if (collapsed) {
    return (
      <div className="sidebar collapsed" ref={sidebarRef}>
        <button
          className="sidebar-collapse-btn"
          onClick={() => onCollapsedChange(false)}
          title="Expand sidebar"
        >
          ▶
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <button
        className="sidebar-collapse-btn"
        onClick={() => onCollapsedChange(true)}
        title="Collapse sidebar"
      >
        ◀
      </button>
      <div className="sidebar-header">Projects</div>
      <div className="projects-list">
        {projects.map((project) => (
          <div key={project.path}>
            <div
              className={`project-item ${expandedProject === project.path ? 'expanded' : ''} ${openTabs.some(t => t.projectPath === project.path) ? 'has-open-tab' : ''} ${project.executable ? 'has-executable' : ''}`}
              onClick={() => openMostRecentSession(project.path)}
              onContextMenu={(e) => handleContextMenu(e, project)}
            >
              <span
                className="expand-arrow"
                onClick={(e) => toggleProject(e, project.path)}
                title="Show all sessions"
              >
                {expandedProject === project.path ? '▼' : '▶'}
              </span>
              <ProjectIcon projectName={project.name} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="project-name" title={project.name}>{project.name}</div>
                <div className="project-path" title={project.path}>{project.path}</div>
              </div>
              {project.executable && (
                <button
                  className="start-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRunExecutable(project)
                  }}
                  title={`Run: ${project.executable}`}
                >
                  ▶
                </button>
              )}
            </div>
            {expandedProject === project.path && (
              <div className="sessions-list">
                <div
                  className="session-item new-session"
                  onClick={() => onOpenSession(project.path)}
                >
                  <span>+</span>
                  <span>New Session</span>
                </div>
                {(sessions[project.path] || []).map((session, index) => (
                  <div
                    key={session.sessionId}
                    className={`session-item ${index === 0 ? 'most-recent' : ''}`}
                    onClick={() => onOpenSession(project.path, session.sessionId, session.slug)}
                    title={`Session ID: ${session.sessionId}`}
                  >
                    <span className="session-icon">{index === 0 ? '●' : '◦'}</span>
                    <span className="session-name" title={session.slug}>{session.slug}</span>
                    <span className="session-time">{formatDate(session.lastModified)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && (
          <div className="empty-projects">
            No projects yet.<br />Click below to add one.
          </div>
        )}
      </div>
      <BeadsPanel
        projectPath={beadsProjectPath}
        isExpanded={beadsExpanded}
        onToggle={() => setBeadsExpanded(!beadsExpanded)}
      />
      <div className="sidebar-actions">
        {(() => {
          const focusedProject = projects.find(p => p.path === focusedProjectPath)
          if (focusedProject?.executable) {
            return (
              <button
                className="sidebar-btn run-app"
                onClick={() => handleRunExecutable(focusedProject)}
                title={`Run: ${focusedProject.executable}`}
              >
                <span className="icon">▶</span> Run App
              </button>
            )
          }
          return null
        })()}
        {(() => {
          const focusedProject = projects.find(p => p.path === focusedProjectPath)
          if (focusedProject) {
            const status = apiStatus[focusedProject.path]
            const hasPort = !!focusedProject.apiPort
            return (
              <button
                className={`sidebar-btn api-toggle ${status?.running ? 'running' : ''}`}
                onClick={() => {
                  if (!hasPort) {
                    // No port configured, open configuration modal
                    setApiPortModal({ project: focusedProject, currentPort: '' })
                  } else {
                    handleToggleApi(focusedProject)
                  }
                }}
                title={status?.running ? `Stop API Server (port ${focusedProject.apiPort})` : hasPort ? `Start API Server (port ${focusedProject.apiPort})` : 'Configure API Port'}
              >
                <span className="icon">{status?.running ? '⏹' : '🔌'}</span>
                {status?.running ? `API :${focusedProject.apiPort}` : hasPort ? 'Start API' : 'API'}
              </button>
            )
          }
          return null
        })()}
        <button className="sidebar-btn" onClick={onOpenMakeProject}>
          <span className="icon">+</span> Make Project
        </button>
        <button className="sidebar-btn" onClick={onOpenSettings}>
          <span className="icon">⚙</span> Settings
        </button>
        <button className="sidebar-btn primary" onClick={onAddProject}>
          <span className="icon">📁</span> Add Project
        </button>
      </div>
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
      />

      {/* Context Menu - rendered via portal to avoid layout issues */}
      {contextMenu && ReactDOM.createPortal(
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.project.executable ? (
            <>
              <button onClick={() => handleRunExecutable(contextMenu.project)}>
                <span className="icon">▶</span> Run App
              </button>
              <button onClick={() => handleSelectExecutable(contextMenu.project)}>
                <span className="icon">⚡</span> Change Executable
              </button>
              <button onClick={() => handleClearExecutable(contextMenu.project)}>
                <span className="icon">✕</span> Clear Executable
              </button>
            </>
          ) : (
            <button onClick={() => handleSelectExecutable(contextMenu.project)}>
              <span className="icon">⚡</span> Set Executable
            </button>
          )}
          <div className="context-menu-divider" />
          <button onClick={() => handleConfigureApi(contextMenu.project)}>
            <span className="icon">🔌</span> Configure API Port
            {contextMenu.project.apiPort && <span className="menu-hint">:{contextMenu.project.apiPort}</span>}
          </button>
          <div className="context-menu-divider" />
          <button
            className="danger"
            onClick={() => {
              onRemoveProject(contextMenu.project.path)
              setContextMenu(null)
            }}
          >
            <span className="icon">🗑</span> Remove Project
          </button>
        </div>,
        document.body
      )}

      {/* API Port Modal - rendered via portal */}
      {apiPortModal && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={() => !apiPortModal.status && setApiPortModal(null)}>
          <div className="modal api-port-modal" onClick={(e) => e.stopPropagation()}>
            {apiPortModal.status === 'success' ? (
              <div className="modal-success">
                <span className="success-icon">✓</span>
                <p>API Server started on port {apiPortModal.currentPort}</p>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <h2>Configure API Port</h2>
                  <button className="modal-close" onClick={() => setApiPortModal(null)}>×</button>
                </div>
                <div className="modal-content">
                  <p className="form-hint">
                    Set a port to enable HTTP API for sending prompts to this project's terminal.
                  </p>
                  <div className="form-group">
                    <label>Port Number</label>
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={apiPortModal.currentPort}
                      onChange={(e) => setApiPortModal({ ...apiPortModal, currentPort: e.target.value, status: undefined, error: undefined })}
                      placeholder="e.g., 3001"
                      autoFocus
                      disabled={apiPortModal.status === 'checking'}
                      className={apiPortModal.status === 'error' ? 'input-error' : ''}
                    />
                    {apiPortModal.status === 'error' && (
                      <p className="error-message">{apiPortModal.error}</p>
                    )}
                  </div>
                  <p className="form-hint api-usage">
                    Usage: <code>curl -X POST http://localhost:{apiPortModal.currentPort || '3001'}/prompt -d '{`{"prompt":"your message"}`}'</code>
                  </p>
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setApiPortModal(null)} disabled={apiPortModal.status === 'checking'}>Cancel</button>
                  <button className="btn-primary" onClick={handleSaveApiPort} disabled={apiPortModal.status === 'checking'}>
                    {apiPortModal.status === 'checking' ? 'Checking...' : 'Save & Start'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
