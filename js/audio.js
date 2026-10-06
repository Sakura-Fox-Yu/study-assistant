/* =====================================================================
 * audio.js —— 提示音合成（Web Audio API）
 *
 * 关键设计（为了「后台也能按时响铃」）：
 *   1. schedule(type, atMs)：把提示音「提前排定」到未来的绝对时间点。
 *      浏览器后台会节流 JS 定时器，但音频时钟不受影响——声音能准时响起。
 *   2. 后台保活 startKeepAlive()：切后台时播放一段极轻的低频音，
 *      防止 AudioContext 被浏览器挂起（挂起会导致已排定的声音不响）。
 *   3. cancelScheduled()：取消还没响的排定声音（暂停/重置时用）。
 * ===================================================================== */
(function (FR) {
  'use strict';

  // 每种声音对应的音符序列。
  // 每个音：{ freq: 频率(Hz), delay: 相对该声音起点的延时(秒), dur: 时长(秒) }
  const PATTERNS = {
    restStart: [                  // 两声上行：温柔的「去休息」提示
      { freq: 659.25, delay: 0,    dur: 0.50 },   // E5
      { freq: 783.99, delay: 0.16, dur: 0.70 },   // G5
    ],
    restEnd: [                    // 一声软音：回到专注
      { freq: 587.33, delay: 0, dur: 0.45 },      // D5
    ],
    longRestStart: [              // 三声：一轮完成，去长休息
      { freq: 523.25, delay: 0,    dur: 0.50 },   // C5
      { freq: 659.25, delay: 0.18, dur: 0.50 },   // E5
      { freq: 783.99, delay: 0.36, dur: 0.90 },   // G5
    ],
  };

  let ctx = null;
  const scheduledNodes = new Set(); // 已排定、尚未结束的振荡器

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function currentVolume() {
    const s = FR.settings;
    if (!s || !s.soundOn) return 0;
    return Math.max(0.0001, Math.min(1, s.volume)) * 0.5; // 上限 0.5 防止过响
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
  function schedule(type, atMs) {
    const c = ensureCtx();
    if (!c) return;
    const pattern = PATTERNS[type];
    if (!pattern) return;
    const vol = currentVolume();
    if (vol <= 0) return;
    let startAt = c.currentTime + (atMs - Date.now()) / 1000;
    startAt = Math.max(c.currentTime + 0.01, startAt);
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
  function unlock() { ensureCtx(); }

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
