// src/services/genealogia/numero-linhagem.ts
// ============================================================================
// Nº LINHAGEM — ordena a pasta documental da família inteira.
//
// REGRA (definida pelo usuário, a partir da pasta documental real da família
// Abellan): percorre a linha de sangue (Pessoa.linhaReta) em PROFUNDIDADE —
// começa no ancestral mais antigo (raiz, sem pai/mãe de sangue registrado),
// numera 1, e desce TODO o ramo de um filho antes de passar para o irmão
// seguinte. Irmãos entram na ordem de nascimento (mais velho primeiro).
//
// O CÔNJUGE não entra na sequência principal — recebe o MESMO número do
// parceiro de sangue (fica agrupado à parte, "Fora da linhagem").
//
// NÃO é digitado: é RECALCULADO sempre que a árvore muda — inclusive quando
// um ancestral é adicionado ACIMA da raiz atual (ele vira o novo 1 e todo
// mundo abaixo desce um número). Por isso vive dentro do MESMO gatilho único
// que já reage a toda edição de árvore (`dispararMaterializacaoPorArvore`) —
// nenhum ponto de chamada novo espalhado pelo app.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { pessoasAtivasDaArvore } from "@/src/lib/genealogia/vinculo-ativo"

type DB = Prisma.TransactionClient | typeof prisma

export interface PessoaParaLinhagem {
  id: number
  paiId: number | null
  maeId: number | null
  data_nasc: Date | null
  linhaReta: boolean
}

export interface UniaoParaLinhagem {
  pessoa1Id: number
  pessoa2Id: number
}

/**
 * Núcleo PURO: dado o snapshot da árvore, devolve `pessoaId -> número`.
 * Sem banco, sem efeito — testável isoladamente e reusado pela persistência
 * abaixo. Fonte única do cálculo.
 */
export function calcularNumerosLinhagem(
  pessoas: PessoaParaLinhagem[],
  unioes: UniaoParaLinhagem[],
): Map<number, number> {
  const porId = new Map(pessoas.map((p) => [p.id, p]))
  const sangue = pessoas.filter((p) => p.linhaReta)
  const idsDeSangue = new Set(sangue.map((p) => p.id))

  // Mapa pai/mãe -> filhos DE SANGUE, deduplicado (um filho não entra duas
  // vezes por ter os dois pais na linha).
  const filhosPorPai = new Map<number, Set<number>>()
  for (const p of sangue) {
    for (const parentId of [p.paiId, p.maeId]) {
      if (parentId != null && idsDeSangue.has(parentId)) {
        if (!filhosPorPai.has(parentId)) filhosPorPai.set(parentId, new Set())
        filhosPorPai.get(parentId)!.add(p.id)
      }
    }
  }

  // RAÍZES: pessoa de sangue sem pai NEM mãe de sangue registrado na árvore —
  // o(s) ancestral(is) mais antigo(s) conhecido(s). Mais de uma raiz é
  // possível (ramos ainda não conectados); entram ordenadas por nascimento,
  // como irmãs seriam.
  const raizes = sangue.filter(
    (p) =>
      !(p.paiId != null && idsDeSangue.has(p.paiId)) &&
      !(p.maeId != null && idsDeSangue.has(p.maeId)),
  )

  const porNascimento = (aId: number, bId: number): number => {
    const a = porId.get(aId)!
    const b = porId.get(bId)!
    const da = a.data_nasc?.getTime() ?? Number.POSITIVE_INFINITY
    const db = b.data_nasc?.getTime() ?? Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return aId - bId // desempate estável — nunca dois iguais em datas iguais/ausentes
  }

  const ordem = new Map<number, number>()
  const visitados = new Set<number>()
  let contador = 1

  function visitar(id: number): void {
    if (visitados.has(id)) return
    visitados.add(id)
    ordem.set(id, contador++)
    const filhos = [...(filhosPorPai.get(id) ?? [])].sort(porNascimento)
    for (const filhoId of filhos) visitar(filhoId)
  }

  for (const raizId of raizes.map((p) => p.id).sort(porNascimento)) visitar(raizId)

  // Sobra alguém de sangue fora da travessia (ex.: ciclo de dados estranho,
  // ou os dois pais registrados NÃO são de sangue — caso incomum)? Entra no
  // fim, por segurança, nunca ficando sem número.
  const restantes = sangue.map((p) => p.id).filter((id) => !visitados.has(id)).sort(porNascimento)
  for (const id of restantes) visitar(id)

  // CÔNJUGE herda o número do parceiro DE SANGUE. Casamento entre duas
  // pessoas de sangue (primos na mesma árvore) não precisa de tratamento — as
  // duas já têm número próprio pela travessia acima.
  //
  // DOIS CASOS DE BORDA, os dois resolvidos aqui:
  //
  //   1) CÔNJUGE COM MAIS DE UMA UNIÃO (re-casamento cadastrado sem remover a
  //      união anterior): sem isto, o número final dependia da ORDEM em que o
  //      banco devolvia as linhas — não determinístico. Regra explícita: entre
  //      os parceiros de sangue candidatos, vence o de MENOR número de
  //      linhagem (o ramo mais antigo/mais próximo da raiz).
  //
  //   2) PARCEIRO DE SANGUE AINDA NÃO VISITADO neste ponto (não deveria
  //      acontecer — raízes + fallback acima já cobrem todo `sangue` — mas a
  //      trava explícita evita que um cônjuge fique com `numeroLinhagem` nulo
  //      em silêncio se essa garantia um dia deixar de valer aqui).
  const numeroFinal = new Map<number, number>(ordem)
  const candidatosDoConjuge = new Map<number, number[]>()
  const registrarCandidato = (conjugeId: number, sangueId: number) => {
    if (!ordem.has(sangueId)) visitar(sangueId) // caso 2 — rede de segurança
    const n = ordem.get(sangueId)
    if (n == null) return
    const lista = candidatosDoConjuge.get(conjugeId)
    if (lista) lista.push(n)
    else candidatosDoConjuge.set(conjugeId, [n])
  }
  for (const u of unioes) {
    const p1 = porId.get(u.pessoa1Id)
    const p2 = porId.get(u.pessoa2Id)
    if (!p1 || !p2) continue
    if (p1.linhaReta && !p2.linhaReta) registrarCandidato(p2.id, p1.id)
    else if (p2.linhaReta && !p1.linhaReta) registrarCandidato(p1.id, p2.id)
  }
  for (const [conjugeId, candidatos] of candidatosDoConjuge) {
    numeroFinal.set(conjugeId, Math.min(...candidatos)) // caso 1 — determinístico
  }

  return numeroFinal
}

/**
 * Recalcula e GRAVA o número de linhagem de toda a árvore. Best-effort — quem
 * chama (`dispararMaterializacaoPorArvore`) já engole erro e segue o fluxo;
 * aqui só evitamos escrever o que não mudou.
 */
export async function recalcularNumerosLinhagemDaArvore(
  arvoreId: number,
  db: DB = prisma,
): Promise<void> {
  const pessoas = await db.pessoa.findMany({
    where: pessoasAtivasDaArvore(arvoreId),
    select: { id: true, paiId: true, maeId: true, data_nasc: true, linhaReta: true, numeroLinhagem: true },
  })
  if (pessoas.length === 0) return

  const ids = pessoas.map((p) => p.id)
  const unioes = await db.uniao.findMany({
    where: { OR: [{ pessoa1Id: { in: ids } }, { pessoa2Id: { in: ids } }] },
    select: { pessoa1Id: true, pessoa2Id: true },
  })

  const novo = calcularNumerosLinhagem(pessoas, unioes)

  const alteracoes = pessoas.filter((p) => (novo.get(p.id) ?? null) !== p.numeroLinhagem)
  if (alteracoes.length === 0) return
  await Promise.all(
    alteracoes.map((p) => db.pessoa.update({ where: { id: p.id }, data: { numeroLinhagem: novo.get(p.id) ?? null } })),
  )
}
