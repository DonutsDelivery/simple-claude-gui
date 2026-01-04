import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

interface VoiceContextValue {
  voiceOutputEnabled: boolean
  setVoiceOutputEnabled: (enabled: boolean) => void
  speakText: (text: string) => void
  stopSpeaking: () => void
  isSpeaking: boolean
  volume: number
  setVolume: (volume: number) => void
  speed: number
  setSpeed: (speed: number) => void
  skipOnNew: boolean
  setSkipOnNew: (skip: boolean) => void
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [volume, setVolumeState] = useState(1.0)
  const [speed, setSpeedState] = useState(1.0)
  const [skipOnNew, setSkipOnNew] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakQueueRef = useRef<string[]>([])
  const isProcessingRef = useRef(false)
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)
  const skipOnNewRef = useRef(skipOnNew)

  // Keep refs in sync to avoid stale closures
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

  useEffect(() => {
    skipOnNewRef.current = skipOnNew
  }, [skipOnNew])

  // Update volume on current audio
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    if (audioRef.current) {
      audioRef.current.volume = clamped
    }
  }, [])

  // Update speed and notify backend
  const setSpeed = useCallback((s: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, s))
    setSpeedState(clamped)
    window.electronAPI.voiceApplySettings?.({ ttsSpeed: clamped })
  }, [])

  // Process the speak queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || speakQueueRef.current.length === 0) return

    isProcessingRef.current = true
    setIsSpeaking(true)

    while (speakQueueRef.current.length > 0) {
      const text = speakQueueRef.current.shift()
      if (!text) continue

      try {
        // Call Piper TTS via IPC - returns audio as base64
        const result = await window.electronAPI.voiceSpeak?.(text)

        if (result?.success && result.audioData) {
          // Play the audio from base64 data
          await new Promise<void>((resolve) => {
            const audioData = Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))
            const blob = new Blob([audioData], { type: 'audio/wav' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.volume = volume
            audioRef.current = audio

            audio.onended = () => {
              URL.revokeObjectURL(url)
              audioRef.current = null
              resolve()
            }
            audio.onerror = (e) => {
              console.error('Audio playback error:', e)
              URL.revokeObjectURL(url)
              audioRef.current = null
              resolve()
            }

            audio.play().catch(e => {
              console.error('Failed to play audio:', e)
              URL.revokeObjectURL(url)
              resolve()
            })
          })
        } else if (result?.error) {
          console.error('TTS error:', result.error)
        }
      } catch (e) {
        console.error('TTS error:', e)
      }
    }

    isProcessingRef.current = false
    setIsSpeaking(false)
  }, [])

  const speakText = useCallback((text: string) => {
    if (!voiceOutputEnabledRef.current) return  // Use ref to avoid stale closure

    // Clean up the text - remove ANSI codes, excessive whitespace
    const cleanText = text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape codes
      .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()

    if (cleanText.length < 3) return // Skip very short text

    // If skipOnNew is enabled, clear queue and stop current audio
    if (skipOnNewRef.current) {
      speakQueueRef.current = []
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      isProcessingRef.current = false
    }

    speakQueueRef.current.push(cleanText)
    processQueue()
  }, [processQueue])

  const stopSpeaking = useCallback(() => {
    speakQueueRef.current = []
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.electronAPI.voiceStopSpeaking?.()
    setIsSpeaking(false)
    isProcessingRef.current = false
  }, [])

  // Stop speaking when disabled
  useEffect(() => {
    if (!voiceOutputEnabled) {
      stopSpeaking()
    }
  }, [voiceOutputEnabled, stopSpeaking])

  return (
    <VoiceContext.Provider value={{
      voiceOutputEnabled,
      setVoiceOutputEnabled,
      speakText,
      stopSpeaking,
      isSpeaking,
      volume,
      setVolume,
      speed,
      setSpeed,
      skipOnNew,
      setSkipOnNew
    }}>
      {children}
    </VoiceContext.Provider>
  )
}

export function useVoice() {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
