# Sourced by install.sh and install-systemd.sh.

# The service doesn't inherit this shell, so ~/.outpost/.env is where the daemon reads its ports from.
ENV_FILE="$HOME/.outpost/.env"
PORT_VARS=(OUTPOST_HTTP_PORT OUTPOST_HTTPS_PORT OUTPOST_HOOK_PORT)

persist_port_overrides() {
  local var val
  for var in "${PORT_VARS[@]}"; do
    val="${!var:-}"
    [[ -z "$val" ]] && continue
    mkdir -p "$(dirname "$ENV_FILE")"
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    { grep -v -E "^[[:space:]]*(export[[:space:]]+)?$var=" "$ENV_FILE" || true; echo "$var=$val"; } > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
    echo "Saved $var=$val to $ENV_FILE"
  done
}

configured_port() {
  local var=$1 default=$2 line val
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$var=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "$default"
    return
  fi
  val="${line#*=}"
  echo "${val//[\"\' ]/}"
}

port_listener() {
  if command -v lsof >/dev/null; then
    { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR == 2 { print $1 " (pid " $2 ")" }'
  elif command -v ss >/dev/null; then
    { ss -Hltnp "sport = :$1" 2>/dev/null || true; } | head -1
  fi
}

# Must run after the old instance is stopped, or it reports Outpost's own ports as taken
check_ports_free() {
  local http https hook busy=0 entry var port who
  http="$(configured_port OUTPOST_HTTP_PORT 8080)"
  https="$(configured_port OUTPOST_HTTPS_PORT 8443)"
  hook="$(configured_port OUTPOST_HOOK_PORT 8444)"
  local checks=("OUTPOST_HTTP_PORT:$http" "OUTPOST_HOOK_PORT:$hook")
  # The HTTPS listener only binds when Tailscale is available
  if command -v tailscale >/dev/null; then
    checks+=("OUTPOST_HTTPS_PORT:$https")
  fi
  for entry in "${checks[@]}"; do
    var="${entry%%:*}"
    port="${entry#*:}"
    [[ "$port" == "0" ]] && continue
    who="$(port_listener "$port")"
    if [[ -n "$who" ]]; then
      echo "Port $port ($var) is already in use by $who." >&2
      busy=1
    fi
  done
  if (( busy )); then
    echo "Pick free ports and re-run, e.g.: OUTPOST_HTTP_PORT=8090 $0" >&2
    echo "They're saved to $ENV_FILE, so later re-installs and restarts keep them." >&2
    exit 1
  fi
  OUTPOST_URL_PORT="$http"
}

print_open_url() {
  [[ "${OUTPOST_URL_PORT:-0}" != "0" ]] && echo "  open:  http://localhost:$OUTPOST_URL_PORT"
  return 0
}
