import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'

interface TerminalMenuProps {
  ptyId: string
  onCommand: (command: string) => void
}

interface MenuItem {
  id: string
  label: string
}

interface MenuCategory {
  id: string
  label: string
  items: MenuItem[]
}

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
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { id: 'autowork', label: 'Auto Work Loop' },
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
]

const STORAGE_KEY = 'terminal-menu-expanded'

export function TerminalMenu({ ptyId, onCommand }: TerminalMenuProps) {
  // Default to expanded, persist state across restarts
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  })
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const categoryRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded))
  }, [isExpanded])

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

  const handleMenuAction = (action: string) => {
    setOpenDropdown(null)  // Close dropdown but keep bar expanded
    onCommand(action)
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

    return ReactDOM.createPortal(
      <div
        className="terminal-menu-dropdown-portal"
        style={{
          position: 'fixed',
          bottom: `calc(100vh - ${dropdownPos.top}px + 4px)`,
          left: dropdownPos.left,
        }}
      >
        {category.items.map((item) => (
          <button
            key={item.id}
            className="terminal-menu-item"
            onClick={() => handleMenuAction(item.id)}
          >
            {item.label}
          </button>
        ))}
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
