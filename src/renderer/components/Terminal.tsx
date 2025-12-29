import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Theme } from '../themes'

// Debug flag - set to true to log scroll events
const DEBUG_SCROLL = false

// Custom paste handler for xterm - supports text, file paths, and images
async function handlePaste(term: XTerm, ptyId: string) {
  try {
    // First check if clipboard has an image or file (using Electron's native clipboard)
    const imageResult = await window.electronAPI.readClipboardImage()
    if (imageResult.success && imageResult.hasImage && imageResult.path) {
      window.electronAPI.writePty(ptyId, imageResult.path)
      return
    }

    // No image, try to read text
    const text = await navigator.clipboard.readText()
    if (text) {
      // Clean up file:// URIs to plain paths (common on Linux when copying files)
      let cleanText = text
      if (text.startsWith('file://')) {
        cleanText = text.split('\n')
          .map(line => line.trim())
          .filter(line => line.startsWith('file://'))
          .map(line => decodeURIComponent(line.replace('file://', '')))
          .join(' ')
      }
      window.electronAPI.writePty(ptyId, cleanText || text)
    }
  } catch (e) {
    console.error('Paste failed:', e)
  }
}

// Custom copy handler for xterm
function handleCopy(term: XTerm) {
  const selection = term.getSelection()
  if (selection) {
    navigator.clipboard.writeText(selection).catch(e => {
      console.error('Failed to copy:', e)
    })
  }
}

interface TerminalProps {
  ptyId: string
  isActive: boolean
  theme: Theme
  onFocus?: () => void
}

export function Terminal({ ptyId, isActive, theme, onFocus }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const userScrolledUpRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return

    const t = theme.terminal
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      scrollback: 10000,
      allowProposedApi: true,
      cols: 120,
      rows: 30,
      theme: {
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursor,
        cursorAccent: t.cursorAccent,
        selectionBackground: t.selection,
        black: t.black,
        red: t.red,
        green: t.green,
        yellow: t.yellow,
        blue: t.blue,
        magenta: t.magenta,
        cyan: t.cyan,
        white: t.white,
        brightBlack: t.brightBlack,
        brightRed: t.brightRed,
        brightGreen: t.brightGreen,
        brightYellow: t.brightYellow,
        brightBlue: t.brightBlue,
        brightMagenta: t.brightMagenta,
        brightCyan: t.brightCyan,
        brightWhite: t.brightWhite
      }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Helper to check if terminal is at bottom
    const isAtBottom = () => {
      const buffer = terminal.buffer.active
      return buffer.viewportY >= buffer.baseY
    }

    // Track user scroll via wheel - set flag when scrolling up, clear when at bottom
    containerRef.current.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) {
        // Scrolling up
        userScrolledUpRef.current = true
      } else if (e.deltaY > 0 && isAtBottom()) {
        // Scrolling down and reached bottom
        userScrolledUpRef.current = false
      }
    }, { passive: true })

    // Also track scroll events to detect when user scrolls back to bottom
    terminal.onScroll(() => {
      if (isAtBottom()) {
        userScrolledUpRef.current = false
      }
    })

    // Defer fit to next frame when container has dimensions
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // Handle terminal input
    terminal.onData((data) => {
      window.electronAPI.writePty(ptyId, data)
    })

    // Handle copy/paste keyboard shortcuts and prevent arrow key scrolling
    terminal.attachCustomKeyEventHandler((event) => {
      // Only handle keydown events to prevent double-firing
      if (event.type !== 'keydown') return true

      // Ctrl+Shift+C for copy (always)
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        handleCopy(terminal)
        return false
      }

      // Ctrl+C (without shift): copy if there's a selection, otherwise send SIGINT
      if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        const selection = terminal.getSelection()
        if (selection && selection.length > 0) {
          handleCopy(terminal)
          return false
        }
        // No selection - let it pass through as SIGINT
        return true
      }

      // Ctrl+Shift+V or Ctrl+V for paste
      if (event.ctrlKey && (event.key === 'V' || event.key === 'v')) {
        event.preventDefault()  // Prevent browser's native paste (which would cause duplicate)
        handlePaste(terminal, ptyId)
        return false
      }

      // Prevent arrow keys from scrolling the viewport
      // They still get sent to the PTY via onData for Claude's interactive prompts
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // Send the escape sequence manually to ensure it reaches PTY
        const seq = event.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B'
        window.electronAPI.writePty(ptyId, seq)
        return false  // Prevent xterm from also handling it (which causes scrolling)
      }

      return true
    })

    // Right-click: copy if selection, else paste (scroll is preserved in handlePaste)
    containerRef.current.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = terminal.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      } else {
        // No selection - paste (handlePaste preserves scroll)
        handlePaste(terminal, ptyId)
      }
    })

    // Middle-click paste (Linux style) - handlePaste preserves scroll
    containerRef.current.addEventListener('auxclick', (e) => {
      if (e.button === 1) {  // Middle button
        e.preventDefault()
        handlePaste(terminal, ptyId)
      }
    })

    // Prevent scroll jump on click - stay at bottom unless user scrolled up
    containerRef.current.addEventListener('mousedown', () => {
      // Restore scroll position after a brief delay (after xterm processes the click)
      requestAnimationFrame(() => {
        if (!userScrolledUpRef.current) {
          terminal.scrollToBottom()
        }
      })
    })


    // Handle PTY output - always scroll to bottom unless user explicitly scrolled up
    let firstData = true
    const cleanupData = window.electronAPI.onPtyData(ptyId, (data) => {
      terminal.write(data)

      // Always scroll to bottom unless user has scrolled up
      if (!userScrolledUpRef.current) {
        terminal.scrollToBottom()
      }

      // Resize on first data to ensure PTY has correct dimensions
      if (firstData) {
        firstData = false
        handleResize()
      }
    })

    // Handle PTY exit
    const cleanupExit = window.electronAPI.onPtyExit(ptyId, (code) => {
      terminal.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
    })

    // Handle resize - stay at bottom unless user scrolled up
    const handleResize = () => {
      if (!fitAddonRef.current || !containerRef.current || !terminalRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      // Only fit if container is visible and has reasonable dimensions
      if (rect.width > 50 && rect.height > 50) {
        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }

        // Stay at bottom unless user scrolled up
        if (!userScrolledUpRef.current) {
          terminalRef.current.scrollToBottom()
        }
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    // Initial resize - multiple attempts to ensure correct sizing
    requestAnimationFrame(handleResize)
    setTimeout(handleResize, 100)
    setTimeout(handleResize, 300)
    setTimeout(handleResize, 500)

    return () => {
      cleanupData()
      cleanupExit()
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [ptyId])

  // Refit when tab becomes active - stay at bottom unless user scrolled up
  useEffect(() => {
    if (isActive && fitAddonRef.current && containerRef.current && terminalRef.current) {
      const doFit = () => {
        if (!fitAddonRef.current || !containerRef.current || !terminalRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 50 && rect.height > 50) {
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
          }
          // Stay at bottom unless user scrolled up
          if (!userScrolledUpRef.current) {
            terminalRef.current.scrollToBottom()
          }
        }
        terminalRef.current?.focus()
      }

      requestAnimationFrame(doFit)
      setTimeout(doFit, 50)
      setTimeout(doFit, 150)
    }
  }, [isActive, ptyId])

  // Update terminal theme when theme changes
  useEffect(() => {
    if (terminalRef.current) {
      const t = theme.terminal
      terminalRef.current.options.theme = {
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursor,
        cursorAccent: t.cursorAccent,
        selectionBackground: t.selection,
        black: t.black,
        red: t.red,
        green: t.green,
        yellow: t.yellow,
        blue: t.blue,
        magenta: t.magenta,
        cyan: t.cyan,
        white: t.white,
        brightBlack: t.brightBlack,
        brightRed: t.brightRed,
        brightGreen: t.brightGreen,
        brightYellow: t.brightYellow,
        brightBlue: t.brightBlue,
        brightMagenta: t.brightMagenta,
        brightCyan: t.brightCyan,
        brightWhite: t.brightWhite
      }
    }
  }, [theme])

  // Handle file drop from file manager only (ignore browser URLs - they crash xterm on KDE)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const paths: string[] = []

    // Try Files array first (KDE Dolphin uses this)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        try {
          const filePath = window.electronAPI.getPathForFile(files[i])
          if (filePath) {
            paths.push(filePath)
          }
        } catch {
          // getPathForFile not available
        }
      }
    }

    // Fallback: text/uri-list (some file managers use this)
    if (paths.length === 0) {
      const uriList = e.dataTransfer?.getData('text/uri-list')
      if (uriList) {
        uriList.split('\n')
          .map(uri => uri.trim())
          .filter(uri => uri.startsWith('file://'))
          .forEach(uri => {
            paths.push(decodeURIComponent(uri.replace('file://', '')))
          })
      }
    }

    if (paths.length > 0) {
      window.electronAPI.writePty(ptyId, paths.join(' '))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', width: '100%' }}
      onMouseDown={onFocus}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    />
  )
}
