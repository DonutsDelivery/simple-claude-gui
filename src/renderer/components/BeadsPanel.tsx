import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'

interface BeadsTask {
  id: string
  title: string
  status: string
  priority?: number
  created?: string
  blockers?: string[]
  description?: string
  issue_type?: string
  created_at?: string
  updated_at?: string
  dependency_count?: number
  dependent_count?: number
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
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<'task' | 'bug' | 'feature' | 'epic' | 'chore'>('task')
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2)
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskLabels, setNewTaskLabels] = useState('')
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
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailTask, setDetailTask] = useState<BeadsTask | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editingDetail, setEditingDetail] = useState(false)
  const [editDetailTitle, setEditDetailTitle] = useState('')
  const [editDetailDescription, setEditDetailDescription] = useState('')
  const [editDetailPriority, setEditDetailPriority] = useState<number>(2)
  const [editDetailStatus, setEditDetailStatus] = useState<string>('open')

  // Browser modal state
  const [showBrowser, setShowBrowser] = useState(false)
  const [browserFilter, setBrowserFilter] = useState<'all' | 'open' | 'in_progress' | 'closed'>('all')
  const [browserSort, setBrowserSort] = useState<'priority' | 'created' | 'status'>('priority')

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

  // When project changes, immediately clear and refresh
  useEffect(() => {
    setError(null)
    if (projectPath) {
      // Always clear first to avoid showing stale data from wrong project
      setTasks([])
      setBeadsInitialized(false)
      setBeadsInstalled(false)

      // Then load from cache for instant display (if available for THIS project)
      const cachedTasks = tasksCache.get(projectPath)
      const cachedStatus = beadsStatusCache.get(projectPath)
      if (cachedTasks && cachedStatus) {
        setTasks(cachedTasks)
        setBeadsInstalled(cachedStatus.installed)
        setBeadsInitialized(cachedStatus.initialized)
      }

      // Always fetch fresh data immediately on project change
      loadTasks(false)
    } else {
      setTasks([])
      setBeadsInitialized(false)
      setBeadsInstalled(false)
    }
  }, [projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projectPath) {
      // Auto-refresh every 10 seconds (silent, no loading state)
      const interval = setInterval(() => loadTasks(false), 10000)
      return () => clearInterval(interval)
    }
  }, [projectPath, loadTasks])

  const handleCreateTask = async () => {
    if (!projectPath || !newTaskTitle.trim()) return

    try {
      const title = newTaskTitle.trim()
      const description = newTaskDescription.trim() || undefined
      const labels = newTaskLabels.trim() || undefined

      const result = await window.electronAPI.beadsCreate(
        projectPath,
        title,
        description,
        newTaskPriority,
        newTaskType,
        labels
      )
      if (result.success) {
        // Reset form
        setNewTaskTitle('')
        setNewTaskType('task')
        setNewTaskPriority(2)
        setNewTaskDescription('')
        setNewTaskLabels('')
        setShowCreateModal(false)
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

  const handleCycleStatus = async (taskId: string, currentStatus: string) => {
    if (!projectPath) return

    // Cycle: open → in_progress → closed → open
    const nextStatus = currentStatus === 'open' ? 'in_progress'
      : currentStatus === 'in_progress' ? 'closed'
      : 'open'

    try {
      const result = await window.electronAPI.beadsUpdate(projectPath, taskId, nextStatus)
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task status')
      }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStartEdit = (task: BeadsTask) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const handleSaveEdit = async () => {
    if (!projectPath || !editingTaskId || !editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    const originalTask = tasks.find(t => t.id === editingTaskId)
    if (originalTask && originalTask.title === editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    try {
      const result = await window.electronAPI.beadsUpdate(projectPath, editingTaskId, undefined, editingTitle.trim())
      if (result.success) {
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task title')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setEditingTaskId(null)
    }
  }

  const handleCancelEdit = () => {
    setEditingTaskId(null)
    setEditingTitle('')
  }

  const handleOpenDetail = async (task: BeadsTask) => {
    if (!projectPath) return

    setShowDetailModal(true)
    setDetailLoading(true)
    setEditingDetail(true)

    try {
      const result = await window.electronAPI.beadsShow(projectPath, task.id)
      if (result.success && result.task) {
        // beadsShow returns an array with one task
        const fullTask = Array.isArray(result.task) ? result.task[0] : result.task
        setDetailTask(fullTask)
        // Pre-fill edit fields
        setEditDetailTitle(fullTask.title || '')
        setEditDetailDescription(fullTask.description || '')
        setEditDetailPriority(fullTask.priority ?? 2)
        setEditDetailStatus(fullTask.status || 'open')
      } else {
        setError(result.error || 'Failed to load task details')
        setShowDetailModal(false)
      }
    } catch (e) {
      setError(String(e))
      setShowDetailModal(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCloseDetail = () => {
    setShowDetailModal(false)
    setDetailTask(null)
    setEditingDetail(false)
  }

  const handleSaveDetail = async () => {
    if (!projectPath || !detailTask) return

    try {
      const result = await window.electronAPI.beadsUpdate(
        projectPath,
        detailTask.id,
        editDetailStatus,
        editDetailTitle.trim(),
        editDetailDescription.trim(),
        editDetailPriority
      )
      if (result.success) {
        // Update local state
        setDetailTask({
          ...detailTask,
          title: editDetailTitle.trim(),
          description: editDetailDescription.trim(),
          status: editDetailStatus,
          priority: editDetailPriority
        })
        setEditingDetail(false)
        loadTasks()
      } else {
        setError(result.error || 'Failed to update task')
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

  const getPriorityLabel = (priority?: number) => {
    if (priority === 0) return 'Critical'
    if (priority === 1) return 'High'
    if (priority === 2) return 'Medium'
    if (priority === 3) return 'Low'
    return 'Lowest'
  }

  // Filter and sort tasks for browser view
  const getFilteredTasks = () => {
    let filtered = [...tasks]

    // Apply filter
    if (browserFilter !== 'all') {
      filtered = filtered.filter(t => t.status === browserFilter)
    }

    // Apply sort
    filtered.sort((a, b) => {
      if (browserSort === 'priority') {
        return (a.priority ?? 2) - (b.priority ?? 2)
      }
      if (browserSort === 'status') {
        const statusOrder = { open: 0, in_progress: 1, closed: 2 }
        return (statusOrder[a.status as keyof typeof statusOrder] ?? 0) -
               (statusOrder[b.status as keyof typeof statusOrder] ?? 0)
      }
      if (browserSort === 'created') {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0
        return bDate - aDate // newest first
      }
      return 0
    })

    return filtered
  }

  const handleOpenBrowser = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (projectPath && beadsInitialized) {
      setShowBrowser(true)
    }
  }

  // Split on both / and \ for cross-platform support
  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null

  return (
    <div className="beads-panel">
      <div className="beads-header">
        <span className="beads-toggle" onClick={onToggle} title={isExpanded ? 'Collapse list' : 'Expand list'}>
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="beads-icon">📿</span>
        <span
          className={`beads-title ${projectPath && beadsInitialized ? 'clickable' : ''}`}
          onClick={handleOpenBrowser}
          title={projectPath && beadsInitialized ? 'Open task browser' : ''}
        >
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
                        {editingTaskId === task.id ? (
                          <input
                            ref={editInputRef}
                            className="beads-task-edit-input"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleSaveEdit()
                              }
                              if (e.key === 'Escape') handleCancelEdit()
                            }}
                            onBlur={handleSaveEdit}
                          />
                        ) : (
                          <div
                            className={`beads-task-title clickable ${task.status === 'closed' ? 'completed' : ''}`}
                            title="Click to view details"
                            onClick={() => handleOpenDetail(task)}
                          >
                            {task.title}
                          </div>
                        )}
                        <div className="beads-task-meta">
                          <span className="beads-task-id">{task.id}</span>
                          <button
                            className={`beads-task-status status-${task.status}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCycleStatus(task.id, task.status)
                            }}
                            title="Click to cycle status"
                          >
                            {task.status === 'in_progress' ? 'In Progress' : task.status === 'closed' ? 'Done' : 'Open'}
                          </button>
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

              <div className="beads-actions-row">
                <button
                  className="beads-add-btn"
                  onClick={() => setShowCreateModal(true)}
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

              {showCreateModal && ReactDOM.createPortal(
                <div className="beads-modal-overlay" onClick={() => setShowCreateModal(false)}>
                  <div className="beads-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="beads-modal-header">
                      <h3>Create Task</h3>
                      <button className="beads-modal-close" onClick={() => setShowCreateModal(false)}>×</button>
                    </div>
                    <div className="beads-modal-body">
                      <div className="beads-form-group">
                        <label htmlFor="task-title">Title *</label>
                        <input
                          id="task-title"
                          type="text"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Task title..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTaskTitle.trim()) {
                              e.preventDefault()
                              handleCreateTask()
                            }
                            if (e.key === 'Escape') setShowCreateModal(false)
                          }}
                        />
                      </div>
                      <div className="beads-form-row">
                        <div className="beads-form-group">
                          <label htmlFor="task-type">Type</label>
                          <select
                            id="task-type"
                            value={newTaskType}
                            onChange={(e) => setNewTaskType(e.target.value as typeof newTaskType)}
                          >
                            <option value="task">Task</option>
                            <option value="bug">Bug</option>
                            <option value="feature">Feature</option>
                            <option value="epic">Epic</option>
                            <option value="chore">Chore</option>
                          </select>
                        </div>
                        <div className="beads-form-group">
                          <label htmlFor="task-priority">Priority</label>
                          <select
                            id="task-priority"
                            value={newTaskPriority}
                            onChange={(e) => setNewTaskPriority(parseInt(e.target.value))}
                          >
                            <option value="0">P0 - Critical</option>
                            <option value="1">P1 - High</option>
                            <option value="2">P2 - Medium</option>
                            <option value="3">P3 - Low</option>
                            <option value="4">P4 - Lowest</option>
                          </select>
                        </div>
                      </div>
                      <div className="beads-form-group">
                        <label htmlFor="task-description">Description</label>
                        <textarea
                          id="task-description"
                          value={newTaskDescription}
                          onChange={(e) => setNewTaskDescription(e.target.value)}
                          placeholder="Optional description..."
                          rows={3}
                        />
                      </div>
                      <div className="beads-form-group">
                        <label htmlFor="task-labels">Labels</label>
                        <input
                          id="task-labels"
                          type="text"
                          value={newTaskLabels}
                          onChange={(e) => setNewTaskLabels(e.target.value)}
                          placeholder="Comma-separated labels..."
                        />
                      </div>
                    </div>
                    <div className="beads-modal-footer">
                      <button className="beads-btn-cancel" onClick={() => setShowCreateModal(false)}>Cancel</button>
                      <button
                        className="beads-btn-create"
                        onClick={handleCreateTask}
                        disabled={!newTaskTitle.trim()}
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {showDetailModal && ReactDOM.createPortal(
                <div className="beads-modal-overlay" onClick={handleCloseDetail}>
                  <div className="beads-modal beads-detail-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="beads-modal-header">
                      <h3>{detailTask?.id || 'Task Details'}</h3>
                      <button className="beads-modal-close" onClick={handleCloseDetail}>×</button>
                    </div>
                    <div className="beads-modal-body">
                      {detailLoading ? (
                        <div className="beads-detail-loading">Loading...</div>
                      ) : detailTask ? (
                        editingDetail ? (
                          <>
                            <div className="beads-form-group">
                              <label htmlFor="detail-title">Title</label>
                              <input
                                id="detail-title"
                                type="text"
                                value={editDetailTitle}
                                onChange={(e) => setEditDetailTitle(e.target.value)}
                                autoFocus
                              />
                            </div>
                            <div className="beads-form-row">
                              <div className="beads-form-group">
                                <label htmlFor="detail-status">Status</label>
                                <select
                                  id="detail-status"
                                  value={editDetailStatus}
                                  onChange={(e) => setEditDetailStatus(e.target.value)}
                                >
                                  <option value="open">Open</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="closed">Closed</option>
                                </select>
                              </div>
                              <div className="beads-form-group">
                                <label htmlFor="detail-priority">Priority</label>
                                <select
                                  id="detail-priority"
                                  value={editDetailPriority}
                                  onChange={(e) => setEditDetailPriority(parseInt(e.target.value))}
                                >
                                  <option value="0">P0 - Critical</option>
                                  <option value="1">P1 - High</option>
                                  <option value="2">P2 - Medium</option>
                                  <option value="3">P3 - Low</option>
                                  <option value="4">P4 - Lowest</option>
                                </select>
                              </div>
                            </div>
                            <div className="beads-form-group">
                              <label htmlFor="detail-description">Description</label>
                              <textarea
                                id="detail-description"
                                value={editDetailDescription}
                                onChange={(e) => setEditDetailDescription(e.target.value)}
                                rows={5}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="beads-detail-title">{detailTask.title}</div>
                            <div className="beads-detail-meta">
                              <span className={`beads-detail-status status-${detailTask.status}`}>
                                {detailTask.status === 'in_progress' ? 'In Progress' : detailTask.status === 'closed' ? 'Closed' : 'Open'}
                              </span>
                              <span className={`beads-detail-priority ${getPriorityClass(detailTask.priority)}`}>
                                P{detailTask.priority ?? 2}
                              </span>
                              <span className="beads-detail-type">{detailTask.issue_type || 'task'}</span>
                            </div>
                            {detailTask.description && (
                              <div className="beads-detail-description">
                                <label>Description</label>
                                <p>{detailTask.description}</p>
                              </div>
                            )}
                            <div className="beads-detail-timestamps">
                              {detailTask.created_at && (
                                <span>Created: {new Date(detailTask.created_at).toLocaleString()}</span>
                              )}
                              {detailTask.updated_at && (
                                <span>Updated: {new Date(detailTask.updated_at).toLocaleString()}</span>
                              )}
                            </div>
                            {(detailTask.dependency_count !== undefined || detailTask.dependent_count !== undefined) && (
                              <div className="beads-detail-deps">
                                {detailTask.dependency_count !== undefined && detailTask.dependency_count > 0 && (
                                  <span>Blocked by: {detailTask.dependency_count} task(s)</span>
                                )}
                                {detailTask.dependent_count !== undefined && detailTask.dependent_count > 0 && (
                                  <span>Blocking: {detailTask.dependent_count} task(s)</span>
                                )}
                              </div>
                            )}
                          </>
                        )
                      ) : (
                        <div className="beads-detail-error">Task not found</div>
                      )}
                    </div>
                    <div className="beads-modal-footer">
                      {editingDetail ? (
                        <>
                          <button className="beads-btn-cancel" onClick={() => setEditingDetail(false)}>Cancel</button>
                          <button
                            className="beads-btn-create"
                            onClick={handleSaveDetail}
                            disabled={!editDetailTitle.trim()}
                          >
                            Save
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="beads-btn-cancel" onClick={handleCloseDetail}>Close</button>
                          <button className="beads-btn-create" onClick={() => setEditingDetail(true)}>Edit</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </>
          )}
        </div>
      )}

      {/* Browser Modal - Full task browser */}
      {showBrowser && ReactDOM.createPortal(
        <div className="beads-modal-overlay" onClick={() => setShowBrowser(false)}>
          <div className="beads-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="beads-browser-header">
              <div className="beads-browser-title-row">
                <span className="beads-icon">📿</span>
                <h2>Beads Tasks</h2>
                <span className="beads-browser-project">{projectName}</span>
              </div>
              <button className="beads-modal-close" onClick={() => setShowBrowser(false)}>×</button>
            </div>

            <div className="beads-browser-toolbar">
              <div className="beads-browser-filters">
                <label>Filter:</label>
                <select
                  value={browserFilter}
                  onChange={(e) => setBrowserFilter(e.target.value as typeof browserFilter)}
                >
                  <option value="all">All ({tasks.length})</option>
                  <option value="open">Open ({tasks.filter(t => t.status === 'open').length})</option>
                  <option value="in_progress">In Progress ({tasks.filter(t => t.status === 'in_progress').length})</option>
                  <option value="closed">Closed ({tasks.filter(t => t.status === 'closed').length})</option>
                </select>
              </div>
              <div className="beads-browser-sort">
                <label>Sort:</label>
                <select
                  value={browserSort}
                  onChange={(e) => setBrowserSort(e.target.value as typeof browserSort)}
                >
                  <option value="priority">Priority</option>
                  <option value="status">Status</option>
                  <option value="created">Created</option>
                </select>
              </div>
              <div className="beads-browser-actions">
                <button className="beads-refresh-btn" onClick={() => loadTasks()} title="Refresh">↻</button>
                <button
                  className="beads-btn-create"
                  onClick={() => {
                    setShowBrowser(false)
                    setShowCreateModal(true)
                  }}
                >
                  + New Task
                </button>
              </div>
            </div>

            <div className="beads-browser-content">
              {getFilteredTasks().length === 0 ? (
                <div className="beads-browser-empty">
                  {browserFilter === 'all' ? 'No tasks yet' : `No ${browserFilter.replace('_', ' ')} tasks`}
                </div>
              ) : (
                <div className="beads-browser-list">
                  {getFilteredTasks().map((task) => (
                    <div
                      key={task.id}
                      className={`beads-browser-item ${getPriorityClass(task.priority)} status-${task.status}`}
                    >
                      <div className="beads-browser-item-header">
                        <div className="beads-browser-item-status">
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
                        </div>
                        <div className="beads-browser-item-title-row">
                          <span
                            className={`beads-browser-item-title ${task.status === 'closed' ? 'completed' : ''}`}
                            onClick={() => handleOpenDetail(task)}
                          >
                            {task.title}
                          </span>
                          <span className="beads-browser-item-id">{task.id}</span>
                        </div>
                        <div className="beads-browser-item-actions">
                          <button
                            className={`beads-browser-status-btn status-${task.status}`}
                            onClick={() => handleCycleStatus(task.id, task.status)}
                            title="Click to cycle status"
                          >
                            {task.status === 'in_progress' ? 'In Progress' : task.status === 'closed' ? 'Done' : 'Open'}
                          </button>
                          <button
                            className="beads-task-delete"
                            onClick={() => handleDeleteTask(task.id)}
                            title="Delete task"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <div className="beads-browser-item-meta">
                        <span className={`beads-browser-priority ${getPriorityClass(task.priority)}`}>
                          P{task.priority ?? 2} {getPriorityLabel(task.priority)}
                        </span>
                        {task.issue_type && (
                          <span className="beads-browser-type">{task.issue_type}</span>
                        )}
                        {task.created_at && (
                          <span className="beads-browser-date">
                            {new Date(task.created_at).toLocaleDateString()}
                          </span>
                        )}
                        {(task.dependency_count ?? 0) > 0 && (
                          <span className="beads-browser-blocked">
                            🚫 Blocked by {task.dependency_count}
                          </span>
                        )}
                        {(task.dependent_count ?? 0) > 0 && (
                          <span className="beads-browser-blocking">
                            ⛔ Blocking {task.dependent_count}
                          </span>
                        )}
                      </div>

                      {task.description && (
                        <div className="beads-browser-item-desc">
                          {task.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="beads-browser-footer">
              <span className="beads-browser-stats">
                {tasks.filter(t => t.status === 'open').length} open,
                {' '}{tasks.filter(t => t.status === 'in_progress').length} in progress,
                {' '}{tasks.filter(t => t.status === 'closed').length} closed
              </span>
              {tasks.some(t => t.status === 'closed') && (
                <button
                  className="beads-clear-btn"
                  onClick={handleClearCompleted}
                  title="Clear completed tasks"
                >
                  Clear Completed
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
