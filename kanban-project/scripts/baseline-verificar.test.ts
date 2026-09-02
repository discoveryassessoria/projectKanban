/**
 * GUARDA — prisma/baseline/baseline.sql em dia com o prisma/schema.prisma.
 * Rodar: npm run test:baseline   (roda tambem no build)
 *
 * O defeito que este teste trava: alguem altera o schema.prisma, o baseline
 * nao e regenerado, e a divergencia so aparece num desastre — quando o
 * baseline for a unica forma de reconstruir o banco e produzir um schema
 * diferente do real.
 *
 * NAO abre conexao com banco. Compara texto: regenera o corpo a partir do
 * schema.prisma (offline) + o bloco manual, e confere contra o commitado.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(RAIZ, 'prisma', 'baseline', 'baseline.sql')
const DIR_MIGRATIONS = join(RAIZ, 'prisma', 'migrations')
const MIGRATION = join(DIR_MIGRATIONS, '0000_baseline', 'migration.sql')

/**
 * Checksum registrado em `_prisma_migrations` de PRODUCAO para 0000_baseline,
 * consolidado em 02/08/2026. O Prisma guarda o sha256 do migration.sql; se o
 * arquivo mudar, ele passa a acusar "migration modificada depois de aplicada"
 * e o `migrate deploy` para.
 *
 * Mudar esta constante NAO conserta nada por si so: o ledger de producao
 * precisa ser reconciliado no mesmo movimento, de forma explicita e auditada.
 */
// RECONCILIACAO DO LEDGER — feita em 03/08/2026, junto com a migration ADITIVA
// 20260803d_mover_fase_manual (dois valores de enum: AdvanceResultado.MOVIDO e
// WorkflowEventoTipo.FASE_MOVIDA).
//
//   anterior : b0021b6e4e9b6ba07a137c271f8229bc122b6f6aaa4838402be09beb7e3ce4a3
//   atual    : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//
// Procedimento executado: backup do ledger -> conferencia de que o diff do baseline
// eram SO as duas linhas de CREATE TYPE (zero DDL destrutivo) -> UPDATE de UMA
// coluna na linha 0000_baseline -> `prisma migrate status` consistente -> `prisma
// migrate deploy`. Nenhuma outra migration foi tocada; contagens de processos,
// instancias, passos, tarefas, eventos e logs identicas antes e depois.
// ATUALIZACAO 04/08/2026 — migration ADITIVA 20260804_solicitacao_documental
// (SolicitacaoDocumento, DocumentoArquivo, DocumentoObservacao e duas colunas em
// Protocolo). O baseline foi regenerado e o checksum mudou:
//
//   anterior : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//   atual    : 81743bfef8cb44adfce7b4953d67026d95e65749e71ca8721a5df06bfe925491
//
// RECONCILIACAO DO LEDGER: NAO FOI POSSIVEL — e a razao importa. Em 04/08/2026 a
// tabela `_prisma_migrations` NAO EXISTE em nenhum dos bancos alcancaveis por
// PRISMA_DATABASE_URL nem por DIRECT_DATABASE_URL (verificado por
// information_schema). Nao ha linha 0000_baseline para atualizar, e
// `prisma migrate deploy` nesse estado tentaria aplicar o baseline inteiro sobre
// um schema que ja existe. Por isso a migration foi aplicada pelo caminho
// controlado de `scripts/aplicar-migration-aditiva.ts` (SQL aditivo, idempotente,
// numa transacao, com prova de identidade antes da escrita).
//
// PENDENCIA DECLARADA: quando o banco de producao com os dados voltar a estar
// acessivel, CONFERIR se ele tem `_prisma_migrations` e, se tiver, reconciliar o
// checksum da linha 0000_baseline antes de qualquer `migrate deploy`.
//
// PENDENCIA RESOLVIDA — 04/08/2026, junto com a migration ADITIVA
// 20260804b_requerimento_doc21_vinculo (DocumentoArquivo ganha protocoloId,
// documentTypeId, hashConteudo e as colunas de versao; nasce
// ExigenciaEvidenciaEtapa).
//
// O banco de producao voltou, e com ele a `_prisma_migrations`. A linha
// 0000_baseline estava com `6aa5afa5...` — o checksum ANTERIOR a regeneracao de
// 04/08 —, ou seja, a reconciliacao de entao realmente nao aconteceu. Os dois
// saltos foram fechados de uma vez:
//
//   ledger antes : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//   arquivo antes: 81743bfef8cb44adfce7b4953d67026d95e65749e71ca8721a5df06bfe925491
//   atual (ambos): c3b59b340c8b529cc31cc98c770622897a093bac3c4cc6bc154e1580682b4c43
//
// Procedimento executado: pg_dump completo de producao -> copia da tabela
// `_prisma_migrations` para CSV -> conferencia de que o diff do baseline eram 64
// linhas SO de INSERT (zero DDL destrutivo, zero linha removida) -> UPDATE de UMA
// coluna na linha 0000_baseline -> `prisma migrate status` consistente. Nenhuma
// outra migration foi tocada; nenhum dado de negocio foi lido ou alterado.
// ATUALIZACAO 04/08/2026 (contrato documental) — migration ADITIVA
// 20260804c_contrato_documental: FamiliaDocumental, NaturezaOperacionalDocumento,
// PerfilOperacionalDocumento, enum EscopoExecucao e colunas novas em
// TipoDocumentoCadastro e PhaseInternalWorkflow. Diff do baseline: SO insercoes.
//   anterior : c3b59b340c8b529cc31cc98c770622897a093bac3c4cc6bc154e1580682b4c43
//   atual    : 503a30b46aa6ea92de7bba1441603b2bec79351deee4c8ec6f70f756ba4ba02a
// ATUALIZACAO 05/08/2026 (modelos documentais) — migration ADITIVA
// 20260805_modelos_documentais: ModeloDocumental, ModeloDocumentalVersao,
// DocumentoGerado, DocumentoGeradoVersao e quatro enums novos. Diff do baseline:
// 223 linhas inseridas, ZERO removidas (a unica linha alterada e a data do
// cabecalho gerado). Nenhuma tabela existente foi tocada.
//
//   anterior : 503a30b46aa6ea92de7bba1441603b2bec79351deee4c8ec6f70f756ba4ba02a
//   atual    : 62e887f885d8725aad4a7359ba857fff2e457deffa96d8624139c0ca1e8c0e94
//
// Procedimento executado: pg_dump completo de producao -> copia de
// `_prisma_migrations` para CSV -> conferencia de que o diff do baseline nao tem
// DROP/TRUNCATE/DELETE -> UPDATE de UMA coluna na linha 0000_baseline (com o
// checksum anterior no WHERE, para nao acertar linha errada) -> `prisma migrate
// status` = "Database schema is up to date". Nenhuma outra migration foi tocada;
// nenhum dado de negocio foi lido ou alterado.
// ATUALIZACAO 06/08/2026 (vinculo documental do custo) — migration ADITIVA
// 20260806_custo_documental_vinculo: 17 colunas novas em ObrigacaoEconomica
// (vinculo pessoa/documento/servico/fase + origem do lancamento + snapshot de
// preco + chaveIdempotencia), 1 unique e 3 indices. Diff do baseline: 30 linhas
// inseridas, ZERO removidas, ZERO DROP/TRUNCATE/DELETE (a unica linha alterada e
// a data do cabecalho gerado). Nenhuma tabela existente foi tocada.
//
//   anterior : 62e887f885d8725aad4a7359ba857fff2e457deffa96d8624139c0ca1e8c0e94
//   atual    : 597b1cd360c5871297e7475528074aa8f639ba3bbf00c1c8206254e37d775bb8
//
// Procedimento executado: backup do ledger em
// ~/.discovery-backups/prisma-migrations-20260806-pre-checksum.json (9 linhas,
// todas com finished_at) -> conferencia do diff do baseline por `git diff
// --numstat` (30 insercoes / 1 alteracao de cabecalho / 0 remocoes) e por busca
// de DROP|TRUNCATE|DELETE nas linhas adicionadas (nenhuma) -> UPDATE de UMA
// coluna na linha 0000_baseline, com o checksum anterior no WHERE (1 linha
// afetada, conferida) -> `prisma migrate status` = 10 migrations encontradas,
// nenhuma acusada como modificada, apenas 20260806_custo_documental_vinculo
// pendente de aplicacao. Nenhuma outra migration foi tocada; nenhum dado de
// negocio foi lido ou alterado.
// ATUALIZACAO 06/08/2026 (assistente de parametrizacao) — migration ADITIVA
// 20260806b_assistente_parametrizacao: UMA tabela nova
// (AssistenteParametrizacaoProgresso), que guarda so PROGRESSO do assistente —
// escopo, etapa, usuario e datas. Nenhuma coluna de configuracao: a Matriz, o
// preco e o fornecedor continuam nas suas entidades. Diff do baseline: 22 linhas
// inseridas, ZERO removidas, ZERO DROP/TRUNCATE/DELETE.
//
//   anterior : 597b1cd360c5871297e7475528074aa8f639ba3bbf00c1c8206254e37d775bb8
//   atual    : 384a83bff1a33778dbb0b3026463a3f348e7907c8c7f305aabed6a26834039ed
//
// Procedimento executado: pg_dump completo de producao
// (~/.discovery-backups/prod-20260806b-pre-assistente/, sha256 7088c90975dc7ae3...)
// + copia do ledger -> conferencia do diff (22 insercoes / 0 remocoes) -> UPDATE
// de UMA coluna na linha 0000_baseline, com o checksum anterior no WHERE (1 linha
// afetada) -> `prisma migrate status` consistente.
// ATUALIZACAO 06/08/2026 (remocao da "Variacao da Fase") — migration DESTRUTIVA
// APROVADA: 20260806c_remover_variacao_fase derruba a tabela PhaseInternalMode.
// Ela era cadastro SEM CONSUMIDOR — varredura em src/services, src/lib/motor e
// src/lib/process-stage nao encontrou nenhuma leitura pelo runtime. Tabela folha,
// sem FK apontando para ela. As 20 linhas ficaram preservadas em
// ~/.discovery-backups/prod-20260806d-pre-remocao-variacao-fase/ (JSON + dump
// completo) e transcritas no cabecalho da propria migration.
// Diff do baseline: 32 linhas REMOVIDAS (a tabela e seus indices), 0 inseridas.
//
//   anterior : 384a83bff1a33778dbb0b3026463a3f348e7907c8c7f305aabed6a26834039ed
//   atual    : 7cd1f90827eef93f97a0fc35efe238d1d4e0a5dc45138c388ad53cc0f2fafb37
// ATUALIZACAO 06/08/2026 (politica de natureza por fase) — migration ADITIVA
// 20260806d_politica_natureza_por_fase: UMA tabela nova (FaseNaturezaPermitida),
// que liga CatalogoFase a NaturezaOperacionalDocumento por ID. Substitui a
// premissa "a Genealogia so materializa certidao", que vivia em codigo.
// Diff do baseline: 24 linhas inseridas, ZERO removidas.
//
//   anterior : 7cd1f90827eef93f97a0fc35efe238d1d4e0a5dc45138c388ad53cc0f2fafb37
//   atual    : dc38860b04bca0a0355e2eabd00c3bbe28659a9688e44b1f1cea7296cd7622b4
//
// 13/08/2026 — quatro colunas anulaveis na Tarefa (a DECISAO sobre a tarefa que
// perdeu a causa: `causaDecididaEm`, `causaDecisao`, `causaDecisaoAutorId`,
// `causaDecisaoMotivo`). Aditivo, sem escrita em linha existente. Ledger de
// producao reconciliado no mesmo deploy da migration
// 20260812220000_decisao_sobre_causa_removida.
//
//   anterior : 8e66a6548e71c7aafceab85e705ef78fd0efa47b0ab6b64b0571ffb44291eb01
//
// 19/08/2026 — CADASTRO CANONICO DE FASES. `CatalogoFase` ganhou `descricao` e
// `escopo`: sem o escopo, uma fase criada pelo cadastro nascia utilizavel so na
// aparencia (o motor a materializava como PROCESSO por omissao) e o Workflow Macro
// a recusava por nao estar no catalogo em codigo. Aditivo: duas colunas nulas e um
// backfill das dez fases existentes. Ledger de producao reconciliado no MESMO deploy
// da migration 20260819120000_catalogo_fase_escopo_descricao.
//
//   anterior : 00a3504ec57a9531ac0664374baad33a887ddcb1ebf42bfcb0e47b96aca53138
//
// 20/08/2026 — GATE 1, VERSAO PUBLICADA IMUTAVEL. Nova tabela
// `PhaseInternalWorkflowVersao`: as instancias ja gravavam (definicao, versao), mas
// `versao` nunca era incrementada e a edicao recriava os passos — o par apontava
// para conteudo que mudava por baixo. Aditivo: uma tabela, nenhuma coluna alterada.
// Ledger de producao reconciliado no MESMO deploy da migration
// 20260820100000_versao_publicada_imutavel.
//
//   anterior : 882ba788a0fbb21f556741114a2121ddf55e483fb9676b584e2cc36d4b9bc1f8
//
// 20/08/2026 — GATE 2, TENTATIVA DE EXECUCAO DO PASSO. Nova tabela
// `StepExecution`: reabrir fazia `completedAt = NULL` na propria linha e a execucao
// que aconteceu deixava de ter acontecido. Aditivo: uma tabela, nenhuma coluna
// alterada. Ledger reconciliado no MESMO deploy da migration
// 20260820140000_tentativa_de_execucao_do_passo.
//
//   anterior : 761f266e42dc04f48f383b06c05a08c62a1cf583f0e57ccbb3855ecc7370ed08
//
// 21/08/2026 — CADASTRO CANÔNICO DE EXECUÇÃO. Quatro tabelas (StepAction,
// StepField, StepChecklistItem, CanalOperacional), seis colunas anuláveis
// (dependeDe, executorKey, efeitosPermitidos, derivadoDeId, derivacaoTipo,
// substituidoEm) e a linhagem documental. Tudo aditivo; nenhuma coluna alterada.
// Ledger reconciliado no MESMO deploy da migration
// 20260821090000_cadastro_canonico_de_execucao.
//
//   anterior : a4cba5fc2febbc4e09c5e19276c74059c20078e27d73ae9401c955a6a1dac7e4
//
// 21/08/2026 — CONSTRAINTS DE ESTADO IMPOSSÍVEL + CHAVE DE DERIVAÇÃO. Uma tarefa
// viva por etapa, tentativa concluída com data, substituição coerente, ação com
// efeito, campo com tipo, derivação declarando o tipo, e chave única da nova via.
// Aditivo: nenhuma coluna alterada, nenhuma linha violando no momento da aplicação.
// Ledger reconciliado no MESMO deploy das migrations
// 20260821140000_constraints_de_estado_impossivel e
// 20260821160000_chave_de_derivacao_documental.
//
//   anterior : 6a0e5a4347160b8885408776a13ed43a87fea558eb58a2584dec85e74d4dfdbe
//
// 21/08/2026 — POLÍTICA DE REABERTURA. Quatro colunas na definição do passo
// (permitida, estratégia, exige justificativa, permissão) com os defaults que
// reproduzem o comportamento de hoje — nenhuma etapa muda por efeito da migration.
// Ledger reconciliado no MESMO deploy de 20260821200000_politica_de_reabertura.
//
//   anterior : 0a9fad73eef7c8d540bed54a7d07bef4ac618dbc639ea9981f6a2bcef748fe5c
//
// 21/08/2026 — CADASTRO INTEGRAL DO PASSO. Tres tabelas novas (StepFieldOption,
// StepChannel, StepRequirement) e duas colunas anulaveis de rascunho em
// PhaseInternalWorkflow. ADITIVA: enquanto as tabelas estao vazias e as colunas
// nulas, o runtime responde como respondia. O baseline mudou porque quem instalar do
// zero precisa cria-las; o banco de producao NAO mudou de forma nenhuma nesta
// reconciliacao — so o registro de qual arquivo foi aplicado.
// Ledger reconciliado no MESMO deploy de 20260821220000_cadastro_integral_do_passo.
//
//   anterior : 5955d26c1b544edf95fc04eca4f4f437a14328791f10737271d9c192e0e5582d
//
// 22/08/2026 — SUBTAREFA CANÔNICA. Duas tabelas de definição (StepSubtaskDefinition,
// OrganizacaoCanal), uma de execução (SubtaskExecution), `subtaskId` nos quatro filhos
// do passo, os atributos de evidência no requisito, `regraDeConclusao` no passo e
// `orgaoId` no documento. ADITIVA: enquanto não houver subtarefa cadastrada, o motor
// responde como respondia — a regra de conclusao nasce em ACAO_DO_PASSO, que e o que
// sempre valeu, e os filhos continuam do passo com `subtaskId` nulo.
// Ledger reconciliado no MESMO deploy de 20260822090000_subtarefa_canonica.
//
//   anterior : be3f3a4bfe7df13659c1270e6c640587899726ef311b84cf9064c2a369ffb0b9
//
// 22/08/2026 — IDENTIDADE POR DONO. A chave de acao, campo, item e requisito deixou de
// ser unica no PASSO INTEIRO e passou a ser unica dentro do DONO: dois indices
// parciais, um para as pecas do passo (subtaskId nulo) e outro para as de cada
// subtarefa. Sem isso, duas subtarefas do mesmo passo nao podiam ter, cada uma, um
// campo "observacao". Nao pode ser UNIQUE(stepId, subtaskId, key): NULL e distinto de
// NULL no Postgres, e as pecas do passo deixariam de ser deduplicadas.
// Ledger reconciliado no MESMO deploy de 20260822100000_identidade_por_dono.
//
//   anterior : 523d2e8ad455b533ff6e608c992c36d29fd111b454b1b1635d2ab9ed3ee9b96f
// 24/08/2026 — RETIFICAÇÃO CANÔNICA. Três migrations aditivas: o protocolo na
// execução (referência, nunca cópia), a unidade de trabalho do pedido de retificação
// (vínculo real com as divergências, órgão e protocolo por FK, âncora na instância de
// passo) e o cadastro de Profissional com os registros de classe.
//
// Entraram TAMBÉM três índices que as migrations criavam e o schema.prisma não
// declarava — aplicar a migration faria produção divergir do schema no minuto
// seguinte. Achado pela auditoria, corrigido na origem.
//
// Ledger reconciliado ANTES do deploy: sem isso `migrate deploy` recusa rodar
// ("migration modificada depois de aplicada") e as três novas nunca seriam aplicadas.
// Só a coluna `checksum` foi tocada; `started_at` e `finished_at` continuam em
// 02/08/2026, porque é quando a baseline foi aplicada.
//
//   anterior : ad01855eecd5d2cf3f3a183b9a3ecf8933cbba63fc77ffe3dda662b06cfa9c33
// 24/08/2026 — MOTOR DA FASE DECLARADO. Uma coluna em `CatalogoFase`:
// `conduzidaPeloWorkflowInterno`, que diz quem conduz cada fase. Nasce false para
// todas; só a Retificação nasce true, e por prova.
//
// O que ela corrige: a trava de "um motor por fase" derivava o dono da existência de
// cadastro publicado. Medido em produção, `analise_documental` tinha 5/5 passos com
// cadastro e ZERO ações canônicas — o cadastro existia, a operação nunca migrou.
// A derivação teria desligado a Análise.
//
//   anterior : 69706882b57756bab1a55ab717913838ca414ca3d97df40780aa8b5dba9a8fcb
// 25/08/2026 — A PROFISSÃO VIRA CADASTRO. `CategoriaProfissional` + FK em
// `Profissional`, substituindo o texto livre que eu mesmo criei ontem. Zero linhas em
// produção, então a coluna nasce NOT NULL sem backfill nem default mentiroso.
//
//   anterior : 7c67e2f5035c1efade5380b3cadeed1a4a43bdb02934c5924cb6ec15c72a9b0c
const CHECKSUM_LEDGER = '33cade3ecfc12cf07e0a30bb83cb17c7d07dd156fcb2ab157e655182df20f53b'

/**
 * Migrations criadas DEPOIS da consolidacao de 02/08/2026. Toda migration nova
 * entra aqui no MESMO commit que a cria — assim o guard continua reprovando uma
 * migration historica que volte por engano, sem travar o fluxo normal do Prisma.
 */
const MIGRATIONS_POS_BASELINE: string[] = [
  '20260803_workflow_escopo_execucao',
  '20260803b_cardinalidade_passo',
  '20260803c_regularizacao_historica',
  '20260803d_mover_fase_manual',
  '20260804_solicitacao_documental',
  '20260804b_requerimento_doc21_vinculo',
  '20260804c_contrato_documental',
  '20260805_modelos_documentais',
  '20260806_custo_documental_vinculo',
  '20260806b_assistente_parametrizacao',
  '20260806c_remover_variacao_fase',
  '20260806d_politica_natureza_por_fase',
  '20260807_pessoa_ciclo_vida',
  '20260809_planilha_documental_colunas',
  '20260809210000_planilha_matriz_e_override',
  '20260809220000_planilha_coluna_etapa_chk',
  '20260810120000_tarefa_unidade_operacional',
  '20260811100000_notificacao_operacional',
  '20260811160000_motor_operacional_universal',
  '20260812100000_tarefa_por_unidade_de_trabalho',
  '20260812140000_remover_arvore_subtarefas',
  '20260812180000_camada_operacional_funcionario',
  '20260812200000_aptidao_por_unidade_operacional',
  '20260812220000_decisao_sobre_causa_removida',
  '20260819120000_catalogo_fase_escopo_descricao',
  '20260820100000_versao_publicada_imutavel',
  '20260820140000_tentativa_de_execucao_do_passo',
  '20260821090000_cadastro_canonico_de_execucao',
  '20260821140000_constraints_de_estado_impossivel',
  '20260821160000_chave_de_derivacao_documental',
  '20260821200000_politica_de_reabertura',
  '20260821220000_cadastro_integral_do_passo',
  '20260822090000_subtarefa_canonica',
  '20260822100000_identidade_por_dono',
  '20260822170000_protocolo_na_execucao',
  '20260822180000_retificacao_unidade_canonica',
  '20260824100000_profissional_canonico',
  '20260824140000_motor_da_fase_declarado',
  '20260825100000_categoria_profissional',
  '20260831120000_requerimento_escopo_e_cardinalidade',
  '20260831140000_tipo_protocolo_cadastro',
  '20260831160000_remove_legado_protocolo',
  '20260831180000_requisito_cadastral',
  '20260831200000_identidade_canonica_fks',
  '20260831220000_legado_morre_espelho_derivado',
  '20260901090000_espelho_pais_com_default',
  '20260901120000_drop_processo_pais',
  '20260901150000_status_pais_canonico',
  '20260901170000_pais_geografico_vs_oferta',
  '20260901190000_pais_geografico_orgaos_modalidades_taxas',
  '20260901210000_tpn_espelhos_de_pais_morrem',
  '20260901230000_modalidade_espelho_de_pais_morre',
  '20260901240000_orgao_pais_por_identidade',
  '20260901250000_tipo_aponta_para_modalidade',
  '20260901260000_tipo_espelhos_de_modalidade_morrem',
  '20260901270000_relatorio_visao_salva',
  '20260902120000_processo_nao_deixa_orfao',
  '20260902150000_todo_vinculo_protegido',
]

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * A migration oficial e o baseline sao o MESMO arquivo, byte a byte, e sao a
 * unica migration do repositorio. As 112 antigas vivem em
 * prisma/migrations-arquivo/ e nunca mais sao aplicadas.
 */
function verificarMigrationOficial() {
  if (!existsSync(MIGRATION)) {
    falhar([
      '  A MIGRATION OFICIAL 0000_baseline NAO EXISTE',
      '',
      '  prisma/migrations/0000_baseline/migration.sql sumiu. Producao tem esse',
      '  nome registrado em _prisma_migrations; sem o arquivo, o Prisma trata a',
      '  migration como removida e o deploy fica inconsistente.',
      '',
      '  Rode: npm run baseline:gerar',
    ])
  }

  const migration = readFileSync(MIGRATION, 'utf8')
  const baseline = readFileSync(BASELINE, 'utf8')

  if (migration !== baseline) {
    falhar([
      '  BASELINE E MIGRATION DIVERGIRAM',
      '',
      '  prisma/baseline/baseline.sql e prisma/migrations/0000_baseline/migration.sql',
      '  precisam ser identicos byte a byte — sao a mesma verdade em dois lugares.',
      '',
      '  Rode: npm run baseline:gerar (escreve os dois)',
    ])
  }

  const checksum = sha256(migration)
  if (checksum !== CHECKSUM_LEDGER) {
    falhar([
      '  O CHECKSUM DO BASELINE MUDOU',
      '',
      `  esperado (ledger de producao) : ${CHECKSUM_LEDGER}`,
      `  atual    (arquivo commitado)  : ${checksum}`,
      '',
      '  Producao registra 0000_baseline por ESTE checksum. Com o arquivo',
      '  diferente, `prisma migrate deploy` acusa migration modificada depois de',
      '  aplicada e para — em producao, no meio do deploy.',
      '',
      'COMO RESOLVER — e um procedimento, nao um ajuste de constante:',
      '  1. entenda POR QUE o conteudo mudou (schema novo? bloco manual?);',
      '  2. faca backup do ledger antes de qualquer escrita;',
      '  3. atualize o checksum da linha 0000_baseline em _prisma_migrations',
      '     de forma explicita e auditada, sem tocar em schema nem em dados;',
      '  4. so entao atualize CHECKSUM_LEDGER aqui, no mesmo commit.',
      '',
      '  Nunca mude so a constante: isso mente para o proximo que ler.',
    ])
  }

  const entradas = readdirSync(DIR_MIGRATIONS)
    .filter((n) => statSync(join(DIR_MIGRATIONS, n)).isDirectory())
  const inesperadas = entradas.filter((n) => n !== '0000_baseline' && !MIGRATIONS_POS_BASELINE.includes(n))
  if (inesperadas.length > 0) {
    falhar([
      '  HA MIGRATION NAO REGISTRADA EM prisma/migrations',
      '',
      `  encontradas: ${entradas.join(', ')}`,
      `  nao registradas: ${inesperadas.join(', ')}`,
      '',
      '  As 112 migrations historicas foram arquivadas em prisma/migrations-arquivo/',
      '  em 02/08/2026 porque nao reconstroem o banco e nao podem ser reaplicadas.',
      '  Migration NOVA e bem-vinda — mas precisa ser declarada em',
      '  MIGRATIONS_POS_BASELINE, no topo deste arquivo, no mesmo commit que a cria.',
      '  Se uma antiga voltou, foi engano: mova de volta.',
    ])
  }
  const faltando = MIGRATIONS_POS_BASELINE.filter((n) => !entradas.includes(n))
  if (faltando.length > 0) {
    falhar([
      '  MIGRATION DECLARADA NAO EXISTE NO REPOSITORIO',
      '',
      `  declaradas em MIGRATIONS_POS_BASELINE e ausentes: ${faltando.join(', ')}`,
      '',
      '  Producao pode ja te-las aplicado. Apagar o diretorio nao as desfaz —',
      '  restaure o diretorio ou remova a declaracao com justificativa.',
    ])
  }

  const extra = MIGRATIONS_POS_BASELINE.length
  console.log(`  ✅ 0000_baseline integro (sha256 ${checksum.slice(0, 12)}…)${extra ? ` + ${extra} migration(s) pos-baseline declarada(s)` : ' e unica migration do repositorio'}`)
}

/** Inicio deterministico do corpo gerado pelo Prisma — separa o cabecalho. */
const MARCO_CORPO = '-- CreateSchema'

function semCabecalho(txt: string): string {
  const i = txt.indexOf(MARCO_CORPO)
  return i === -1 ? txt : txt.slice(i)
}

function versaoDoCabecalho(txt: string): string {
  return txt.match(/^-- Prisma\s+:\s*(.+)$/m)?.[1]?.trim() ?? 'desconhecida'
}

function falhar(linhas: string[]): never {
  console.error('\n' + linhas.join('\n') + '\n')
  process.exit(1)
}

async function main() {
const gerador = await import('./baseline-gerar.mjs')

if (!existsSync(BASELINE)) {
  falhar([
    '════════════════════════════════════════════════════════════════════════',
    '  O BASELINE NAO EXISTE',
    '════════════════════════════════════════════════════════════════════════',
    '',
    'Esperado em: prisma/baseline/baseline.sql',
    '',
    'COMO RESOLVER — copie e cole:',
    '',
    '    npm run baseline:gerar',
    '',
  ])
}

const commitado = readFileSync(BASELINE, 'utf8')
const esperado = gerador.conteudoSemCabecalho()
const atual = semCabecalho(commitado)

if (atual.trim() === esperado.trim()) {
  const tabelas = (commitado.match(/^CREATE TABLE/gm) ?? []).length
  const fks = (commitado.match(/FOREIGN KEY/g) ?? []).length
  console.log(`  ✅ baseline em dia com o schema.prisma (${tabelas} tabelas · ${fks} foreign keys)`)
  verificarMigrationOficial()
  process.exit(0)
}

// ── divergencia: monta uma mensagem que se explica sozinha ──────────────────
const versaoBaseline = versaoDoCabecalho(commitado)
const versaoAtual = gerador.versaoPrisma()
const mudouPrisma = versaoBaseline !== 'desconhecida' && versaoBaseline !== versaoAtual

const linhasAtual = atual.trim().split('\n')
const linhasEsper = esperado.trim().split('\n')
const primeira = linhasAtual.findIndex((l, i) => l !== linhasEsper[i])
const amostra: string[] = []
if (primeira >= 0) {
  amostra.push('', 'PRIMEIRA DIFERENCA (linha ' + (primeira + 1) + ' do corpo):', '')
  amostra.push('  no baseline commitado : ' + (linhasAtual[primeira] ?? '(fim do arquivo)').slice(0, 100))
  amostra.push('  gerado do schema      : ' + (linhasEsper[primeira] ?? '(fim do arquivo)').slice(0, 100))
}

falhar([
  '════════════════════════════════════════════════════════════════════════',
  '  O BASELINE ESTA DESATUALIZADO',
  '════════════════════════════════════════════════════════════════════════',
  '',
  'O QUE ACONTECEU',
  '  O prisma/schema.prisma mudou, mas o prisma/baseline/baseline.sql nao foi',
  '  regenerado. Os dois deixaram de descrever o mesmo banco.',
  '',
  'POR QUE ISSO IMPORTA',
  '  O baseline.sql e a UNICA forma de reconstruir este banco do zero. O',
  '  historico de migrations nao faz isso: o replay quebra na 7a migration,',
  '  porque metade das tabelas de producao nunca teve CREATE TABLE versionado.',
  '  Baseline velho = restore de desastre recria um banco diferente do real.',
  '',
  'COMO RESOLVER — copie e cole:',
  '',
  '    npm run baseline:gerar',
  '',
  '  Depois confira o diff e commite JUNTO com a sua mudanca de schema:',
  '',
  '    git diff prisma/baseline/baseline.sql',
  '',
  ...(mudouPrisma
    ? [
        'ATENCAO — A VERSAO DO PRISMA MUDOU',
        `  O baseline foi gerado com Prisma ${versaoBaseline}; voce esta com ${versaoAtual}.`,
        '  Versoes diferentes podem gerar o mesmo schema com formatacao diferente.',
        '  Se voce NAO mexeu no schema.prisma, e provavelmente so isso: rode o',
        '  mesmo comando acima, confira que o diff e apenas cosmetico, e commite.',
        '',
      ]
    : [
        'SE VOCE NAO MEXEU NO SCHEMA.PRISMA',
        '  Confira se alguem alterou prisma/baseline/bloco-manual.sql sem',
        '  regenerar. Esse arquivo tambem entra no baseline.',
        '',
      ]),
  'NAO ARRANQUE ESTE TESTE PARA DESTRAVAR O BUILD.',
  '  Ele custa um comando. O que ele protege custa um banco.',
  '  Contexto completo: prisma/baseline/README.md',
  ...amostra,
])
}

main().catch((e) => {
  console.error('\n[baseline] ERRO ao verificar o baseline:', String(e?.message ?? e), '\n')
  process.exit(1)
})
