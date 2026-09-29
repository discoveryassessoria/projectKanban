# 33 — O sino agrupado (redesenho de 29/09/2026)

**Princípio:** o sino mostra o que é NOVO desde a última vez que a pessoa olhou. A lista de
pendências é a Operação. Nunca um aviso por certidão.

## Modelo
`NotificacaoOperacional` (colunas aditivas, migration `20260929230000_sino_aviso_agrupado`):
`agrupado`, `contagem`, `tarefaIds[]`, `resumo` (JSON), `atualizadoEm`. `processoId` = FAMÍLIA
nas linhas agrupadas. Índice único parcial `NotificacaoOperacional_um_aberto_por_familia_tipo`
(`destinatarioId, COALESCE(processoId,0), tipo WHERE agrupado AND lidaEm IS NULL`) — um aviso
NÃO LIDO por (pessoa, família, tipo), garantido pelo banco; a aplicação serializa com
`pg_advisory_xact_lock`.

## Tipos
| Quem | Tipo | Nasce de | Texto |
|---|---|---|---|
| operador | CHEGOU_TRABALHO | atribuir / criar já atribuída | `<Família> — N tarefas atribuídas a você` |
| operador | PRECISA_AGIR | resumo 07:00 + varredura horária | `<Família> — X vencidas · Y vencem hoje · Z vencem amanhã · W cobranças a fazer` |
| operador | MUDOU_DE_MAO | remover / reatribuir | `<Família> — N tarefas saíram da sua fila` |
| gestor | ESCALADA · SEM_RESPONSAVEL (>1 dia) · INTEGRIDADE (crítica) · FASE_CONCLUIDA | `precisaDeVoce` (função única, reutilizável pela Torre) / fase concluída | por família |

## Regras
1. Um aviso aberto por (pessoa, família, tipo); fato novo SOMA nele e o leva ao topo.
2. "Viu, saiu": clicar marca lido e tira do contador; "Marcar todas como lidas"; não clicado expira em 7 dias; lido fica em "Ver anteriores" 30 dias.
3. Depois do clique só reaparece com fato NOVO ("Cibils — 1 nova vencida"); o resumo das 07:00 recompõe a foto do dia.
4. Regra 5 (posse): tarefa reatribuída, removida, concluída, cancelada ou supersedida sai do aviso na hora
   (`sincronizarAvisosDeTarefas`, chamado pelas portas e, como rede de segurança, na leitura do sino).
5. O GET do sino lê SÓ a tabela — nenhum balde recalculado de Tarefa.
6. Links: `/operacao?processo=<id>&aba=fila|acompanhamento`, `/operacao?processo=<id>`; nunca `/kanban`.
   `OperacaoV3` lê `?processo=` e `?aba=`, filtra a família e destaca as "novas" (`/api/operacao/novas`).

## Crons
`/api/cron/resumo-diario` — `0 10 * * *` UTC = 07:00 America/Sao_Paulo (Brasil sem horário de verão;
se voltar, passa a `0 9 * * *`). `/api/cron/avisos-prazo` — de hora em hora, só fato novo + posse + expurgo.

## Porta única
Só `lib/operacional/notificacao-canonica.ts` escreve a tabela (`somarAoAviso`, `gravarFotoDoAviso`,
`sincronizarAvisosDeTarefas`, `marcarTodasComoLidas`, `expurgarAvisos`, `removerAviso`).
`notificarAcontecimento` é legado sem chamador. Guard: `scripts/guard-sino-agrupado.test.ts`.
Testes: `scripts/sino-agrupado.test.ts`.

## Migração dos dados
`scripts/migrar-sino-agrupado.ts` — ENSAIO por padrão (backup em `~/.discovery-backups`), `--aplicar` só com
confirmação e com as colunas novas já no banco.
