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
  // 结构：{ allTime: {focusSeconds, sessions, microRests},
  //         days: { 'YYYY-MM-DD': {focusSeconds, sessions, microRests} } }
  //
  // 【修复】旧版对 parsed.allTime 直接 Object.assign、对 parsed.days 不做校验，
  //   若 days 是字符串/数组/含非数字字段，后续统计会静默错乱（如 NaN 显示）。
  //   现对每个数值字段做「有限非负数」校验，非法值归零。
  function safeNum(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function sanitizeDay(d) {
    const o = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    return {
      focusSeconds: safeNum(o.focusSeconds),
      sessions: safeNum(o.sessions),
      microRests: safeNum(o.microRests),
    };
  }

  function loadStats() {
    const empty = { allTime: { focusSeconds: 0, sessions: 0, microRests: 0 }, days: {} };
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return empty;
        const days = {};
        const src = (parsed.days && typeof parsed.days === 'object' &&
                     !Array.isArray(parsed.days)) ? parsed.days : {};
        for (const k of Object.keys(src)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = sanitizeDay(src[k]);
        }
        return {
          allTime: Object.assign({}, empty.allTime, sanitizeDay(parsed.allTime)),
          days,
        };
      }
    } catch (e) {}
    return empty;
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  function dateKey(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function todayKey() { return dateKey(new Date()); }

  // 记录一次完成的学习循环（进入长休息时调用）
  function recordSessionComplete(focusSeconds, microRests) {
    const stats = loadStats();
    const k = todayKey();
    const day = stats.days[k] || { focusSeconds: 0, sessions: 0, microRests: 0 };
    day.focusSeconds += Math.round(focusSeconds);
    day.sessions += 1;
    day.microRests += microRests;
    stats.days[k] = day;
    stats.allTime.focusSeconds += Math.round(focusSeconds);
    stats.allTime.sessions += 1;
    stats.allTime.microRests += microRests;
    saveStats(stats);
    return stats;
  }

  FR.Storage = {
    loadSettings, saveSettings, loadStats, saveStats,
    recordSessionComplete, dateKey, todayKey,
  };
})(window.FR = window.FR || {});
