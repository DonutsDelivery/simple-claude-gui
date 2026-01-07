import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Project } from '../stores/workspace'
import { ProjectIcon } from './ProjectIcon'
import { BeadsPanel } from './BeadsPanel'
import { VoiceControls } from './VoiceControls'
import { useVoice } from '../contexts/VoiceContext'

// Tool patterns for quick selection
const COMMON_TOOLS = [
  { label: 'Read', value: 'Read' },
  { label: 'Write', value: 'Write' },
  { label: 'Edit', value: 'Edit' },
  { label: 'MultiEdit', value: 'MultiEdit' },
  { label: 'Grep', value: 'Grep' },
  { label: 'Glob', value: 'Glob' },
  { label: 'LS', value: 'LS' },
  { label: 'WebFetch', value: 'WebFetch' },
  { label: 'WebSearch', value: 'WebSearch' },
  { label: 'Questions', value: 'AskUserQuestion' },
  { label: 'Task', value: 'Task' },
  { label: 'TodoWrite', value: 'TodoWrite' },
  { label: 'Git', value: 'Bash(git:*)' },
  { label: 'npm', value: 'Bash(npm:*)' },
  { label: 'All Bash', value: 'Bash' },
]

const PERMISSION_MODES = [
  { label: 'Default', value: 'default', desc: 'Ask for permissions' },
  { label: 'Accept Edits', value: 'acceptEdits', desc: 'Auto-accept edits' },
  { label: "Don't Ask", value: 'dontAsk', desc: 'Skip prompts' },
  { label: 'Bypass All', value: 'bypassPermissions', desc: 'Skip all checks' },
]

const API_SESSION_MODES = [
  { label: 'Existing', value: 'existing', desc: 'Use existing session' },
  { label: 'New (Keep)', value: 'new-keep', desc: 'New session, keep open' },
  { label: 'New (Close)', value: 'new-close', desc: 'New session, auto-close' },
]

const API_MODELS = [
  { label: 'Default', value: 'default', desc: 'Use default model' },
  { label: 'Opus', value: 'opus', desc: 'Most capable' },
  { label: 'Sonnet', value: 'sonnet', desc: 'Balanced' },
  { label: 'Haiku', value: 'haiku', desc: 'Fast & cheap' },
]

const PROJECT_COLORS = [
  { name: 'None', value: undefined },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
]

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
  onCloseProjectTabs: (projectPath: string) => void
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
  onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ projects, openTabs, activeTabId, lastFocusedTabId, onAddProject, onRemoveProject, onOpenSession, onSwitchToTab, onOpenSettings, onOpenMakeProject, onUpdateProject, onCloseProjectTabs, width, collapsed, onWidthChange, onCollapsedChange }: SidebarProps) {
  const { volume, setVolume, speed, setSpeed, skipOnNew, setSkipOnNew, voiceOutputEnabled } = useVoice()

  // Ref to always have latest activeTabId for voice transcription callback
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, ClaudeSession[]>>({})
  const [beadsExpanded, setBeadsExpanded] = useState(true)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [projectSettingsModal, setProjectSettingsModal] = useState<{
    project: Project
    apiPort: string
    apiSessionMode: 'existing' | 'new-keep' | 'new-close'
    apiModel: 'default' | 'opus' | 'sonnet' | 'haiku'
    tools: string[]
    permissionMode: string
    apiStatus?: 'checking' | 'success' | 'error'
    apiError?: string
    ttsVoice: string  // empty string means use global
    ttsEngine: 'piper' | 'xtts' | ''  // empty string means use global
    backend: 'default' | 'claude' | 'gemini'
  } | null>(null)
  const [installedVoices, setInstalledVoices] = useState<Array<{ key: string; displayName: string; source: string }>>([])
  const [globalVoiceSettings, setGlobalVoiceSettings] = useState<{ voice: string; engine: string }>({ voice: '', engine: '' })
  const [globalPermissions, setGlobalPermissions] = useState<{ tools: string[]; mode: string }>({ tools: [], mode: 'default' })
  const [apiStatus, setApiStatus] = useState<Record<string, { running: boolean; port?: number }>>({})
  const [editingProject, setEditingProject] = useState<{ path: string; name: string } | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

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

  const handleStartRename = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    setEditingProject({ path: project.path, name: project.name })
    // Focus input after render
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  const handleRenameSubmit = () => {
    if (editingProject && editingProject.name.trim()) {
      onUpdateProject(editingProject.path, { name: editingProject.name.trim() })
    }
    setEditingProject(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      setEditingProject(null)
    }
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

  const handleOpenProjectSettings = async (project: Project) => {
    // Fetch global settings to show comparison
    const settings = await window.electronAPI.getSettings()
    setGlobalPermissions({
      tools: settings.autoAcceptTools || [],
      mode: settings.permissionMode || 'default'
    })

    // Load installed voices (Piper and XTTS)
    const [piperVoices, xttsVoices, voiceSettings] = await Promise.all([
      window.electronAPI.voiceGetInstalled?.() || [],
      window.electronAPI.xttsGetVoices?.() || [],
      window.electronAPI.voiceGetSettings?.() || {}
    ])
    const combined: Array<{ key: string; displayName: string; source: string }> = []
    if (piperVoices) combined.push(...piperVoices)
    if (xttsVoices) {
      combined.push(...xttsVoices.map((v: { id: string; name: string }) => ({
        key: v.id,
        displayName: v.name,
        source: 'xtts'
      })))
    }
    setInstalledVoices(combined)
    setGlobalVoiceSettings({
      voice: voiceSettings?.ttsVoice || '',
      engine: voiceSettings?.ttsEngine || 'piper'
    })

    setProjectSettingsModal({
      project,
      apiPort: project.apiPort?.toString() || '',
      apiSessionMode: project.apiSessionMode || 'existing',
      apiModel: project.apiModel || 'default',
      tools: project.autoAcceptTools || [],
      permissionMode: project.permissionMode || 'default',
      ttsVoice: project.ttsVoice || '',
      ttsEngine: project.ttsEngine || '',
      backend: project.backend || 'default'
    })
    setContextMenu(null)
  }

  const handleSaveProjectSettings = async () => {
    if (!projectSettingsModal) return

    const port = parseInt(projectSettingsModal.apiPort, 10)
    const hasPortValue = projectSettingsModal.apiPort.trim() !== ''

    // Validate port if provided
    if (hasPortValue && (isNaN(port) || port < 1024 || port > 65535)) {
      setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'error', apiError: 'Please enter a valid port number (1024-65535)' })
      return
    }

    const newPort = hasPortValue ? port : undefined
    const oldPort = projectSettingsModal.project.apiPort

    // Handle API server changes
    if (newPort !== oldPort) {
      if (!newPort) {
        // Clearing the port, stop server
        await window.electronAPI.apiStop(projectSettingsModal.project.path)
        setApiStatus(prev => ({ ...prev, [projectSettingsModal.project.path]: { running: false } }))
      } else {
        // New port, try to start server
        setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'checking' })
        const result = await window.electronAPI.apiStart(projectSettingsModal.project.path, newPort)
        if (!result.success) {
          setProjectSettingsModal({ ...projectSettingsModal, apiStatus: 'error', apiError: result.error || 'Port may already be in use' })
          return
        }
        setApiStatus(prev => ({ ...prev, [projectSettingsModal.project.path]: { running: true, port: newPort } }))
      }
    }

    // Save all settings
    onUpdateProject(projectSettingsModal.project.path, {
      apiPort: newPort,
      apiSessionMode: projectSettingsModal.apiSessionMode !== 'existing' ? projectSettingsModal.apiSessionMode : undefined,
      apiModel: projectSettingsModal.apiModel !== 'default' ? projectSettingsModal.apiModel : undefined,
      autoAcceptTools: projectSettingsModal.tools.length > 0 ? projectSettingsModal.tools : undefined,
      permissionMode: projectSettingsModal.permissionMode !== 'default' ? projectSettingsModal.permissionMode : undefined,
      ttsVoice: projectSettingsModal.ttsVoice || undefined,
      ttsEngine: projectSettingsModal.ttsEngine || undefined,
      backend: projectSettingsModal.backend !== 'default' ? projectSettingsModal.backend : undefined
    })

    setProjectSettingsModal(null)
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

  const togglePermissionTool = (tool: string) => {
    if (!projectSettingsModal) return
    const newTools = projectSettingsModal.tools.includes(tool)
      ? projectSettingsModal.tools.filter(t => t !== tool)
      : [...projectSettingsModal.tools, tool]
    setProjectSettingsModal({ ...projectSettingsModal, tools: newTools })
  }

  const handleAllowAll = () => {
    if (!projectSettingsModal) return
    const allTools = COMMON_TOOLS.map(t => t.value)
    setProjectSettingsModal({ ...projectSettingsModal, tools: allTools, permissionMode: 'bypassPermissions' })
  }

  const handleClearAll = () => {
    if (!projectSettingsModal) return
    setProjectSettingsModal({ ...projectSettingsModal, tools: [], permissionMode: 'default' })
  }

  // Check API status for focused project
  useEffect(() => {
    if (focusedProjectPath) {
      window.electronAPI.apiStatus(focusedProjectPath).then((status) => {
        setApiStatus(prev => ({ ...prev, [focusedProjectPath]: status }))
      })
    }
  }, [focusedProjectPath])

  // Check if running in debug mode
  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

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
              className={`project-item ${expandedProject === project.path ? 'expanded' : ''} ${openTabs.some(t => t.projectPath === project.path) ? 'has-open-tab' : ''} ${project.executable ? 'has-executable' : ''} ${project.color ? 'has-color' : ''} ${focusedProjectPath === project.path ? 'focused' : ''}`}
              style={project.color ? { backgroundColor: `${project.color}20` } : undefined}
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
                {editingProject?.path === project.path ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="project-name-input"
                    value={editingProject.name}
                    onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={handleRenameSubmit}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className="project-name"
                    title={project.name}
                    onDoubleClick={(e) => handleStartRename(e, project)}
                  >
                    {project.name}
                  </div>
                )}
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
              {openTabs.some(t => t.projectPath === project.path) && (
                <button
                  className="close-project-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseProjectTabs(project.path)
                  }}
                  title="Close all terminals for this project"
                >
                  ×
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
            No projects yet.<br />Click + to add one.
          </div>
        )}
        <div className="project-add-buttons">
          <button
            className="add-project-btn"
            onClick={onOpenMakeProject}
            title="Create new project from scratch"
          >
            + make
          </button>
          <button
            className="add-project-btn"
            onClick={onAddProject}
            title="Add existing project folder"
          >
            + add
          </button>
        </div>
      </div>
      <BeadsPanel
        projectPath={beadsProjectPath}
        isExpanded={beadsExpanded}
        onToggle={() => setBeadsExpanded(!beadsExpanded)}
      />
      {voiceOutputEnabled && (
        <div className="voice-options">
          <div className="voice-slider-row">
            <span className="voice-option-icon" title="Volume">🔊</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="voice-slider"
            />
            <span className="voice-slider-value">{Math.round(volume * 100)}%</span>
          </div>
          <div className="voice-slider-row">
            <span className="voice-option-icon" title="Speed">⏩</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="voice-slider"
            />
            <span className="voice-slider-value">{speed.toFixed(1)}x</span>
          </div>
          <label className="voice-option-checkbox" title="Skip to latest message instead of queuing">
            <input
              type="checkbox"
              checked={skipOnNew}
              onChange={(e) => setSkipOnNew(e.target.checked)}
            />
            <span>Skip to new</span>
          </label>
        </div>
      )}
      <div className="sidebar-actions">
        <VoiceControls
          activeTabId={activeTabId}
          onTranscription={(text) => {
            // Use ref to always get current active tab, not the one when recording started
            const currentTabId = activeTabIdRef.current
            if (currentTabId) {
              // Send text first, then carriage return after delay (like API does)
              window.electronAPI.writePty(currentTabId, text)
              setTimeout(() => {
                window.electronAPI.writePty(currentTabId, '\r')
              }, 100)
            }
          }}
        />
        {(() => {
          const focusedProject = projects.find(p => p.path === focusedProjectPath)
          if (focusedProject) {
            const status = apiStatus[focusedProject.path]
            const hasPort = !!focusedProject.apiPort
            return (
              <button
                className={`action-icon-btn ${status?.running ? 'enabled' : ''}`}
                onClick={() => {
                  if (!hasPort) {
                    handleOpenProjectSettings(focusedProject)
                  } else {
                    handleToggleApi(focusedProject)
                  }
                }}
                tabIndex={-1}
                title={status?.running ? `Stop API (port ${focusedProject.apiPort})` : hasPort ? `Start API (port ${focusedProject.apiPort})` : 'Configure API'}
              >
                {status?.running ? '🟢' : '🔌'}
              </button>
            )
          }
          return null
        })()}
        {isDebugMode && (
          <button
            className="action-icon-btn"
            onClick={() => window.electronAPI.refresh()}
            tabIndex={-1}
            title="Refresh (Debug Mode)"
          >
            🔄
          </button>
        )}
        <button
          className="action-icon-btn"
          onClick={onOpenSettings}
          tabIndex={-1}
          title="Settings"
        >
          ⚙️
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
          <button onClick={() => handleOpenProjectSettings(contextMenu.project)}>
            <span className="icon">⚙</span> Project Settings
            {(contextMenu.project.apiPort || contextMenu.project.autoAcceptTools?.length || contextMenu.project.permissionMode) && (
              <span className="menu-hint">configured</span>
            )}
          </button>
          <div className="context-menu-divider" />
          <div className="context-menu-label">Color</div>
          <div className="color-picker-row">
            {PROJECT_COLORS.map((color) => (
              <button
                key={color.name}
                className={`color-swatch ${contextMenu.project.color === color.value ? 'selected' : ''} ${!color.value ? 'none' : ''}`}
                style={color.value ? { backgroundColor: color.value } : undefined}
                title={color.name}
                onClick={() => {
                  onUpdateProject(contextMenu.project.path, { color: color.value })
                  setContextMenu(null)
                }}
              >
                {!color.value && '✕'}
              </button>
            ))}
          </div>
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

      {/* Project Settings Modal - rendered via portal */}
      {projectSettingsModal && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={() => !projectSettingsModal.apiStatus && setProjectSettingsModal(null)}>
          <div className="modal project-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Project Settings: {projectSettingsModal.project.name}</h2>
              <button className="modal-close" onClick={() => setProjectSettingsModal(null)}>×</button>
            </div>
            <div className="modal-content">
              {/* API Settings Section */}
              <div className="settings-section">
                <h3>API Settings</h3>
                <p className="form-hint">Enable HTTP API to send prompts to this project's terminal.</p>

                <div className="form-group">
                  <label>Port Number</label>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={projectSettingsModal.apiPort}
                    onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, apiPort: e.target.value, apiStatus: undefined, apiError: undefined })}
                    placeholder="e.g., 3001 (leave empty to disable)"
                    disabled={projectSettingsModal.apiStatus === 'checking'}
                    className={projectSettingsModal.apiStatus === 'error' ? 'input-error' : ''}
                  />
                  {projectSettingsModal.apiStatus === 'error' && (
                    <p className="error-message">{projectSettingsModal.apiError}</p>
                  )}
                </div>

                <div className="form-group">
                  <label>Session Mode</label>
                  <p className="form-hint">How API requests handle terminal sessions.</p>
                  <div className={`session-mode-options ${!projectSettingsModal.apiPort ? 'disabled' : ''}`}>
                    {API_SESSION_MODES.map((mode) => (
                      <label key={mode.value} className={`session-mode-option ${projectSettingsModal.apiSessionMode === mode.value ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="apiSessionMode"
                          value={mode.value}
                          checked={projectSettingsModal.apiSessionMode === mode.value}
                          onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, apiSessionMode: e.target.value as 'existing' | 'new-keep' | 'new-close' })}
                          disabled={!projectSettingsModal.apiPort}
                        />
                        <span className="mode-label">{mode.label}</span>
                        <span className="mode-desc">{mode.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Model selection - only for new session modes */}
                {projectSettingsModal.apiSessionMode !== 'existing' && (
                  <div className="form-group">
                    <label>API Session Model</label>
                    <p className="form-hint">Model for API-triggered sessions. Use cheaper models for automated workflows.</p>
                    <div className={`session-mode-options ${!projectSettingsModal.apiPort ? 'disabled' : ''}`}>
                      {API_MODELS.map((model) => (
                        <label key={model.value} className={`session-mode-option ${projectSettingsModal.apiModel === model.value ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="apiModel"
                            value={model.value}
                            checked={projectSettingsModal.apiModel === model.value}
                            onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, apiModel: e.target.value as 'default' | 'opus' | 'sonnet' | 'haiku' })}
                            disabled={!projectSettingsModal.apiPort}
                          />
                          <span className="mode-label">{model.label}</span>
                          <span className="mode-desc">{model.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {projectSettingsModal.apiPort && (
                  <p className="form-hint api-usage">
                    Usage: <code>curl -X POST http://localhost:{projectSettingsModal.apiPort}/prompt -d '{`{"prompt":"..."}`}'</code>
                  </p>
                )}
              </div>

              {/* Permissions Section */}
              <div className="settings-section">
                <h3>Permissions</h3>
                <p className="form-hint">Override global permission settings for this project.</p>

                <div className="form-group">
                  <label>Auto-Accept Tools</label>
                  <div className="tool-chips">
                    {COMMON_TOOLS.map((tool) => {
                      const isProjectSelected = projectSettingsModal.tools.includes(tool.value)
                      const isGlobalSelected = globalPermissions.tools.includes(tool.value)
                      return (
                        <button
                          key={tool.value}
                          className={`tool-chip ${isProjectSelected ? 'selected' : ''} ${isGlobalSelected && !isProjectSelected ? 'global' : ''}`}
                          onClick={() => togglePermissionTool(tool.value)}
                          title={`${tool.value}${isGlobalSelected ? ' (enabled in global settings)' : ''}`}
                        >
                          {tool.label}
                          {isGlobalSelected && !isProjectSelected && <span className="global-indicator">G</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>Permission Mode</label>
                  {globalPermissions.mode !== 'default' && projectSettingsModal.permissionMode === 'default' && (
                    <p className="form-hint global-hint">
                      Global: {PERMISSION_MODES.find(m => m.value === globalPermissions.mode)?.label}
                    </p>
                  )}
                  <div className="permission-mode-options compact">
                    {PERMISSION_MODES.map((mode) => {
                      const isGlobalMode = globalPermissions.mode === mode.value && projectSettingsModal.permissionMode === 'default'
                      return (
                        <label key={mode.value} className={`permission-mode-option ${projectSettingsModal.permissionMode === mode.value ? 'selected' : ''} ${isGlobalMode ? 'global' : ''}`}>
                          <input
                            type="radio"
                            name="permissionMode"
                            value={mode.value}
                            checked={projectSettingsModal.permissionMode === mode.value}
                            onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, permissionMode: e.target.value })}
                          />
                          <span className="mode-label">{mode.label}</span>
                          <span className="mode-desc">{mode.desc}</span>
                          {isGlobalMode && <span className="global-indicator">G</span>}
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="permission-quick-actions">
                  <button className="btn-danger-outline" onClick={handleAllowAll}>
                    Allow All
                  </button>
                  <button className="btn-secondary" onClick={handleClearAll}>
                    Clear All
                  </button>
                </div>
              </div>

              {/* Backend Settings Section */}
              <div className="settings-section">
                <h3>Backend Settings</h3>
                <p className="form-hint">Override the global default backend for this project.</p>

                <div className="form-group">
                  <div className="permission-mode-options compact">
                    <label className={`permission-mode-option ${projectSettingsModal.backend === 'default' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="projectBackend"
                        value="default"
                        checked={projectSettingsModal.backend === 'default'}
                        onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, backend: e.target.value as 'default' | 'claude' | 'gemini' })}
                      />
                      <span className="mode-label">Use global default</span>
                      <span className="mode-desc">Uses the backend selected in the main settings.</span>
                    </label>
                    <label className={`permission-mode-option ${projectSettingsModal.backend === 'claude' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="projectBackend"
                        value="claude"
                        checked={projectSettingsModal.backend === 'claude'}
                        onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, backend: e.target.value as 'default' | 'claude' | 'gemini' })}
                      />
                      <span className="mode-label">Claude</span>
                      <span className="mode-desc">Forces this project to use Claude.</span>
                    </label>
                    <label className={`permission-mode-option ${projectSettingsModal.backend === 'gemini' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="projectBackend"
                        value="gemini"
                        checked={projectSettingsModal.backend === 'gemini'}
                        onChange={(e) => setProjectSettingsModal({ ...projectSettingsModal, backend: e.target.value as 'default' | 'claude' | 'gemini' })}
                      />
                      <span className="mode-label">Gemini</span>
                      <span className="mode-desc">Forces this project to use Gemini.</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Voice Settings Section */}
              <div className="settings-section">
                <h3>Voice</h3>
                <p className="form-hint">Override global TTS voice for this project.</p>

                <div className="form-group">
                  <label>TTS Voice</label>
                  {globalVoiceSettings.voice && !projectSettingsModal.ttsVoice && (
                    <p className="form-hint global-hint">
                      Global: {installedVoices.find(v => v.key === globalVoiceSettings.voice)?.displayName || globalVoiceSettings.voice}
                    </p>
                  )}
                  <select
                    className="voice-select"
                    value={projectSettingsModal.ttsVoice ? `${projectSettingsModal.ttsEngine}:${projectSettingsModal.ttsVoice}` : ''}
                    onChange={(e) => {
                      const value = e.target.value
                      if (!value) {
                        setProjectSettingsModal({ ...projectSettingsModal, ttsVoice: '', ttsEngine: '' })
                      } else {
                        const [engine, ...voiceParts] = value.split(':')
                        const voice = voiceParts.join(':')  // Handle voice keys that might contain colons
                        setProjectSettingsModal({
                          ...projectSettingsModal,
                          ttsVoice: voice,
                          ttsEngine: engine as 'piper' | 'xtts'
                        })
                      }
                    }}
                  >
                    <option value="">Use global voice</option>
                    {installedVoices.length > 0 && (
                      <>
                        {installedVoices.filter(v => v.source !== 'xtts').length > 0 && (
                          <optgroup label="Piper Voices">
                            {installedVoices
                              .filter(v => v.source !== 'xtts')
                              .map(v => (
                                <option key={v.key} value={`piper:${v.key}`}>
                                  {v.displayName}
                                  {v.key === globalVoiceSettings.voice && globalVoiceSettings.engine === 'piper' ? ' (global)' : ''}
                                </option>
                              ))}
                          </optgroup>
                        )}
                        {installedVoices.filter(v => v.source === 'xtts').length > 0 && (
                          <optgroup label="XTTS Cloned Voices">
                            {installedVoices
                              .filter(v => v.source === 'xtts')
                              .map(v => (
                                <option key={v.key} value={`xtts:${v.key}`}>
                                  {v.displayName}
                                  {v.key === globalVoiceSettings.voice && globalVoiceSettings.engine === 'xtts' ? ' (global)' : ''}
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </>
                    )}
                  </select>
                  {installedVoices.length === 0 && (
                    <p className="form-hint">No voices installed. Install voices in Settings.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setProjectSettingsModal(null)} disabled={projectSettingsModal.apiStatus === 'checking'}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveProjectSettings} disabled={projectSettingsModal.apiStatus === 'checking'}>
                {projectSettingsModal.apiStatus === 'checking' ? 'Checking...' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
