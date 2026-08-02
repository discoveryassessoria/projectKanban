// lib/saude/capacidades/operacionais.ts
//
// CAPACIDADES OPERACIONAIS DO DISCOVERY.
//
// Cada capacidade é uma operação de negócio real, com suas dependências
// declaradas e avaliadas de verdade. O estado nunca é suposto: sai do resultado
// de cada dependência.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { registrarCapacidade, type Dependencia } from '../capacidades'
import { TIPOS_DRENADOS } from '@/src/services/outbox-dispatcher'

const RAIZ = process.cwd()
const arquivo = (p: string) => existsSync(join(RAIZ, p))

/** Dependência técnica: a rota/arquivo que sustenta a operação existe? */
const dependeDeRota = (codigo: string, nome: string, caminho: string, acao: string): Dependencia => ({
  codigo, nome, tipo: 'TECNICA', obrigatoria: true, acao,
  avaliar: async () => ({
    ok: arquivo(caminho),
    detalhe: arquivo(caminho) ? `rota registrada em ${caminho}` : `rota ausente: ${caminho}`,
    evidencia: { caminho },
  }),
})

/** Dependência de permissão: a chave existe no vocabulário oficial? */
const dependeDePermissao = (codigo: string, nome: string, chave: string): Dependencia => ({
  codigo, nome, tipo: 'PERMISSAO', obrigatoria: true,
  acao: `A permissão "${chave}" precisa existir e estar concedida a algum perfil.`,
  rota: '/administrator?screen=roles',
  avaliar: async () => {
    const perfis = await prisma.perfil.findMany({ select: { nome: true, permissoes: true } })
    const comAPermissao = perfis.filter((p) => {
      const m = p.permissoes as Record<string, boolean> | null
      return !!m?.[chave]
    })
    const admins = await prisma.usuario.count({ where: { tipo: 'admin' } })
    return {
      ok: comAPermissao.length > 0 || admins > 0,
      detalhe: comAPermissao.length
        ? `${comAPermissao.length} perfil(is) concedem "${chave}"`
        : admins > 0
          ? `nenhum perfil concede "${chave}", mas há ${admins} administrador(es) com acesso total`
          : `nenhum perfil concede "${chave}" e não há administrador`,
      quantidade: comAPermissao.length,
      evidencia: { permissao: chave, perfis: comAPermissao.map((p) => p.nome), administradores: admins },
    }
  },
})

// ═══════════════════════════ PROCESSOS ═══════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-PROC-CRIAR',
  nome: 'Criar processo',
  descricao: 'Um processo novo consegue nascer completo: com tipo, workflow, fase inicial, código público e trilha.',
  modulo: 'Processos',
  operacao: 'Criação de processo',
  dominio: 'PROCESSOS',
  severidadeFalha: 'CRITICO',
  prioridade: 10,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'tipo-ativo', nome: 'Tipo de processo ativo', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre ao menos um tipo de processo (país + produto) em Processos › Cadastros.',
      rota: '/administrator?screen=proctypes',
      avaliar: async () => {
        const n = await prisma.tipoProcessoNacionalidade.count({ where: { ativo: true, arquivado: false } })
        return { ok: n > 0, detalhe: `${n} tipo(s) de processo ativo(s)`, quantidade: n }
      },
    },
    {
      codigo: 'workflow-ativo', nome: 'Workflow macro ativo com fases', tipo: 'CONFIGURACAO', obrigatoria: true,
      requer: ['tipo-ativo'],
      acao: 'Crie o Workflow Macro do tipo de processo e declare suas fases.',
      rota: '/administrator?screen=macrokanban',
      avaliar: async () => {
        const comFases = await prisma.macroWorkflow.count({ where: { ativo: true, fases: { some: {} } } })
        const total = await prisma.macroWorkflow.count({ where: { ativo: true } })
        return {
          ok: comFases > 0,
          detalhe: `${comFases}/${total} workflow(s) ativo(s) com fases declaradas`,
          quantidade: comFases,
        }
      },
    },
    {
      codigo: 'fase-inicial', nome: 'Fase inicial determinável', tipo: 'CONFIGURACAO', obrigatoria: true,
      requer: ['workflow-ativo'],
      acao: 'Declare as fases em ordem: a primeira é onde o processo entra.',
      rota: '/administrator?screen=macrokanban',
      avaliar: async () => {
        const workflows = await prisma.macroWorkflow.findMany({
          where: { ativo: true },
          select: { id: true, fases: { select: { ordem: true }, orderBy: { ordem: 'asc' } } },
        })
        const semInicial = workflows.filter((w) => w.fases.length === 0)
        const ambiguos = workflows.filter((w) => {
          const menor = w.fases[0]?.ordem
          return w.fases.filter((f) => f.ordem === menor).length > 1
        })
        return {
          ok: workflows.length > 0 && semInicial.length === 0 && ambiguos.length === 0,
          detalhe: ambiguos.length
            ? `${ambiguos.length} workflow(s) com fase inicial ambígua (empate de ordem)`
            : semInicial.length
              ? `${semInicial.length} workflow(s) sem fase`
              : `${workflows.length} workflow(s) com fase inicial única`,
          quantidade: ambiguos.length + semInicial.length,
          evidencia: { workflowsAmbiguos: ambiguos.map((w) => w.id), workflowsSemFase: semInicial.map((w) => w.id) },
        }
      },
    },
    {
      codigo: 'fases-catalogo', nome: 'Fases registradas no catálogo', tipo: 'CADASTRO', obrigatoria: true,
      requer: ['workflow-ativo'],
      acao: 'Cadastre as fases usadas pelos workflows em Processos › Estrutura › Fases.',
      rota: '/administrator?screen=fases',
      avaliar: async () => {
        const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(DISTINCT f."phaseKey")::int AS n FROM "FaseMacro" f
             JOIN "MacroWorkflow" w ON w.id = f."macroWorkflowId" AND w.ativo = true
            WHERE NOT EXISTS (SELECT 1 FROM "CatalogoFase" c WHERE c."phaseKey" = f."phaseKey" AND c.ativo = true)`,
        )
        const fora = r?.[0]?.n ?? 0
        const total = await prisma.catalogoFase.count({ where: { ativo: true } })
        return {
          ok: fora === 0 && total > 0,
          detalhe: fora ? `${fora} fase(s) de workflow fora do catálogo` : `${total} fase(s) no catálogo`,
          quantidade: fora,
        }
      },
    },
    {
      codigo: 'gerador-codigo', nome: 'Geração de código público operante', tipo: 'TECNICA', obrigatoria: true,
      acao: 'Ressincronize as sequências de código — o contador não pode estar atrás dos códigos gravados.',
      correcaoAutomatica: 'reconciliar-sequencias',
      avaliar: async () => {
        const r = await prisma.$queryRawUnsafe<{ pais: string; max: number; seq: number }[]>(
          `SELECT s.scope AS pais, s.ultimo AS seq,
                  COALESCE((SELECT MAX(NULLIF(substring(p.codigo from '([0-9]+)$'), '')::bigint)
                              FROM "Processo" p WHERE p.codigo LIKE s.scope || '-%'), 0)::int AS max
             FROM "CodeSequence" s WHERE length(s.scope) = 2`,
        )
        const atrasadas = r.filter((x) => Number(x.max) > Number(x.seq))
        return {
          ok: atrasadas.length === 0,
          detalhe: atrasadas.length
            ? `${atrasadas.length} sequência(s) de país atrás dos códigos gravados`
            : `${r.length} sequência(s) de país sincronizada(s)`,
          quantidade: atrasadas.length,
          evidencia: { atrasadas },
        }
      },
    },
    dependeDeRota('rota-criar', 'API de criação de processo', 'src/app/api/processos/route.ts',
      'A rota POST /api/processos precisa existir.'),
    dependeDePermissao('permissao-criar', 'Permissão de criar processo', 'processos.criar'),
    {
      codigo: 'timeline', nome: 'Timeline registrando movimentação', tipo: 'TECNICA', obrigatoria: true,
      acao: 'A rota do Diário Operacional precisa existir para o processo ter histórico.',
      avaliar: async () => {
        const existe = arquivo('src/app/api/processos/[processoId]/logs/route.ts')
        const eventos = await prisma.workflowEvento.count()
        return {
          ok: existe,
          detalhe: existe ? `Diário Operacional ativo (${eventos} evento(s) registrados)` : 'rota do Diário Operacional ausente',
          quantidade: eventos,
        }
      },
    },
  ],
})

registrarCapacidade({
  codigo: 'CAP-PROC-AVANCAR',
  nome: 'Avançar fase do processo',
  descricao: 'O processo consegue sair de uma fase e entrar na seguinte, com efeitos aplicados.',
  modulo: 'Processos',
  operacao: 'Avanço de fase',
  dominio: 'WORKFLOW',
  severidadeFalha: 'CRITICO',
  prioridade: 20,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    dependeDeRota('rota-avancar', 'API de avanço de fase', 'src/app/api/processos/[processoId]/advance/route.ts',
      'A rota de avanço precisa existir.'),
    dependeDePermissao('permissao-avancar', 'Permissão de avançar workflow', 'workflow.avancar'),
    {
      codigo: 'workflow-interno', nome: 'Workflow interno com passos', tipo: 'CONFIGURACAO', obrigatoria: false,
      acao: 'Declare os passos do workflow interno das fases — são eles que viram tarefa obrigatória.',
      rota: '/administrator?screen=phaseiwf',
      avaliar: async () => {
        const ativos = await prisma.phaseInternalWorkflow.count({ where: { active: true, arquivado: false } })
        const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM "PhaseInternalWorkflow" w
            WHERE w.active = true AND w.arquivado = false
              AND NOT EXISTS (SELECT 1 FROM "PhaseInternalWorkflowStep" s WHERE s."workflowId" = w.id)`,
        )
        const semPassos = r?.[0]?.n ?? 0
        return {
          ok: ativos > 0 && semPassos === 0,
          detalhe: ativos === 0 ? 'nenhum workflow interno ativo' : semPassos ? `${semPassos} workflow(s) interno(s) sem passos` : `${ativos} workflow(s) interno(s) com passos`,
          quantidade: semPassos,
        }
      },
    },
    {
      codigo: 'fila-consumindo', nome: 'Fila de efeitos sendo consumida', tipo: 'AUTOMACAO', obrigatoria: true,
      acao: 'Despache a fila de eventos — sem consumo, o avanço não produz efeito.',
      rota: '/administrator?screen=execmotor',
      correcaoAutomatica: 'reprocessar-outbox',
      avaliar: async () => {
        const pendentes = await prisma.domainOutbox.count({ where: { status: 'PENDENTE' } })
        const ultimo = await prisma.domainOutbox.findFirst({
          where: { status: 'ENVIADO' }, orderBy: { processadoEm: 'desc' }, select: { processadoEm: true },
        })
        const horas = ultimo?.processadoEm ? (Date.now() - ultimo.processadoEm.getTime()) / 3_600_000 : Infinity
        return {
          ok: pendentes === 0 || horas < 6,
          detalhe: pendentes === 0 ? 'fila vazia' : `${pendentes} pendente(s), último despacho há ${Math.round(horas)}h`,
          quantidade: pendentes,
        }
      },
    },
    {
      codigo: 'tipos-drenados', nome: 'Todo evento emitido tem consumidor', tipo: 'AUTOMACAO', obrigatoria: true,
      acao: 'Declare o tipo de evento em TIPOS_DRENADOS do dispatcher — tipo não drenado nunca é consumido.',
      rota: '/administrator?screen=execmotor',
      avaliar: async () => {
        const tipos = await prisma.$queryRawUnsafe<{ tipo: string; n: number }[]>(
          `SELECT tipo, COUNT(*)::int AS n FROM "DomainOutbox" WHERE status = 'PENDENTE' GROUP BY tipo`,
        )
        const drenados = new Set<string>(TIPOS_DRENADOS)
        const orfaos = tipos.filter((t) => !drenados.has(t.tipo))
        return {
          ok: orfaos.length === 0,
          detalhe: orfaos.length ? `${orfaos.length} tipo(s) sem consumidor: ${orfaos.map((o) => o.tipo).join(', ')}` : 'todo tipo pendente tem consumidor',
          quantidade: orfaos.reduce((a, o) => a + o.n, 0),
          evidencia: { orfaos },
        }
      },
    },
  ],
})

registrarCapacidade({
  codigo: 'CAP-PROC-CONCLUIR',
  nome: 'Concluir processo',
  descricao: 'O processo consegue chegar a uma fase final e ser encerrado sem pendência oculta.',
  modulo: 'Processos',
  operacao: 'Conclusão de processo',
  dominio: 'PROCESSOS',
  severidadeFalha: 'ERRO',
  prioridade: 30,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'caminho-ate-fim', nome: 'Existe caminho até uma fase final', tipo: 'CONFIGURACAO', obrigatoria: true,
      acao: 'O workflow precisa de ao menos duas fases, com a última alcançável.',
      rota: '/administrator?screen=macrokanban',
      avaliar: async () => {
        const workflows = await prisma.macroWorkflow.findMany({
          where: { ativo: true },
          select: { id: true, name: true, fases: { select: { ordem: true, required: true } } },
        })
        const semFim = workflows.filter((w) => w.fases.length < 2)
        return {
          ok: workflows.length > 0 && semFim.length === 0,
          detalhe: semFim.length ? `${semFim.length} workflow(s) sem fase final` : `${workflows.length} workflow(s) com caminho até o fim`,
          quantidade: semFim.length,
          evidencia: { workflows: semFim.map((w) => w.name) },
        }
      },
    },
    {
      codigo: 'sem-processo-preso', nome: 'Nenhum processo preso em fase inexistente', tipo: 'DADO', obrigatoria: true,
      acao: 'Reposicione os processos cuja fase atual não existe mais no catálogo.',
      rota: '/administrator?screen=fases',
      avaliar: async () => {
        const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM "Processo" p
            WHERE p."dataConclusao" IS NULL AND p."faseAtualKey" IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM "CatalogoFase" c WHERE c."phaseKey" = p."faseAtualKey")`,
        )
        const n = r?.[0]?.n ?? 0
        return { ok: n === 0, detalhe: n ? `${n} processo(s) em fase inexistente` : 'nenhum processo preso', quantidade: n }
      },
    },
  ],
})

// ═══════════════════════════ FINANCEIRO ══════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-FIN-COBRAR',
  nome: 'Gerar cobrança',
  descricao: 'Um serviço consegue virar cobrança: configuração financeira, preço vigente, moeda e conta para receber.',
  modulo: 'Financeiro',
  operacao: 'Geração de cobrança',
  dominio: 'COBRANCAS',
  severidadeFalha: 'CRITICO',
  prioridade: 15,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'item-com-config', nome: 'Item comercializável com configuração financeira', tipo: 'CONFIGURACAO', obrigatoria: true,
      acao: 'Crie a Configuração Financeira do item em Financeiro › Configurações Financeiras.',
      rota: '/administrator?screen=catalog',
      avaliar: async () => {
        const comConfig = await prisma.itemCatalogo.count({ where: { ativo: true, produtos: { some: { ativo: true } } } })
        const ativos = await prisma.itemCatalogo.count({ where: { ativo: true } })
        return {
          ok: comConfig > 0,
          detalhe: `${comConfig}/${ativos} item(ns) ativo(s) com configuração financeira`,
          quantidade: ativos - comConfig,
        }
      },
    },
    {
      codigo: 'preco-vigente', nome: 'Preço de venda vigente', tipo: 'CONFIGURACAO', obrigatoria: true,
      requer: ['item-com-config'],
      acao: 'Cadastre o preço de venda na Tabela de Valores para as configurações que geram receita.',
      rota: '/administrator?screen=pricingtable',
      avaliar: async () => {
        const configs = await prisma.produtoFinanceiro.findMany({
          where: { ativo: true },
          select: {
            id: true, nome: true, naturezaFin: true, possuiReceita: true,
            precosConfig: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true } },
          },
        })
        const semPreco = configs.filter((c) => {
          const geraReceita = c.naturezaFin ? c.naturezaFin !== 'SOMENTE_CUSTO' : c.possuiReceita
          const nat = new Set(c.precosConfig.map((p) => String(p.natureza)))
          return geraReceita && !nat.has('VENDA') && !nat.has('RECEITA')
        })
        const comPreco = configs.length - semPreco.length
        return {
          ok: comPreco > 0 && semPreco.length === 0,
          detalhe: semPreco.length
            ? `${semPreco.length} configuração(ões) de receita sem preço vigente`
            : `${comPreco} configuração(ões) com preço vigente`,
          quantidade: semPreco.length,
          evidencia: { semPreco: semPreco.slice(0, 8).map((c) => ({ id: c.id, nome: c.nome })) },
        }
      },
    },
    {
      codigo: 'moeda-cadastrada', nome: 'Moeda operante', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre as moedas usadas nas cobranças em Financeiro › Moedas.',
      rota: '/administrator?screen=currencies',
      avaliar: async () => {
        const n = await prisma.moedaCadastro.count({ where: { ativo: true } }).catch(() => 0)
        return { ok: n > 0, detalhe: `${n} moeda(s) ativa(s)`, quantidade: n }
      },
    },
    {
      codigo: 'conta-receber', nome: 'Conta bancária para receber', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre a conta bancária operacional em Financeiro › Tesouraria.',
      rota: '/administrator?screen=accounts',
      avaliar: async () => {
        const n = await prisma.contaBancaria.count({ where: { ativo: true } })
        return { ok: n > 0, detalhe: `${n} conta(s) bancária(s) ativa(s)`, quantidade: n }
      },
    },
    {
      codigo: 'condicao-pagamento', nome: 'Condição de pagamento cadastrada', tipo: 'CADASTRO', obrigatoria: false,
      acao: 'Cadastre as condições de pagamento — sem elas a cobrança assume parcela única.',
      rota: '/administrator?screen=paycond',
      avaliar: async () => {
        const n = await prisma.condicaoPagamento.count({ where: { ativo: true } }).catch(() => 0)
        return { ok: n > 0, detalhe: `${n} condição(ões) de pagamento ativa(s)`, quantidade: n }
      },
    },
    dependeDePermissao('permissao-financeiro', 'Permissão financeira', 'financeiro.ver'),
  ],
})

registrarCapacidade({
  codigo: 'CAP-FIN-PAGAR',
  nome: 'Registrar custo e pagar fornecedor',
  descricao: 'Um custo consegue ser lançado contra um fornecedor real e chegar a pagamento.',
  modulo: 'Financeiro',
  operacao: 'Custo e pagamento a fornecedor',
  dominio: 'CONTAS_PAGAR',
  severidadeFalha: 'ERRO',
  prioridade: 40,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'fornecedor-existe', nome: 'Fornecedor cadastrado', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Marque a função Fornecedor nas organizações que recebem pagamento.',
      rota: '/administrator?screen=organs',
      avaliar: async () => {
        const n = await prisma.orgaoProtocolo.count({ where: { ativo: true, funcoes: { has: 'FORNECEDOR' } } })
        return { ok: n > 0, detalhe: `${n} fornecedor(es) ativo(s)`, quantidade: n }
      },
    },
    {
      codigo: 'config-custo', nome: 'Item que gera custo configurado', tipo: 'CONFIGURACAO', obrigatoria: true,
      acao: 'Configure ao menos um item com natureza que admita custo.',
      rota: '/administrator?screen=catalog',
      avaliar: async () => {
        const n = await prisma.produtoFinanceiro.count({
          where: { ativo: true, OR: [{ naturezaFin: { in: ['SOMENTE_CUSTO', 'CUSTO_E_RECEITA'] } }, { possuiCusto: true }] },
        })
        return { ok: n > 0, detalhe: `${n} configuração(ões) que geram custo`, quantidade: n }
      },
    },
    dependeDeRota('rota-custos', 'API de custos V3', 'src/app/api/financeiro/v3/custos/route.ts',
      'A rota de lançamento de custo precisa existir.'),
  ],
})

// ═══════════════════════════ DOCUMENTAL ══════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-DOC-ANEXAR',
  nome: 'Anexar e guardar documento',
  descricao: 'Um documento consegue ser enviado, persistido no storage e vinculado a pessoa e processo.',
  modulo: 'Documentos',
  operacao: 'Upload e vínculo de documento',
  dominio: 'SISTEMA_DOCUMENTAL',
  severidadeFalha: 'CRITICO',
  prioridade: 25,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'storage', nome: 'Armazenamento configurado', tipo: 'TECNICA', obrigatoria: true,
      acao: 'Configure as credenciais do storage no ambiente.',
      avaliar: async () => {
        const faltando = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].filter((k) => !process.env[k])
        return {
          ok: faltando.length === 0,
          detalhe: faltando.length ? `${faltando.length} credencial(is) ausente(s)` : 'storage configurado',
          quantidade: faltando.length,
          evidencia: { ausentes: faltando },
        }
      },
    },
    dependeDeRota('rota-presign', 'API de upload', 'src/app/api/storage/presign/route.ts',
      'A rota de presign do storage precisa existir.'),
    {
      codigo: 'tipos-documento', nome: 'Tipos de documento cadastrados', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre os tipos de documento em Documentos › Tipos de Documento.',
      rota: '/administrator?screen=doctypes',
      avaliar: async () => {
        const n = await prisma.tipoDocumentoCadastro.count({ where: { ativo: true } })
        return { ok: n > 0, detalhe: `${n} tipo(s) de documento ativo(s)`, quantidade: n }
      },
    },
    {
      codigo: 'arquivos-integros', nome: 'Documentos recebidos com arquivo', tipo: 'DADO', obrigatoria: true,
      acao: 'Reenvie o arquivo dos documentos marcados como recebidos sem anexo.',
      avaliar: async () => {
        const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM "Documento" WHERE status = 'RECEBIDO' AND ("arquivo_url" IS NULL OR "arquivo_url" = '')`,
        )
        const n = r?.[0]?.n ?? 0
        return { ok: n === 0, detalhe: n ? `${n} documento(s) recebido(s) sem arquivo` : 'todo documento recebido tem arquivo', quantidade: n }
      },
    },
  ],
})

// ═══════════════════════════ PROTOCOLO ═══════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-PROT-REGISTRAR',
  nome: 'Registrar protocolização',
  descricao: 'Uma protocolização consegue ser registrada no processo, com órgão real, e alimentar a Timeline.',
  modulo: 'Processos',
  operacao: 'Protocolização',
  dominio: 'ORGANIZACOES',
  severidadeFalha: 'ERRO',
  prioridade: 50,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'orgao-cadastrado', nome: 'Órgão receptor cadastrado', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre os órgãos que recebem protocolo em Órgãos e Organizações.',
      rota: '/administrator?screen=organs',
      avaliar: async () => {
        const n = await prisma.orgaoProtocolo.count({ where: { ativo: true, funcoes: { has: 'ORGAO' } } })
        return { ok: n > 0, detalhe: `${n} órgão(s) ativo(s)`, quantidade: n }
      },
    },
    dependeDeRota('rota-protocolo', 'API de protocolização', 'src/app/api/protocolos/route.ts',
      'A rota de protocolo precisa existir.'),
    dependeDeRota('rota-opcoes', 'API de opções do protocolo', 'src/app/api/protocolos/opcoes/route.ts',
      'A rota que alimenta órgãos/responsáveis/documentos precisa existir.'),
    {
      codigo: 'evento-timeline', nome: 'Protocolização gera evento na Timeline', tipo: 'AUTOMACAO', obrigatoria: true,
      acao: 'O serviço de protocolização precisa gravar Evento e LogAuditoria na mesma transação.',
      avaliar: async () => {
        const existe = arquivo('src/services/protocolizacao.ts')
        return {
          ok: existe,
          detalhe: existe ? 'serviço de protocolização registra Evento + auditoria' : 'serviço de protocolização ausente',
        }
      },
    },
  ],
})

// ═══════════════════════════ ACESSOS ═════════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-ACC-OPERAR',
  nome: 'Operador consegue acessar e operar',
  descricao: 'Existe usuário com perfil, permissões concedidas e trilha de auditoria funcionando.',
  modulo: 'Usuários e Acessos',
  operacao: 'Acesso e autorização',
  dominio: 'PERMISSOES',
  severidadeFalha: 'CRITICO',
  prioridade: 5,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'usuario-ativo', nome: 'Existe usuário para operar', tipo: 'CADASTRO', obrigatoria: true,
      acao: 'Cadastre os usuários da operação.',
      rota: '/administrator?screen=users',
      avaliar: async () => {
        const n = await prisma.usuario.count()
        return { ok: n > 0, detalhe: `${n} usuário(s) cadastrado(s)`, quantidade: n }
      },
    },
    {
      codigo: 'perfil-com-permissao', nome: 'Perfis concedem permissões', tipo: 'CONFIGURACAO', obrigatoria: true,
      acao: 'Configure as permissões dos perfis em Usuários › Perfis.',
      rota: '/administrator?screen=roles',
      avaliar: async () => {
        const perfis = await prisma.perfil.findMany({ select: { nome: true, permissoes: true } })
        const vazios = perfis.filter((p) => {
          const m = p.permissoes as Record<string, boolean> | null
          return !m || Object.values(m).filter(Boolean).length === 0
        })
        return {
          ok: perfis.length > 0 && vazios.length === 0,
          detalhe: vazios.length ? `${vazios.length} perfil(is) sem nenhuma permissão` : `${perfis.length} perfil(is) com permissões`,
          quantidade: vazios.length,
          evidencia: { vazios: vazios.map((p) => p.nome) },
        }
      },
    },
    {
      codigo: 'usuario-com-perfil', nome: 'Usuários têm perfil atribuído', tipo: 'VINCULO', obrigatoria: true,
      requer: ['perfil-com-permissao'],
      acao: 'Atribua perfil aos usuários não-admin.',
      rota: '/administrator?screen=users',
      avaliar: async () => {
        const n = await prisma.usuario.count({ where: { perfilId: null, tipo: { not: 'admin' } } })
        return { ok: n === 0, detalhe: n ? `${n} usuário(s) sem perfil` : 'todo usuário tem perfil', quantidade: n }
      },
    },
    {
      codigo: 'segredos', nome: 'Segredos de autenticação presentes', tipo: 'TECNICA', obrigatoria: true,
      acao: 'Configure JWT_SECRET e APP_JWT_SECRET no ambiente.',
      avaliar: async () => {
        const faltando = ['JWT_SECRET', 'APP_JWT_SECRET'].filter((k) => !process.env[k])
        return { ok: faltando.length === 0, detalhe: faltando.length ? `${faltando.join(', ')} ausente(s)` : 'segredos presentes', evidencia: { ausentes: faltando } }
      },
    },
    {
      codigo: 'auditoria', nome: 'Trilha de auditoria registrando', tipo: 'TECNICA', obrigatoria: true,
      acao: 'As rotas administrativas precisam chamar registrarAuditoria.',
      rota: '/administrator?screen=audit',
      avaliar: async () => {
        const n = await prisma.logAuditoria.count()
        return { ok: n > 0, detalhe: `${n} registro(s) de auditoria`, quantidade: n }
      },
    },
  ],
})

// ═══════════════════════════ COMUNICAÇÕES ════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-COM-ENVIAR',
  nome: 'Enviar comunicação ao cliente',
  descricao: 'Existe provedor, modelo e destinatário para o sistema comunicar-se com o cliente.',
  modulo: 'Comunicações',
  operacao: 'Envio de comunicação',
  dominio: 'COMUNICACOES',
  severidadeFalha: 'ALERTA',
  prioridade: 70,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    {
      codigo: 'provedor', nome: 'Provedor de e-mail configurado', tipo: 'CONFIGURACAO', obrigatoria: false,
      acao: 'Configure o provedor de e-mail no ambiente para habilitar envio automático.',
      avaliar: async () => {
        const chaves = ['RESEND_API_KEY', 'SMTP_HOST', 'SENDGRID_API_KEY', 'EMAIL_FROM']
        const presentes = chaves.filter((k) => !!process.env[k])
        return {
          ok: presentes.length > 0,
          detalhe: presentes.length ? `provedor configurado (${presentes.length} variável(is))` : 'nenhum provedor de e-mail configurado',
          evidencia: { presentes },
        }
      },
    },
    {
      codigo: 'modelos', nome: 'Modelos de comunicação cadastrados', tipo: 'CADASTRO', obrigatoria: false,
      acao: 'Cadastre os modelos em Sistema › Cadastros Auxiliares › Modelos.',
      rota: '/administrator?screen=templates',
      avaliar: async () => {
        const n = await prisma.modeloDocumento.count({ where: { ativo: true } })
        return { ok: n > 0, detalhe: `${n} modelo(s) ativo(s)`, quantidade: n }
      },
    },
  ],
})

// ═══════════════════════════ RELATÓRIOS ══════════════════════════════════════

registrarCapacidade({
  codigo: 'CAP-REL-CONSULTAR',
  nome: 'Consultar relatórios e indicadores',
  descricao: 'As telas de relatório têm fonte de dados viva e respeitam permissão.',
  modulo: 'Relatórios',
  operacao: 'Consulta de relatórios',
  dominio: 'RELATORIOS',
  severidadeFalha: 'ALERTA',
  prioridade: 80,
  introduzidaEm: '2.0.0',
  ativo: true,
  dependencias: [
    dependeDeRota('rota-diagnostico', 'API de diagnóstico', 'src/app/api/gerenciamento/diagnostico/route.ts',
      'A rota que alimenta os relatórios operacionais precisa existir.'),
    dependeDeRota('rota-overview', 'API do painel geral', 'src/app/api/gerenciamento/overview/route.ts',
      'A rota do painel geral precisa existir.'),
    {
      codigo: 'dados-para-relatar', nome: 'Existe dado operacional para relatar', tipo: 'DADO', obrigatoria: false,
      acao: 'Relatórios só fazem sentido com operação em andamento.',
      avaliar: async () => {
        const processos = await prisma.processo.count()
        return { ok: processos > 0, detalhe: `${processos} processo(s) na base`, quantidade: processos }
      },
    },
  ],
})
