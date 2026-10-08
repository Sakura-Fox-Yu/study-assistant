/* =====================================================================
 * main.js —— Electron 桌面版入口
 *
 * 把现有的网页应用（index.html + css/js）装进一个桌面窗口。
 * 运行：npm start（开发）  打包：npm run dist（生成安装包到 dist/）
 *
 * 【重要】外部源码目录（免打包更新）
 * ---------------------------------------------------------------
 * 打包后网页文件会被封进 resources/app.asar（只读），改源码不会生效。
 * 为此本入口支持「外部源码目录」：启动时优先从外部目录加载页面，
 * 外部目录不存在或缺少 index.html 时，自动回退到打包内的版本。
 *
 * 于是以后更新只需改外部目录里的文件 + 重启程序，无需重新打包。
 *
 * 外部目录的确定顺序（从高到低）：
 *   1. 环境变量 ZHUYIN_SOURCE（临时覆盖，最优先）
 *   2. 菜单里手动「选择源码目录」后写入的配置（userData/source-path.json）
 *   3. 本机默认开发目录 DEFAULT_SOURCE（见下方常量）
 *   4. 程序目录旁的 source/ 文件夹（便携场景）
 *   5. 开发时的项目根（__dirname，npm start 时天然命中）
 *
 * 以上全部落空时，回退到打包内的 app.asar 版本，保证程序不会白屏。
 * ===================================================================== */
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- 外部源码目录解析 ----------
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'source-path.json');

function readConfiguredSource() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE(), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.dir === 'string' && obj.dir) return obj.dir;
  } catch (e) { /* 首次运行没有配置文件，正常 */ }
  return null;
}

function writeConfiguredSource(dir) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify({ dir }, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

// 判断一个目录是否是「可用的应用根」：必须有 index.html
function isValidSource(dir) {
  // 必须是「非空字符串」且看起来像一个绝对路径。
  // 否则 path.join('', 'index.html') 会退化成相对路径 'index.html'，
  // 误把「当前工作目录」当成源码目录。
  if (!dir || typeof dir !== 'string' || !dir.trim()) return false;
  if (!path.isAbsolute(dir)) return false;
  try {
    return fs.statSync(path.join(dir, 'index.html')).isFile();
  } catch (e) { return false; }
}

// 【本机默认源码位置】——打包后自动指向这个开发目录，
// 于是「改这里的文件 + 重启程序」即可生效，无需重新打包。
const DEFAULT_SOURCE = 'G:\\deepseek-harness\\项目\\学习辅助器-专注节律';

// 按优先级找出可用的外部源码目录；找不到返回 null（用打包内版本）
function resolveSourceDir() {
  const candidates = [
    process.env.ZHUYIN_SOURCE,                     // 1. 环境变量（最优先，可临时覆盖）
    readConfiguredSource(),                        // 2. 用户手动选择的目录（菜单设置）
    DEFAULT_SOURCE,                                // 3. 本机默认开发目录
    path.join(path.dirname(app.getPath('exe')), 'source'), // 4. 程序旁的 source/
    __dirname,                                     // 5. 开发时的项目根（npm start）
  ];
  // 打包后 __dirname 形如 ...\resources\app.asar，此时它即打包内版本，
  // 单独判断：只有「非 asar 路径」才算有效外部目录。
  for (const c of candidates) {
    if (!isValidSource(c)) continue;
    // 打包内路径（含 app.asar）不作为外部目录
    if (c.includes('app.asar')) continue;
    return path.resolve(c);
  }
  return null;
}

// 记录本次实际使用的来源，供菜单显示
let activeSource = null;
let isExternal = false;

// 让窗口加载「当前应有的页面」（外部源码优先，回退打包内）。
// 加载前重新解析一次，因此：切换目录 / 改配置文件后，无需重启程序，
// 点「重新加载」即可生效。
function loadApp(win) {
  const external = resolveSourceDir();
  if (external) {
    activeSource = external;
    isExternal = true;
    win.loadFile(path.join(external, 'index.html'));
  } else {
    activeSource = null;
    isExternal = false;
    win.loadFile(path.join(__dirname, 'index.html'));
  }
}

// ---------- 窗口 ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 920,
    minWidth: 360,
    minHeight: 640,
    // 菜单常显：更新相关操作都在菜单里，藏起来用户找不到
    autoHideMenuBar: false,
    backgroundColor: '#0b0b0e',
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadApp(win);

  // 外链一律交给系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ---------- 应用菜单（提供「选择源码目录 / 打开源码目录 / 刷新」）----------
function buildMenu() {
  const template = [
    {
      label: '应用',
      submenu: [
        {
          label: '重新加载（应用最新源码）',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const w = BrowserWindow.getAllWindows()[0];
            if (w) loadApp(w);   // 重新解析目录，切换后无需重启程序
          },
        },
        {
          label: '选择源码目录…',
          click: async () => {
            const w = BrowserWindow.getAllWindows()[0];
            const r = await dialog.showOpenDialog(w, {
              title: '选择「专注节律」源码目录（需包含 index.html）',
              properties: ['openDirectory'],
            });
            if (r.canceled || !r.filePaths.length) return;
            const dir = r.filePaths[0];
            if (!isValidSource(dir)) {
              dialog.showMessageBox(w, {
                type: 'warning',
                message: '该目录下没有 index.html，不是有效的源码目录。',
              });
              return;
            }
            writeConfiguredSource(dir);
            activeSource = dir; isExternal = true;
            w.loadFile(path.join(dir, 'index.html'));
          },
        },
        {
          label: '在文件管理器中打开源码目录',
          click: () => {
            if (activeSource) shell.openPath(activeSource);
            else dialog.showMessageBox({
              type: 'info',
              message: '当前使用的是打包内版本，没有外部源码目录。\n可通过「选择源码目录」指定一个。',
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '强制重载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '当前数据来源',
          click: () => {
            const w = BrowserWindow.getAllWindows()[0];
            dialog.showMessageBox(w, {
              type: 'info',
              title: '当前数据来源',
              message: isExternal
                ? '正在使用外部源码目录：\n' + activeSource
                : '正在使用打包内版本（app.asar）\n\n提示：可选择外部源码目录，以后改文件即可更新，无需重新打包。',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // 解析一次，把结果打印到控制台便于排查
  const src = resolveSourceDir();
  if (src) console.log('[zhuyin] 外部源码目录:', src);
  else console.log('[zhuyin] 使用打包内版本');

  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
