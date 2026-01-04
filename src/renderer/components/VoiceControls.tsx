import React, { useState, useEffect, useRef } from 'react'
import { useVoice } from '../contexts/VoiceContext'

interface VoiceControlsProps {
  activeTabId: string | null
  onTranscription: (text: string) => void
}

export function VoiceControls({
  activeTabId,
  onTranscription
}: VoiceControlsProps) {
  const { voiceOutputEnabled, setVoiceOutputEnabled, isSpeaking, stopSpeaking } = useVoice()

  const [isRecording, setIsRecording] = useState(false)
  const [whisperInstalled, setWhisperInstalled] = useState(false)
  const [ttsInstalled, setTtsInstalled] = useState(false)
  const [installingWhisper, setInstallingWhisper] = useState(false)
  const [installingTTS, setInstallingTTS] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    checkInstallation()

    const cleanup = window.electronAPI.onInstallProgress?.((data) => {
      if (data.type === 'whisper' && data.percent === 100) {
        setInstallingWhisper(false)
        checkInstallation()
      }
      if ((data.type === 'piper' || data.type === 'piper-voice') && data.percent === 100) {
        setInstallingTTS(false)
        checkInstallation()
      }
    })
    return cleanup
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  const checkInstallation = async () => {
    try {
      const whisperStatus = await window.electronAPI.voiceCheckWhisper?.()
      setWhisperInstalled(whisperStatus?.installed ?? false)

      const ttsStatus = await window.electronAPI.voiceCheckTTS?.()
      setTtsInstalled(ttsStatus?.installed ?? false)
    } catch (e) {
      // Voice features not available
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        // Convert to PCM for Whisper
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await processAudio(audioBlob)

        // Stop the stream
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (e) {
      console.error('Failed to start recording:', e)
      alert('Could not access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const processAudio = async (audioBlob: Blob) => {
    try {
      // Convert audio blob to ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer()

      // Decode audio using Web Audio API
      const audioContext = new AudioContext({ sampleRate: 16000 })
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      // Get PCM data (mono, 16kHz)
      const pcmData = audioBuffer.getChannelData(0)

      // Convert Float32Array to regular array for IPC
      const pcmArray = Array.from(pcmData)

      // Send to Whisper for transcription
      const result = await window.electronAPI.voiceTranscribe?.(pcmArray)

      if (result?.success && result.text) {
        onTranscription(result.text)
      } else if (result?.error) {
        console.error('Transcription:', result.error)
        // Show friendly message - voice input is coming soon
        if (result.error.includes('coming soon') || result.error.includes('pending')) {
          alert('🎤 Voice input coming soon!\n\nThe speech model is downloaded and ready. Whisper.cpp binary integration is in progress.')
        } else {
          alert(`Transcription: ${result.error}`)
        }
      }

      audioContext.close()
    } catch (e) {
      console.error('Audio processing failed:', e)
    }
  }

  const handleVoiceInput = async () => {
    if (installingWhisper) return

    if (!whisperInstalled) {
      setInstallingWhisper(true)
      try {
        await window.electronAPI.voiceInstallWhisper?.('base.en')
        await checkInstallation()
      } catch (e) {
        console.error('Failed to install Whisper:', e)
      }
      setInstallingWhisper(false)
    } else {
      // Voice input not yet implemented
      // Show brief visual feedback
      const btn = document.querySelector('.action-icon-btn:first-child') as HTMLElement
      if (btn) {
        btn.style.opacity = '0.3'
        setTimeout(() => { btn.style.opacity = '' }, 300)
      }
    }
  }

  const handleVoiceOutput = async () => {
    if (installingTTS) return

    if (!ttsInstalled) {
      setInstallingTTS(true)
      try {
        const result = await window.electronAPI.voiceInstallPiper?.()
        if (result?.success) {
          await window.electronAPI.voiceInstallVoice?.('en_US-libritts_r-medium')
        }
        await checkInstallation()
      } catch (e) {
        console.error('Failed to install Piper:', e)
      }
      setInstallingTTS(false)
    } else {
      // If currently speaking, stop; otherwise toggle
      if (isSpeaking) {
        stopSpeaking()
      }
      const newState = !voiceOutputEnabled
      setVoiceOutputEnabled(newState)

      // Test TTS when enabling
      if (newState) {
        console.log('Testing TTS...')
        window.electronAPI.voiceSpeak?.('Voice output enabled. Hello!')
          .then(result => {
            console.log('TTS result:', result)
            if (result?.success && result.audioData) {
              const audioData = Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))
              const blob = new Blob([audioData], { type: 'audio/wav' })
              const url = URL.createObjectURL(blob)
              const audio = new Audio(url)
              audio.play().catch(e => console.error('Play failed:', e))
            }
          })
          .catch(e => console.error('TTS failed:', e))
      }
    }
  }

  return (
    <>
      <button
        className={`action-icon-btn ${isRecording ? 'enabled recording' : ''} ${installingWhisper ? 'installing' : ''} ${whisperInstalled ? 'not-ready' : ''}`}
        onClick={handleVoiceInput}
        disabled={installingWhisper}
        tabIndex={-1}
        title={installingWhisper ? 'Installing Whisper...' : whisperInstalled ? 'Voice input coming soon' : 'Click to install Whisper'}
      >
        {installingWhisper ? '⏳' : '🎤'}
      </button>

      <button
        className={`action-icon-btn ${voiceOutputEnabled ? 'enabled' : ''} ${installingTTS ? 'installing' : ''}`}
        onClick={handleVoiceOutput}
        disabled={installingTTS}
        tabIndex={-1}
        title={installingTTS ? 'Installing Piper...' : ttsInstalled ? (voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output') : 'Click to install Piper'}
      >
        {installingTTS ? '⏳' : '🔊'}
      </button>
    </>
  )
}
