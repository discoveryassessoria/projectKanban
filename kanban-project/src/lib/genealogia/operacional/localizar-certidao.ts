// src/lib/genealogia/operacional/localizar-certidao.ts
//
// ONDE LOCALIZAR A CERTIDÃO + NATURALIZAÇÃO DO ASCENDENTE TRANSMISSOR — o que o
// motor genealógico sabe sobre a pesquisa e que a aba Operação da pessoa exibe.
//
// Antes isso só aparecia no painel "Inteligência da árvore" (removido). A fonte é
// a MESMA regra de pesquisa do motor (`motor/regras/pesquisa.ts`); este módulo só
// a roda sem o corte de exibição de `analisarArvore` (teto por categoria) e a
// reparte em dois fatos que a fila da pessoa sabe encaixar:
//
//   • SUGESTÃO DE REGISTRO — órgão (cartório / registro civil), município, ano
//     calculado e a nota histórica de por que ali. Vai DENTRO da exigência
//     correspondente (nascimento = regras documentais GEN-CIVIL-NASC; casamento =
//     GEN-CIVIL-CAS), nunca como item solto.
//   • NATURALIZAÇÃO DO TRANSMISSOR — a certidão (negativa ou positiva) do
//     ascendente que origina o direito. É o documento que decide a viabilidade.
//
// PURO: sem prisma, sem rede, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore } from "../motor/tipos"
import { analisarPesquisa } from "../motor/regras/pesquisa"

export const PREFIXO_NATURALIZACAO = "pesq-naturalizacao-"

/** Código da regra documental que exige cada certidão (campo `ruleCode` da exigência). */
export const REGRA_NASCIMENTO = "GEN-CIVIL-NASC"
export const REGRA_CASAMENTO = "GEN-CIVIL-CAS"

export interface SugestaoDeRegistro {
  /** Id do insight de origem (estável). */
  id: string
  evento: "nascimento" | "casamento"
  /** Sujeito da exigência: a pessoa (nascimento) ou a união (casamento). */
  pessoaId: number
  uniaoId: number | null
  orgao: string
  municipio: string | null
  ano: number | null
  /** Por que ali (civil × paroquial, marco do registro civil do país). */
  nota: string
}

export interface NaturalizacaoDoTransmissor {
  id: string
  pessoaId: number
  titulo: string
  explicacao: string
  acao: string
}

type EntradaLocalizar = Pick<AnaliseArvore, "linhaCidadania" | "danteCausaId" | "paisAlvo"> & { grafo: GrafoGenealogico }

export interface FatosDePesquisa {
  registros: SugestaoDeRegistro[]
  naturalizacao: NaturalizacaoDoTransmissor | null
}

export function fatosDePesquisa(analise: EntradaLocalizar | null | undefined): FatosDePesquisa {
  if (!analise) return { registros: [], naturalizacao: null }
  const insights = analisarPesquisa(analise.grafo, new Set(analise.linhaCidadania), analise.danteCausaId, analise.paisAlvo)
  const registros: SugestaoDeRegistro[] = []
  let naturalizacao: NaturalizacaoDoTransmissor | null = null
  for (const i of insights) {
    if (i.registro) {
      const pessoaId = i.pessoaIds[0]
      if (pessoaId == null) continue
      registros.push({
        id: i.id,
        evento: i.registro.evento,
        pessoaId,
        uniaoId: i.registro.evento === "casamento" ? (i.uniaoIds?.[0] ?? null) : null,
        orgao: i.registro.orgao,
        municipio: i.registro.municipio,
        ano: i.registro.ano,
        nota: i.explicacao,
      })
    } else if (i.id.startsWith(PREFIXO_NATURALIZACAO) && i.pessoaIds[0] != null) {
      naturalizacao = {
        id: i.id,
        pessoaId: i.pessoaIds[0],
        titulo: i.titulo,
        explicacao: i.explicacao,
        acao: i.acao ?? "Solicitar a certidão de naturalização.",
      }
    }
  }
  return { registros, naturalizacao }
}
