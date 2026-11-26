import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MarketDataProvider } from './data/provider'
import { FileCache } from './data/cache'
import { StateStore } from './store'
import { registerIpc } from './ipc'
import { configureNotifications } from './notifications'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let store: StateStore
let provider: MarketDataProvider

// The portable build must also work on machines without a usable D3D runtime.
app.disableHardwareAcceleration()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

function iconPath(): string {
  return join(resourcesDir(), 'icon.png')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#F6F8FB',
    title: 'A股异动雷达',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  Menu.setApplicationMenu(null)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    const screenshotPath = process.env['ASHARE_SCREENSHOT']
    if (screenshotPath) {
      setTimeout(async () => {
        try {
          await mainWindow?.webContents.executeJavaScript(`
            (() => {
              const buttons = [...document.querySelectorAll('button')];
              const demo = buttons.find((button) => button.textContent && button.textContent.includes('演示数据'));
              if (demo) demo.click();
            })()
          `)
          await new Promise((resolve) => setTimeout(resolve, 2200))
          const image = await mainWindow?.webContents.capturePage()
          if (image) await fs.writeFile(screenshotPath, image.toPNG())
        } catch {
          // Screenshot is a development convenience only.
        } finally {
          isQuitting = true
          app.quit()
        }
      }, 1800)
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get().settings.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  try {
    const image = nativeImage.createFromPath(iconPath())
    if (image.isEmpty()) return
    tray = new Tray(image.resize({ width: 16, height: 16 }))
    tray.setToolTip('A股异动雷达')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: '立即刷新',
        click: () => mainWindow?.webContents.send('app:refresh')
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ]))
    tray.on('double-click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
  } catch {
    tray = null
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.local.ashare.yidong')
  const userData = app.getPath('userData')
  store = new StateStore(join(userData, 'state.json'))
  await store.load()
  const cache = new FileCache(join(userData, 'cache'))
  provider = new MarketDataProvider(cache, () => store.get().settings)

  createWindow()
  if (!mainWindow) return
  registerIpc({ getWindow: () => mainWindow, provider, store })
  configureNotifications(mainWindow, resourcesDir())
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit()
})
