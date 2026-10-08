#!/usr/bin/env bash
# =====================================================================
# push-and-build.sh —— 等网络恢复后：推送代码 + 打包桌面版
#
# 背景：github.com 会间歇性不通（api.github.com 一直正常），
#       而 app-builder-bin 下载极慢。本脚本循环等待，网络一通就干活。
#
# 用法：bash push-and-build.sh
# 日志：写入本目录下的 push-and-build.log
# =====================================================================
set -u

PROJ="/g/deepseek-harness/项目/学习辅助器-专注节律"
LOG="$PROJ/push-and-build.log"
cd "$PROJ" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=========================================="
log "后台任务启动：等网络 → 推送 → 打包"
log "=========================================="

# ---------- 阶段 1：等 github.com 可用并推送 ----------
PUSHED=0
for i in $(seq 1 240); do   # 最多等 240 轮
  if timeout 12 curl -sS -o /dev/null --noproxy "*" https://github.com 2>/dev/null; then
    log "第 $i 轮：github.com 可达，开始推送…"
    if timeout 180 git -c http.proxy= -c https.proxy= push origin main 2>&1 | tee -a "$LOG"; then
      # 校验是否真的推上去了
      if git status -sb | head -1 | grep -q "ahead"; then
        log "推送命令返回成功但仍有 ahead，继续重试"
      else
        log "✅ 推送成功"
        PUSHED=1
        break
      fi
    else
      log "推送失败，稍后重试"
    fi
  else
    if [ $((i % 10)) -eq 0 ]; then
      log "第 $i 轮：github.com 仍不可达，继续等待…"
    fi
  fi
  sleep 20
done

if [ "$PUSHED" != "1" ]; then
  log "❌ 等待超时（约 80 分钟）仍未能推送，任务结束"
  exit 2
fi

# ---------- 阶段 2：打包 ----------
log "开始打包（npm run dist）…"
# 优先用本机 pnpm 修复过的 node_modules；直接调 electron-builder
if [ -f node_modules/.bin/electron-builder ]; then
  timeout 3600 ./node_modules/.bin/electron-builder 2>&1 | tee -a "$LOG"
  RC=$?
else
  log "找不到 electron-builder，尝试 npm run dist"
  timeout 3600 npm run dist 2>&1 | tee -a "$LOG"
  RC=$?
fi

if [ "$RC" = "0" ] && ls dist/*.exe >/dev/null 2>&1; then
  log "✅ 打包成功，产物："
  ls -la dist/*.exe 2>&1 | tee -a "$LOG"
else
  log "❌ 打包失败（exit=$RC），请查看上方日志"
fi

log "=========================================="
log "后台任务结束"
log "=========================================="
