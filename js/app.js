/* =====================================================================
 * app.js —— UI 层（DOM 渲染 + 事件 + 屏幕常亮 + 后台暂停）
 *
 * 职责：把 timer.js 的状态「画」到页面上，处理用户点击、设置、统计、
 *       屏幕常亮(Wake Lock)、切后台自动暂停等浏览器相关能力。
 * ===================================================================== */
(function (FR) {
  'use strict';

  const Timer = FR.Timer;
  const Storage = FR.Storage;
  const $ = id => document.getElementById(id);

  // 读取设置（放在最前面，保证任何地方都能用到 FR.settings）
  FR.settings = Storage.loadSettings();

  const el = {
    phaseBadge: $('phase-badge'),
    time: $('time'),
    timeSub: $('time-sub'),
    hint: $('hint'),
    ringFill: $('ring-fill'),
    pity: $('pity'),
    pityMax: $('pity-max'),
    pityFill: $('pity-fill'),
    btnMain: $('btn-main'),
    btnReset: $('btn-reset'),
    mFocus: $('m-focus'),
    mSession: $('m-session'),
    mCycles: $('m-cycles'),
    mToday: $('m-today'),
    toasts: $('toasts'),
  };

  // 圆环周长（SVG r=106）
  const RING_CIRC = 2 * Math.PI * 106;
  el.ringFill.style.strokeDasharray = RING_CIRC.toFixed(2);

  // ---------- 工具函数 ----------
  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + p(m) + ':' + p(sec) : p(m) + ':' + p(sec);
  }

  function fmtMinutes(seconds) {
    const mins = seconds / 60;
    return mins < 10 ? mins.toFixed(1) + '分' : Math.round(mins) + '分';
  }

  function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    el.toasts.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 320); }, 3200);
  }

  // ---------- 渲染 ----------
  function render(snap) {
    const info = FR.CONFIG.PHASE_TEXT[snap.phase];
    el.phaseBadge.textContent = info.label;
    el.hint.textContent = info.hint;
    document.body.dataset.phase = snap.phase; // 切换主题强调色

    let progress = 0, timeText = '00:00', subText = '专注时长';
    const total = snap.totalMs;

    if (snap.phase === 'focus') {
      // 专注期：显示「累计专注时长」，跨休息连续累计，不再每段归零
      timeText = fmt(snap.focusElapsedMs);
      subText = '累计专注';
      // 圆环显示「循环进度」（离 90 分钟还有多远）
      progress = snap.sessionTotalMs > 0 ? snap.sessionElapsedMs / snap.sessionTotalMs : 0;
      // 保底进度条：向「专注期上限」推进，不代表确切响铃时间
      el.pity.hidden = !FR.settings.showPityCountdown;
      if (!el.pity.hidden) {
        const maxMs = FR.settings.focusMax * 1000;
        el.pityMax.textContent = fmt(maxMs);
        el.pityFill.style.width = Math.min(100, snap.focusPeriodElapsedMs / maxMs * 100).toFixed(1) + '%';
      }
    } else if (snap.phase === 'microRest' || snap.phase === 'longRest' || snap.phase === 'paused') {
      // 休息/暂停：时间向下倒数
      timeText = fmt(snap.remainingMs);
      subText = snap.phase === 'microRest' ? '闭眼休息' : snap.phase === 'longRest' ? '长休息' : '已暂停';
      progress = total > 0 ? (total - snap.remainingMs) / total : 0;
      el.pity.hidden = true;
    } else {
      progress = 0;
      el.pity.hidden = true;
    }

    el.time.textContent = timeText;
    el.timeSub.textContent = subText;
    el.ringFill.style.strokeDashoffset = (RING_CIRC * (1 - Math.min(1, Math.max(0, progress)))).toFixed(2);

    el.btnMain.textContent = snap.phase === 'paused' ? '继续'
                           : snap.phase === 'idle' ? '开始' : '暂停';

    // 底部指标
    el.mFocus.textContent = fmt(snap.focusPeriodElapsedMs);
    el.mSession.textContent = Math.min(100, Math.round(snap.sessionElapsedMs / snap.sessionTotalMs * 100)) + '%';
    el.mCycles.textContent = String(snap.cycles);

    // 今日专注 = 已记录的今日 + 本轮尚未记入的实时专注
    const stats = Storage.loadStats();
    const today = stats.days[Storage.todayKey()] || { focusSeconds: 0 };
    el.mToday.textContent = fmtMinutes(today.focusSeconds + Math.round(snap.focusElapsedMs / 1000));
  }

  // ---------- 定时器事件 ----------
  Timer.on('tick', render);
  Timer.on('phaseChange', render);
  Timer.on('sound', ({ type, at }) => FR.Audio.schedule(type, at));
  Timer.on('soundCancel', () => FR.Audio.cancelScheduled());
  Timer.on('sessionComplete', d => {
    Storage.recordSessionComplete(d.focusSeconds, d.microRests);
    toast('完成第 ' + d.cycles + ' 个学习循环！进入 ' + FR.settings.longRest + ' 分钟长休息');
  });

  // ---------- 按钮 ----------
  el.btnMain.addEventListener('click', () => {
    FR.Audio.unlock(); // 解锁音频（浏览器要求用户手势后才能出声）
    const p = Timer.snapshot().phase;
    if (p === 'idle' || p === 'paused') { Timer.start(); requestWakeLock(); }
    else { Timer.pause(); releaseWakeLock(); FR.Audio.stopKeepAlive(); }
  });

  el.btnReset.addEventListener('click', () => {
    Timer.reset();
    releaseWakeLock();
    FR.Audio.stopKeepAlive();
    toast('已重置');
  });

  // ---------- 屏幕常亮（Wake Lock） ----------
  let wakeLock = null;
  async function requestWakeLock() {
    if (!FR.settings || !FR.settings.wakeLock) return;
    if (!('wakeLock' in navigator)) return; // 不支持的环境直接跳过
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* 某些浏览器/环境会拒绝，忽略即可 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }

  // ---------- 后台不暂停：保持计时与提示音在后台继续工作 ----------
  // 切后台时开启「保活音」防止 AudioContext 被挂起，回到前台再关掉。
  function isTiming() {
    const p = Timer.snapshot().phase;
    return p === 'focus' || p === 'microRest' || p === 'longRest';
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (isTiming()) FR.Audio.startKeepAlive();
    } else {
      FR.Audio.stopKeepAlive();
      if (FR.settings && FR.settings.wakeLock) requestWakeLock();
    }
  });

  // ---------- 设置面板 ----------
  const NUMERIC = [
    { key: 'focusMin', label: '专注期下限' },
    { key: 'focusMax', label: '专注期上限（保底）' },
    { key: 'microRest', label: '微休息时长' },
    { key: 'longCycle', label: '学习循环时长' },
    { key: 'longRest', label: '长休息时长' },
    { key: 'volume', label: '音量' },
  ];
  const TOGGLES = [
    { key: 'soundOn', label: '播放提示音' },
    { key: 'autoNext', label: '长休息后自动进入下一轮' },
    { key: 'cycleCountsFocusOnly', label: '循环按「纯专注时长」计算' },
    { key: 'showPityCountdown', label: '显示保底进度条' },
    { key: 'wakeLock', label: '请求屏幕常亮' },
    { key: 'backgroundKeepAlive', label: '后台保活（防提示音不响）' },
  ];

  function formatValue(key, v) {
    if (key === 'volume') return Math.round(v * 100) + '%';
    const unit = FR.CONFIG.LIMITS[key].unit;
    return unit === '分钟' ? v + ' 分钟' : fmt(v * 1000);
  }

  function buildSettings() {
    const numBox = $('settings-numeric');
    numBox.innerHTML = '';
    NUMERIC.forEach(f => {
      const lim = FR.CONFIG.LIMITS[f.key];
      const row = document.createElement('div');
      row.className = 'field';
      row.innerHTML =
        '<div class="field-head"><label>' + f.label + '</label>' +
        '<span class="field-val" data-val="' + f.key + '"></span></div>' +
        '<input type="range" data-key="' + f.key + '" min="' + lim.min + '" max="' + lim.max + '" step="' + lim.step + '">';
      numBox.appendChild(row);
    });

    const togBox = $('settings-toggles');
    togBox.innerHTML = '';
    TOGGLES.forEach(f => {
      const row = document.createElement('label');
      row.className = 'toggle-row';
      row.innerHTML = '<span>' + f.label + '</span><input type="checkbox" data-key="' + f.key + '">';
      togBox.appendChild(row);
    });

    numBox.querySelectorAll('input[type="range"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.key;
        FR.settings[key] = Number(inp.value);
        numBox.querySelector('[data-val="' + key + '"]').textContent = formatValue(key, FR.settings[key]);
        Storage.saveSettings(FR.settings);
        render(Timer.snapshot());
      });
    });
    togBox.querySelectorAll('input[type="checkbox"]').forEach(inp => {
      inp.addEventListener('change', () => {
        const key = inp.dataset.key;
        FR.settings[key] = inp.checked;
        Storage.saveSettings(FR.settings);
        render(Timer.snapshot());
      });
    });
  }

  function renderSettings() {
    document.querySelectorAll('#settings-numeric input[type="range"]').forEach(inp => {
      inp.value = FR.settings[inp.dataset.key];
      document.querySelector('#settings-numeric [data-val="' + inp.dataset.key + '"]').textContent =
        formatValue(inp.dataset.key, FR.settings[inp.dataset.key]);
    });
    document.querySelectorAll('#settings-toggles input[type="checkbox"]').forEach(inp => {
      inp.checked = !!FR.settings[inp.dataset.key];
    });
  }

  // ---------- 统计面板 ----------
  function renderStats() {
    const stats = Storage.loadStats();
    const today = stats.days[Storage.todayKey()] || { focusSeconds: 0, sessions: 0, microRests: 0 };
    const live = Timer.snapshot();
    const todayFocus = today.focusSeconds + Math.round(live.focusElapsedMs / 1000);

    $('st-today-focus').textContent = fmtMinutes(todayFocus);
    $('st-today-sessions').textContent = today.sessions;
    $('st-today-micro').textContent = today.microRests;
    $('st-all-focus').textContent = fmtMinutes(stats.allTime.focusSeconds);
    $('st-all-sessions').textContent = stats.allTime.sessions;

    const list = $('st-history');
    list.innerHTML = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const k = Storage.dateKey(d);
      const day = stats.days[k] || { focusSeconds: 0, sessions: 0 };
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = '<span>' + (i === 0 ? '今天' : k.slice(5)) + '</span>' +
        '<span>' + fmtMinutes(day.focusSeconds) + '</span><span>' + day.sessions + ' 循环</span>';
      list.appendChild(row);
    }
  }

  // ---------- 模态框 ----------
  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(id) { document.getElementById(id).hidden = true; }

  function bindModals() {
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
    });
    document.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => closeModal(b.getAttribute('data-close')));
    });
  }

  // ---------- 初始化 ----------
  function init() {
    buildSettings();
    renderSettings();
    bindModals();

    $('btn-settings').addEventListener('click', () => { renderSettings(); openModal('modal-settings'); });
    $('btn-stats').addEventListener('click', () => { renderStats(); openModal('modal-stats'); });
    $('btn-help').addEventListener('click', () => openModal('modal-help'));
    $('btn-defaults').addEventListener('click', () => {
      FR.settings = Object.assign({}, FR.CONFIG.DEFAULTS);
      Storage.saveSettings(FR.settings);
      renderSettings();
      render(Timer.snapshot());
      toast('已恢复默认设置');
    });

    render(Timer.snapshot());
  }

  init();

  // 演示模式：URL 带 ?demo=1 时自动开始计时（用于截图 / 作品集演示）
  if (/[?&]demo=1/.test(location.search)) {
    setTimeout(() => {
      if (Timer.snapshot().phase === 'idle') { FR.Audio.unlock(); Timer.start(); requestWakeLock(); }
    }, 500);
  }

  // 注册 Service Worker（离线 + 可安装；需 http(s)，file:// 下自动跳过）
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})(window.FR = window.FR || {});
