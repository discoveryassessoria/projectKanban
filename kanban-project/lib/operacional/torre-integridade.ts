// lib/operacional/torre-integridade.ts
// ============================================================================
// ABA INTEGRIDADE DA TORRE — Bloco I1 (30/09/2026).
//
// NÃO É OUTRO MOTOR: lê o que o motor do painel de Saúde já persistiu (`SaudeAchado`,
// `SaudeExecucao`) e o catálogo de correções seguras dele. Nenhuma verificação
// nova, nenhuma lista paralela. "Rodar diagnóstico agora" chama a MESMA rota de
// execução do painel de Saúde (`POST /api/gerenciamento/saude`).
//
// IGNORAR 7 d: o achado CONTINUA visível no Saúde (problema ignorado não some do
// motor). Aqui ele sai da lista enquanto `ignoradoAte` está no futuro — e, VENCIDO
// o prazo, volta sozinho, porque a data é conferida NA LEITURA (a rotina de
// gravação do Saúde não devolve um IGNORADO ao estado aberto por conta própria).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { achadosAbertos, ultimaExecucao } from '@/lib/saude'
import { correcaoPorId } from '@/lib/saude/correcoes'

const ORDEM_SEVERIDADE: Record<string, number> = { CRITICO: 0, ERRO: 1, ALERTA: 2, INFORMATIVO: 3 }

export interface ItemDeIntegridade {
  id: number
  chave: string
  codigo: string
  severidade: string
  titulo: string
  achado: string
  efeito: string | null
  acao: {
    link: string | null
    recomendacao: string | null
    /** Só quando existe no catálogo de correções seguras do Saúde. */
    correcao: { id: string; nome: string; descricao: string } | null
  }
  quantidade: number
  status: string
  recorrencias: number
  primeiraDeteccao: string
  ultimaDeteccao: string
  registroNome: string | null
  ignorado: { ate: string; por: string | null; justificativa: string | null } | null
  /** Foi ignorado e o prazo VENCEU: voltou para a lista. */
  voltouDeIgnorado: boolean
}

export interface QuadroDeIntegridade {
  frase: string
  /** Achados de verdade (CRÍTICO/ERRO/ALERTA) que não estão ignorados — a meta é zero. */
  divergencias: number
  informativos: number
  ignorados: number
  itens: ItemDeIntegridade[]
  itensIgnorados: ItemDeIntegridade[]
  execucao: { id: number; modo: string; estado: string; motivoEstado: string; criadoEm: string; coberturaPercentual: number; falhasTecnicas: number } | null
}

export async function quadroDeIntegridade(agora = new Date()): Promise<QuadroDeIntegridade> {
  const [achados, ultima] = await Promise.all([achadosAbertos(), ultimaExecucao()])
  const ignoradores = [...new Set(achados.map((a) => a.ignoradoPorId).filter((id): id is number => id != null))]
  const nomes = new Map(
    (ignoradores.length ? await prisma.usuario.findMany({ where: { id: { in: ignoradores } }, select: { id: true, nome: true } }) : [])
      .map((u) => [u.id, u.nome]),
  )

  const itens: ItemDeIntegridade[] = achados.map((a) => {
    const correcao = a.correcaoAutomatica ? correcaoPorId(a.correcaoAutomatica) : null
    const ignoradoVigente = a.status === 'IGNORADO' && a.ignoradoAte != null && a.ignoradoAte > agora
    const venceu = a.status === 'IGNORADO' && !ignoradoVigente
    return {
      id: a.id, chave: a.chave, codigo: a.codigo, severidade: a.severidade, titulo: a.titulo, achado: a.descricao,
      efeito: a.impacto ?? a.explicacao ?? null,
      acao: {
        link: a.link, recomendacao: a.recomendacao,
        correcao: correcao ? { id: correcao.id, nome: correcao.nome, descricao: correcao.descricao } : null,
      },
      quantidade: a.quantidade, status: venceu ? 'ABERTO' : a.status, recorrencias: a.recorrencias,
      primeiraDeteccao: a.primeiraDeteccao.toISOString(), ultimaDeteccao: a.ultimaDeteccao.toISOString(),
      registroNome: a.registroNome,
      ignorado: ignoradoVigente
        ? { ate: (a.ignoradoAte as Date).toISOString(), por: a.ignoradoPorId != null ? nomes.get(a.ignoradoPorId) ?? null : null, justificativa: a.justificativa }
        : null,
      voltouDeIgnorado: venceu,
    }
  })
  // CRÍTICO → ERRO → ALERTA → INFORMATIVO (o CAD-011 fica depois dos erros e alertas, visível); dentro da gravidade, o mais recente primeiro.
  const ordenar = (l: ItemDeIntegridade[]) => [...l].sort((x, y) =>
    (ORDEM_SEVERIDADE[x.severidade] ?? 9) - (ORDEM_SEVERIDADE[y.severidade] ?? 9) || y.ultimaDeteccao.localeCompare(x.ultimaDeteccao))
  const vivos = itens.filter((i) => !i.ignorado)
  const ignorados = itens.filter((i) => i.ignorado)
  return {
    frase: 'O sistema se vigia. Meta: divergências = 0.',
    divergencias: vivos.filter((i) => i.severidade !== 'INFORMATIVO').length,
    informativos: vivos.filter((i) => i.severidade === 'INFORMATIVO').length,
    ignorados: ignorados.length,
    itens: ordenar(vivos),
    itensIgnorados: ordenar(ignorados),
    execucao: ultima
      ? { id: ultima.id, modo: ultima.modo, estado: ultima.estado, motivoEstado: ultima.motivoEstado, criadoEm: ultima.criadoEm.toISOString(), coberturaPercentual: ultima.coberturaPercentual, falhasTecnicas: ultima.falhasTecnicas }
      : null,
  }
}
