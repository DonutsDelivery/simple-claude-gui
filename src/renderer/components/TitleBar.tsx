import React, { useState, useEffect } from 'react'

interface TitleBarProps {
  title?: string
}

export function TitleBar({ title = 'Simple Claude GUI' }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Check initial state
    window.electronAPI.windowIsMaximized().then(setIsMaximized)

    // Listen for window state changes
    const handleResize = () => {
      window.electronAPI.windowIsMaximized().then(setIsMaximized)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleMinimize = () => {
    window.electronAPI.windowMinimize()
  }

  const handleMaximize = () => {
    window.electronAPI.windowMaximize()
    // Update state after a short delay to allow window to change
    setTimeout(() => {
      window.electronAPI.windowIsMaximized().then(setIsMaximized)
    }, 100)
  }

  const handleClose = () => {
    window.electronAPI.windowClose()
  }

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-title">{title}</span>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-btn minimize"
          onClick={handleMinimize}
          title="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="title-bar-btn maximize"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1" y="3" width="7" height="7" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="title-bar-btn close"
          onClick={handleClose}
          title="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
