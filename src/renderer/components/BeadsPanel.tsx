import React, { useState, useEffect, useCallback, useRef } from 'react'

interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
}

interface BeadsPanelProps {
  projectPath: string | null
  isExpanded: boolean
  onToggle: () => void
}

// Storage key for panel height
const BEADS_HEIGHT_KEY = 'beads-panel-height'
const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 100
const MAX_HEIGHT = 500

// Cache tasks per project path to avoid reload flicker when switching
const tasksCache = new Map<string, BeadsTask[]>()
const beadsStatusCache = new Map<string, { installed: boolean; initialized: boolean }>()

export function BeadsPanel({ projectPath, isExpanded, onToggle }: BeadsPanelProps) {
  const [beadsInstalled, setBeadsInstalled] = useState(false)
  const [beadsInitialized, setBeadsInitialized] = useState(false)
  const [tasks, setTasks] = useState<BeadsTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [installing, setInstalling] = useState<'beads' | 'python' | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [needsPython, setNeedsPython] = useState(false)
  const [installStatus, setInstallStatus] = useState<string | null>(null)
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(BEADS_HEIGHT_KEY)
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const status = await window.electronAPI.beadsCheck(projectPath)
      setBeadsInstalled(status.installed)
      setBeadsInitialized(status.initialized)
      beadsStatusCache.set(projectPath, status)

      if (status.installed && status.initialized) {
        const result = await window.electronAPI.beadsList(projectPath)
        if (result.success && result.tasks) {
          setTasks(result.tasks)
          tasksCache.set(projectPath, result.tasks)
        } else {
          setError(result.error || 'Failed to load tasks')
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  const handleInitBeads = async () => {
    if (!projectPath) return

    setInitializing(true)
    setError(null)

    try {
      const result = await window.electronAPI.beadsInit(projectPath)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to initialize beads')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setInitializing(false)
    }
  }

  const handleInstallPython = async () => {
    setInstalling('python')
    setInstallError(null)
    setInstallStatus('Downloading Python...')

    try {
      const result = await window.electronAPI.pythonInstall()
      if (result.success) {
        setNeedsPython(false)
        setInstallStatus(null)
        // Now try installing beads again
        handleInstallBeads()
      } else {
        setInstallError(result.error || 'Python installation failed')
        setInstallStatus(null)
      }
    } catch (e) {
      setInstallError(String(e))
      setInstallStatus(null)
    } finally {
      setInstalling(null)
    }
  }

  const handleInstallBeads = async () => {
    setInstalling('beads')
    setInstallError(null)
    setNeedsPython(false)

    try {
      const result = await window.electronAPI.beadsInstall()
      if (result.success) {
        setBeadsInstalled(true)
        loadTasks()
      } else if (result.needsPython) {
        setNeedsPython(true)
        setInstallError(result.error || 'Python is required')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(null)
    }
  }

  // Listen for install progress
  useEffect(() => {
    const cleanup = window.electronAPI.onInstallProgress((data) => {
      if (data.type === 'python') {
        const percent = data.percent !== undefined ? ` (${data.percent}%)` : ''
        setInstallStatus(`${data.status}${percent}`)
      }
    })
    return cleanup
  }, [])

  // When project changes, load from cache immediately then refresh in background
  useEffect(() => {
    setError(null)
    if (projectPath) {
      // Load from cache instantly if available
      const cachedTasks = tasksCache.get(projectPath)
      const cachedStatus = beadsStatusCache.get(projectPath)
      if (cachedTasks && cachedStatus) {
        setTasks(cachedTasks)
        setBeadsInstalled(cachedStatus.installed)
        setBeadsInitialized(cachedStatus.initialized)
      } else {
        // No cache - clear and show loading
        setTasks([])
        setBeadsInitialized(false)
        setBeadsInstalled(false)
      }
    } else {
      setTasks([])
      setBeadsInitialized(false)
      setBeadsInstalled(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (projectPath && isExpanded) {
      // Show loading only if no cached data
      const hasCachedData = tasksCache.has(projectPath)
      loadTasks(!hasCachedData)
      // Auto-refresh every 10 seconds (silent, no loading state)
      const interval = setInterval(() => loadTasks(false), 10000)
      return () => clearInterval(interval)
    }
  }, [projectPath, isExpanded, loadTasks])

  const handleCreateTask = async () => {
    if (!projectPath || !newTaskTitle.trim()) return

    try {
      let title = newTaskTitle.trim()
      let description: string | undefined

      // If over 500 chars, split into title and description
      if (title.length > 500) {
        // Try to split at first sentence end, or at 100 chars
        const firstSentence = title.match(/^[^.!?]+[.!?]/)
        if (firstSentence && firstSentence[0].length <= 100) {
          title = firstSentence[0].trim()
          description = newTaskTitle.trim().slice(firstSentence[0].length).trim()
        } else {
          // Split at ~100 chars at word boundary
          const cutoff = title.slice(0, 100).lastIndexOf(' ')
          const splitAt = cutoff > 50 ? cutoff : 100
          title = title.slice(0, splitAt).trim()
          description = newTaskTitle.trim().slice(splitAt).trim()
        }
      }

      const result = await window.electronAPI.beadsCreate(projectPath, title, description)
      if (result.success) {
        setNewTaskTitle('')
        setShowCreateForm(false)
        loadTasks()
      } else {
        setError(result.error || 'Failed to create task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleCompleteTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsComplete(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to complete task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsDelete(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to delete task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStartTask = async (taskId: string) => {
    if (!projectPath) return

    try {
      const result = await window.electronAPI.beadsStart(projectPath, taskId)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to start task')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleClearCompleted = async () => {
    if (!projectPath) return

    const closedTasks = tasks.filter(t => t.status === 'closed')
    for (const task of closedTasks) {
      try {
        await window.electronAPI.beadsDelete(projectPath, task.id)
      } catch (e) {
        // Silently continue on error
      }
    }
    await loadTasks()
  }

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      // Dragging up = larger panel (negative delta)
      const delta = resizeRef.current.startY - e.clientY
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeRef.current.startHeight + delta))
      setPanelHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      localStorage.setItem(BEADS_HEIGHT_KEY, String(panelHeight))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, panelHeight])

  const getPriorityClass = (priority?: number) => {
    if (priority === 0) return 'priority-critical'
    if (priority === 1) return 'priority-high'
    if (priority === 2) return 'priority-medium'
    return 'priority-low'
  }

  // Split on both / and \ for cross-platform support
  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null

  return (
    <div className="beads-panel">
      <div className="beads-header" onClick={onToggle}>
        <span className="beads-toggle">{isExpanded ? '▼' : '▶'}</span>
        <span className="beads-icon">📿</span>
        <span className="beads-title">
          Beads{projectName ? `: ${projectName}` : ''}
        </span>
        {tasks.length > 0 && <span className="beads-count">{tasks.length}</span>}
      </div>

      {isExpanded && (
        <div className="beads-content">
          <div
            className={`beads-resize-handle ${isResizing ? 'active' : ''}`}
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />
          {!projectPath && (
            <div className="beads-empty">Select a project to view tasks</div>
          )}

          {projectPath && !beadsInstalled && !loading && (
            <div className="beads-empty">
              <p>Beads CLI (<code>bd</code>) not found.</p>
              {installError && <p className="beads-install-error">{installError}</p>}
              {installStatus && <p className="beads-install-status">{installStatus}</p>}
              <div className="beads-install-buttons">
                {needsPython && (
                  <button
                    className="beads-init-btn"
                    onClick={handleInstallPython}
                    disabled={installing !== null}
                  >
                    {installing === 'python' ? 'Installing Python...' : '1. Install Python'}
                  </button>
                )}
                <button
                  className="beads-init-btn"
                  onClick={handleInstallBeads}
                  disabled={installing !== null || needsPython}
                >
                  {installing === 'beads' ? 'Installing...' : needsPython ? '2. Install Beads' : 'Install Beads CLI'}
                </button>
              </div>
            </div>
          )}

          {projectPath && beadsInstalled && !beadsInitialized && !loading && (
            <div className="beads-empty">
              <p>No Beads initialized.</p>
              <button
                className="beads-init-btn"
                onClick={handleInitBeads}
                disabled={initializing}
              >
                {initializing ? 'Initializing...' : 'Initialize Beads'}
              </button>
            </div>
          )}

          {projectPath && loading && (
            <div className="beads-loading">Loading tasks...</div>
          )}

          {projectPath && beadsInitialized && !loading && error && (
            <div className="beads-error">{error}</div>
          )}

          {projectPath && beadsInitialized && !loading && !error && (
            <>
              <div className="beads-tasks" style={{ maxHeight: `${panelHeight}px` }}>
                {tasks.length === 0 ? (
                  <div className="beads-empty">No ready tasks</div>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className={`beads-task ${getPriorityClass(task.priority)} status-${task.status}`}>
                      {task.status === 'closed' ? (
                        <span className="beads-task-done">✓</span>
                      ) : task.status === 'in_progress' ? (
                        <button
                          className="beads-task-check"
                          onClick={() => handleCompleteTask(task.id)}
                          title="Mark complete"
                        >
                          ○
                        </button>
                      ) : (
                        <button
                          className="beads-task-start"
                          onClick={() => handleStartTask(task.id)}
                          title="Start task"
                        >
                          ▶
                        </button>
                      )}
                      <div className="beads-task-content">
                        <div className={`beads-task-title ${task.status === 'closed' ? 'completed' : ''}`} title={task.title}>{task.title}</div>
                        <div className="beads-task-meta">
                          <span className="beads-task-id">{task.id}</span>
                          <span className={`beads-task-status status-${task.status}`}>
                            {task.status === 'in_progress' ? 'In Progress' : task.status === 'closed' ? 'Done' : 'Open'}
                          </span>
                        </div>
                      </div>
                      <button
                        className="beads-task-delete"
                        onClick={() => handleDeleteTask(task.id)}
                        title="Delete task"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              {showCreateForm ? (
                <div className="beads-create-form">
                  <textarea
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Task title or description..."
                    autoFocus
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleCreateTask()
                      }
                      if (e.key === 'Escape') setShowCreateForm(false)
                    }}
                  />
                  <div className="beads-create-footer">
                    <span className={`beads-char-count ${newTaskTitle.length > 500 ? 'over-limit' : ''}`}>
                      {newTaskTitle.length > 500 ? `${newTaskTitle.length}/500 (will split)` : `${newTaskTitle.length}`}
                    </span>
                    <div className="beads-create-actions">
                      <button onClick={handleCreateTask}>Add</button>
                      <button onClick={() => setShowCreateForm(false)}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="beads-actions-row">
                  <button
                    className="beads-add-btn"
                    onClick={() => setShowCreateForm(true)}
                  >
                    + Add Task
                  </button>
                  {tasks.some(t => t.status === 'closed') && (
                    <button
                      className="beads-clear-btn"
                      onClick={handleClearCompleted}
                      title="Clear completed tasks"
                    >
                      ✓
                    </button>
                  )}
                  <button className="beads-refresh-btn" onClick={() => loadTasks()} title="Refresh">
                    ↻
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
