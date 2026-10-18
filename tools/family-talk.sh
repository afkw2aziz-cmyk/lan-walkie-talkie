#!/usr/bin/env bash
# تشغيل/إيقاف سيرفر اللاسلكي العائلي —  usage: family-talk.sh {start|stop|restart|status|logs|code}
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$DIR/data/server.pid"
LOGFILE="$DIR/data/server.log"
mkdir -p "$DIR/data"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

kill_all() {
  local pids=""
  [ -f "$PIDFILE" ] && pids="$(cat "$PIDFILE")"
  # أي عملية تمسك منفذ 8443 أو 8080 (بدون مطابقة الأنماط النصية)
  for port in 8443 8080; do
    pids="$pids $(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | tr '\n' ' ')"
  done
  pids="$(printf '%s\n' $pids | sort -u | tr '\n' ' ')"
  for p in $pids; do kill "$p" 2>/dev/null && echo "⏹  أُنهيت العملية $p"; done
  rm -f "$PIDFILE"
}

case "${1:-start}" in
  start)
    if running; then echo "يعمل بالفعل (PID $(cat "$PIDFILE"))"; exit 0; fi
    cd "$DIR"
    nohup node server.js >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1.2
    if running; then
      echo "✅ بدأ التشغيل (PID $(cat "$PIDFILE"))"
      grep -E 'رمز العائلة:|رابط التطبيق:|صفحة تعريف' "$LOGFILE" | tail -3 || true
    else
      echo "❌ فشل التشغيل — راجع: $LOGFILE"; tail -20 "$LOGFILE"; exit 1
    fi
    ;;
  stop)
    kill_all
    echo "تم الإيقاف"
    ;;
  restart)
    bash "$0" stop; sleep 0.6; bash "$0" start
    ;;
  status)
    running && echo "يعمل (PID $(cat "$PIDFILE"))" || echo "متوقف"
    curl -sk https://127.0.0.1:8443/api/health && echo
    ;;
  code)
    node -e "console.log('رمز العائلة:', require('$DIR/data/config.json').familyCode)"
    ;;
  logs)
    tail -n "${2:-40}" "$LOGFILE"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs|code}"; exit 2
    ;;
esac
