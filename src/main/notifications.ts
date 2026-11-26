import { BrowserWindow, Notification, nativeImage } from 'electron'
import type { NotifyPayload } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let iconPath: string | null = null

export function configureNotifications(window: BrowserWindow, resourcesDir: string): void {
  mainWindow = window
  iconPath = `${resourcesDir}\\icon.png`
}

export function showNotification(payload: NotifyPayload): boolean {
  if (!Notification.isSupported()) return false
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
    silent: false
  })
  notification.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      if (payload.code) mainWindow.webContents.send('app:select-stock', payload.code)
    }
  })
  notification.show()
  return true
}
