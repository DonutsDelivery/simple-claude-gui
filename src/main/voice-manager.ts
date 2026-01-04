import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { isWindows, isMac } from './platform'

const execAsync = promisify(exec)

// Directory structure
const depsDir = path.join(app.getPath('userData'), 'deps')
const whisperDir = path.join(depsDir, 'whisper')
const whisperModelsDir = path.join(whisperDir, 'models')
const piperDir = path.join(depsDir, 'piper')
const piperVoicesDir = path.join(piperDir, 'voices')
const openvoiceDir = path.join(depsDir, 'openvoice')

// Whisper models available for download (from ggerganov/whisper.cpp on Hugging Face)
export const WHISPER_MODELS = {
  'tiny.en': { file: 'ggml-tiny.en.bin', size: 75, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin' },
  'base.en': { file: 'ggml-base.en.bin', size: 147, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' },
  'small.en': { file: 'ggml-small.en.bin', size: 488, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin' },
  'medium.en': { file: 'ggml-medium.en.bin', size: 1500, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin' },
  'large-v3': { file: 'ggml-large-v3.bin', size: 3000, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin' }
} as const

export type WhisperModelName = keyof typeof WHISPER_MODELS

// Piper voices - only CC0/CC-BY licensed (commercially safe)
// See: https://github.com/rhasspy/piper/blob/master/VOICES.md
export const PIPER_VOICES = {
  'en_US-libritts_r-medium': {
    file: 'en_US-libritts_r-medium.onnx',
    config: 'en_US-libritts_r-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'LibriTTS-R (US English, medium quality)'
  },
  'en_GB-jenny_dioco-medium': {
    file: 'en_GB-jenny_dioco-medium.onnx',
    config: 'en_GB-jenny_dioco-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json',
    license: 'CC0',
    description: 'Jenny DioCo (British English, medium quality)'
  },
  'en_US-ryan-medium': {
    file: 'en_US-ryan-medium.onnx',
    config: 'en_US-ryan-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Ryan (US English male, medium quality)'
  }
} as const

export type PiperVoiceName = keyof typeof PIPER_VOICES

// Piper binary URLs
const PIPER_BINARY_URLS = {
  win32: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  darwin: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz',
  linux: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz'
}

export interface WhisperStatus {
  installed: boolean
  models: WhisperModelName[]
  currentModel: WhisperModelName | null
}

export interface TTSStatus {
  installed: boolean
  engine: 'piper' | 'openvoice' | null
  voices: string[]
  currentVoice: string | null
}

export interface VoiceSettings {
  whisperModel: WhisperModelName
  ttsEngine: 'piper' | 'openvoice'
  ttsVoice: string
  microphoneId: string | null
  readBehavior: 'immediate' | 'pause' | 'manual'
}

// Ensure directories exist
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Download file with progress
function downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        fs.unlinkSync(destPath)
        downloadFile(response.headers.location!, destPath, onProgress)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloaded = 0

      response.on('data', (chunk) => {
        downloaded += chunk.length
        if (onProgress && totalSize > 0) {
          onProgress(Math.round((downloaded / totalSize) * 100))
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', (err) => {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(err)
      })
    })

    request.on('error', (err) => {
      file.close()
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      reject(err)
    })
  })
}

// Extract archive
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  ensureDir(destDir)

  if (isWindows) {
    await execAsync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, {
      timeout: 120000
    })
  } else {
    if (archivePath.endsWith('.tar.gz')) {
      await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`, { timeout: 120000 })
    } else {
      await execAsync(`unzip -o "${archivePath}" -d "${destDir}"`, { timeout: 120000 })
    }
  }
}

class VoiceManager {
  private currentWhisperModel: WhisperModelName = 'base.en'
  private currentTTSVoice: string = 'en_US-libritts_r-medium'
  private currentTTSEngine: 'piper' | 'openvoice' = 'piper'
  private speakingProcess: ChildProcess | null = null

  // ==================== WHISPER (STT) ====================

  getWhisperModelPath(model: WhisperModelName): string {
    return path.join(whisperModelsDir, WHISPER_MODELS[model].file)
  }

  isWhisperModelInstalled(model: WhisperModelName): boolean {
    return fs.existsSync(this.getWhisperModelPath(model))
  }

  getInstalledWhisperModels(): WhisperModelName[] {
    if (!fs.existsSync(whisperModelsDir)) return []
    return (Object.keys(WHISPER_MODELS) as WhisperModelName[]).filter(model =>
      this.isWhisperModelInstalled(model)
    )
  }

  async checkWhisper(): Promise<WhisperStatus> {
    const models = this.getInstalledWhisperModels()
    return {
      installed: models.length > 0,
      models,
      currentModel: models.includes(this.currentWhisperModel) ? this.currentWhisperModel : models[0] || null
    }
  }

  async downloadWhisperModel(
    model: WhisperModelName,
    onProgress?: (status: string, percent?: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      ensureDir(whisperModelsDir)

      const modelInfo = WHISPER_MODELS[model]
      const modelPath = this.getWhisperModelPath(model)

      onProgress?.(`Downloading Whisper ${model} model (${modelInfo.size}MB)...`, 0)

      await downloadFile(modelInfo.url, modelPath, (percent) => {
        onProgress?.(`Downloading Whisper ${model} model...`, percent)
      })

      this.currentWhisperModel = model
      onProgress?.('Whisper model installed successfully', 100)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  setWhisperModel(model: WhisperModelName): void {
    if (this.isWhisperModelInstalled(model)) {
      this.currentWhisperModel = model
    }
  }

  // Transcribe audio using whisper.cpp main binary
  // For now, we'll save PCM to a temp WAV file and use whisper CLI
  // In the future, we could use a Node.js binding for better performance
  async transcribe(pcmData: Float32Array, sampleRate: number = 16000): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      // Use current model, or fall back to any installed model
      let modelToUse = this.currentWhisperModel
      if (!this.isWhisperModelInstalled(modelToUse)) {
        const installed = this.getInstalledWhisperModels()
        if (installed.length === 0) {
          return { success: false, error: 'No Whisper model installed. Install one from Settings.' }
        }
        modelToUse = installed[0]
        this.currentWhisperModel = modelToUse
      }

      const modelPath = this.getWhisperModelPath(modelToUse)

      // Voice input transcription is not yet fully implemented
      // The model is downloaded, but we need whisper.cpp binary to run inference
      // For now, provide a helpful message
      return {
        success: false,
        error: `Voice input coming soon! Model "${modelToUse}" is ready, but whisper.cpp binary integration is pending.`
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  // ==================== PIPER (TTS) ====================

  getPiperBinaryPath(): string | null {
    const binaryName = isWindows ? 'piper.exe' : 'piper'
    // Piper extracts to a 'piper' subdirectory
    const binaryPath = path.join(piperDir, 'piper', binaryName)
    if (fs.existsSync(binaryPath)) return binaryPath
    // Also check direct path
    const directPath = path.join(piperDir, binaryName)
    return fs.existsSync(directPath) ? directPath : null
  }

  isPiperInstalled(): boolean {
    return this.getPiperBinaryPath() !== null
  }

  getPiperVoicePath(voice: string): { model: string; config: string } | null {
    const voiceInfo = PIPER_VOICES[voice as PiperVoiceName]
    if (!voiceInfo) return null

    const modelPath = path.join(piperVoicesDir, voiceInfo.file)
    const configPath = path.join(piperVoicesDir, voiceInfo.config)

    if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
      return { model: modelPath, config: configPath }
    }
    return null
  }

  getInstalledPiperVoices(): string[] {
    if (!fs.existsSync(piperVoicesDir)) return []
    return (Object.keys(PIPER_VOICES) as PiperVoiceName[]).filter(voice =>
      this.getPiperVoicePath(voice) !== null
    )
  }

  async checkTTS(): Promise<TTSStatus> {
    const piperInstalled = this.isPiperInstalled()
    const voices = this.getInstalledPiperVoices()

    return {
      installed: piperInstalled && voices.length > 0,
      engine: piperInstalled ? 'piper' : null,
      voices,
      currentVoice: voices.includes(this.currentTTSVoice) ? this.currentTTSVoice : voices[0] || null
    }
  }

  async installPiper(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
    try {
      ensureDir(piperDir)

      const platform = process.platform as 'win32' | 'darwin' | 'linux'
      const url = PIPER_BINARY_URLS[platform]
      if (!url) {
        return { success: false, error: `Unsupported platform: ${platform}` }
      }

      const ext = isWindows ? '.zip' : '.tar.gz'
      const archivePath = path.join(piperDir, `piper${ext}`)

      onProgress?.('Downloading Piper TTS...', 0)
      await downloadFile(url, archivePath, (percent) => {
        onProgress?.('Downloading Piper TTS...', percent)
      })

      onProgress?.('Extracting Piper TTS...', undefined)
      await extractArchive(archivePath, piperDir)

      // Cleanup archive
      fs.unlinkSync(archivePath)

      // Make binary executable on Unix
      if (!isWindows) {
        const binaryPath = this.getPiperBinaryPath()
        if (binaryPath) {
          fs.chmodSync(binaryPath, 0o755)
        }
      }

      if (!this.isPiperInstalled()) {
        return { success: false, error: 'Piper extraction failed' }
      }

      onProgress?.('Piper TTS installed successfully', 100)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async downloadPiperVoice(
    voice: PiperVoiceName,
    onProgress?: (status: string, percent?: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      ensureDir(piperVoicesDir)

      const voiceInfo = PIPER_VOICES[voice]
      const modelPath = path.join(piperVoicesDir, voiceInfo.file)
      const configPath = path.join(piperVoicesDir, voiceInfo.config)

      onProgress?.(`Downloading voice: ${voiceInfo.description}...`, 0)

      // Download model file
      await downloadFile(voiceInfo.url, modelPath, (percent) => {
        onProgress?.(`Downloading voice model...`, Math.round(percent * 0.9))
      })

      // Download config file
      await downloadFile(voiceInfo.configUrl, configPath, () => {
        onProgress?.(`Downloading voice config...`, 95)
      })

      this.currentTTSVoice = voice
      onProgress?.('Voice installed successfully', 100)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  setTTSVoice(voice: string): void {
    if (this.getPiperVoicePath(voice)) {
      this.currentTTSVoice = voice
    }
  }

  setTTSEngine(engine: 'piper' | 'openvoice'): void {
    this.currentTTSEngine = engine
  }

  // Speak text using Piper TTS
  // Returns the audio data as base64
  async speak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    const piperPath = this.getPiperBinaryPath()
    if (!piperPath) {
      return { success: false, error: 'Piper not installed' }
    }

    const voicePaths = this.getPiperVoicePath(this.currentTTSVoice)
    if (!voicePaths) {
      return { success: false, error: 'Voice not installed' }
    }

    try {
      const tempDir = app.getPath('temp')
      const outputPath = path.join(tempDir, `tts_${Date.now()}.wav`)

      // Piper takes text from stdin and outputs WAV to file
      const args = [
        '--model', voicePaths.model,
        '--output_file', outputPath
      ]

      return new Promise((resolve) => {
        const proc = spawn(piperPath, args)
        this.speakingProcess = proc

        proc.stdin.write(text)
        proc.stdin.end()

        proc.on('close', (code) => {
          this.speakingProcess = null
          if (code === 0 && fs.existsSync(outputPath)) {
            // Read file and return as base64
            const audioBuffer = fs.readFileSync(outputPath)
            const audioData = audioBuffer.toString('base64')
            // Clean up temp file
            fs.unlinkSync(outputPath)
            resolve({ success: true, audioData })
          } else {
            resolve({ success: false, error: `Piper exited with code ${code}` })
          }
        })

        proc.on('error', (err) => {
          this.speakingProcess = null
          resolve({ success: false, error: err.message })
        })
      })
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  stopSpeaking(): void {
    if (this.speakingProcess) {
      this.speakingProcess.kill()
      this.speakingProcess = null
    }
  }

  // ==================== OPENVOICE (Voice Cloning) ====================
  // TODO: Implement OpenVoice integration for voice cloning
  // This will require Python and the OpenVoice package

  async checkOpenVoice(): Promise<{ installed: boolean }> {
    // Check if OpenVoice Python package is available
    return { installed: false }
  }

  async installOpenVoice(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement OpenVoice installation
    return { success: false, error: 'OpenVoice integration not yet implemented' }
  }

  async importCustomVoice(audioPath: string): Promise<{ success: boolean; voiceId?: string; error?: string }> {
    // TODO: Implement voice cloning using OpenVoice
    return { success: false, error: 'Voice cloning not yet implemented' }
  }

  // ==================== SETTINGS ====================

  getSettings(): VoiceSettings {
    return {
      whisperModel: this.currentWhisperModel,
      ttsEngine: this.currentTTSEngine,
      ttsVoice: this.currentTTSVoice,
      microphoneId: null, // Retrieved from renderer
      readBehavior: 'immediate'
    }
  }

  applySettings(settings: Partial<VoiceSettings>): void {
    if (settings.whisperModel) {
      this.setWhisperModel(settings.whisperModel)
    }
    if (settings.ttsEngine) {
      this.setTTSEngine(settings.ttsEngine)
    }
    if (settings.ttsVoice) {
      this.setTTSVoice(settings.ttsVoice)
    }
  }
}

// Export singleton instance
export const voiceManager = new VoiceManager()
