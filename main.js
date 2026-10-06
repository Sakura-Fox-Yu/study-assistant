/* =====================================================================
 * main.js —— Electron 桌面版入口
 *
 * 把现有的网页应用（index.html + css/js）装进一个桌面窗口。
 * 运行：npm start（开发）  打包：npm run dist（生成安装包到 dist/）
 * ===================================================================== */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 920,
    minWidth: 360,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0e',
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // 外链一律交给系统浏览器打开（当前应用没有外链，这里只是保险）
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
