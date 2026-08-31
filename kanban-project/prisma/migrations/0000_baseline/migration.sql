-- ============================================================================
-- BASELINE CONSOLIDADO — Discovery
--
-- ARQUIVO DERIVADO. Não edite à mão: `npm run baseline:gerar` sobrescreve.
--   corpo        → gerado do prisma/schema.prisma
--   bloco manual → prisma/baseline/bloco-manual.sql (edite LÁ)
--
-- Gerado em : 2026-08-31
-- Prisma    : 6.19.3
--
-- PARA QUE SERVE: reconstruir o banco DO ZERO. O histórico de migrations NÃO
-- faz isso — o replay morre na 7ª (20260113180000_add_tipo_registro_custo,
-- erro 42P01: relation "CustoPessoa" does not exist), porque metade das tabelas
-- de produção nunca teve CREATE TABLE versionado.
--
-- Ver prisma/baseline/README.md para quando usar, como validar e como aplicar.
--
-- DIVERGÊNCIA CONHECIDA E COSMÉTICA — não corrigir sem avaliar:
--   Produção tem o unique de CotacaoCambio sob o nome manual
--   "uq_cotacao_confidence". Este baseline o cria como
--   "CotacaoCambio_moedaDe_moedaPara_dataReferencia_modalidade_o_key" (nome que
--   o Prisma gera). MESMAS COLUNAS, MESMA ORDEM, MESMA SEMÂNTICA — só o nome
--   muda. Renomear é trivial (ALTER INDEX ... RENAME, sem rebuild), mas o nome
--   legado pode estar em DROP INDEX IF EXISTS de migrations idempotentes ou em
--   ON CONFLICT ON CONSTRAINT. Grepar antes de mexer.
--
-- Extensões de produção NÃO incluídas de propósito: pg_stat_statements,
-- pgcrypto e uuid-ossp. Nenhuma coluna usa gen_random_uuid(),
-- uuid_generate_v4() ou crypt(); são observabilidade e legado do provedor,
-- não dependência do schema.
-- ============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TipoProtocolo" AS ENUM ('CONSULAR', 'JUDICIAL', 'ADMINISTRATIVO', 'COMUNE', 'CARTORIO', 'TRIBUNAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "FormaEnvioProtocolo" AS ENUM ('PRESENCIAL', 'CORREIO', 'EMAIL', 'PORTAL_ONLINE', 'TERCEIRO');

-- CreateEnum
CREATE TYPE "FuncaoOrganizacao" AS ENUM ('ORGAO', 'FORNECEDOR', 'PARCEIRO', 'CORRESPONDENTE', 'CLIENTE_CORPORATIVO');

-- CreateEnum
CREATE TYPE "EscopoExecucao" AS ENUM ('PROCESSO', 'PESSOA', 'NECESSIDADE', 'DOCUMENTO');

-- CreateEnum
CREATE TYPE "RegraDocumentalStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'INATIVA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "ObrigatoriedadeRegra" AS ENUM ('OBRIGATORIA', 'OPCIONAL');

-- CreateEnum
CREATE TYPE "ModoSatisfacaoRequisito" AS ENUM ('QUALQUER_UM_ATENDE', 'TODOS_SAO_EXIGIDOS');

-- CreateEnum
CREATE TYPE "PublicoAlvoRegra" AS ENUM ('REQUERENTE', 'CONTRATANTE', 'PESSOA_DA_ARVORE_COM_DOCUMENTACAO', 'PESSOA_DA_LINHA_RETA', 'PESSOA_FORA_DA_LINHA_RETA', 'TODAS_AS_PESSOAS_DA_ARVORE');

-- CreateEnum
CREATE TYPE "OrigemNecessidade" AS ENUM ('ARVORE', 'MATRIZ', 'MANUAL', 'MIGRACAO');

-- CreateEnum
CREATE TYPE "ObrigatoriedadeNecessidade" AS ENUM ('OBRIGATORIA', 'OPCIONAL');

-- CreateEnum
CREATE TYPE "StatusNecessidade" AS ENUM ('PENDENTE', 'EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA', 'DISPENSADA');

-- CreateEnum
CREATE TYPE "TipoEventoNecessidade" AS ENUM ('CRIADA', 'EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA', 'REABERTA', 'DISPENSADA', 'SUPERSEDIDA', 'RETORNO_GENEALOGIA');

-- CreateEnum
CREATE TYPE "PassoTipo" AS ENUM ('HUMANO', 'AUTOMATICO', 'ESPERA', 'VALIDACAO', 'DECISAO', 'APROVACAO', 'MANUAL_SEM_TAREFA');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PENDENTE', 'INSTANCIANDO', 'ATIVO', 'BLOQUEADO', 'AGUARDANDO', 'CONCLUIDO', 'CANCELADO', 'SUPERSEDIDO', 'FALHOU', 'PENDENTE_DE_REGULARIZACAO', 'NAO_APLICAVEL');

-- CreateEnum
CREATE TYPE "RegularizacaoHistorica" AS ENUM ('NAO_NECESSARIA', 'PENDENTE', 'PARCIAL', 'REGULARIZADA');

-- CreateEnum
CREATE TYPE "StepInstanceStatus" AS ENUM ('PENDENTE', 'DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO', 'BLOQUEADO', 'EXECUTADO', 'AGUARDANDO_APROVACAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO', 'DISPENSADO', 'SUPERSEDIDO');

-- CreateEnum
CREATE TYPE "OrigemInstancia" AS ENUM ('MOTOR', 'MANUAL', 'MIGRACAO', 'REABERTURA');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoTarefa" AS ENUM ('NORMAL', 'TRANSVERSAL');

-- CreateEnum
CREATE TYPE "WorkflowEventoTipo" AS ENUM ('WORKFLOW_INSTANCIADO', 'WORKFLOW_INICIADO', 'WORKFLOW_BLOQUEADO', 'WORKFLOW_CONCLUIDO', 'WORKFLOW_REABERTO', 'WORKFLOW_SUPERSEDIDO', 'PASSO_INSTANCIADO', 'PASSO_DISPONIBILIZADO', 'PASSO_INICIADO', 'PASSO_BLOQUEADO', 'PASSO_DESBLOQUEADO', 'PASSO_EXECUTADO', 'PASSO_AGUARDANDO_APROVACAO', 'PASSO_APROVADO', 'PASSO_CONCLUIDO', 'PASSO_FALHOU', 'PASSO_REABERTO', 'PASSO_DISPENSADO', 'PASSO_CANCELADO', 'PASSO_SUPERSEDIDO', 'TAREFA_GERADA', 'TAREFA_ATRIBUIDA', 'TAREFA_INICIADA', 'TAREFA_CONCLUIDA', 'TAREFA_BLOQUEADA', 'TAREFA_DESBLOQUEADA', 'TAREFA_CANCELADA', 'TAREFA_SUPERSEDIDA', 'TAREFA_REABERTA', 'TAREFA_SINCRONIZADA', 'FASE_SIMULADA', 'FASE_AVANCADA', 'FASE_AVANCADA_FORCADO', 'FASE_REABERTA', 'FASE_RETORNADA', 'FASE_MOVIDA');

-- CreateEnum
CREATE TYPE "AdvanceResultado" AS ENUM ('BLOQUEADO', 'AVANCADO', 'FORCADO', 'REABERTO', 'RETORNADO', 'MOVIDO', 'IDEMPOTENTE', 'CONFLITO');

-- CreateEnum
CREATE TYPE "PapelFinanceiro" AS ENUM ('CUSTO', 'RECEITA', 'REPASSE', 'REEMBOLSO', 'DESPESA_INTERNA', 'TAXA', 'HONORARIO');

-- CreateEnum
CREATE TYPE "NaturezaPreco" AS ENUM ('CUSTO', 'RECEITA', 'VENDA');

-- CreateEnum
CREATE TYPE "NaturezaFinanceira" AS ENUM ('SOMENTE_CUSTO', 'SOMENTE_RECEITA', 'CUSTO_E_RECEITA');

-- CreateEnum
CREATE TYPE "NaturezaItem" AS ENUM ('DOCUMENTO', 'PRODUTO', 'SERVICO', 'HONORARIO', 'TAXA', 'DESPESA', 'LOGISTICA', 'OUTRO');

-- CreateEnum
CREATE TYPE "UnidadeItem" AS ENUM ('UNIDADE', 'DOCUMENTO', 'PESSOA', 'REQUERENTE', 'PAGINA', 'PACOTE', 'PROCESSO', 'FASE', 'HORA', 'DIA', 'MES', 'PERCENTUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "Pais" AS ENUM ('PORTUGAL', 'ESPANHA', 'ALEMANHA', 'ITALIA');

-- CreateEnum
CREATE TYPE "StatusTarefa" AS ENUM ('NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_CLIENTE', 'AGUARDANDO_TERCEIRO', 'CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'BLOQUEADA', 'SUPERSEDIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PrioridadeTarefa" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "Consulado" AS ENUM ('SAO_PAULO', 'PORTO_ALEGRE', 'RIO_DE_JANEIRO', 'SALVADOR', 'BRASILIA', 'OUTROS');

-- CreateEnum
CREATE TYPE "Tribunal" AS ENUM ('ANCONA', 'BARI', 'BOLOGNA', 'BRESCIA', 'CAGLIARI', 'CALTANISSETTA', 'CAMPOBASSO', 'CATANIA', 'CATANZARO', 'FIRENZE', 'GENOVA', 'L_AQUILA', 'LECCE', 'MESSINA', 'MILANO', 'NAPOLI', 'PALERMO', 'PERUGIA', 'POTENZA', 'REGGIO_CALABRIA', 'ROMA', 'SALERNO', 'TORINO', 'TRENTO', 'TRIESTE', 'VENEZIA');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('CERTIDAO_NASCIMENTO', 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR', 'CERTIDAO_CASAMENTO', 'CERTIDAO_CASAMENTO_INTEIRO_TEOR', 'CERTIDAO_OBITO', 'CERTIDAO_OBITO_INTEIRO_TEOR', 'CERTIDAO_BATISMO', 'CNN', 'CARTA_NATURALIZACAO', 'RG', 'CPF', 'CNH', 'PASSAPORTE_BRASILEIRO', 'TITULO_ELEITOR', 'RESERVISTA', 'PASSAPORTE_ESTRANGEIRO', 'CERTIDAO_CIDADANIA_ESTRANGEIRA', 'COMPROVANTE_RESIDENCIA', 'TRADUCAO_JURAMENTADA', 'APOSTILA_HAIA', 'FOTO_3X4', 'PROCURACAO', 'ARVORE_GENEALOGICA_DOC', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusDocumento" AS ENUM ('PENDENTE', 'SOLICITAR', 'SOLICITADO', 'EM_BUSCA', 'RECEBIDO', 'EM_ANALISE', 'RETIFICANDO', 'EM_TRADUCAO', 'TRADUZIDO', 'EM_APOSTILAMENTO', 'APOSTILADO', 'ENTREGUE', 'INVALIDO', 'NAO_ENCONTRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('CONSULADO', 'CARTORIO', 'REUNIAO', 'PRAZO', 'AUDIENCIA', 'ENTREGA_DOCUMENTO', 'PROTOCOLO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusPost" AS ENUM ('RASCUNHO', 'PUBLICADO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "Moeda" AS ENUM ('BRL', 'EUR', 'USD');

-- CreateEnum
CREATE TYPE "NaturezaOutroCusto" AS ENUM ('COBRAR', 'REPASSAR');

-- CreateEnum
CREATE TYPE "ReceitaStatus" AS ENUM ('ATIVA', 'RASCUNHO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CustoStatus" AS ENUM ('ATIVA', 'RASCUNHO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusFatura" AS ENUM ('PENDENTE', 'PAGO', 'VENCIDO', 'PARCIAL');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoTransacao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "StatusContaPagar" AS ENUM ('PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO', 'AGENDADO');

-- CreateEnum
CREATE TYPE "RecorrenciaTipo" AS ENUM ('UNICA', 'SEMANAL', 'MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "FxRule" AS ENUM ('FIXO', 'VARIAVEL');

-- CreateEnum
CREATE TYPE "StatusParcela" AS ENUM ('PENDENTE', 'RECEBIDA', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CategoriaReceita" AS ENUM ('HONORARIOS', 'REEMBOLSO', 'PASTA_DOCUMENTAL', 'OUTROS');

-- CreateEnum
CREATE TYPE "TipoCusto" AS ENUM ('SERVICO', 'IMPOSTO', 'DOCUMENTO', 'DESPESA');

-- CreateEnum
CREATE TYPE "CategoriaCusto" AS ENUM ('TRADUCOES_JURAMENTACOES', 'APOSTILAMENTOS', 'HONORARIOS_ESCRITORIO', 'TAXAS_CONSULARES', 'OUTROS');

-- CreateEnum
CREATE TYPE "TipoEventoFinanceiro" AS ENUM ('CRIACAO', 'EDICAO', 'CANCELAMENTO', 'RECEBIMENTO', 'PAGAMENTO', 'EDICAO_RECEBIMENTO', 'EDICAO_PAGAMENTO', 'ESTORNO_RECEBIMENTO', 'ESTORNO_PAGAMENTO');

-- CreateEnum
CREATE TYPE "FaseCode" AS ENUM ('GENEALOGIA', 'EMISSAO_DOCUMENTAL', 'ANALISE_DOCUMENTAL', 'RETIFICACAO_REGISTROS', 'EMISSAO_DOCUMENTAL_RETIFICADA', 'TRADUCAO_JURAMENTADA', 'APOSTILAMENTO', 'AGUARDANDO_PROTOCOLO', 'PROTOCOLADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "StatusOperacaoAntecipada" AS ENUM ('CRIADA', 'EM_EXECUCAO', 'AGUARDANDO_RESULTADO', 'CONCLUIDA', 'CONCLUIDA_PARCIAL', 'NAO_ATINGIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EtapaRegistral" AS ENUM ('RECEBIDO', 'CLASSIFICANDO', 'EXTRAINDO', 'REEXTRAINDO', 'NORMALIZANDO', 'RESOLVENDO_IDENTIDADES', 'CRUZANDO_EVIDENCIAS', 'VALIDANDO', 'REVALIDANDO', 'ANALISANDO_IMPACTO', 'AGUARDANDO_REVISAO', 'APLICADO', 'AUDITADO', 'FALHA_LEITURA', 'DOCUMENTO_INSUFICIENTE', 'DOCUMENTO_CONFLITANTE', 'REPROCESSAMENTO', 'REJEITADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusLoteRegistral" AS ENUM ('RECEBIDO', 'EM_PROCESSAMENTO', 'AGUARDANDO_REVISAO', 'CONCLUIDO', 'CONCLUIDO_COM_FALHAS', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoFatoRegistral" AS ENUM ('NAO_INFORMADO', 'INFORMADO_PELO_CLIENTE', 'EXTRAIDO', 'NAO_COMPROVADO', 'INCOMPLETO', 'PROVAVEL', 'CONFIRMADO', 'CONFIRMADO_MULTIPLAS_EVIDENCIAS', 'DIVERGENTE', 'CONFLITANTE', 'EM_REVISAO', 'REJEITADO', 'SUBSTITUIDO_COM_HISTORICO');

-- CreateEnum
CREATE TYPE "CampoRegistral" AS ENUM ('NOME_REGISTRAL', 'NOME_CASADO', 'SEXO', 'DATA_NASCIMENTO', 'LOCAL_NASCIMENTO', 'PAIS_NASCIMENTO', 'FILIACAO_PAI', 'FILIACAO_MAE', 'DATA_CASAMENTO', 'LOCAL_CASAMENTO', 'CONJUGE', 'DATA_OBITO', 'LOCAL_OBITO', 'DATA_BATISMO', 'LOCAL_BATISMO', 'PROFISSAO', 'NACIONALIDADE', 'NATURALIZACAO', 'IDADE_DECLARADA', 'RESIDENCIA_HISTORICA', 'REFERENCIA_REGISTRAL', 'DATA_EMIGRACAO', 'IDENTIDADE_PESSOA', 'IDENTIDADE_PAI', 'IDENTIDADE_MAE', 'VINCULO_ASCENDENTE_TRANSMISSOR');

-- CreateEnum
CREATE TYPE "PapelOcorrencia" AS ENUM ('REGISTRADO', 'PAI', 'MAE', 'CONJUGE', 'FILHO', 'AVO_PATERNO', 'AVOA_PATERNA', 'AVO_MATERNO', 'AVOA_MATERNA', 'DECLARANTE', 'TESTEMUNHA', 'OFICIANTE', 'PADRINHO', 'MADRINHA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ClasseCorrespondencia" AS ENUM ('CORRESPONDENCIA_CONFIRMADA', 'ALTAMENTE_PROVAVEL', 'POSSIVEL', 'REGISTROS_CONFLITANTES', 'PESSOAS_DISTINTAS');

-- CreateEnum
CREATE TYPE "TipoPropostaRegistral" AS ENUM ('CONFIRMAR_DADO', 'COMPLETAR_DADO', 'CORRIGIR_DADO', 'ADICIONAR_NOME_ALTERNATIVO', 'CRIAR_PESSOA', 'VINCULAR_PESSOA_EXISTENTE', 'CRIAR_RELACIONAMENTO', 'CORRIGIR_RELACIONAMENTO', 'REMOVER_RELACIONAMENTO', 'MESCLAR_PESSOAS', 'SEPARAR_PESSOAS', 'SATISFAZER_NECESSIDADE', 'REABRIR_NECESSIDADE', 'CRIAR_NECESSIDADE', 'MARCAR_DOCUMENTO_DIVERGENTE', 'SOLICITAR_RETIFICACAO');

-- CreateEnum
CREATE TYPE "CriticidadeRegistral" AS ENUM ('AUTOMATICA', 'APROVACAO_HUMANA', 'BLOQUEIO');

-- CreateEnum
CREATE TYPE "StatusPropostaRegistral" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA', 'ADIADA', 'APLICADA', 'REVERTIDA', 'ABORTADA');

-- CreateEnum
CREATE TYPE "SeveridadeRegistral" AS ENUM ('CRITICO', 'ALTO', 'MEDIO', 'BAIXO', 'INFO');

-- CreateEnum
CREATE TYPE "StatusConflitoRegistral" AS ENUM ('ABERTO', 'EM_REVISAO', 'RESOLVIDO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "ResultadoLinhagemRegistral" AS ENUM ('LINHA_COMPLETA_COMPROVADA', 'LINHA_COMPLETA_COM_PENDENCIAS', 'LINHA_ESTRUTURAL_INCOMPLETA', 'LINHA_CONFLITANTE', 'ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO', 'REVISAO_OBRIGATORIA');

-- CreateEnum
CREATE TYPE "CanalSolicitacaoDocumento" AS ENUM ('CRC', 'ECARTORIO', 'EMAIL', 'WHATSAPP', 'BALCAO', 'COMUNE', 'CORREIOS', 'CONSULADO');

-- CreateEnum
CREATE TYPE "StatusSolicitacaoDocumento" AS ENUM ('AGUARDANDO_PROTOCOLO', 'PROTOCOLADA', 'RESPONDIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoArquivoDocumento" AS ENUM ('REQUERIMENTO_ENVIADO', 'COMPROVANTE_PROTOCOLO', 'COMPROVANTE_CONTATO', 'DOCUMENTO_RECEBIDO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ModeloDocumentalCategoria" AS ENUM ('PROCURACAO', 'CONTRATO', 'DECLARACAO', 'REQUERIMENTO', 'FORMULARIO', 'AUTORIZACAO', 'NOTIFICACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ModeloDocumentalVersaoStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'REVOGADA');

-- CreateEnum
CREATE TYPE "DocumentoGeradoStatus" AS ENUM ('VIGENTE', 'INVALIDADO');

-- CreateEnum
CREATE TYPE "DocumentoGeradoVersaoStatus" AS ENUM ('GERADA', 'VIGENTE', 'SUBSTITUIDA', 'INVALIDADA');

-- CreateEnum
CREATE TYPE "TipoIndisponibilidade" AS ENUM ('FERIAS', 'AFASTAMENTO', 'AUSENCIA', 'BLOQUEIO_OPERACIONAL');

-- CreateTable
CREATE TABLE "Usuario" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "senha" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "perfilId" INTEGER,
    "permissoesCustom" JSONB,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pessoa" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "sobrenome" VARCHAR(40),
    "sexo" VARCHAR(10),
    "data_nasc" TIMESTAMP(3),
    "data_obito" TIMESTAMP(3),
    "local_nasc" VARCHAR(100),
    "estado_nasc" VARCHAR(50),
    "pais_nasc" VARCHAR(50),
    "vivo" BOOLEAN NOT NULL DEFAULT true,
    "batizado" VARCHAR(50),
    "data_batismo" TIMESTAMP(3),
    "local_batismo" VARCHAR(100),
    "igreja_batismo" VARCHAR(150),
    "profissao" VARCHAR(100),
    "nacionalidade" VARCHAR(50),
    "cidadanias_outras" VARCHAR(200),
    "naturalizado" BOOLEAN NOT NULL DEFAULT false,
    "data_naturalizacao" TIMESTAMP(3),
    "pais_naturalizacao" VARCHAR(50),
    "data_emigracao" TIMESTAMP(3),
    "local_emigracao" VARCHAR(100),
    "porto_embarque" VARCHAR(100),
    "data_chegada" TIMESTAMP(3),
    "porto_chegada" VARCHAR(100),
    "pais_destino" VARCHAR(50),
    "navio" VARCHAR(100),
    "comentario" TEXT,
    "x" INTEGER,
    "y" INTEGER,
    "arvoreId" INTEGER,
    "paiId" INTEGER,
    "maeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "numeroLinhagem" INTEGER,
    "requerente" TEXT DEFAULT 'nao',
    "ordemCusto" INTEGER DEFAULT 0,
    "documentacao" BOOLEAN NOT NULL DEFAULT true,
    "casado" BOOLEAN NOT NULL DEFAULT false,
    "linhaReta" BOOLEAN NOT NULL DEFAULT true,
    "removidaEm" TIMESTAMP(3),
    "removidaPorId" INTEGER,
    "motivoRemocao" VARCHAR(300),

    CONSTRAINT "Pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Uniao" (
    "id" SERIAL NOT NULL,
    "data_inicio" TIMESTAMP(3),
    "data_fim" TIMESTAMP(3),
    "tipo" VARCHAR(30),
    "local" VARCHAR(100),
    "estado" VARCHAR(50),
    "pais" VARCHAR(50),
    "cartorio" VARCHAR(200),
    "livro" VARCHAR(20),
    "folha" VARCHAR(20),
    "termo" VARCHAR(30),
    "numero_registro" VARCHAR(50),
    "data_registro" TIMESTAMP(3),
    "observacoes" TEXT,
    "pessoa1Id" INTEGER NOT NULL,
    "pessoa2Id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Uniao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arvore" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(200),
    "commentPosX" DOUBLE PRECISION DEFAULT 0,
    "commentPosY" DOUBLE PRECISION DEFAULT 0,
    "pessoaPrincipalId" INTEGER,
    "posicoesNodes" JSONB,
    "familiaId" INTEGER,

    CONSTRAINT "Arvore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Familia" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "descricao" VARCHAR(300),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Familia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "tipo" "TipoDocumento",
    "status" "StatusDocumento" NOT NULL DEFAULT 'PENDENTE',
    "descricao" VARCHAR(200),
    "cartorio" VARCHAR(200),
    "orgaoId" INTEGER,
    "livro" VARCHAR(20),
    "folha" VARCHAR(20),
    "termo" VARCHAR(30),
    "numero_registro" VARCHAR(50),
    "data_registro" TIMESTAMP(3),
    "cidade_registro" VARCHAR(100),
    "estado_registro" VARCHAR(50),
    "pais_registro" VARCHAR(50),
    "numero" VARCHAR(50),
    "orgao_emissor" VARCHAR(50),
    "data_emissao" TIMESTAMP(3),
    "data_validade" TIMESTAMP(3),
    "arquivo_url" TEXT,
    "arquivo_nome" VARCHAR(200),
    "arquivo_tamanho" INTEGER,
    "arquivo_mime_type" VARCHAR(100),
    "traduzido" BOOLEAN NOT NULL DEFAULT false,
    "tradutor" VARCHAR(150),
    "data_traducao" TIMESTAMP(3),
    "arquivo_traducao_url" TEXT,
    "arquivo_traducao_nome" VARCHAR(200),
    "apostilado" BOOLEAN NOT NULL DEFAULT false,
    "numero_apostila" VARCHAR(50),
    "data_apostila" TIMESTAMP(3),
    "arquivo_apostila_url" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "data_evento" TIMESTAMP(3),
    "nome_registrado" VARCHAR(200),
    "pai_registrado" VARCHAR(200),
    "mae_registrada" VARCHAR(200),
    "conjuge_registrado" VARCHAR(200),
    "data_evento_documento" TIMESTAMP(3),
    "data_registro_documento" TIMESTAMP(3),
    "comune" VARCHAR(100),
    "matricula" VARCHAR(50),
    "crc" VARCHAR(50),
    "protocolo" VARCHAR(50),
    "nro_pedido" VARCHAR(50),
    "canal_solicitacao" VARCHAR(50),
    "link_acompanhamento" VARCHAR(500),
    "localizacao_fisica" VARCHAR(200),
    "responsavelId" INTEGER,
    "dataInicioOperacao" TIMESTAMP(3),
    "dataPrazoOperacao" TIMESTAMP(3),
    "ultimaMovimentacao" TIMESTAMP(3),
    "motivoBloqueio" VARCHAR(300),
    "origem" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "ruleCode" VARCHAR(20),
    "structuredData" JSONB,
    "dataStatus" TEXT NOT NULL DEFAULT 'not_filled',
    "analysisStatus" TEXT NOT NULL DEFAULT 'not_ready',
    "registral" JSONB,
    "documentTypeId" INTEGER,
    "necessidadeId" INTEGER,
    "derivadoDeId" INTEGER,
    "derivacaoTipo" VARCHAR(20),
    "substituidoEm" TIMESTAMP(3),
    "chaveDerivacao" VARCHAR(200),
    "transcricaoTexto" TEXT,
    "transcricaoPaginas" JSONB,
    "transcricaoFonte" VARCHAR(40),
    "transcricaoEm" TIMESTAMP(3),

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Status" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "pais" TEXT NOT NULL,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeSequence" (
    "id" SERIAL NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Processo" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20),
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(500),
    "observacoes" TEXT,
    "pais" TEXT NOT NULL,
    "arvoreId" INTEGER,
    "familiaId" INTEGER,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previsaoTermino" TIMESTAMP(3),
    "dataConclusao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "percentualImposto" DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    "faseAtualKey" TEXT,
    "regularizacaoHistorica" "RegularizacaoHistorica" NOT NULL DEFAULT 'NAO_NECESSARIA',
    "regularizacaoConcluidaEm" TIMESTAMP(3),
    "regularizacaoConcluidaPorId" INTEGER,
    "motivoCadastroEmAndamento" TEXT,
    "workflowRuntime" VARCHAR(20) NOT NULL DEFAULT 'v2',
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "chaveIdempotenciaCriacao" VARCHAR(200),
    "macroWorkflowVersion" INTEGER,
    "tipoProcessoMotorId" INTEGER,
    "enquadramentoLegalId" INTEGER,

    CONSTRAINT "Processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessoContratante" (
    "processoId" INTEGER NOT NULL,
    "contratanteId" INTEGER NOT NULL,

    CONSTRAINT "ProcessoContratante_pkey" PRIMARY KEY ("processoId","contratanteId")
);

-- CreateTable
CREATE TABLE "Tarefa" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "processoId" INTEGER,
    "statusId" INTEGER,
    "pais" TEXT,
    "responsavelId" INTEGER,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "prioridade" "PrioridadeTarefa" NOT NULL DEFAULT 'MEDIA',
    "dataPrazo" TIMESTAMP(3),
    "dataConclusao" TIMESTAMP(3),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataInicio" TIMESTAMP(3),
    "observacoes" TEXT,
    "prazoCobranca" INTEGER DEFAULT 5,
    "motivoConclusao" VARCHAR(50),
    "quantidadeCobrancas" INTEGER NOT NULL DEFAULT 0,
    "statusTarefa" "StatusTarefa" NOT NULL DEFAULT 'NAO_INICIADA',
    "ultimaCobranca" TIMESTAMP(3),
    "workflowInstanceId" INTEGER,
    "workflowStepInstanceId" INTEGER,
    "necessidadeId" INTEGER,
    "documentoId" INTEGER,
    "equipeKey" VARCHAR(80),
    "dataAtribuicao" TIMESTAMP(3),
    "atribuidoPorId" INTEGER,
    "faseMacroKey" VARCHAR(60),
    "origem" VARCHAR(20),
    "chaveIdempotencia" VARCHAR(200),
    "ciclo" INTEGER,
    "taskRole" VARCHAR(40),
    "correlationId" VARCHAR(60),
    "previousTarefaId" INTEGER,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "executedById" INTEGER,
    "blockedPreviousStatus" VARCHAR(30),
    "motivoCodigo" VARCHAR(40),
    "justificativa" TEXT,
    "slaPausadoEm" TIMESTAMP(3),
    "slaPausaAcumuladaMin" INTEGER NOT NULL DEFAULT 0,
    "causaRemovidaEm" TIMESTAMP(3),
    "causaRemovidaMotivo" VARCHAR(300),
    "causaDecididaEm" TIMESTAMP(3),
    "causaDecisao" VARCHAR(20),
    "causaDecisaoAutorId" INTEGER,
    "causaDecisaoMotivo" VARCHAR(300),
    "tipo" "TipoTarefa" NOT NULL DEFAULT 'NORMAL',
    "faseOrigemCode" VARCHAR(60),
    "faseReferenciaCode" VARCHAR(60),
    "workflowInstanceOrigemId" INTEGER,
    "pessoaId" INTEGER,
    "tipoDocumentoId" INTEGER,
    "acaoStepKey" VARCHAR(80),
    "motivo" TEXT,
    "resultadoEsperado" TEXT,
    "resultadoObtido" TEXT,
    "createdBy" INTEGER,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarefaHistorico" (
    "id" SERIAL NOT NULL,
    "tarefaId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "acao" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(500) NOT NULL,
    "dados" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TarefaHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessoRequerente" (
    "processoId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "removidoEm" TIMESTAMP(3),
    "removidoPorId" INTEGER,
    "motivoRemocao" VARCHAR(300),

    CONSTRAINT "ProcessoRequerente_pkey" PRIMARY KEY ("processoId","requerenteId")
);

-- CreateTable
CREATE TABLE "Contratante" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "cpf" VARCHAR(14),
    "rg" VARCHAR(20),
    "dataNascimento" TIMESTAMP(3),
    "sexo" VARCHAR(20),
    "estadoCivil" VARCHAR(20),
    "nacionalidade" VARCHAR(50),
    "telefone" VARCHAR(20),
    "email" VARCHAR(100),
    "endereco" VARCHAR(200),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(50),
    "cep" VARCHAR(15),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pais" VARCHAR(50) DEFAULT 'Brasil',
    "crnm" VARCHAR(20),
    "passaporte" VARCHAR(20),
    "personId" INTEGER,

    CONSTRAINT "Contratante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requerente" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "cpf" VARCHAR(14),
    "rg" VARCHAR(20),
    "dataNascimento" TIMESTAMP(3),
    "sexo" VARCHAR(20),
    "estadoCivil" VARCHAR(20),
    "nacionalidade" VARCHAR(50),
    "telefone" VARCHAR(20),
    "email" VARCHAR(100),
    "endereco" VARCHAR(200),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(50),
    "cep" VARCHAR(15),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pais" VARCHAR(50) DEFAULT 'Brasil',
    "crnm" VARCHAR(20),
    "passaporte" VARCHAR(20),
    "personId" INTEGER,

    CONSTRAINT "Requerente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protocolo" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,
    "consulado" "Consulado",
    "consuladoOutro" VARCHAR(200),
    "orgaoId" INTEGER,
    "setor" VARCHAR(120),
    "dataProtocolo" TIMESTAMP(3),
    "numeroProtocolo" VARCHAR(100),
    "numeroProcesso" VARCHAR(100),
    "finalidade" VARCHAR(30) NOT NULL DEFAULT 'REQUERIMENTO',
    "situacao" VARCHAR(30) NOT NULL DEFAULT 'PROTOCOLADO',
    "situacaoEm" TIMESTAMP(3),
    "tipoProtocolo" "TipoProtocolo",
    "formaEnvio" "FormaEnvioProtocolo",
    "responsavelId" INTEGER,
    "observacoes" TEXT,
    "origem" VARCHAR(30) NOT NULL DEFAULT 'PROCESSO',
    "solicitacaoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Protocolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocoloRequerente" (
    "protocoloId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocoloRequerente_pkey" PRIMARY KEY ("protocoloId","requerenteId")
);

-- CreateTable
CREATE TABLE "ProtocoloExigencia" (
    "id" SERIAL NOT NULL,
    "protocoloId" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "prazo" TIMESTAMP(3),
    "cumpridaEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocoloExigencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocoloDocumento" (
    "id" SERIAL NOT NULL,
    "protocoloId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocoloDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformacaoItalia" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "tribunal" "Tribunal" NOT NULL,
    "dataProtocolo" TIMESTAMP(3),
    "dataDistribuicao" TIMESTAMP(3),
    "numeroRuoloGenerale" VARCHAR(100),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformacaoItalia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnexoInformacaoItalia" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50),
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "informacaoItaliaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoInformacaoItalia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnexoProcesso" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "processoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoProcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnexoContratante" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50),
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "contratanteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT,

    CONSTRAINT "AnexoContratante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnexoRequerente" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50),
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "requerenteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT,

    CONSTRAINT "AnexoRequerente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnexoProtocolo" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50),
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "protocoloId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoProtocolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogAuditoria" (
    "id" SERIAL NOT NULL,
    "acao" VARCHAR(50) NOT NULL,
    "entidade" VARCHAR(50) NOT NULL,
    "entidadeId" INTEGER,
    "descricao" TEXT NOT NULL,
    "detalhes" JSONB,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fatura" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "receitaId" INTEGER,
    "descricao" VARCHAR(200) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "StatusFatura" NOT NULL DEFAULT 'PENDENTE',
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVencimento" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorOriginal" DECIMAL(10,2),
    "cambio" DECIMAL(10,4),
    "metodoPagamento" "FormaPagamento",
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "valorParcela" DECIMAL(10,2),

    CONSTRAINT "Fatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoFatura" (
    "id" SERIAL NOT NULL,
    "faturaId" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formaPagamento" "FormaPagamento",
    "comprovanteUrl" TEXT,
    "comprovanteNome" VARCHAR(200),
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cambio" DECIMAL(10,4),
    "valorOriginal" DECIMAL(10,2),
    "estornado" BOOLEAN NOT NULL DEFAULT false,
    "estornadoEm" TIMESTAMP(3),
    "estornoMotivo" VARCHAR(200),

    CONSTRAINT "PagamentoFatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoDestinatario" (
    "id" SERIAL NOT NULL,
    "pagamentoId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagamentoDestinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoServico" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemCatalogoId" INTEGER,

    CONSTRAINT "TipoServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustoPessoa" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "tipoServicoId" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "observacao" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tipoRegistro" VARCHAR(20),

    CONSTRAINT "CustoPessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaBancaria" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "banco" VARCHAR(100),
    "agencia" VARCHAR(20),
    "conta" VARCHAR(30),
    "tipoConta" VARCHAR(30),
    "chavePix" VARCHAR(100),
    "tipoChavePix" VARCHAR(20),
    "saldoInicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoAtual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cor" VARCHAR(7),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "iban" TEXT,
    "swift" TEXT,
    "isDefaultReceiving" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPayment" BOOLEAN NOT NULL DEFAULT false,
    "bankId" INTEGER,

    CONSTRAINT "ContaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "nomeFantasia" VARCHAR(150),
    "tipo" VARCHAR(20) NOT NULL,
    "cpfCnpj" VARCHAR(20),
    "inscricaoEstadual" VARCHAR(20),
    "inscricaoMunicipal" VARCHAR(20),
    "telefone" VARCHAR(20),
    "celular" VARCHAR(20),
    "email" VARCHAR(100),
    "website" VARCHAR(200),
    "cep" VARCHAR(10),
    "endereco" VARCHAR(200),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(2),
    "banco" VARCHAR(100),
    "agencia" VARCHAR(20),
    "conta" VARCHAR(30),
    "tipoConta" VARCHAR(20),
    "chavePix" VARCHAR(100),
    "tipoChavePix" VARCHAR(20),
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pais" VARCHAR(50),
    "moedaPadrao" "Moeda" NOT NULL DEFAULT 'BRL',

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaPagar" (
    "id" SERIAL NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "observacoes" TEXT,
    "fornecedorId" INTEGER,
    "valor" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2),
    "desconto" DECIMAL(12,2) DEFAULT 0,
    "juros" DECIMAL(12,2) DEFAULT 0,
    "multa" DECIMAL(12,2) DEFAULT 0,
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "dataCompetencia" TIMESTAMP(3),
    "status" "StatusContaPagar" NOT NULL DEFAULT 'PENDENTE',
    "formaPagamento" "FormaPagamento",
    "contaBancariaId" INTEGER,
    "numeroDocumento" VARCHAR(50),
    "tipoDocumento" VARCHAR(50),
    "comprovanteUrl" TEXT,
    "comprovanteNome" VARCHAR(200),
    "recorrencia" "RecorrenciaTipo" NOT NULL DEFAULT 'UNICA',
    "contaPaiId" INTEGER,
    "numeroParcela" INTEGER,
    "totalParcelas" INTEGER,
    "processoId" INTEGER,
    "origem" VARCHAR(20) NOT NULL DEFAULT 'CORPORATIVA',
    "custoOrigemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaPagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transacao" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoTransacao" NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "observacoes" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataCompetencia" TIMESTAMP(3),
    "contaBancariaId" INTEGER NOT NULL,
    "faturaId" INTEGER,
    "contaPagarId" INTEGER,
    "processoId" INTEGER,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "dataConciliacao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evento" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "processoId" INTEGER,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'OUTRO',
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "diaInteiro" BOOLEAN NOT NULL DEFAULT false,
    "local" VARCHAR(200),
    "lembreteDias" INTEGER,
    "cor" VARCHAR(7),
    "observacoes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "responsavelId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "resumo" VARCHAR(500) NOT NULL,
    "conteudo" TEXT,
    "imagemUrl" TEXT,
    "imagemAlt" VARCHAR(200),
    "categoria" VARCHAR(100) NOT NULL,
    "tempoLeitura" INTEGER NOT NULL DEFAULT 5,
    "status" "StatusPost" NOT NULL DEFAULT 'RASCUNHO',
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "dataPublicacao" TIMESTAMP(3),
    "metaTitle" VARCHAR(70),
    "metaDescription" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaturaDestinatario" (
    "id" SERIAL NOT NULL,
    "faturaId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaturaDestinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcela" (
    "id" SERIAL NOT NULL,
    "faturaId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "dataPagamento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteAuth" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "senhaHash" VARCHAR(255) NOT NULL,
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "primeiroAcesso" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLogin" TIMESTAMP(3),
    "resetToken" VARCHAR(255),
    "resetTokenExpira" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositivoPush" (
    "id" SERIAL NOT NULL,
    "clienteAuthId" INTEGER NOT NULL,
    "expoPushToken" VARCHAR(255) NOT NULL,
    "plataforma" VARCHAR(20),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositivoPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensagem" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "conteudo" TEXT NOT NULL,
    "usuarioId" INTEGER,
    "clienteAuthId" INTEGER,
    "lidoPeloCliente" BOOLEAN NOT NULL DEFAULT false,
    "lidoPelaEquipe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apagada" BOOLEAN NOT NULL DEFAULT false,
    "editadoEm" TIMESTAMP(3),

    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Perfil" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(200),
    "permissoes" JSONB NOT NULL,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "cor" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recibo" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "pagadorRequerenteId" INTEGER,
    "pagadorContratanteId" INTEGER,
    "pagadorNome" VARCHAR(200),
    "pdfUrl" TEXT,
    "pdfNome" VARCHAR(200),
    "emitidoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recibo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterRecibo" (
    "processoId" INTEGER NOT NULL,
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounterRecibo_pkey" PRIMARY KEY ("processoId")
);

-- CreateTable
CREATE TABLE "OutroCusto" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "natureza" "NaturezaOutroCusto" NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "fornecedor" VARCHAR(150),
    "valor" DECIMAL(12,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "cambio" DECIMAL(10,4),
    "vencimento" TIMESTAMP(3),
    "interno" BOOLEAN NOT NULL DEFAULT false,
    "repassado" BOOLEAN NOT NULL DEFAULT false,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutroCusto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoOutroCusto" (
    "id" SERIAL NOT NULL,
    "outroCustoId" INTEGER NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forma" "FormaPagamento",
    "pagadorTipo" VARCHAR(20),
    "pagadorId" INTEGER,
    "pagadorNome" VARCHAR(200),
    "comprovanteUrl" TEXT,
    "comprovanteNome" VARCHAR(200),
    "observacao" TEXT,
    "estornado" BOOLEAN NOT NULL DEFAULT false,
    "estornadoEm" TIMESTAMP(3),
    "estornoMotivo" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagamentoOutroCusto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receita" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "processoId" INTEGER NOT NULL,
    "categoria" "CategoriaReceita" NOT NULL DEFAULT 'OUTROS',
    "descricao" VARCHAR(300) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
    "valor" DECIMAL(12,2) NOT NULL,
    "fxEstimado" DECIMAL(10,4) NOT NULL,
    "fxRule" "FxRule" NOT NULL DEFAULT 'VARIAVEL',
    "fxFixo" DECIMAL(10,4),
    "fxData" TIMESTAMP(3),
    "valorBrlFixo" DECIMAL(12,2),
    "nParcelas" INTEGER NOT NULL DEFAULT 1,
    "data1" TIMESTAMP(3) NOT NULL,
    "periodicidade" VARCHAR(20) NOT NULL DEFAULT 'Mensal',
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "arquivadaEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "ReceitaStatus" NOT NULL DEFAULT 'ATIVA',
    "personId" INTEGER,
    "documentoId" INTEGER,
    "tipoServicoId" INTEGER,
    "phaseKey" VARCHAR(60),
    "productServiceId" INTEGER,
    "origem" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "phaseCycle" INTEGER,
    "pricingRuleId" INTEGER,
    "valorUnitario" DECIMAL(12,2),
    "quantidade" DECIMAL(12,2),
    "valorTotalCongelado" DECIMAL(12,2),
    "modoCalculoAplicado" VARCHAR(20),
    "naturezaPreco" "NaturezaPreco",
    "configFinanceiraId" INTEGER,
    "regraFinanceiraId" INTEGER,
    "contextoAplicado" JSONB,
    "dataReferencia" TIMESTAMP(3),
    "chaveIdempotencia" VARCHAR(200),
    "origemLancamento" VARCHAR(20) NOT NULL DEFAULT 'PROCESSO',
    "naturezaLancamento" VARCHAR(10) NOT NULL DEFAULT 'RECEITA',
    "eventoOperacionalId" VARCHAR(120),
    "dataCompetencia" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "canceladoMotivo" VARCHAR(500),
    "canceladoPorId" INTEGER,
    "canceladoEventoRef" VARCHAR(120),
    "chaveCancelamento" VARCHAR(220),
    "estornadoEm" TIMESTAMP(3),
    "estornoMotivo" VARCHAR(500),
    "estornoDeId" INTEGER,
    "chaveEstorno" VARCHAR(220),
    "condicaoPagamentoId" INTEGER,
    "condicaoVersao" INTEGER,
    "condicaoCodigo" VARCHAR(40),
    "valorBruto" DECIMAL(12,2),
    "valorTaxas" DECIMAL(12,2),
    "valorLiquido" DECIMAL(12,2),
    "memoriaCalculo" JSONB,

    CONSTRAINT "Receita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Custo" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "processoId" INTEGER NOT NULL,
    "tipo" "TipoCusto" NOT NULL DEFAULT 'SERVICO',
    "categoria" "CategoriaCusto" NOT NULL DEFAULT 'OUTROS',
    "descricao" VARCHAR(300) NOT NULL,
    "fornecedor" VARCHAR(200),
    "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
    "valor" DECIMAL(12,2) NOT NULL,
    "fxEstimado" DECIMAL(10,4) NOT NULL,
    "fxRule" "FxRule" NOT NULL DEFAULT 'VARIAVEL',
    "fxFixo" DECIMAL(10,4),
    "fxData" TIMESTAMP(3),
    "valorBrlFixo" DECIMAL(12,2),
    "nParcelas" INTEGER NOT NULL DEFAULT 1,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "custoOperacional" BOOLEAN NOT NULL DEFAULT false,
    "categoriaVinculada" "CategoriaReceita",
    "percentualVinculado" DECIMAL(5,2),
    "formaPagamento" "FormaPagamento",
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "CustoStatus" NOT NULL DEFAULT 'ATIVA',
    "personId" INTEGER,
    "documentoId" INTEGER,
    "tipoServicoId" INTEGER,
    "phaseKey" VARCHAR(60),
    "productServiceId" INTEGER,
    "origem" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "phaseCycle" INTEGER,
    "pricingRuleId" INTEGER,
    "valorUnitario" DECIMAL(12,2),
    "quantidade" DECIMAL(12,2),
    "valorTotalCongelado" DECIMAL(12,2),
    "modoCalculoAplicado" VARCHAR(20),
    "naturezaPreco" "NaturezaPreco",
    "configFinanceiraId" INTEGER,
    "regraFinanceiraId" INTEGER,
    "contextoAplicado" JSONB,
    "dataReferencia" TIMESTAMP(3),
    "chaveIdempotencia" VARCHAR(200),
    "origemLancamento" VARCHAR(20) NOT NULL DEFAULT 'PROCESSO',
    "naturezaLancamento" VARCHAR(10) NOT NULL DEFAULT 'CUSTO',
    "eventoOperacionalId" VARCHAR(120),
    "dataCompetencia" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "canceladoMotivo" VARCHAR(500),
    "canceladoPorId" INTEGER,
    "canceladoEventoRef" VARCHAR(120),
    "chaveCancelamento" VARCHAR(220),
    "estornadoEm" TIMESTAMP(3),
    "estornoMotivo" VARCHAR(500),
    "estornoDeId" INTEGER,
    "chaveEstorno" VARCHAR(220),
    "condicaoPagamentoId" INTEGER,
    "condicaoVersao" INTEGER,
    "condicaoCodigo" VARCHAR(40),
    "valorBruto" DECIMAL(12,2),
    "valorTaxas" DECIMAL(12,2),
    "valorLiquido" DECIMAL(12,2),
    "memoriaCalculo" JSONB,

    CONSTRAINT "Custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cobranca" (
    "id" SERIAL NOT NULL,
    "receitaId" INTEGER NOT NULL,
    "processoId" INTEGER NOT NULL,
    "formaPagamentoId" INTEGER,
    "condicaoPagamentoId" INTEGER,
    "contaBancariaId" INTEGER,
    "carteiraId" INTEGER,
    "taxaPagamentoId" INTEGER,
    "gateway" VARCHAR(40),
    "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
    "condicaoVersao" INTEGER,
    "condicaoCodigo" VARCHAR(60),
    "memoriaCalculo" JSONB,
    "observacoes" TEXT,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "enviadaEm" TIMESTAMP(3),
    "linkPagamento" VARCHAR(500),
    "enviadaPorId" INTEGER,
    "politicaTaxas" VARCHAR(30),
    "valorBase" DECIMAL(12,2),
    "valorTaxa" DECIMAL(12,2),
    "valorRepassado" DECIMAL(12,2),
    "valorAbsorvido" DECIMAL(12,2),
    "valorLiquido" DECIMAL(12,2),
    "moedaOrigem" VARCHAR(10),
    "moedaDestino" VARCHAR(10),
    "cotacao" DECIMAL(12,6),
    "cotacaoData" TIMESTAMP(3),
    "cotacaoFonte" VARCHAR(40),
    "cotacaoTipo" VARCHAR(20),
    "cotacaoId" INTEGER,
    "cotacaoManualPorId" INTEGER,
    "cotacaoJustificativa" VARCHAR(300),
    "congeladaEm" TIMESTAMP(3),
    "adquirenteId" INTEGER,
    "bandeiraId" INTEGER,
    "idempotencyKey" VARCHAR(80),
    "obrigacaoId" INTEGER,

    CONSTRAINT "Cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelaFinanceira" (
    "id" SERIAL NOT NULL,
    "receitaId" INTEGER,
    "custoId" INTEGER,
    "numero" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "StatusParcela" NOT NULL DEFAULT 'PENDENTE',
    "cambioAplicado" DECIMAL(10,4),
    "valorBrl" DECIMAL(12,2),
    "dataPagamento" TIMESTAMP(3),
    "formaPagamento" "FormaPagamento",
    "banco" VARCHAR(100),
    "comprovanteUrl" TEXT,
    "comprovanteNome" VARCHAR(200),
    "observacoes" TEXT,
    "entrada" BOOLEAN NOT NULL DEFAULT false,
    "valorTaxa" DECIMAL(12,2),
    "valorLiquido" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cobrancaId" INTEGER,

    CONSTRAINT "ParcelaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceitaRequerente" (
    "id" SERIAL NOT NULL,
    "receitaId" INTEGER NOT NULL,
    "requerenteId" INTEGER,
    "idx" INTEGER NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "idade" INTEGER,
    "statusFamiliar" VARCHAR(20),
    "percentual" DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceitaRequerente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceitaDocumento" (
    "id" SERIAL NOT NULL,
    "receitaId" INTEGER,
    "obrigacaoId" INTEGER,
    "arquivoUrl" TEXT NOT NULL,
    "arquivoNome" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(60),
    "tamanho" INTEGER,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceitaDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoFinanceiro" (
    "id" SERIAL NOT NULL,
    "receitaId" INTEGER,
    "custoId" INTEGER,
    "usuarioId" INTEGER,
    "tipo" "TipoEventoFinanceiro" NOT NULL,
    "descricao" VARCHAR(500) NOT NULL,
    "valor" DECIMAL(12,2),
    "cambio" DECIMAL(10,4),
    "valorBrl" DECIMAL(12,2),
    "dados" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cobrancaId" INTEGER,

    CONSTRAINT "EventoFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnaliseDocumental" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "currentStep" VARCHAR(30) NOT NULL DEFAULT 'comparacao_ia',
    "totalDocumentos" INTEGER NOT NULL DEFAULT 0,
    "documentosAnalisados" INTEGER NOT NULL DEFAULT 0,
    "camposComparados" INTEGER NOT NULL DEFAULT 0,
    "resumoIA" TEXT,
    "decisaoJuridica" VARCHAR(20),
    "requerRetificacao" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnaliseDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Divergencia" (
    "id" SERIAL NOT NULL,
    "analiseId" INTEGER NOT NULL,
    "pessoaId" INTEGER,
    "pessoaNome" VARCHAR(200) NOT NULL,
    "geracao" INTEGER,
    "linhaReta" BOOLEAN NOT NULL DEFAULT true,
    "documentoId" INTEGER,
    "documentoTitulo" VARCHAR(200) NOT NULL,
    "dataDocumento" VARCHAR(20),
    "campo" VARCHAR(60) NOT NULL,
    "campoLabel" VARCHAR(120) NOT NULL,
    "valorArvore" VARCHAR(300),
    "valorDocumento" VARCHAR(300),
    "tipo" VARCHAR(40) NOT NULL,
    "severidade" VARCHAR(10) NOT NULL,
    "sugestaoIA" VARCHAR(300),
    "motivoIA" TEXT,
    "impacto" VARCHAR(300),
    "requerRetificacaoIA" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Divergencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaTraducao" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL DEFAULT 'montar_pasta_traducao',
    "sourceLanguage" TEXT NOT NULL DEFAULT 'PortuguÃªs',
    "targetLanguage" TEXT NOT NULL DEFAULT 'Italiano',
    "translatorName" TEXT,
    "translatorEmail" TEXT,
    "cost" TEXT,
    "expectedDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" INTEGER,
    "workflow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PastaTraducao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaTraducaoDocumento" (
    "id" SERIAL NOT NULL,
    "pastaTraducaoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "pessoaNome" TEXT NOT NULL DEFAULT '',
    "documentoTitulo" TEXT NOT NULL DEFAULT '',
    "origem" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "translatedFile" TEXT,
    "conferenceResult" TEXT,
    "validationDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PastaTraducaoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaApostilamento" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL DEFAULT 'montar_pasta_apostilamento',
    "destinationCountry" TEXT,
    "apostilleType" TEXT,
    "authorityName" TEXT,
    "attendant" TEXT,
    "cost" TEXT,
    "trackingCode" TEXT,
    "expectedDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" INTEGER,
    "workflow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PastaApostilamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaApostilamentoDocumento" (
    "id" SERIAL NOT NULL,
    "pastaApostilamentoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "pessoaNome" TEXT NOT NULL DEFAULT '',
    "documentoTitulo" TEXT NOT NULL DEFAULT '',
    "origem" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "apostilledFile" TEXT,
    "apostilleNumber" TEXT,
    "apostilleDate" TEXT,
    "issuingAuthority" TEXT,
    "conferenceResult" TEXT,
    "validationDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PastaApostilamentoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaseFinal" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL,
    "workflow" JSONB,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaseFinal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetificacaoPacote" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "num" TEXT NOT NULL,
    "tipo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'em_preparacao',
    "currentStep" TEXT NOT NULL DEFAULT 'definir_estrategia',
    "motivo" TEXT,
    "prioridade" TEXT DEFAULT 'MÃ©dia',
    "proxAcao" TEXT,
    "profissionalId" INTEGER,
    "processoNum" TEXT,
    "tribunal" TEXT,
    "vara" TEXT,
    "comarca" TEXT,
    "advogado" TEXT,
    "oab" TEXT,
    "statusProc" TEXT,
    "cartorio" TEXT,
    "canal" TEXT,
    "protocolo" TEXT,
    "dataProtocolo" TEXT,
    "atendente" TEXT,
    "prazo" TEXT,
    "statusAdm" TEXT,
    "orgaoId" INTEGER,
    "protocoloId" INTEGER,
    "workflow" JSONB,
    "divergenceIds" JSONB,
    "affectedDocIds" JSONB,
    "movements" JSONB,
    "attachments" JSONB,
    "validacao" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetificacaoPacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetificacaoPacoteDivergencia" (
    "id" SERIAL NOT NULL,
    "pacoteId" INTEGER NOT NULL,
    "divergenciaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetificacaoPacoteDivergencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profissional" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "email" VARCHAR(200),
    "telefone" VARCHAR(60),
    "organizacaoId" INTEGER,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroProfissional" (
    "id" SERIAL NOT NULL,
    "profissionalId" INTEGER NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "numero" VARCHAR(40) NOT NULL,
    "jurisdicao" VARCHAR(40),
    "orgaoDeClasseId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistroProfissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissaoRetificada" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "pessoaNome" TEXT NOT NULL,
    "pessoaGen" TEXT,
    "pessoaPapel" TEXT,
    "documentoTitulo" TEXT NOT NULL,
    "correcaoCampo" TEXT,
    "correcaoOld" TEXT,
    "correcaoNovo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente_averbacao',
    "nextAction" TEXT NOT NULL DEFAULT 'Enviar pedido de averbaÃ§Ã£o ao cartÃ³rio',
    "workflow" JSONB NOT NULL,
    "retifiedValidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissaoRetificada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banco" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "sigla" TEXT,
    "pais" TEXT,
    "website" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotacaoCambio" (
    "id" SERIAL NOT NULL,
    "moedaDe" "Moeda" NOT NULL,
    "moedaPara" "Moeda" NOT NULL,
    "taxa" DECIMAL(14,6) NOT NULL,
    "data" TIMESTAMP(3),
    "fonte" VARCHAR(100),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataReferencia" TIMESTAMP(3),
    "consultadoEm" TIMESTAMP(3),
    "origem" VARCHAR(30),
    "modalidade" VARCHAR(40),
    "statusIntegracao" VARCHAR(30),
    "payloadHash" VARCHAR(80),
    "urlFonte" VARCHAR(300),
    "vigente" BOOLEAN NOT NULL DEFAULT false,
    "semNovaPublicacao" BOOLEAN NOT NULL DEFAULT false,
    "substituiId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CotacaoCambio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Imposto" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20),
    "nome" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(20),
    "modoCalculo" VARCHAR(20),
    "percentual" DECIMAL(7,4),
    "valorFixo" DECIMAL(12,2),
    "aplicaA" VARCHAR(20),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Imposto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarteiraRecebimento" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(30),
    "contaBancariaId" INTEGER,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "diasLiquidacao" INTEGER DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarteiraRecebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoFinanceiro" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "especie" VARCHAR(20),
    "tipoFinanceiro" VARCHAR(20),
    "moedaPadrao" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorPadrao" DECIMAL(12,2),
    "possuiCusto" BOOLEAN NOT NULL DEFAULT false,
    "possuiReceita" BOOLEAN NOT NULL DEFAULT false,
    "valorCustoPadrao" DECIMAL(12,2),
    "valorReceitaPadrao" DECIMAL(12,2),
    "naturezaFin" "NaturezaFinanceira",
    "aplicaA" VARCHAR(20),
    "cobravelDoCliente" BOOLEAN NOT NULL DEFAULT false,
    "regraComissaoId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "naturezaFinanceira" VARCHAR(20) DEFAULT 'revenue',
    "custoInterno" BOOLEAN NOT NULL DEFAULT false,
    "repasse" BOOLEAN NOT NULL DEFAULT false,
    "reembolsavel" BOOLEAN NOT NULL DEFAULT false,
    "itemCatalogoId" INTEGER,
    "tipoDocumentoId" INTEGER,
    "honorarioId" INTEGER,
    "tipoProcessoId" INTEGER,
    "fornecedorPadraoId" INTEGER,
    "condicaoPagamentoId" INTEGER,

    CONSTRAINT "ProdutoFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TabelaValor" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "processoTipoId" VARCHAR(60),
    "faseKey" VARCHAR(60),
    "produtoServicoId" VARCHAR(60),
    "fornecedorId" INTEGER,
    "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
    "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorBase" DECIMAL(12,2),
    "valorAdicional" DECIMAL(12,2),
    "modoCalculo" VARCHAR(40) NOT NULL DEFAULT 'fixed',
    "condicao" VARCHAR(200),
    "vigenciaInicio" VARCHAR(10),
    "vigenciaFim" VARCHAR(10),
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "itemCatalogoId" INTEGER,
    "natureza" "NaturezaPreco",
    "regiao" VARCHAR(60),
    "processoId" INTEGER,
    "configuracaoFinanceiraItemId" INTEGER,
    "modalidadeId" INTEGER,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "unidade" VARCHAR(20),
    "quantidadeMinima" DECIMAL(12,2),
    "quantidadeMaxima" DECIMAL(12,2),
    "legadoPendente" BOOLEAN NOT NULL DEFAULT false,
    "migradoDeCampoLegado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TabelaValor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendenciaFinanceira" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "tipoProcessoId" INTEGER,
    "phaseKey" VARCHAR(60) NOT NULL,
    "phaseCycle" INTEGER NOT NULL DEFAULT 1,
    "configFinanceiraId" INTEGER,
    "regraFinanceiraId" INTEGER,
    "natureza" "NaturezaPreco",
    "motivo" VARCHAR(40) NOT NULL,
    "detalhe" VARCHAR(500) NOT NULL,
    "contexto" JSONB,
    "chaveIdempotencia" VARCHAR(220) NOT NULL,
    "resolvida" BOOLEAN NOT NULL DEFAULT false,
    "resolvidaEm" TIMESTAMP(3),
    "resolucao" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimaTentativaEm" TIMESTAMP(3),
    "ultimaFalha" VARCHAR(500),

    CONSTRAINT "PendenciaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamento" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "formaPagamento" "FormaPagamento",
    "carteiraId" INTEGER,
    "temEntrada" BOOLEAN NOT NULL DEFAULT false,
    "percentEntrada" DECIMAL(5,2),
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "diaVencimento" INTEGER,
    "aplicarTaxas" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "codigo" VARCHAR(40),
    "descricao" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" INTEGER,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "tipoPagamento" VARCHAR(20) NOT NULL DEFAULT 'PARCELADO',
    "entradaObrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "valorEntradaFixo" DECIMAL(12,2),
    "parcelasMin" INTEGER,
    "parcelasMax" INTEGER,
    "parcelasPadrao" INTEGER,
    "permiteParcelasPersonalizadas" BOOLEAN NOT NULL DEFAULT false,
    "permiteEdicaoManual" BOOLEAN NOT NULL DEFAULT false,
    "inicioCronograma" VARCHAR(20) NOT NULL DEFAULT 'IMEDIATA',
    "primeiraParcelaDias" INTEGER,
    "primeiraParcelaData" TIMESTAMP(3),
    "periodicidade" VARCHAR(20) NOT NULL DEFAULT 'MENSAL',
    "periodicidadeDias" INTEGER,
    "diaFixo" INTEGER,
    "ajusteDiaUtil" VARCHAR(20) NOT NULL DEFAULT 'NENHUM',
    "ajustarFimDeSemana" BOOLEAN NOT NULL DEFAULT false,
    "ajustarFeriados" BOOLEAN NOT NULL DEFAULT false,
    "distribuicao" VARCHAR(30) NOT NULL DEFAULT 'ULTIMA_AJUSTA',
    "primeiraParcelaPercent" DECIMAL(5,2),
    "multaPercent" DECIMAL(7,4),
    "jurosMesPercent" DECIMAL(7,4),
    "descontoPercent" DECIMAL(7,4),
    "descontoAntecipacaoPercent" DECIMAL(7,4),
    "descontoAVistaPercent" DECIMAL(7,4),
    "politicaCambio" VARCHAR(20) NOT NULL DEFAULT 'VARIAVEL',
    "travaCambial" BOOLEAN NOT NULL DEFAULT false,
    "aplicaA" VARCHAR(20) NOT NULL DEFAULT 'AMBOS',
    "moedasPermitidas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "valorMinimo" DECIMAL(12,2),
    "valorMaximo" DECIMAL(12,2),
    "paises" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modalidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tiposProcesso" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observacoes" TEXT,
    "politicaTaxas" VARCHAR(30) NOT NULL DEFAULT 'IGNORAR',
    "formaSugeridaId" INTEGER,
    "entradaTipo" VARCHAR(20),
    "entradaMin" DECIMAL(12,2),
    "entradaMax" DECIMAL(12,2),
    "entradaCompoeTotal" BOOLEAN NOT NULL DEFAULT true,
    "entradaAdicional" BOOLEAN NOT NULL DEFAULT false,
    "diaInexistente" VARCHAR(20),
    "comportamentoFimSemana" VARCHAR(20),
    "comportamentoFeriado" VARCHAR(20),
    "multaTipo" VARCHAR(20),
    "multaValor" DECIMAL(12,2),
    "jurosTipo" VARCHAR(20),
    "jurosPeriodo" VARCHAR(20),
    "carenciaDias" INTEGER,
    "descontoTipo" VARCHAR(20),
    "descontoAntecipacaoAuto" BOOLEAN NOT NULL DEFAULT false,
    "quemConcedeDesconto" VARCHAR(40),
    "perfil" VARCHAR(60),
    "canal" VARCHAR(60),
    "servicos" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "CondicaoPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoForma" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "formaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoForma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoTaxa" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "taxaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoTaxa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoMoeda" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "moedaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoMoeda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoPais" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "paisId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoPais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoModalidade" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "modalidadeId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoModalidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CondicaoPagamentoServico" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CondicaoPagamentoServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Honorario" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL DEFAULT 'main',
    "servico" VARCHAR(200),
    "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
    "valorPadrao" DECIMAL(12,2),
    "momentoCobranca" VARCHAR(30) NOT NULL DEFAULT 'contract_signed',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Honorario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraComissao" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "papel" VARCHAR(120),
    "modoCalculo" VARCHAR(20) NOT NULL DEFAULT 'percentage',
    "percent" DECIMAL(5,2),
    "valorFixo" DECIMAL(12,2),
    "momento" VARCHAR(30) NOT NULL DEFAULT 'first_payment_received',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegraComissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraDesconto" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "maxPercentSemAprovacao" DECIMAL(5,2),
    "maxValorSemAprovacao" DECIMAL(12,2),
    "exigeAprovacaoAcima" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegraDesconto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicoProduto" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "unidadePadrao" "UnidadeItem",
    "aplicacaoGlobal" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "itemCatalogoId" INTEGER,

    CONSTRAINT "ServicoProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicoProdutoPais" (
    "id" SERIAL NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "paisId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicoProdutoPais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoedaCadastro" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100),
    "symbol" VARCHAR(10),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoedaCadastro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormaPagamentoCadastro" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40),
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(30),
    "moeda" VARCHAR(10),
    "permiteParcelas" BOOLEAN NOT NULL DEFAULT false,
    "maxParcelas" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "icone" VARCHAR(60),
    "aceitaEntrada" BOOLEAN NOT NULL DEFAULT false,
    "aceitaRecorrencia" BOOLEAN NOT NULL DEFAULT false,
    "aceitaMoedaEstrangeira" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "descricao" VARCHAR(300),
    "categoria" VARCHAR(40),
    "moedasAceitas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minParcelas" INTEGER DEFAULT 1,
    "exigeAdquirente" BOOLEAN NOT NULL DEFAULT false,
    "usoRecebimento" BOOLEAN NOT NULL DEFAULT true,
    "usoPagamento" BOOLEAN NOT NULL DEFAULT true,
    "permiteCancelamento" BOOLEAN NOT NULL DEFAULT false,
    "permiteEstorno" BOOLEAN NOT NULL DEFAULT false,
    "permiteReembolso" BOOLEAN NOT NULL DEFAULT false,
    "permiteInternacional" BOOLEAN NOT NULL DEFAULT false,
    "liquidacaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "conciliacaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "permiteComprovante" BOOLEAN NOT NULL DEFAULT false,
    "emissaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "permiteCobrancaManual" BOOLEAN NOT NULL DEFAULT true,
    "tipoIntegracao" VARCHAR(20),
    "provedorIntegracao" VARCHAR(120),
    "integracaoAtiva" BOOLEAN NOT NULL DEFAULT false,
    "carteirasCompativeis" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "contasCompativeis" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "prazoLiquidacao" VARCHAR(10),
    "diasLiquidacao" INTEGER,
    "diasCorridos" BOOLEAN NOT NULL DEFAULT true,
    "permiteAntecipacao" BOOLEAN NOT NULL DEFAULT false,
    "utilizaTaxas" BOOLEAN NOT NULL DEFAULT false,
    "permiteTaxaAntecipacao" BOOLEAN NOT NULL DEFAULT false,
    "permiteTaxaParcelamento" BOOLEAN NOT NULL DEFAULT false,
    "permiteTaxaInternacional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FormaPagamentoCadastro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxaPagamento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40),
    "name" VARCHAR(200) NOT NULL,
    "formaPagamentoId" INTEGER,
    "moeda" VARCHAR(10),
    "feeType" VARCHAR(30),
    "feePercent" DECIMAL(7,4),
    "fixedFee" DECIMAL(12,2),
    "anticipationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "anticipationPercent" DECIMAL(7,4),
    "installmentsFrom" INTEGER,
    "installmentsTo" INTEGER,
    "baseIncidencia" VARCHAR(20) NOT NULL DEFAULT 'TOTAL',
    "quemAbsorve" VARCHAR(20) NOT NULL DEFAULT 'EMPRESA',
    "adquirente" VARCHAR(120),
    "adquirenteId" INTEGER,
    "bandeiraId" INTEGER,
    "finalidade" VARCHAR(20),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "descricao" VARCHAR(300),
    "categoria" VARCHAR(40),
    "formasAplicaveis" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "aplicaParcela" VARCHAR(20),
    "anticipationType" VARCHAR(20),
    "anticipationFixed" DECIMAL(12,2),
    "anticipationMinDays" INTEGER,
    "absorcaoPercentEmpresa" DECIMAL(5,2),
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "paises" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moedasAplicaveis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "servicos" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "modalidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tiposProcesso" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "valorMinimo" DECIMAL(12,2),
    "valorMaximo" DECIMAL(12,2),
    "canal" VARCHAR(60),
    "gateway" VARCHAR(40),
    "perfil" VARCHAR(60),
    "momentoCambio" VARCHAR(20),

    CONSTRAINT "TaxaPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxaParcelamento" (
    "id" SERIAL NOT NULL,
    "taxaId" INTEGER NOT NULL,
    "parcelasDe" INTEGER NOT NULL,
    "parcelasAte" INTEGER NOT NULL,
    "feePercent" DECIMAL(7,4),
    "fixedFee" DECIMAL(12,2),
    "antecipacao" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxaParcelamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxaPagamentoMoeda" (
    "id" SERIAL NOT NULL,
    "taxaId" INTEGER NOT NULL,
    "moedaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxaPagamentoMoeda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxaPagamentoPais" (
    "id" SERIAL NOT NULL,
    "taxaId" INTEGER NOT NULL,
    "paisId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxaPagamentoPais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adquirente" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20),
    "slug" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "formasSuportadas" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "identificadorExterno" VARCHAR(120),
    "metadados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adquirente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bandeira" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20),
    "slug" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "adquirentesCompativeis" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bandeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoProcessoNacionalidade" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "countryKey" VARCHAR(40) NOT NULL,
    "countryLabel" VARCHAR(80) NOT NULL,
    "nationalityKey" VARCHAR(40) NOT NULL,
    "nationalityLabel" VARCHAR(80) NOT NULL,
    "modalityKey" VARCHAR(40) NOT NULL,
    "modalityLabel" VARCHAR(80) NOT NULL,
    "processFamily" VARCHAR(40) NOT NULL DEFAULT 'cidadania',
    "serviceNature" VARCHAR(40) NOT NULL DEFAULT 'main_process',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoProcessoNacionalidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoPais" (
    "id" SERIAL NOT NULL,
    "countryKey" VARCHAR(40) NOT NULL,
    "countryLabel" VARCHAR(80) NOT NULL,
    "nationalityKey" VARCHAR(40) NOT NULL,
    "nationalityLabel" VARCHAR(80) NOT NULL,
    "flag" VARCHAR(10),
    "language" VARCHAR(10),
    "defaultCurrency" VARCHAR(10) NOT NULL DEFAULT 'EUR',
    "codePrefix" VARCHAR(10),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoPais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModalidadePais" (
    "id" SERIAL NOT NULL,
    "countryKey" VARCHAR(40) NOT NULL,
    "modalityKey" VARCHAR(40) NOT NULL,
    "modalityLabel" VARCHAR(80) NOT NULL,
    "codeSuffix" VARCHAR(20),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModalidadePais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaseNaturezaPermitida" (
    "id" SERIAL NOT NULL,
    "catalogoFaseId" INTEGER NOT NULL,
    "naturezaOperacionalId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaseNaturezaPermitida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoFase" (
    "id" SERIAL NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "escopo" "EscopoExecucao",
    "ordemPadrao" INTEGER NOT NULL DEFAULT 0,
    "requiredPadrao" BOOLEAN NOT NULL DEFAULT true,
    "conditionalPadrao" BOOLEAN NOT NULL DEFAULT false,
    "slaDiasPadrao" INTEGER NOT NULL DEFAULT 30,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "efeitosPermitidos" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "conduzidaPeloWorkflowInterno" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CatalogoFase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroWorkflow" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaseMacro" (
    "id" SERIAL NOT NULL,
    "macroWorkflowId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "conditional" BOOLEAN NOT NULL DEFAULT false,
    "entryRule" VARCHAR(40) NOT NULL DEFAULT 'previous_phase_completed',
    "exitRule" VARCHAR(120),
    "slaDays" INTEGER NOT NULL DEFAULT 30,
    "showInKanban" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaseMacro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseInternalWorkflow" (
    "id" SERIAL NOT NULL,
    "wfUid" VARCHAR(140) NOT NULL,
    "templateId" INTEGER,
    "tipoProcessoId" INTEGER,
    "phaseKey" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "execucao" VARCHAR(20) NOT NULL DEFAULT 'SEQUENCIAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "escopoExecucao" "EscopoExecucao",
    "familiaDocumentalId" INTEGER,
    "exigeDocumento" BOOLEAN NOT NULL DEFAULT false,
    "exigePessoa" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmEsperaExterna" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmBloqueio" BOOLEAN NOT NULL DEFAULT false,
    "rascunhoAlteradoEm" TIMESTAMP(3),
    "rascunhoAlteradoPor" INTEGER,

    CONSTRAINT "PhaseInternalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseInternalWorkflowVersao" (
    "id" SERIAL NOT NULL,
    "workflowId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "tipoProcessoId" INTEGER,
    "name" VARCHAR(200) NOT NULL,
    "execucao" VARCHAR(20) NOT NULL,
    "escopoExecucao" "EscopoExecucao",
    "familiaDocumentalId" INTEGER,
    "exigeDocumento" BOOLEAN NOT NULL DEFAULT false,
    "exigePessoa" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmEsperaExterna" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmBloqueio" BOOLEAN NOT NULL DEFAULT false,
    "passos" JSONB NOT NULL,
    "congeladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "congeladoPorId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,

    CONSTRAINT "PhaseInternalWorkflowVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseInternalWorkflowStep" (
    "id" SERIAL NOT NULL,
    "workflowId" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createsTask" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "owner" VARCHAR(120),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "slaDays" INTEGER NOT NULL DEFAULT 0,
    "cardinalidade" VARCHAR(20),
    "completionRule" TEXT,
    "checklist" JSONB,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "dependeDe" JSONB,
    "executorKey" VARCHAR(40),
    "reaberturaPermitida" BOOLEAN NOT NULL DEFAULT true,
    "reaberturaEstrategia" VARCHAR(24) NOT NULL DEFAULT 'ESCOLHA_MANUAL',
    "reaberturaExigeJustificativa" BOOLEAN NOT NULL DEFAULT true,
    "reaberturaPermissao" VARCHAR(60),
    "regraDeConclusao" VARCHAR(40) NOT NULL DEFAULT 'ACAO_DO_PASSO',

    CONSTRAINT "PhaseInternalWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepSubtaskDefinition" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "repetivel" BOOLEAN NOT NULL DEFAULT false,
    "maxOcorrencias" INTEGER,
    "modoExecucao" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "responsavelRegra" VARCHAR(20) NOT NULL DEFAULT 'HERDA',
    "responsavelId" INTEGER,
    "slaDays" INTEGER,
    "condicaoEntrada" JSONB,
    "condicaoConclusao" JSONB,
    "condicaoVisibilidade" JSONB,
    "dependeDe" JSONB,
    "executorKey" VARCHAR(40),
    "cardinalidade" VARCHAR(20),
    "fonteDeCanais" VARCHAR(30) NOT NULL DEFAULT 'NENHUMA',
    "tiposDeCanal" JSONB,
    "reaberturaPermitida" BOOLEAN,
    "reaberturaExigeJustificativa" BOOLEAN,
    "reaberturaPermissao" VARCHAR(60),
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepSubtaskDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepAction" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "effectKey" VARCHAR(60) NOT NULL,
    "requerCampos" JSONB,
    "permissao" VARCHAR(60),
    "condicao" JSONB,
    "metadata" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "subtaskId" INTEGER,

    CONSTRAINT "StepAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepField" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "opcoes" JSONB,
    "condicao" JSONB,
    "ajuda" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "subtaskId" INTEGER,

    CONSTRAINT "StepField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepFieldOption" (
    "id" SERIAL NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "condicao" JSONB,
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepChannel" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "canalId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "exigeProtocolo" BOOLEAN,
    "exigeAnexo" BOOLEAN,
    "exigeRastreio" BOOLEAN,
    "exigeObservacao" BOOLEAN,
    "camposObrigatorios" JSONB,
    "condicao" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRequirement" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "tipo" VARCHAR(30) NOT NULL,
    "alvoKey" VARCHAR(60),
    "minimo" INTEGER NOT NULL DEFAULT 1,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "condicao" JSONB,
    "acaoKey" VARCHAR(60),
    "evidenciaTipoId" INTEGER,
    "mimesPermitidos" JSONB,
    "momento" VARCHAR(24) NOT NULL DEFAULT 'AO_CONCLUIR',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "subtaskId" INTEGER,

    CONSTRAINT "StepRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepChecklistItem" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "subtaskId" INTEGER,

    CONSTRAINT "StepChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizacaoCanal" (
    "id" SERIAL NOT NULL,
    "organizacaoId" INTEGER NOT NULL,
    "canalId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "exigeProtocolo" BOOLEAN,
    "exigeAnexo" BOOLEAN,
    "exigeRastreio" BOOLEAN,
    "exigeObservacao" BOOLEAN,
    "endereco" VARCHAR(300),
    "prazoDias" INTEGER,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizacaoCanal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanalOperacional" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "protocoloObrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "anexoObrigatorioLabel" VARCHAR(160),
    "rastreioObrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "observacaoObrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "aplicacao" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanalOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseAutomationRule" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "templateId" INTEGER,
    "tipoProcessoId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200),
    "description" TEXT,
    "kind" VARCHAR(30) NOT NULL,
    "scope" VARCHAR(40) NOT NULL DEFAULT 'phase',
    "trigger" VARCHAR(60) NOT NULL DEFAULT 'phase_entered',
    "action" VARCHAR(80),
    "conditions" JSONB,
    "params" JSONB,
    "financialType" VARCHAR(20),
    "configItemId" INTEGER,
    "aplicacaoFinanceira" VARCHAR(10),
    "idempotencyPattern" VARCHAR(120) NOT NULL DEFAULT 'processId+phaseKey',
    "idempotent" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Departamento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40),
    "name" VARCHAR(200) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Departamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgaoProtocolo" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "nomeFantasia" VARCHAR(200),
    "type" VARCHAR(30),
    "country" VARCHAR(60),
    "state" VARCHAR(60),
    "provincia" VARCHAR(80),
    "city" VARCHAR(100),
    "endereco" VARCHAR(300),
    "cep" VARCHAR(20),
    "site" VARCHAR(300),
    "email" VARCHAR(200),
    "telefone" VARCHAR(60),
    "idioma" VARCHAR(10),
    "moeda" VARCHAR(10),
    "horario" VARCHAR(200),
    "responsavel" VARCHAR(200),
    "observacoes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "queueRule" VARCHAR(200),
    "funcoes" "FuncaoOrganizacao"[] DEFAULT ARRAY[]::"FuncaoOrganizacao"[],
    "identificacaoFiscal" VARCHAR(40),
    "tipoIdentificacaoFiscal" VARCHAR(20),
    "formaPagamento" VARCHAR(60),
    "chavePix" VARCHAR(140),
    "tipoChavePix" VARCHAR(20),
    "banco" VARCHAR(120),
    "agencia" VARCHAR(20),
    "conta" VARCHAR(30),
    "tipoConta" VARCHAR(20),
    "prazoPagamentoDias" INTEGER,
    "contatoFinanceiro" VARCHAR(200),
    "observacoesFinanceiras" TEXT,
    "statusFinanceiro" VARCHAR(20),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgaoProtocolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoDocumentoCadastro" (
    "publicCode" VARCHAR(20),
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40),
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(30),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "itemCatalogoId" INTEGER,
    "legacyEnumKey" VARCHAR(60),
    "nature" VARCHAR(30),
    "countryCode" VARCHAR(8),
    "description" TEXT,
    "participaPlanilha" BOOLEAN NOT NULL DEFAULT false,
    "categoriaDocumentalId" INTEGER,
    "familiaDocumentalId" INTEGER,
    "naturezaOperacionalId" INTEGER,
    "perfilOperacionalId" INTEGER,

    CONSTRAINT "TipoDocumentoCadastro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamiliaDocumental" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamiliaDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaturezaOperacionalDocumento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "exigeWorkflow" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaturezaOperacionalDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilOperacionalDocumento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "workflowId" INTEGER,
    "familiaDocumentalId" INTEGER,
    "escopoInstanciacao" "EscopoExecucao" NOT NULL DEFAULT 'DOCUMENTO',
    "exigeProcesso" BOOLEAN NOT NULL DEFAULT true,
    "exigePessoa" BOOLEAN NOT NULL DEFAULT true,
    "exigeDocumento" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilOperacionalDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaDocumental" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrizDocumental" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60),
    "documentTypeCode" VARCHAR(40) NOT NULL,
    "target" VARCHAR(40) NOT NULL DEFAULT 'direct_line_person',
    "generationRule" VARCHAR(40) NOT NULL DEFAULT 'all_direct_line',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "conditional" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT,
    "createsTask" BOOLEAN NOT NULL DEFAULT true,
    "createsCost" BOOLEAN NOT NULL DEFAULT false,
    "createsRevenue" BOOLEAN NOT NULL DEFAULT false,
    "blocksPhaseCompletion" BOOLEAN NOT NULL DEFAULT false,
    "usedByCount" INTEGER NOT NULL DEFAULT 0,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "codigo" VARCHAR(60),
    "nome" VARCHAR(200),
    "descricao" TEXT,
    "status" "RegraDocumentalStatus" NOT NULL DEFAULT 'RASCUNHO',
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "aplicaTodosProcessos" BOOLEAN NOT NULL DEFAULT false,
    "tipoProcessoIds" JSONB,
    "modalidadeId" INTEGER,
    "paisCode" VARCHAR(8),
    "regiaoCode" VARCHAR(16),
    "tipoProcessoVersao" INTEGER,
    "requisitoNome" VARCHAR(200),
    "documentosAceitos" JSONB,
    "modoSatisfacao" "ModoSatisfacaoRequisito" NOT NULL DEFAULT 'QUALQUER_UM_ATENDE',
    "categoriaCode" VARCHAR(40),
    "obrigatoriedade" "ObrigatoriedadeRegra" NOT NULL DEFAULT 'OBRIGATORIA',
    "publicoAlvo" "PublicoAlvoRegra" NOT NULL DEFAULT 'PESSOA_DA_LINHA_RETA',
    "publicosAlvo" JSONB,
    "condicoes" JSONB,
    "faseExigencia" VARCHAR(60),
    "faseBloqueio" VARCHAR(60),
    "continuaObrigatorioNasFasesSeguintes" BOOLEAN NOT NULL DEFAULT false,
    "faseFinalExigencia" VARCHAR(60),
    "obrigatorioAteFinalProcesso" BOOLEAN NOT NULL DEFAULT false,
    "possuiValidade" BOOLEAN NOT NULL DEFAULT false,
    "validadeDias" INTEGER,
    "exigeDataEmissao" BOOLEAN NOT NULL DEFAULT false,
    "renovarQuandoExpirado" BOOLEAN NOT NULL DEFAULT false,
    "antecedenciaRenovacaoDias" INTEGER,
    "criadoPor" INTEGER,
    "atualizadoPor" INTEGER,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPor" INTEGER,

    CONSTRAINT "MatrizDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorArtefato" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "event" VARCHAR(20) NOT NULL DEFAULT 'entered',
    "ruleKind" VARCHAR(30) NOT NULL,
    "ruleSource" VARCHAR(20) NOT NULL,
    "ruleId" INTEGER,
    "automaticKey" VARCHAR(200) NOT NULL,
    "targetTable" VARCHAR(40) NOT NULL,
    "targetId" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "descricao" VARCHAR(300) NOT NULL,
    "detalhes" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneEm" TIMESTAMP(3),

    CONSTRAINT "MotorArtefato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "autoExecutarAoAvancar" BOOLEAN NOT NULL DEFAULT false,
    "runtimeV2Habilitado" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraTarefaTransversal" (
    "id" SERIAL NOT NULL,
    "ruleKey" VARCHAR(80),
    "name" VARCHAR(200) NOT NULL,
    "tipoProcessoId" INTEGER,
    "originPhase" VARCHAR(60) NOT NULL,
    "operationalPhase" VARCHAR(60) NOT NULL,
    "templateId" INTEGER,
    "trigger" JSONB,
    "creation" JSONB,
    "originLink" JSONB,
    "duplicatePolicy" JSONB,
    "applyResult" JSONB,
    "autoCreate" BOOLEAN NOT NULL DEFAULT false,
    "suggested" BOOLEAN NOT NULL DEFAULT true,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "isSystemTemplate" BOOLEAN NOT NULL DEFAULT false,
    "usedByCount" INTEGER NOT NULL DEFAULT 0,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegraTarefaTransversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilPermissaoMotor" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(80) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "permissoes" JSONB,
    "isSystemTemplate" BOOLEAN NOT NULL DEFAULT false,
    "usedByCount" INTEGER NOT NULL DEFAULT 0,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilPermissaoMotor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseEconomicRule" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER,
    "phaseKey" VARCHAR(60) NOT NULL,
    "documentTypeCode" VARCHAR(40),
    "appliesTo" VARCHAR(30) NOT NULL DEFAULT 'any',
    "componentKey" VARCHAR(40) NOT NULL,
    "componentName" VARCHAR(100) NOT NULL,
    "custoProdutoCode" VARCHAR(30),
    "receitaProdutoCode" VARCHAR(30),
    "participaPlanilha" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "tipoDocumentoId" INTEGER,
    "custoConfigId" INTEGER,
    "receitaConfigId" INTEGER,

    CONSTRAINT "PhaseEconomicRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCatalogo" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "natureza" "NaturezaItem" NOT NULL DEFAULT 'OUTRO',
    "categoriaId" INTEGER,
    "unidade" "UnidadeItem" NOT NULL DEFAULT 'UNIDADE',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NecessidadeDocumental" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "itemCatalogoId" INTEGER NOT NULL,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "varianteKey" VARCHAR(60) NOT NULL DEFAULT 'padrao',
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "origem" "OrigemNecessidade" NOT NULL DEFAULT 'MANUAL',
    "obrigatoriedade" "ObrigatoriedadeNecessidade" NOT NULL DEFAULT 'OBRIGATORIA',
    "status" "StatusNecessidade" NOT NULL DEFAULT 'PENDENTE',
    "matrizRegraId" INTEGER,
    "matrizRegraVersao" INTEGER,
    "matrizSnapshot" JSONB,
    "avaliadaEm" TIMESTAMP(3),
    "motivoAplicabilidade" TEXT,
    "arvoreId" INTEGER,
    "ruleCode" VARCHAR(20),
    "supersedePorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NecessidadeDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NecessidadeDocumentalEvento" (
    "id" SERIAL NOT NULL,
    "necessidadeId" INTEGER NOT NULL,
    "tipo" "TipoEventoNecessidade" NOT NULL,
    "descricao" VARCHAR(300),
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NecessidadeDocumentalEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseWorkflowInstance" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "faseMacroId" INTEGER,
    "faseMacroVersion" INTEGER,
    "macroWorkflowId" INTEGER,
    "macroVersion" INTEGER,
    "workflowDefinitionId" INTEGER,
    "workflowVersion" INTEGER,
    "snapshot" JSONB,
    "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "origem" "OrigemInstancia" NOT NULL DEFAULT 'MOTOR',
    "instanciadoPor" VARCHAR(60),
    "correlationId" VARCHAR(60),
    "causationId" VARCHAR(200),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "previousInstanceId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inicioReal" TIMESTAMP(3),
    "conclusaoReal" TIMESTAMP(3),
    "fonteDataHistorica" VARCHAR(200),
    "requerRegularizacao" BOOLEAN NOT NULL DEFAULT false,
    "regularizadoEm" TIMESTAMP(3),
    "regularizadoPorId" INTEGER,
    "motivoAdministrativo" TEXT,
    "motivoNaoAplicavel" TEXT,
    "criadoPorId" INTEGER,

    CONSTRAINT "PhaseWorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepExecution" (
    "id" SERIAL NOT NULL,
    "stepInstanceId" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "status" "StepInstanceStatus" NOT NULL,
    "motivo" VARCHAR(30) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executadoPorId" INTEGER,
    "resultado" VARCHAR(60),
    "payload" JSONB,
    "protocoloId" INTEGER,
    "supersededAt" TIMESTAMP(3),
    "supersededPorId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtaskExecution" (
    "id" SERIAL NOT NULL,
    "stepInstanceId" INTEGER NOT NULL,
    "subtaskKey" VARCHAR(60) NOT NULL,
    "subtaskDefinitionId" INTEGER,
    "workflowVersao" INTEGER,
    "sequencia" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "motivo" VARCHAR(30) NOT NULL,
    "bloqueioCodigo" VARCHAR(40),
    "bloqueioAlvo" VARCHAR(120),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executadoPorId" INTEGER,
    "responsavelId" INTEGER,
    "prazo" TIMESTAMP(3),
    "resultado" VARCHAR(60),
    "payload" JSONB,
    "fornecedorId" INTEGER,
    "canalKey" VARCHAR(40),
    "protocolo" VARCHAR(120),
    "protocoloId" INTEGER,
    "enviadoEm" TIMESTAMP(3),
    "previstoPara" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededPorId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtaskExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseWorkflowStepInstance" (
    "id" SERIAL NOT NULL,
    "workflowInstanceId" INTEGER NOT NULL,
    "stepDefinitionId" INTEGER,
    "stepDefinitionVersion" INTEGER,
    "stepKey" VARCHAR(80) NOT NULL,
    "snapshot" JSONB,
    "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "processoId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "tipo" "PassoTipo" NOT NULL DEFAULT 'HUMANO',
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "geraTarefa" BOOLEAN NOT NULL DEFAULT true,
    "pessoaId" INTEGER,
    "necessidadeId" INTEGER,
    "documentoId" INTEGER,
    "retificacaoPacoteId" INTEGER,
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "status" "StepInstanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "prioridade" VARCHAR(20),
    "responsavelId" INTEGER,
    "equipe" VARCHAR(120),
    "papel" VARCHAR(80),
    "aprovadorId" INTEGER,
    "slaDays" INTEGER,
    "prazo" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "dispensedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "motivo" VARCHAR(300),
    "bloqueadoManual" BOOLEAN NOT NULL DEFAULT false,
    "dependeDeStepKeys" JSONB,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "correlationId" VARCHAR(60),
    "causationId" VARCHAR(200),
    "previousStepInstanceId" INTEGER,
    "metadata" JSONB,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "statusAnteriorBloqueio" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseWorkflowStepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvento" (
    "id" SERIAL NOT NULL,
    "tipo" "WorkflowEventoTipo" NOT NULL,
    "entityType" VARCHAR(30) NOT NULL,
    "entityId" INTEGER,
    "processoId" INTEGER,
    "workflowInstanceId" INTEGER,
    "stepInstanceId" INTEGER,
    "tarefaId" INTEGER,
    "correlationId" VARCHAR(60),
    "causationId" VARCHAR(200),
    "chaveIdempotencia" VARCHAR(200),
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseAdvanceLog" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseAtual" VARCHAR(60) NOT NULL,
    "fasePretendida" VARCHAR(60),
    "faseAnteriorId" INTEGER,
    "fasePretendidaId" INTEGER,
    "macroWorkflowId" INTEGER,
    "macroVersion" INTEGER,
    "internalWorkflowVersion" INTEGER,
    "policy" VARCHAR(40) NOT NULL DEFAULT 'ALL_REQUIRED_COMPLETED',
    "regrasAvaliadas" JSONB NOT NULL,
    "pendencias" JSONB NOT NULL,
    "warnings" JSONB,
    "resultado" "AdvanceResultado" NOT NULL,
    "origem" VARCHAR(20) NOT NULL,
    "solicitadoPorId" INTEGER,
    "justificativa" TEXT,
    "motivoCodigo" VARCHAR(40),
    "forcado" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" VARCHAR(60) NOT NULL,
    "causationId" VARCHAR(200),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseAdvanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainOutbox" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(80) NOT NULL,
    "aggregateType" VARCHAR(40),
    "aggregateId" INTEGER,
    "payload" JSONB NOT NULL,
    "correlationId" VARCHAR(60),
    "causationId" VARCHAR(200),
    "chaveIdempotencia" VARCHAR(200),
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "reservadoEm" TIMESTAMP(3),

    CONSTRAINT "DomainOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacaoAntecipada" (
    "id" SERIAL NOT NULL,
    "publicCode" VARCHAR(20),
    "processoId" INTEGER NOT NULL,
    "workflowInstanceId" INTEGER,
    "originPhaseCode" VARCHAR(60),
    "originStepKey" VARCHAR(80),
    "necessidadeId" INTEGER,
    "targetPhaseCode" VARCHAR(60),
    "targetWorkflowDefinitionId" VARCHAR(80),
    "targetOperationType" VARCHAR(40) NOT NULL,
    "targetTipoDocumentoId" INTEGER,
    "params" JSONB,
    "targetOperationId" INTEGER,
    "objetivo" TEXT,
    "resultadoEsperado" TEXT,
    "resultadoObtido" TEXT,
    "resultadoDados" JSONB,
    "status" "StatusOperacaoAntecipada" NOT NULL DEFAULT 'CRIADA',
    "responsavelId" INTEGER,
    "createdBy" INTEGER,
    "avaliadoPor" INTEGER,
    "avaliadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "OperacaoAntecipada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObrigacaoEconomica" (
    "id" SERIAL NOT NULL,
    "codigoOperacional" VARCHAR(40),
    "natureza" VARCHAR(30) NOT NULL,
    "direcao" VARCHAR(12) NOT NULL,
    "processoId" INTEGER,
    "faseId" INTEGER,
    "clienteId" INTEGER,
    "regraFinanceiraId" INTEGER,
    "moedaContratual" "Moeda" NOT NULL DEFAULT 'BRL',
    "moedaContabil" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorContratado" DECIMAL(14,2) NOT NULL,
    "politicaCambialId" INTEGER,
    "politicaDivisao" VARCHAR(20),
    "fornecedorId" INTEGER,
    "itemCatalogoId" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    "estadoCusto" VARCHAR(24),
    "arquivadaEm" TIMESTAMP(3),
    "vencimento" TIMESTAMP(3),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" INTEGER,
    "origemTipo" VARCHAR(20),
    "origemId" INTEGER,
    "observacoes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "personId" INTEGER,
    "documentoId" INTEGER,
    "tipoServicoId" INTEGER,
    "phaseKey" VARCHAR(60),
    "phaseCycle" INTEGER,
    "configFinanceiraId" INTEGER,
    "origemLancamento" VARCHAR(28),
    "eventoOrigemTipo" VARCHAR(40),
    "eventoOrigemId" INTEGER,
    "pricingRuleId" INTEGER,
    "valorUnitario" DECIMAL(14,2),
    "quantidade" INTEGER,
    "modoCalculoAplicado" VARCHAR(30),
    "naturezaPreco" VARCHAR(10),
    "contextoAplicado" JSONB,
    "dataReferencia" TIMESTAMP(3),
    "chaveIdempotencia" VARCHAR(200),

    CONSTRAINT "ObrigacaoEconomica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistenteParametrizacaoProgresso" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60),
    "etapaAtual" VARCHAR(40) NOT NULL,
    "etapasConcluidas" JSONB,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPor" INTEGER,

    CONSTRAINT "AssistenteParametrizacaoProgresso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelaPagavel" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "canceladaEm" TIMESTAMP(3),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelaPagavel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepasseCusto" (
    "id" SERIAL NOT NULL,
    "custoObrigacaoId" INTEGER NOT NULL,
    "receitaObrigacaoId" INTEGER,
    "cobrancaId" INTEGER,
    "tipo" VARCHAR(12) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "percentual" DECIMAL(6,3),
    "pagadorPessoaId" INTEGER,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ATIVO',
    "motivo" VARCHAR(300),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepasseCusto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerFinanceiro" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "moedaContabil" "Moeda" NOT NULL DEFAULT 'BRL',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "parcelaId" INTEGER,
    "ocorrenciaId" INTEGER,
    "transacaoId" VARCHAR(60) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "contaContabil" VARCHAR(20) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorContabil" DECIMAL(14,2) NOT NULL,
    "snapshotCambialId" INTEGER,
    "data" TIMESTAMP(3) NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "estornaEntryId" INTEGER,
    "idempotencyKey" VARCHAR(120),
    "correlacaoId" VARCHAR(60),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanoContaFinanceira" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanoContaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerOpeningBalance" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "dataCorte" TIMESTAMP(3) NOT NULL,
    "valorAbertura" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "transacaoId" VARCHAR(60) NOT NULL,
    "origem" VARCHAR(30) NOT NULL DEFAULT 'backfill-corte',
    "revertidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoBancario" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorBruto" DECIMAL(14,2) NOT NULL,
    "valorTarifa" DECIMAL(14,2),
    "valorLiquido" DECIMAL(14,2) NOT NULL,
    "identificadorTransacao" VARCHAR(120),
    "contaRecebimentoId" INTEGER,
    "descricao" VARCHAR(300),
    "status" VARCHAR(16) NOT NULL DEFAULT 'INFORMADO',
    "ocorrenciaId" INTEGER,
    "obrigacaoId" INTEGER,
    "divergencia" VARCHAR(200),
    "origem" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LancamentoBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcorrenciaFinanceira" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "cobrancaId" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "data" TIMESTAMP(3) NOT NULL,
    "formaPagamentoId" INTEGER,
    "origemRecurso" VARCHAR(20),
    "pagadorId" INTEGER,
    "snapshotCambialId" INTEGER,
    "comprovanteUrl" VARCHAR(400),
    "observacao" TEXT,
    "formaLabel" VARCHAR(40),
    "contaBanco" VARCHAR(80),
    "contaAgencia" VARCHAR(20),
    "contaNumero" VARCHAR(30),
    "referencia" VARCHAR(120),
    "politicaAplicacao" VARCHAR(24),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "estornaId" INTEGER,
    "correlacaoId" VARCHAR(60),
    "idempotencyKey" VARCHAR(120),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcorrenciaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacaoFinanceira" (
    "id" SERIAL NOT NULL,
    "ocorrenciaId" INTEGER NOT NULL,
    "parcelaId" INTEGER,
    "cobrancaId" INTEGER,
    "valorAplicado" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacaoFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistribuicaoEconomica" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "modo" VARCHAR(20) NOT NULL DEFAULT 'SEM_DIVISAO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "arredondamento" VARCHAR(20) NOT NULL DEFAULT 'ULTIMO_ABSORVE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistribuicaoEconomica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipacaoEconomica" (
    "id" SERIAL NOT NULL,
    "distribuicaoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "incluido" BOOLEAN NOT NULL DEFAULT true,
    "percentual" DECIMAL(7,4),
    "valor" DECIMAL(14,2),
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ParticipacaoEconomica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagador" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(12) NOT NULL,
    "pessoaId" INTEGER,
    "parteExternaId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pagador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParteExterna" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "documento" VARCHAR(40),
    "tipo" VARCHAR(4),
    "observacao" TEXT,
    "processoId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParteExterna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoliticaCambial" (
    "id" SERIAL NOT NULL,
    "escopo" VARCHAR(12) NOT NULL,
    "tipo" VARCHAR(12) NOT NULL,
    "permiteOverride" BOOLEAN NOT NULL DEFAULT false,
    "fonteDefault" VARCHAR(60),
    "tratamentoDiferenca" VARCHAR(12) NOT NULL DEFAULT 'CONTABIL',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliticaCambial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotCambial" (
    "id" SERIAL NOT NULL,
    "moedaOrigem" VARCHAR(10) NOT NULL,
    "moedaDestino" VARCHAR(10) NOT NULL,
    "taxa" DECIMAL(14,6) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "fonte" VARCHAR(60),
    "tipo" VARCHAR(12) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER,
    "justificativa" VARCHAR(300),
    "precisao" INTEGER NOT NULL DEFAULT 6,
    "valorOriginal" DECIMAL(14,2),
    "valorRecebido" DECIMAL(14,2),
    "diferencaCambial" DECIMAL(14,2),
    "tratamentoDiferenca" VARCHAR(12),
    "motivo" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotCambial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditoFinanceiro" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER,
    "pessoaId" INTEGER,
    "origemOcorrenciaId" INTEGER,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "destino" VARCHAR(24) NOT NULL,
    "pagoEmNomeDeTerceiros" DECIMAL(14,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ABERTO',
    "aprovadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditoFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditoMovimento" (
    "id" SERIAL NOT NULL,
    "creditoId" INTEGER NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "saldoAnterior" DECIMAL(14,2) NOT NULL,
    "saldoPosterior" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "obrigacaoOrigemId" INTEGER,
    "obrigacaoDestinoId" INTEGER,
    "cobrancaDestinoId" INTEGER,
    "ocorrenciaId" INTEGER,
    "pagadorId" INTEGER,
    "pessoaId" INTEGER,
    "processoId" INTEGER,
    "receitaId" INTEGER,
    "usuarioId" INTEGER,
    "correlationId" VARCHAR(80),
    "observacao" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditoMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoProjecao" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "recebidoBruto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recebidoLiquido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vencido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "aVencer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ultimaSequenciaAplicada" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoProjecao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoSnapshot" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "sequenciaAplicada" INTEGER NOT NULL,
    "saldo" DECIMAL(14,2) NOT NULL,
    "recebidoBruto" DECIMAL(14,2) NOT NULL,
    "recebidoLiquido" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaldoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModalidadeLegal" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "paisId" INTEGER NOT NULL,
    "cardinalidadeRequerimento" VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModalidadeLegal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquadramentoLegal" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "modalidadeLegalId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquadramentoLegal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaServico" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaOrganizacao" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaOrganizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaProfissional" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaProfissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizacaoCategoria" (
    "id" SERIAL NOT NULL,
    "orgaoId" INTEGER NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizacaoCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoUsuario" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40),
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrupoUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoUsuarioMembro" (
    "id" SERIAL NOT NULL,
    "grupoId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrupoUsuarioMembro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CargoCadastro" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "area" VARCHAR(80),
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargoCadastro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoSistema" (
    "chave" VARCHAR(80) NOT NULL,
    "valor" TEXT,
    "grupo" VARCHAR(40) NOT NULL DEFAULT 'geral',
    "atualizadoPor" INTEGER,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoSistema_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "ModeloDocumento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(40),
    "categoria" VARCHAR(80),
    "conteudo" TEXT,
    "variaveis" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegraNotificacao" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "gatilho" VARCHAR(80) NOT NULL,
    "entidade" VARCHAR(60),
    "canais" VARCHAR(120),
    "destinatarios" VARCHAR(200),
    "modeloCode" VARCHAR(60),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegraNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomePessoa" (
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "sobrenome" VARCHAR(40),
    "tipo" VARCHAR(20) NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "chaveFonetica" VARCHAR(60),
    "origem" VARCHAR(16) NOT NULL,
    "confianca" VARCHAR(12) NOT NULL,
    "responsavelId" INTEGER,
    "afirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificativa" VARCHAR(300),
    "evidenciaNecessidadeId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "supersedidoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomePessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoDeduplicacao" (
    "id" SERIAL NOT NULL,
    "chaveDedup" VARCHAR(200) NOT NULL,
    "candidatosAvaliados" JSONB NOT NULL,
    "nivelTriagem" VARCHAR(14) NOT NULL,
    "decisao" VARCHAR(20) NOT NULL,
    "pessoaResultanteId" INTEGER,
    "justificativa" VARCHAR(500),
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "DecisaoDeduplicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteRegistral" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "status" "StatusLoteRegistral" NOT NULL DEFAULT 'RECEBIDO',
    "correlationId" VARCHAR(60) NOT NULL,
    "versaoMotor" VARCHAR(20) NOT NULL,
    "totalDocumentos" INTEGER NOT NULL DEFAULT 0,
    "processados" INTEGER NOT NULL DEFAULT 0,
    "falhos" INTEGER NOT NULL DEFAULT 0,
    "aguardando" INTEGER NOT NULL DEFAULT 0,
    "pessoasCriadas" INTEGER NOT NULL DEFAULT 0,
    "vinculosCriados" INTEGER NOT NULL DEFAULT 0,
    "evidenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "propostasCriadas" INTEGER NOT NULL DEFAULT 0,
    "conflitosAbertos" INTEGER NOT NULL DEFAULT 0,
    "metricas" JSONB,
    "resumo" TEXT,
    "criadoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" TIMESTAMP(3),
    "finalizadoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoteRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecucaoRegistral" (
    "id" SERIAL NOT NULL,
    "loteId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "necessidadeId" INTEGER,
    "etapa" "EtapaRegistral" NOT NULL DEFAULT 'RECEBIDO',
    "tipoDetectado" VARCHAR(60),
    "confiancaTipo" DOUBLE PRECISION,
    "versaoExtrator" VARCHAR(20) NOT NULL,
    "fonteTexto" VARCHAR(30),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaEm" TIMESTAMP(3),
    "reservadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "ocorrenciasDetectadas" INTEGER NOT NULL DEFAULT 0,
    "camposExtraidos" INTEGER NOT NULL DEFAULT 0,
    "camposDivergentes" INTEGER NOT NULL DEFAULT 0,
    "evidenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "correlationId" VARCHAR(60) NOT NULL,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "ExecucaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtapaExecucaoRegistral" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER NOT NULL,
    "etapa" "EtapaRegistral" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "mensagem" VARCHAR(500),
    "duracaoMs" INTEGER,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtapaExecucaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcorrenciaDocumental" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "papel" "PapelOcorrencia" NOT NULL,
    "nomeBruto" VARCHAR(300) NOT NULL,
    "nomeNormalizado" VARCHAR(300) NOT NULL,
    "chaveFonetica" VARCHAR(80),
    "sexoInferido" VARCHAR(10),
    "atributos" JSONB,
    "pessoaResolvidaId" INTEGER,
    "classe" "ClasseCorrespondencia",
    "scoreIdentidade" DOUBLE PRECISION,
    "resolvidaAutomaticamente" BOOLEAN NOT NULL DEFAULT false,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcorrenciaDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatoRegistral" (
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "campo" "CampoRegistral" NOT NULL,
    "valorBruto" VARCHAR(400),
    "valorNormalizado" VARCHAR(400),
    "valorData" TIMESTAMP(3),
    "valorPessoaId" INTEGER,
    "estado" "EstadoFatoRegistral" NOT NULL DEFAULT 'NAO_INFORMADO',
    "confianca" VARCHAR(12) NOT NULL,
    "origem" VARCHAR(16) NOT NULL,
    "responsavelId" INTEGER,
    "afirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificativa" VARCHAR(500),
    "regraAplicada" VARCHAR(80),
    "totalEvidencias" INTEGER NOT NULL DEFAULT 0,
    "evidenciasFavoraveis" INTEGER NOT NULL DEFAULT 0,
    "evidenciasContrarias" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "supersedidoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FatoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenciaRegistral" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER,
    "documentoId" INTEGER NOT NULL,
    "itemCatalogoId" INTEGER,
    "necessidadeId" INTEGER,
    "ocorrenciaId" INTEGER,
    "fatoId" INTEGER,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "campo" "CampoRegistral" NOT NULL,
    "pagina" INTEGER,
    "regiao" VARCHAR(60),
    "trechoTexto" VARCHAR(600),
    "valorBruto" VARCHAR(400),
    "valorNormalizado" VARCHAR(400),
    "metodoExtracao" VARCHAR(40) NOT NULL,
    "versaoProcessamento" VARCHAR(20) NOT NULL,
    "confiancaExtracao" DOUBLE PRECISION NOT NULL,
    "confiancaAssociacao" DOUBLE PRECISION NOT NULL,
    "regraAplicada" VARCHAR(80),
    "favoravel" BOOLEAN NOT NULL DEFAULT true,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrespondenciaIdentidade" (
    "id" SERIAL NOT NULL,
    "ocorrenciaId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "classe" "ClasseCorrespondencia" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "evidencias" JSONB NOT NULL,
    "decisao" VARCHAR(12),
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "decisaoDedupId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrespondenciaIdentidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropostaReconciliacao" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "loteId" INTEGER,
    "execucaoId" INTEGER,
    "tipo" "TipoPropostaRegistral" NOT NULL,
    "criticidade" "CriticidadeRegistral" NOT NULL,
    "status" "StatusPropostaRegistral" NOT NULL DEFAULT 'PENDENTE',
    "entidadeAlvo" VARCHAR(20) NOT NULL,
    "alvoId" INTEGER,
    "campo" "CampoRegistral",
    "fatoId" INTEGER,
    "valorAtual" VARCHAR(400),
    "valorProposto" VARCHAR(400),
    "origemValorAtual" VARCHAR(120),
    "origemValorProposto" VARCHAR(120),
    "evidenciasFavoraveis" JSONB NOT NULL,
    "evidenciasContrarias" JSONB NOT NULL,
    "confianca" DOUBLE PRECISION NOT NULL,
    "justificativa" TEXT NOT NULL,
    "regraAplicada" VARCHAR(80) NOT NULL,
    "recomendacao" VARCHAR(300),
    "risco" "SeveridadeRegistral" NOT NULL DEFAULT 'BAIXO',
    "operacao" JSONB NOT NULL,
    "pessoasAfetadas" JSONB,
    "vinculosAfetados" JSONB,
    "documentosAfetados" JSONB,
    "processosAfetados" JSONB,
    "necessidadesAfetadas" JSONB,
    "aplicavelAutomaticamente" BOOLEAN NOT NULL DEFAULT false,
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "decisaoNota" VARCHAR(500),
    "aplicadoEm" TIMESTAMP(3),
    "revertidoEm" TIMESTAMP(3),
    "revertidaPorId" INTEGER,
    "motivoAbortoRevalidacao" TEXT,
    "versaoArvoreAntes" INTEGER,
    "versaoArvoreDepois" INTEGER,
    "correlationId" VARCHAR(60) NOT NULL,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropostaReconciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflitoRegistral" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "loteId" INTEGER,
    "execucaoId" INTEGER,
    "codigo" VARCHAR(60) NOT NULL,
    "severidade" "SeveridadeRegistral" NOT NULL,
    "status" "StatusConflitoRegistral" NOT NULL DEFAULT 'ABERTO',
    "campo" "CampoRegistral",
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "descricao" VARCHAR(300) NOT NULL,
    "explicacao" TEXT NOT NULL,
    "acaoSugerida" VARCHAR(300),
    "evidencias" JSONB NOT NULL,
    "documentoIds" JSONB,
    "propostaId" INTEGER,
    "resolvidoPorId" INTEGER,
    "resolvidoEm" TIMESTAMP(3),
    "resolucaoNota" VARCHAR(500),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflitoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactoAplicacaoRegistral" (
    "id" SERIAL NOT NULL,
    "propostaId" INTEGER NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "momento" VARCHAR(10) NOT NULL,
    "pessoasAfetadas" INTEGER NOT NULL DEFAULT 0,
    "arvoresAfetadas" INTEGER NOT NULL DEFAULT 0,
    "requerentesAfetados" INTEGER NOT NULL DEFAULT 0,
    "processosAfetados" INTEGER NOT NULL DEFAULT 0,
    "vinculosAlterados" INTEGER NOT NULL DEFAULT 0,
    "documentosRelacionados" INTEGER NOT NULL DEFAULT 0,
    "necessidadesRecalculadas" INTEGER NOT NULL DEFAULT 0,
    "inconsistenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "inconsistenciasResolvidas" INTEGER NOT NULL DEFAULT 0,
    "linhaAntes" JSONB,
    "linhaDepois" JSONB,
    "elegibilidadeAntes" "ResultadoLinhagemRegistral",
    "elegibilidadeDepois" "ResultadoLinhagemRegistral",
    "riscoDuplicidade" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "riscoDocumental" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "riscoOperacional" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "motivoBloqueio" TEXT,
    "detalhes" JSONB,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "ImpactoAplicacaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoRevisaoRegistral" (
    "id" SERIAL NOT NULL,
    "propostaId" INTEGER,
    "conflitoId" INTEGER,
    "decisao" VARCHAR(24) NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "permissao" VARCHAR(60) NOT NULL,
    "responsavelId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisaoRevisaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersaoGenealogica" (
    "id" SERIAL NOT NULL,
    "arvoreId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "propostaId" INTEGER,
    "correlationId" VARCHAR(60),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersaoGenealogica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricaRegistral" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(60) NOT NULL,
    "escopo" VARCHAR(40) NOT NULL,
    "janelaInicio" TIMESTAMP(3) NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amostras" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricaRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaudeExecucao" (
    "id" SERIAL NOT NULL,
    "modo" VARCHAR(20) NOT NULL,
    "estado" VARCHAR(30) NOT NULL,
    "motivoEstado" TEXT NOT NULL,
    "versaoCatalogo" VARCHAR(20) NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL,
    "concluidoEm" TIMESTAMP(3) NOT NULL,
    "duracaoMs" INTEGER NOT NULL,
    "totalCatalogo" INTEGER NOT NULL,
    "totalElegiveis" INTEGER NOT NULL,
    "executadas" INTEGER NOT NULL,
    "aprovadas" INTEGER NOT NULL,
    "comAchados" INTEGER NOT NULL,
    "falhasTecnicas" INTEGER NOT NULL,
    "naoExecutadas" INTEGER NOT NULL,
    "coberturaPercentual" INTEGER NOT NULL,
    "criticos" INTEGER NOT NULL,
    "erros" INTEGER NOT NULL,
    "alertas" INTEGER NOT NULL,
    "informativos" INTEGER NOT NULL,
    "execucoes" JSONB NOT NULL,
    "dominiosSemCobertura" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "disparadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaudeExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaudeAchado" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(300) NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "dominio" VARCHAR(40) NOT NULL,
    "modulo" VARCHAR(60) NOT NULL,
    "severidade" VARCHAR(20) NOT NULL,
    "titulo" VARCHAR(300) NOT NULL,
    "descricao" TEXT NOT NULL,
    "explicacao" TEXT,
    "impacto" TEXT,
    "entidade" VARCHAR(80),
    "registroId" VARCHAR(60),
    "registroNome" VARCHAR(300),
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "link" VARCHAR(300),
    "recomendacao" TEXT,
    "correcaoAutomatica" VARCHAR(60),
    "evidencia" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "primeiraDeteccao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaDeteccao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvidoEm" TIMESTAMP(3),
    "recorrencias" INTEGER NOT NULL DEFAULT 1,
    "responsavelId" INTEGER,
    "justificativa" TEXT,
    "ignoradoPorId" INTEGER,
    "ignoradoAte" TIMESTAMP(3),
    "versaoCatalogo" VARCHAR(20) NOT NULL,
    "execucaoId" INTEGER,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaudeAchado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitacaoDocumento" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "processoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "workflowInstanceId" INTEGER,
    "stepInstanceId" INTEGER,
    "tarefaId" INTEGER,
    "canal" "CanalSolicitacaoDocumento" NOT NULL,
    "orgaoId" INTEGER,
    "destinatarioNome" VARCHAR(200),
    "atendente" VARCHAR(200),
    "dataEnvio" TIMESTAMP(3) NOT NULL,
    "prazoEsperadoDias" INTEGER,
    "previsaoRetorno" TIMESTAMP(3),
    "observacao" TEXT,
    "custoPago" DECIMAL(12,2),
    "formaPagamento" VARCHAR(40),
    "linkAcompanhamento" VARCHAR(500),
    "codigoRastreio" VARCHAR(100),
    "status" "StatusSolicitacaoDocumento" NOT NULL DEFAULT 'AGUARDANDO_PROTOCOLO',
    "criadoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitacaoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoArquivo" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "solicitacaoId" INTEGER,
    "stepInstanceId" INTEGER,
    "protocoloId" INTEGER,
    "documentTypeId" INTEGER,
    "tipo" "TipoArquivoDocumento" NOT NULL DEFAULT 'OUTRO',
    "url" TEXT NOT NULL,
    "nome" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(120),
    "tamanho" INTEGER,
    "hashConteudo" VARCHAR(80),
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "substituiId" INTEGER,
    "substituidoEm" TIMESTAMP(3),
    "motivoSubstituicao" VARCHAR(300),
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExigenciaEvidenciaEtapa" (
    "id" SERIAL NOT NULL,
    "stepKey" VARCHAR(80) NOT NULL,
    "documentoTipoId" INTEGER,
    "canal" "CanalSolicitacaoDocumento",
    "evidenciaTipoId" INTEGER NOT NULL,
    "finalidade" "TipoArquivoDocumento" NOT NULL DEFAULT 'REQUERIMENTO_ENVIADO',
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "cardinalidadeMax" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "chaveExigencia" VARCHAR(140) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExigenciaEvidenciaEtapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoObservacao" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "solicitacaoId" INTEGER,
    "stepInstanceId" INTEGER,
    "texto" TEXT NOT NULL,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "DocumentoObservacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloDocumental" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "categoria" "ModeloDocumentalCategoria" NOT NULL,
    "documentTypeId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloDocumentalVersao" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "arquivoChave" VARCHAR(400) NOT NULL,
    "arquivoNome" VARCHAR(300) NOT NULL,
    "arquivoMime" VARCHAR(120),
    "arquivoTamanho" INTEGER,
    "checksum" VARCHAR(80) NOT NULL,
    "status" "ModeloDocumentalVersaoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "placeholders" JSONB NOT NULL,
    "obrigatorios" JSONB NOT NULL,
    "opcionais" JSONB NOT NULL,
    "dadosFixosDeclarados" JSONB,
    "observacao" TEXT,
    "criadoPorId" INTEGER,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPorId" INTEGER,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" INTEGER,
    "vigenteDe" TIMESTAMP(3),
    "vigenteAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDocumentalVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoGerado" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "documentTypeId" INTEGER NOT NULL,
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,
    "pessoaId" INTEGER,
    "processoId" INTEGER,
    "servicoId" INTEGER,
    "documentoId" INTEGER,
    "status" "DocumentoGeradoStatus" NOT NULL DEFAULT 'VIGENTE',
    "chaveIdentidade" VARCHAR(200) NOT NULL,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoGerado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoGeradoVersao" (
    "id" SERIAL NOT NULL,
    "documentoGeradoId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "modeloVersaoId" INTEGER NOT NULL,
    "docxChave" VARCHAR(400) NOT NULL,
    "docxNome" VARCHAR(300) NOT NULL,
    "docxChecksum" VARCHAR(80) NOT NULL,
    "docxTamanho" INTEGER,
    "pdfChave" VARCHAR(400) NOT NULL,
    "pdfNome" VARCHAR(300) NOT NULL,
    "pdfChecksum" VARCHAR(80) NOT NULL,
    "pdfTamanho" INTEGER,
    "dadosSnapshot" JSONB NOT NULL,
    "status" "DocumentoGeradoVersaoStatus" NOT NULL DEFAULT 'GERADA',
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geradoPorId" INTEGER,
    "substituidaEm" TIMESTAMP(3),
    "substituidaPorId" INTEGER,
    "invalidadaEm" TIMESTAMP(3),
    "invalidadaPorId" INTEGER,
    "motivoInvalidacao" VARCHAR(300),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "DocumentoGeradoVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanilhaDocumentalColuna" (
    "id" SERIAL NOT NULL,
    "origem" VARCHAR(20) NOT NULL,
    "estrategia" VARCHAR(24) NOT NULL DEFAULT 'SERVICO_FIXO',
    "categoriaItemId" INTEGER,
    "configId" INTEGER,
    "tipoDocumentoId" INTEGER,
    "posicao" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "rotuloOverride" VARCHAR(60),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanilhaDocumentalColuna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanilhaCelulaOverride" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "tipoDocumentoId" INTEGER NOT NULL,
    "colunaId" INTEGER NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "autorId" INTEGER,
    "motivo" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanilhaCelulaOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacaoOperacional" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(24) NOT NULL,
    "destinatarioId" INTEGER NOT NULL,
    "tarefaId" INTEGER NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "mensagem" TEXT,
    "link" VARCHAR(300),
    "autorId" INTEGER,
    "chaveIdempotencia" VARCHAR(220) NOT NULL,
    "lidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacaoOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarefaDependencia" (
    "id" SERIAL NOT NULL,
    "tarefaId" INTEGER NOT NULL,
    "dependeDeId" INTEGER NOT NULL,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "motivo" VARCHAR(200),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TarefaDependencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AptidaoOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "perfilOperacionalId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AptidaoOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndisponibilidadeOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" "TipoIndisponibilidade" NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "motivo" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" INTEGER,

    CONSTRAINT "IndisponibilidadeOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacidadeOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "limiteExecutaveis" INTEGER,
    "observacao" VARCHAR(300),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorId" INTEGER,

    CONSTRAINT "CapacidadeOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ReciboPagamento" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ReciboPagamento_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ServicoProdutoItens" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ServicoProdutoItens_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_publicCode_key" ON "Usuario"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_perfilId_idx" ON "Usuario"("perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "Pessoa_publicCode_key" ON "Pessoa"("publicCode");

-- CreateIndex
CREATE INDEX "Pessoa_arvoreId_idx" ON "Pessoa"("arvoreId");

-- CreateIndex
CREATE INDEX "Pessoa_removidaEm_idx" ON "Pessoa"("removidaEm");

-- CreateIndex
CREATE INDEX "Pessoa_pais_nasc_idx" ON "Pessoa"("pais_nasc");

-- CreateIndex
CREATE INDEX "Pessoa_maeId_idx" ON "Pessoa"("maeId");

-- CreateIndex
CREATE INDEX "Pessoa_paiId_idx" ON "Pessoa"("paiId");

-- CreateIndex
CREATE INDEX "Uniao_pessoa1Id_idx" ON "Uniao"("pessoa1Id");

-- CreateIndex
CREATE INDEX "Uniao_pessoa2Id_idx" ON "Uniao"("pessoa2Id");

-- CreateIndex
CREATE UNIQUE INDEX "Arvore_pessoaPrincipalId_key" ON "Arvore"("pessoaPrincipalId");

-- CreateIndex
CREATE INDEX "Arvore_familiaId_idx" ON "Arvore"("familiaId");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_publicCode_key" ON "Documento"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_chaveDerivacao_key" ON "Documento"("chaveDerivacao");

-- CreateIndex
CREATE INDEX "Documento_documentTypeId_idx" ON "Documento"("documentTypeId");

-- CreateIndex
CREATE INDEX "Documento_necessidadeId_idx" ON "Documento"("necessidadeId");

-- CreateIndex
CREATE INDEX "Documento_derivadoDeId_idx" ON "Documento"("derivadoDeId");

-- CreateIndex
CREATE INDEX "Documento_pessoaId_idx" ON "Documento"("pessoaId");

-- CreateIndex
CREATE INDEX "Documento_tipo_idx" ON "Documento"("tipo");

-- CreateIndex
CREATE INDEX "Documento_status_idx" ON "Documento"("status");

-- CreateIndex
CREATE INDEX "Documento_responsavelId_idx" ON "Documento"("responsavelId");

-- CreateIndex
CREATE INDEX "Documento_dataPrazoOperacao_idx" ON "Documento"("dataPrazoOperacao");

-- CreateIndex
CREATE INDEX "Documento_ultimaMovimentacao_idx" ON "Documento"("ultimaMovimentacao");

-- CreateIndex
CREATE INDEX "Documento_origem_idx" ON "Documento"("origem");

-- CreateIndex
CREATE INDEX "Documento_ruleCode_idx" ON "Documento"("ruleCode");

-- CreateIndex
CREATE INDEX "Status_pais_idx" ON "Status"("pais");

-- CreateIndex
CREATE UNIQUE INDEX "Status_nome_pais_key" ON "Status"("nome", "pais");

-- CreateIndex
CREATE UNIQUE INDEX "CodeSequence_scope_key" ON "CodeSequence"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "Processo_codigo_key" ON "Processo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Processo_chaveIdempotenciaCriacao_key" ON "Processo"("chaveIdempotenciaCriacao");

-- CreateIndex
CREATE INDEX "Processo_pais_idx" ON "Processo"("pais");

-- CreateIndex
CREATE INDEX "Processo_arvoreId_idx" ON "Processo"("arvoreId");

-- CreateIndex
CREATE INDEX "Processo_familiaId_idx" ON "Processo"("familiaId");

-- CreateIndex
CREATE INDEX "Processo_tipoProcessoMotorId_idx" ON "Processo"("tipoProcessoMotorId");

-- CreateIndex
CREATE INDEX "Processo_enquadramentoLegalId_idx" ON "Processo"("enquadramentoLegalId");

-- CreateIndex
CREATE UNIQUE INDEX "Tarefa_publicCode_key" ON "Tarefa"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Tarefa_chaveIdempotencia_key" ON "Tarefa"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "Tarefa_tipo_idx" ON "Tarefa"("tipo");

-- CreateIndex
CREATE INDEX "Tarefa_pessoaId_idx" ON "Tarefa"("pessoaId");

-- CreateIndex
CREATE INDEX "Tarefa_processoId_idx" ON "Tarefa"("processoId");

-- CreateIndex
CREATE INDEX "Tarefa_responsavelId_idx" ON "Tarefa"("responsavelId");

-- CreateIndex
CREATE INDEX "Tarefa_concluida_idx" ON "Tarefa"("concluida");

-- CreateIndex
CREATE INDEX "Tarefa_statusTarefa_idx" ON "Tarefa"("statusTarefa");

-- CreateIndex
CREATE INDEX "Tarefa_statusId_idx" ON "Tarefa"("statusId");

-- CreateIndex
CREATE INDEX "Tarefa_pais_idx" ON "Tarefa"("pais");

-- CreateIndex
CREATE INDEX "Tarefa_dataPrazo_idx" ON "Tarefa"("dataPrazo");

-- CreateIndex
CREATE INDEX "Tarefa_workflowStepInstanceId_idx" ON "Tarefa"("workflowStepInstanceId");

-- CreateIndex
CREATE INDEX "Tarefa_workflowInstanceId_idx" ON "Tarefa"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "Tarefa_necessidadeId_idx" ON "Tarefa"("necessidadeId");

-- CreateIndex
CREATE INDEX "TarefaHistorico_tarefaId_idx" ON "TarefaHistorico"("tarefaId");

-- CreateIndex
CREATE INDEX "TarefaHistorico_usuarioId_idx" ON "TarefaHistorico"("usuarioId");

-- CreateIndex
CREATE INDEX "TarefaHistorico_createdAt_idx" ON "TarefaHistorico"("createdAt");

-- CreateIndex
CREATE INDEX "ProcessoRequerente_removidoEm_idx" ON "ProcessoRequerente"("removidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Contratante_publicCode_key" ON "Contratante"("publicCode");

-- CreateIndex
CREATE INDEX "Contratante_personId_idx" ON "Contratante"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Requerente_publicCode_key" ON "Requerente"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Requerente_personId_key" ON "Requerente"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Protocolo_publicCode_key" ON "Protocolo"("publicCode");

-- CreateIndex
CREATE INDEX "Protocolo_processoId_idx" ON "Protocolo"("processoId");

-- CreateIndex
CREATE INDEX "Protocolo_contratanteId_idx" ON "Protocolo"("contratanteId");

-- CreateIndex
CREATE INDEX "Protocolo_requerenteId_idx" ON "Protocolo"("requerenteId");

-- CreateIndex
CREATE INDEX "Protocolo_orgaoId_idx" ON "Protocolo"("orgaoId");

-- CreateIndex
CREATE INDEX "Protocolo_responsavelId_idx" ON "Protocolo"("responsavelId");

-- CreateIndex
CREATE INDEX "Protocolo_solicitacaoId_idx" ON "Protocolo"("solicitacaoId");

-- CreateIndex
CREATE INDEX "Protocolo_orgaoId_dataProtocolo_idx" ON "Protocolo"("orgaoId", "dataProtocolo");

-- CreateIndex
CREATE INDEX "Protocolo_finalidade_situacao_idx" ON "Protocolo"("finalidade", "situacao");

-- CreateIndex
CREATE INDEX "ProtocoloRequerente_requerenteId_idx" ON "ProtocoloRequerente"("requerenteId");

-- CreateIndex
CREATE INDEX "ProtocoloExigencia_protocoloId_idx" ON "ProtocoloExigencia"("protocoloId");

-- CreateIndex
CREATE INDEX "ProtocoloExigencia_prazo_idx" ON "ProtocoloExigencia"("prazo");

-- CreateIndex
CREATE INDEX "ProtocoloExigencia_cumpridaEm_idx" ON "ProtocoloExigencia"("cumpridaEm");

-- CreateIndex
CREATE INDEX "ProtocoloDocumento_documentoId_idx" ON "ProtocoloDocumento"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocoloDocumento_protocoloId_documentoId_key" ON "ProtocoloDocumento"("protocoloId", "documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "InformacaoItalia_processoId_key" ON "InformacaoItalia"("processoId");

-- CreateIndex
CREATE INDEX "InformacaoItalia_processoId_idx" ON "InformacaoItalia"("processoId");

-- CreateIndex
CREATE INDEX "AnexoInformacaoItalia_informacaoItaliaId_idx" ON "AnexoInformacaoItalia"("informacaoItaliaId");

-- CreateIndex
CREATE INDEX "AnexoProcesso_processoId_idx" ON "AnexoProcesso"("processoId");

-- CreateIndex
CREATE INDEX "AnexoContratante_contratanteId_idx" ON "AnexoContratante"("contratanteId");

-- CreateIndex
CREATE INDEX "AnexoRequerente_requerenteId_idx" ON "AnexoRequerente"("requerenteId");

-- CreateIndex
CREATE INDEX "AnexoProtocolo_protocoloId_idx" ON "AnexoProtocolo"("protocoloId");

-- CreateIndex
CREATE INDEX "LogAuditoria_entidade_idx" ON "LogAuditoria"("entidade");

-- CreateIndex
CREATE INDEX "LogAuditoria_usuarioId_idx" ON "LogAuditoria"("usuarioId");

-- CreateIndex
CREATE INDEX "LogAuditoria_criadoEm_idx" ON "LogAuditoria"("criadoEm");

-- CreateIndex
CREATE INDEX "Fatura_processoId_idx" ON "Fatura"("processoId");

-- CreateIndex
CREATE INDEX "Fatura_receitaId_idx" ON "Fatura"("receitaId");

-- CreateIndex
CREATE INDEX "Fatura_status_idx" ON "Fatura"("status");

-- CreateIndex
CREATE INDEX "Fatura_dataVencimento_idx" ON "Fatura"("dataVencimento");

-- CreateIndex
CREATE INDEX "PagamentoFatura_faturaId_idx" ON "PagamentoFatura"("faturaId");

-- CreateIndex
CREATE INDEX "PagamentoDestinatario_pagamentoId_idx" ON "PagamentoDestinatario"("pagamentoId");

-- CreateIndex
CREATE INDEX "PagamentoDestinatario_requerenteId_idx" ON "PagamentoDestinatario"("requerenteId");

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoDestinatario_pagamentoId_requerenteId_key" ON "PagamentoDestinatario"("pagamentoId", "requerenteId");

-- CreateIndex
CREATE INDEX "TipoServico_processoId_idx" ON "TipoServico"("processoId");

-- CreateIndex
CREATE INDEX "TipoServico_itemCatalogoId_idx" ON "TipoServico"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "CustoPessoa_processoId_idx" ON "CustoPessoa"("processoId");

-- CreateIndex
CREATE INDEX "CustoPessoa_pessoaId_idx" ON "CustoPessoa"("pessoaId");

-- CreateIndex
CREATE INDEX "CustoPessoa_tipoServicoId_idx" ON "CustoPessoa"("tipoServicoId");

-- CreateIndex
CREATE UNIQUE INDEX "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key" ON "CustoPessoa"("processoId", "pessoaId", "tipoServicoId", "tipoRegistro");

-- CreateIndex
CREATE INDEX "ContaBancaria_ativo_idx" ON "ContaBancaria"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_publicCode_key" ON "Fornecedor"("publicCode");

-- CreateIndex
CREATE INDEX "Fornecedor_nome_idx" ON "Fornecedor"("nome");

-- CreateIndex
CREATE INDEX "Fornecedor_cpfCnpj_idx" ON "Fornecedor"("cpfCnpj");

-- CreateIndex
CREATE INDEX "Fornecedor_ativo_idx" ON "Fornecedor"("ativo");

-- CreateIndex
CREATE INDEX "ContaPagar_fornecedorId_idx" ON "ContaPagar"("fornecedorId");

-- CreateIndex
CREATE INDEX "ContaPagar_status_idx" ON "ContaPagar"("status");

-- CreateIndex
CREATE INDEX "ContaPagar_dataVencimento_idx" ON "ContaPagar"("dataVencimento");

-- CreateIndex
CREATE INDEX "ContaPagar_processoId_idx" ON "ContaPagar"("processoId");

-- CreateIndex
CREATE INDEX "ContaPagar_contaBancariaId_idx" ON "ContaPagar"("contaBancariaId");

-- CreateIndex
CREATE INDEX "ContaPagar_origem_idx" ON "ContaPagar"("origem");

-- CreateIndex
CREATE INDEX "Transacao_tipo_idx" ON "Transacao"("tipo");

-- CreateIndex
CREATE INDEX "Transacao_contaBancariaId_idx" ON "Transacao"("contaBancariaId");

-- CreateIndex
CREATE INDEX "Transacao_data_idx" ON "Transacao"("data");

-- CreateIndex
CREATE INDEX "Transacao_faturaId_idx" ON "Transacao"("faturaId");

-- CreateIndex
CREATE INDEX "Transacao_contaPagarId_idx" ON "Transacao"("contaPagarId");

-- CreateIndex
CREATE INDEX "Transacao_processoId_idx" ON "Transacao"("processoId");

-- CreateIndex
CREATE UNIQUE INDEX "Evento_publicCode_key" ON "Evento"("publicCode");

-- CreateIndex
CREATE INDEX "Evento_processoId_idx" ON "Evento"("processoId");

-- CreateIndex
CREATE INDEX "Evento_dataInicio_idx" ON "Evento"("dataInicio");

-- CreateIndex
CREATE INDEX "Evento_tipo_idx" ON "Evento"("tipo");

-- CreateIndex
CREATE INDEX "Evento_responsavelId_idx" ON "Evento"("responsavelId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_idx" ON "BlogPost"("status");

-- CreateIndex
CREATE INDEX "BlogPost_dataPublicacao_idx" ON "BlogPost"("dataPublicacao");

-- CreateIndex
CREATE INDEX "BlogPost_categoria_idx" ON "BlogPost"("categoria");

-- CreateIndex
CREATE INDEX "BlogPost_destaque_idx" ON "BlogPost"("destaque");

-- CreateIndex
CREATE INDEX "FaturaDestinatario_faturaId_idx" ON "FaturaDestinatario"("faturaId");

-- CreateIndex
CREATE INDEX "FaturaDestinatario_requerenteId_idx" ON "FaturaDestinatario"("requerenteId");

-- CreateIndex
CREATE UNIQUE INDEX "FaturaDestinatario_faturaId_requerenteId_key" ON "FaturaDestinatario"("faturaId", "requerenteId");

-- CreateIndex
CREATE INDEX "Parcela_faturaId_idx" ON "Parcela"("faturaId");

-- CreateIndex
CREATE INDEX "Parcela_dataVencimento_idx" ON "Parcela"("dataVencimento");

-- CreateIndex
CREATE INDEX "Parcela_pago_idx" ON "Parcela"("pago");

-- CreateIndex
CREATE UNIQUE INDEX "Parcela_faturaId_numero_key" ON "Parcela"("faturaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ClienteAuth_email_key" ON "ClienteAuth"("email");

-- CreateIndex
CREATE INDEX "ClienteAuth_contratanteId_idx" ON "ClienteAuth"("contratanteId");

-- CreateIndex
CREATE INDEX "ClienteAuth_requerenteId_idx" ON "ClienteAuth"("requerenteId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoPush_expoPushToken_key" ON "DispositivoPush"("expoPushToken");

-- CreateIndex
CREATE INDEX "DispositivoPush_clienteAuthId_idx" ON "DispositivoPush"("clienteAuthId");

-- CreateIndex
CREATE INDEX "Mensagem_processoId_idx" ON "Mensagem"("processoId");

-- CreateIndex
CREATE INDEX "Mensagem_clienteAuthId_idx" ON "Mensagem"("clienteAuthId");

-- CreateIndex
CREATE INDEX "Mensagem_usuarioId_idx" ON "Mensagem"("usuarioId");

-- CreateIndex
CREATE INDEX "Mensagem_createdAt_idx" ON "Mensagem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Perfil_nome_key" ON "Perfil"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Recibo_numero_key" ON "Recibo"("numero");

-- CreateIndex
CREATE INDEX "Recibo_processoId_idx" ON "Recibo"("processoId");

-- CreateIndex
CREATE INDEX "Recibo_numero_idx" ON "Recibo"("numero");

-- CreateIndex
CREATE INDEX "Recibo_pagadorRequerenteId_idx" ON "Recibo"("pagadorRequerenteId");

-- CreateIndex
CREATE INDEX "Recibo_pagadorContratanteId_idx" ON "Recibo"("pagadorContratanteId");

-- CreateIndex
CREATE INDEX "Recibo_emitidoPorId_idx" ON "Recibo"("emitidoPorId");

-- CreateIndex
CREATE INDEX "OutroCusto_processoId_idx" ON "OutroCusto"("processoId");

-- CreateIndex
CREATE INDEX "OutroCusto_natureza_idx" ON "OutroCusto"("natureza");

-- CreateIndex
CREATE INDEX "OutroCusto_vencimento_idx" ON "OutroCusto"("vencimento");

-- CreateIndex
CREATE INDEX "PagamentoOutroCusto_outroCustoId_idx" ON "PagamentoOutroCusto"("outroCustoId");

-- CreateIndex
CREATE UNIQUE INDEX "Receita_codigo_key" ON "Receita"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Receita_chaveCancelamento_key" ON "Receita"("chaveCancelamento");

-- CreateIndex
CREATE UNIQUE INDEX "Receita_estornoDeId_key" ON "Receita"("estornoDeId");

-- CreateIndex
CREATE UNIQUE INDEX "Receita_chaveEstorno_key" ON "Receita"("chaveEstorno");

-- CreateIndex
CREATE INDEX "Receita_processoId_idx" ON "Receita"("processoId");

-- CreateIndex
CREATE INDEX "Receita_categoria_idx" ON "Receita"("categoria");

-- CreateIndex
CREATE INDEX "Receita_cancelada_idx" ON "Receita"("cancelada");

-- CreateIndex
CREATE INDEX "Receita_condicaoPagamentoId_idx" ON "Receita"("condicaoPagamentoId");

-- CreateIndex
CREATE INDEX "Receita_origemLancamento_idx" ON "Receita"("origemLancamento");

-- CreateIndex
CREATE INDEX "Receita_codigo_idx" ON "Receita"("codigo");

-- CreateIndex
CREATE INDEX "Receita_personId_idx" ON "Receita"("personId");

-- CreateIndex
CREATE INDEX "Receita_documentoId_idx" ON "Receita"("documentoId");

-- CreateIndex
CREATE INDEX "Receita_tipoServicoId_idx" ON "Receita"("tipoServicoId");

-- CreateIndex
CREATE UNIQUE INDEX "Custo_codigo_key" ON "Custo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Custo_chaveCancelamento_key" ON "Custo"("chaveCancelamento");

-- CreateIndex
CREATE UNIQUE INDEX "Custo_estornoDeId_key" ON "Custo"("estornoDeId");

-- CreateIndex
CREATE UNIQUE INDEX "Custo_chaveEstorno_key" ON "Custo"("chaveEstorno");

-- CreateIndex
CREATE INDEX "Custo_processoId_idx" ON "Custo"("processoId");

-- CreateIndex
CREATE INDEX "Custo_tipo_idx" ON "Custo"("tipo");

-- CreateIndex
CREATE INDEX "Custo_categoria_idx" ON "Custo"("categoria");

-- CreateIndex
CREATE INDEX "Custo_cancelado_idx" ON "Custo"("cancelado");

-- CreateIndex
CREATE INDEX "Custo_condicaoPagamentoId_idx" ON "Custo"("condicaoPagamentoId");

-- CreateIndex
CREATE INDEX "Custo_origemLancamento_idx" ON "Custo"("origemLancamento");

-- CreateIndex
CREATE INDEX "Custo_codigo_idx" ON "Custo"("codigo");

-- CreateIndex
CREATE INDEX "Custo_personId_idx" ON "Custo"("personId");

-- CreateIndex
CREATE INDEX "Custo_documentoId_idx" ON "Custo"("documentoId");

-- CreateIndex
CREATE INDEX "Custo_tipoServicoId_idx" ON "Custo"("tipoServicoId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_idempotencyKey_key" ON "Cobranca"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Cobranca_receitaId_idx" ON "Cobranca"("receitaId");

-- CreateIndex
CREATE INDEX "Cobranca_processoId_idx" ON "Cobranca"("processoId");

-- CreateIndex
CREATE INDEX "Cobranca_status_idx" ON "Cobranca"("status");

-- CreateIndex
CREATE INDEX "ParcelaFinanceira_receitaId_idx" ON "ParcelaFinanceira"("receitaId");

-- CreateIndex
CREATE INDEX "ParcelaFinanceira_cobrancaId_idx" ON "ParcelaFinanceira"("cobrancaId");

-- CreateIndex
CREATE INDEX "ParcelaFinanceira_custoId_idx" ON "ParcelaFinanceira"("custoId");

-- CreateIndex
CREATE INDEX "ParcelaFinanceira_status_idx" ON "ParcelaFinanceira"("status");

-- CreateIndex
CREATE INDEX "ParcelaFinanceira_vencimento_idx" ON "ParcelaFinanceira"("vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaFinanceira_receitaId_numero_key" ON "ParcelaFinanceira"("receitaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaFinanceira_custoId_numero_key" ON "ParcelaFinanceira"("custoId", "numero");

-- CreateIndex
CREATE INDEX "ReceitaRequerente_receitaId_idx" ON "ReceitaRequerente"("receitaId");

-- CreateIndex
CREATE INDEX "ReceitaRequerente_requerenteId_idx" ON "ReceitaRequerente"("requerenteId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceitaRequerente_receitaId_idx_key" ON "ReceitaRequerente"("receitaId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "ReceitaRequerente_receitaId_requerenteId_key" ON "ReceitaRequerente"("receitaId", "requerenteId");

-- CreateIndex
CREATE INDEX "ReceitaDocumento_receitaId_idx" ON "ReceitaDocumento"("receitaId");

-- CreateIndex
CREATE INDEX "ReceitaDocumento_obrigacaoId_idx" ON "ReceitaDocumento"("obrigacaoId");

-- CreateIndex
CREATE INDEX "EventoFinanceiro_receitaId_idx" ON "EventoFinanceiro"("receitaId");

-- CreateIndex
CREATE INDEX "EventoFinanceiro_cobrancaId_idx" ON "EventoFinanceiro"("cobrancaId");

-- CreateIndex
CREATE INDEX "EventoFinanceiro_custoId_idx" ON "EventoFinanceiro"("custoId");

-- CreateIndex
CREATE INDEX "EventoFinanceiro_usuarioId_idx" ON "EventoFinanceiro"("usuarioId");

-- CreateIndex
CREATE INDEX "EventoFinanceiro_createdAt_idx" ON "EventoFinanceiro"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnaliseDocumental_processoId_key" ON "AnaliseDocumental"("processoId");

-- CreateIndex
CREATE INDEX "AnaliseDocumental_processoId_idx" ON "AnaliseDocumental"("processoId");

-- CreateIndex
CREATE INDEX "AnaliseDocumental_status_idx" ON "AnaliseDocumental"("status");

-- CreateIndex
CREATE INDEX "Divergencia_analiseId_idx" ON "Divergencia"("analiseId");

-- CreateIndex
CREATE INDEX "Divergencia_status_idx" ON "Divergencia"("status");

-- CreateIndex
CREATE INDEX "Divergencia_severidade_idx" ON "Divergencia"("severidade");

-- CreateIndex
CREATE UNIQUE INDEX "PastaTraducao_processoId_key" ON "PastaTraducao"("processoId");

-- CreateIndex
CREATE INDEX "PastaTraducaoDocumento_pastaTraducaoId_idx" ON "PastaTraducaoDocumento"("pastaTraducaoId");

-- CreateIndex
CREATE UNIQUE INDEX "PastaApostilamento_processoId_key" ON "PastaApostilamento"("processoId");

-- CreateIndex
CREATE INDEX "PastaApostilamentoDocumento_pastaApostilamentoId_idx" ON "PastaApostilamentoDocumento"("pastaApostilamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "FaseFinal_processoId_faseKey_key" ON "FaseFinal"("processoId", "faseKey");

-- CreateIndex
CREATE INDEX "RetificacaoPacote_processoId_idx" ON "RetificacaoPacote"("processoId");

-- CreateIndex
CREATE INDEX "RetificacaoPacote_orgaoId_idx" ON "RetificacaoPacote"("orgaoId");

-- CreateIndex
CREATE INDEX "RetificacaoPacote_protocoloId_idx" ON "RetificacaoPacote"("protocoloId");

-- CreateIndex
CREATE UNIQUE INDEX "RetificacaoPacote_processoId_num_key" ON "RetificacaoPacote"("processoId", "num");

-- CreateIndex
CREATE INDEX "RetificacaoPacoteDivergencia_divergenciaId_idx" ON "RetificacaoPacoteDivergencia"("divergenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "RetificacaoPacoteDivergencia_pacoteId_divergenciaId_key" ON "RetificacaoPacoteDivergencia"("pacoteId", "divergenciaId");

-- CreateIndex
CREATE INDEX "Profissional_categoriaId_idx" ON "Profissional"("categoriaId");

-- CreateIndex
CREATE INDEX "Profissional_organizacaoId_idx" ON "Profissional"("organizacaoId");

-- CreateIndex
CREATE INDEX "Profissional_ativo_idx" ON "Profissional"("ativo");

-- CreateIndex
CREATE INDEX "RegistroProfissional_profissionalId_idx" ON "RegistroProfissional"("profissionalId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistroProfissional_tipo_numero_jurisdicao_key" ON "RegistroProfissional"("tipo", "numero", "jurisdicao");

-- CreateIndex
CREATE INDEX "EmissaoRetificada_processoId_idx" ON "EmissaoRetificada"("processoId");

-- CreateIndex
CREATE UNIQUE INDEX "EmissaoRetificada_processoId_documentoId_key" ON "EmissaoRetificada"("processoId", "documentoId");

-- CreateIndex
CREATE INDEX "CotacaoCambio_moedaDe_moedaPara_vigente_idx" ON "CotacaoCambio"("moedaDe", "moedaPara", "vigente");

-- CreateIndex
CREATE UNIQUE INDEX "CotacaoCambio_moedaDe_moedaPara_dataReferencia_modalidade_o_key" ON "CotacaoCambio"("moedaDe", "moedaPara", "dataReferencia", "modalidade", "origem", "payloadHash");

-- CreateIndex
CREATE INDEX "CarteiraRecebimento_contaBancariaId_idx" ON "CarteiraRecebimento"("contaBancariaId");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoFinanceiro_publicCode_key" ON "ProdutoFinanceiro"("publicCode");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_itemCatalogoId_idx" ON "ProdutoFinanceiro"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_tipoDocumentoId_idx" ON "ProdutoFinanceiro"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_honorarioId_idx" ON "ProdutoFinanceiro"("honorarioId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_tipoProcessoId_idx" ON "ProdutoFinanceiro"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_fornecedorPadraoId_idx" ON "ProdutoFinanceiro"("fornecedorPadraoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_condicaoPagamentoId_idx" ON "ProdutoFinanceiro"("condicaoPagamentoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_regraComissaoId_idx" ON "ProdutoFinanceiro"("regraComissaoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoFinanceiro_itemCatalogoId_key" ON "ProdutoFinanceiro"("itemCatalogoId");

-- CreateIndex
CREATE UNIQUE INDEX "TabelaValor_publicCode_key" ON "TabelaValor"("publicCode");

-- CreateIndex
CREATE INDEX "TabelaValor_fornecedorId_idx" ON "TabelaValor"("fornecedorId");

-- CreateIndex
CREATE INDEX "TabelaValor_itemCatalogoId_idx" ON "TabelaValor"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "TabelaValor_natureza_idx" ON "TabelaValor"("natureza");

-- CreateIndex
CREATE INDEX "TabelaValor_configuracaoFinanceiraItemId_idx" ON "TabelaValor"("configuracaoFinanceiraItemId");

-- CreateIndex
CREATE INDEX "TabelaValor_modalidadeId_idx" ON "TabelaValor"("modalidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "PendenciaFinanceira_chaveIdempotencia_key" ON "PendenciaFinanceira"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PendenciaFinanceira_processoId_idx" ON "PendenciaFinanceira"("processoId");

-- CreateIndex
CREATE INDEX "PendenciaFinanceira_phaseKey_idx" ON "PendenciaFinanceira"("phaseKey");

-- CreateIndex
CREATE INDEX "PendenciaFinanceira_resolvida_idx" ON "PendenciaFinanceira"("resolvida");

-- CreateIndex
CREATE INDEX "PendenciaFinanceira_configFinanceiraId_idx" ON "PendenciaFinanceira"("configFinanceiraId");

-- CreateIndex
CREATE INDEX "CondicaoPagamento_carteiraId_idx" ON "CondicaoPagamento"("carteiraId");

-- CreateIndex
CREATE INDEX "CondicaoPagamento_codigo_idx" ON "CondicaoPagamento"("codigo");

-- CreateIndex
CREATE INDEX "CondicaoPagamento_substituiId_idx" ON "CondicaoPagamento"("substituiId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamento_codigo_versao_key" ON "CondicaoPagamento"("codigo", "versao");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoForma_condicaoId_idx" ON "CondicaoPagamentoForma"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoForma_formaId_idx" ON "CondicaoPagamentoForma"("formaId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoForma_condicaoId_formaId_key" ON "CondicaoPagamentoForma"("condicaoId", "formaId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoTaxa_condicaoId_idx" ON "CondicaoPagamentoTaxa"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoTaxa_taxaId_idx" ON "CondicaoPagamentoTaxa"("taxaId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoTaxa_condicaoId_taxaId_key" ON "CondicaoPagamentoTaxa"("condicaoId", "taxaId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoMoeda_condicaoId_idx" ON "CondicaoPagamentoMoeda"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoMoeda_moedaId_idx" ON "CondicaoPagamentoMoeda"("moedaId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoMoeda_condicaoId_moedaId_key" ON "CondicaoPagamentoMoeda"("condicaoId", "moedaId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoPais_condicaoId_idx" ON "CondicaoPagamentoPais"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoPais_paisId_idx" ON "CondicaoPagamentoPais"("paisId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoPais_condicaoId_paisId_key" ON "CondicaoPagamentoPais"("condicaoId", "paisId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoModalidade_condicaoId_idx" ON "CondicaoPagamentoModalidade"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoModalidade_modalidadeId_idx" ON "CondicaoPagamentoModalidade"("modalidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoModalidade_condicaoId_modalidadeId_key" ON "CondicaoPagamentoModalidade"("condicaoId", "modalidadeId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoServico_condicaoId_idx" ON "CondicaoPagamentoServico"("condicaoId");

-- CreateIndex
CREATE INDEX "CondicaoPagamentoServico_servicoId_idx" ON "CondicaoPagamentoServico"("servicoId");

-- CreateIndex
CREATE UNIQUE INDEX "CondicaoPagamentoServico_condicaoId_servicoId_key" ON "CondicaoPagamentoServico"("condicaoId", "servicoId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicoProduto_publicCode_key" ON "ServicoProduto"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "ServicoProduto_code_key" ON "ServicoProduto"("code");

-- CreateIndex
CREATE INDEX "ServicoProduto_itemCatalogoId_idx" ON "ServicoProduto"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "ServicoProdutoPais_servicoId_idx" ON "ServicoProdutoPais"("servicoId");

-- CreateIndex
CREATE INDEX "ServicoProdutoPais_paisId_idx" ON "ServicoProdutoPais"("paisId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicoProdutoPais_servicoId_paisId_key" ON "ServicoProdutoPais"("servicoId", "paisId");

-- CreateIndex
CREATE UNIQUE INDEX "MoedaCadastro_code_key" ON "MoedaCadastro"("code");

-- CreateIndex
CREATE INDEX "FormaPagamentoCadastro_ativo_ordem_idx" ON "FormaPagamentoCadastro"("ativo", "ordem");

-- CreateIndex
CREATE INDEX "TaxaPagamento_ativo_prioridade_idx" ON "TaxaPagamento"("ativo", "prioridade");

-- CreateIndex
CREATE INDEX "TaxaParcelamento_taxaId_idx" ON "TaxaParcelamento"("taxaId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxaParcelamento_taxaId_parcelasDe_parcelasAte_key" ON "TaxaParcelamento"("taxaId", "parcelasDe", "parcelasAte");

-- CreateIndex
CREATE INDEX "TaxaPagamentoMoeda_taxaId_idx" ON "TaxaPagamentoMoeda"("taxaId");

-- CreateIndex
CREATE INDEX "TaxaPagamentoMoeda_moedaId_idx" ON "TaxaPagamentoMoeda"("moedaId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxaPagamentoMoeda_taxaId_moedaId_key" ON "TaxaPagamentoMoeda"("taxaId", "moedaId");

-- CreateIndex
CREATE INDEX "TaxaPagamentoPais_taxaId_idx" ON "TaxaPagamentoPais"("taxaId");

-- CreateIndex
CREATE INDEX "TaxaPagamentoPais_paisId_idx" ON "TaxaPagamentoPais"("paisId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxaPagamentoPais_taxaId_paisId_key" ON "TaxaPagamentoPais"("taxaId", "paisId");

-- CreateIndex
CREATE UNIQUE INDEX "Adquirente_code_key" ON "Adquirente"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Adquirente_slug_key" ON "Adquirente"("slug");

-- CreateIndex
CREATE INDEX "Adquirente_ativo_idx" ON "Adquirente"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Bandeira_code_key" ON "Bandeira"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Bandeira_slug_key" ON "Bandeira"("slug");

-- CreateIndex
CREATE INDEX "Bandeira_ativo_idx" ON "Bandeira"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoProcessoNacionalidade_code_key" ON "TipoProcessoNacionalidade"("code");

-- CreateIndex
CREATE INDEX "TipoProcessoNacionalidade_countryKey_idx" ON "TipoProcessoNacionalidade"("countryKey");

-- CreateIndex
CREATE INDEX "TipoProcessoNacionalidade_modalityKey_idx" ON "TipoProcessoNacionalidade"("modalityKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoPais_countryKey_key" ON "CatalogoPais"("countryKey");

-- CreateIndex
CREATE INDEX "ModalidadePais_countryKey_idx" ON "ModalidadePais"("countryKey");

-- CreateIndex
CREATE UNIQUE INDEX "ModalidadePais_countryKey_modalityKey_key" ON "ModalidadePais"("countryKey", "modalityKey");

-- CreateIndex
CREATE INDEX "FaseNaturezaPermitida_catalogoFaseId_idx" ON "FaseNaturezaPermitida"("catalogoFaseId");

-- CreateIndex
CREATE UNIQUE INDEX "FaseNaturezaPermitida_catalogoFaseId_naturezaOperacionalId_key" ON "FaseNaturezaPermitida"("catalogoFaseId", "naturezaOperacionalId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoFase_phaseKey_key" ON "CatalogoFase"("phaseKey");

-- CreateIndex
CREATE UNIQUE INDEX "MacroWorkflow_tipoProcessoId_key" ON "MacroWorkflow"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "FaseMacro_macroWorkflowId_idx" ON "FaseMacro"("macroWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX "FaseMacro_macroWorkflowId_phaseKey_key" ON "FaseMacro"("macroWorkflowId", "phaseKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseInternalWorkflow_wfUid_key" ON "PhaseInternalWorkflow"("wfUid");

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflow_phaseKey_idx" ON "PhaseInternalWorkflow"("phaseKey");

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflow_tipoProcessoId_idx" ON "PhaseInternalWorkflow"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflow_familiaDocumentalId_idx" ON "PhaseInternalWorkflow"("familiaDocumentalId");

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflowVersao_workflowId_idx" ON "PhaseInternalWorkflowVersao"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseInternalWorkflowVersao_workflowId_versao_key" ON "PhaseInternalWorkflowVersao"("workflowId", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseInternalWorkflowStep_workflowId_key_key" ON "PhaseInternalWorkflowStep"("workflowId", "key");

-- CreateIndex
CREATE INDEX "StepSubtaskDefinition_stepId_idx" ON "StepSubtaskDefinition"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "StepSubtaskDefinition_stepId_key_key" ON "StepSubtaskDefinition"("stepId", "key");

-- CreateIndex
CREATE INDEX "StepAction_stepId_idx" ON "StepAction"("stepId");

-- CreateIndex
CREATE INDEX "StepField_stepId_idx" ON "StepField"("stepId");

-- CreateIndex
CREATE INDEX "StepFieldOption_fieldId_idx" ON "StepFieldOption"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "StepFieldOption_fieldId_key_key" ON "StepFieldOption"("fieldId", "key");

-- CreateIndex
CREATE INDEX "StepChannel_stepId_idx" ON "StepChannel"("stepId");

-- CreateIndex
CREATE INDEX "StepChannel_canalId_idx" ON "StepChannel"("canalId");

-- CreateIndex
CREATE UNIQUE INDEX "StepChannel_stepId_canalId_key" ON "StepChannel"("stepId", "canalId");

-- CreateIndex
CREATE INDEX "StepRequirement_stepId_idx" ON "StepRequirement"("stepId");

-- CreateIndex
CREATE INDEX "StepChecklistItem_stepId_idx" ON "StepChecklistItem"("stepId");

-- CreateIndex
CREATE INDEX "OrganizacaoCanal_organizacaoId_idx" ON "OrganizacaoCanal"("organizacaoId");

-- CreateIndex
CREATE INDEX "OrganizacaoCanal_canalId_idx" ON "OrganizacaoCanal"("canalId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizacaoCanal_organizacaoId_canalId_key" ON "OrganizacaoCanal"("organizacaoId", "canalId");

-- CreateIndex
CREATE UNIQUE INDEX "CanalOperacional_key_key" ON "CanalOperacional"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseAutomationRule_publicCode_key" ON "PhaseAutomationRule"("publicCode");

-- CreateIndex
CREATE INDEX "PhaseAutomationRule_tipoProcessoId_idx" ON "PhaseAutomationRule"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "PhaseAutomationRule_phaseKey_idx" ON "PhaseAutomationRule"("phaseKey");

-- CreateIndex
CREATE INDEX "PhaseAutomationRule_kind_idx" ON "PhaseAutomationRule"("kind");

-- CreateIndex
CREATE INDEX "PhaseAutomationRule_configItemId_idx" ON "PhaseAutomationRule"("configItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgaoProtocolo_publicCode_key" ON "OrgaoProtocolo"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "OrgaoProtocolo_identificacaoFiscal_key" ON "OrgaoProtocolo"("identificacaoFiscal");

-- CreateIndex
CREATE INDEX "OrgaoProtocolo_type_idx" ON "OrgaoProtocolo"("type");

-- CreateIndex
CREATE INDEX "OrgaoProtocolo_country_idx" ON "OrgaoProtocolo"("country");

-- CreateIndex
CREATE INDEX "OrgaoProtocolo_ativo_idx" ON "OrgaoProtocolo"("ativo");

-- CreateIndex
CREATE INDEX "OrgaoProtocolo_provincia_idx" ON "OrgaoProtocolo"("provincia");

-- CreateIndex
CREATE INDEX "OrgaoProtocolo_funcoes_idx" ON "OrgaoProtocolo"("funcoes");

-- CreateIndex
CREATE UNIQUE INDEX "OrgaoProtocolo_name_country_key" ON "OrgaoProtocolo"("name", "country");

-- CreateIndex
CREATE UNIQUE INDEX "TipoDocumentoCadastro_publicCode_key" ON "TipoDocumentoCadastro"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "TipoDocumentoCadastro_legacyEnumKey_key" ON "TipoDocumentoCadastro"("legacyEnumKey");

-- CreateIndex
CREATE INDEX "TipoDocumentoCadastro_itemCatalogoId_idx" ON "TipoDocumentoCadastro"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "TipoDocumentoCadastro_categoriaDocumentalId_idx" ON "TipoDocumentoCadastro"("categoriaDocumentalId");

-- CreateIndex
CREATE INDEX "TipoDocumentoCadastro_familiaDocumentalId_idx" ON "TipoDocumentoCadastro"("familiaDocumentalId");

-- CreateIndex
CREATE INDEX "TipoDocumentoCadastro_naturezaOperacionalId_idx" ON "TipoDocumentoCadastro"("naturezaOperacionalId");

-- CreateIndex
CREATE INDEX "TipoDocumentoCadastro_perfilOperacionalId_idx" ON "TipoDocumentoCadastro"("perfilOperacionalId");

-- CreateIndex
CREATE UNIQUE INDEX "FamiliaDocumental_code_key" ON "FamiliaDocumental"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NaturezaOperacionalDocumento_code_key" ON "NaturezaOperacionalDocumento"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilOperacionalDocumento_code_key" ON "PerfilOperacionalDocumento"("code");

-- CreateIndex
CREATE INDEX "PerfilOperacionalDocumento_workflowId_idx" ON "PerfilOperacionalDocumento"("workflowId");

-- CreateIndex
CREATE INDEX "PerfilOperacionalDocumento_familiaDocumentalId_idx" ON "PerfilOperacionalDocumento"("familiaDocumentalId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaDocumental_code_key" ON "CategoriaDocumental"("code");

-- CreateIndex
CREATE INDEX "MatrizDocumental_tipoProcessoId_idx" ON "MatrizDocumental"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "MatrizDocumental_phaseKey_idx" ON "MatrizDocumental"("phaseKey");

-- CreateIndex
CREATE INDEX "MatrizDocumental_status_idx" ON "MatrizDocumental"("status");

-- CreateIndex
CREATE INDEX "MatrizDocumental_codigo_idx" ON "MatrizDocumental"("codigo");

-- CreateIndex
CREATE INDEX "MatrizDocumental_publicoAlvo_idx" ON "MatrizDocumental"("publicoAlvo");

-- CreateIndex
CREATE UNIQUE INDEX "MatrizDocumental_codigo_versao_key" ON "MatrizDocumental"("codigo", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "MotorArtefato_automaticKey_key" ON "MotorArtefato"("automaticKey");

-- CreateIndex
CREATE INDEX "MotorArtefato_processoId_idx" ON "MotorArtefato"("processoId");

-- CreateIndex
CREATE INDEX "MotorArtefato_status_idx" ON "MotorArtefato"("status");

-- CreateIndex
CREATE INDEX "MotorArtefato_phaseKey_idx" ON "MotorArtefato"("phaseKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegraTarefaTransversal_ruleKey_key" ON "RegraTarefaTransversal"("ruleKey");

-- CreateIndex
CREATE INDEX "RegraTarefaTransversal_tipoProcessoId_idx" ON "RegraTarefaTransversal"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "RegraTarefaTransversal_originPhase_idx" ON "RegraTarefaTransversal"("originPhase");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilPermissaoMotor_chave_key" ON "PerfilPermissaoMotor"("chave");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_tipoProcessoId_idx" ON "PhaseEconomicRule"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_phaseKey_idx" ON "PhaseEconomicRule"("phaseKey");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_tipoDocumentoId_idx" ON "PhaseEconomicRule"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_custoConfigId_idx" ON "PhaseEconomicRule"("custoConfigId");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_receitaConfigId_idx" ON "PhaseEconomicRule"("receitaConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCatalogo_code_key" ON "ItemCatalogo"("code");

-- CreateIndex
CREATE INDEX "ItemCatalogo_natureza_idx" ON "ItemCatalogo"("natureza");

-- CreateIndex
CREATE INDEX "ItemCatalogo_ativo_idx" ON "ItemCatalogo"("ativo");

-- CreateIndex
CREATE INDEX "ItemCatalogo_categoriaId_idx" ON "ItemCatalogo"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "NecessidadeDocumental_chaveIdempotencia_key" ON "NecessidadeDocumental"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_processoId_idx" ON "NecessidadeDocumental"("processoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_itemCatalogoId_idx" ON "NecessidadeDocumental"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_pessoaId_idx" ON "NecessidadeDocumental"("pessoaId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_uniaoId_idx" ON "NecessidadeDocumental"("uniaoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_status_idx" ON "NecessidadeDocumental"("status");

-- CreateIndex
CREATE INDEX "NecessidadeDocumentalEvento_necessidadeId_idx" ON "NecessidadeDocumentalEvento"("necessidadeId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumentalEvento_criadoEm_idx" ON "NecessidadeDocumentalEvento"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseWorkflowInstance_chaveIdempotencia_key" ON "PhaseWorkflowInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_processoId_faseMacroKey_status_idx" ON "PhaseWorkflowInstance"("processoId", "faseMacroKey", "status");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_chaveIdempotencia_idx" ON "PhaseWorkflowInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_previousInstanceId_idx" ON "PhaseWorkflowInstance"("previousInstanceId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_processoId_requerRegularizacao_idx" ON "PhaseWorkflowInstance"("processoId", "requerRegularizacao");

-- CreateIndex
CREATE UNIQUE INDEX "StepExecution_chaveIdempotencia_key" ON "StepExecution"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "StepExecution_stepInstanceId_idx" ON "StepExecution"("stepInstanceId");

-- CreateIndex
CREATE INDEX "StepExecution_protocoloId_idx" ON "StepExecution"("protocoloId");

-- CreateIndex
CREATE UNIQUE INDEX "StepExecution_stepInstanceId_sequencia_key" ON "StepExecution"("stepInstanceId", "sequencia");

-- CreateIndex
CREATE UNIQUE INDEX "SubtaskExecution_chaveIdempotencia_key" ON "SubtaskExecution"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "SubtaskExecution_stepInstanceId_idx" ON "SubtaskExecution"("stepInstanceId");

-- CreateIndex
CREATE INDEX "SubtaskExecution_subtaskKey_idx" ON "SubtaskExecution"("subtaskKey");

-- CreateIndex
CREATE INDEX "SubtaskExecution_protocoloId_idx" ON "SubtaskExecution"("protocoloId");

-- CreateIndex
CREATE UNIQUE INDEX "SubtaskExecution_stepInstanceId_subtaskKey_sequencia_key" ON "SubtaskExecution"("stepInstanceId", "subtaskKey", "sequencia");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseWorkflowStepInstance_chaveIdempotencia_key" ON "PhaseWorkflowStepInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_workflowInstanceId_ordem_idx" ON "PhaseWorkflowStepInstance"("workflowInstanceId", "ordem");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_processoId_faseMacroKey_status_idx" ON "PhaseWorkflowStepInstance"("processoId", "faseMacroKey", "status");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_necessidadeId_idx" ON "PhaseWorkflowStepInstance"("necessidadeId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_documentoId_idx" ON "PhaseWorkflowStepInstance"("documentoId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_retificacaoPacoteId_idx" ON "PhaseWorkflowStepInstance"("retificacaoPacoteId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_stepKey_idx" ON "PhaseWorkflowStepInstance"("stepKey");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_chaveIdempotencia_idx" ON "PhaseWorkflowStepInstance"("chaveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEvento_chaveIdempotencia_key" ON "WorkflowEvento"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "WorkflowEvento_entityType_entityId_idx" ON "WorkflowEvento"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_correlationId_idx" ON "WorkflowEvento"("correlationId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_processoId_idx" ON "WorkflowEvento"("processoId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_criadoEm_idx" ON "WorkflowEvento"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseAdvanceLog_chaveIdempotencia_key" ON "PhaseAdvanceLog"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_processoId_idx" ON "PhaseAdvanceLog"("processoId");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_correlationId_idx" ON "PhaseAdvanceLog"("correlationId");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_criadoEm_idx" ON "PhaseAdvanceLog"("criadoEm");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_resultado_idx" ON "PhaseAdvanceLog"("resultado");

-- CreateIndex
CREATE UNIQUE INDEX "DomainOutbox_chaveIdempotencia_key" ON "DomainOutbox"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DomainOutbox_status_criadoEm_idx" ON "DomainOutbox"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "DomainOutbox_correlationId_idx" ON "DomainOutbox"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "OperacaoAntecipada_publicCode_key" ON "OperacaoAntecipada"("publicCode");

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_processoId_idx" ON "OperacaoAntecipada"("processoId");

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_necessidadeId_idx" ON "OperacaoAntecipada"("necessidadeId");

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_targetOperationType_targetOperationId_idx" ON "OperacaoAntecipada"("targetOperationType", "targetOperationId");

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_targetTipoDocumentoId_idx" ON "OperacaoAntecipada"("targetTipoDocumentoId");

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_status_idx" ON "OperacaoAntecipada"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OperacaoAntecipada_processoId_necessidadeId_targetOperation_key" ON "OperacaoAntecipada"("processoId", "necessidadeId", "targetOperationType", "targetTipoDocumentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ObrigacaoEconomica_chaveIdempotencia_key" ON "ObrigacaoEconomica"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_processoId_idx" ON "ObrigacaoEconomica"("processoId");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_status_idx" ON "ObrigacaoEconomica"("status");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_natureza_idx" ON "ObrigacaoEconomica"("natureza");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_codigoOperacional_idx" ON "ObrigacaoEconomica"("codigoOperacional");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_itemCatalogoId_idx" ON "ObrigacaoEconomica"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_documentoId_idx" ON "ObrigacaoEconomica"("documentoId");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_personId_idx" ON "ObrigacaoEconomica"("personId");

-- CreateIndex
CREATE INDEX "ObrigacaoEconomica_processoId_documentoId_tipoServicoId_idx" ON "ObrigacaoEconomica"("processoId", "documentoId", "tipoServicoId");

-- CreateIndex
CREATE UNIQUE INDEX "ObrigacaoEconomica_origemTipo_origemId_key" ON "ObrigacaoEconomica"("origemTipo", "origemId");

-- CreateIndex
CREATE INDEX "AssistenteParametrizacaoProgresso_tipoProcessoId_idx" ON "AssistenteParametrizacaoProgresso"("tipoProcessoId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistenteParametrizacaoProgresso_tipoProcessoId_phaseKey_key" ON "AssistenteParametrizacaoProgresso"("tipoProcessoId", "phaseKey");

-- CreateIndex
CREATE INDEX "ParcelaPagavel_obrigacaoId_idx" ON "ParcelaPagavel"("obrigacaoId");

-- CreateIndex
CREATE INDEX "ParcelaPagavel_vencimento_idx" ON "ParcelaPagavel"("vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelaPagavel_obrigacaoId_numero_key" ON "ParcelaPagavel"("obrigacaoId", "numero");

-- CreateIndex
CREATE INDEX "RepasseCusto_custoObrigacaoId_idx" ON "RepasseCusto"("custoObrigacaoId");

-- CreateIndex
CREATE INDEX "RepasseCusto_receitaObrigacaoId_idx" ON "RepasseCusto"("receitaObrigacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerFinanceiro_obrigacaoId_key" ON "LedgerFinanceiro"("obrigacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerId_sequencia_idx" ON "LedgerEntry"("ledgerId", "sequencia");

-- CreateIndex
CREATE INDEX "LedgerEntry_transacaoId_idx" ON "LedgerEntry"("transacaoId");

-- CreateIndex
CREATE INDEX "LedgerEntry_obrigacaoId_data_idx" ON "LedgerEntry"("obrigacaoId", "data");

-- CreateIndex
CREATE INDEX "LedgerEntry_ocorrenciaId_idx" ON "LedgerEntry"("ocorrenciaId");

-- CreateIndex
CREATE INDEX "LedgerEntry_contaContabil_data_idx" ON "LedgerEntry"("contaContabil", "data");

-- CreateIndex
CREATE UNIQUE INDEX "PlanoContaFinanceira_codigo_key" ON "PlanoContaFinanceira"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerOpeningBalance_obrigacaoId_key" ON "LedgerOpeningBalance"("obrigacaoId");

-- CreateIndex
CREATE INDEX "LancamentoBancario_status_idx" ON "LancamentoBancario"("status");

-- CreateIndex
CREATE INDEX "LancamentoBancario_ocorrenciaId_idx" ON "LancamentoBancario"("ocorrenciaId");

-- CreateIndex
CREATE INDEX "LancamentoBancario_obrigacaoId_idx" ON "LancamentoBancario"("obrigacaoId");

-- CreateIndex
CREATE INDEX "LancamentoBancario_data_idx" ON "LancamentoBancario"("data");

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoBancario_identificadorTransacao_key" ON "LancamentoBancario"("identificadorTransacao");

-- CreateIndex
CREATE UNIQUE INDEX "OcorrenciaFinanceira_idempotencyKey_key" ON "OcorrenciaFinanceira"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OcorrenciaFinanceira_obrigacaoId_data_idx" ON "OcorrenciaFinanceira"("obrigacaoId", "data");

-- CreateIndex
CREATE INDEX "OcorrenciaFinanceira_tipo_status_idx" ON "OcorrenciaFinanceira"("tipo", "status");

-- CreateIndex
CREATE INDEX "AplicacaoFinanceira_ocorrenciaId_idx" ON "AplicacaoFinanceira"("ocorrenciaId");

-- CreateIndex
CREATE INDEX "AplicacaoFinanceira_parcelaId_idx" ON "AplicacaoFinanceira"("parcelaId");

-- CreateIndex
CREATE INDEX "DistribuicaoEconomica_obrigacaoId_idx" ON "DistribuicaoEconomica"("obrigacaoId");

-- CreateIndex
CREATE INDEX "ParticipacaoEconomica_distribuicaoId_idx" ON "ParticipacaoEconomica"("distribuicaoId");

-- CreateIndex
CREATE INDEX "ParticipacaoEconomica_pessoaId_idx" ON "ParticipacaoEconomica"("pessoaId");

-- CreateIndex
CREATE INDEX "CreditoFinanceiro_obrigacaoId_idx" ON "CreditoFinanceiro"("obrigacaoId");

-- CreateIndex
CREATE INDEX "CreditoFinanceiro_pessoaId_idx" ON "CreditoFinanceiro"("pessoaId");

-- CreateIndex
CREATE INDEX "CreditoMovimento_creditoId_idx" ON "CreditoMovimento"("creditoId");

-- CreateIndex
CREATE INDEX "CreditoMovimento_correlationId_idx" ON "CreditoMovimento"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoProjecao_obrigacaoId_key" ON "SaldoProjecao"("obrigacaoId");

-- CreateIndex
CREATE INDEX "SaldoSnapshot_obrigacaoId_sequenciaAplicada_idx" ON "SaldoSnapshot"("obrigacaoId", "sequenciaAplicada");

-- CreateIndex
CREATE UNIQUE INDEX "ModalidadeLegal_code_key" ON "ModalidadeLegal"("code");

-- CreateIndex
CREATE INDEX "ModalidadeLegal_paisId_idx" ON "ModalidadeLegal"("paisId");

-- CreateIndex
CREATE UNIQUE INDEX "EnquadramentoLegal_code_key" ON "EnquadramentoLegal"("code");

-- CreateIndex
CREATE INDEX "EnquadramentoLegal_modalidadeLegalId_idx" ON "EnquadramentoLegal"("modalidadeLegalId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaServico_code_key" ON "CategoriaServico"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaOrganizacao_code_key" ON "CategoriaOrganizacao"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaProfissional_code_key" ON "CategoriaProfissional"("code");

-- CreateIndex
CREATE INDEX "OrganizacaoCategoria_categoriaId_idx" ON "OrganizacaoCategoria"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizacaoCategoria_orgaoId_categoriaId_key" ON "OrganizacaoCategoria"("orgaoId", "categoriaId");

-- CreateIndex
CREATE INDEX "GrupoUsuarioMembro_usuarioId_idx" ON "GrupoUsuarioMembro"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoUsuarioMembro_grupoId_usuarioId_key" ON "GrupoUsuarioMembro"("grupoId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "CargoCadastro_code_key" ON "CargoCadastro"("code");

-- CreateIndex
CREATE INDEX "ConfiguracaoSistema_grupo_idx" ON "ConfiguracaoSistema"("grupo");

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDocumento_code_key" ON "ModeloDocumento"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RegraNotificacao_code_key" ON "RegraNotificacao"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NomePessoa_supersedidoPorId_key" ON "NomePessoa"("supersedidoPorId");

-- CreateIndex
CREATE UNIQUE INDEX "NomePessoa_chaveIdempotencia_key" ON "NomePessoa"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "NomePessoa_pessoaId_idx" ON "NomePessoa"("pessoaId");

-- CreateIndex
CREATE INDEX "NomePessoa_chaveFonetica_idx" ON "NomePessoa"("chaveFonetica");

-- CreateIndex
CREATE INDEX "NomePessoa_pessoaId_principal_idx" ON "NomePessoa"("pessoaId", "principal");

-- CreateIndex
CREATE UNIQUE INDEX "DecisaoDeduplicacao_chaveIdempotencia_key" ON "DecisaoDeduplicacao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DecisaoDeduplicacao_chaveDedup_idx" ON "DecisaoDeduplicacao"("chaveDedup");

-- CreateIndex
CREATE INDEX "DecisaoDeduplicacao_pessoaResultanteId_idx" ON "DecisaoDeduplicacao"("pessoaResultanteId");

-- CreateIndex
CREATE INDEX "DecisaoDeduplicacao_decididoEm_idx" ON "DecisaoDeduplicacao"("decididoEm");

-- CreateIndex
CREATE UNIQUE INDEX "LoteRegistral_chaveIdempotencia_key" ON "LoteRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "LoteRegistral_processoId_status_idx" ON "LoteRegistral"("processoId", "status");

-- CreateIndex
CREATE INDEX "LoteRegistral_correlationId_idx" ON "LoteRegistral"("correlationId");

-- CreateIndex
CREATE INDEX "LoteRegistral_criadoEm_idx" ON "LoteRegistral"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ExecucaoRegistral_chaveIdempotencia_key" ON "ExecucaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "ExecucaoRegistral_loteId_etapa_idx" ON "ExecucaoRegistral"("loteId", "etapa");

-- CreateIndex
CREATE INDEX "ExecucaoRegistral_documentoId_idx" ON "ExecucaoRegistral"("documentoId");

-- CreateIndex
CREATE INDEX "ExecucaoRegistral_etapa_proximaEm_idx" ON "ExecucaoRegistral"("etapa", "proximaEm");

-- CreateIndex
CREATE INDEX "ExecucaoRegistral_correlationId_idx" ON "ExecucaoRegistral"("correlationId");

-- CreateIndex
CREATE INDEX "EtapaExecucaoRegistral_execucaoId_criadoEm_idx" ON "EtapaExecucaoRegistral"("execucaoId", "criadoEm");

-- CreateIndex
CREATE INDEX "EtapaExecucaoRegistral_etapa_idx" ON "EtapaExecucaoRegistral"("etapa");

-- CreateIndex
CREATE UNIQUE INDEX "OcorrenciaDocumental_chaveIdempotencia_key" ON "OcorrenciaDocumental"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "OcorrenciaDocumental_execucaoId_idx" ON "OcorrenciaDocumental"("execucaoId");

-- CreateIndex
CREATE INDEX "OcorrenciaDocumental_documentoId_papel_idx" ON "OcorrenciaDocumental"("documentoId", "papel");

-- CreateIndex
CREATE INDEX "OcorrenciaDocumental_chaveFonetica_idx" ON "OcorrenciaDocumental"("chaveFonetica");

-- CreateIndex
CREATE INDEX "OcorrenciaDocumental_pessoaResolvidaId_idx" ON "OcorrenciaDocumental"("pessoaResolvidaId");

-- CreateIndex
CREATE UNIQUE INDEX "FatoRegistral_supersedidoPorId_key" ON "FatoRegistral"("supersedidoPorId");

-- CreateIndex
CREATE UNIQUE INDEX "FatoRegistral_chaveIdempotencia_key" ON "FatoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "FatoRegistral_pessoaId_campo_ativo_idx" ON "FatoRegistral"("pessoaId", "campo", "ativo");

-- CreateIndex
CREATE INDEX "FatoRegistral_uniaoId_campo_ativo_idx" ON "FatoRegistral"("uniaoId", "campo", "ativo");

-- CreateIndex
CREATE INDEX "FatoRegistral_estado_idx" ON "FatoRegistral"("estado");

-- CreateIndex
CREATE INDEX "FatoRegistral_campo_idx" ON "FatoRegistral"("campo");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenciaRegistral_chaveIdempotencia_key" ON "EvidenciaRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "EvidenciaRegistral_documentoId_campo_idx" ON "EvidenciaRegistral"("documentoId", "campo");

-- CreateIndex
CREATE INDEX "EvidenciaRegistral_fatoId_idx" ON "EvidenciaRegistral"("fatoId");

-- CreateIndex
CREATE INDEX "EvidenciaRegistral_ocorrenciaId_idx" ON "EvidenciaRegistral"("ocorrenciaId");

-- CreateIndex
CREATE INDEX "EvidenciaRegistral_pessoaId_campo_idx" ON "EvidenciaRegistral"("pessoaId", "campo");

-- CreateIndex
CREATE INDEX "EvidenciaRegistral_necessidadeId_idx" ON "EvidenciaRegistral"("necessidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrespondenciaIdentidade_chaveIdempotencia_key" ON "CorrespondenciaIdentidade"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "CorrespondenciaIdentidade_ocorrenciaId_classe_idx" ON "CorrespondenciaIdentidade"("ocorrenciaId", "classe");

-- CreateIndex
CREATE INDEX "CorrespondenciaIdentidade_pessoaId_idx" ON "CorrespondenciaIdentidade"("pessoaId");

-- CreateIndex
CREATE INDEX "CorrespondenciaIdentidade_score_idx" ON "CorrespondenciaIdentidade"("score");

-- CreateIndex
CREATE UNIQUE INDEX "PropostaReconciliacao_chaveIdempotencia_key" ON "PropostaReconciliacao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PropostaReconciliacao_processoId_status_idx" ON "PropostaReconciliacao"("processoId", "status");

-- CreateIndex
CREATE INDEX "PropostaReconciliacao_loteId_idx" ON "PropostaReconciliacao"("loteId");

-- CreateIndex
CREATE INDEX "PropostaReconciliacao_tipo_status_idx" ON "PropostaReconciliacao"("tipo", "status");

-- CreateIndex
CREATE INDEX "PropostaReconciliacao_criticidade_status_idx" ON "PropostaReconciliacao"("criticidade", "status");

-- CreateIndex
CREATE INDEX "PropostaReconciliacao_correlationId_idx" ON "PropostaReconciliacao"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflitoRegistral_chaveIdempotencia_key" ON "ConflitoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "ConflitoRegistral_processoId_status_idx" ON "ConflitoRegistral"("processoId", "status");

-- CreateIndex
CREATE INDEX "ConflitoRegistral_severidade_status_idx" ON "ConflitoRegistral"("severidade", "status");

-- CreateIndex
CREATE INDEX "ConflitoRegistral_codigo_idx" ON "ConflitoRegistral"("codigo");

-- CreateIndex
CREATE INDEX "ConflitoRegistral_pessoaId_idx" ON "ConflitoRegistral"("pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactoAplicacaoRegistral_chaveIdempotencia_key" ON "ImpactoAplicacaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "ImpactoAplicacaoRegistral_propostaId_momento_idx" ON "ImpactoAplicacaoRegistral"("propostaId", "momento");

-- CreateIndex
CREATE INDEX "ImpactoAplicacaoRegistral_bloqueado_idx" ON "ImpactoAplicacaoRegistral"("bloqueado");

-- CreateIndex
CREATE UNIQUE INDEX "DecisaoRevisaoRegistral_chaveIdempotencia_key" ON "DecisaoRevisaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DecisaoRevisaoRegistral_propostaId_idx" ON "DecisaoRevisaoRegistral"("propostaId");

-- CreateIndex
CREATE INDEX "DecisaoRevisaoRegistral_conflitoId_idx" ON "DecisaoRevisaoRegistral"("conflitoId");

-- CreateIndex
CREATE INDEX "DecisaoRevisaoRegistral_responsavelId_idx" ON "DecisaoRevisaoRegistral"("responsavelId");

-- CreateIndex
CREATE INDEX "DecisaoRevisaoRegistral_criadoEm_idx" ON "DecisaoRevisaoRegistral"("criadoEm");

-- CreateIndex
CREATE INDEX "VersaoGenealogica_arvoreId_criadoEm_idx" ON "VersaoGenealogica"("arvoreId", "criadoEm");

-- CreateIndex
CREATE INDEX "VersaoGenealogica_hash_idx" ON "VersaoGenealogica"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "VersaoGenealogica_arvoreId_versao_key" ON "VersaoGenealogica"("arvoreId", "versao");

-- CreateIndex
CREATE INDEX "MetricaRegistral_chave_janelaInicio_idx" ON "MetricaRegistral"("chave", "janelaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "MetricaRegistral_chave_escopo_janelaInicio_key" ON "MetricaRegistral"("chave", "escopo", "janelaInicio");

-- CreateIndex
CREATE INDEX "SaudeExecucao_criadoEm_idx" ON "SaudeExecucao"("criadoEm");

-- CreateIndex
CREATE INDEX "SaudeExecucao_estado_idx" ON "SaudeExecucao"("estado");

-- CreateIndex
CREATE INDEX "SaudeExecucao_modo_idx" ON "SaudeExecucao"("modo");

-- CreateIndex
CREATE UNIQUE INDEX "SaudeAchado_chave_key" ON "SaudeAchado"("chave");

-- CreateIndex
CREATE INDEX "SaudeAchado_status_idx" ON "SaudeAchado"("status");

-- CreateIndex
CREATE INDEX "SaudeAchado_severidade_idx" ON "SaudeAchado"("severidade");

-- CreateIndex
CREATE INDEX "SaudeAchado_dominio_idx" ON "SaudeAchado"("dominio");

-- CreateIndex
CREATE INDEX "SaudeAchado_codigo_idx" ON "SaudeAchado"("codigo");

-- CreateIndex
CREATE INDEX "SaudeAchado_ultimaDeteccao_idx" ON "SaudeAchado"("ultimaDeteccao");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitacaoDocumento_chaveIdempotencia_key" ON "SolicitacaoDocumento"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "SolicitacaoDocumento_documentoId_createdAt_idx" ON "SolicitacaoDocumento"("documentoId", "createdAt");

-- CreateIndex
CREATE INDEX "SolicitacaoDocumento_processoId_idx" ON "SolicitacaoDocumento"("processoId");

-- CreateIndex
CREATE INDEX "SolicitacaoDocumento_stepInstanceId_idx" ON "SolicitacaoDocumento"("stepInstanceId");

-- CreateIndex
CREATE INDEX "SolicitacaoDocumento_tarefaId_idx" ON "SolicitacaoDocumento"("tarefaId");

-- CreateIndex
CREATE INDEX "SolicitacaoDocumento_status_idx" ON "SolicitacaoDocumento"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoArquivo_substituiId_key" ON "DocumentoArquivo"("substituiId");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_documentoId_createdAt_idx" ON "DocumentoArquivo"("documentoId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_stepInstanceId_idx" ON "DocumentoArquivo"("stepInstanceId");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_solicitacaoId_idx" ON "DocumentoArquivo"("solicitacaoId");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_protocoloId_idx" ON "DocumentoArquivo"("protocoloId");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_documentTypeId_idx" ON "DocumentoArquivo"("documentTypeId");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_tipo_idx" ON "DocumentoArquivo"("tipo");

-- CreateIndex
CREATE INDEX "DocumentoArquivo_vigente_idx" ON "DocumentoArquivo"("vigente");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoArquivo_documentoId_url_key" ON "DocumentoArquivo"("documentoId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "ExigenciaEvidenciaEtapa_chaveExigencia_key" ON "ExigenciaEvidenciaEtapa"("chaveExigencia");

-- CreateIndex
CREATE INDEX "ExigenciaEvidenciaEtapa_stepKey_idx" ON "ExigenciaEvidenciaEtapa"("stepKey");

-- CreateIndex
CREATE INDEX "ExigenciaEvidenciaEtapa_evidenciaTipoId_idx" ON "ExigenciaEvidenciaEtapa"("evidenciaTipoId");

-- CreateIndex
CREATE INDEX "ExigenciaEvidenciaEtapa_documentoTipoId_idx" ON "ExigenciaEvidenciaEtapa"("documentoTipoId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoObservacao_chaveIdempotencia_key" ON "DocumentoObservacao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DocumentoObservacao_documentoId_createdAt_idx" ON "DocumentoObservacao"("documentoId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentoObservacao_stepInstanceId_idx" ON "DocumentoObservacao"("stepInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDocumental_codigo_key" ON "ModeloDocumental"("codigo");

-- CreateIndex
CREATE INDEX "ModeloDocumental_documentTypeId_idx" ON "ModeloDocumental"("documentTypeId");

-- CreateIndex
CREATE INDEX "ModeloDocumental_categoria_idx" ON "ModeloDocumental"("categoria");

-- CreateIndex
CREATE INDEX "ModeloDocumental_ativo_idx" ON "ModeloDocumental"("ativo");

-- CreateIndex
CREATE INDEX "ModeloDocumentalVersao_modeloId_status_idx" ON "ModeloDocumentalVersao"("modeloId", "status");

-- CreateIndex
CREATE INDEX "ModeloDocumentalVersao_checksum_idx" ON "ModeloDocumentalVersao"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDocumentalVersao_modeloId_numero_key" ON "ModeloDocumentalVersao"("modeloId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGerado_chaveIdentidade_key" ON "DocumentoGerado"("chaveIdentidade");

-- CreateIndex
CREATE INDEX "DocumentoGerado_contratanteId_idx" ON "DocumentoGerado"("contratanteId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_requerenteId_idx" ON "DocumentoGerado"("requerenteId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_pessoaId_idx" ON "DocumentoGerado"("pessoaId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_processoId_idx" ON "DocumentoGerado"("processoId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_documentTypeId_idx" ON "DocumentoGerado"("documentTypeId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_documentoId_idx" ON "DocumentoGerado"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_substituidaPorId_key" ON "DocumentoGeradoVersao"("substituidaPorId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_chaveIdempotencia_key" ON "DocumentoGeradoVersao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DocumentoGeradoVersao_modeloVersaoId_idx" ON "DocumentoGeradoVersao"("modeloVersaoId");

-- CreateIndex
CREATE INDEX "DocumentoGeradoVersao_status_idx" ON "DocumentoGeradoVersao"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_documentoGeradoId_numero_key" ON "DocumentoGeradoVersao"("documentoGeradoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "PlanilhaDocumentalColuna_configId_key" ON "PlanilhaDocumentalColuna"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanilhaDocumentalColuna_tipoDocumentoId_key" ON "PlanilhaDocumentalColuna"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "PlanilhaDocumentalColuna_ativa_posicao_idx" ON "PlanilhaDocumentalColuna"("ativa", "posicao");

-- CreateIndex
CREATE INDEX "PlanilhaDocumentalColuna_estrategia_idx" ON "PlanilhaDocumentalColuna"("estrategia");

-- CreateIndex
CREATE INDEX "PlanilhaCelulaOverride_processoId_idx" ON "PlanilhaCelulaOverride"("processoId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanilhaCelulaOverride_processoId_pessoaId_tipoDocumentoId__key" ON "PlanilhaCelulaOverride"("processoId", "pessoaId", "tipoDocumentoId", "colunaId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacaoOperacional_chaveIdempotencia_key" ON "NotificacaoOperacional"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "NotificacaoOperacional_destinatarioId_lidaEm_idx" ON "NotificacaoOperacional"("destinatarioId", "lidaEm");

-- CreateIndex
CREATE INDEX "NotificacaoOperacional_tarefaId_idx" ON "NotificacaoOperacional"("tarefaId");

-- CreateIndex
CREATE INDEX "TarefaDependencia_dependeDeId_idx" ON "TarefaDependencia"("dependeDeId");

-- CreateIndex
CREATE UNIQUE INDEX "TarefaDependencia_tarefaId_dependeDeId_key" ON "TarefaDependencia"("tarefaId", "dependeDeId");

-- CreateIndex
CREATE INDEX "AptidaoOperacional_perfilOperacionalId_idx" ON "AptidaoOperacional"("perfilOperacionalId");

-- CreateIndex
CREATE UNIQUE INDEX "AptidaoOperacional_usuarioId_perfilOperacionalId_key" ON "AptidaoOperacional"("usuarioId", "perfilOperacionalId");

-- CreateIndex
CREATE INDEX "IndisponibilidadeOperacional_usuarioId_inicio_idx" ON "IndisponibilidadeOperacional"("usuarioId", "inicio");

-- CreateIndex
CREATE INDEX "IndisponibilidadeOperacional_fim_idx" ON "IndisponibilidadeOperacional"("fim");

-- CreateIndex
CREATE UNIQUE INDEX "CapacidadeOperacional_usuarioId_key" ON "CapacidadeOperacional"("usuarioId");

-- CreateIndex
CREATE INDEX "_ReciboPagamento_B_index" ON "_ReciboPagamento"("B");

-- CreateIndex
CREATE INDEX "_ServicoProdutoItens_B_index" ON "_ServicoProdutoItens"("B");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "Perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pessoa" ADD CONSTRAINT "Pessoa_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pessoa" ADD CONSTRAINT "Pessoa_maeId_fkey" FOREIGN KEY ("maeId") REFERENCES "Pessoa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Pessoa" ADD CONSTRAINT "Pessoa_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "Pessoa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Uniao" ADD CONSTRAINT "Uniao_pessoa1Id_fkey" FOREIGN KEY ("pessoa1Id") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Uniao" ADD CONSTRAINT "Uniao_pessoa2Id_fkey" FOREIGN KEY ("pessoa2Id") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arvore" ADD CONSTRAINT "Arvore_pessoaPrincipalId_fkey" FOREIGN KEY ("pessoaPrincipalId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Arvore" ADD CONSTRAINT "Arvore_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "Familia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_derivadoDeId_fkey" FOREIGN KEY ("derivadoDeId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "Familia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_regularizacaoConcluidaPorId_fkey" FOREIGN KEY ("regularizacaoConcluidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_tipoProcessoMotorId_fkey" FOREIGN KEY ("tipoProcessoMotorId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_enquadramentoLegalId_fkey" FOREIGN KEY ("enquadramentoLegalId") REFERENCES "EnquadramentoLegal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessoContratante" ADD CONSTRAINT "ProcessoContratante_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessoContratante" ADD CONSTRAINT "ProcessoContratante_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_workflowStepInstanceId_fkey" FOREIGN KEY ("workflowStepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_previousTarefaId_fkey" FOREIGN KEY ("previousTarefaId") REFERENCES "Tarefa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaHistorico" ADD CONSTRAINT "TarefaHistorico_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaHistorico" ADD CONSTRAINT "TarefaHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessoRequerente" ADD CONSTRAINT "ProcessoRequerente_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessoRequerente" ADD CONSTRAINT "ProcessoRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contratante" ADD CONSTRAINT "Contratante_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requerente" ADD CONSTRAINT "Requerente_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocoloRequerente" ADD CONSTRAINT "ProtocoloRequerente_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocoloRequerente" ADD CONSTRAINT "ProtocoloRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocoloExigencia" ADD CONSTRAINT "ProtocoloExigencia_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocoloDocumento" ADD CONSTRAINT "ProtocoloDocumento_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocoloDocumento" ADD CONSTRAINT "ProtocoloDocumento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformacaoItalia" ADD CONSTRAINT "InformacaoItalia_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnexoInformacaoItalia" ADD CONSTRAINT "AnexoInformacaoItalia_informacaoItaliaId_fkey" FOREIGN KEY ("informacaoItaliaId") REFERENCES "InformacaoItalia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnexoProcesso" ADD CONSTRAINT "AnexoProcesso_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnexoContratante" ADD CONSTRAINT "AnexoContratante_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnexoRequerente" ADD CONSTRAINT "AnexoRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnexoProtocolo" ADD CONSTRAINT "AnexoProtocolo_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAuditoria" ADD CONSTRAINT "LogAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoFatura" ADD CONSTRAINT "PagamentoFatura_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoDestinatario" ADD CONSTRAINT "PagamentoDestinatario_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "PagamentoFatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoDestinatario" ADD CONSTRAINT "PagamentoDestinatario_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoServico" ADD CONSTRAINT "TipoServico_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoServico" ADD CONSTRAINT "TipoServico_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "TipoServico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaBancaria" ADD CONSTRAINT "ContaBancaria_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Banco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_contaPagarId_fkey" FOREIGN KEY ("contaPagarId") REFERENCES "ContaPagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaturaDestinatario" ADD CONSTRAINT "FaturaDestinatario_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaturaDestinatario" ADD CONSTRAINT "FaturaDestinatario_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parcela" ADD CONSTRAINT "Parcela_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteAuth" ADD CONSTRAINT "ClienteAuth_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteAuth" ADD CONSTRAINT "ClienteAuth_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositivoPush" ADD CONSTRAINT "DispositivoPush_clienteAuthId_fkey" FOREIGN KEY ("clienteAuthId") REFERENCES "ClienteAuth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_clienteAuthId_fkey" FOREIGN KEY ("clienteAuthId") REFERENCES "ClienteAuth"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recibo" ADD CONSTRAINT "Recibo_emitidoPorId_fkey" FOREIGN KEY ("emitidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recibo" ADD CONSTRAINT "Recibo_pagadorContratanteId_fkey" FOREIGN KEY ("pagadorContratanteId") REFERENCES "Contratante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recibo" ADD CONSTRAINT "Recibo_pagadorRequerenteId_fkey" FOREIGN KEY ("pagadorRequerenteId") REFERENCES "Requerente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recibo" ADD CONSTRAINT "Recibo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterRecibo" ADD CONSTRAINT "CounterRecibo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutroCusto" ADD CONSTRAINT "OutroCusto_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoOutroCusto" ADD CONSTRAINT "PagamentoOutroCusto_outroCustoId_fkey" FOREIGN KEY ("outroCustoId") REFERENCES "OutroCusto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "TipoServico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_estornoDeId_fkey" FOREIGN KEY ("estornoDeId") REFERENCES "Receita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receita" ADD CONSTRAINT "Receita_condicaoPagamentoId_fkey" FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "TipoServico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_estornoDeId_fkey" FOREIGN KEY ("estornoDeId") REFERENCES "Custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Custo" ADD CONSTRAINT "Custo_condicaoPagamentoId_fkey" FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaFinanceira" ADD CONSTRAINT "ParcelaFinanceira_custoId_fkey" FOREIGN KEY ("custoId") REFERENCES "Custo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaFinanceira" ADD CONSTRAINT "ParcelaFinanceira_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaFinanceira" ADD CONSTRAINT "ParcelaFinanceira_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceitaRequerente" ADD CONSTRAINT "ReceitaRequerente_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceitaRequerente" ADD CONSTRAINT "ReceitaRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceitaDocumento" ADD CONSTRAINT "ReceitaDocumento_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoFinanceiro" ADD CONSTRAINT "EventoFinanceiro_custoId_fkey" FOREIGN KEY ("custoId") REFERENCES "Custo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoFinanceiro" ADD CONSTRAINT "EventoFinanceiro_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoFinanceiro" ADD CONSTRAINT "EventoFinanceiro_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoFinanceiro" ADD CONSTRAINT "EventoFinanceiro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaliseDocumental" ADD CONSTRAINT "AnaliseDocumental_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Divergencia" ADD CONSTRAINT "Divergencia_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "AnaliseDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaTraducao" ADD CONSTRAINT "PastaTraducao_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaTraducaoDocumento" ADD CONSTRAINT "PastaTraducaoDocumento_pastaTraducaoId_fkey" FOREIGN KEY ("pastaTraducaoId") REFERENCES "PastaTraducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaApostilamento" ADD CONSTRAINT "PastaApostilamento_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaApostilamentoDocumento" ADD CONSTRAINT "PastaApostilamentoDocumento_pastaApostilamentoId_fkey" FOREIGN KEY ("pastaApostilamentoId") REFERENCES "PastaApostilamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaseFinal" ADD CONSTRAINT "FaseFinal_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacoteDivergencia" ADD CONSTRAINT "RetificacaoPacoteDivergencia_pacoteId_fkey" FOREIGN KEY ("pacoteId") REFERENCES "RetificacaoPacote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetificacaoPacoteDivergencia" ADD CONSTRAINT "RetificacaoPacoteDivergencia_divergenciaId_fkey" FOREIGN KEY ("divergenciaId") REFERENCES "Divergencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProfissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroProfissional" ADD CONSTRAINT "RegistroProfissional_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroProfissional" ADD CONSTRAINT "RegistroProfissional_orgaoDeClasseId_fkey" FOREIGN KEY ("orgaoDeClasseId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissaoRetificada" ADD CONSTRAINT "EmissaoRetificada_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarteiraRecebimento" ADD CONSTRAINT "CarteiraRecebimento_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_regraComissaoId_fkey" FOREIGN KEY ("regraComissaoId") REFERENCES "RegraComissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_honorarioId_fkey" FOREIGN KEY ("honorarioId") REFERENCES "Honorario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_fornecedorPadraoId_fkey" FOREIGN KEY ("fornecedorPadraoId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_condicaoPagamentoId_fkey" FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_configuracaoFinanceiraItemId_fkey" FOREIGN KEY ("configuracaoFinanceiraItemId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendenciaFinanceira" ADD CONSTRAINT "PendenciaFinanceira_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamento" ADD CONSTRAINT "CondicaoPagamento_carteiraId_fkey" FOREIGN KEY ("carteiraId") REFERENCES "CarteiraRecebimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamento" ADD CONSTRAINT "CondicaoPagamento_substituiId_fkey" FOREIGN KEY ("substituiId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoForma" ADD CONSTRAINT "CondicaoPagamentoForma_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoForma" ADD CONSTRAINT "CondicaoPagamentoForma_formaId_fkey" FOREIGN KEY ("formaId") REFERENCES "FormaPagamentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoTaxa" ADD CONSTRAINT "CondicaoPagamentoTaxa_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoTaxa" ADD CONSTRAINT "CondicaoPagamentoTaxa_taxaId_fkey" FOREIGN KEY ("taxaId") REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoMoeda" ADD CONSTRAINT "CondicaoPagamentoMoeda_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoMoeda" ADD CONSTRAINT "CondicaoPagamentoMoeda_moedaId_fkey" FOREIGN KEY ("moedaId") REFERENCES "MoedaCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoPais" ADD CONSTRAINT "CondicaoPagamentoPais_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoPais" ADD CONSTRAINT "CondicaoPagamentoPais_paisId_fkey" FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoModalidade" ADD CONSTRAINT "CondicaoPagamentoModalidade_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoModalidade" ADD CONSTRAINT "CondicaoPagamentoModalidade_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoServico" ADD CONSTRAINT "CondicaoPagamentoServico_condicaoId_fkey" FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CondicaoPagamentoServico" ADD CONSTRAINT "CondicaoPagamentoServico_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "ServicoProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicoProduto" ADD CONSTRAINT "ServicoProduto_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicoProdutoPais" ADD CONSTRAINT "ServicoProdutoPais_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "ServicoProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicoProdutoPais" ADD CONSTRAINT "ServicoProdutoPais_paisId_fkey" FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaParcelamento" ADD CONSTRAINT "TaxaParcelamento_taxaId_fkey" FOREIGN KEY ("taxaId") REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaPagamentoMoeda" ADD CONSTRAINT "TaxaPagamentoMoeda_taxaId_fkey" FOREIGN KEY ("taxaId") REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaPagamentoMoeda" ADD CONSTRAINT "TaxaPagamentoMoeda_moedaId_fkey" FOREIGN KEY ("moedaId") REFERENCES "MoedaCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaPagamentoPais" ADD CONSTRAINT "TaxaPagamentoPais_taxaId_fkey" FOREIGN KEY ("taxaId") REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaPagamentoPais" ADD CONSTRAINT "TaxaPagamentoPais_paisId_fkey" FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaseNaturezaPermitida" ADD CONSTRAINT "FaseNaturezaPermitida_catalogoFaseId_fkey" FOREIGN KEY ("catalogoFaseId") REFERENCES "CatalogoFase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaseNaturezaPermitida" ADD CONSTRAINT "FaseNaturezaPermitida_naturezaOperacionalId_fkey" FOREIGN KEY ("naturezaOperacionalId") REFERENCES "NaturezaOperacionalDocumento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroWorkflow" ADD CONSTRAINT "MacroWorkflow_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaseMacro" ADD CONSTRAINT "FaseMacro_macroWorkflowId_fkey" FOREIGN KEY ("macroWorkflowId") REFERENCES "MacroWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseInternalWorkflow" ADD CONSTRAINT "PhaseInternalWorkflow_familiaDocumentalId_fkey" FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseInternalWorkflowVersao" ADD CONSTRAINT "PhaseInternalWorkflowVersao_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseInternalWorkflowStep" ADD CONSTRAINT "PhaseInternalWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepAction" ADD CONSTRAINT "StepAction_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepAction" ADD CONSTRAINT "StepAction_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepField" ADD CONSTRAINT "StepField_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepField" ADD CONSTRAINT "StepField_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepFieldOption" ADD CONSTRAINT "StepFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "StepField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepChannel" ADD CONSTRAINT "StepChannel_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepChannel" ADD CONSTRAINT "StepChannel_canalId_fkey" FOREIGN KEY ("canalId") REFERENCES "CanalOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_evidenciaTipoId_fkey" FOREIGN KEY ("evidenciaTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepChecklistItem" ADD CONSTRAINT "StepChecklistItem_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepChecklistItem" ADD CONSTRAINT "StepChecklistItem_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizacaoCanal" ADD CONSTRAINT "OrganizacaoCanal_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizacaoCanal" ADD CONSTRAINT "OrganizacaoCanal_canalId_fkey" FOREIGN KEY ("canalId") REFERENCES "CanalOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_categoriaDocumentalId_fkey" FOREIGN KEY ("categoriaDocumentalId") REFERENCES "CategoriaDocumental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_familiaDocumentalId_fkey" FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_naturezaOperacionalId_fkey" FOREIGN KEY ("naturezaOperacionalId") REFERENCES "NaturezaOperacionalDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_perfilOperacionalId_fkey" FOREIGN KEY ("perfilOperacionalId") REFERENCES "PerfilOperacionalDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilOperacionalDocumento" ADD CONSTRAINT "PerfilOperacionalDocumento_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilOperacionalDocumento" ADD CONSTRAINT "PerfilOperacionalDocumento_familiaDocumentalId_fkey" FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorArtefato" ADD CONSTRAINT "MotorArtefato_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_custoConfigId_fkey" FOREIGN KEY ("custoConfigId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_receitaConfigId_fkey" FOREIGN KEY ("receitaConfigId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCatalogo" ADD CONSTRAINT "ItemCatalogo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_supersedePorId_fkey" FOREIGN KEY ("supersedePorId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumentalEvento" ADD CONSTRAINT "NecessidadeDocumentalEvento_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_previousInstanceId_fkey" FOREIGN KEY ("previousInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_regularizadoPorId_fkey" FOREIGN KEY ("regularizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_retificacaoPacoteId_fkey" FOREIGN KEY ("retificacaoPacoteId") REFERENCES "RetificacaoPacote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_previousStepInstanceId_fkey" FOREIGN KEY ("previousStepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObrigacaoEconomica" ADD CONSTRAINT "ObrigacaoEconomica_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelaPagavel" ADD CONSTRAINT "ParcelaPagavel_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepasseCusto" ADD CONSTRAINT "RepasseCusto_custoObrigacaoId_fkey" FOREIGN KEY ("custoObrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerFinanceiro" ADD CONSTRAINT "LedgerFinanceiro_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "LedgerFinanceiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaFinanceira" ADD CONSTRAINT "OcorrenciaFinanceira_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacaoFinanceira" ADD CONSTRAINT "AplicacaoFinanceira_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "OcorrenciaFinanceira"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistribuicaoEconomica" ADD CONSTRAINT "DistribuicaoEconomica_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipacaoEconomica" ADD CONSTRAINT "ParticipacaoEconomica_distribuicaoId_fkey" FOREIGN KEY ("distribuicaoId") REFERENCES "DistribuicaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoProjecao" ADD CONSTRAINT "SaldoProjecao_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModalidadeLegal" ADD CONSTRAINT "ModalidadeLegal_paisId_fkey" FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquadramentoLegal" ADD CONSTRAINT "EnquadramentoLegal_modalidadeLegalId_fkey" FOREIGN KEY ("modalidadeLegalId") REFERENCES "ModalidadeLegal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizacaoCategoria" ADD CONSTRAINT "OrganizacaoCategoria_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizacaoCategoria" ADD CONSTRAINT "OrganizacaoCategoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaOrganizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoUsuarioMembro" ADD CONSTRAINT "GrupoUsuarioMembro_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "GrupoUsuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoUsuarioMembro" ADD CONSTRAINT "GrupoUsuarioMembro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_evidenciaNecessidadeId_fkey" FOREIGN KEY ("evidenciaNecessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_supersedidoPorId_fkey" FOREIGN KEY ("supersedidoPorId") REFERENCES "NomePessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_pessoaResultanteId_fkey" FOREIGN KEY ("pessoaResultanteId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EtapaExecucaoRegistral" ADD CONSTRAINT "EtapaExecucaoRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_pessoaResolvidaId_fkey" FOREIGN KEY ("pessoaResolvidaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_supersedidoPorId_fkey" FOREIGN KEY ("supersedidoPorId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "OcorrenciaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_fatoId_fkey" FOREIGN KEY ("fatoId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "OcorrenciaDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_decisaoDedupId_fkey" FOREIGN KEY ("decisaoDedupId") REFERENCES "DecisaoDeduplicacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_fatoId_fkey" FOREIGN KEY ("fatoId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_revertidaPorId_fkey" FOREIGN KEY ("revertidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactoAplicacaoRegistral" ADD CONSTRAINT "ImpactoAplicacaoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_conflitoId_fkey" FOREIGN KEY ("conflitoId") REFERENCES "ConflitoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersaoGenealogica" ADD CONSTRAINT "VersaoGenealogica_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersaoGenealogica" ADD CONSTRAINT "VersaoGenealogica_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaudeAchado" ADD CONSTRAINT "SaudeAchado_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "SaudeExecucao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_substituiId_fkey" FOREIGN KEY ("substituiId") REFERENCES "DocumentoArquivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExigenciaEvidenciaEtapa" ADD CONSTRAINT "ExigenciaEvidenciaEtapa_documentoTipoId_fkey" FOREIGN KEY ("documentoTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExigenciaEvidenciaEtapa" ADD CONSTRAINT "ExigenciaEvidenciaEtapa_evidenciaTipoId_fkey" FOREIGN KEY ("evidenciaTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoObservacao" ADD CONSTRAINT "DocumentoObservacao_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoObservacao" ADD CONSTRAINT "DocumentoObservacao_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumental" ADD CONSTRAINT "ModeloDocumental_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumental" ADD CONSTRAINT "ModeloDocumental_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_publicadoPorId_fkey" FOREIGN KEY ("publicadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_revogadoPorId_fkey" FOREIGN KEY ("revogadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDocumental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "ServicoProduto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_documentoGeradoId_fkey" FOREIGN KEY ("documentoGeradoId") REFERENCES "DocumentoGerado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_modeloVersaoId_fkey" FOREIGN KEY ("modeloVersaoId") REFERENCES "ModeloDocumentalVersao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_geradoPorId_fkey" FOREIGN KEY ("geradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_substituidaPorId_fkey" FOREIGN KEY ("substituidaPorId") REFERENCES "DocumentoGeradoVersao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_invalidadaPorId_fkey" FOREIGN KEY ("invalidadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaDocumentalColuna" ADD CONSTRAINT "PlanilhaDocumentalColuna_categoriaItemId_fkey" FOREIGN KEY ("categoriaItemId") REFERENCES "CategoriaServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaDocumentalColuna" ADD CONSTRAINT "PlanilhaDocumentalColuna_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaDocumentalColuna" ADD CONSTRAINT "PlanilhaDocumentalColuna_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaCelulaOverride" ADD CONSTRAINT "PlanilhaCelulaOverride_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaCelulaOverride" ADD CONSTRAINT "PlanilhaCelulaOverride_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaCelulaOverride" ADD CONSTRAINT "PlanilhaCelulaOverride_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaCelulaOverride" ADD CONSTRAINT "PlanilhaCelulaOverride_colunaId_fkey" FOREIGN KEY ("colunaId") REFERENCES "PlanilhaDocumentalColuna"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanilhaCelulaOverride" ADD CONSTRAINT "PlanilhaCelulaOverride_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoOperacional" ADD CONSTRAINT "NotificacaoOperacional_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoOperacional" ADD CONSTRAINT "NotificacaoOperacional_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaDependencia" ADD CONSTRAINT "TarefaDependencia_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaDependencia" ADD CONSTRAINT "TarefaDependencia_dependeDeId_fkey" FOREIGN KEY ("dependeDeId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AptidaoOperacional" ADD CONSTRAINT "AptidaoOperacional_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AptidaoOperacional" ADD CONSTRAINT "AptidaoOperacional_perfilOperacionalId_fkey" FOREIGN KEY ("perfilOperacionalId") REFERENCES "PerfilOperacionalDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndisponibilidadeOperacional" ADD CONSTRAINT "IndisponibilidadeOperacional_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndisponibilidadeOperacional" ADD CONSTRAINT "IndisponibilidadeOperacional_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacidadeOperacional" ADD CONSTRAINT "CapacidadeOperacional_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacidadeOperacional" ADD CONSTRAINT "CapacidadeOperacional_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReciboPagamento" ADD CONSTRAINT "_ReciboPagamento_A_fkey" FOREIGN KEY ("A") REFERENCES "PagamentoFatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReciboPagamento" ADD CONSTRAINT "_ReciboPagamento_B_fkey" FOREIGN KEY ("B") REFERENCES "Recibo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServicoProdutoItens" ADD CONSTRAINT "_ServicoProdutoItens_A_fkey" FOREIGN KEY ("A") REFERENCES "ProdutoFinanceiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServicoProdutoItens" ADD CONSTRAINT "_ServicoProdutoItens_B_fkey" FOREIGN KEY ("B") REFERENCES "ServicoProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- BLOCO MANUAL DO BASELINE — objetos que o Prisma NAO consegue expressar.
--
-- ESTE ARQUIVO E' A FONTE. E' mantido a mao e sobrevive a toda regeneracao:
-- `npm run baseline:gerar` monta baseline.sql = cabecalho + corpo gerado a
-- partir do schema.prisma + ESTE arquivo, nesta ordem. O gerador nunca le o
-- baseline.sql, so escreve — por isso nada aqui pode ser perdido.
--
-- NAO EDITE o baseline.sql para acrescentar coisa aqui: sera sobrescrito.
-- Acrescente AQUI.
--
-- A ORDEM IMPORTA: extensao -> funcao -> indices -> constraints. A exclusion
-- constraint depende das duas primeiras; invertendo, ela falha em banco virgem.
--
-- Como saber se algo novo precisa entrar aqui: aplique o baseline num banco
-- vazio e compare com producao (ver README.md, secao "Validar"). Tudo que
-- aparecer so em producao e' candidato.
-- ============================================================================

-- Requisito da exclusion constraint abaixo (operador = em tipos escalares sob gist).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Usada pela exclusion constraint; criada em 20260715143200_r17_vigencia_sem_sobreposicao.
CREATE OR REPLACE FUNCTION public.discovery_iso_to_date(txt text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN txt IS NULL OR txt = '' THEN NULL
    ELSE make_date(
      substring(txt FROM 1 FOR 4)::int,
      substring(txt FROM 6 FOR 2)::int,
      substring(txt FROM 9 FOR 2)::int
    )
  END
$function$;

-- unique PARCIAL — o Prisma nao expressa WHERE/COALESCE em @@unique.
CREATE UNIQUE INDEX "NomePessoa_um_principal_ativo" ON "NomePessoa" USING btree ("pessoaId") WHERE ((principal = true) AND (ativo = true));

-- unique PARCIAL — o Prisma nao expressa WHERE/COALESCE em @@unique.
CREATE UNIQUE INDEX "TabelaValor_config_contexto_ativo_key" ON "TabelaValor" USING btree ("configuracaoFinanceiraItemId", natureza, COALESCE("processoTipoId", ''::character varying), COALESCE("modalidadeId", '-1'::integer), COALESCE("fornecedorId", '-1'::integer), moeda, "modoCalculo", COALESCE(unidade, ''::character varying), COALESCE("quantidadeMinima", '-1'::numeric), COALESCE("quantidadeMaxima", '-1'::numeric), prioridade, COALESCE("vigenciaInicio", ''::character varying), COALESCE("vigenciaFim", ''::character varying)) WHERE ((arquivado = false) AND ("configuracaoFinanceiraItemId" IS NOT NULL));

-- EXCLUSION CONSTRAINT — impede vigencias sobrepostas. Sem equivalente no Prisma.
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_vigencia_sem_sobreposicao_excl" EXCLUDE USING gist ("configuracaoFinanceiraItemId" WITH =, natureza WITH =, COALESCE("processoTipoId", ''::character varying) WITH =, COALESCE("modalidadeId", '-1'::integer) WITH =, COALESCE("fornecedorId", '-1'::integer) WITH =, moeda WITH =, COALESCE(unidade, ''::character varying) WITH =, COALESCE("quantidadeMinima", '-1'::numeric) WITH =, COALESCE("quantidadeMaxima", '-1'::numeric) WITH =, prioridade WITH =, daterange(discovery_iso_to_date(("vigenciaInicio")::text), discovery_iso_to_date(("vigenciaFim")::text), '[]'::text) WITH &&) WHERE (((arquivado = false) AND ("configuracaoFinanceiraItemId" IS NOT NULL)));

-- O Prisma gera @@unique sempre como NULLS DISTINCT. A migration de origem
-- (20260113180000_add_tipo_registro_custo) criou este unique com NULLS NOT
-- DISTINCT de proposito: tipoRegistro e' nullable, e so pode existir UMA linha
-- com tipoRegistro nulo por (processoId, pessoaId, tipoServicoId). Sem isto o
-- baseline fica MAIS FRACO que producao. Substitui o indice gerado acima.
ALTER TABLE "CustoPessoa" DROP CONSTRAINT IF EXISTS "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key";
DROP INDEX IF EXISTS "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key";
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key"
  UNIQUE NULLS NOT DISTINCT ("processoId", "pessoaId", "tipoServicoId", "tipoRegistro");
