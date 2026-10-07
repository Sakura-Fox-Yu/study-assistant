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
 *
 * 【本次修复】
 *   A. 双轨判定：旧版 emitEndSound() 用「预测函数」决定排定哪种声音，
 *      而 advance() 用「已发生的 sessionDone()」决定实际去向，两者可能
 *      分歧（听到 restEnd 却进入长休息）。现统一为单一判据。
 *   B. 随机间隔语义：旧版提示音间隔 = 整段专注长度，focusMax 可被调到
 *      3600s 使「5 分钟保底」名存实亡。现改为专注段内随机时刻响铃，
 *      并把 focusMin/focusMax 约束在合理上限内。
 *   C. 状态持久化：新增 saveState/restoreState，刷新后可恢复本轮进度。
 * ===================================================================== */
(function (FR) {
  'use strict';

  const TICK_MS = 250;
  const STATE_KEY = 'fr.timer.v1';

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
    _soundAt: 0,              // 【新增】本阶段内「提示音响铃」的绝对时刻
  };

  function longCycleMs() { return FR.settings.longCycle * 60 * 1000; }

  // 随机专注时长（秒）：[min, max] 均匀随机，max 即「保底」
  // 【修复 B】对上限加上硬约束：不得让单段专注超过一个学习循环的合理比例，
  //          否则「保底 5 分钟」失去意义。上限取 min(focusMax, longCycle*0.6)。
  function clampFocusMax() {
    const s = FR.settings;
    const hardCap = Math.max(60, Math.round(s.longCycle * 60 * 0.6));
    return Math.min(s.focusMax, hardCap);
  }

  function randomFocus() {
    const s = FR.settings;
    const min = Math.min(s.focusMin, clampFocusMax());
    const max = clampFocusMax();
    if (max <= min) return min;
    return Math.round(min + Math.random() * (max - min));
  }

  // 当前是否已完成一个学习循环（用于真正的状态切换）
  function sessionDone() {
    const used = FR.settings.cycleCountsFocusOnly ? T._focusElapsed : T._sessionElapsed;
    return used >= longCycleMs();
  }

  // ---------- 单一判据：本阶段结束后将进入哪个阶段 ----------
  // 【修复 A】旧版有 willEndAfterFocus / willEndAfterRest 两个预测函数，
  //   分别用于「排定声音」和「实际推进」，且两者对 longRest 的判定不一致。
  //   现统一为 nextPhaseAfter(phase)，排定与实际推进共用同一结果。
  function nextPhaseAfter(phase, endedAt) {
    // endedAt 为该阶段「真正结束」的时刻，用它来推算当时的累计时长，
    // 保证排定声音时的判断与 tick() 里实际推进时的判断完全一致。
    if (phase === 'focus') {
      return sessionDoneAt(endedAt) ? 'longRest' : 'microRest';
    }
    if (phase === 'microRest') {
      return sessionDoneAt(endedAt) ? 'longRest' : 'focus';
    }
    if (phase === 'longRest') {
      return FR.settings.autoNext ? 'focus' : 'idle';
    }
    return 'idle';
  }

  // 推算「到达 endedAt 时刻」时，累计进度是否已满一个学习循环。
  // 原理：当前累计值 + 从现在(now)到 endedAt 的剩余时间。
  function sessionDoneAt(endedAt) {
    const now = Date.now();
    const extra = Math.max(0, endedAt - now);
    const base = FR.settings.cycleCountsFocusOnly ? T._focusElapsed : T._sessionElapsed;
    // 长休息期间不累加进度，因此只有非 longRest 才加 extra
    const used = T.phase === 'longRest' ? base : base + extra;
    return used >= longCycleMs();
  }

  // 把「当前阶段结束时该响的声音」提前排定（供音频层在后台准点响铃）
  function emitEndSound() {
    if (T.phase !== 'focus' && T.phase !== 'microRest' && T.phase !== 'longRest') return;

    let type;
    if (T.phase === 'focus') {
      // 专注段结束：要么去长休息，要么去微休息
      type = nextPhaseAfter('focus', T._phaseEndsAt) === 'longRest' ? 'longRestStart' : 'restStart';
    } else if (T.phase === 'microRest') {
      // 微休息结束：要么去长休息，要么回专注 —— 这是用户最关心的第二声
      type = nextPhaseAfter('microRest', T._phaseEndsAt) === 'longRest' ? 'longRestStart' : 'restEnd';
    } else {
      // 长休息结束：用专属的 longRestEnd 音，不要复用 restEnd——
      // 否则用户会把「20 分钟长休息结束」误听成「10 秒微休息结束」。
      if (!FR.settings.autoNext) return;
      type = 'longRestEnd';
    }
    emitter.emit('sound', { type, at: T._phaseEndsAt });
  }

  // ---------- 阶段切换 ----------
  function startFocus(now) {
    T.phase = 'focus';
    T._focusPeriodElapsed = 0;
    T._phaseTotal = randomFocus() * 1000;
    T._phaseEndsAt = now + T._phaseTotal;
    persist();
    emitEndSound();
    emitter.emit('phaseChange', snapshot());
  }

  function startMicroRest(now) {
    T.phase = 'microRest';
    T._microRests += 1;
    T._phaseTotal = FR.settings.microRest * 1000;
    T._phaseEndsAt = now + T._phaseTotal;
    persist();
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
    persist();
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
      persist();
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
      // 兜底：JS 计时器若被节流，可能一次跨过多个阶段终点。
      // 用 while 循环逐段推进，避免「睡过一整个微休息」时状态错乱。
      let guard = 0;
      while (now >= T._phaseEndsAt && guard++ < 20) {
        const endedAt = T._phaseEndsAt;
        // 把本次被吞掉的时长补记到累计进度里
        if (T.phase !== 'longRest') {
          const extra = Math.max(0, endedAt - (now - delta));
          T._sessionElapsed += extra;
          if (T.phase === 'focus') {
            T._focusElapsed += extra;
            T._focusPeriodElapsed += extra;
          }
        }
        T._phaseEndsAt = endedAt + 1; // 防止 advance 后仍 < now 造成死循环
        advance(now);
        // advance 会重设 _phaseEndsAt；若新终点仍早于 now，继续推
        if (T.phase === 'idle') break;
      }
      persist();
    }
    emitter.emit('tick', snapshot());
  }

  function startTimer() { stopTimer(); T._lastTick = Date.now(); T._timer = setInterval(tick, TICK_MS); }
  function stopTimer() { if (T._timer) { clearInterval(T._timer); T._timer = null; } }

  // ---------- 状态持久化（修复 C：刷新不丢进度）----------
  function persist() {
    try {
      const active = (T.phase === 'focus' || T.phase === 'microRest' ||
                      T.phase === 'longRest' || T.phase === 'paused');
      if (!active) { localStorage.removeItem(STATE_KEY); return; }
      localStorage.setItem(STATE_KEY, JSON.stringify({
        v: 1,
        phase: T.phase,
        pausedFrom: T._pausedFrom,
        phaseEndsAt: T.phase === 'paused' ? 0 : T._phaseEndsAt,
        phaseRemaining: T._phaseRemaining,
        phaseTotal: T._phaseTotal,
        sessionElapsed: T._sessionElapsed,
        focusElapsed: T._focusElapsed,
        focusPeriodElapsed: T._focusPeriodElapsed,
        microRests: T._microRests,
        cycles: T._cycles,
        savedAt: Date.now(),
      }));
    } catch (e) { /* 存储满/隐私模式，忽略 */ }
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return false;
      // 超过 12 小时的快照视为过期（例如关了电脑隔天再开）
      if (Date.now() - s.savedAt > 12 * 3600 * 1000) {
        localStorage.removeItem(STATE_KEY);
        return false;
      }

      T.phase = s.phase;
      T._pausedFrom = s.pausedFrom || null;
      T._phaseTotal = s.phaseTotal || 0;
      T._sessionElapsed = s.sessionElapsed || 0;
      T._focusElapsed = s.focusElapsed || 0;
      T._focusPeriodElapsed = s.focusPeriodElapsed || 0;
      T._microRests = s.microRests || 0;
      T._cycles = s.cycles || 0;

      if (T.phase === 'paused') {
        T._phaseRemaining = s.phaseRemaining || 0;
        T._phaseEndsAt = 0;
      } else {
        // 用绝对时间戳恢复：如果休眠期间已经越过阶段终点，
        // 恢复到「刚好到期」，下一次 tick 会正常推进。
        T._phaseEndsAt = s.phaseEndsAt || 0;
        T._phaseRemaining = 0;
      }

      if (T.phase === 'idle') return false;
      startTimer();
      // 恢复后立即重新排定本阶段剩余的声音
      if (T.phase !== 'paused') emitEndSound();
      emitter.emit('phaseChange', snapshot());
      return true;
    } catch (e) { return false; }
  }

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
      persist();
      emitter.emit('phaseChange', snapshot());
    }
  }

  function resume() {
    if (T.phase !== 'paused') return;
    T.phase = T._pausedFrom;
    T._phaseEndsAt = Date.now() + T._phaseRemaining;
    T._lastTick = Date.now();
    persist();
    emitEndSound(); // 按新的结束时间重新排定
    emitter.emit('phaseChange', snapshot());
  }

  function reset() {
    stopTimer();
    T.phase = 'idle';
    T._pausedFrom = null;
    T._sessionElapsed = 0; T._focusElapsed = 0; T._focusPeriodElapsed = 0;
    T._microRests = 0; T._cycles = 0;
    T._soundAt = 0;
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
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

  // 【修复】回前台时重新排定本阶段剩余的声音。
  //   系统休眠可能挂起 AudioContext 并丢弃已排定的音，回来后必须重排一次，
  //   否则「休息结束」这一声会丢（用户报告的「只响一次」）。
  function rescheduleSound() {
    if (T.phase !== 'focus' && T.phase !== 'microRest' && T.phase !== 'longRest') return;
    emitter.emit('soundCancel');
    emitEndSound();
  }

  FR.Timer = {
    start, pause, resume, reset, snapshot, restoreState, rescheduleSound,
    persistNow: persist,
    on: emitter.on, emit: emitter.emit,
  };
})(window.FR = window.FR || {});
