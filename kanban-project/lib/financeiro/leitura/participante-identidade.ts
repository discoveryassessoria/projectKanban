// lib/financeiro/leitura/participante-identidade.ts
// ============================================================================
// IDENTIDADE do PARTICIPANTE de uma DistribuicaoEconomica — fonte única.
//
// ─── O QUE ESTA COLUNA GUARDA DE VERDADE ────────────────────────────────────
// `ParticipacaoEconomica.pessoaId` NÃO guarda `Pessoa.id`. Guarda `Requerente.id`.
// É o que o único escritor grava (lib/financeiro/dual-write.ts):
//
//     participacoes: { create: reqs.map((r) => ({ pessoaId: r.requerenteId ?? 0, … })) }
//
// A coluna é solta (sem FK), então nada denunciava a divergência. Os leitores
// resolviam o valor contra `Pessoa` — tabela onde aquele id significa OUTRA
// pessoa ou pessoa nenhuma — e caíam em "Requerente não identificado" mesmo
// quando o participante estava perfeitamente vivo.
//
// ─── POR QUE O DADO ESTÁ CERTO E O NOME DA COLUNA ESTÁ ERRADO ───────────────
// O participante de uma distribuição é a ENTIDADE DE COBRANÇA — o `Requerente`.
// É ele que existe mesmo quando não há nó na árvore: `Requerente.personId` é
// nulável, e é exatamente nulo para quem saiu da genealogia mas continua sendo
// cliente. Guardar `Pessoa.id` ali PERDERIA a identidade nesses casos.
//
// Então a correção é de LEITURA: resolver o id como `Requerente`, que é o que
// ele é. O nome da coluna é dívida de nomenclatura (renomear é migração
// destrutiva num campo lido por cinco consultas) e está registrado aqui, no
// único lugar que precisa saber disso.
// ============================================================================
import { prisma } from '@/lib/prisma'

/** Texto exibido quando o id do participante não resolve em cadastro nenhum. */
export const PARTICIPANTE_SEM_IDENTIDADE = 'Requerente não identificado'

/**
 * Nome de cada participante, por id de `ParticipacaoEconomica.pessoaId`.
 *
 * Resolve como `Requerente` (o que a coluna guarda). Quando o requerente tem
 * nó na árvore, o nome da `Pessoa` tem precedência — é o cadastro que a operação
 * edita. Id que não resolve em lugar nenhum fica FORA do mapa: quem chama decide
 * o rótulo, e nunca se inventa nome.
 */
export async function nomesDeParticipantes(ids: Iterable<number>): Promise<Map<number, string>> {
  const uniq = [...new Set([...ids].filter((n) => Number.isInteger(n) && n > 0))]
  const mapa = new Map<number, string>()
  if (!uniq.length) return mapa

  const requerentes = await prisma.requerente.findMany({
    where: { id: { in: uniq } },
    select: { id: true, nome: true, pessoa: { select: { nome: true, sobrenome: true } } },
  }).catch(() => [])

  for (const r of requerentes) {
    const daArvore = r.pessoa ? [r.pessoa.nome, r.pessoa.sobrenome].filter(Boolean).join(' ').trim() : ''
    const nome = daArvore || (r.nome ?? '').trim()
    if (nome) mapa.set(r.id, nome)
  }
  return mapa
}

/** Rótulo do participante: nome resolvido ou a frase honesta de não-identificação. */
export function rotuloParticipante(id: number | null | undefined, mapa: Map<number, string>): string {
  if (id == null) return PARTICIPANTE_SEM_IDENTIDADE
  return mapa.get(id) ?? PARTICIPANTE_SEM_IDENTIDADE
}
