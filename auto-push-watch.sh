#!/usr/bin/env bash
# 后台自动推送：轮询 github.com，通了就直连 push。
# 用法：bash auto-push-watch.sh
set -u
cd "/g/deepseek-harness/项目/学习辅助器-专注节律" || exit 1

LOG="auto-push.log"
MAX=360          # 最多轮询 360 次
INTERVAL=20      # 每次间隔 20 秒 → 最长约 2 小时

echo "[$(date '+%F %T')] 开始轮询 github.com（最多 ${MAX} 次 × ${INTERVAL}s）" | tee -a "$LOG"

for i in $(seq 1 "$MAX"); do
  if git -c http.proxy= -c https.proxy= ls-remote --heads origin main >/dev/null 2>&1; then
    echo "[$(date '+%F %T')] github.com 可达，执行 push" | tee -a "$LOG"
    if git -c http.proxy= -c https.proxy= push origin main >>"$LOG" 2>&1; then
      echo "[$(date '+%F %T')] ✅ 推送成功" | tee -a "$LOG"
      git log --oneline -1 | tee -a "$LOG"
      exit 0
    else
      echo "[$(date '+%F %T')] push 失败，继续等待" | tee -a "$LOG"
    fi
  fi
  sleep "$INTERVAL"
done

echo "[$(date '+%F %T')] ❌ 超时未连上，放弃" | tee -a "$LOG"
exit 1
