import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { isWindows, isMac } from './platform'
import { xttsManager } from './xtts-manager'

const execAsync = promisify(exec)

// Directory structure
const depsDir = path.join(app.getPath('userData'), 'deps')
const whisperDir = path.join(depsDir, 'whisper')
const whisperModelsDir = path.join(whisperDir, 'models')
const piperDir = path.join(depsDir, 'piper')
const piperVoicesDir = path.join(piperDir, 'voices')
const customVoicesDir = path.join(piperDir, 'custom-voices')
const openvoiceDir = path.join(depsDir, 'openvoice')

// Hugging Face API for voice catalog
const VOICES_CATALOG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json'
const HF_BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

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
    description: 'LibriTTS-R (US English)'
  },
  'en_GB-jenny_dioco-medium': {
    file: 'en_GB-jenny_dioco-medium.onnx',
    config: 'en_GB-jenny_dioco-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json',
    license: 'CC0',
    description: 'Jenny DioCo (British)'
  },
  'en_US-ryan-medium': {
    file: 'en_US-ryan-medium.onnx',
    config: 'en_US-ryan-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Ryan (US English male)'
  },
  'en_US-amy-medium': {
    file: 'en_US-amy-medium.onnx',
    config: 'en_US-amy-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Amy (US English female)'
  },
  'en_US-arctic-medium': {
    file: 'en_US-arctic-medium.onnx',
    config: 'en_US-arctic-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/arctic/medium/en_US-arctic-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/arctic/medium/en_US-arctic-medium.onnx.json',
    license: 'CC0',
    description: 'Arctic (US English, multi-speaker)'
  },
  'en_GB-alan-medium': {
    file: 'en_GB-alan-medium.onnx',
    config: 'en_GB-alan-medium.onnx.json',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
    license: 'CC-BY-4.0',
    description: 'Alan (British male)'
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
  engine: 'piper' | 'xtts' | 'openvoice' | null
  voices: string[]
  currentVoice: string | null
}

export interface VoiceSettings {
  whisperModel: WhisperModelName
  ttsEngine: 'piper' | 'xtts' | 'openvoice'
  ttsVoice: string
  ttsSpeed: number  // 0.5 = slow, 1.0 = normal, 2.0 = fast (Piper length_scale is inverted)
  microphoneId: string | null
  readBehavior: 'immediate' | 'pause' | 'manual'
  skipOnNew: boolean  // If true, interrupt current speech when new text arrives
}

// Voice catalog types (from Hugging Face API)
export interface VoiceCatalogEntry {
  key: string
  name: string
  language: {
    code: string
    family: string
    region: string
    name_native: string
    name_english: string
    country_english: string
  }
  quality: 'x_low' | 'low' | 'medium' | 'high'
  num_speakers: number
  speaker_id_map: Record<string, number>
  files: Record<string, { size_bytes: number; md5_digest: string }>
  aliases: string[]
}

export interface InstalledVoice {
  key: string
  displayName: string
  source: 'builtin' | 'downloaded' | 'custom'
  quality?: string
  language?: string
}

export interface CustomVoiceMetadata {
  voices: {
    [key: string]: {
      displayName: string
      addedAt: number
    }
  }
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
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        const location = response.headers.location
        if (!location) {
          reject(new Error(`Redirect with no location header`))
          return
        }
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString()
        downloadFile(redirectUrl, destPath, onProgress)
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

// Fetch JSON from URL
function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location
        if (!location) {
          reject(new Error(`Redirect with no location header`))
          return
        }
        // Handle relative URLs
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString()
        fetchJson<T>(redirectUrl)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      let data = ''
      response.on('data', chunk => data += chunk)
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })

    request.on('error', reject)
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
  private currentTTSEngine: 'piper' | 'xtts' | 'openvoice' = 'piper'
  private currentXTTSVoice: string | null = null  // XTTS voice ID
  private currentTTSSpeed: number = 1.0
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

  setTTSVoice(voice: string, engine?: 'piper' | 'xtts'): void {
    if (engine === 'xtts') {
      // Set XTTS voice
      this.currentXTTSVoice = voice
      this.currentTTSEngine = 'xtts'
    } else {
      // Support built-in, downloaded, and custom Piper voices
      if (this.getAnyVoicePath(voice)) {
        this.currentTTSVoice = voice
        this.currentTTSEngine = 'piper'
      }
    }
  }

  setTTSEngine(engine: 'piper' | 'xtts' | 'openvoice'): void {
    this.currentTTSEngine = engine
  }

  getCurrentEngine(): 'piper' | 'xtts' | 'openvoice' {
    return this.currentTTSEngine
  }

  setTTSSpeed(speed: number): void {
    // Clamp between 0.5 and 2.0
    this.currentTTSSpeed = Math.max(0.5, Math.min(2.0, speed))
  }

  // Speak text using the current TTS engine
  // Returns the audio data as base64
  async speak(text: string): Promise<{ success: boolean; audioData?: string; error?: string }> {
    // Route to XTTS if that's the current engine
    if (this.currentTTSEngine === 'xtts') {
      if (!this.currentXTTSVoice) {
        return { success: false, error: 'No XTTS voice selected' }
      }
      return xttsManager.speak(text, this.currentXTTSVoice)
    }

    // Use Piper TTS
    const piperPath = this.getPiperBinaryPath()
    if (!piperPath) {
      return { success: false, error: 'Piper not installed' }
    }

    // Use getAnyVoicePath to support built-in, downloaded, and custom voices
    const voicePaths = this.getAnyVoicePath(this.currentTTSVoice)
    if (!voicePaths) {
      return { success: false, error: 'Voice not installed' }
    }

    try {
      const tempDir = app.getPath('temp')
      const outputPath = path.join(tempDir, `tts_${Date.now()}.wav`)

      // Piper takes text from stdin and outputs WAV to file
      // length_scale: <1 = faster, >1 = slower. Convert from our speed (>1 = faster)
      const lengthScale = 1.0 / this.currentTTSSpeed
      const args = [
        '--model', voicePaths.model,
        '--output_file', outputPath,
        '--length_scale', lengthScale.toFixed(2)
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
    // Stop Piper process if running
    if (this.speakingProcess) {
      this.speakingProcess.kill()
      this.speakingProcess = null
    }
    // Also stop XTTS if it's speaking
    xttsManager.stopSpeaking()
  }

  // ==================== VOICE CATALOG (Browse & Download) ====================

  private voicesCatalogCache: Record<string, VoiceCatalogEntry> | null = null
  private catalogCacheTime: number = 0
  private readonly CATALOG_CACHE_DURATION = 1000 * 60 * 30 // 30 minutes

  async fetchVoicesCatalog(): Promise<VoiceCatalogEntry[]> {
    try {
      // Use cache if fresh
      const now = Date.now()
      if (this.voicesCatalogCache && (now - this.catalogCacheTime) < this.CATALOG_CACHE_DURATION) {
        return Object.values(this.voicesCatalogCache)
      }

      // Fetch from Hugging Face
      const catalog = await fetchJson<Record<string, VoiceCatalogEntry>>(VOICES_CATALOG_URL)
      this.voicesCatalogCache = catalog
      this.catalogCacheTime = now

      return Object.values(catalog)
    } catch (e: any) {
      console.error('Failed to fetch voice catalog:', e)
      // Return cached data if available, even if stale
      if (this.voicesCatalogCache) {
        return Object.values(this.voicesCatalogCache)
      }
      throw e
    }
  }

  async downloadVoiceFromCatalog(
    voiceKey: string,
    onProgress?: (status: string, percent?: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Fetch catalog if not cached
      if (!this.voicesCatalogCache) {
        await this.fetchVoicesCatalog()
      }

      const voiceEntry = this.voicesCatalogCache?.[voiceKey]
      if (!voiceEntry) {
        return { success: false, error: `Voice "${voiceKey}" not found in catalog` }
      }

      ensureDir(piperVoicesDir)

      // Find .onnx and .onnx.json files
      const files = Object.entries(voiceEntry.files)
      const onnxFile = files.find(([p]) => p.endsWith('.onnx') && !p.endsWith('.onnx.json'))
      const configFile = files.find(([p]) => p.endsWith('.onnx.json'))

      if (!onnxFile || !configFile) {
        return { success: false, error: 'Voice files not found in catalog entry' }
      }

      const [onnxPath, onnxMeta] = onnxFile
      const [configPath] = configFile

      // Construct file names and URLs
      const onnxFileName = path.basename(onnxPath)
      const configFileName = path.basename(configPath)
      const onnxUrl = `${HF_BASE_URL}/${onnxPath}`
      const configUrl = `${HF_BASE_URL}/${configPath}`

      const localOnnxPath = path.join(piperVoicesDir, onnxFileName)
      const localConfigPath = path.join(piperVoicesDir, configFileName)

      // Download model file (larger, show progress)
      const sizeMB = Math.round(onnxMeta.size_bytes / (1024 * 1024))
      onProgress?.(`Downloading ${voiceEntry.name} (${sizeMB}MB)...`, 0)

      await downloadFile(onnxUrl, localOnnxPath, (percent) => {
        onProgress?.(`Downloading voice model...`, Math.round(percent * 0.9))
      })

      // Download config file
      onProgress?.('Downloading config...', 95)
      await downloadFile(configUrl, localConfigPath)

      onProgress?.('Voice installed successfully', 100)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  getInstalledVoices(): InstalledVoice[] {
    const installed: InstalledVoice[] = []

    // Get built-in voices (from PIPER_VOICES constant)
    for (const [key, info] of Object.entries(PIPER_VOICES)) {
      const voicePath = this.getPiperVoicePath(key)
      if (voicePath) {
        installed.push({
          key,
          displayName: info.description,
          source: 'builtin',
          quality: 'medium',
          language: key.startsWith('en_US') ? 'English (US)' : 'English (UK)'
        })
      }
    }

    // Scan voices directory for downloaded voices not in PIPER_VOICES
    if (fs.existsSync(piperVoicesDir)) {
      const files = fs.readdirSync(piperVoicesDir)
      const onnxFiles = files.filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))

      for (const onnxFile of onnxFiles) {
        const key = onnxFile.replace('.onnx', '')
        // Skip if already in built-in
        if (key in PIPER_VOICES) continue

        const configFile = `${key}.onnx.json`
        if (files.includes(configFile)) {
          // Parse language from key (e.g., "de_DE-thorsten-medium" -> "German")
          const langCode = key.split('-')[0]
          const quality = key.split('-').pop() || 'medium'

          installed.push({
            key,
            displayName: key.replace(/-/g, ' ').replace(/_/g, ' '),
            source: 'downloaded',
            quality,
            language: langCode
          })
        }
      }
    }

    // Scan custom voices directory
    if (fs.existsSync(customVoicesDir)) {
      const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
      let metadata: CustomVoiceMetadata = { voices: {} }
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        } catch { /* ignore */ }
      }

      const files = fs.readdirSync(customVoicesDir)
      const onnxFiles = files.filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))

      for (const onnxFile of onnxFiles) {
        const key = `custom:${onnxFile.replace('.onnx', '')}`
        const configFile = onnxFile.replace('.onnx', '.onnx.json')
        if (files.includes(configFile)) {
          const baseKey = onnxFile.replace('.onnx', '')
          installed.push({
            key,
            displayName: metadata.voices[baseKey]?.displayName || baseKey,
            source: 'custom'
          })
        }
      }
    }

    return installed
  }

  // Get voice path for any installed voice (built-in, downloaded, or custom)
  getAnyVoicePath(voiceKey: string): { model: string; config: string } | null {
    // Check if it's a custom voice
    if (voiceKey.startsWith('custom:')) {
      const baseKey = voiceKey.replace('custom:', '')
      const modelPath = path.join(customVoicesDir, `${baseKey}.onnx`)
      const configPath = path.join(customVoicesDir, `${baseKey}.onnx.json`)
      if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
        return { model: modelPath, config: configPath }
      }
      return null
    }

    // Check built-in voices first
    const builtinPath = this.getPiperVoicePath(voiceKey)
    if (builtinPath) return builtinPath

    // Check downloaded voices
    const modelPath = path.join(piperVoicesDir, `${voiceKey}.onnx`)
    const configPath = path.join(piperVoicesDir, `${voiceKey}.onnx.json`)
    if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
      return { model: modelPath, config: configPath }
    }

    return null
  }

  // ==================== CUSTOM VOICE IMPORT ====================

  getCustomVoicesDir(): string {
    return customVoicesDir
  }

  async importCustomVoiceFiles(
    onnxPath: string,
    configPath: string,
    displayName?: string
  ): Promise<{ success: boolean; voiceKey?: string; error?: string }> {
    try {
      ensureDir(customVoicesDir)

      // Validate files exist
      if (!fs.existsSync(onnxPath)) {
        return { success: false, error: 'ONNX model file not found' }
      }
      if (!fs.existsSync(configPath)) {
        return { success: false, error: 'Config file not found' }
      }

      // Get base name from onnx file
      const baseName = path.basename(onnxPath, '.onnx')
      const destOnnx = path.join(customVoicesDir, `${baseName}.onnx`)
      const destConfig = path.join(customVoicesDir, `${baseName}.onnx.json`)

      // Copy files
      fs.copyFileSync(onnxPath, destOnnx)
      fs.copyFileSync(configPath, destConfig)

      // Update metadata
      const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
      let metadata: CustomVoiceMetadata = { voices: {} }
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        } catch { /* ignore */ }
      }

      metadata.voices[baseName] = {
        displayName: displayName || baseName,
        addedAt: Date.now()
      }

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

      return { success: true, voiceKey: `custom:${baseName}` }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  removeCustomVoice(voiceKey: string): { success: boolean; error?: string } {
    try {
      if (!voiceKey.startsWith('custom:')) {
        return { success: false, error: 'Can only remove custom voices' }
      }

      const baseName = voiceKey.replace('custom:', '')
      const onnxPath = path.join(customVoicesDir, `${baseName}.onnx`)
      const configPath = path.join(customVoicesDir, `${baseName}.onnx.json`)

      if (fs.existsSync(onnxPath)) fs.unlinkSync(onnxPath)
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)

      // Update metadata
      const metadataPath = path.join(customVoicesDir, 'custom-voices.json')
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata: CustomVoiceMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
          delete metadata.voices[baseName]
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
        } catch { /* ignore */ }
      }

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
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
      ttsSpeed: this.currentTTSSpeed,
      microphoneId: null, // Retrieved from renderer
      readBehavior: 'immediate',
      skipOnNew: false
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
    if (settings.ttsSpeed !== undefined) {
      this.setTTSSpeed(settings.ttsSpeed)
    }
  }
}

// Export singleton instance
export const voiceManager = new VoiceManager()
