# 04 — Roadmap controlado

Cada fase declara: **o que entra**, **arquivos e tabelas afetados**, **impacto**,
**critério objetivo de conclusão** e **o que a bloqueia**. Nenhuma fase começa com
a anterior instável.

Fases marcadas 🔒 estão congeladas (concluídas e provadas).

---

## Fase 0 — Inventário 🔒

**Entregue em 06/08/2026.** `00-inventario-geral.md`, `01-riscos.md`,
`02-fontes-da-verdade.md`, `03-dividas-tecnicas.md`, este arquivo.

**Concluída porque:** todos os números foram contados no repositório e no banco,
com o comando de verificação registrado. Nenhuma refatoração foi feita durante o
inventário.

---

## Fase 1 — Estabilidade e não regressão

**Entra**
1. **Reconciliar o ledger do baseline** (R-03) — desbloqueia `npm run build`.
2. Guard de **fila**: todo tipo emitido está em `TIPOS_DRENADOS`; build reprova
   se não estiver (R-02).
3. Guard de **gate de rota** fora do financeiro (R-04), com lista de exceções
   justificada.
4. **Processo Golden**: fixture canônica reproduzível, sem ID mutável (R-05).
   Deve validar documentos, workflows, passos, tarefas, vínculos por ID,
   progresso, custos, ausência de duplicação e idempotência.
5. Suítes consolidadas: `test:core`, `test:documents`, `test:workflows`,
   `test:finance`, `test:security`, `test:smoke`, e `validate:production`.

**Afeta** `scripts/baseline-verificar.test.ts`, `src/services/outbox-dispatcher.ts`,
`package.json`, `scripts/` (guards e fixture novos). **Nenhuma tabela.**

**Impacto** baixo em runtime, alto em confiabilidade. Sem migration.

**Conclui quando** `npm run validate:production` roda inteiro e verde, e o Golden
Process reprova qualquer divergência não aprovada.

**Bloqueada por** nada. **É a próxima.**

---

## Fase 2 — Fonte única da verdade

**Entra** guards que detectem lista duplicada, string estrutural, arquivo
duplicado por hash, relacionamento por nome e `metadata` usado como fonte;
encerramento do dual-read `Documento.tipo` × `documentTypeId`; decisão sobre
`Custo`/`CustoPessoa` (02-fontes, "dúvidas" 1–3).

**Afeta** `src/lib/process-stage/*`, `src/services/*`, `prisma/schema.prisma`
(possível DROP — exige aprovação explícita), `scripts/*guard*`.

**Impacto** médio. Migration destrutiva **só** se a remoção de `Custo`/`CustoPessoa`
for aprovada; caso contrário, zero.

**Conclui quando** nenhum guard encontra segunda fonte e o dual-read está fechado.

**Bloqueada por** Fase 1 (os guards precisam do gate de build funcionando).

---

## Fase 3 — Cadeia documental completa

**Entra** `reconcileDocumentChain(processId)` — detecta documento sem workflow,
workflow sem documento, passo sem documento, tarefa sem passo, tarefa com
documento divergente, duplicação, necessidade sem documento, pessoa/processo/ciclo
divergentes. Repara o determinístico; **relata** o ambíguo.

**Afeta** `src/services/` (serviço novo), `scripts/` (CLI + teste). Leitura de
`Documento`, `NecessidadeDocumental`, `PhaseWorkflow*`, `Tarefa`. **Sem migration.**

**Impacto** médio-alto: é o serviço que vai ser rodado sobre produção.

**Conclui quando** roda sobre todos os processos e o relatório fica estável entre
duas execuções consecutivas (convergência provada).

**Bloqueada por** Fase 1 (Golden Process é a base do teste).

---

## Fase 4 — Matrizes documentais

**Entra** auditoria por (país × tipo de processo × serviço × posição genealógica ×
condição), classificação (completa / incompleta / órfã / duplicada / conflitante),
**ficha objetiva de decisão** para o que faltar, cadastro por ID após aprovação, e
simulador administrativo ("o que seria materializado, e qual regra gerou cada
documento").

**Afeta** `MatrizDocumental` (**dados**), telas de Gerenciamento, serviço de
simulação.

**Impacto** ALTO — é o que faz o sistema exigir documento. Hoje: **0 linhas**.

**Conclui quando** todo tipo de processo ativo tem matriz publicada e o simulador
mostra o resultado esperado sem conflito.

**Bloqueada por** decisão de negócio (R-01). **Engenharia não decide exigência
documental.**

---

## Fase 5 — Solicitação de certidões e DOC21

**Entra** fechar o fluxo Documento → Solicitar → DOC21 → Solicitação → Protocolo →
conclui Step → conclui Task → libera "Aguardar retorno"; eliminar dependência de
`metadata` transitório; backfill `backfill:solicitacao` (pendente desde o
incidente de 04/08).

**Afeta** `SolicitacaoDocumento`, `ProtocoloDocumento`, `DocumentoArquivo`,
`src/services/` da solicitação. **Sem migration nova.**

**Impacto** médio. **Conclui quando** o Golden Process cobre o fluxo inteiro e o
DOC21 aparece nas duas abas de anexo sem segunda cópia.

**Bloqueada por** Fase 3.

---

## Fase 6 — Financeiro integrado 🔶 *máquina pronta e em produção; cadastro pendente*

**Já entregue (06/08).** Gatilho canônico (`step.concluido` do passo registral +
régua oficial de "localizado"); vínculo documental e snapshot de preço na
obrigação (migration aditiva); plano multi-serviço por documento; separação
automático × manual; Planilha Documental restaurada como terceira vista de
Custos; reconciliação + backfill idempotentes; 30/30 em `test:custo-documental`.

**Migration aplicada em produção em 06/08** (`20260806_custo_documental_vinculo`,
estritamente aditiva, rollback validado). O schema está pronto; o código está no
commit `51395017`, ainda sem deploy da aplicação.

**Falta** só o cadastro (R-01): Matriz, componentes econômicos, configuração
financeira de custo, preços de custo, fornecedores. R-03 está fechado.

**Afeta** `ObrigacaoEconomica` (7 colunas + snapshot + índices — **aditivo**),
`matriz-economica.ts`, `outbox-dispatcher.ts`, `documento-operacao.ts`,
`ledger-service.ts`, `consultas.ts`, `planilha-documental.ts` (novo),
`ProcessoFinanceiroShell.tsx`, `PlanilhaDocumentalView.tsx` (novo).

**Conclui quando** um processo real com registro localizado mostra custos na aba
Custos e linhas somadas na Planilha, e a reconciliação não acusa ausência.

**Bloqueada por** Fase 4 (cadastro) + R-03 (deploy).

---

## Fase 7 — Reconciliação geral

**Entra** unificar `reconcileDocumentChain`, `reconciliarDocumentalFinanceiro` e
as reconciliações existentes (materialização, passo↔tarefa, econômica) num
comando único agendável, com relatório consolidado e sem reparo ambíguo.

**Afeta** `src/services/`, cron novo. **Sem migration.**

**Conclui quando** roda em cron e o relatório fica estável.

**Bloqueada por** Fases 3 e 6.

---

## Fase 8 — Experiência operacional

Central respondendo quem / documento / tarefa / responsável / prazo / pendência /
próximo passo / custo previsto / bloqueio, **preservando o layout aprovado**.
Nenhum nome de tabela, mensagem Prisma ou ID sem contexto na tela.

**Afeta** componentes da Central. **Sem migration.** **Bloqueada por** Fase 6.

---

## Fase 9 — Observações, comentários e histórico

Append-only já vale para observações. Entra: comentários com menção e resolução;
histórico por `eventTypeId` (sem texto improvisado no front); auditoria separada
do operacional.

**Afeta** `DocumentoObservacao`, `WorkflowEvento`, componentes de aba.
**Migration provável** (entidade de comentário). **Bloqueada por** Fase 8.

---

## Fase 10 — Alertas e SLA

Alertas por **evento canônico**, nunca por polling textual. Cada alerta com tipo,
gravidade, entidade, responsável, vencimento, ação recomendada, estado, resolução
e histórico.

**Afeta** entidade de alerta (**migration**), cron, Central. **Bloqueada por**
Fases 7 e 9.

---

## Fase 11 — Painel gerencial

Indicadores com **definição oficial documentada** — nenhum número sem fonte
rastreável. Inclui custo previsto × realizado, margem, custo por
pessoa/documento/serviço/fase/fornecedor/nacionalidade.

**Afeta** rotas de leitura e telas novas. **Sem migration** (agregação sobre o
Ledger). **Bloqueada por** Fase 6 com dados reais.

---

## Fase 12 — Modelos documentais (ampliação)

Contratos, declarações, requerimentos, autorizações, formulários e notificações
pelo **mesmo** motor já congelado das procurações.

**Afeta** `ModeloDocumental` (dados), sem novo gerador. **Bloqueada por** nada —
pode andar em paralelo a partir da Fase 2.

---

## Fase 13 — Segurança

Fecha R-04; audita IDOR, URLs assinadas, MIME real, tamanho, dados pessoais em
log, segredos, variáveis Vercel, banco Preview × Produção; blinda produção contra
`db push`, `migrate reset`, seed destrutivo e host errado (o `db-guard` já cobre
parte).

**Afeta** rotas, `scripts/db-guard.mjs`, `middleware.ts`. **Bloqueada por** Fase 1.

---

## Fase 14 — Observabilidade

Logger estruturado com `eventType`, `entityType`, `entityId`, `processId`,
`personId`, `documentId`, `workflowId`, `stepId`, `taskId`, `userId`,
`correlationId`, `status`, `duration`, `errorCode`. Health checks separados.
Painel de erros. Fecha D-08.

**Bloqueada por** Fase 13.

---

## Fase 15 — Performance

**Medir antes de otimizar.** N+1, consultas duplicadas, listas sem paginação,
render excessivo, queries da Central/árvore/financeiro/anexos. Índice só com
evidência. Cache **nunca** para mascarar inconsistência.

**Bloqueada por** Fase 14 (sem medição, não se otimiza).

---

## Fase 16 — Automações

Lembrete de cartório, alerta de SLA, cobrança, geração documental, criação de
custos, notificações, reprocessamento e reconciliação agendada — todas
idempotentes, auditáveis, configuráveis e **desligáveis**.

**Bloqueada por** Fases 10 e 14.

---

## Fase 17 — Portal do cliente

Só depois do núcleo validado. Sem expor nota interna, auditoria, tarefa interna,
dado de terceiro ou documento restrito.

**Bloqueada por** todas as anteriores.

---

## Ordem de execução

```
0 🔒 → 1 → 2 → 3 → 4 (negócio) → 5 → 6 → 7 → 8 → 9 → 10 → 11
                    ↘ 12 (paralelo a partir da 2)
                       13 → 14 → 15 → 16 → 17
```

**Caminho crítico real:** a Fase 4 depende de **decisão de negócio**, não de
engenharia. Enquanto ela não anda, a Fase 6 fica com a máquina pronta e a tela
vazia — que é o estado honesto, não um defeito.
