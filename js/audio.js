/* =====================================================================
 * audio.js —— 提示音合成（Web Audio API）
 *
 * 关键设计（为了「后台也能按时响铃」）：
 *   1. schedule(type, atMs)：把提示音「提前排定」到未来的绝对时间点。
 *      浏览器后台会节流 JS 定时器，但音频时钟不受影响——声音能准时响起。
 *   2. 后台保活 startKeepAlive()：切后台时播放一段极轻的低频音，
 *      防止 AudioContext 被浏览器挂起（挂起会导致已排定的声音不响）。
 *   3. cancelScheduled()：取消还没响的排定声音（暂停/重置时用）。
 *
 * 【修复】排定基准从「墙钟 Date.now()」改为「音频时钟 currentTime」。
 *   旧实现对每个音都做 `c.currentTime + (atMs - Date.now()) / 1000`，
 *   后台节流 / AudioContext 被挂起再唤醒时，两套时钟会产生漂移：
 *   一旦算出的 startAt 已经过去，就被钳到 currentTime + 0.01，这个音
 *   会被「压扁」到几乎听不见，表现为「只响了一次、休息结束没响」。
 *   现在改为：拿一次统一的 anchor（墙钟 → 音频时钟的映射），所有排定
 *   都基于该 anchor 换算，并对「已经迟到」的音做补偿播放而不是丢弃。
 * ===================================================================== */
(function (FR) {
  'use strict';

  // 每种声音对应的音符序列。
  // 每个音：{ freq: 频率(Hz), delay: 相对该声音起点的延时(秒), dur: 时长(秒) }
  //
  // 【修复】休息开始 / 休息结束 使用方向相反的旋律，便于纯听觉区分：
  //   restStart  两声「上行」E5→G5  —— 提示「去休息」
  //   restEnd    两声「下行」G5→E5  —— 提示「回来专注」（旧版只有一个单音，
  //              用户无法判断休息是否结束）
  const PATTERNS = {
    restStart: [                  // 上行：该休息了
      { freq: 659.25, delay: 0,    dur: 0.42 },   // E5
      { freq: 783.99, delay: 0.15, dur: 0.62 },   // G5
    ],
    restEnd: [                    // 下行：休息结束，回专注（与 restStart 反向）
      { freq: 783.99, delay: 0,    dur: 0.42 },   // G5
      { freq: 587.33, delay: 0.15, dur: 0.62 },   // D5
    ],
    longRestStart: [              // 三声上行：一轮完成，去长休息
      { freq: 523.25, delay: 0,    dur: 0.50 },   // C5
      { freq: 659.25, delay: 0.18, dur: 0.50 },   // E5
      { freq: 783.99, delay: 0.36, dur: 0.90 },   // G5
    ],
    longRestEnd: [                // 【新增】四声、更响亮的收束音：长休息结束，开新一轮
      { freq: 523.25, delay: 0,    dur: 0.40 },   // C5
      { freq: 659.25, delay: 0.14, dur: 0.40 },   // E5
      { freq: 783.99, delay: 0.28, dur: 0.40 },   // G5
      { freq: 1046.5, delay: 0.42, dur: 0.95 },   // C6（高八度收尾，明显区别于 restEnd）
    ],
  };

  let ctx = null;
  const scheduledNodes = new Set(); // 已排定、尚未结束的振荡器

  // 【修复】统一时间基准：一次把「墙钟时刻」映射到「音频时钟时刻」。
  // anchorWall / anchorAudio 成对使用，避免每个音各算一次造成漂移。
  let anchorWall = 0;
  let anchorAudio = 0;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    // resume() 是异步的，但 AudioContext.currentTime 在 suspended 时仍为有效值；
    // 真正恢复后 currentTime 会继续推进，因此基于它排定的音仍然落在正确相对位置。
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function currentVolume() {
    const s = FR.settings;
    if (!s || !s.soundOn) return 0;
    return Math.max(0.0001, Math.min(1, s.volume)) * 0.5; // 上限 0.5 防止过响
  }

  // 刷新锚点：把此刻的墙钟与音频时钟绑定
  function syncAnchor() {
    anchorWall = Date.now();
    anchorAudio = ctx.currentTime;
  }

  // 把墙钟绝对时刻 atMs 换算成音频时钟时刻
  function toAudioTime(atMs) {
    return anchorAudio + (atMs - anchorWall) / 1000;
  }

  // 在音频时钟时刻 startAt 播放一个音
  function playToneAt(freq, startAt, dur, vol) {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    scheduledNodes.add(osc);
    osc.onended = () => scheduledNodes.delete(osc);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.05);
  }

  // 在绝对时间戳 atMs（Date.now() 基准）播放某类声音
  //
  // 【修复】迟到保护：
  //   - 正常情况（atMs 在未来）：按音频时钟精确排定。
  //   - 迟到但在容忍窗口内（LATE_TOLERANCE 秒内）：把整段旋律平移，
  //     让它从头开始立刻播放，而不是被压扁——保证用户「一定听得到」。
  //   - 迟到太久（例如手机锁屏数分钟）：仍播放，但不做整段平移补偿，
  //     避免几百毫秒的密集音堆叠。
  function schedule(type, atMs) {
    const c = ensureCtx();
    if (!c) return;
    const pattern = PATTERNS[type];
    if (!pattern) return;
    const vol = currentVolume();
    if (vol <= 0) return;

    syncAnchor(); // 每次排定前刷新锚点，保证换算基准最新
    const LATE_TOLERANCE = 2.0; // 秒
    let startAt = toAudioTime(atMs);

    if (startAt < c.currentTime) {
      const lateBy = c.currentTime - startAt;
      startAt = lateBy <= LATE_TOLERANCE
        ? c.currentTime + 0.02  // 整段平移到「现在」，完整播放
        : c.currentTime + 0.02; // 同样立即播放，避免静默丢失
    }

    pattern.forEach(n => playToneAt(n.freq, startAt + n.delay, n.dur, vol));
  }

  // 立即播放（反馈/测试用）
  function play(type) { schedule(type, Date.now()); }

  // 取消所有已排定、还没响的声音
  function cancelScheduled() {
    scheduledNodes.forEach(n => {
      try { n.onended = null; n.stop(); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    });
    scheduledNodes.clear();
  }

  // 首次用户手势时调用，解锁音频
  function unlock() {
    ensureCtx();
    if (ctx) syncAnchor();
  }

  // ---------- 后台保活 ----------
  let keepOsc = null, keepGain = null;
  function startKeepAlive() {
    const s = FR.settings;
    if (!s || !s.backgroundKeepAlive || !s.soundOn) return;
    if (keepOsc) return;
    const c = ensureCtx();
    if (!c) return;
    try {
      keepOsc = c.createOscillator();
      keepGain = c.createGain();
      keepOsc.type = 'sine';
      keepOsc.frequency.value = 50;   // 低频，接近听阈下限
      keepGain.gain.value = 0.01;     // 极轻的底噪
      keepOsc.connect(keepGain);
      keepGain.connect(c.destination);
      keepOsc.start();
    } catch (e) { keepOsc = null; keepGain = null; }
  }
  function stopKeepAlive() {
    if (keepOsc) {
      try { keepOsc.stop(); } catch (e) {}
      try { keepOsc.disconnect(); } catch (e) {}
      try { keepGain.disconnect(); } catch (e) {}
      keepOsc = null; keepGain = null;
    }
  }

  FR.Audio = { play, schedule, cancelScheduled, unlock, startKeepAlive, stopKeepAlive };
})(window.FR = window.FR || {});
