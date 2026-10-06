/* =====================================================================
 * timer.js —— 核心状态机（纯逻辑，不含 DOM、不含音频）
 *
 * 阶段(phase)：
 *   idle 准备 | focus 专注 | microRest 微休息 | longRest 长休息 | paused 暂停
 *
 * 计时原理：用绝对时间戳 Date.now() 计算剩余时间，即使后台节流，
 *           回来也能立刻校准，不会越走越偏。
 *
 * 后台提示音：进入每个阶段时，就把「本阶段结束时要响的声音」提前排定
 *   到未来的时间点（emit sound {type, at}）。这样即使 JS 被节流，声音也
 *   由音频时钟准时响起。暂停时发出 soundCancel 取消排定，恢复时重新排定。
 *
 * 事件（供 app.js 订阅）：
 *   tick            每次刷新（约 250ms），携带快照
 *   phaseChange     阶段切换
 *   sound           需要排定提示音，携带 {type, at}
 *   soundCancel     取消已排定的提示音
 *   sessionComplete 一个学习循环完成（进入长休息），携带该循环数据
 * ===================================================================== */
(function (FR) {
  'use strict';

  const TICK_MS = 250;

  function makeEmitter() {
    const map = {};
    return {
      on: (evt, fn) => { (map[evt] = map[evt] || []).push(fn); },
      emit: (evt, data) => { (map[evt] || []).forEach(fn => fn(data)); },
    };
  }
  const emitter = makeEmitter();

  const T = {
    phase: 'idle',
    _pausedFrom: null,
    _phaseEndsAt: 0,          // 当前阶段结束的绝对时间戳(ms)
    _phaseRemaining: 0,       // 暂停时保存的剩余时间(ms)
    _phaseTotal: 0,           // 当前阶段总时长(ms)
    _sessionElapsed: 0,       // 本学习循环已过去的总时长(ms，含微休息)
    _focusElapsed: 0,         // 本学习循环的纯专注时长(ms)
    _focusPeriodElapsed: 0,   // 当前这一段专注已进行多久(ms)
    _microRests: 0,
    _cycles: 0,
    _lastTick: 0,
    _timer: null,
  };

  function longCycleMs() { return FR.settings.longCycle * 60 * 1000; }

  // 随机专注时长（秒）：[min, max] 均匀随机，max 即「保底」
  function randomFocus() {
    const s = FR.settings;
    const min = Math.min(s.focusMin, s.focusMax);
    const max = Math.max(s.focusMin, s.focusMax);
    if (max <= min) return min;
    return Math.round(min + Math.random() * (max - min));
  }

  // 当前是否已完成一个学习循环（用于真正的状态切换）
  function sessionDone() {
    const used = FR.settings.cycleCountsFocusOnly ? T._focusElapsed : T._sessionElapsed;
    return used >= longCycleMs();
  }

  // 预测：再过 focusMs 毫秒专注后，是否完成本循环
  function willEndAfterFocus(focusMs) {
    const used = FR.settings.cycleCountsFocusOnly
      ? T._focusElapsed + focusMs : T._sessionElapsed + focusMs;
    return used >= longCycleMs();
  }
  // 预测：再过 restMs 毫秒休息后，是否完成本循环
  function willEndAfterRest(restMs) {
    const used = FR.settings.cycleCountsFocusOnly
      ? T._focusElapsed : T._sessionElapsed + restMs;
    return used >= longCycleMs();
  }

  // 把「当前阶段结束时该响的声音」提前排定（供音频层在后台准点响铃）
  function emitEndSound() {
    if (T.phase !== 'focus' && T.phase !== 'microRest' && T.phase !== 'longRest') return;
    let type;
    if (T.phase === 'focus') type = willEndAfterFocus(T._phaseTotal) ? 'longRestStart' : 'restStart';
    else if (T.phase === 'microRest') type = willEndAfterRest(T._phaseTotal) ? 'longRestStart' : 'restEnd';
    else { if (!FR.settings.autoNext) return; type = 'restEnd'; }
    emitter.emit('sound', { type, at: T._phaseEndsAt });
  }

  // ---------- 阶段切换 ----------
  function startFocus(now) {
    T.phase = 'focus';
    T._focusPeriodElapsed = 0;
    T._phaseTotal = randomFocus() * 1000;
    T._phaseEndsAt = now + T._phaseTotal;
    emitEndSound();
    emitter.emit('phaseChange', snapshot());
  }

  function startMicroRest(now) {
    T.phase = 'microRest';
    T._microRests += 1;
    T._phaseTotal = FR.settings.microRest * 1000;
    T._phaseEndsAt = now + T._phaseTotal;
    emitEndSound();
    emitter.emit('phaseChange', snapshot());
  }

  function startLongRest(now) {
    const focusSeconds = T._focusElapsed / 1000;
    const microRests = T._microRests;
    T.phase = 'longRest';
    T._cycles += 1;
    T._phaseTotal = FR.settings.longRest * 60 * 1000;
    T._phaseEndsAt = now + T._phaseTotal;
    T._sessionElapsed = 0;
    T._focusElapsed = 0;
    T._focusPeriodElapsed = 0;
    T._microRests = 0;
    emitEndSound();
    emitter.emit('sessionComplete', { focusSeconds, microRests, cycles: T._cycles });
    emitter.emit('phaseChange', snapshot());
  }

  function endLongRest(now) {
    if (FR.settings.autoNext) {
      startFocus(now);
    } else {
      stopTimer();
      T.phase = 'idle';
      emitter.emit('phaseChange', snapshot());
    }
  }

  // 到达当前阶段终点后，决定下一步去哪
  function advance(now) {
    if (T.phase === 'focus') {
      if (sessionDone()) startLongRest(now); else startMicroRest(now);
    } else if (T.phase === 'microRest') {
      if (sessionDone()) startLongRest(now); else startFocus(now);
    } else if (T.phase === 'longRest') {
      endLongRest(now);
    }
  }

  // ---------- 心跳 ----------
  function tick() {
    const now = Date.now();
    const delta = now - T._lastTick;
    T._lastTick = now;

    if (T.phase === 'focus' || T.phase === 'microRest' || T.phase === 'longRest') {
      if (T.phase !== 'longRest') {
        T._sessionElapsed += delta;
        if (T.phase === 'focus') {
          T._focusElapsed += delta;
          T._focusPeriodElapsed += delta;
        }
      }
      if (now >= T._phaseEndsAt) advance(now);
    }
    emitter.emit('tick', snapshot());
  }

  function startTimer() { stopTimer(); T._timer = setInterval(tick, TICK_MS); }
  function stopTimer() { if (T._timer) { clearInterval(T._timer); T._timer = null; } }

  // ---------- 对外操作 ----------
  function start() {
    if (T.phase === 'paused') { resume(); return; }
    if (T.phase !== 'idle') return;
    T._sessionElapsed = 0; T._focusElapsed = 0; T._focusPeriodElapsed = 0;
    T._microRests = 0; T._cycles = 0;
    T._lastTick = Date.now();
    startFocus(Date.now());
    startTimer();
  }

  function pause() {
    if (T.phase === 'focus' || T.phase === 'microRest' || T.phase === 'longRest') {
      T._pausedFrom = T.phase;
      T._phaseRemaining = Math.max(0, T._phaseEndsAt - Date.now());
      T.phase = 'paused';
      T._lastTick = Date.now();
      emitter.emit('soundCancel'); // 取消已排定、还没响的声音
      emitter.emit('phaseChange', snapshot());
    }
  }

  function resume() {
    if (T.phase !== 'paused') return;
    T.phase = T._pausedFrom;
    T._phaseEndsAt = Date.now() + T._phaseRemaining;
    T._lastTick = Date.now();
    emitEndSound(); // 按新的结束时间重新排定
    emitter.emit('phaseChange', snapshot());
  }

  function reset() {
    stopTimer();
    T.phase = 'idle';
    T._pausedFrom = null;
    T._sessionElapsed = 0; T._focusElapsed = 0; T._focusPeriodElapsed = 0;
    T._microRests = 0; T._cycles = 0;
    emitter.emit('soundCancel');
    emitter.emit('phaseChange', snapshot());
  }

  // ---------- 供 UI 读取的状态快照 ----------
  function snapshot() {
    const active = (T.phase === 'focus' || T.phase === 'microRest' || T.phase === 'longRest');
    const remaining = active ? Math.max(0, T._phaseEndsAt - Date.now())
                             : (T.phase === 'paused' ? T._phaseRemaining : 0);
    return {
      phase: T.phase,
      pausedFrom: T._pausedFrom,
      remainingMs: remaining,
      totalMs: T._phaseTotal,
      focusElapsedMs: T._focusElapsed,
      focusPeriodElapsedMs: T._focusPeriodElapsed,
      sessionElapsedMs: T._sessionElapsed,
      sessionTotalMs: longCycleMs(),
      cycles: T._cycles,
      microRests: T._microRests,
    };
  }

  FR.Timer = {
    start, pause, resume, reset, snapshot,
    on: emitter.on, emit: emitter.emit,
  };
})(window.FR = window.FR || {});
