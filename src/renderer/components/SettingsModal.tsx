import React, { useState, useEffect } from 'react'
import { themes, getThemeById, applyTheme, Theme } from '../themes'
import { VoiceBrowserModal } from './VoiceBrowserModal'

// Whisper models available
const WHISPER_MODELS = [
  { value: 'tiny.en', label: 'Tiny (75MB)', desc: 'Fastest, basic accuracy' },
  { value: 'base.en', label: 'Base (147MB)', desc: 'Good balance' },
  { value: 'small.en', label: 'Small (488MB)', desc: 'Better accuracy' },
  { value: 'medium.en', label: 'Medium (1.5GB)', desc: 'High accuracy' },
  { value: 'large-v3', label: 'Large (3GB)', desc: 'Best accuracy, multilingual' },
]

// Piper voices available
const PIPER_VOICES = [
  { value: 'en_US-libritts_r-medium', label: 'LibriTTS-R (US)', desc: 'Natural US English' },
  { value: 'en_GB-jenny_dioco-medium', label: 'Jenny (UK)', desc: 'British English' },
  { value: 'en_US-ryan-medium', label: 'Ryan (US)', desc: 'US English male' },
]

// Common tool patterns for quick selection
const COMMON_TOOLS = [
  { label: 'Read files', value: 'Read' },
  { label: 'Write files', value: 'Write' },
  { label: 'Edit files', value: 'Edit' },
  { label: 'MultiEdit', value: 'MultiEdit' },
  { label: 'Grep search', value: 'Grep' },
  { label: 'Glob search', value: 'Glob' },
  { label: 'List dirs', value: 'LS' },
  { label: 'Web fetch', value: 'WebFetch' },
  { label: 'Web search', value: 'WebSearch' },
  { label: 'Questions', value: 'AskUserQuestion' },
  { label: 'Task agents', value: 'Task' },
  { label: 'Todo list', value: 'TodoWrite' },
  { label: 'Git commands', value: 'Bash(git:*)' },
  { label: 'npm commands', value: 'Bash(npm:*)' },
  { label: 'All Bash', value: 'Bash' },
]

// Permission modes available in Claude Code
const PERMISSION_MODES = [
  { label: 'Default', value: 'default', desc: 'Ask for all permissions' },
  { label: 'Accept Edits', value: 'acceptEdits', desc: 'Auto-accept file edits' },
  { label: "Don't Ask", value: 'dontAsk', desc: 'Skip permission prompts' },
  { label: 'Bypass All', value: 'bypassPermissions', desc: 'Skip all permission checks' },
]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onThemeChange: (theme: Theme) => void
}

export function SettingsModal({ isOpen, onClose, onThemeChange }: SettingsModalProps) {
  const [defaultProjectDir, setDefaultProjectDir] = useState('')
  const [selectedTheme, setSelectedTheme] = useState('default')
  const [autoAcceptTools, setAutoAcceptTools] = useState<string[]>([])
  const [permissionMode, setPermissionMode] = useState('default')
  const [customTool, setCustomTool] = useState('')

  // Voice settings
  const [whisperStatus, setWhisperStatus] = useState<{ installed: boolean; models: string[]; currentModel: string | null }>({ installed: false, models: [], currentModel: null })
  const [ttsStatus, setTtsStatus] = useState<{ installed: boolean; voices: string[]; currentVoice: string | null }>({ installed: false, voices: [], currentVoice: null })
  const [selectedWhisperModel, setSelectedWhisperModel] = useState('base.en')
  const [selectedVoice, setSelectedVoice] = useState('en_US-libritts_r-medium')
  const [installingModel, setInstallingModel] = useState<string | null>(null)
  const [installingVoice, setInstallingVoice] = useState<string | null>(null)
  const [showVoiceBrowser, setShowVoiceBrowser] = useState(false)
  const [installedVoices, setInstalledVoices] = useState<Array<{ key: string; displayName: string; source: string }>>([])

  // Load installed voices
  const refreshInstalledVoices = async () => {
    const voices = await window.electronAPI.voiceGetInstalled?.()
    if (voices) setInstalledVoices(voices)
  }

  useEffect(() => {
    if (isOpen) {
      window.electronAPI.getSettings().then((settings) => {
        setDefaultProjectDir(settings.defaultProjectDir || '')
        setSelectedTheme(settings.theme || 'default')
        setAutoAcceptTools(settings.autoAcceptTools || [])
        setPermissionMode(settings.permissionMode || 'default')
      })

      // Load voice status
      window.electronAPI.voiceCheckWhisper?.().then(setWhisperStatus).catch(() => {})
      window.electronAPI.voiceCheckTTS?.().then(setTtsStatus).catch(() => {})
      refreshInstalledVoices()
    }
  }, [isOpen])

  const handleSelectDirectory = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) {
      setDefaultProjectDir(dir)
    }
  }

  const handleThemeSelect = (themeId: string) => {
    setSelectedTheme(themeId)
    const theme = getThemeById(themeId)
    applyTheme(theme)
    onThemeChange(theme)
  }

  const handleSave = async () => {
    await window.electronAPI.saveSettings({ defaultProjectDir, theme: selectedTheme, autoAcceptTools, permissionMode })
    onClose()
  }

  const toggleTool = (tool: string) => {
    if (autoAcceptTools.includes(tool)) {
      setAutoAcceptTools(autoAcceptTools.filter(t => t !== tool))
    } else {
      setAutoAcceptTools([...autoAcceptTools, tool])
    }
  }

  const addCustomTool = () => {
    const trimmed = customTool.trim()
    if (trimmed && !autoAcceptTools.includes(trimmed)) {
      setAutoAcceptTools([...autoAcceptTools, trimmed])
      setCustomTool('')
    }
  }

  const removeCustomTool = (tool: string) => {
    setAutoAcceptTools(autoAcceptTools.filter(t => t !== tool))
  }

  const handleInstallWhisperModel = async (model: string) => {
    setInstallingModel(model)
    try {
      await window.electronAPI.voiceInstallWhisper?.(model)
      const status = await window.electronAPI.voiceCheckWhisper?.()
      if (status) setWhisperStatus(status)
    } catch (e) {
      console.error('Failed to install Whisper model:', e)
    }
    setInstallingModel(null)
  }

  const handleInstallVoice = async (voice: string) => {
    setInstallingVoice(voice)
    try {
      // Install Piper if not installed
      if (!ttsStatus.installed) {
        await window.electronAPI.voiceInstallPiper?.()
      }
      await window.electronAPI.voiceInstallVoice?.(voice)
      const status = await window.electronAPI.voiceCheckTTS?.()
      if (status) setTtsStatus(status)
    } catch (e) {
      console.error('Failed to install voice:', e)
    }
    setInstallingVoice(null)
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label>Theme</label>
            <div className="theme-grid">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  className={`theme-swatch ${selectedTheme === theme.id ? 'selected' : ''}`}
                  onClick={() => handleThemeSelect(theme.id)}
                  title={theme.name}
                >
                  <div
                    className="theme-preview"
                    style={{
                      background: theme.colors.bgBase,
                      borderColor: theme.colors.accent,
                    }}
                  >
                    <div
                      className="theme-accent"
                      style={{ background: theme.colors.accent }}
                    />
                    <div
                      className="theme-text"
                      style={{ background: theme.colors.textPrimary }}
                    />
                    <div
                      className="theme-text-sm"
                      style={{ background: theme.colors.textSecondary }}
                    />
                  </div>
                  <span className="theme-name">{theme.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Default Project Directory</label>
            <div className="input-with-button">
              <input
                type="text"
                value={defaultProjectDir}
                onChange={(e) => setDefaultProjectDir(e.target.value)}
                placeholder="Select a directory..."
                readOnly
              />
              <button className="browse-btn" onClick={handleSelectDirectory}>
                Browse
              </button>
            </div>
            <p className="form-hint">
              New projects created with "Make Project" will be placed here.
            </p>
          </div>

          <div className="form-group">
            <label>Global Permissions</label>
            <p className="form-hint">
              Default permissions for all projects. Can be overridden per-project.
            </p>
            <div className="tool-chips">
              {COMMON_TOOLS.map((tool) => (
                <button
                  key={tool.value}
                  className={`tool-chip ${autoAcceptTools.includes(tool.value) ? 'selected' : ''}`}
                  onClick={() => toggleTool(tool.value)}
                  title={tool.value}
                >
                  {tool.label}
                </button>
              ))}
            </div>
            <div className="custom-tool-input">
              <input
                type="text"
                value={customTool}
                onChange={(e) => setCustomTool(e.target.value)}
                placeholder="Custom pattern (e.g., Bash(python:*))"
                onKeyDown={(e) => e.key === 'Enter' && addCustomTool()}
              />
              <button className="browse-btn" onClick={addCustomTool}>
                Add
              </button>
            </div>
            {autoAcceptTools.filter(t => !COMMON_TOOLS.some(ct => ct.value === t)).length > 0 && (
              <div className="custom-tools-list">
                {autoAcceptTools.filter(t => !COMMON_TOOLS.some(ct => ct.value === t)).map((tool) => (
                  <span key={tool} className="custom-tool-tag">
                    {tool}
                    <button onClick={() => removeCustomTool(tool)}>x</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Permission Mode</label>
            <p className="form-hint">
              Global permission behavior for Claude Code sessions.
            </p>
            <div className="permission-mode-options">
              {PERMISSION_MODES.map((mode) => (
                <label key={mode.value} className={`permission-mode-option ${permissionMode === mode.value ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="permissionMode"
                    value={mode.value}
                    checked={permissionMode === mode.value}
                    onChange={(e) => setPermissionMode(e.target.value)}
                  />
                  <span className="mode-label">{mode.label}</span>
                  <span className="mode-desc">{mode.desc}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Voice Input (Speech-to-Text)</label>
            <p className="form-hint">
              Whisper models for transcribing your voice. Larger = more accurate but slower.
            </p>
            <div className="voice-options">
              {WHISPER_MODELS.map((model) => {
                const isInstalled = whisperStatus.models.includes(model.value)
                const isInstalling = installingModel === model.value
                return (
                  <div key={model.value} className={`voice-option ${isInstalled ? 'installed' : ''}`}>
                    <div className="voice-info">
                      <span className="voice-label">{model.label}</span>
                      <span className="voice-desc">{model.desc}</span>
                    </div>
                    {isInstalled ? (
                      <span className="voice-status installed">Installed</span>
                    ) : (
                      <button
                        className="voice-install-btn"
                        onClick={() => handleInstallWhisperModel(model.value)}
                        disabled={isInstalling}
                      >
                        {isInstalling ? 'Installing...' : 'Install'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="form-group">
            <label>Voice Output (Text-to-Speech)</label>
            <p className="form-hint">
              Piper voices for Claude to speak responses aloud. Browse 100+ voices in 35+ languages.
            </p>
            <div className="voice-options">
              {installedVoices.length > 0 ? (
                installedVoices.map((voice) => (
                  <div key={voice.key} className="voice-option installed">
                    <div className="voice-info">
                      <span className="voice-label">{voice.displayName}</span>
                      <span className="voice-desc">
                        {voice.source === 'builtin' ? 'Built-in' : voice.source === 'custom' ? 'Custom' : 'Downloaded'}
                      </span>
                    </div>
                    <span className="voice-status installed">Installed</span>
                  </div>
                ))
              ) : (
                <div className="voice-option">
                  <div className="voice-info">
                    <span className="voice-label">No voices installed</span>
                    <span className="voice-desc">Browse and download voices to get started</span>
                  </div>
                </div>
              )}
            </div>
            <button
              className="btn-secondary"
              onClick={() => setShowVoiceBrowser(true)}
              style={{ marginTop: '8px' }}
            >
              Browse Voices...
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      <VoiceBrowserModal
        isOpen={showVoiceBrowser}
        onClose={() => {
          setShowVoiceBrowser(false)
          refreshInstalledVoices()
        }}
        onVoiceSelect={(voiceKey, engine) => {
          setSelectedVoice(engine === 'xtts' ? `xtts:${voiceKey}` : voiceKey)
          window.electronAPI.voiceSetVoice?.({ voice: voiceKey, engine })
        }}
      />
    </div>
  )
}
