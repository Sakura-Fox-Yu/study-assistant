# 专注节律 · 随机提示音专注法

一个网页版「学习辅助器」，把「随机提示音专注法」做成了可用的工具：

- 专注期间，提示音会在 **3~5 分钟内的随机时刻**响起（不可预测，但有 5 分钟保底）。
- 听到提示音 → 闭眼休息 **10 秒** → 休息结束时**第二声提示音**响起 → 继续，如此循环。
  （两声提示音旋律方向相反：进入休息是上行，休息结束是下行，可纯凭听觉区分。）
- 约 **90 分钟**后进入 **20 分钟**长休息，之后自动下一轮。
- 纯前端、零依赖、无服务器，数据只存在你自己的浏览器里。
- **计时进度会自动保存**：误刷新 / 重开页面可恢复本轮进度（12 小时内的快照有效）。

## 快速开始

双击 `index.html` 用浏览器打开即可（无需安装任何东西）。

推荐用现代浏览器（Chrome / Edge / Safari / Firefox 均可）。手机浏览器可「添加到主屏」获得接近 App 的体验。

> 提示：提示音依赖浏览器音频，首次点「开始」后才会出声（浏览器规定必须由用户手势解锁音频）。

## 部署上线（获得「可安装 + 离线 + 分享链接」）

Service Worker 只能在 http(s) 下生效，想用上「安装成 App / 离线」能力，需要把它放到一个网址下。三种方式任选：

**方式一：本地预览（最快）**
```bash
# 在本仓库根目录运行（二选一）
npx serve study-assistant
python -m http.server 8000 --directory study-assistant
```
然后浏览器打开 `http://localhost:8000`，Chrome / Edge 地址栏会出现「安装」图标。

**方式二：GitHub Pages（免费，推荐）**
1. 把 `study-assistant/` 整个文件夹推到一个 GitHub 仓库（放到仓库根目录即可）。
2. 仓库 `Settings → Pages → Source` 选 `main` 分支根目录，保存。
3. 几分钟后得到 `https://你的用户名.github.io/仓库名/` 链接，打开即可安装使用。

**方式三：Vercel / Netlify（免费，拖拽即可）**
- Vercel：在 vercel.com 把 `study-assistant/` 文件夹拖进「New Project」。
- Netlify：netlify.com 的「Deploy manually」直接把 `study-assistant/` 文件夹拖进去。

部署后，浏览器里的「安装 / 添加到主屏」即可离线使用。

## 桌面版（Electron）

已内置 Electron 外壳，可打包成 Windows `.exe` / macOS `.dmg` / Linux `.AppImage` 桌面应用（双击运行，不依赖浏览器）：

```bash
# 在本目录（study-assistant/）内，先安装依赖（只需一次）
pnpm install        # 或 npm install
# 本地运行桌面版
pnpm start          # 或 npm start
# 打包安装包（输出到 dist/）
pnpm run dist       # 或 npm run dist
```

> 打包需联网下载 Electron 运行时（约 100MB）。Windows 下生成 `.exe`（NSIS 安装包）；macOS 下生成 `.dmg`（需在 macOS 上打包）；Linux 下生成 `.AppImage`。桌面版没有浏览器的后台节流问题。

> 国内网络下载 Electron 慢，可先设镜像再安装（Windows PowerShell）：
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> pnpm install
> ```

> ⚠️ **Windows 打包若报 `Cannot create symbolic link`**：winCodeSign 工具包内含 macOS 符号链接，Windows 需要符号链接权限。请先开启「开发者模式」（Windows 设置 → 隐私和安全性 → 开发者选项 → 开发人员模式 打开），再重新 `pnpm run dist`。临时规避办法是在 `build.win` 里加 `"signAndEditExecutable": false`（可出包，但 exe 会丢失自定义图标）。

> 本项目已内置 `pnpm-workspace.yaml`（允许 electron 的安装脚本），使用 pnpm 10+ 时无需手动 `pnpm approve-builds`。

### 桌面版更新：不用重新打包

桌面版打包后，网页文件会被封进 `resources/app.asar`（只读），改源码不生效——
本来每次更新都得重新打包。为此 `main.js` 支持**外部源码目录**：

启动时按以下顺序找一个「含 index.html 的目录」，找到就用它，找不到才用打包内的版本：

1. 环境变量 `ZHUYIN_SOURCE`
2. 菜单「应用 → 选择源码目录…」选过的目录（存在用户配置里）
3. 程序内置的默认开发目录（常量 `DEFAULT_SOURCE`，见 `main.js`）
4. 程序目录旁的 `source/` 文件夹
5. 开发时的项目根（`npm start` 时天然命中）

**于是更新流程变成**：改外部目录里的 `index.html` / `css/` / `js/` → 重启程序（或按
`Ctrl+R` / 菜单「重新加载」）即可生效，**无需重新打包**。

菜单里还有：
- **重新加载（应用最新源码）**：`Ctrl+R`，重新解析目录并刷新页面
- **选择源码目录…**：换一个源码目录（会记住，下次自动用它）
- **在文件管理器中打开源码目录**：快速定位当前用的那份
- **帮助 → 当前数据来源**：查看现在用的是外部目录还是打包内版本

> 外部目录不存在时自动回退到打包内版本（程序不会白屏），所以这套机制对
> 「拷给别人用」也没有副作用——别人装完没有外部目录，用的就是打包内的稳定版。

## 使用流程

1. 点「**开始**」进入专注（切后台也会继续计时、按时响铃）。
2. 提示音响起 → 闭眼休息 10 秒，让大脑回放刚学内容。
3. 10 秒后提示音再次响起 → 回到专注。
4. 约 90 分钟后进入 20 分钟长休息，之后自动继续。

右上角可查看「**方法**」说明、「**统计**」数据、「**设置**」参数。

**关于「重置」**：重置只重置当前这轮计时，**不会丢弃你已经专注的时长**——那段时间会
记入统计并标记为「未完成」。统计里每条记录右侧都有 ✕，可以随时删掉记错的那条；
「统计」面板底部另有「清空所有统计数据」（需二次确认），用来彻底清空历史。

## 目录结构 & 代码导读（学习路线）

```
study-assistant/
├── index.html        页面骨架 + 三个模态框（设置/统计/方法）
├── manifest.json     PWA 安装清单
├── sw.js             Service Worker（离线缓存）
├── icon.svg          图标（SVG）
├── preview.png       界面预览图
├── package.json      Electron 桌面版依赖与打包配置
├── main.js           Electron 桌面版入口
├── css/
│   └── style.css     样式（暗色主题，改 :root 变量即可换配色）
├── js/
│   ├── config.js     默认设置、参数范围、阶段文案（改参数看这里）
│   ├── audio.js      提示音合成（Web Audio，无需音频文件）
│   ├── storage.js    本地持久化（localStorage：设置 + 统计）
│   ├── timer.js      核心状态机（纯逻辑，最值得精读）
│   └── app.js        UI 层（渲染、事件、常亮、后台保活）
├── icons/            PWA PNG 图标（192/512/maskable/apple）
└── README.md         本文件
```

**建议的阅读顺序**：`config.js` → `timer.js`（核心）→ `app.js` → `storage.js` / `audio.js`。

## 方法 → 代码 的映射

| 方法要点 | 代码位置 |
| --- | --- |
| 随机专注期（3~5 分钟） | `timer.js` 的 `randomFocus()` |
| 保底机制（到点必响） | `randomFocus()` 的 `clampFocusMax()`（上限还会受学习循环 60% 约束） |
| 10 秒微休息 | `timer.js` 的 `startMicroRest()` |
| 休息开始 / 结束两声提示音 | `audio.js` 的 `PATTERNS.restStart` / `PATTERNS.restEnd`（旋律方向相反） |
| 90 分钟长循环 + 20 分钟长休息 | `timer.js` 的 `sessionDone()` / `startLongRest()` |
| 后台继续计时 + 按时响铃 | `timer.js` 以 `_phaseEndsAt` 统一排定 + `audio.js` 的 `schedule()`（音频时钟基准 + 迟到保护） |
| 屏幕常亮 | `app.js` 的 `requestWakeLock()` |
| 进度持久化（刷新可恢复） | `timer.js` 的 `persist()` / `restoreState()` |
| 重置时结算本轮时长 | `timer.js` 的 `reset()` → `sessionSettled` 事件 → `app.js` 落库 |
| 统计明细与单条删除 | `storage.js` 的 `getRecords` / `deleteRecord` / `summarize` |
| 数据持久化 | `storage.js`（含数值范围钳制、类型校验、旧结构自动迁移） |
| 桌面版免打包更新 | `main.js` 的 `resolveSourceDir()` / `loadApp()`（外部源码目录优先，回退 app.asar） |

## 已知限制

- **后台限制**：后台会继续计时，提示音靠「提前排定 + 后台保活」尽量准时；但个别浏览器对长时间隐藏的页面仍可能强制省电节流，导致极少数情况下后台不响（这是浏览器的省电机制，网页版无法 100% 绕过，可保持页面在前台来规避）。
- **屏幕常亮**：`Wake Lock` 在 iOS Safari 支持不完整，个别环境会静默失效。
- **PWA 离线**：Service Worker 只在 http(s) 下生效，直接双击 `index.html`（`file://`）时无法离线/安装；部署后即可（见「部署上线」）。

## 后续扩展路线（为整合预留）

代码已按「逻辑层（timer.js）与 UI 层（app.js）分离、设置/统计独立」组织，方便加功能：

1. **整合笔记 / 单词卡**：在专注/微休息界面挂一个卡片模块，休息时展示要回顾的卡片。
2. **学习计划**：在 `storage.js` 增加计划数据结构，配合 `sessionComplete` 事件做每日目标打卡。
3. **自定义提示音**：在 `audio.js` 增加「上传音频文件」分支即可。
4. **推送通知**：接入 Web Push，在长休息结束时提醒。
