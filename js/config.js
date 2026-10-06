/* =====================================================================
 * config.js —— 默认设置与常量
 * 「专注节律 · 随机提示音专注法」学习辅助器
 *
 * 说明：所有可调参数、取值范围、阶段文案都集中在这里。
 *       想改默认值 / 范围 / 文案，改这个文件即可，不用去翻其它代码。
 * ===================================================================== */
(function (FR) {
  'use strict';

  // 默认设置（首次使用 / 点击「恢复默认」时生效）
  const DEFAULTS = {
    focusMin: 180,           // 专注期下限（秒），默认 3 分钟
    focusMax: 300,           // 专注期上限（秒），默认 5 分钟 —— 这就是「保底」
    microRest: 10,           // 微休息时长（秒）
    longCycle: 90,           // 一个学习循环时长（分钟）
    longRest: 20,            // 长休息时长（分钟）
    cycleCountsFocusOnly: false, // true=按「纯专注时长」计满一个循环；false=按「总时长(含微休息)」计
    autoNext: true,          // 长休息结束后自动进入下一轮
    soundOn: true,           // 是否播放提示音
    volume: 0.8,             // 音量 0~1
    showPityCountdown: false, // 专注时是否显示「保底进度条」
    wakeLock: true,          // 是否请求屏幕常亮
    backgroundKeepAlive: true, // 后台保活：切后台时播放极轻底噪，防止音频被挂起导致提示音不响
  };

  // 每个数字参数的取值范围（供设置面板的滑块使用）
  const LIMITS = {
    focusMin:  { min: 20,   max: 3600, step: 10,    unit: '秒'   },
    focusMax:  { min: 20,   max: 3600, step: 10,    unit: '秒'   },
    microRest: { min: 3,    max: 120,  step: 1,     unit: '秒'   },
    longCycle: { min: 10,   max: 240,  step: 5,     unit: '分钟' },
    longRest:  { min: 5,    max: 120,  step: 5,     unit: '分钟' },
    volume:    { min: 0,    max: 1,    step: 0.05,  unit: ''     },
  };

  // 各阶段的界面文案
  const PHASE_TEXT = {
    idle:      { label: '准备就绪', hint: '点击「开始」进入专注' },
    focus:     { label: '专注中',   hint: '提示音会在随机时刻响起，听到就闭眼休息 10 秒' },
    microRest: { label: '微休息',   hint: '闭眼休息，让大脑回放刚学的内容' },
    longRest:  { label: '长休息',   hint: '补充水分与钠钾，别刷手机、别打游戏' },
    paused:    { label: '已暂停',   hint: '点击「继续」恢复专注' },
  };

  FR.CONFIG = { DEFAULTS, LIMITS, PHASE_TEXT };
})(window.FR = window.FR || {});
