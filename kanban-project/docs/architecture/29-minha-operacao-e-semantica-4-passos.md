# 29 — Minha Operação e a semântica canônica dos 4 passos da Emissão Documental

**Data:** 15/09/2026
**Supersede:** a leitura de "5 stepKeys reais" em `docs/architecture/27-emissao-documental-estado-real-e-minha-operacao.md` e em `20-emissao-documental-diagnostico.md` — correta na época, hoje histórica.

## 1. Decisão de negócio definitiva

A Emissão Documental tem **exatamente 4 passos operacionais**:

1. `solicitar_certidao` — Enviar requerimento ao cartório
2. `aguardar_retorno_do_cartorio` — Receber confirmação do pedido
3. `receber_certidao` — Receber e digitalizar a certidão
4. `conferir_e_validar_certidao` — Conferir e validar certidão

Não existe passo 5. Os antigos `conferir_certidao`/`validar_certidao` foram unificados no passo 4 como **duas subtarefas do mesmo Step** (`StepSubtaskDefinition`/`SubtaskExecution`, `regraDeConclusao=TODAS_SUBTAREFAS_OBRIGATORIAS` — o mesmo mecanismo já usado por `solicitar_certidao`). Progresso: sempre `1/4`→`4/4`, nunca `X/5`.

## 2. Responsabilidade do passo 4 — sem handoff automático

**O passo 4 é executado integralmente por quem detém a Tarefa** (em produção, hoje, Daniela). Ela confere, executa o checklist, decide VALIDADA/NÃO VALIDADA e conclui o passo. **Não existe handoff automático para Marco/Admin.** Reatribuição (`atribuirTarefa`/`transferirTarefa`) continua existindo como capacidade **genérica e opcional** do motor — útil para uma exceção configurada à parte, em qualquer fase, em qualquer passo — mas nada no passo 4 a aciona sozinha. Prova: `scripts/correcao-4-passos-unificado.test.ts` itens 09-14 (Daniela sozinha, sem handoff) e 19-21 (reatribuição manual como capacidade genérica, isolada).

## 3. Histórico legítimo × estado atual inválido

Tarefas concluídas/canceladas **antes** da unificação (14/09/2026) podem legitimamente ter 5 `PhaseWorkflowStepInstance` — fato histórico, nunca reescrito, nunca apagado. Um documento com Tarefa ainda **aberta** e 5 passos é o defeito real. `EMI-021` (`lib/saude/verificacoes/emissao-documental.ts`) distingue as duas coisas: só entra no alcance quando a `Tarefa` do documento não está em status terminal — uma `PhaseWorkflowInstance` é compartilhada por vários documentos da mesma fase, então checar só o status da instância (sempre "ATIVO") capturaria histórico por engano. `EMI-022` vigia operações sem próxima ação determinável.

## 4. Unidade canônica — não alterado, reforçado

Uma obrigação operacional/documental = **uma Tarefa canônica**. Steps, estados de espera, follow-ups, retornos e decisões internas **não criam novas Tarefas**. "Aguardar cartório", "Acompanhar cartório", "Retorno recebido" nunca são materializados como Tarefa — são condição (`statusTarefa`, `coluna`) e projeção (`proximoAcontecimento`) da MESMA `taskId`.

> **Regra permanente:** uma Tarefa representa uma obrigação operacional. Steps, estados de espera, follow-ups, retornos e decisões internas não criam novas Tarefas, salvo quando o modelo de negócio definir explicitamente uma obrigação independente.

> **Regra permanente:** `AGUARDANDO_TERCEIRO` é estado operacional de uma Tarefa existente, nunca uma Tarefa criada apenas para representar espera.

> **Regra permanente:** a próxima ação deve descrever semanticamente o que precisa acontecer; prazo isolado não substitui ação operacional.

## 5. AGUARDANDO_TERCEIRO, follow-up, retorno — motor único

Fonte única: `lib/operacional/proximo-acontecimento.ts::computarProximoAcontecimento` (núcleo puro, testado sem banco em `scripts/proximo-acontecimento.test.ts`, 53/53). Devolve, para toda Tarefa aberta:

- `proximoAcontecimento.tipo`: `acao_interna | aguardando_terceiro_acompanhamento | aguardando_terceiro_previsao | retorno_recebido | acompanhamento | em_risco | encerrada`
- `proximoAcontecimento.descricao`: a AÇÃO, em linguagem humana — **composta a partir do rótulo publicado do passo** (`etapaLabel`, resolvido via `stepDefinitionId`/snapshot, o mesmo mecanismo de `rotuloDoPasso`) quando o passo é executável agora, nunca mais só "Responsável deve agir até X". A data continua disponível separadamente em `proximoAcontecimento.data` — quem lê decide se mostra como contexto secundário.
- `motivosRisco`: códigos técnicos estáveis (`CONFLITO_PRAZO_TAREFA_PASSO`, `ACOMPANHAMENTO_VENCIDO`, `SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL`, `SEM_RESPONSAVEL_PARA_PROXIMA_ACAO`, `RETORNO_SEM_ACAO_INTERNA`, `CONFLITO_RETORNO_TERCEIRO`, `AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO`) — diagnóstico, nunca mensagem operacional principal.

Nenhuma tela recalcula esta leitura. `LinhaDeFila`/`LinhaGerencial` (`tarefa-projecoes.ts`) e `dossieDaTarefa()` só consomem o resultado já pronto (`comAtencaoTemporal`).

## 6. Humanização de risco

`lib/operacional/atencao-operacional.ts::humanizarMotivoRisco(motivo)` traduz o código técnico (com detalhe dinâmico após `:`) para uma frase operacional (`HUMANIZACAO_RISCO`). O código técnico não é apagado — fica disponível como `title`/tooltip administrativo (`minha-operacao-detalhe.tsx`, seção "Pontos de atenção"). Módulo puro, sem `prisma` — importável por cliente e servidor.

## 7. As 4 dimensões temporais — preservadas, nunca uma só

1. Prazo da Tarefa/operação (`dataPrazo`)
2. SLA do passo atual (`PhaseWorkflowStepInstance.prazo`)
3. Previsão do terceiro (`SolicitacaoDocumento.previsaoRetorno`)
4. Próximo acompanhamento (`metadata.operacao.proximoAcompanhamento`)

`CONFLITO_PRAZO_TAREFA_PASSO` existe exatamente para quando 1 e 2 divergem — nunca escolhido um sozinho por acaso.

## 8. Atraso interno × atraso de terceiro — nunca confundidos

`atrasoInterno` nasce só de prazo interno vencido **fora** de espera externa. `atrasoTerceiro` nasce só de previsão do terceiro vencida. Daniela que fez os follow-ups corretamente nunca aparece como atrasada por um cartório lento — são dois booleanos independentes, nunca colapsados.

## 9. Categorias de atenção e ranking — módulo único

`lib/operacional/atencao-operacional.ts` (puro, sem `prisma`, importável por servidor e cliente):

- `categoriasDaLinha(l)`: as 8 categorias (`paraAgirAgora`, `novasAtribuicoes`, `acompanharHoje`, `atrasoInterno`, `terceirosAtrasados`, `aguardandoTerceiros`, `retornoRecebido`, `emRisco`) — não exclusivas, derivadas dos mesmos booleanos canônicos que `central-tarefas.tsx` já usava como `FILTROS`.
- `ordenarPorAtencaoOperacional(linhas)`: ranking determinístico (atraso interno crítico → atraso interno → follow-up vencido → retorno recebido → ação hoje → nova atribuição → em risco → aguardando terceiro → demais; empate por prazo, depois `taskId`).
- `rotuloDeAtencao(l)`: o badge da primeira coluna da tabela (Crítico/Atrasado/Atenção/Hoje/Urgente/Em risco/Aguardando/Normal) — mesma régua do ranking, nunca uma prioridade paralela.

## 10. Notificações × atenção — independência preservada

`NotificacaoOperacional` (`lib/operacional/notificacao-canonica.ts`) é fonte de dados própria. Nenhum campo de `LinhaDeFila`/`dossieDaTarefa` lê notificação. Avançar um Step mantendo o mesmo responsável não gera `ATRIBUICAO`/`TRANSFERENCIA` (prova: `scripts/handoff-4-passos.test.ts` item 11 — só 2 notificações de responsabilidade no cenário completo, nunca uma por passo concluído). Ler/excluir notificação não altera a Tarefa nem a fila.

## 11. Filtros server-side

`GET /api/operacao/tarefas?visao=minha_fila` aceita `busca` (pessoa/família/processo/documento/terceiro/protocolo — mesma leitura de `whereGerencial`), `fase`, `terceiro`, `prazo` (`atrasadas|hoje|7dias`) como query string — entram no `where` do banco via `FiltrosGerenciais`, **antes** da paginação. `minhaFila()` ganhou um 4º parâmetro opcional (`Omit<FiltrosGerenciais, 'responsavelId'|'porPagina'>`) para isso. A categoria de atenção (KPI/chip) continua client-side por ser estado composto, não coluna do banco — filtra sobre o universo já filtrado pelo servidor, mesmo padrão dos `TILES` de Tarefas e Projetos.

## 12. Deep-link

`urlOperacionalDaTarefa({taskId, processoId})` (`lib/operacional/navegacao.ts`) é a única função de deep-link — usada por Minha Operação, Tarefas e Projetos, Kanban e notificações. Preserva `faseVisualizada ≠ faseAtiva`: consulta nunca é transição do motor.

## 13. Painel de detalhe = `dossieDaTarefa()`

Nenhuma projeção nova: `lib/operacional/tarefa-projecoes.ts::dossieDaTarefa(tarefaId)` já existia e virou o backend do painel lateral (`src/components/operacao/minha-operacao-detalhe.tsx`). Rótulo do passo com fallback por `stepDefinitionId` (uma instância reconciliada sem `snapshot` não cai mais na chave técnica crua).

## 14. Testes

- `scripts/correcao-4-passos-unificado.test.ts` (32/32): 4 passos, subtarefas, Daniela sem handoff, reatribuição como capacidade genérica.
- `scripts/teste-reconciliacao-4-passos.ts` (20/20): reconciliação segura, pareamento por documento (não por instância compartilhada).
- `scripts/handoff-4-passos.test.ts` (24/24): capacidade genérica de transferência, fixture sintético — não é o fluxo padrão.
- `scripts/proximo-acontecimento.test.ts` (53/53): núcleo puro da leitura temporal, incluindo o novo `etapaLabel`.
- `scripts/prod-smoke-4-passos-emissao.ts`: HTTP real (JWT + permissões + banco de produção) — 17/17 contra documentos reais.

## 15. Limitações conhecidas (não escondidas)

- Paginação de Minha Operação continua client-side sobre o resultado já filtrado pelo servidor — dataset por pessoa, bounded.
- "Salvar visão" não implementado para Minha Operação (existe para Tarefas e Projetos via `RelatorioVisao`, domínio `tarefas-e-projetos`; reaproveitar exigiria um domínio novo — não fizemos por não ser bloqueio do mandato).
- A composição de "próxima ação" usa o rótulo publicado do passo (`etapaLabel`) + template genérico por estado — não um texto por `stepKey` individual (deliberado, para não hardcodar regra de negócio no motor); o resultado é correto e humano, mas menos artesanal que um texto escrito à mão por passo.
