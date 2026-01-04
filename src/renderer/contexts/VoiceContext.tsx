import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

interface VoiceContextValue {
  voiceOutputEnabled: boolean
  setVoiceOutputEnabled: (enabled: boolean) => void
  speakText: (text: string) => void
  stopSpeaking: () => void
  isSpeaking: boolean
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakQueueRef = useRef<string[]>([])
  const isProcessingRef = useRef(false)
  const voiceOutputEnabledRef = useRef(voiceOutputEnabled)

  // Keep ref in sync to avoid stale closure in speakText
  useEffect(() => {
    voiceOutputEnabledRef.current = voiceOutputEnabled
  }, [voiceOutputEnabled])

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

    speakQueueRef.current.push(cleanText)
    processQueue()
  }, [voiceOutputEnabled, processQueue])

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
      isSpeaking
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
