# Testes pendentes (fora da suíte crítica)

Lista dos arquivos de `scripts/*.test.ts` que **falham hoje** num banco montado com as migrations de
produção (`scripts/ci/criar-banco-de-teste.mjs`) e **não** fazem parte da suíte crítica
(`scripts/ci/suite-critica.json`, a única que trava o deploy). Gerada em 29/09/2026 a partir de
`npm run test:suite -- --todas` (418 arquivos: 262 passam, 156 falham, todos fora da crítica).

**Uma linha por arquivo: o primeiro sintoma no log.** Ainda não foram triados nem consertados — é a
matéria-prima de uma rodada futura. Para cada um a triagem deve classificar: (a) teste desatualizado,
(b) fixture/setup dependia de dado ausente ou de banco permissivo, (c) bug real de produto,
(d) impossível no gate por motivo alheio (`// SUITE: isolado — <motivo>`). Ao consertar, mova o arquivo
para a suíte crítica se ele for de motor/operação/sino/guards. Regra: CLAUDE.md §36.

Reproduzir um deles: `node scripts/ci/rodar-suite.mjs --todas --so <nome> --workers 1`.

Achados de produto já registrados (rodam com `pendenteDeDecisao()`, dentro da suíte crítica):
`materializacao-fase-unica` (SUPERSEDIDO tratado como encerrado em `pendencias-transversais-core.ts:64`) e
`mover-fase-manual` (ação "Movimentar fase" sumiu do menu do processo).

## Arquivos (156)

- `abas-central-operacional.test.ts` — asserção falha: 7. "Reabrir etapa" continua funcionando
- `arquitetura-financeira-guard.test.ts` — asserção falha: descrição derivada da nacionalidade do tipo de processo
- `arquitetura-referencias.test.ts` — asserção falha: Cartorio.responsavel — String? representando usuário. Use usuarioId → Usuario.
- `arvore-membership.test.ts` — o próprio teste se recusa a rodar neste banco: ABORTADO: conectado a "discovery_test_ci_w2". Este teste ESCREVE.
- `arvore-preview-impacto.test.ts` — o próprio teste se recusa a rodar neste banco: ABORTADO: conectado a "discovery_test_ci_w0", não a "kanban_test".
- `assistente-parametrizacao.test.ts` — PrismaClientUnknownRequestError:
- `cadastro-canonico.test.ts` — asserção falha: a validação jurídica sabe
- `cadastro-integral.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `calendario-unico.test.ts` — asserção falha: nenhum <input type="date"> nativo — src/components/operacao/RepactuarPrazoModal.tsx
- `cancelamento-operacao-documento.test.ts` — asserção falha: 4a) não entra em 'total' (Abertas) — 1
- `casamento-por-uniao.test.ts` — Error: banco de teste sem NENHUM TipoProcessoNacionalidade — rode um teste de integração de processo primeiro (ex.: motor-documental-idempotencia) pra semear, o
- `catalogo-fases-gerenciamento-completo.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `catalogo-oficial.test.ts` — asserção falha: preço que só começa amanhã não vale hoje
- `catalogo-servicos-homolog.test.ts` — asserção falha: documentos do mestre continuam acessíveis na tela oficial (0)
- `catalogo-servicos-unificado.test.ts` — asserção falha: DELETE do mestre segue recusando item em uso
- `central-operacional-loading.test.ts` — asserção falha: sem dado fictício
- `central-operacional-tarefa-canonica.test.ts` — PrismaClientUnknownRequestError:
- `central-projecao-fase.test.ts` — asserção falha: §17) o padrão põe o bloqueio na frente
- `completude-documental-unificacao.test.ts` — asserção falha: aplicável (fase de escopo DOCUMENTO)
- `concorrencia-adversarial.test.ts` — violação de unicidade em ('chaveDerivacao')
- `condicao-aplicabilidade.test.ts` — asserção falha: bloco 1 — Direção e vigência
- `contraprova-granularidade-multipessoa.test.ts` — PrismaClientKnownRequestError:
- `cp4.test.ts` — asserção falha: phase-workflow: usa tx externa ou abre a própria
- `criar-processo-materializa-subtarefas.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `criar-processo-v2.test.ts` — asserção falha: Nenhum Tipo de Processo com modalidade habilitada e Workflow Macro publicado para o país "alemanha" — seed do banco de teste desatualizado.
- `custo-documental.test.ts` — PrismaClientUnknownRequestError:
- `custo-f0.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f1.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f2.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f3-ciclo.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f3-e2e-motor.test.ts` — PrismaClientUnknownRequestError:
- `custo-f3-espelho.test.ts` — Foreign key constraint violated on the constraint: 'Custo_processoId_fkey'
- `custo-f3-pagar.test.ts` — Foreign key constraint violated on the constraint: 'Custo_processoId_fkey'
- `custo-f35-motor.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f41-estado.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f42-transicoes.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f43-acoes.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f51-contas-pagar.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f52-cronograma.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f53-comprovante.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f54-repasse.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f55-integracao.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f5ui-cronograma.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f5ui-dashboard.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f5ui-repasse.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f6-integracao.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f72-reprovar.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f75-pagar-exportar.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-f81-inteligencia.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `custo-matriz-permissoes.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `cutover-financeiro.integration.test.ts` — ERRO (rollback garantido): Error: sem TipoDocumento com itemCatalogoId para o teste
- `distribuicao-500-tarefas.test.ts` — PrismaClientKnownRequestError:
- `documento-nasce-com-necessidade.test.ts` — asserção falha: Documento #2260 (óbito, cartório/livro/folha reais) → true
- `drawer-operacional-fonte-unica-guard.test.ts` — asserção falha: drawer consome /operational-projection (fonte única)
- `e2e-cadastro-integral-http.test.ts` — TypeError: fetch failed
- `e2e-master.test.ts` — asserção falha: Análise publicável
- `elegibilidade-capacidade.test.ts` — PrismaClientKnownRequestError:
- `entrega-transversal-guard.test.ts` — asserção falha: reconciliação ligada no phase.entered (idempotente)
- `equivalencia-portas-etapa.test.ts` — asserção falha: 3) porta de tarefa: continua UMA tarefa — 2
- `escopo-operacional-contrato.test.ts` — asserção falha: 2e) ADMIN vê a tarefa de Donato (sem responsável) na base
- `escopo-processo-reancoragem.test.ts` — asserção falha: B) continua sendo 1 única Tarefa (sem duplicar)
- `estrutura-operacional-integracao.test.ts` — asserção falha: certidão de casamento (sujeito UNIÃO) fica com o titular certo
- `estrutura-operacional.test.ts` — asserção falha: a aba tem uma consulta oficial única do backend
- `etapa-nao-e-tarefa.test.ts` — asserção falha: §31) 1 Tarefa — 2 tarefa(s)
- `etapa2b-editor-rascunho-nao-vaza.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `etapa6-circuito-completo.test.ts` — Foreign key constraint violated on the constraint: 'Tarefa_responsavelId_fkey'
- `etapa6-fase-circuito.test.ts` — asserção falha: C) nenhuma Tarefa foi apagada no circuito inteiro (append-only)
- `etapa7-migracao.test.ts` — Foreign key constraint violated on the constraint: 'ObrigacaoEconomica_processoId_fkey'
- `excluir-receita-lista.test.ts` — Foreign key constraint violated on the constraint: 'Receita_processoId_fkey'
- `extrato-ledger.test.ts` — saiu com código 1 sem mensagem de falha
- `fase-vazia-explica.test.ts` — asserção falha: com destaque de atenção, não como texto solto
- `fases-catalog.test.ts` — TypeError: Cannot read properties of undefined (reading 'stepKey')
- `fila-ciclo-de-vida.test.ts` — asserção falha: em POUCAS consultas — não uma por tarefa — 19 consulta(s) para 121 tarefas
- `financeiro-client-server-guard.test.ts` — asserção falha: nenhum componente cliente alcança o Prisma (1)
- `financeiro-debito-tecnico-guard.test.ts` — asserção falha: nenhuma tela lê o token direto do localStorage (src/components/financeiro/v3/ConfiguracaoPlanilhaDocumental.tsx, src/components/financeiro/v3/Planilha
- `forma-pagamento-guard.test.ts` — asserção falha: identidade premium (OURO)
- `genealogia-abrir-operacao-guard.test.ts` — asserção falha: reusa Documento existente da necessidade (idempotência)
- `genealogia-fatia1-guard.test.ts` — asserção falha: fases-catalog GENEALOGIA usa stepKey localizar_registro (não buscar_documento)
- `genealogia-regras-canonicas.test.ts` — asserção falha: a fase aceita mais de uma natureza (0)
- `genealogia-troca-drawer-guard.test.ts` — asserção falha: faseCodeData lê data.faseProgress.faseCode
- `guard-frontend-nao-e-motor.test.ts` — asserção falha: o mapa decisão→status do documento só roda sem configuração cadastrada
- `guard-prazo-e-distribuicao.test.ts` — asserção falha: §12) previsão do terceiro nunca é gravada como dataPrazo — src/lib/relatorios/motor/dominios/certidoes.ts, src/services/solicitacao-documento.ts
- `guard-protocolo-writer-unico.test.ts` — asserção falha: autorizado: src/app/api/protocolos/[protocoloId]/exigencias/[exigenciaId]/route.ts — escreve Protocolo fora da porta:
- `guard-writers-canonicos.test.ts` — asserção falha: ninguém escreve TENTATIVA DE EXECUÇÃO fora das portas — src/services/efeitos-de-dominio.ts — é onde a substituição preserva o que a execução anterior 
- `guarda-escrita-producao.test.ts` — asserção falha: build não contém "prod-migrate-guard"
- `home-guard.test.ts` — asserção falha: acento da marca é o verde Bitrix (#29cc5c)
- `home-total-acoes-deduplicado.test.ts` — asserção falha: 2a) Σ fila.quantidade = 2 para UM único step — este era o bug real ('35 ações' da auditoria) — 3
- `idempotencia-lancamento.test.ts` — asserção falha: 4) chave de trigger: processoId::phaseKey::trigger::id
- `identidade-operacional.test.ts` — asserção falha: §13) a política de pausa vem do workflow publicado
- `int-financeiro-db.test.ts` — Foreign key constraint violated on the constraint: 'Pagador_pessoaId_fkey'
- `int-p0-motor-db.test.ts` — saiu com código 1 sem mensagem de falha
- `int-receita-manual-db.test.ts` — asserção falha: cria 2 Receitas (uma por participante) — não 1 obrigação "nativo" (ok=false)
- `invariante-documental.test.ts` — asserção falha: 13. os DOIS caminhos de materialização (nova e convergência) passam o contrato
- `isolamento-50-certidoes.test.ts` — PrismaClientUnknownRequestError:
- `management-nav.test.ts` — asserção falha: Processos › Cadastros = Tipos de Processo, Modalidades, Modalidades Legais, Enquadramentos Legais, Países e Regiões
- `mandato-110-testes.test.ts` — violação de unicidade em ('documentoId','url')
- `mandato-20-adversariais.test.ts` — asserção falha: Cenário P lançou exceção: PrismaClientKnownRequestError:
- `mandato-e2e-38-passos.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `mandato-pausa-relogios.test.ts` — asserção falha: A.2) status vira BLOQUEADA (única transição legal para fora da precedência atual) — AGUARDANDO_TERCEIRO
- `mandato-rascunho-publicacao.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `matriz-estados-requerente.test.ts` — asserção falha: Rode com FINANCEIRO_DUAL_WRITE=1 — sem o espelho V3 o Financeiro não é comparável.
- `minha-operacao-semantica.test.ts` — Error: publicação falhou: {"ok":false,"code":"PUBLICACAO_INVALIDA","problemas":[{"codigo":"EFEITO_FORA_DE_COMPETENCIA","stepKey":"solicitar_certidao","mensagem"
- `modelos-documentais-e2e.test.ts` — asserção falha: 0.1 os dois modelos oficiais estão publicados
- `motor-documental-idempotencia.test.ts` — asserção falha: Total: 1 \| ✅ 0 \| 1
- `motor-fases-passos.test.ts` — Foreign key constraint violated on the constraint: 'MatrizDocumental_tipoProcessoId_fkey'
- `motor-financeiro-fase3-guard.test.ts` — asserção falha: writes legados guardados (exceto simular e já-405) — desprotegidos: src/app/api/financeiro/planilha-colunas/[id]/route.ts, src/app/api/financeiro/plan
- `motor-operacional-fases.test.ts` — asserção falha: a obrigação virou UMA tarefa — 2
- `motor-prazo-ancoragem-subtarefas.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `mrg-arquitetura-guard.test.ts` — asserção falha: nenhum arquivo visual da árvore foi alterado → ["src/components/arvore/arvore-genealogica-view.tsx","src/components/arvore/couple-card.tsx","src/compo
- `navegacao-operacional.test.ts` — asserção falha: §16) a linha alvo recebe realce
- `operacao-escopo-fase-guard.test.ts` — asserção falha: passosOperacaoV2 filtra por faseMacroKey = fase atual
- `operacao-materializacao-auto-guard.test.ts` — asserção falha: reusa a operação existente (idempotente, não recria)
- `operacao-progressao-por-documento-guard.test.ts` — asserção falha: acha a próxima etapa do próprio documento
- `operacao-v3-projecao.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `operational-projection.test.ts` — asserção falha: bloqueado NUNCA 100% (foi 100%)
- `organizacao-capacidade.test.ts` — PrismaClientKnownRequestError:
- `passo-tarefa-coerencia.test.ts` — asserção falha: nenhuma rota fora de /api/tarefas escreve responsável de tarefa — src/app/api/documentos/[id]/route.ts, src/app/api/operacao/tarefas/vincular-orgao-lo
- `pendencias-a-e.test.ts` — asserção falha: (C4a) o cadastro por pedido publica — {"ok":false,"code":"PUBLICACAO_INVALIDA","problemas":[{"codigo":"EFEITO_FORA_DE_COMPETENCIA","stepKey":"preparar
- `performance-escala.test.ts` — asserção falha: existe a trava de uma tarefa viva por etapa — Tarefa_pkey Tarefa_publicCode_key Tarefa_chaveIdempotencia_key Tarefa_tipo_idx Tarefa_pessoaId_idx Taref
- `pessoa-ciclo-vida.test.ts` — asserção falha: hard delete contra fato protegido RECUSA (não vira desativação silenciosa)
- `planilha-documental-projecao.test.ts` — 💥 PrismaClientUnknownRequestError:
- `porta-unica-requerente.test.ts` — asserção falha: Rode com FINANCEIRO_DUAL_WRITE=1 — sem o espelho V3 o Financeiro não é comparável.
- `pre-cadastro-guards.test.ts` — PrismaClientUnknownRequestError:
- `preco-fonte-unica.test.ts` — asserção falha: vigências disjuntas → NÃO conflita
- `preco-por-config.integration.test.ts` — ERRO (rollback): Error: sem ProdutoFinanceiro (com custo) para teste
- `prisma-pool-guard.test.ts` — asserção falha: só lib/prisma.ts instancia PrismaClient → ["src/app/api/saude/banco/route.ts"]
- `profissional-e-judicial.test.ts` — asserção falha: 'processoNum' é do pedido, e nenhuma entidade vazia foi criada para ele
- `progresso-subtarefa-empate-ordem.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `protocolo-obrigatorio-confirmacao.test.ts` — Error: Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.
- `prova-pasta-documental-linha-do-tempo.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `prova-solicitar-certidao-4-subtarefas-executores.test.ts` — asserção falha: 7.1) dataPrazo idêntico ao original (nenhuma subtarefa criou/moveu vencimento) — {"original":"2026-10-15T00:50:54.613Z","final":"2026-10-15T00:50:54.7
- `receber-certidao-segunda-espera.test.ts` — asserção falha: 01) publicação sucede com os dois passos marcados — {"ok":false,"code":"PUBLICACAO_INVALIDA","problemas":[{"codigo":"EFEITO_FORA_DE_COMPETENCIA","step
- `receita-venc-move.test.ts` — Foreign key constraint violated on the constraint: 'Receita_processoId_fkey'
- `reconciliacao-derivada-requerente.test.ts` — asserção falha: Rode com FINANCEIRO_DUAL_WRITE=1 — o espelho V3 é metade do defeito testado aqui.
- `reconciliacao-edicao-fase-atual.test.ts` — violação de unicidade em ('stepInstanceId','subtaskKey','sequencia')
- `reconciliacao-escopo-documento.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `reconciliacao-workflow-emissao-documental.test.ts` — saiu com código 1 sem mensagem de falha
- `reconciliacao-workflow-interno-fase-atual.test.ts` — violação de unicidade em ('macroWorkflowId','phaseKey')
- `regras-documentais.test.ts` — asserção falha: 19) regra futura respeita vigência
- `relatorios-canonico.test.ts` — asserção falha: o export reusa a MESMA consulta da tela
- `relatorios-certidoes-extensao.test.ts` — asserção falha: 20 necessidades REGISTRO_CIVIL no Cibils (mesma contagem da investigação) — 0
- `relatorios-motor.test.ts` — asserção falha: Brasil existe no cadastro de países
- `resolver-preco-financeiro.integration.test.ts` — Foreign key constraint violated on the constraint: 'TabelaValor_processoId_fkey'
- `revalidacao-lista-guard.test.ts` — asserção falha: há 1 handlers onDone de ação rápida (>=8)
- `saude-motor.test.ts` — asserção falha: todo job agendado tem verificação que o vigie (inclusive o próprio cron da saúde)
- `solicitacao-documental.test.ts` — asserção falha: 22. o vínculo canônico protocolo↔documento é gravado
- `ssr-hidratacao.test.ts` — asserção falha: src/app/activities/page.tsx existe
- `tarefa-unidade-operacional.test.ts` — asserção falha: existe exatamente UMA tarefa no processo
- `tarefas-projetos-marco-gerencial.test.ts` — asserção falha: 8a) filtro dataTipo=concluida (hoje→hoje) encontra as MESMAS concluídas que o indicador sem filtro — indicador 10 · filtro aplicado 0
- `taxa-pagamento-guard.test.ts` — asserção falha: vigência invertida falha
- `taxas-encargos.test.ts` — asserção falha: fora de vigência não aplica
- `tx-conexao-unica.test.ts` — asserção falha: as três leituras passaram para 'db'
- `validacao-composicao-macro.test.ts` — PrismaClientUnknownRequestError:
- `versao-publicada.test.ts` — violação de unicidade em ('processoId','faseMacroKey')
- `visao-gerencial-global.test.ts` — asserção falha: §20) nome de pessoa vem em lote
- `workflow-documental-completo.test.ts` — asserção falha: §17) 1 documento = 1 Tarefa — 2
