# 01 — Riscos

Ordenado por consequência, não por facilidade de correção. Cada risco traz a
**evidência** que o sustenta e o **critério objetivo** que o encerra.

---

## R-01 · CRÍTICO · Produção não tem cadastro documental nem de custo

**Evidência.** `MatrizDocumental = 0`, `PhaseEconomicRule = 0`,
`ProdutoFinanceiro` = 4 linhas **todas de VENDA**, `TabelaValor` = 4 linhas
**todas `natureza = VENDA`**, `Fornecedor = 0`.

**Consequência.** Nenhum documento é exigido por regra, nenhum custo pode nascer
e a Planilha Documental abre vazia — corretamente, porque não há o que projetar.
O motor econômico responde `sem regra na Matriz para tipoProcesso X + fase Y` e
para. O código está pronto e provado (30/30 em `test:custo-documental`); o que
falta é **cadastro**.

**Por que não foi resolvido nesta entrega.** Cadastrar "emissão custa X",
"apostilamento custa Y", "o fornecedor é Z" é política comercial e documental.
Inventar esses valores para fazer a tela mostrar número seria exatamente o que a
regra suprema proíbe. É decisão de negócio, não de engenharia.

**O que é preciso decidir (por tipo de processo e tipo documental):**
1. quais documentos a Matriz exige, em qual fase;
2. quais serviços cada documento produz (emissão / apostilamento / tradução / …);
3. o preço de custo vigente de cada serviço, moeda e fornecedor.

**Fecha quando:** `npm run reconciliar:custo-documental` roda num processo real e
não reporta `SEM_REGRA_NA_MATRIZ` nem `SEM_REGRA_ECONOMICA`.

---

## R-02 · CRÍTICO · A fila tem eventos emitidos que ninguém consome

**Evidência.** `tarefa.generated` = 99 pendentes, `financeiro.obrigacao.criada` =
5, `tarefa.concluido_recebido` = 1 — todos emitidos e ausentes de
`TIPOS_DRENADOS`. `step.concluido` estava na mesma situação (5 pendentes) até
06/08.

**Consequência.** É o modo de falha mais perigoso do sistema porque **não parece
falha**: nada fica com erro, nada alerta, a fila apenas cresce. Foi assim que a
projeção do custo documental morreu — o evento certo era emitido, na transação
certa, e nenhum consumidor o lia. O README do dispatcher já registra um incidente
idêntico que durou 12 dias.

**Fecha quando:** todo tipo emitido está em `TIPOS_DRENADOS` (com efeito ou
declarado sem efeito) e o guard FILA-003 reprova a divergência no build, não só
em runtime.

---

## R-03 · ~~ALTO~~ · **RESOLVIDO em 06/08** · Baseline reconciliado, migration aplicada

**Era.** `npm run test:baseline` reprovava: o checksum do baseline mudou de
`62e887…` para `597b1cd…` por causa da migration `20260806_custo_documental_vinculo`.
`npm run build` ficava vermelho e `prisma migrate deploy` pararia no meio do deploy.

**Procedimento executado** (o do `prisma/baseline/README.md`, sem atalho):
backup completo de produção (`pg_dump`, 3,0 MB, 213 tabelas, sha256
`f0db0e59…`) em `~/.discovery-backups/prod-20260806-pre-custo-documental/`, mais o
ledger em `prisma-migrations-20260806-pre-checksum.json` → conferência do diff
(30 inserções, ZERO remoções, ZERO `DROP`/`TRUNCATE`/`DELETE`) → `UPDATE` de UMA
coluna na linha `0000_baseline`, com o checksum anterior no `WHERE` → constante
atualizada no guard, no mesmo commit.

**Migration aplicada em produção** pelo guard oficial
(`scripts/prod-migrate-guard.mjs`, `MIGRATE_ON_BUILD=1` + `VERCEL_ENV=production`
+ `EU_CONFIRMO_ESCRITA_EM_PRODUCAO`), exclusivamente via `prisma migrate deploy`:
9 → 10 migrations, 17/17 colunas presentes, 764 requerentes antes e depois.
Rollback validado num banco descartável: 28 → 45 → 28 → 45 colunas.

## R-04 · ALTO · 87 rotas de API sem gate de autenticação/permissão

**Evidência.** 87 de 381 `route.ts` não referenciam `verificarPermissao`,
`extrairUsuario`, `requireAuth` nem `verificarPermissaoCusto`. Amostra:
`/api/test-db`, `/api/logs`, `/api/registral/*` (6 rotas),
`/api/clientes/documentos-pendentes`, `/api/clientes/aniversariantes`.

**Consequência.** Superfície de IDOR e vazamento de dados pessoais. Algumas são
legitimamente públicas (webhook com assinatura própria, cron com secret) — mas
isso precisa ser **declarado**, não presumido.

**Nota.** O guard `financeiro-autorizacao-guard` já cobre o domínio financeiro e
pegou uma rota aberta nesta própria auditoria (`GET /processos/[id]/custos`),
corrigida em 06/08. Falta o guard equivalente para os demais domínios.

**Fecha quando:** cada uma das 87 está com gate ou numa lista de exceções
justificada, e um guard reprova rota nova sem gate.

---

## R-05 · ALTO · Testes presos a IDs mutáveis de produção

**Evidência.** `custo-f3-espelho.test.ts` e outros usam `const PROC = 16`. Sem o
seed, quebram com `Foreign key constraint violated`.

**Consequência.** A suíte só passa em ambiente previamente semeado, e um reset de
banco (já aconteceu) derruba testes que não têm nada a ver com o reset. É
exatamente o problema que o "Processo Golden" da Fase 1 resolve.

**Fecha quando:** existe fixture canônica reproduzível e nenhum teste depende de
ID operacional.

---

## R-06 · MÉDIO · Anexos sem prova de fonte única

**Evidência.** Não há guard que reprove segunda cópia de arquivo físico.
`DocumentoArquivo` = 1 linha — volume pequeno demais para revelar duplicação.

**Fecha quando:** guard prova "um arquivo físico ⇒ uma linha de storage" e a
reconciliação detecta duplicata por hash.

---

## R-07 · MÉDIO · Câmbio ao vivo pendente de credencial

**Evidência.** Job diário Confidence existe e é testado; o `fetch` LIVE está sem
credencial. Obrigação em moeda estrangeira sem cotação aparece como
`naoConvertido > 0` — honestamente, mas sem valor em BRL.

**Fecha quando:** credencial provisionada e `naoConvertido = 0` no processo de
referência.

---

## R-08 · MÉDIO · Painel gerencial e portal do cliente não existem

**Evidência.** Nenhuma rota, nenhum componente, nenhum teste.

**Consequência.** São Fases 10 e 16 do programa. Registrado para não serem
confundidos com "quebrados".

---

## R-09 · BAIXO · Dívida de tipagem e observabilidade

**Evidência.** 426 ocorrências de `: any`; 633 `console.error` e 30
`console.log` fora de logger estruturado; 68 `TODO/FIXME`.

**Fecha quando:** logger estruturado com `correlationId` obrigatório nos caminhos
críticos (o do custo documental já nasceu assim) e `any` proibido por lint nos
módulos de domínio.

---

## R-10 · BAIXO (mas ativo) · Componentes mortos ainda no repositório

**Evidência.** `ProcessoFaturas.tsx` (1.000+ linhas) e `TabelaCustos.tsx` (1.024
linhas) não têm nenhum consumidor desde `9ffbbd20` (26/07). Consomem a API de
custos e continuam compilando.

**Consequência.** Contradiz "zero legado" e faz qualquer leitor achar que a
planilha antiga ainda está no ar.

**Fecha quando:** removidos, com a certeza (já verificada por busca global) de que
não há consumidor.
