import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Theme } from '../themes'
import { useVoice } from '../contexts/VoiceContext'
import { TerminalMenu } from './TerminalMenu'

// Global buffer to persist terminal data across HMR remounts
// Use window to persist across module re-execution during HMR
const BUFFER_KEY = '__TERMINAL_BUFFERS__'
const MAX_BUFFER_CHUNKS = 5000 // Limit buffer size to prevent memory issues

// Get or create the global buffer map (survives HMR)
function getTerminalBuffers(): Map<string, string[]> {
  if (!(window as any)[BUFFER_KEY]) {
    (window as any)[BUFFER_KEY] = new Map<string, string[]>()
  }
  return (window as any)[BUFFER_KEY]
}

// Clear buffer for a specific terminal (call when tab is closed)
export function clearTerminalBuffer(ptyId: string) {
  getTerminalBuffers().delete(ptyId)
}

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

// Strip ANSI escape codes and terminal control sequences from text
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // CSI sequences
    .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences (title, etc)
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '') // Private sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // String sequences
    .replace(/[\x00-\x1f\x7f]/g, '')          // Control chars
}

// Detect if text is Claude's prose response (not tool output, code, or status)
function isClaudeProseResponse(text: string): boolean {
  const trimmed = text.trim()

  // Skip empty or very short text
  if (trimmed.length < 10) return false

  // Positive signal: ● or • bullet indicates Claude's prose response
  // But skip if it's a tool call like "● Bash(...)" or "● Read(...)"
  const hasBullet = /^[●•]/.test(trimmed)
  if (hasBullet) {
    // Skip tool calls: ● ToolName(...)
    if (/^[●•]\s*(Bash|Read|Write|Edit|Glob|Grep|Task|LSP|WebFetch|WebSearch|Update|NotebookEdit)\s*\(/.test(trimmed)) {
      return false
    }
    // It's prose
    return true
  }

  // WITHOUT a bullet, be very strict - most things are NOT prose

  // Skip anything with box-drawing or UI characters
  if (/[└├│┌┐┘┬┴┼╭╮╯╰⎿]/.test(text)) return false

  // Skip diff/edit output patterns
  if (/Added|removed|lines|line \d|\.tsx?\)|\.jsx?\)/.test(text)) return false

  // Skip Claude Code status bar patterns
  if (/Ideating|Thinking|Working|esc to interrupt|tokens|Reticulating/.test(text)) return false
  if (/Tip:|Model:|Session:|Cost:|Context|Cached:|Total:|Ctx:|In:|Out:/.test(text)) return false
  if (/v\d+\.\d+/.test(text)) return false

  // Skip spinner characters
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷·✶]/.test(text)) return false

  // Skip tool indicators
  if (/Read|Write|Edit|Bash|Glob|Grep|Task|LSP|WebFetch|WebSearch|Update|NotebookEdit/.test(text)) return false

  // Skip anything that looks like code
  if (/[{}()\[\];=`]/.test(text)) return false
  if (/^\s*(import|export|const|let|var|function|class|def |if |for |while |return |async |await |\$|>>>|#!|\/\/)/.test(text)) return false

  // Skip file paths and extensions
  if (/\.(ts|tsx|js|jsx|py|rs|go|css|html|json|md|yml|yaml)/.test(text)) return false

  // Skip line numbers
  if (/^\s*\d+\s*[+\-]?\s/.test(text)) return false

  // Must be mostly alphabetic words (natural language)
  const words = trimmed.split(/\s+/)
  const alphaWords = words.filter(w => /^[a-zA-Z]+$/.test(w))
  if (alphaWords.length < words.length * 0.5) return false

  return true
}

export function Terminal({ ptyId, isActive, theme, onFocus }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const userScrolledUpRef = useRef(false)

  // Voice TTS integration
  const { voiceOutputEnabled, speakText } = useVoice()
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const isActiveRef = useRef(isActive)
  const spokenContentRef = useRef<Set<string>>(new Set())  // Track what we've already spoken
  const silentModeRef = useRef(true)  // Start silent - only speak new content after startup
  const silentModeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ttsBufferRef = useRef('')  // Buffer for accumulating TTS tags across chunks

  // Summary capture for "Summarize & Clear" feature
  const summaryBufferRef = useRef('')
  const capturingSummaryRef = useRef(false)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)

  // Auto Work Loop feature
  const autoWorkModeRef = useRef(false)
  const [pendingAutoWorkContinue, setPendingAutoWorkContinue] = useState(false)

  // Keep refs in sync
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Handle pending summary - trigger /clear and paste
  useEffect(() => {
    if (pendingSummary) {
      const summaryToSend = pendingSummary  // Capture value before clearing state
      console.log('[Summary] useEffect triggered, running /clear, summary length:', summaryToSend.length)
      // Run /clear
      window.electronAPI.writePty(ptyId, '/clear')
      setTimeout(() => {
        console.log('[Summary] Sending enter for /clear')
        window.electronAPI.writePty(ptyId, '\r')
        // After /clear, paste summary
        setTimeout(() => {
          console.log('[Summary] Pasting summary:', summaryToSend.substring(0, 50) + '...')
          window.electronAPI.writePty(ptyId, summaryToSend)
          // Wait longer after pasting to let terminal render, then send enter
          setTimeout(() => {
            console.log('[Summary] Sending enter to submit')
            window.electronAPI.writePty(ptyId, '\r')
          }, 500)
        }, 1500)
      }, 100)
      setPendingSummary(null)
    }
  }, [pendingSummary, ptyId])

  // Handle auto work continuation - after /clear, send the continuation prompt
  useEffect(() => {
    if (pendingAutoWorkContinue) {
      console.log('[AutoWork] Continuation triggered, running /clear')
      // Run /clear first
      window.electronAPI.writePty(ptyId, '/clear')
      setTimeout(() => {
        window.electronAPI.writePty(ptyId, '\r')
        // After /clear completes, send the continuation prompt
        setTimeout(() => {
          console.log('[AutoWork] Sending continuation prompt')
          const continuePrompt = 'Run bd ready to check for tasks. If no tasks are available, say "All beads tasks complete!" and stop. Otherwise, pick ONE task to work on, complete it fully, close it with bd close <id>, then output the marker: three equals signs, AUTOWORK_CONTINUE, three equals signs.'
          window.electronAPI.writePty(ptyId, continuePrompt)
          setTimeout(() => {
            window.electronAPI.writePty(ptyId, '\r')
          }, 100)
        }, 1500)
      }, 100)
      setPendingAutoWorkContinue(false)
    }
  }, [pendingAutoWorkContinue, ptyId])

  useEffect(() => {
    if (!containerRef.current) return

    // Reset TTS state for this terminal session
    silentModeRef.current = true
    spokenContentRef.current.clear()
    ttsBufferRef.current = ''

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

    // Initialize buffer for this ptyId if not exists
    const terminalBuffers = getTerminalBuffers()
    if (!terminalBuffers.has(ptyId)) {
      terminalBuffers.set(ptyId, [])
    }

    // Replay buffered content on mount (for HMR recovery)
    const buffer = terminalBuffers.get(ptyId)!
    if (buffer.length > 0) {
      // Pre-populate spoken content set from buffered data to prevent re-speaking old content
      for (const chunk of buffer) {
        const cleanChunk = stripAnsi(chunk)
        const tagRegex = /«tts»([\s\S]*?)«\/tts»/g
        let match
        while ((match = tagRegex.exec(cleanChunk)) !== null) {
          const content = match[1].trim()
          if (content.length > 3) {
            spokenContentRef.current.add(content)
          }
        }
      }

      // Write all buffered data to restore terminal state
      for (const chunk of buffer) {
        terminal.write(chunk)
      }
      terminal.scrollToBottom()
    }

    // Silent mode stays on until user types - no timer needed
    // TTS only activates after user sends input to the terminal

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

    // Handle terminal input - also enables TTS after first user input
    terminal.onData((data) => {
      // User has typed something - now safe to enable TTS for responses
      if (silentModeRef.current) {
        silentModeRef.current = false
      }
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
      // Store data in buffer for HMR recovery
      const buf = getTerminalBuffers().get(ptyId)
      if (buf) {
        buf.push(data)
        // Limit buffer size to prevent memory bloat
        while (buf.length > MAX_BUFFER_CHUNKS) {
          buf.shift()
        }
      }

      // Always strip «tts» markers and summary markers from display
      let displayData = data.replace(/«\/?tts»/g, '').replace(/===SUMMARY_(START|END)===/g, '')

      // TTS: Buffer chunks and extract complete tags (tags may span multiple chunks)
      const cleanChunk = stripAnsi(data)

      ttsBufferRef.current += cleanChunk

      // Extract all complete «tts»...«/tts» markers from buffer
      const tagRegex = /«tts»([\s\S]*?)«\/tts»/g
      let match
      let lastIndex = 0

      while ((match = tagRegex.exec(ttsBufferRef.current)) !== null) {
        lastIndex = match.index + match[0].length
        const content = match[1].trim()

        // Skip if content looks like code (has brackets, semicolons, etc.)
        const looksLikeCode = /[{}()\[\];=`$]|^\s*\/\/|^\s*#|function\s|const\s|let\s|var\s/.test(content)
        // Skip if content is too short or has weird characters
        const looksLikeProse = content.length > 5 && /^[a-zA-Z]/.test(content) && !looksLikeCode

        if (looksLikeProse && !spokenContentRef.current.has(content)) {
          spokenContentRef.current.add(content)
          // Only speak if voice enabled, tab active, and not in silent mode (startup grace period)
          if (voiceOutputEnabledRef.current && isActiveRef.current && !silentModeRef.current) {
            speakText(content)
          }
          // During silent mode, content is tracked but not spoken - prevents reading old messages
        }
      }

      // Keep only the part after the last complete tag (may contain partial tag)
      if (lastIndex > 0) {
        ttsBufferRef.current = ttsBufferRef.current.substring(lastIndex)
      }

      // If buffer has no opening marker, clear it to prevent unbounded growth
      if (!ttsBufferRef.current.includes('«tts')) {
        ttsBufferRef.current = ''
      }

      // Limit buffer size to prevent memory issues (keep last 2000 chars if partial tag)
      if (ttsBufferRef.current.length > 2000) {
        ttsBufferRef.current = ttsBufferRef.current.substring(ttsBufferRef.current.length - 2000)
      }

      // Limit spoken set size to prevent memory bloat (keep last 1000 entries)
      if (spokenContentRef.current.size > 1000) {
        const entries = Array.from(spokenContentRef.current)
        spokenContentRef.current = new Set(entries.slice(-500))
      }

      // Summary capture for "Summarize & Clear" feature
      // Debug: log every data chunk to see if capture flag is set
      if (cleanChunk.includes('SUMMARY') || capturingSummaryRef.current) {
        console.log('[Summary] Data received, capturing:', capturingSummaryRef.current, 'chunk has SUMMARY:', cleanChunk.includes('SUMMARY'))
      }
      if (capturingSummaryRef.current) {
        summaryBufferRef.current += cleanChunk
        console.log('[Summary] Buffer length:', summaryBufferRef.current.length, 'chunk length:', cleanChunk.length)

        // Log buffer when it reaches certain sizes
        if (summaryBufferRef.current.length > 100 && summaryBufferRef.current.length < 200) {
          console.log('[Summary] Buffer @100:', summaryBufferRef.current)
        }

        // Check if markers are present anywhere in buffer (using === markers, not XML)
        const hasStart = summaryBufferRef.current.includes('===SUMMARY_START===')
        const hasEnd = summaryBufferRef.current.includes('===SUMMARY_END===')
        if (hasStart && hasEnd) {
          const startIdx = summaryBufferRef.current.indexOf('===SUMMARY_START===')
          const endIdx = summaryBufferRef.current.indexOf('===SUMMARY_END===')
          console.log('[Summary] Both markers found! start@', startIdx, 'end@', endIdx, 'distance:', endIdx - startIdx)
        } else if (hasStart || hasEnd) {
          console.log('[Summary] Partial markers - start:', hasStart, 'end:', hasEnd)
        }

        // Check for complete summary markers - use GREEDY match to get from first START to LAST END
        // This avoids issues if the summary content itself mentions the markers
        const summaryMatch = summaryBufferRef.current.match(/===SUMMARY_START===([\s\S]*)===SUMMARY_END===/)
        if (summaryMatch) {
          // Remove any nested markers from the content
          let summary = summaryMatch[1].trim()
          console.log('[Summary] RAW match length:', summary.length, 'first 100:', summary.substring(0, 100))
          summary = summary.replace(/===SUMMARY_(START|END)===/g, '')
          console.log('[Summary] After strip length:', summary.length)
          console.log('[Summary] Content:', summary.substring(0, 200))

          // Minimum length check - a real summary should be substantial (>100 chars)
          // If too short, Claude might be explaining the format rather than giving the actual summary
          if (summary.length < 100) {
            console.log('[Summary] Match too short (' + summary.length + ' chars), continuing capture...')
            // Continue capturing - don't stop yet
          } else {
            // Stop capturing once we have a substantial match
            capturingSummaryRef.current = false
            summaryBufferRef.current = ''
            setPendingSummary(summary)
          }
        }

        // Limit buffer size to prevent unbounded growth (200KB should be plenty)
        if (summaryBufferRef.current.length > 200000) {
          console.log('[Summary] Buffer limit reached, stopping capture')
          capturingSummaryRef.current = false
          summaryBufferRef.current = ''
        }
      }

      // Auto Work Loop - detect continuation marker
      if (autoWorkModeRef.current && cleanChunk.includes('===AUTOWORK_CONTINUE===')) {
        console.log('[AutoWork] Continuation marker detected!')
        // Trigger the continuation (will run /clear then send prompt)
        setPendingAutoWorkContinue(true)
      }

      // Strip autowork marker from display
      displayData = displayData.replace(/===AUTOWORK_CONTINUE===/g, '')

      terminal.write(displayData)

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
      // Store exit message in buffer too (in case of HMR during exit)
      const buf = getTerminalBuffers().get(ptyId)
      if (buf) {
        buf.push(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
      }
    })

    // Handle resize - stay at bottom unless user scrolled up
    const handleResize = () => {
      if (!fitAddonRef.current || !containerRef.current || !terminalRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      // Only fit if container is visible and has reasonable dimensions
      if (rect.width > 50 && rect.height > 50) {
        // Check if at bottom BEFORE fit (fit can change scroll position)
        const wasAtBottom = !userScrolledUpRef.current

        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
        }

        // Restore scroll position - use requestAnimationFrame to ensure it happens after xterm's internal updates
        if (wasAtBottom) {
          requestAnimationFrame(() => {
            terminalRef.current?.scrollToBottom()
          })
        }
      }
    }

    // Debounce resize to prevent rapid consecutive fits that cause jumping
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const debouncedResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 50)
    }

    const resizeObserver = new ResizeObserver(debouncedResize)
    resizeObserver.observe(containerRef.current)

    // Initial resize - multiple attempts to ensure correct sizing
    requestAnimationFrame(handleResize)
    setTimeout(handleResize, 100)
    setTimeout(handleResize, 300)
    setTimeout(handleResize, 500)

    return () => {
      cleanupData()
      cleanupExit()
      if (resizeTimeout) clearTimeout(resizeTimeout)
      if (silentModeTimeoutRef.current) clearTimeout(silentModeTimeoutRef.current)
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
          const wasAtBottom = !userScrolledUpRef.current

          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && dims.cols > 0 && dims.rows > 0) {
            window.electronAPI.resizePty(ptyId, dims.cols, dims.rows)
          }
          // Restore scroll position after xterm updates
          if (wasAtBottom) {
            requestAnimationFrame(() => {
              terminalRef.current?.scrollToBottom()
            })
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

  const handleMenuCommand = (command: string) => {
    switch (command) {
      case 'summarize':
        // Start capture immediately - prompt doesn't have literal markers so won't match
        summaryBufferRef.current = ''
        capturingSummaryRef.current = true
        console.log('[Summary] Capture enabled for ptyId:', ptyId)
        // Prompt describes markers without using them literally
        const summarizePrompt = 'Summarize this session for context recovery. Wrap output in markers: three equals, SUMMARY_START, three equals at start. Three equals, SUMMARY_END, three equals at end.'
        window.electronAPI.writePty(ptyId, summarizePrompt)
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'clear':
        // Run /clear command
        window.electronAPI.writePty(ptyId, '/clear')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'help':
        window.electronAPI.writePty(ptyId, '/help')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'compact':
        window.electronAPI.writePty(ptyId, '/compact')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'cost':
        window.electronAPI.writePty(ptyId, '/cost')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'status':
        window.electronAPI.writePty(ptyId, '/status')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'model':
        window.electronAPI.writePty(ptyId, '/model')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'config':
        window.electronAPI.writePty(ptyId, '/config')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'doctor':
        window.electronAPI.writePty(ptyId, '/doctor')
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'autowork':
        // Enable auto work mode and send initial prompt
        autoWorkModeRef.current = true
        console.log('[AutoWork] Mode enabled for ptyId:', ptyId)
        // Initial prompt - describes marker without using it literally
        const autoworkPrompt = 'Run bd ready to check for tasks. If no tasks are available, say "All beads tasks complete!" and stop. Otherwise, pick ONE task to work on, complete it fully, close it with bd close <id>, then output the marker: three equals signs, AUTOWORK_CONTINUE, three equals signs.'
        window.electronAPI.writePty(ptyId, autoworkPrompt)
        setTimeout(() => {
          window.electronAPI.writePty(ptyId, '\r')
        }, 100)
        break
      case 'cancel':
        // Send Escape to cancel current operation and disable auto work mode
        autoWorkModeRef.current = false
        console.log('[AutoWork] Mode disabled by cancel')
        window.electronAPI.writePty(ptyId, '\x1b')
        break
    }
  }

  return (
    <div className="terminal-content-wrapper">
      <div
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
        onMouseDown={onFocus}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
      <TerminalMenu ptyId={ptyId} onCommand={handleMenuCommand} />
    </div>
  )
}
