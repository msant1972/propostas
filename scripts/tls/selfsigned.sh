#!/bin/bash
# Gera o certificado TLS autoassinado do servidor (portal do cliente e aplicação).
# Uso: scripts/tls/selfsigned.sh <nome-dns> [<nome-dns>...] [--ip 10.0.0.5] [--out pasta] [--days 825]
# Imprime a impressão digital SHA-256, que se comunica ao cliente para ele confirmar o certificado.
set -euo pipefail

OUT="${CPQ_TLS_DIR:-$HOME/tools/data/tls}"
DAYS=825
NAMES=()
IPS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out)  OUT="$2"; shift 2 ;;
    --days) DAYS="$2"; shift 2 ;;
    --ip)   IPS+=("$2"); shift 2 ;;
    *)      NAMES+=("$1"); shift ;;
  esac
done
[ ${#NAMES[@]} -gt 0 ] || { echo "Indique pelo menos um nome DNS (ex.: propostas.exemplo.pt)"; exit 1; }

mkdir -p "$OUT"
chmod 700 "$OUT"
SAN=""
for n in "${NAMES[@]}"; do SAN="${SAN:+$SAN,}DNS:$n"; done
for i in "${IPS[@]:-}"; do [ -n "$i" ] && SAN="$SAN,IP:$i"; done

# Chave ECDSA P-256; o certificado serve só para autenticação de servidor (serverAuth).
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 -days "$DAYS" \
  -keyout "$OUT/portal.key" -out "$OUT/portal.crt" \
  -subj "/CN=${NAMES[0]}/O=Propostas" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null
chmod 600 "$OUT/portal.key"
chmod 644 "$OUT/portal.crt"

echo "Certificado:  $OUT/portal.crt"
echo "Chave privada: $OUT/portal.key"
echo "Válido por $DAYS dias; nomes: $SAN"
echo -n "SHA-256: "
openssl x509 -in "$OUT/portal.crt" -noout -fingerprint -sha256 | cut -d= -f2
