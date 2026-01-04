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

interface VoiceBrowserModalProps {
  isOpen: boolean
  onClose: () => void
  onVoiceSelect?: (voiceKey: string) => void
}

export function VoiceBrowserModal({ isOpen, onClose, onVoiceSelect }: VoiceBrowserModalProps) {
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([])
  const [installed, setInstalled] = useState<InstalledVoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [downloading, setDownloading] = useState<string | null>(null)

  // Load catalog and installed voices
  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      setError(null)

      Promise.all([
        window.electronAPI.voiceFetchCatalog(),
        window.electronAPI.voiceGetInstalled()
      ])
        .then(([catalogData, installedData]) => {
          setCatalog(catalogData)
          setInstalled(installedData)
          setLoading(false)
        })
        .catch((e) => {
          setError(e.message || 'Failed to load voice catalog')
          setLoading(false)
        })
    }
  }, [isOpen])

  // Get unique languages from catalog
  const languages = useMemo(() => {
    const langSet = new Set<string>()
    catalog.forEach((v) => langSet.add(v.language.name_english))
    return Array.from(langSet).sort()
  }, [catalog])

  // Get unique qualities
  const qualities = useMemo(() => {
    const qualSet = new Set<string>()
    catalog.forEach((v) => qualSet.add(v.quality))
    return Array.from(qualSet).sort()
  }, [catalog])

  // Filter and sort voices
  const filteredVoices = useMemo(() => {
    return catalog
      .filter((v) => {
        // Search filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (
            !v.name.toLowerCase().includes(q) &&
            !v.key.toLowerCase().includes(q) &&
            !v.language.name_english.toLowerCase().includes(q) &&
            !v.language.country_english.toLowerCase().includes(q)
          ) {
            return false
          }
        }
        // Language filter
        if (languageFilter !== 'all' && v.language.name_english !== languageFilter) {
          return false
        }
        // Quality filter
        if (qualityFilter !== 'all' && v.quality !== qualityFilter) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        // Sort installed first, then by language, then by name
        const aInstalled = installed.some((i) => i.key === a.key)
        const bInstalled = installed.some((i) => i.key === b.key)
        if (aInstalled !== bInstalled) return aInstalled ? -1 : 1
        if (a.language.name_english !== b.language.name_english) {
          return a.language.name_english.localeCompare(b.language.name_english)
        }
        return a.name.localeCompare(b.name)
      })
  }, [catalog, installed, searchQuery, languageFilter, qualityFilter])

  // Check if a voice is installed
  const isInstalled = (voiceKey: string) => {
    return installed.some((i) => i.key === voiceKey)
  }

  // Get file size in MB
  const getVoiceSizeMB = (voice: VoiceCatalogEntry): number => {
    const onnxFile = Object.entries(voice.files).find(
      ([p]) => p.endsWith('.onnx') && !p.endsWith('.onnx.json')
    )
    if (onnxFile) {
      return Math.round(onnxFile[1].size_bytes / (1024 * 1024))
    }
    return 0
  }

  // Download a voice
  const handleDownload = async (voiceKey: string) => {
    setDownloading(voiceKey)
    try {
      const result = await window.electronAPI.voiceDownloadFromCatalog(voiceKey)
      if (result.success) {
        // Refresh installed list
        const installedData = await window.electronAPI.voiceGetInstalled()
        setInstalled(installedData)
      } else {
        setError(result.error || 'Download failed')
      }
    } catch (e: any) {
      setError(e.message || 'Download failed')
    }
    setDownloading(null)
  }

  // Import custom voice
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
  const handleSelect = (voiceKey: string) => {
    if (isInstalled(voiceKey)) {
      onVoiceSelect?.(voiceKey)
      onClose()
    }
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
          <select
            className="voice-filter"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
          >
            <option value="all">All Languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          <select
            className="voice-filter"
            value={qualityFilter}
            onChange={(e) => setQualityFilter(e.target.value)}
          >
            <option value="all">All Quality</option>
            {qualities.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>

        <div className="voice-browser-content">
          {loading ? (
            <div className="voice-browser-loading">Loading voice catalog...</div>
          ) : error ? (
            <div className="voice-browser-error">{error}</div>
          ) : (
            <>
              <div className="voice-browser-header">
                <span className="voice-col-name">Name</span>
                <span className="voice-col-lang">Language</span>
                <span className="voice-col-quality">Quality</span>
                <span className="voice-col-size">Size</span>
                <span className="voice-col-action"></span>
              </div>
              <div className="voice-browser-list">
                {filteredVoices.map((voice) => {
                  const installed = isInstalled(voice.key)
                  const size = getVoiceSizeMB(voice)
                  const isDownloading = downloading === voice.key

                  return (
                    <div
                      key={voice.key}
                      className={`voice-browser-row ${installed ? 'installed' : ''}`}
                      onClick={() => handleSelect(voice.key)}
                      title={voice.key}
                    >
                      <span className="voice-col-name">{voice.name}</span>
                      <span className="voice-col-lang">
                        {voice.language.name_english} ({voice.language.country_english})
                      </span>
                      <span className="voice-col-quality">{voice.quality}</span>
                      <span className="voice-col-size">{size} MB</span>
                      <span className="voice-col-action">
                        {installed ? (
                          <span className="voice-installed-badge">Installed</span>
                        ) : isDownloading ? (
                          <span className="voice-downloading">Downloading...</span>
                        ) : (
                          <button
                            className="voice-download-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDownload(voice.key)
                            }}
                          >
                            Download
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className="voice-browser-footer">
          <div className="voice-browser-actions">
            <button className="btn-secondary" onClick={handleImportCustom}>
              Import Custom...
            </button>
            <button className="btn-secondary" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
          <div className="voice-browser-stats">
            {!loading && `Showing ${filteredVoices.length} of ${catalog.length} voices`}
          </div>
        </div>
      </div>
    </div>
  )
}
