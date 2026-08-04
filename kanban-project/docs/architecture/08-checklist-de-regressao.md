# 08 — Checklist de regressão e deploy

> Baseline congelada em 04/08/2026.

## Nenhum PR é aprovado se falhar qualquer um destes

| suíte | comando |
|---|---|
| baseline (schema × prisma) | `npm run test:baseline` |
| **arquitetura** | `npm run test:arquitetura-baseline` |
| contrato documental | `npm run test:contrato-doc` |
| materialização | `npm run test:materializacao` |
| invariante documental | `npm run test:invariante-doc` |
| documento / DOC21 | `npm run test:doc21` |
| workflow (motor de fases) | `npm run test:motor-fases` |
| central operacional | `npm run test:central-unificada` |
| anexos / solicitação | `npm run test:solicitacao` |
| passo ↔ tarefa | `npm run test:passo-tarefa` |
| projeção | `npm run test:operational-projection` |
| estrutura operacional | `npm run test:estrutura-operacional` |

Complementares: `test:abas` · `test:editor-etapa` · `test:phasekeys` ·
`test:emissao-gate` · `test:env-producao` · `test:nav`.

## Checklist obrigatório antes de qualquer deploy

- [ ] **lint** — `npm run lint`, zero
- [ ] **typecheck** — `npx tsc --noEmit` (apagar `tsconfig.tsbuildinfo` antes; `timeout` dá falso-limpo)
- [ ] **build** — `npm run build`
- [ ] **baseline** — schema em dia com o `schema.prisma`
- [ ] **arquitetura** — a suíte desta pasta
- [ ] **smoke** — `/login` 200 · `/api/auth/login` 401 (não 500) · **0 respostas 5xx** nos logs
- [ ] **Central Operacional** — abre, agrupa por pessoa → documento
- [ ] **documentos** — aparecem por pessoa, com seus passos
- [ ] **anexos** — o mesmo `fileId` na etapa, no documento e no protocolo
- [ ] **runtime** — passos executáveis, tarefas sincronizadas

O `build` já executa `test:baseline` e `test:arquitetura-baseline`: **nenhum deploy
passa sem elas**.

## Migration

- [ ] fingerprint do banco confirmado
- [ ] backup (`pg_dump -Fc`) antes de escrever
- [ ] migration **aditiva** e **idempotente**
- [ ] zero `DROP` / `TRUNCATE` / `DELETE` fora de comentário
- [ ] ledger `0000_baseline` reconciliado se o baseline mudou
- [ ] contagens antes/depois das tabelas afetadas

**Proibido:** `prisma db push` · `prisma migrate reset` · seed destrutivo ·
truncate · delete em massa · recriação de tabela sem preservação.

## Comparação antes/depois

Registrar e explicar qualquer variação em: `Processo`, `Documento`, `Tarefa`,
`PhaseWorkflowStepInstance`, `PhaseWorkflowInstance`, `DocumentoArquivo`,
`SolicitacaoDocumento`.

Variação sem causa conhecida é regressão até prova em contrário.
