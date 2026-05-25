#!/bin/bash
# Oracle Always Free 防回收保险
#
# Oracle 文档说连续 7 天 CPU<20% AND network<20% AND memory<10% 才会回收。
# 跑了完整后端栈基本不会触发，但加这个 cron 让 network/CPU 有规律性出现，零成本上保险。
#
# cron 示例（每 30 分钟一次）：
#   */30 * * * * APP_DOMAIN=example.com /home/ubuntu/contritas/keepalive.sh >/dev/null 2>&1

set -u

DOMAIN="${APP_DOMAIN:?APP_DOMAIN must be set, e.g. example.com}"

# 1. HTTP 探活 — 产生 network 流量 + 触发 api/worker 处理
curl -sf --max-time 10 "https://api.${DOMAIN}/health" >/dev/null || true

# 2. 短促 CPU + IO burst（约 100MB，几百毫秒）
dd if=/dev/zero of=/dev/null bs=1M count=100 2>/dev/null || true
