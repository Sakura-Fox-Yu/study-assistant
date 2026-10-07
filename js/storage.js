/* =====================================================================
 * storage.js —— 本地持久化（localStorage）
 *
 * 负责两件事：
 *   1. 设置（settings）：用户调的参数，关掉重开还在
 *   2. 统计（stats）：每天的专注时长 / 完成循环数 / 微休息次数
 *
 * 说明：纯前端、无服务器，数据只存在你自己的浏览器里。
 * ===================================================================== */
(function (FR) {
  'use strict';

  const SETTINGS_KEY = 'fr.settings.v1';
  const STATS_KEY    = 'fr.stats.v1';

  // 单条记录的最短时长：低于此值视为误触，不入库。
  // 10 秒——足够挡掉手滑连点，又不会误杀「我就认真学了半分钟」这种真实记录。
  const MIN_SECONDS = 10;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- 设置 ----------
  // 【修复】旧版只做 typeof 比对，未做范围钳制——手动改 localStorage 或旧版
  //   遗留的越界值（如 focusMin:-1 / volume:99）会直接进入计时器，导致行为
  //   不可预期。现按 CONFIG.LIMITS 对每个数字字段做 min/max 钳制。
  function clampNumber(v, lim, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.min(lim.max, Math.max(lim.min, n));
  }

  function loadSettings() {
    const defs = clone(FR.CONFIG.DEFAULTS);
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object') return defs;
        // 只合并已知字段，防止旧版本 / 损坏数据污染
        for (const k in defs) {
          if (typeof saved[k] !== typeof defs[k]) continue;
          if (typeof defs[k] === 'number') {
            const lim = FR.CONFIG.LIMITS[k];
            defs[k] = lim ? clampNumber(saved[k], lim, defs[k]) : saved[k];
          } else if (typeof defs[k] === 'boolean') {
            defs[k] = !!saved[k];
          } else {
            defs[k] = saved[k];
          }
        }
      }
    } catch (e) { /* 数据损坏时回退到默认值 */ }
    return defs;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // ---------- 统计 ----------
  // 【重构】旧结构是「聚合计数器」，无法删除单条记录：
  //   { allTime:{...}, days:{ 'YYYY-MM-DD': {focusSeconds, sessions, microRests} } }
  //   问题：重置中途的会话会被静默吞掉；误触留下的记录也没法清理。
  //   现改为「明细记录列表」，每条可单独删除，聚合值从明细实时算出：
  //   { records: [ { id, date, at, seconds, kind, microRests, cycles } ] }
  //   kind: 'complete'（跑满一个学习循环）| 'partial'（中途重置的半截记录）
  function safeNum(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function makeId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function sanitizeRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    if (!date) return null;
    const seconds = Math.round(safeNum(r.seconds));
    // 低于 MIN_SECONDS 的视为误触（例如手滑点了一下按钮），不入库。
    // 用户明确表示「真觉得记错了会自己删」，所以阈值只挡掉明显的误碰，
    // 不替用户判断「多久才算有效学习」——那由用户自己在记录列表里删。
    if (seconds < MIN_SECONDS) return null;
    return {
      id: typeof r.id === 'string' && r.id ? r.id : makeId(),
      date,
      at: safeNum(r.at) || Date.parse(date + 'T12:00:00') || Date.now(),
      seconds,
      kind: r.kind === 'partial' ? 'partial' : 'complete',
      microRests: Math.round(safeNum(r.microRests)),
      cycles: Math.max(1, Math.round(safeNum(r.cycles) || 1)),
    };
  }

  // 把旧的聚合结构迁移成明细记录。
  // 旧数据只有「按天汇总」，无法还原每次会话的边界，因此每天合成一条记录：
  //   完整循环时长 = (focusSeconds - 未完成部分，旧数据无此信息) → 全部视为 complete。
  // 迁移只做一次，写回后即成为新结构。
  function migrateLegacy(parsed) {
    const records = [];
    const days = (parsed.days && typeof parsed.days === 'object' && !Array.isArray(parsed.days))
      ? parsed.days : {};
    for (const k of Object.keys(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const d = days[k] || {};
      const secs = Math.round(safeNum(d.focusSeconds));
      if (secs <= 0) continue;
      records.push({
        id: makeId(),
        date: k,
        at: Date.parse(k + 'T12:00:00') || Date.now(),
        seconds: secs,
        kind: 'complete',
        microRests: Math.round(safeNum(d.microRests)),
        cycles: Math.max(1, Math.round(safeNum(d.sessions) || 1)),
      });
    }
    return { records };
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // 已是新结构
          if (Array.isArray(parsed.records)) {
            const records = parsed.records.map(sanitizeRecord).filter(Boolean);
            return { records };
          }
          // 旧结构 → 迁移并写回
          if (parsed.days || parsed.allTime) {
            const migrated = migrateLegacy(parsed);
            saveStats(migrated);
            return migrated;
          }
        }
      }
    } catch (e) {}
    return { records: [] };
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  function dateKey(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function todayKey() { return dateKey(new Date()); }

  // ---------- 从明细汇总 ----------
  // allTime / 按天数据全部由 records 实时算出，删掉任意一条，总数自动跟着变，
  // 不会出现「总数与明细对不上账」的情况。
  function summarize(records) {
    const allTime = { focusSeconds: 0, sessions: 0, partials: 0, partialSeconds: 0, microRests: 0 };
    const days = {};
    for (const r of records) {
      allTime.focusSeconds += r.seconds;
      allTime.microRests += r.microRests;
      if (r.kind === 'partial') {
        allTime.partials += 1;
        allTime.partialSeconds += r.seconds;
      } else {
        allTime.sessions += r.cycles;
      }
      const day = days[r.date] || {
        focusSeconds: 0, sessions: 0, partials: 0, partialSeconds: 0, microRests: 0,
      };
      day.focusSeconds += r.seconds;
      day.microRests += r.microRests;
      if (r.kind === 'partial') {
        day.partials += 1;
        day.partialSeconds += r.seconds;
      } else {
        day.sessions += r.cycles;
      }
      days[r.date] = day;
    }
    return { allTime, days };
  }

  // 查询接口：供 UI 渲染
  function getRecords() {
    const { records } = loadStats();
    // 按时间倒序，最新的在前
    return records.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  function getSummary() {
    const { records } = loadStats();
    return summarize(records);
  }

  function getToday() {
    const s = getSummary();
    return s.days[todayKey()] || {
      focusSeconds: 0, sessions: 0, partials: 0, partialSeconds: 0, microRests: 0,
    };
  }

  // ---------- 写入 ----------
  function addRecord(rec) {
    const stats = loadStats();
    const clean = sanitizeRecord(Object.assign({ id: makeId(), date: todayKey(), at: Date.now() }, rec));
    if (!clean) return getSummary();
    stats.records.push(clean);
    saveStats(stats);
    return summarize(stats.records);
  }

  // 记录一次完成的学习循环（进入长休息时调用）
  function recordSessionComplete(focusSeconds, microRests, cycles) {
    return addRecord({
      seconds: Math.round(focusSeconds),
      microRests,
      cycles: cycles || 1,
      kind: 'complete',
    });
  }

  // 记录一段「中途重置」的半截专注
  function recordPartial(focusSeconds, microRests) {
    return addRecord({
      seconds: Math.round(focusSeconds),
      microRests,
      cycles: 0,
      kind: 'partial',
    });
  }

  // 删除单条记录；返回删除后的汇总
  function deleteRecord(id) {
    const stats = loadStats();
    stats.records = stats.records.filter(r => r.id !== id);
    saveStats(stats);
    return summarize(stats.records);
  }

  // 清空所有统计数据（带二次确认由 UI 负责）
  function clearAll() {
    saveStats({ records: [] });
    return { allTime: { focusSeconds: 0, sessions: 0, partials: 0, partialSeconds: 0, microRests: 0 }, days: {} };
  }

  FR.Storage = {
    loadSettings, saveSettings,
    loadStats, saveStats, summarize,
    getRecords, getSummary, getToday,
    recordSessionComplete, recordPartial, deleteRecord, clearAll,
    dateKey, todayKey,
  };
})(window.FR = window.FR || {});
