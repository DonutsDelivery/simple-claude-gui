import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Custom paste handler for xterm
async function handlePaste(term: XTerm, ptyId: string) {
  try {
    const text = await navigator.clipboard.readText()
    window.electronAPI.writePty(ptyId, text)
  } catch (e) {
    console.error('Failed to paste:', e)
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
}

export function Terminal({ ptyId, isActive }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f14c4c',
        green: '#23d18b',
        yellow: '#f5f543',
        blue: '#3b8eea',
        magenta: '#d670d6',
        cyan: '#29b8db',
        white: '#d4d4d4',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
      }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle terminal input
    terminal.onData((data) => {
      window.electronAPI.writePty(ptyId, data)
    })

    // Handle copy/paste keyboard shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C for copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        handleCopy(terminal)
        return false
      }
      // Ctrl+Shift+V for paste
      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        handlePaste(terminal, ptyId)
        return false
      }
      // Ctrl+C without shift should pass through to terminal
      return true
    })

    // Right-click context menu copy
    containerRef.current.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = terminal.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      }
    })

    // Handle PTY output
    let firstData = true
    const cleanupData = window.electronAPI.onPtyData(ptyId, (data) => {
      terminal.write(data)
      // Auto-scroll to bottom on new data
      terminal.scrollToBottom()
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

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    // Initial resize - multiple attempts to ensure correct sizing
    setTimeout(handleResize, 0)
    setTimeout(handleResize, 100)
    setTimeout(handleResize, 500)

    return () => {
      cleanupData()
      cleanupExit()
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [ptyId])

  // Refit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
        const dims = fitAddonRef.current?.proposeDimensions()
        if (dims) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }
        terminalRef.current?.focus()
      }, 50)
    }
  }, [isActive, ptyId])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
