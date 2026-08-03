# scripts/ativar-db.sh
# ============================================================================
# ATIVA a conexão de banco NA SESSÃO ATUAL do terminal, com confirmação.
#
#   source scripts/ativar-db.sh
#
# POR QUE ISTO EXISTE
#   As URLs reais vivem no .env sob os nomes PRISMA_DATABASE_URL_RAW e
#   DIRECT_DATABASE_URL_RAW. O Prisma CLI lê o .env sozinho, mas procura
#   PRISMA_DATABASE_URL / DIRECT_DATABASE_URL — que NÃO existem lá. Resultado:
#   um `npx prisma db push` ou `npx prisma migrate dev` digitado por engano não
#   encontra banco nenhum e falha, em vez de acertar produção.
#
#   Os comandos npm protegidos (guard:escrita, backfills, seed) continuam
#   passando pelo db-guard como antes. Esta trava cobre o outro caminho: o
#   comando Prisma solto, fora de qualquer script.
#
# O QUE ELE FAZ
#   Mostra QUAL banco você está prestes a ativar — host, classificação e
#   contagens reais — exige um "SIM" digitado, e só então exporta as duas
#   variáveis. Exclusivamente para esta sessão: nada é escrito em disco, e
#   fechar o terminal desfaz.
# ============================================================================

# ── Foi executado em vez de "source"ado? ────────────────────────────────────
# Exportar variáveis num subprocesso não afeta o shell de quem chamou: o script
# rodaria inteiro, pediria confirmação, e não teria efeito nenhum. Melhor
# recusar do que dar a impressão de ter funcionado.
if [ -n "$BASH_VERSION" ]; then
  (return 0 2>/dev/null) || {
    echo "[ativar-db] ERRO: este script precisa ser SOURCEADO, não executado." >&2
    echo "[ativar-db]   errado : ./scripts/ativar-db.sh" >&2
    echo "[ativar-db]   certo  : source scripts/ativar-db.sh" >&2
    echo "[ativar-db] Executado num subprocesso, o export não alcança o seu terminal." >&2
    exit 1
  }
elif [ -n "$ZSH_VERSION" ]; then
  case "$ZSH_EVAL_CONTEXT" in
    *:file:*) ;;
    *)
      echo "[ativar-db] ERRO: este script precisa ser SOURCEADO, não executado." >&2
      echo "[ativar-db]   errado : ./scripts/ativar-db.sh" >&2
      echo "[ativar-db]   certo  : source scripts/ativar-db.sh" >&2
      echo "[ativar-db] Executado num subprocesso, o export não alcança o seu terminal." >&2
      exit 1
      ;;
  esac
fi

# A partir daqui NÃO se pode usar `exit` — encerraria o terminal do usuário.
# Todo caminho de saída usa `return`.

ativar_db() {
  # Raiz do projeto, independente de onde o usuário está.
  local raiz
  if [ -n "$BASH_VERSION" ]; then
    raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  else
    raiz="$(cd "$(dirname "${(%):-%x}")/.." && pwd)"
  fi

  local envfile="$raiz/.env"
  [ -f "$envfile" ] || { echo "[ativar-db] ERRO: $envfile não encontrado." >&2; return 1; }

  # Lê as _RAW sem `source` do .env — evita executar conteúdo do arquivo
  # (um valor com $(...) seria avaliado pelo shell).
  local raw_pooled raw_direct
  raw_pooled="$(sed -n 's/^PRISMA_DATABASE_URL_RAW=//p' "$envfile" | head -1 | sed 's/^"//; s/"$//')"
  raw_direct="$(sed -n 's/^DIRECT_DATABASE_URL_RAW=//p' "$envfile" | head -1 | sed 's/^"//; s/"$//')"

  if [ -z "$raw_pooled" ] || [ -z "$raw_direct" ]; then
    echo "[ativar-db] ERRO: PRISMA_DATABASE_URL_RAW e/ou DIRECT_DATABASE_URL_RAW ausentes ou vazias em .env." >&2
    echo "[ativar-db] Este projeto guarda as URLs reais sob o sufixo _RAW. Ver .env.example." >&2
    return 1
  fi

  # ── Retrato do alvo, ANTES de exportar qualquer coisa ─────────────────────
  echo ""
  echo "[ativar-db] consultando o banco antes de ativar…"
  local retrato
  retrato="$(PRISMA_DATABASE_URL_ALVO="$raw_pooled" node --input-type=module -e '
    import { CLASSE, classificar, identificador, retratar } from "'"$raiz"'/lib/db/identidade-banco.mjs"
    const { PrismaClient } = await import("'"$raiz"'/node_modules/@prisma/client/default.js")
    const url = process.env.PRISMA_DATABASE_URL_ALVO
    const prisma = new PrismaClient({ datasources: { db: { url } } })
    try {
      const r = await retratar(prisma)
      const c = classificar(r)
      console.log(JSON.stringify({ id: identificador(url), classe: c, ...r, producao: c === CLASSE.PRODUCAO }))
    } finally { await prisma.$disconnect() }
  ' 2>/dev/null)"

  if [ -z "$retrato" ]; then
    echo "[ativar-db] ERRO: não consegui ler o banco para classificá-lo. Nada foi exportado." >&2
    return 1
  fi

  local alvo classe tabelas migrations requerentes producao
  alvo="$(printf '%s' "$retrato"        | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
  classe="$(printf '%s' "$retrato"      | sed -n 's/.*"classe":"\([^"]*\)".*/\1/p')"
  tabelas="$(printf '%s' "$retrato"     | sed -n 's/.*"tabelas":\([0-9]*\).*/\1/p')"
  migrations="$(printf '%s' "$retrato"  | sed -n 's/.*"migrations":\([0-9]*\).*/\1/p')"
  requerentes="$(printf '%s' "$retrato" | sed -n 's/.*"requerentes":\([0-9]*\).*/\1/p')"
  producao="$(printf '%s' "$retrato"    | sed -n 's/.*"producao":\([a-z]*\).*/\1/p')"

  echo ""
  echo "  ┌────────────────────────────────────────────────────────────────"
  echo "  │  alvo          : $alvo"
  echo "  │  classificação : $classe"
  echo "  │  conteúdo      : $tabelas tabelas · $migrations migrations · $requerentes requerentes"
  echo "  └────────────────────────────────────────────────────────────────"
  echo ""
  if [ "$producao" = "true" ]; then
    echo "  ⚠  ESTE É O BANCO DE PRODUÇÃO — dado real de clientes."
    echo "     Comandos Prisma soltos (db push, migrate dev, migrate reset) NÃO"
    echo "     passam por guarda nenhuma depois de ativar. Tenha certeza."
    echo ""
  fi

  printf "  Digite SIM para ativar nesta sessão (qualquer outra coisa cancela): "
  local resposta
  read -r resposta

  if [ "$resposta" != "SIM" ]; then
    echo ""
    echo "[ativar-db] CANCELADO — nada foi exportado. A sessão segue sem acesso a banco."
    return 1
  fi

  export PRISMA_DATABASE_URL="$raw_pooled"
  export DIRECT_DATABASE_URL="$raw_direct"

  echo ""
  echo "[ativar-db] ✅ ativado NESTA sessão ($classe)."
  echo "[ativar-db]    Vale só neste terminal. Fechar a janela desfaz."
  echo "[ativar-db]    Para desativar agora: unset PRISMA_DATABASE_URL DIRECT_DATABASE_URL"
  return 0
}

# O status de um `source` é o do ÚLTIMO comando do arquivo. Sem guardar o
# retorno aqui, um `unset` no fim devolveria 0 e o cancelamento pareceria
# sucesso para qualquer `source ... && algo` encadeado.
ativar_db
_ativar_db_rc=$?
unset -f ativar_db
if [ "$_ativar_db_rc" -eq 0 ]; then
  unset -v _ativar_db_rc
  return 0
fi
unset -v _ativar_db_rc
return 1
