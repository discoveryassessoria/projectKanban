// lib/saude/verificacoes/regras-do-marco-saude.ts — INT-003: registra os vigias das «Regras inegociáveis do Marco» (CLAUDE.md §41) na Saúde do Sistema.
// SOMENTE LEITURA. A lógica mora em `regras-do-marco.ts` (a mesma do script e do teste da suíte).
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { detectarRegrasDoMarco, TITULO_DA_REGRA } from './regras-do-marco'

registrar({
  id: 'saude.integridade.regras-do-marco',
  codigo: 'INT-003',
  nome: 'Regras inegociáveis do Marco',
  descricao: 'Varre os processos ativos contra as regras inegociáveis do Marco (CLAUDE.md §41): Emissão travada pela Genealogia; tarefa que muda de fase sem responsável; ordem fixa das certidões; subtarefas obrigatórias e anexo nunca obrigatório; Feito só com os 4 passos. Somente leitura.',
  dominio: 'ARVORE',
  modulo: 'Genealogia',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.13.0',
  timeoutMs: 120_000,
  orientacao: 'Cada achado nomeia certidão, pessoa e família. Nada é corrigido sozinho: abra o processo e decida.',
  rotaCorrecao: '/torre',
  correcaoAutomatica: null,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const { violacoes, porRegra } = await detectarRegrasDoMarco({ profundo: false })
    const achados: Achado[] = violacoes.map((v) => ({
      chave: `INT-003:${v.regra}:${v.entidade}:${v.registroId}`,
      severidade: 'ERRO',
      titulo: `Regra ${v.regra.toUpperCase()} — ${TITULO_DA_REGRA[v.regra]}: ${v.certidao ?? '—'}${v.pessoa ? ` · ${v.pessoa}` : ''} (família ${v.familia}${v.processoId ? ` · processo #${v.processoId}` : ''})`,
      descricao: v.detalhe,
      entidade: v.entidade, registroId: String(v.registroId), registroNome: `${v.certidao ?? ''}${v.pessoa ? ` · ${v.pessoa}` : ''}`.trim(),
      link: v.processoId ? `/torre/processo/${v.processoId}` : '/torre',
      recomendacao: 'Somente leitura: abra o processo e resolva (o vigia nunca corrige sozinho).',
      evidencia: { regra: v.regra, processoId: v.processoId, familia: v.familia, certidao: v.certidao, pessoa: v.pessoa },
    }))
    return { achados, metricas: { violacoes: violacoes.length, ...porRegra }, resumo: violacoes.length === 0 ? 'Nenhuma violação das regras do Marco.' : `${violacoes.length} violação(ões) das regras do Marco.` }
  },
})
