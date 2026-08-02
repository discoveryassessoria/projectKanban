// lib/saude/plano.ts
//
// MOTOR DE RECOMENDAÇÕES E PLANO DE CORREÇÃO ORDENADO.
//
// Não é lista solta de problemas: é a SEQUÊNCIA em que as coisas precisam ser
// resolvidas. Uma ação só aparece depois daquilo de que ela depende — cadastrar
// preço antes de existir configuração financeira não adianta.
//
// Determinístico e auditável: cada recomendação nasce de uma dependência
// declarada ou de um contrato de prontidão, nunca de texto genérico.

import type { CapacidadeAvaliada, DependenciaAvaliada, TipoDependencia } from './capacidades'
import type { ResultadoContrato } from './contratos'
import type { Severidade } from './tipos'

export interface Recomendacao {
  codigo: string
  ordem: number
  titulo: string
  /** o que se observou, com número */
  problema: string
  /** por que aconteceu */
  causa: string
  /** o que deixa de funcionar */
  impacto: string
  /** o que fazer, objetivamente */
  acao: string
  tipo: TipoDependencia
  severidade: Severidade
  modulo: string
  /** capacidades que destravam quando isto for resolvido */
  destrava: string[]
  /** o que precisa estar pronto ANTES desta ação */
  preRequisitos: string[]
  rota?: string
  correcaoAutomatica?: string
  registrosAfetados: number
  /** faixa de esforço — nunca promessa de prazo */
  esforco: 'BAIXO' | 'MEDIO' | 'ALTO'
  evidencia?: Record<string, unknown>
}

const PESO_SEVERIDADE: Record<Severidade, number> = { CRITICO: 0, ERRO: 1, ALERTA: 2, INFORMATIVO: 3 }

/** Esforço por natureza — cadastro pontual é barato; configuração estrutural, não. */
function esforcoDe(d: DependenciaAvaliada): Recomendacao['esforco'] {
  if (d.correcaoAutomatica) return 'BAIXO'
  if (d.tipo === 'TECNICA' || d.tipo === 'AUTOMACAO') return 'ALTO'
  if ((d.quantidade ?? 0) > 20) return 'ALTO'
  if (d.tipo === 'CADASTRO' || d.tipo === 'DADO') return 'MEDIO'
  return 'MEDIO'
}

/**
 * Monta o plano a partir das capacidades avaliadas e dos contratos.
 *
 * A ordenação é por: (1) o que bloqueia mais capacidades, (2) severidade,
 * (3) prioridade da capacidade, (4) dependência declarada. Dependência vence
 * empate: `requer` empurra a ação para depois do seu pré-requisito.
 */
export function montarPlano(
  avaliadas: CapacidadeAvaliada[],
  contratos: ResultadoContrato[],
): Recomendacao[] {
  // 1) uma recomendação por DEPENDÊNCIA distinta, acumulando quem ela destrava
  const porChave = new Map<string, Recomendacao & { prioridadeMin: number }>()

  for (const cap of avaliadas) {
    for (const d of cap.faltantes) {
      const chave = `${d.tipo}:${d.codigo}:${d.nome}`
      const existente = porChave.get(chave)
      if (existente) {
        existente.destrava.push(cap.nome)
        existente.prioridadeMin = Math.min(existente.prioridadeMin, cap.prioridade)
        if (PESO_SEVERIDADE[cap.severidadeFalha] < PESO_SEVERIDADE[existente.severidade]) {
          existente.severidade = cap.severidadeFalha
        }
        continue
      }
      porChave.set(chave, {
        codigo: `REC-${d.codigo.toUpperCase()}`,
        ordem: 0,
        titulo: d.indeterminada ? `Investigar: ${d.nome}` : d.nome,
        problema: d.detalhe,
        causa: d.indeterminada
          ? `A verificação desta dependência falhou: ${d.erro ?? 'erro desconhecido'}.`
          : `A capacidade "${cap.nome}" declara esta dependência como ${d.obrigatoria ? 'OBRIGATÓRIA' : 'recomendada'}, e ela não está atendida.`,
        impacto: d.obrigatoria
          ? `A operação "${cap.operacao}" não pode ser executada.`
          : `A operação "${cap.operacao}" funciona, mas de forma incompleta.`,
        acao: d.acao,
        tipo: d.tipo,
        severidade: d.obrigatoria ? cap.severidadeFalha : 'ALERTA',
        modulo: cap.modulo,
        destrava: [cap.nome],
        preRequisitos: d.requer ?? [],
        rota: d.rota,
        correcaoAutomatica: d.correcaoAutomatica,
        registrosAfetados: d.quantidade ?? 0,
        esforco: esforcoDe(d),
        evidencia: d.evidencia,
        prioridadeMin: cap.prioridade,
      })
    }
  }

  // 2) contratos de prontidão viram recomendação de completar cadastro
  for (const c of contratos) {
    if (!c.incompletos.length) continue
    const faltas = new Map<string, number>()
    for (const i of c.incompletos) for (const f of i.faltando) faltas.set(f, (faltas.get(f) ?? 0) + 1)
    porChave.set(`CONTRATO:${c.cadastro}`, {
      codigo: `REC-CONTRATO-${c.cadastro.toUpperCase()}`,
      ordem: 0,
      titulo: `Completar ${c.rotulo}`,
      problema: `${c.incompletos.length} de ${c.totalAtivos} registro(s) ativo(s) não cumprem o contrato mínimo de uso.`,
      causa: `Cadastro ATIVO promete estar utilizável. Faltam: ${[...faltas.entries()].map(([f, n]) => `${f} (${n})`).join(', ')}.`,
      impacto: 'Registros ativos porém incompletos falham na hora do uso, não no cadastro — o erro aparece para o operador no meio da operação.',
      acao: `Complete os campos faltantes em ${c.rotulo}.`,
      tipo: 'CADASTRO',
      severidade: 'ALERTA',
      modulo: c.rotulo,
      destrava: [],
      preRequisitos: [],
      rota: c.rota,
      registrosAfetados: c.incompletos.length,
      esforco: c.incompletos.length > 20 ? 'ALTO' : 'MEDIO',
      evidencia: { requisitos: c.requisitos, amostra: c.incompletos.slice(0, 10) },
      prioridadeMin: 100,
    })
  }

  // 3) ordenação: bloqueadores primeiro; dependência declarada empurra para depois
  const lista = [...porChave.values()]
  lista.sort((a, b) => {
    const bloqueioA = a.destrava.length, bloqueioB = b.destrava.length
    return (
      PESO_SEVERIDADE[a.severidade] - PESO_SEVERIDADE[b.severidade] ||
      bloqueioB - bloqueioA ||
      a.prioridadeMin - b.prioridadeMin ||
      a.titulo.localeCompare(b.titulo)
    )
  })

  // 4) respeitar `requer`: se A exige B, B vem antes — reordenação estável
  const posicao = new Map(lista.map((r, i) => [r.codigo.replace('REC-', '').toLowerCase(), i]))
  lista.sort((a, b) => {
    const aDependeDeB = a.preRequisitos.some((p) => b.codigo.toLowerCase().includes(p.toLowerCase()))
    const bDependeDeA = b.preRequisitos.some((p) => a.codigo.toLowerCase().includes(p.toLowerCase()))
    if (aDependeDeB && !bDependeDeA) return 1
    if (bDependeDeA && !aDependeDeB) return -1
    return (posicao.get(a.codigo.replace('REC-', '').toLowerCase()) ?? 0) - (posicao.get(b.codigo.replace('REC-', '').toLowerCase()) ?? 0)
  })

  return lista.map((r, i) => {
    const { prioridadeMin: _p, ...rec } = r
    void _p
    return { ...rec, ordem: i + 1, destrava: [...new Set(rec.destrava)] }
  })
}

/** Agrupamento por CAUSA RAIZ — um serviço sem preço não vira 400 alertas. */
export interface CausaRaiz {
  causa: string
  tipo: TipoDependencia
  severidade: Severidade
  ocorrencias: number
  registrosAfetados: number
  capacidadesAfetadas: string[]
  acao: string
  rota?: string
}

export function agruparPorCausaRaiz(recomendacoes: Recomendacao[]): CausaRaiz[] {
  const mapa = new Map<string, CausaRaiz>()
  for (const r of recomendacoes) {
    const chave = `${r.tipo}:${r.modulo}`
    const atual = mapa.get(chave)
    if (atual) {
      atual.ocorrencias++
      atual.registrosAfetados += r.registrosAfetados
      atual.capacidadesAfetadas.push(...r.destrava)
      if (PESO_SEVERIDADE[r.severidade] < PESO_SEVERIDADE[atual.severidade]) atual.severidade = r.severidade
      continue
    }
    mapa.set(chave, {
      causa: `${r.modulo} — ${r.tipo.toLowerCase().replace('_', ' ')}`,
      tipo: r.tipo,
      severidade: r.severidade,
      ocorrencias: 1,
      registrosAfetados: r.registrosAfetados,
      capacidadesAfetadas: [...r.destrava],
      acao: r.acao,
      rota: r.rota,
    })
  }
  return [...mapa.values()]
    .map((c) => ({ ...c, capacidadesAfetadas: [...new Set(c.capacidadesAfetadas)] }))
    .sort((a, b) => PESO_SEVERIDADE[a.severidade] - PESO_SEVERIDADE[b.severidade] || b.registrosAfetados - a.registrosAfetados)
}
