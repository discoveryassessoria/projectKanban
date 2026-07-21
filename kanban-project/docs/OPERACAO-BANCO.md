# Operação de Banco de Dados — Discovery

> Escrito após o incidente de **21/07/2026**, em que um
> `prisma migrate diff --shadow-database-url <produção>` resetou o banco de
> produção. Shadow database é **descartável por definição**: o Prisma derruba o
> schema e reaplica todas as migrations nele. Apontar produção para lá destrói
> produção. Este documento existe para que isso não se repita.

## 1. Separação obrigatória de bancos

| Ambiente | Variável | Regra |
|---|---|---|
| **Production** | `PRISMA_DATABASE_URL` (target `production`) | Só recebe `prisma migrate deploy`, com guard |
| **Preview/Staging** | `PRISMA_DATABASE_URL` (target `preview`) | Onde migrations são testadas antes de produção |
| **Development** | `PRISMA_DATABASE_URL` local (`.env.local`) | Livre |
| **Shadow** | `SHADOW_DATABASE_URL` | Banco **vazio e descartável**, exclusivo. Nunca reaproveitar outro |

Regras absolutas:

- Cada ambiente tem credencial própria. Nunca compartilhar.
- `SHADOW_DATABASE_URL` **nunca** aponta para produção ou staging.
- Nenhum script reutiliza `DATABASE_URL`/`PRISMA_DATABASE_URL` como shadow.
- `DIRECT_DATABASE_URL` do projeto está **obsoleta** (aponta para o banco
  danificado de maio). Não usar até ser corrigida.

## 2. Comandos proibidos contra produção

Bloqueados por `lib/db/identidade-banco.mjs` → `COMANDOS_PROIBIDOS_EM_PRODUCAO`:

```
prisma migrate reset      prisma migrate dev       prisma db push
prisma db execute         prisma migrate diff      --shadow-database-url
prisma db seed            DROP SCHEMA/DATABASE/TABLE
TRUNCATE                  DELETE sem WHERE
```

**Contra produção existe exatamente um comando permitido: `prisma migrate deploy`.**

Migrations são **geradas e testadas em desenvolvimento/staging**. O SQL vai
versionado no repositório e produção apenas o aplica.

## 3. Camadas de proteção

| Camada | Arquivo | O que faz |
|---|---|---|
| Identidade | `lib/db/identidade-banco.mjs` | Fingerprint, classificação, validação de shadow, lista de comandos proibidos |
| Trava CLI | `scripts/db-guard.mjs` | `npm run db:guard` — aborta se o alvo for produção, se o comando for destrutivo ou se o shadow for inválido |
| Migration | `scripts/prod-migrate-guard.mjs` | Roda no build da Vercel; prova identidade antes de escrever; verifica perda de dados depois |
| Checklist | `scripts/preflight-db.mjs` | `npm run db:preflight` — backup, identidade, shadow, migrations, rollback |

Todas falham **fechadas**: qualquer dúvida aborta sem escrever.

### Confirmação explícita

Escrita em produção exige, fora do código:

```bash
export EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'
```

Sem isso, o guard aborta mesmo com a identidade correta.

## 4. Aplicar migration em produção

```bash
# 1. checklist
npm run db:preflight

# 2. ligar a flag no projeto Vercel (target production)
npx vercel env add MIGRATE_ON_BUILD production      # valor: 1
npx vercel env add EU_CONFIRMO_ESCRITA_EM_PRODUCAO production

# 3. build com migration: o guard prova a identidade e aplica
npm run build:prod-migrate    # localmente, ou deploy normal com a flag ligada

# 4. DESLIGAR a flag logo após
npx vercel env rm MIGRATE_ON_BUILD production --yes
```

Nunca deixar `MIGRATE_ON_BUILD=1` ligado permanentemente.

## 5. Backups e recuperação

- **Provedor:** Prisma Postgres, com Point-in-Time Recovery no console.
- **Antes de qualquer alteração de schema:** conferir PITR disponível e registrar
  as contagens (`npm run db:preflight` faz isso).
- **Restaurar sempre para um banco NOVO** (`grupo-discovery-<motivo>-<data>`),
  validar em leitura, só então promover trocando `PRISMA_DATABASE_URL`.
- **Nunca restaurar por cima da produção.**
- **Nunca apagar** o banco danificado nem backups: são evidência.
- Teste de restauração periódico: restaurar em banco separado e rodar
  `npm run db:guard -- --url-env SHADOW_DATABASE_URL --exigir nao-producao`.

## 6. Promover um banco restaurado

1. Registrar rollback em `~/.discovery-rollback-<data>.md`.
2. Validar em leitura (`BEGIN READ ONLY` … `ROLLBACK`).
3. Trocar **somente** `PRISMA_DATABASE_URL` target `production`.
4. Deploy.
5. Validar: login retorna **401** (não 500), rotas autenticadas 401, páginas 200,
   contagens conferem.
6. Se falhar: repontar a variável e redeployar.

## 7. Regra de trabalho com assistentes

Comandos de banco em produção **sempre** são exibidos por extenso antes de rodar,
com a classificação **lê** ou **escreve**. Nada de comando de banco em produção
sob permissão automática.
