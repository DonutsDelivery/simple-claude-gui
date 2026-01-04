import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { isWindows } from './platform'

const execAsync = promisify(exec)

// Directory structure
const depsDir = path.join(app.getPath('userData'), 'deps')
const xttsDir = path.join(depsDir, 'xtts')
const xttsVoicesDir = path.join(xttsDir, 'voices')
const xttsScriptPath = path.join(xttsDir, 'xtts_helper.py')

// XTTS supported languages
export const XTTS_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh-cn', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' }
] as const

export type XTTSLanguage = typeof XTTS_LANGUAGES[number]['code']

export interface XTTSVoice {
  id: string
  name: string
  language: XTTSLanguage
  referencePath: string
  createdAt: number
}

export interface XTTSStatus {
  installed: boolean
  pythonPath: string | null
  modelDownloaded: boolean
  error?: string
}

// Ensure directories exist
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Python helper script content
const XTTS_HELPER_SCRIPT = `#!/usr/bin/env python3
"""XTTS-v2 helper script for Claude Terminal"""
import sys
import json
import os

def check_installation():
    """Check if TTS library is installed"""
    try:
        import torch
        from TTS.api import TTS
        return {"installed": True, "torch_version": torch.__version__}
    except ImportError as e:
        return {"installed": False, "error": str(e)}

def speak(text, reference_audio, language, output_path):
    """Generate speech using XTTS-v2 voice cloning"""
    try:
        import torch
        from TTS.api import TTS

        device = "cuda" if torch.cuda.is_available() else "cpu"

        # Initialize TTS (downloads model on first run ~2GB)
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

        # Generate speech
        tts.tts_to_file(
            text=text,
            speaker_wav=reference_audio,
            language=language,
            file_path=output_path
        )

        return {"success": True, "path": output_path, "device": device}
    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "check":
        result = check_installation()
    elif cmd == "speak":
        if len(sys.argv) < 6:
            result = {"error": "Usage: speak <text> <reference_audio> <language> <output_path>"}
        else:
            result = speak(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        result = {"error": f"Unknown command: {cmd}"}

    print(json.dumps(result))

if __name__ == "__main__":
    main()
`

class XTTSManager {
  private pythonPath: string | null = null
  private speakingProcess: ChildProcess | null = null

  constructor() {
    this.initPythonPath()
  }

  private async initPythonPath(): Promise<void> {
    // Try to find Python
    const pythonCommands = isWindows
      ? ['python', 'python3', 'py']
      : ['python3', 'python']

    for (const cmd of pythonCommands) {
      try {
        const { stdout } = await execAsync(`${cmd} --version`)
        if (stdout.includes('Python 3')) {
          this.pythonPath = cmd
          break
        }
      } catch {
        // Try next
      }
    }
  }

  private ensureHelperScript(): void {
    ensureDir(xttsDir)
    if (!fs.existsSync(xttsScriptPath)) {
      fs.writeFileSync(xttsScriptPath, XTTS_HELPER_SCRIPT)
      if (!isWindows) {
        fs.chmodSync(xttsScriptPath, 0o755)
      }
    }
  }

  async checkInstallation(): Promise<XTTSStatus> {
    if (!this.pythonPath) {
      await this.initPythonPath()
    }

    if (!this.pythonPath) {
      return {
        installed: false,
        pythonPath: null,
        modelDownloaded: false,
        error: 'Python 3 not found. Please install Python 3.8+ to use XTTS.'
      }
    }

    this.ensureHelperScript()

    try {
      const { stdout } = await execAsync(`${this.pythonPath} "${xttsScriptPath}" check`, {
        timeout: 30000
      })
      const result = JSON.parse(stdout.trim())

      return {
        installed: result.installed,
        pythonPath: this.pythonPath,
        modelDownloaded: false, // We can't easily check this without loading the model
        error: result.error
      }
    } catch (e: any) {
      return {
        installed: false,
        pythonPath: this.pythonPath,
        modelDownloaded: false,
        error: e.message
      }
    }
  }

  async install(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
    if (!this.pythonPath) {
      return { success: false, error: 'Python 3 not found' }
    }

    try {
      onProgress?.('Installing TTS library (this may take a few minutes)...', 0)

      // Install TTS library via pip
      const pipCmd = isWindows ? 'pip' : 'pip3'

      await execAsync(`${this.pythonPath} -m pip install --upgrade pip`, { timeout: 120000 })
      onProgress?.('Upgrading pip...', 10)

      // Install TTS (this is the main package that includes XTTS)
      await execAsync(`${this.pythonPath} -m pip install TTS`, {
        timeout: 600000  // 10 minutes - it's a large package
      })
      onProgress?.('TTS library installed', 90)

      // Verify installation
      const status = await this.checkInstallation()
      if (!status.installed) {
        return { success: false, error: status.error || 'Installation verification failed' }
      }

      onProgress?.('Installation complete', 100)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async createVoice(
    audioPath: string,
    name: string,
    language: XTTSLanguage
  ): Promise<{ success: boolean; voiceId?: string; error?: string }> {
    try {
      // Validate audio file exists
      if (!fs.existsSync(audioPath)) {
        return { success: false, error: 'Audio file not found' }
      }

      // Create voice directory
      const voiceId = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
      const voiceDir = path.join(xttsVoicesDir, voiceId)
      ensureDir(voiceDir)

      // Copy reference audio
      const referencePath = path.join(voiceDir, 'reference.wav')
      fs.copyFileSync(audioPath, referencePath)

      // Save metadata
      const metadata: XTTSVoice = {
        id: voiceId,
        name,
        language,
        referencePath,
        createdAt: Date.now()
      }
      fs.writeFileSync(
        path.join(voiceDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      )

      return { success: true, voiceId }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  getVoices(): XTTSVoice[] {
    const voices: XTTSVoice[] = []

    if (!fs.existsSync(xttsVoicesDir)) {
      return voices
    }

    const dirs = fs.readdirSync(xttsVoicesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())

    for (const dir of dirs) {
      const metadataPath = path.join(xttsVoicesDir, dir.name, 'metadata.json')
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
          voices.push(metadata)
        } catch {
          // Skip invalid metadata
        }
      }
    }

    return voices.sort((a, b) => b.createdAt - a.createdAt)
  }

  getVoice(voiceId: string): XTTSVoice | null {
    const metadataPath = path.join(xttsVoicesDir, voiceId, 'metadata.json')
    if (fs.existsSync(metadataPath)) {
      try {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      } catch {
        return null
      }
    }
    return null
  }

  deleteVoice(voiceId: string): { success: boolean; error?: string } {
    try {
      const voiceDir = path.join(xttsVoicesDir, voiceId)
      if (fs.existsSync(voiceDir)) {
        fs.rmSync(voiceDir, { recursive: true })
      }
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async speak(
    text: string,
    voiceId: string,
    language?: XTTSLanguage
  ): Promise<{ success: boolean; audioData?: string; error?: string }> {
    const voice = this.getVoice(voiceId)
    if (!voice) {
      return { success: false, error: 'Voice not found' }
    }

    if (!this.pythonPath) {
      return { success: false, error: 'Python not found' }
    }

    this.ensureHelperScript()

    try {
      const tempDir = app.getPath('temp')
      const outputPath = path.join(tempDir, `xtts_${Date.now()}.wav`)
      const lang = language || voice.language

      return new Promise((resolve) => {
        const args = [
          xttsScriptPath,
          'speak',
          text,
          voice.referencePath,
          lang,
          outputPath
        ]

        const proc = spawn(this.pythonPath!, args)
        this.speakingProcess = proc

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          this.speakingProcess = null

          if (code === 0 && fs.existsSync(outputPath)) {
            try {
              const result = JSON.parse(stdout.trim())
              if (result.success) {
                const audioBuffer = fs.readFileSync(outputPath)
                const audioData = audioBuffer.toString('base64')
                fs.unlinkSync(outputPath)
                resolve({ success: true, audioData })
              } else {
                resolve({ success: false, error: result.error })
              }
            } catch {
              // If we can't parse JSON but file exists, still return it
              if (fs.existsSync(outputPath)) {
                const audioBuffer = fs.readFileSync(outputPath)
                const audioData = audioBuffer.toString('base64')
                fs.unlinkSync(outputPath)
                resolve({ success: true, audioData })
              } else {
                resolve({ success: false, error: stderr || 'Unknown error' })
              }
            }
          } else {
            resolve({ success: false, error: stderr || `Process exited with code ${code}` })
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

  getVoicesDir(): string {
    return xttsVoicesDir
  }
}

// Export singleton instance
export const xttsManager = new XTTSManager()
