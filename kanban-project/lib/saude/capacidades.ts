// lib/saude/capacidades.ts
//
// CATÁLOGO DE CAPACIDADES E MOTOR DE DEPENDÊNCIAS.
//
// A pergunta que este módulo responde não é "o banco está íntegro?", e sim
// "o Discovery CONSEGUE executar esta operação de negócio agora?".
//
// Tabela existente não significa módulo funcionando. Rota existente não
// significa tela funcionando. Cadastro existente não significa cadastro
// completo. Cada capacidade declara TUDO de que depende, e o estado sai da
// avaliação real de cada dependência — nunca de suposição.

import type { Dominio, Severidade } from './tipos'

/** Estado de prontidão de uma capacidade. Ordem: índice maior = pior. */
export const ESTADOS_PRONTIDAO = [
  'PRONTO', 'PARCIALMENTE_PRONTO', 'NAO_CONFIGURADO', 'CONFIGURACAO_INVALIDA', 'BLOQUEADO', 'DIAGNOSTICO_INCOMPLETO',
] as const
export type EstadoProntidao = (typeof ESTADOS_PRONTIDAO)[number]

export const PRONTIDAO_LABEL: Record<EstadoProntidao, string> = {
  PRONTO: 'Pronto',
  PARCIALMENTE_PRONTO: 'Parcialmente pronto',
  NAO_CONFIGURADO: 'Não configurado',
  CONFIGURACAO_INVALIDA: 'Configuração inválida',
  BLOQUEADO: 'Bloqueado',
  DIAGNOSTICO_INCOMPLETO: 'Diagnóstico incompleto',
}

export const piorProntidao = (a: EstadoProntidao, b: EstadoProntidao): EstadoProntidao =>
  ESTADOS_PRONTIDAO.indexOf(a) >= ESTADOS_PRONTIDAO.indexOf(b) ? a : b

/** Natureza da dependência — usada para explicar O QUE falta. */
export const TIPOS_DEPENDENCIA = [
  'CADASTRO', 'CONFIGURACAO', 'VINCULO', 'AUTOMACAO', 'PERMISSAO', 'TECNICA', 'DADO',
] as const
export type TipoDependencia = (typeof TIPOS_DEPENDENCIA)[number]

export const DEPENDENCIA_LABEL: Record<TipoDependencia, string> = {
  CADASTRO: 'Cadastro faltante',
  CONFIGURACAO: 'Configuração faltante',
  VINCULO: 'Vínculo faltante',
  AUTOMACAO: 'Automação faltante',
  PERMISSAO: 'Permissão faltante',
  TECNICA: 'Dependência técnica',
  DADO: 'Dado obrigatório ausente',
}

export interface ResultadoDependencia {
  ok: boolean
  /** o que se observou, com números — nunca texto genérico */
  detalhe: string
  /** registros afetados, quando aplicável */
  quantidade?: number
  /** amostra citável para o operador conferir */
  evidencia?: Record<string, unknown>
  /** a própria dependência reconhece que não conseguiu concluir a avaliação */
  indeterminada?: boolean
  erro?: string
}

export interface Dependencia {
  /** código estável dentro da capacidade */
  codigo: string
  nome: string
  tipo: TipoDependencia
  /** obrigatória: se falhar, a capacidade NÃO pode ficar pronta */
  obrigatoria: boolean
  /** dependências que precisam ser resolvidas ANTES desta (ordem do plano) */
  requer?: string[]
  /** o que fazer para resolver */
  acao: string
  rota?: string
  /** correção automática segura, quando existir */
  correcaoAutomatica?: string
  avaliar: () => Promise<ResultadoDependencia>
}

export interface Capacidade {
  /** código imutável */
  codigo: string
  nome: string
  descricao: string
  modulo: string
  /** operação de negócio que a capacidade representa */
  operacao: string
  dominio: Dominio
  /** severidade do achado quando a capacidade está bloqueada */
  severidadeFalha: Severidade
  /** ordem de importância para o plano de correção (menor = mais urgente) */
  prioridade: number
  introduzidaEm: string
  ativo: boolean
  dependencias: Dependencia[]
}

const REGISTRO = new Map<string, Capacidade>()

export function registrarCapacidade(c: Capacidade): Capacidade {
  if (REGISTRO.has(c.codigo)) throw new Error(`[saude] capacidade duplicada: ${c.codigo}`)
  REGISTRO.set(c.codigo, c)
  return c
}

export const capacidades = () => [...REGISTRO.values()]
export const capacidadePorCodigo = (codigo: string) => REGISTRO.get(codigo) ?? null

// ── AVALIAÇÃO ────────────────────────────────────────────────────────────────

export interface DependenciaAvaliada extends Omit<Dependencia, 'avaliar'> {
  ok: boolean
  detalhe: string
  quantidade?: number
  evidencia?: Record<string, unknown>
  /** a dependência não pôde ser avaliada (erro técnico) */
  indeterminada?: boolean
  erro?: string
}

export interface CapacidadeAvaliada {
  codigo: string
  nome: string
  descricao: string
  modulo: string
  operacao: string
  dominio: Dominio
  prioridade: number
  severidadeFalha: Severidade
  estado: EstadoProntidao
  /** frase única que resume por que não está pronto */
  motivo: string
  dependencias: DependenciaAvaliada[]
  /** o que falta, já separado por natureza */
  faltantes: DependenciaAvaliada[]
  duracaoMs: number
}

/**
 * Avalia UMA capacidade. Uma dependência que não pôde ser avaliada torna a
 * capacidade DIAGNÓSTICO INCOMPLETO — nunca "pronta". Dependência obrigatória
 * falhando bloqueia; opcional falhando deixa parcialmente pronta.
 */
export async function avaliarCapacidade(c: Capacidade): Promise<CapacidadeAvaliada> {
  const t0 = Date.now()
  const avaliadas: DependenciaAvaliada[] = []

  for (const d of c.dependencias) {
    const { avaliar, ...meta } = d
    try {
      const r = await avaliar()
      // a dependência pode declarar "não consegui determinar" SEM lançar erro;
      // esse sinal precisa sobreviver até o estado da capacidade.
      avaliadas.push({
        ...meta, ok: r.ok, detalhe: r.detalhe, quantidade: r.quantidade, evidencia: r.evidencia,
        indeterminada: r.indeterminada, erro: r.erro,
      })
    } catch (e) {
      avaliadas.push({
        ...meta, ok: false, indeterminada: true,
        detalhe: 'não foi possível avaliar esta dependência',
        erro: String((e as Error)?.message ?? e).slice(0, 300),
      })
    }
  }

  const indeterminadas = avaliadas.filter((d) => d.indeterminada)
  const obrigatoriasFalhando = avaliadas.filter((d) => !d.ok && d.obrigatoria && !d.indeterminada)
  const opcionaisFalhando = avaliadas.filter((d) => !d.ok && !d.obrigatoria && !d.indeterminada)

  let estado: EstadoProntidao = 'PRONTO'
  let motivo = 'todas as dependências obrigatórias atendidas'

  if (obrigatoriasFalhando.length) {
    // NÃO CONFIGURADO quando o que falta é cadastro/configuração inexistente;
    // CONFIGURAÇÃO INVÁLIDA quando existe mas está errado; BLOQUEADO quando é
    // dependência técnica. A distinção muda a ação do operador.
    const soCadastro = obrigatoriasFalhando.every((d) => d.tipo === 'CADASTRO' || d.tipo === 'CONFIGURACAO')
    const temTecnica = obrigatoriasFalhando.some((d) => d.tipo === 'TECNICA')
    estado = temTecnica ? 'BLOQUEADO' : soCadastro ? 'NAO_CONFIGURADO' : 'CONFIGURACAO_INVALIDA'
    motivo = `${obrigatoriasFalhando.length} dependência(s) obrigatória(s) não atendida(s): ${obrigatoriasFalhando.map((d) => d.nome).join(', ')}`
  } else if (opcionaisFalhando.length) {
    estado = 'PARCIALMENTE_PRONTO'
    motivo = `${opcionaisFalhando.length} dependência(s) recomendada(s) ausente(s): ${opcionaisFalhando.map((d) => d.nome).join(', ')}`
  }

  if (indeterminadas.length) {
    // Não saber é pior que saber que falta: vira incompleto, nunca pronto.
    estado = piorProntidao(estado, 'DIAGNOSTICO_INCOMPLETO')
    motivo = `${indeterminadas.length} dependência(s) não puderam ser avaliadas${obrigatoriasFalhando.length ? ` · ${motivo}` : ''}`
  }

  return {
    codigo: c.codigo, nome: c.nome, descricao: c.descricao, modulo: c.modulo, operacao: c.operacao,
    dominio: c.dominio, prioridade: c.prioridade, severidadeFalha: c.severidadeFalha,
    estado, motivo, dependencias: avaliadas,
    faltantes: [...obrigatoriasFalhando, ...opcionaisFalhando, ...indeterminadas],
    duracaoMs: Date.now() - t0,
  }
}

/** Avalia TODAS as capacidades ativas, com concorrência limitada. */
export async function avaliarCapacidades(concorrencia = 3): Promise<CapacidadeAvaliada[]> {
  const fila = capacidades().filter((c) => c.ativo)
  const saida: CapacidadeAvaliada[] = []
  const trabalhador = async () => {
    for (;;) {
      const c = fila.shift()
      if (!c) return
      saida.push(await avaliarCapacidade(c))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, fila.length || 1) }, trabalhador))
  return saida.sort((a, b) => a.prioridade - b.prioridade || a.codigo.localeCompare(b.codigo))
}
