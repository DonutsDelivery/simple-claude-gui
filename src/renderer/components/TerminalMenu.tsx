import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'

interface TerminalMenuProps {
  ptyId: string
  onCommand: (command: string, options?: AutoWorkOptions) => void
  currentBackend: string
  onBackendChange: (backend: string) => void
}

export interface AutoWorkOptions {
  withContext: boolean
  askQuestions: boolean
  pauseForReview: boolean
  finalEvaluation: boolean
  gitCommitEachTask: boolean
}

interface MenuItem {
  id: string
  label: string
  isToggle?: boolean
  toggleKey?: keyof AutoWorkOptions
}

interface MenuCategory {
  id: string
  label: string
  items: MenuItem[]
}

const STORAGE_KEY = 'terminal-menu-expanded'
const AUTOWORK_OPTIONS_KEY = 'terminal-autowork-options'

const defaultAutoWorkOptions: AutoWorkOptions = {
  withContext: false,
  askQuestions: false,
  pauseForReview: false,
  finalEvaluation: false,
  gitCommitEachTask: false,
}

export function TerminalMenu({ ptyId, onCommand, currentBackend, onBackendChange }: TerminalMenuProps) {
  // Default to expanded, persist state across restarts
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  })
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const categoryRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto work options state
  const [autoWorkOptions, setAutoWorkOptions] = useState<AutoWorkOptions>(() => {
    const stored = localStorage.getItem(AUTOWORK_OPTIONS_KEY)
    if (stored) {
      try {
        return { ...defaultAutoWorkOptions, ...JSON.parse(stored) }
      } catch {
        return defaultAutoWorkOptions
      }
    }
    return defaultAutoWorkOptions
  })

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded))
  }, [isExpanded])

  // Persist autowork options
  useEffect(() => {
    localStorage.setItem(AUTOWORK_OPTIONS_KEY, JSON.stringify(autoWorkOptions))
  }, [autoWorkOptions])

  // Menu structure with toggles
  const menuCategories: MenuCategory[] = [
    {
      id: 'commands',
      label: 'Commands',
      items: [
        { id: 'help', label: '/help' },
        { id: 'clear', label: '/clear' },
        { id: 'compact', label: '/compact' },
        { id: 'cost', label: '/cost' },
        { id: 'status', label: '/status' },
        { id: 'model', label: '/model' },
        { id: 'config', label: '/config' },
        { id: 'doctor', label: '/doctor' },
        { id: 'divider-cmd', label: '─────────────' },
        { id: 'addcommand', label: '+ Add Custom Command' },
      ],
    },
    {
      id: 'automation',
      label: 'Automation',
      items: [
        { id: 'autowork', label: 'Start Auto Work' },
        { id: 'divider1', label: '─────────────' },
        { id: 'toggle-context', label: 'With Context', isToggle: true, toggleKey: 'withContext' },
        { id: 'toggle-questions', label: 'Ask Questions', isToggle: true, toggleKey: 'askQuestions' },
        { id: 'toggle-review', label: 'Pause for Review', isToggle: true, toggleKey: 'pauseForReview' },
        { id: 'toggle-evaluation', label: 'Final Evaluation', isToggle: true, toggleKey: 'finalEvaluation' },
        { id: 'toggle-git', label: 'Git Commit Each Task', isToggle: true, toggleKey: 'gitCommitEachTask' },
        { id: 'divider2', label: '─────────────' },
        { id: 'continuework', label: 'Continue to Next Task' },
        { id: 'stopwork', label: 'Stop After Task' },
      ],
    },
    {
      id: 'session',
      label: 'Session',
      items: [
        { id: 'summarize', label: 'Summarize Context' },
        { id: 'cancel', label: 'Cancel Request' },
      ],
    },
    {
      id: 'backend',
      label: 'Backend',
      items: [
        { id: 'claude', label: 'Claude' },
        { id: 'gemini', label: 'Gemini' },
      ],
    },
  ]

  // Close dropdown (not the bar) when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Also check if click is on the portal dropdown
        const dropdown = document.querySelector('.terminal-menu-dropdown-portal')
        if (dropdown && dropdown.contains(e.target as Node)) {
          return
        }
        setOpenDropdown(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Escape closes dropdown first, then collapses bar on second press
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openDropdown) {
          setOpenDropdown(null)
        } else if (isExpanded) {
          setIsExpanded(false)
        }
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [openDropdown, isExpanded])

  const handleMenuAction = (item: MenuItem, categoryId?: string) => {
    if (item.id.startsWith('divider')) {
      return // Do nothing for dividers
    }

    if (categoryId === 'backend') {
      onBackendChange(item.id)
      setOpenDropdown(null)
      return
    }

    if (item.isToggle && item.toggleKey) {
      // Toggle the option without closing dropdown
      setAutoWorkOptions(prev => ({
        ...prev,
        [item.toggleKey!]: !prev[item.toggleKey!]
      }))
      return
    }

    setOpenDropdown(null)  // Close dropdown but keep bar expanded

    if (item.id === 'autowork') {
      // Pass options when starting autowork
      onCommand('autowork', autoWorkOptions)
    } else {
      onCommand(item.id)
    }
  }

  const toggleDropdown = (categoryId: string) => {
    if (openDropdown === categoryId) {
      setOpenDropdown(null)
      setDropdownPos(null)
    } else {
      const btn = categoryRefs.current.get(categoryId)
      if (btn) {
        const rect = btn.getBoundingClientRect()
        setDropdownPos({
          top: rect.top,
          left: rect.left,
        })
      }
      setOpenDropdown(categoryId)
    }
  }

  // Render dropdown via portal to escape overflow:hidden
  const renderDropdown = () => {
    if (!openDropdown || !dropdownPos) return null

    const category = menuCategories.find(c => c.id === openDropdown)
    if (!category) return null

    const dropdownStyle: React.CSSProperties = {
      position: 'fixed',
      opacity: 0,
      pointerEvents: 'none'
    }

    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = dropdownPos.left
      if (left + rect.width > viewportWidth - 10) {
        left = viewportWidth - rect.width - 10
      }
      if (left < 10) {
        left = 10
      }

      let top = dropdownPos.top
      const btn = categoryRefs.current.get(openDropdown)
      if (btn) {
        top += btn.offsetHeight
      }

      if (top + rect.height > viewportHeight - 10) {
        top = dropdownPos.top - rect.height
      }
      if (top < 10) {
        top = 10
      }

      dropdownStyle.left = left
      dropdownStyle.top = top
      dropdownStyle.opacity = 1
      dropdownStyle.pointerEvents = 'auto'
    }

    return ReactDOM.createPortal(
      <div
        ref={dropdownRef}
        className="terminal-menu-dropdown-portal"
        style={dropdownStyle}
      >
        {category.items.map((item) => {
          if (item.id.startsWith('divider')) {
            return (
              <div key={item.id} className="terminal-menu-divider">
                {item.label}
              </div>
            )
          }

          const isToggle = item.isToggle && item.toggleKey
          const isChecked = isToggle ? autoWorkOptions[item.toggleKey!] : false

          return (
            <button
              key={item.id}
              className={`terminal-menu-item ${isToggle ? 'toggle-item' : ''} ${isChecked ? 'checked' : ''} ${category.id === 'backend' && item.id === currentBackend ? 'selected' : ''}`}
              onClick={() => handleMenuAction(item, category.id)}
            >
              {isToggle && (
                <span className="toggle-indicator">{isChecked ? '✓' : ' '}</span>
              )}
              {item.label}
            </button>
          )
        })}
      </div>,
      document.body
    )
  }

  return (
    <>
      <div ref={containerRef} className="terminal-menu-container">
        {/* Expanded menu bar */}
        {isExpanded && (
          <div className="terminal-menu-bar">
            {menuCategories.map((category) => (
              <div key={category.id} className="terminal-menu-category">
                <button
                  ref={(el) => {
                    if (el) categoryRefs.current.set(category.id, el)
                  }}
                  className={`terminal-menu-category-btn ${openDropdown === category.id ? 'active' : ''}`}
                  onClick={() => toggleDropdown(category.id)}
                >
                  {category.label}
                  <span className="dropdown-arrow">▼</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Arrow toggle button */}
        <button
          className={`terminal-menu-toggle ${isExpanded ? 'expanded' : ''}`}
          onClick={() => {
            setIsExpanded(!isExpanded)
            if (isExpanded) setOpenDropdown(null)
          }}
          title="Terminal menu"
        >
          <span className="arrow-icon">◀</span>
        </button>
      </div>
      {renderDropdown()}
    </>
  )
}

