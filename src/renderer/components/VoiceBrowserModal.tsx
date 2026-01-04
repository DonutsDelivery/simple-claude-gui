import React, { useState, useEffect, useMemo } from 'react'

interface VoiceCatalogEntry {
  key: string
  name: string
  language: {
    code: string
    name_english: string
    country_english: string
  }
  quality: string
  num_speakers: number
  files: Record<string, { size_bytes: number }>
}

interface InstalledVoice {
  key: string
  displayName: string
  source: 'builtin' | 'downloaded' | 'custom'
  quality?: string
  language?: string
}

interface XTTSVoice {
  id: string
  name: string
  language: string
  createdAt: number
}

interface XTTSSampleVoice {
  id: string
  name: string
  language: string
  file: string
  installed: boolean
}

interface XTTSLanguage {
  code: string
  name: string
}

interface VoiceBrowserModalProps {
  isOpen: boolean
  onClose: () => void
  onVoiceSelect?: (voiceKey: string, engine: 'piper' | 'xtts') => void
}

// Build sample audio URL from voice key
// Pattern: https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{lang_region}/{name}/{quality}/samples/speaker_0.mp3
function getSampleUrl(voiceKey: string): string | null {
  // Parse key like "en_US-lessac-medium" or "de_DE-thorsten-medium"
  const match = voiceKey.match(/^([a-z]{2})_([A-Z]{2})-(.+)-([a-z_]+)$/)
  if (!match) return null
  const [, lang, region, name, quality] = match
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${lang}_${region}/${name}/${quality}/samples/speaker_0.mp3`
}

export function VoiceBrowserModal({ isOpen, onClose, onVoiceSelect }: VoiceBrowserModalProps) {
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([])
  const [installed, setInstalled] = useState<InstalledVoice[]>([])
  const [xttsVoices, setXttsVoices] = useState<XTTSVoice[]>([])
  const [xttsSampleVoices, setXttsSampleVoices] = useState<XTTSSampleVoice[]>([])
  const [xttsLanguages, setXttsLanguages] = useState<XTTSLanguage[]>([])
  const [xttsStatus, setXttsStatus] = useState<{ installed: boolean; error?: string }>({ installed: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [modelFilter, setModelFilter] = useState<'all' | 'piper' | 'xtts'>('all')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [playingPreview, setPlayingPreview] = useState<string | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)

  // XTTS voice creation state
  const [showCreateXtts, setShowCreateXtts] = useState(false)
  const [createXttsName, setCreateXttsName] = useState('')
  const [createXttsLanguage, setCreateXttsLanguage] = useState('en')
  const [createXttsAudioPath, setCreateXttsAudioPath] = useState('')
  const [creatingXtts, setCreatingXtts] = useState(false)
  const [installingXtts, setInstallingXtts] = useState(false)

  // Load catalog and installed voices
  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [catalogData, installedData, xttsVoicesData, xttsSamplesData, xttsLangs, xttsCheck] = await Promise.all([
        window.electronAPI.voiceFetchCatalog(),
        window.electronAPI.voiceGetInstalled(),
        window.electronAPI.xttsGetVoices(),
        window.electronAPI.xttsGetSampleVoices(),
        window.electronAPI.xttsGetLanguages(),
        window.electronAPI.xttsCheck()
      ])
      setCatalog(catalogData)
      setInstalled(installedData)
      setXttsVoices(xttsVoicesData)
      setXttsSampleVoices(xttsSamplesData)
      setXttsLanguages(xttsLangs)
      setXttsStatus({ installed: xttsCheck.installed, error: xttsCheck.error })
      setLoading(false)
    } catch (e: any) {
      setError(e.message || 'Failed to load voice catalog')
      setLoading(false)
    }
  }

  // Get unique languages from catalog
  const languages = useMemo(() => {
    const langSet = new Set<string>()
    catalog.forEach((v) => langSet.add(v.language.name_english))
    // Add XTTS languages
    xttsLanguages.forEach((l) => langSet.add(l.name))
    return Array.from(langSet).sort()
  }, [catalog, xttsLanguages])

  // Get unique qualities
  const qualities = useMemo(() => {
    const qualSet = new Set<string>()
    catalog.forEach((v) => qualSet.add(v.quality))
    return Array.from(qualSet).sort()
  }, [catalog])

  // Combined voice list
  interface CombinedVoice {
    key: string
    name: string
    language: string
    quality: string
    size: number
    engine: 'piper' | 'xtts'
    installed: boolean
    isDownloading: boolean
    createdAt?: number
  }

  const filteredVoices = useMemo(() => {
    const combined: CombinedVoice[] = []

    // Add Piper voices
    if (modelFilter === 'all' || modelFilter === 'piper') {
      catalog.forEach((v) => {
        const isInstalled = installed.some((i) => i.key === v.key)
        const onnxFile = Object.entries(v.files).find(
          ([p]) => p.endsWith('.onnx') && !p.endsWith('.onnx.json')
        )
        const size = onnxFile ? Math.round(onnxFile[1].size_bytes / (1024 * 1024)) : 0

        combined.push({
          key: v.key,
          name: v.name,
          language: `${v.language.name_english} (${v.language.country_english})`,
          quality: v.quality,
          size,
          engine: 'piper',
          installed: isInstalled,
          isDownloading: downloading === v.key
        })
      })
    }

    // Add XTTS voices (user-created clones and downloadable samples)
    if (modelFilter === 'all' || modelFilter === 'xtts') {
      // User-created XTTS voices
      xttsVoices.forEach((v) => {
        const langName = xttsLanguages.find((l) => l.code === v.language)?.name || v.language
        combined.push({
          key: v.id,
          name: v.name,
          language: langName,
          quality: 'clone',
          size: 0,
          engine: 'xtts',
          installed: true,
          isDownloading: downloading === v.id,
          createdAt: v.createdAt
        })
      })

      // XTTS sample voices from Hugging Face
      xttsSampleVoices.forEach((v) => {
        // Skip if already shown as user voice (was downloaded)
        if (xttsVoices.some((uv) => uv.id === v.id)) return
        const langName = xttsLanguages.find((l) => l.code === v.language)?.name || v.language
        combined.push({
          key: v.id,
          name: v.name,
          language: langName,
          quality: 'sample',
          size: 0,
          engine: 'xtts',
          installed: v.installed,
          isDownloading: downloading === v.id
        })
      })
    }

    // Apply filters
    return combined
      .filter((v) => {
        // Search filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (!v.name.toLowerCase().includes(q) && !v.key.toLowerCase().includes(q) && !v.language.toLowerCase().includes(q)) {
            return false
          }
        }
        // Language filter
        if (languageFilter !== 'all' && !v.language.toLowerCase().includes(languageFilter.toLowerCase())) {
          return false
        }
        // Quality filter
        if (qualityFilter !== 'all' && v.quality !== qualityFilter) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        // Sort installed first, then by engine, then by language, then by name
        if (a.installed !== b.installed) return a.installed ? -1 : 1
        if (a.engine !== b.engine) return a.engine === 'xtts' ? -1 : 1
        if (a.language !== b.language) return a.language.localeCompare(b.language)
        return a.name.localeCompare(b.name)
      })
  }, [catalog, installed, xttsVoices, xttsSampleVoices, xttsLanguages, searchQuery, modelFilter, languageFilter, qualityFilter, downloading])

  // Download a voice (Piper or XTTS sample)
  const handleDownload = async (voiceKey: string, engine: 'piper' | 'xtts') => {
    setDownloading(voiceKey)
    try {
      if (engine === 'xtts') {
        // Download XTTS sample voice
        const result = await window.electronAPI.xttsDownloadSampleVoice(voiceKey)
        if (result.success) {
          // Reload XTTS voices and samples
          const [voices, samples] = await Promise.all([
            window.electronAPI.xttsGetVoices(),
            window.electronAPI.xttsGetSampleVoices()
          ])
          setXttsVoices(voices)
          setXttsSampleVoices(samples)
        } else {
          setError(result.error || 'Download failed')
        }
      } else {
        // Download Piper voice
        const result = await window.electronAPI.voiceDownloadFromCatalog(voiceKey)
        if (result.success) {
          const installedData = await window.electronAPI.voiceGetInstalled()
          setInstalled(installedData)
        } else {
          setError(result.error || 'Download failed')
        }
      }
    } catch (e: any) {
      setError(e.message || 'Download failed')
    }
    setDownloading(null)
  }

  // Import custom Piper voice
  const handleImportCustom = async () => {
    const result = await window.electronAPI.voiceImportCustom()
    if (result.success) {
      const installedData = await window.electronAPI.voiceGetInstalled()
      setInstalled(installedData)
    } else if (result.error) {
      setError(result.error)
    }
  }

  // Open custom voices folder
  const handleOpenFolder = () => {
    window.electronAPI.voiceOpenCustomFolder()
  }

  // Select a voice
  const handleSelect = (voice: CombinedVoice) => {
    if (voice.installed) {
      onVoiceSelect?.(voice.key, voice.engine)
      onClose()
    }
  }

  // Play audio preview
  const handlePreview = (voiceKey: string, e: React.MouseEvent) => {
    e.stopPropagation()

    // Stop current preview if playing
    if (previewAudio) {
      previewAudio.pause()
      previewAudio.src = ''
      setPreviewAudio(null)
    }

    // If clicking the same voice, just stop
    if (playingPreview === voiceKey) {
      setPlayingPreview(null)
      return
    }

    const sampleUrl = getSampleUrl(voiceKey)
    if (!sampleUrl) {
      setError('No preview available for this voice')
      return
    }

    const audio = new Audio(sampleUrl)
    audio.onended = () => {
      setPlayingPreview(null)
      setPreviewAudio(null)
    }
    audio.onerror = () => {
      setPlayingPreview(null)
      setPreviewAudio(null)
      setError('Failed to load audio preview')
    }
    audio.play()
    setPreviewAudio(audio)
    setPlayingPreview(voiceKey)
  }

  // Stop preview when modal closes
  React.useEffect(() => {
    if (!isOpen && previewAudio) {
      previewAudio.pause()
      previewAudio.src = ''
      setPreviewAudio(null)
      setPlayingPreview(null)
    }
  }, [isOpen])

  // Delete an XTTS voice
  const handleDeleteXtts = async (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this voice clone?')) return
    const result = await window.electronAPI.xttsDeleteVoice(voiceId)
    if (result.success) {
      setXttsVoices((prev) => prev.filter((v) => v.id !== voiceId))
    } else {
      setError(result.error || 'Failed to delete voice')
    }
  }

  // Install XTTS
  const handleInstallXtts = async () => {
    setInstallingXtts(true)
    setError(null)
    try {
      const result = await window.electronAPI.xttsInstall()
      if (result.success) {
        setXttsStatus({ installed: true })
      } else {
        setError(result.error || 'XTTS installation failed')
      }
    } catch (e: any) {
      setError(e.message || 'XTTS installation failed')
    }
    setInstallingXtts(false)
  }

  // Select audio for XTTS
  const handleSelectAudio = async () => {
    const result = await window.electronAPI.xttsSelectAudio()
    if (result.success && result.path) {
      setCreateXttsAudioPath(result.path)
    }
  }

  // Create XTTS voice
  const handleCreateXtts = async () => {
    if (!createXttsName.trim() || !createXttsAudioPath) return
    setCreatingXtts(true)
    setError(null)
    try {
      const result = await window.electronAPI.xttsCreateVoice(createXttsAudioPath, createXttsName.trim(), createXttsLanguage)
      if (result.success) {
        const voices = await window.electronAPI.xttsGetVoices()
        setXttsVoices(voices)
        setShowCreateXtts(false)
        setCreateXttsName('')
        setCreateXttsAudioPath('')
        setCreateXttsLanguage('en')
      } else {
        setError(result.error || 'Failed to create voice')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to create voice')
    }
    setCreatingXtts(false)
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal voice-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Voice Browser</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="voice-browser-filters">
          <input
            type="text"
            className="voice-search"
            placeholder="Search voices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select className="voice-filter" value={modelFilter} onChange={(e) => setModelFilter(e.target.value as 'all' | 'piper' | 'xtts')}>
            <option value="all">All Models</option>
            <option value="piper">Piper</option>
            <option value="xtts">XTTS Clones</option>
          </select>
          <select className="voice-filter" value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
            <option value="all">All Languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          <select className="voice-filter" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)}>
            <option value="all">All Quality</option>
            {qualities.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
            <option value="clone">clone</option>
          </select>
        </div>

        <div className="voice-browser-content">
          {loading ? (
            <div className="voice-browser-loading">Loading voice catalog...</div>
          ) : error ? (
            <div className="voice-browser-error">
              {error}
              <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          ) : (
            <>
              <div className="voice-browser-header">
                <span className="voice-col-model">Model</span>
                <span className="voice-col-name">Name</span>
                <span className="voice-col-lang">Language</span>
                <span className="voice-col-quality">Quality</span>
                <span className="voice-col-size">Size</span>
                <span className="voice-col-preview">Preview</span>
                <span className="voice-col-action"></span>
              </div>
              <div className="voice-browser-list">
                {filteredVoices.map((voice) => (
                  <div
                    key={`${voice.engine}-${voice.key}`}
                    className={`voice-browser-row ${voice.installed ? 'installed' : ''}`}
                    onClick={() => handleSelect(voice)}
                    title={voice.key}
                  >
                    <span className="voice-col-model">
                      <span className={`voice-model-badge ${voice.engine}`}>{voice.engine === 'piper' ? 'Piper' : 'XTTS'}</span>
                    </span>
                    <span className="voice-col-name">{voice.name}</span>
                    <span className="voice-col-lang">{voice.language}</span>
                    <span className="voice-col-quality">{voice.quality}</span>
                    <span className="voice-col-size">{voice.size > 0 ? `${voice.size} MB` : '--'}</span>
                    <span className="voice-col-preview">
                      {voice.engine === 'piper' && getSampleUrl(voice.key) && (
                        <button
                          className={`voice-preview-btn ${playingPreview === voice.key ? 'playing' : ''}`}
                          onClick={(e) => handlePreview(voice.key, e)}
                          title={playingPreview === voice.key ? 'Stop preview' : 'Play preview'}
                        >
                          {playingPreview === voice.key ? '⏹' : '▶'}
                        </button>
                      )}
                    </span>
                    <span className="voice-col-action">
                      {voice.installed ? (
                        voice.engine === 'xtts' ? (
                          <button
                            className="voice-delete-btn"
                            onClick={(e) => handleDeleteXtts(voice.key, e)}
                            title="Delete voice clone"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="voice-installed-badge">Installed</span>
                        )
                      ) : voice.isDownloading ? (
                        <span className="voice-downloading">Downloading...</span>
                      ) : (
                        <button
                          className="voice-download-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownload(voice.key, voice.engine)
                          }}
                        >
                          Download
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {filteredVoices.length === 0 && <div className="voice-browser-empty">No voices match your filters</div>}
              </div>
            </>
          )}
        </div>

        <div className="voice-browser-footer">
          <div className="voice-browser-actions">
            <button className="btn-secondary" onClick={handleImportCustom}>
              Import Piper...
            </button>
            <button className="btn-secondary" onClick={() => setShowCreateXtts(true)}>
              Create XTTS Voice...
            </button>
            <button className="btn-secondary" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
          <div className="voice-browser-stats">{!loading && `Showing ${filteredVoices.length} voices`}</div>
        </div>

        {/* XTTS Voice Creation Dialog */}
        {showCreateXtts && (
          <div className="voice-create-dialog">
            <div className="voice-create-content">
              <h3>Create XTTS Voice Clone</h3>
              {!xttsStatus.installed ? (
                <div className="xtts-install-prompt">
                  <p>XTTS requires Python and the TTS library to be installed.</p>
                  {xttsStatus.error && <p className="error-text">{xttsStatus.error}</p>}
                  <button className="btn-primary" onClick={handleInstallXtts} disabled={installingXtts}>
                    {installingXtts ? 'Installing...' : 'Install XTTS Dependencies'}
                  </button>
                  <p className="note-text">This will install the TTS library via pip (~2GB)</p>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label>Voice Name</label>
                    <input
                      type="text"
                      value={createXttsName}
                      onChange={(e) => setCreateXttsName(e.target.value)}
                      placeholder="My Voice Clone"
                    />
                  </div>
                  <div className="form-group">
                    <label>Language</label>
                    <select value={createXttsLanguage} onChange={(e) => setCreateXttsLanguage(e.target.value)}>
                      {xttsLanguages.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Reference Audio (6+ seconds)</label>
                    <div className="audio-select-row">
                      <input type="text" value={createXttsAudioPath} readOnly placeholder="Select an audio file..." />
                      <button className="btn-secondary" onClick={handleSelectAudio}>
                        Browse...
                      </button>
                    </div>
                    <p className="note-text">Use a clean recording of the voice you want to clone</p>
                  </div>
                  <div className="dialog-actions">
                    <button className="btn-secondary" onClick={() => setShowCreateXtts(false)}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleCreateXtts}
                      disabled={creatingXtts || !createXttsName.trim() || !createXttsAudioPath}
                    >
                      {creatingXtts ? 'Creating...' : 'Create Voice'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
