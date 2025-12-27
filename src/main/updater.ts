import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

let mainWindow: BrowserWindow | null = null

export function initUpdater(window: BrowserWindow) {
  mainWindow = window

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Check for updates on startup (after a short delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('Update check failed:', err.message)
    })
  }, 3000)

  // Update events
  autoUpdater.on('checking-for-update', () => {
    sendStatusToWindow('checking')
  })

  autoUpdater.on('update-available', (info) => {
    sendStatusToWindow('available', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    sendStatusToWindow('not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatusToWindow('downloading', undefined, progress.percent)
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatusToWindow('downloaded', info.version)
  })

  autoUpdater.on('error', (err) => {
    sendStatusToWindow('error', undefined, undefined, err.message)
  })
}

function sendStatusToWindow(status: string, version?: string, progress?: number, error?: string) {
  if (mainWindow) {
    mainWindow.webContents.send('updater:status', { status, version, progress, error })
  }
}

// IPC handlers
ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { success: true, version: result?.updateInfo?.version }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('updater:getVersion', () => {
  const { app } = require('electron')
  return app.getVersion()
})
