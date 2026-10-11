#!/bin/bash
# Verificações de segurança automáticas (sem dependências externas além de git e pnpm):
#   1. pnpm audit (alta gravidade ou superior)
#   2. pesquisa de segredos por padrões nos ficheiros versionados
#   3. configuração: .env ignorado, sem chaves/certificados versionados, segredo de desenvolvimento só em testes/env.ts
# Uso: pnpm security:check   (SECURITY_SKIP_AUDIT=1 para saltar o audit, p.ex. sem rede)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
FAIL=0
bad() { echo "  FALHA: $*"; FAIL=1; }
ok() { echo "  ok: $*"; }

echo "== 1. Dependências (pnpm audit --audit-level=high) =="
if [ "${SECURITY_SKIP_AUDIT:-0}" = "1" ]; then
  echo "  (saltado)"
elif pnpm audit --audit-level=high >/tmp/cpq-audit.$$ 2>&1; then
  ok "sem vulnerabilidades de gravidade alta ou crítica"
else
  if grep -q "ERR_PNPM_AUDIT\|ENOTFOUND\|ECONNREFUSED\|fetch failed" /tmp/cpq-audit.$$ && ! grep -q "vulnerabilities found" /tmp/cpq-audit.$$; then
    bad "o audit não correu (rede?): $(head -c 200 /tmp/cpq-audit.$$)"
  else
    bad "vulnerabilidades de gravidade alta/crítica:"; grep -E "^│ (high|critical)|Package|Paths" /tmp/cpq-audit.$$ | sed 's/^/    /' | head -40
  fi
fi
rm -f /tmp/cpq-audit.$$

echo "== 2. Segredos nos ficheiros versionados =="
# Ficheiros de teste e de exemplo têm palavras-passe de demonstração; ficam fora desta pesquisa.
EXCL=(':!pnpm-lock.yaml' ':!*.test.ts' ':!**/test/**' ':!docs/**' ':!*.md' ':!scripts/security/check.sh' ':!db/seed/**' ':!e2e/**' ':!**/i18n/**' ':!.github/**')
declare -a PATTERNS=(
  'AKIA[0-9A-Z]{16}'                                   # chave de acesso AWS
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'              # chaves privadas
  'xox[baprs]-[0-9A-Za-z-]{10,}'                       # tokens Slack
  'gh[pousr]_[0-9A-Za-z]{30,}'                         # tokens GitHub
  'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.'     # JWT
  'cpq_[A-Za-z0-9_-]{43}'                              # chaves de API da aplicação
  '(mysql|mariadb|postgres(ql)?|redis|amqp|smtp)s?://[^:/@ ]+:[^@ ]{3,}@'   # URLs com palavra-passe
  '(password|passwd|secret|api[_-]?key|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$ {}]{12,}["'"'"']'   # atribuições literais
)
FOUND=0
for p in "${PATTERNS[@]}"; do
  out=$(git grep -nIE "$p" -- . "${EXCL[@]}" 2>/dev/null | grep -v "security-ignore" | grep -vE "://(cpq:cpq|root:root|user:pass)@" | head -5)  # credenciais de desenvolvimento/CI conhecidas
  if [ -n "$out" ]; then FOUND=1; bad "padrão '$p':"; echo "$out" | sed 's/^/    /'; fi
done
[ $FOUND -eq 0 ] && ok "nenhum segredo encontrado nos ficheiros versionados"

echo "== 3. Configuração =="
git check-ignore -q .env && ok ".env está no .gitignore" || bad ".env não está ignorado pelo git"
git check-ignore -q storage/x && ok "storage/ (documentos) está ignorado" || bad "storage/ não está ignorado"
if git ls-files | grep -E '(^|/)\.env($|\.(local|production|prod|qa))|\.(pem|key|p12|pfx|jks|crt)$|id_rsa' | grep -v '\.env\.example$' | grep .; then
  bad "ficheiros de segredos/chaves/certificados versionados (acima)"
else ok "nenhum .env, chave ou certificado versionado"; fi
git ls-files | grep -E '\.eml$' | grep -q . && echo "  AVISO: ficheiros .eml versionados (correio de desenvolvimento; pode conter ligações do portal): git rm --cached e ignorar mail-outbox/"
for f in .env.production .env.local storage-audit mail-outbox; do
  [ -e "$f" ] && ! git check-ignore -q "$f" && bad "$f existe e não está ignorado"
done
# Segredo de desenvolvimento só pode aparecer em env.ts e nos testes
n=$(git grep -lI "cpq-segredo-so-para-desenvolvimento" -- . ':!docs/**' ':!*.md' | grep -v -E "apps/api/src/config/env(\.test)?\.ts|scripts/security/" | wc -l | tr -d ' ')
[ "$n" = "0" ] && ok "o segredo de desenvolvimento só existe em config/env.ts" || bad "o segredo de desenvolvimento aparece noutros ficheiros"
# Produção exige segredo forte (validado no arranque)
grep -q "AUTH_JWT_SECRET é obrigatório em produção" apps/api/src/config/env.ts && ok "env.ts exige AUTH_JWT_SECRET forte em produção" || bad "env.ts já não valida AUTH_JWT_SECRET em produção"
# Infra: firewall ativa, SSH sem palavra-passe, ficheiros de ambiente 0600, cabeçalhos no Nginx
grep -q "state: enabled" infra/ansible/roles/nginx/tasks/main.yml && ok "ufw é ativado com política de negar a entrada" || bad "ufw não é ativado no Ansible"
grep -q "PasswordAuthentication no" infra/ansible/roles/base/tasks/main.yml && ok "SSH sem palavra-passe" || bad "SSH permite palavra-passe"
grep -q "Strict-Transport-Security" infra/ansible/roles/nginx/templates/cpq.conf.j2 && ok "HSTS no Nginx" || bad "falta HSTS no Nginx"
grep -q "token-omitido" infra/ansible/roles/nginx/templates/cpq.conf.j2 && ok "Nginx não regista tokens do portal" || bad "Nginx regista tokens do portal nos acessos"
# Rotas: o teste de cobertura corre com a bateria da API (precisa de TEST_DATABASE_URL)
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  echo "== 4. Testes de segurança da API =="
  pnpm --filter @cpq/api exec vitest run test/security.test.ts >/dev/null 2>&1 && ok "apps/api/test/security.test.ts" || bad "apps/api/test/security.test.ts falhou (corra-o para ver o detalhe)"
else
  echo "== 4. Testes de segurança da API: saltados (defina TEST_DATABASE_URL; 'source .env') =="
fi

echo
[ $FAIL -eq 0 ] && echo "Verificações de segurança: OK" || echo "Verificações de segurança: FALHARAM"
exit $FAIL
