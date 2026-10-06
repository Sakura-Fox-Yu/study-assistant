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
  function loadSettings() {
    const defs = clone(FR.CONFIG.DEFAULTS);
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // 只合并已知字段，防止旧版本 / 损坏数据污染
        for (const k in defs) {
          if (typeof saved[k] === typeof defs[k]) defs[k] = saved[k];
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
  function loadStats() {
    const empty = { allTime: { focusSeconds: 0, sessions: 0, microRests: 0 }, days: {} };
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          allTime: Object.assign({}, empty.allTime, parsed.allTime),
          days: parsed.days || {},
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
