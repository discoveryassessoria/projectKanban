# Hotfix de Segurança + Histórico Financeiro — Checklist de Ativação

**Branch:** `seguranca-hotfix`
**Cliente:** Discovery Assessoria
**Criado em:** 22/04/2026
**Contexto:** Marco (dono da empresa) está com acesso limitado ao dev original por conta do fuso horário. Foi feito um levantamento de segurança do sistema com apoio de IA e identificados problemas graves. Como Marco não programa, preparamos esta branch com **arquivos dormentes** (não alteram comportamento) que você pode ativar de forma controlada quando puder.

> ⚠️ **NADA AQUI ESTÁ ATIVO AINDA.** Todos os arquivos criados nesta branch são novos e não são importados por nenhum código existente. Fazer merge desta branch para `main` **não muda o comportamento do sistema.**

---

## 🚨 Problemas críticos identificados

1. **Rotas `/api/*` sem autenticação.** O middleware em `middleware.ts` só protege `/dashboard/*` e `/administrator/*`. Qualquer pessoa com a URL pode chamar a API diretamente e criar/editar/excluir dados.
2. **Token de autenticação é Base64 puro**, sem assinatura (ver `lib/kanban-auth.ts`). Qualquer um gera um token válido no navegador e vira `tipo: "admin"`:
```js
   btoa(JSON.stringify({ userId: 1, email: "x", tipo: "admin", exp: 9999999999999 }))
```
3. **Rotas financeiras não verificam permissões** (ver exemplo `app/api/financeiro/pagamentos-fatura/[id]/estorno/route.ts`).
4. **Auditoria incompleta:** `lib/auditoria.ts` existente só cobre processos, tarefas, contratantes e requerentes. Não há auditoria de pagamentos, faturas, recibos, contas-a-pagar, transações, fornecedores, categorias ou contas bancárias.

---

## 📦 O que foi adicionado nesta branch

| Arquivo | Tipo | Status |
|---|---|---|
| `lib/api-auth.ts` | Novo | Dormente |
| `lib/auditoria.ts` | Editado (append) | Dormente (helpers novos não são chamados ainda) |
| `src/components/HistoricoAuditoria.tsx` | Novo | Dormente |
| `SEGURANCA-HOTFIX-README.md` | Novo | Este arquivo |

**Variável de ambiente adicionada no Vercel (Production + Preview):**
- `JWT_SECRET` — valor aleatório de 64 caracteres hex. Já está configurado, não precisa mexer.

---

## ✅ Checklist de ativação (ordem importa)

### Etapa 1 — Validar as dependências do `api-auth.ts`

O `lib/api-auth.ts` importa:
- `jsonwebtoken` (já existe em `package.json`)
- `@/lib/prisma` (já existe)
- `@/src/lib/permissoes` (já existe)

Nada a instalar. Só confirme que o build passa sem erros de TS.

### Etapa 2 — Criar rota de login segura

Criar `src/app/api/auth/login-equipe/route.ts` que:
1. Recebe `{ email, senha }`
2. Busca `Usuario` no Prisma, compara senha com `bcrypt`
3. Emite token via `gerarTokenEquipe({ id, email, tipo })` de `@/lib/api-auth`
4. Retorna `{ token, usuario }`

Não reaproveite a rota atual de login — crie paralela para permitir rollback.

### Etapa 3 — Estender o middleware para `/api/*`

Em `middleware.ts`:
- Adicionar `/api/:path*` ao `matcher` (com exceções para rotas públicas como `/api/auth/login`, `/api/auth/login-equipe`, webhooks, rotas do app mobile que já usam `lib/app-auth.ts`)
- **Não validar token no middleware via `jwt.verify`** (Edge runtime não tem suporte completo ao `jsonwebtoken`). Em vez disso, deixar cada rota validar via `getUsuarioLogado()`.
- O middleware serve só para rejeitar requisições sem Authorization header ou cookie `authToken` nas rotas protegidas (fail-fast).

### Etapa 4 — Migração cuidadosa do frontend

Frontend hoje guarda token em `localStorage.authToken` (via `lib/auth.ts`). O token novo vai no mesmo lugar, só muda o formato (JWT assinado em vez de Base64).

Fluxo recomendado:
1. Adicionar o login-equipe novo ao frontend mantendo o antigo temporariamente
2. Todos os `fetch()` do frontend já enviam `Authorization: Bearer <token>`? Se não, auditar e corrigir.
3. Quando tudo estiver enviando token, desligar a rota de login antiga.

### Etapa 5 — Proteger rotas críticas

Para cada `route.ts` em `src/app/api/*`, substituir lógica anônima por:

```ts
import { exigirAutenticacao, exigirPermissao } from "@/lib/api-auth"

export async function PATCH(request: NextRequest, { params }) {
  const auth = await exigirPermissao(request, "financeiro.pagamento_editar")
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  // ... lógica existente, agora com acesso a `usuario.id`
}
```

**Prioridade:**
1. Rotas financeiras (`/api/financeiro/*`, `/api/contas-pagar/*`, `/api/transacoes/*`, `/api/recibos/*`, `/api/fornecedores/*`, `/api/categorias-financeiras/*`, `/api/contas-bancarias/*`)
2. Rotas administrativas (`/api/usuarios/*`, `/api/perfis/*`)
3. Rotas de processos, tarefas, clientes
4. Demais rotas

### Etapa 6 — Ativar auditoria financeira

Em cada rota financeira, após a operação bem-sucedida, chamar o helper correspondente de `lib/auditoria.ts`:

```ts
import { logPagamento } from "@/lib/auditoria"

// ... depois de criar/editar/estornar pagamento ...
await logPagamento.estornar(
  descricao,
  pagamento.id,
  body.motivo,
  usuario.id
)
```

Helpers novos disponíveis (todos com assinaturas documentadas no arquivo):
- `logPagamento.{criar, editar, estornar, reverterEstorno, excluir}`
- `logFatura.{criar, editar, mudarStatus, excluir}`
- `logRecibo.{emitir, excluir}`
- `logContaPagar.{criar, editar, pagar, excluir}`
- `logTransacao.{criar, editar, excluir}`
- `logFornecedor.{criar, editar, excluir}`
- `logCategoria.{criar, editar, excluir}`
- `logContaBancaria.{criar, editar, excluir}`

### Etapa 7 — Garantir que `/api/logs` aceita filtros

O componente `HistoricoAuditoria.tsx` faz:
