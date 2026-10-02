// src/services/genealogia/avisos-maioridade.ts
//
// AVISO DE MAIORIDADE NO PROCESSO — derivado na leitura, sem tabela nova.
//
// Quem era menor quando o processo abriu e completa 18 anos ENQUANTO o processo
// está ativo muda de regra documental (requisitos de adulto passam a valer). O
// sistema não tem evento para "fez aniversário", então a tela do processo avisa:
// a data de nascimento da árvore + a data de abertura do processo bastam para
// calcular, a cada leitura, quem já completou e quem completa nos próximos dias.
//
// Só LEITURA. Reconciliar a documentação continua sendo a propagação da árvore
// (§37) — este aviso diz à equipe que há algo a conferir.

import { prisma } from "@/lib/prisma"
import { PESSOA_ATIVA } from "@/src/lib/genealogia/vinculo-ativo"
import { avisoDeMaioridade, ehRequerente } from "@/src/lib/documentos/maioridade"

export interface AvisoMaioridadeDoProcesso {
  pessoaId: number
  nome: string
  requerente: boolean
  tipo: "COMPLETOU" | "COMPLETARA"
  /** Dia do 18º aniversário (ISO). */
  quando: string
}

/** Janela "completará": quantos dias à frente o aviso olha. */
export const DIAS_A_FRENTE_AVISO_MAIORIDADE = 60

export async function avisosDeMaioridadeDoProcesso(
  processoId: number,
  hoje: Date = new Date(),
): Promise<AvisoMaioridadeDoProcesso[] | null> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { arvoreId: true, dataInicio: true, dataConclusao: true },
  })
  if (!processo) return null
  // Processo concluído ou sem árvore: nada muda mais para ninguém.
  if (!processo.arvoreId || processo.dataConclusao) return []

  const pessoas = await prisma.pessoa.findMany({
    where: { arvoreId: processo.arvoreId, ...PESSOA_ATIVA, vivo: true, data_nasc: { not: null } },
    select: { id: true, nome: true, sobrenome: true, requerente: true, data_nasc: true },
  })

  const avisos: AvisoMaioridadeDoProcesso[] = []
  for (const p of pessoas) {
    const aviso = avisoDeMaioridade(p.data_nasc, processo.dataInicio, hoje, DIAS_A_FRENTE_AVISO_MAIORIDADE)
    if (!aviso) continue
    avisos.push({
      pessoaId: p.id,
      nome: [p.nome, p.sobrenome].filter(Boolean).join(" "),
      requerente: ehRequerente(p.requerente),
      tipo: aviso.tipo,
      quando: aviso.quando.toISOString(),
    })
  }
  // Requerentes primeiro; depois quem já completou; dentro disso, o mais antigo.
  return avisos.sort((a, b) =>
    Number(b.requerente) - Number(a.requerente)
    || (a.tipo === b.tipo ? 0 : a.tipo === "COMPLETOU" ? -1 : 1)
    || a.quando.localeCompare(b.quando))
}
