import React, { useState, useEffect, useCallback } from 'react'

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

export function BeadsPanel({ projectPath, isExpanded, onToggle }: BeadsPanelProps) {
  const [beadsInstalled, setBeadsInstalled] = useState(false)
  const [beadsInitialized, setBeadsInitialized] = useState(false)
  const [tasks, setTasks] = useState<BeadsTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [initializing, setInitializing] = useState(false)

  const loadTasks = useCallback(async (showLoading = true) => {
    if (!projectPath) return

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const status = await window.electronAPI.beadsCheck(projectPath)
      setBeadsInstalled(status.installed)
      setBeadsInitialized(status.initialized)

      if (status.installed && status.initialized) {
        const result = await window.electronAPI.beadsList(projectPath)
        if (result.success && result.tasks) {
          setTasks(result.tasks)
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

  useEffect(() => {
    if (projectPath && isExpanded) {
      loadTasks(true)
      // Auto-refresh every 10 seconds (silent, no loading state)
      const interval = setInterval(() => loadTasks(false), 10000)
      return () => clearInterval(interval)
    }
  }, [projectPath, isExpanded, loadTasks])

  const handleCreateTask = async () => {
    if (!projectPath || !newTaskTitle.trim()) return

    try {
      const result = await window.electronAPI.beadsCreate(projectPath, newTaskTitle.trim())
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
          {!projectPath && (
            <div className="beads-empty">Select a project to view tasks</div>
          )}

          {projectPath && !beadsInstalled && !loading && (
            <div className="beads-empty">
              Beads CLI (<code>bd</code>) not found.
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
              <div className="beads-tasks">
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
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Task title..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateTask()
                      if (e.key === 'Escape') setShowCreateForm(false)
                    }}
                  />
                  <div className="beads-create-actions">
                    <button onClick={handleCreateTask}>Add</button>
                    <button onClick={() => setShowCreateForm(false)}>Cancel</button>
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
                  <button className="beads-refresh-btn" onClick={loadTasks} title="Refresh">
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
