// lib/saude/verificacoes/documentos.ts
//
// DOCUMENTOS, SISTEMA DOCUMENTAL, PESSOAS E ÁRVORE.
//
// O documento é o produto do processo de cidadania. Documento sem pessoa, sem
// arquivo ou apontando para necessidade inexistente é trabalho que não pode ser
// entregue.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA_DOCTYPES = '/administrator?screen=doctypes'
const ROTA_ARVORE = '/genealogy'

registrar({
  id: 'saude.documentos.orfaos',
  codigo: 'DOC-001',
  nome: 'Documento com pessoa existente',
  descricao: 'Documento apontando para pessoa que não existe mais é registro órfão.',
  dominio: 'DOCUMENTOS',
  modulo: 'Sistema Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Investigue a origem antes de remover — documento órfão costuma indicar exclusão de pessoa sem tratamento do acervo.',
  rotaCorrecao: ROTA_ARVORE,
  responsavel: 'Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Documento" d
        WHERE NOT EXISTS (SELECT 1 FROM "Pessoa" p WHERE p.id = d."pessoaId")`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { orfaos: 0 }, resumo: 'Todo documento aponta para uma pessoa existente.' }
    return {
      achados: [{
        chave: 'documento-sem-pessoa',
        severidade: 'ERRO',
        titulo: `${n} documento(s) sem pessoa`,
        descricao: `${n} documento(s) referenciam uma pessoa que não existe mais.`,
        explicacao: 'Todo documento pertence a uma pessoa da árvore — é ela que dá sentido ao ato registral.',
        impacto: 'O documento não aparece na pasta de ninguém e não pode ser usado como prova no processo.',
        entidade: 'Documento',
        quantidade: n,
        link: ROTA_ARVORE,
        recomendacao: 'Reaponte o documento para a pessoa correta ou trate o acervo órfão.',
        evidencia: { orfaos: n },
      }],
      metricas: { orfaos: n },
    }
  },
})

registrar({
  id: 'saude.documentos.arquivo-ausente',
  codigo: 'DOC-002',
  nome: 'Documento recebido com arquivo',
  descricao: 'Documento marcado como recebido precisa ter arquivo anexado — senão a entrega não existe.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Sistema Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Anexe o arquivo do documento ou volte o status para pendente.',
  rotaCorrecao: ROTA_ARVORE,
  responsavel: 'Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Documento"
        WHERE status = 'RECEBIDO' AND ("arquivo_url" IS NULL OR "arquivo_url" = '')`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { semArquivo: 0 }, resumo: 'Todo documento recebido tem arquivo.' }
    return {
      achados: [{
        chave: 'documento-recebido-sem-arquivo',
        severidade: 'ERRO',
        titulo: `${n} documento(s) recebido(s) sem arquivo`,
        descricao: `${n} documento(s) estão marcados como recebidos mas não têm arquivo anexado.`,
        explicacao: 'O status RECEBIDO afirma que o documento chegou. Sem arquivo, a afirmação não se sustenta.',
        impacto: 'O gate da fase considera o documento resolvido e o processo avança sem a prova.',
        entidade: 'Documento',
        quantidade: n,
        link: ROTA_ARVORE,
        recomendacao: 'Anexe o arquivo ou reverta o status.',
        evidencia: { semArquivo: n },
      }],
      metricas: { semArquivo: n },
    }
  },
})

registrar({
  id: 'saude.documentos.necessidade-orfa',
  codigo: 'DOC-003',
  nome: 'Necessidade documental com processo e item válidos',
  descricao: 'Necessidade apontando para processo ou item de catálogo inexistente quebra o gate da fase.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Necessidade Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Necessidade órfã trava o gate: o motor conta uma exigência que não pode ser resolvida.',
  responsavel: 'Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ sem_processo: number; sem_item: number }[]>(
      `SELECT
         COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = n."processoId"))::int AS sem_processo,
         COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ItemCatalogo" i WHERE i.id = n."itemCatalogoId"))::int AS sem_item
       FROM "NecessidadeDocumental" n`,
    )
    const semProcesso = r?.[0]?.sem_processo ?? 0
    const semItem = r?.[0]?.sem_item ?? 0
    const achados: Achado[] = []
    if (semProcesso) {
      achados.push({
        chave: 'necessidade-sem-processo',
        severidade: 'CRITICO',
        titulo: `${semProcesso} necessidade(s) documental(is) sem processo`,
        descricao: `${semProcesso} necessidade(s) apontam para processo inexistente.`,
        explicacao: 'A necessidade existe dentro de um processo; sem ele, é exigência sem dono.',
        impacto: 'Contagem de pendências distorcida e gate impossível de fechar.',
        entidade: 'NecessidadeDocumental',
        quantidade: semProcesso,
        recomendacao: 'Investigue a origem antes de remover.',
        evidencia: { semProcesso },
      })
    }
    if (semItem) {
      achados.push({
        chave: 'necessidade-sem-item',
        severidade: 'ERRO',
        titulo: `${semItem} necessidade(s) sem item do catálogo`,
        descricao: `${semItem} necessidade(s) apontam para item do Catálogo Mestre inexistente.`,
        explicacao: 'O item define O QUE precisa ser obtido; sem ele a necessidade não tem conteúdo.',
        impacto: 'A necessidade não pode ser atendida nem precificada.',
        entidade: 'NecessidadeDocumental',
        quantidade: semItem,
        recomendacao: 'Reaponte para o item correto do catálogo.',
        evidencia: { semItem },
      })
    }
    return { achados, metricas: { semProcesso, semItem }, resumo: 'Necessidades documentais íntegras.' }
  },
})

registrar({
  id: 'saude.documentos.tipo-sem-codigo',
  codigo: 'DOC-004',
  nome: 'Tipo de documento com código público',
  descricao: 'Tipo de documento sem código DOC-n não pode ser referenciado com segurança.',
  dominio: 'DOCUMENTOS',
  modulo: 'Tipos de Documento',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'O código é gerado no create; registros antigos podem ser completados pelo backfill.',
  rotaCorrecao: ROTA_DOCTYPES,
  correcaoAutomatica: 'gerar-codigo-tipo-documento',
  responsavel: 'Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const n = await prisma.tipoDocumentoCadastro.count({ where: { publicCode: null } })
    if (!n) return { achados: [], metricas: { semCodigo: 0 }, resumo: 'Todo tipo de documento tem código público.' }
    return {
      achados: [{
        chave: 'tipo-documento-sem-codigo',
        severidade: 'ALERTA',
        titulo: `${n} tipo(s) de documento sem código`,
        descricao: `${n} tipo(s) de documento estão sem código público.`,
        explicacao: 'O código DOC-n é a referência estável do tipo em matriz documental e relatórios.',
        impacto: 'Referência por código falha para estes tipos.',
        entidade: 'TipoDocumentoCadastro',
        quantidade: n,
        link: ROTA_DOCTYPES,
        recomendacao: 'Rode o backfill de códigos públicos.',
        correcaoAutomatica: 'gerar-codigo-tipo-documento',
        evidencia: { semCodigo: n },
      }],
      metricas: { semCodigo: n },
    }
  },
})

registrar({
  id: 'saude.pessoas.sem-nome',
  codigo: 'PES-001',
  nome: 'Pessoa com nome preenchido',
  descricao: 'Pessoa sem nome não pode ser identificada em documento nem em processo.',
  dominio: 'PESSOAS',
  modulo: 'Árvore Genealógica',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Complete o nome da pessoa na Árvore Genealógica.',
  rotaCorrecao: ROTA_ARVORE,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Pessoa" WHERE nome IS NULL OR btrim(nome) = ''`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { semNome: 0 }, resumo: 'Toda pessoa tem nome.' }
    return {
      achados: [{
        chave: 'pessoa-sem-nome',
        severidade: 'ERRO',
        titulo: `${n} pessoa(s) sem nome`,
        descricao: `${n} pessoa(s) da árvore estão sem nome preenchido.`,
        explicacao: 'O nome é a identidade mínima da pessoa no dossiê genealógico.',
        impacto: 'Documentos e vínculos ficam impossíveis de conferir.',
        entidade: 'Pessoa',
        quantidade: n,
        link: ROTA_ARVORE,
        recomendacao: 'Complete o nome na árvore.',
        evidencia: { semNome: n },
      }],
      metricas: { semNome: n },
    }
  },
})

registrar({
  id: 'saude.arvore.pessoa-sem-arvore',
  codigo: 'ARV-001',
  nome: 'Árvore com pessoa principal existente',
  descricao: 'Árvore apontando para pessoa principal inexistente perde a raiz da linha de transmissão.',
  dominio: 'ARVORE',
  modulo: 'Árvore Genealógica',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Defina a pessoa principal da árvore — é ela que ancora a linha de cidadania.',
  rotaCorrecao: ROTA_ARVORE,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Arvore" a
        WHERE a."pessoaPrincipalId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Pessoa" p WHERE p.id = a."pessoaPrincipalId")`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { quebradas: 0 }, resumo: 'Toda árvore aponta para uma pessoa principal existente.' }
    return {
      achados: [{
        chave: 'arvore-pessoa-principal-inexistente',
        severidade: 'ERRO',
        titulo: `${n} árvore(s) com pessoa principal inexistente`,
        descricao: `${n} árvore(s) apontam para uma pessoa principal que não existe mais.`,
        explicacao: 'A pessoa principal é a raiz da linha de transmissão da cidadania.',
        impacto: 'A análise de transmissão não encontra ponto de partida.',
        entidade: 'Arvore',
        quantidade: n,
        link: ROTA_ARVORE,
        recomendacao: 'Reaponte a pessoa principal da árvore.',
        evidencia: { quebradas: n },
      }],
      metricas: { quebradas: n },
    }
  },
})
