// src/services/genealogia/pessoas-repetidas.ts
// ============================================================================
// PESSOA PARECIDA EM OUTRO PROCESSO — consulta de LEITURA.
//
// Filtra por DATA EXATA de nascimento no banco (faixa de um dia) e só então
// compara o nome em memória (`pessoa-repetida.ts`): nunca varre a tabela inteira
// a cada digitação. Pessoas da MESMA árvore ficam de fora — duplicidade interna é
// assunto do motor da árvore, não deste aviso. Não escreve nada, não funde, não
// vincula: devolve só o necessário (nome, data, processo) para o operador decidir.
// ============================================================================
import type { PrismaClient } from "@prisma/client"
import { PESSOA_ATIVA } from "@/src/lib/genealogia/vinculo-ativo"
import {
  MAX_CANDIDATOS,
  dataCompleta,
  diaDaData,
  linkDaPessoaNoProcesso,
  nomesParecidos,
  type PessoaRepetidaCandidata,
} from "@/src/lib/genealogia/pessoa-repetida"

type Leitor = Pick<PrismaClient, "pessoa">

/** Teto de pessoas lidas por dia de nascimento: aniversário comum nunca vira varredura. */
const TETO_LEITURA = 400

export async function buscarPessoasRepetidas(
  db: Leitor,
  entrada: { nome: string; sobrenome?: string | null; dataNascimento: string; arvoreIdAtual: number },
): Promise<PessoaRepetidaCandidata[]> {
  const dia = dataCompleta(entrada.dataNascimento)
  if (!dia) return []
  const inicio = new Date(`${dia}T00:00:00.000Z`)
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000)

  const mesmaData = await db.pessoa.findMany({
    where: {
      data_nasc: { gte: inicio, lt: fim },
      ...PESSOA_ATIVA,
      arvoreId: { not: null, notIn: [entrada.arvoreIdAtual] },
    },
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      data_nasc: true,
      arvore: { select: { processos: { select: { id: true, codigo: true, nome: true }, orderBy: { id: "asc" } } } },
    },
    orderBy: { id: "asc" },
    take: TETO_LEITURA,
  })

  const candidatos: PessoaRepetidaCandidata[] = []
  for (const p of mesmaData) {
    if (!nomesParecidos({ nome: entrada.nome, sobrenome: entrada.sobrenome }, p)) continue
    const processo = p.arvore?.processos[0]
    if (!processo) continue // árvore sem processo: não há para onde apontar
    const nascimento = diaDaData(p.data_nasc)
    if (!nascimento) continue
    candidatos.push({
      pessoaId: p.id,
      nome: [p.nome, p.sobrenome].filter(Boolean).join(" "),
      dataNascimento: nascimento,
      processo: { id: processo.id, codigo: processo.codigo, nome: processo.nome },
      link: linkDaPessoaNoProcesso(processo.id, p.id),
    })
    if (candidatos.length >= MAX_CANDIDATOS) break
  }
  return candidatos
}
