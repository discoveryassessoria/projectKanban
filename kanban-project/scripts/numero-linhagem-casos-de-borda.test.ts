// scripts/numero-linhagem-casos-de-borda.test.ts
//
// DOIS CASOS DE BORDA do cálculo de Nº Linhagem (achados na auditoria de
// 04/09/2026), cobrindo `calcularNumerosLinhagem` — núcleo PURO, sem banco.
//
//   1) Cônjuge com mais de uma união registrada (re-casamento sem remover a
//      união anterior) — o número final não pode depender da ORDEM em que as
//      uniões chegam.
//   2) Cônjuge cujo parceiro de sangue não foi visitado antes da leitura —
//      não pode ficar com `numeroLinhagem` nulo em silêncio.

import {
  calcularNumerosLinhagem,
  type PessoaParaLinhagem,
  type UniaoParaLinhagem,
} from "@/src/services/genealogia/numero-linhagem"

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

function pessoa(o: { id: number; paiId?: number | null; maeId?: number | null; data_nasc?: Date | null; linhaReta?: boolean }): PessoaParaLinhagem {
  return { paiId: null, maeId: null, data_nasc: null, linhaReta: false, ...o }
}

// ── 1) CÔNJUGE COM MAIS DE UMA UNIÃO — determinístico, independe da ordem ──
{
  // Raiz (1) -> filho de sangue A (2, nasce depois da raiz) -> filho de sangue B (3, nasce depois de A).
  // O cônjuge (99) casou com A e, depois, recasou com B — as duas uniões continuam cadastradas.
  const pessoas: PessoaParaLinhagem[] = [
    pessoa({ id: 1, linhaReta: true, data_nasc: new Date("1900-01-01") }),
    pessoa({ id: 2, linhaReta: true, paiId: 1, data_nasc: new Date("1925-01-01") }),
    pessoa({ id: 3, linhaReta: true, paiId: 1, data_nasc: new Date("1930-01-01") }),
    pessoa({ id: 99, linhaReta: false, data_nasc: new Date("1928-01-01") }),
  ]
  const uniaoAntesPrimeiro: UniaoParaLinhagem[] = [
    { pessoa1Id: 99, pessoa2Id: 3 }, // recasamento (número maior) — primeiro no array
    { pessoa1Id: 2, pessoa2Id: 99 }, // casamento original (número menor) — depois
  ]
  const uniaoOrdemInvertida: UniaoParaLinhagem[] = [...uniaoAntesPrimeiro].reverse()

  const r1 = calcularNumerosLinhagem(pessoas, uniaoAntesPrimeiro)
  const r2 = calcularNumerosLinhagem(pessoas, uniaoOrdemInvertida)

  chk(r1.get(99) === r2.get(99), "cônjuge com duas uniões: mesmo número não importa a ORDEM do array de uniões")
  chk(r1.get(99) === r1.get(2), "vence o parceiro de sangue com o MENOR número de linhagem (o mais antigo)")
  chk(r1.get(99) !== r1.get(3), "não fica com o número do recasamento mais recente")
}

// ── 2) CÔNJUGE DE PESSOA DE SANGUE "ESQUECIDA" — nunca fica sem número ─────
{
  // Duas raízes desconectadas (nenhuma tem pai/mãe de sangue): a pessoa de
  // sangue 5 só existe isolada, sem filhos e sem ser filha de ninguém em
  // `pessoas` — ainda assim é `linhaReta: true` e precisa ganhar número pelo
  // fallback antes de repassá-lo ao cônjuge.
  const pessoas: PessoaParaLinhagem[] = [
    pessoa({ id: 1, linhaReta: true, data_nasc: new Date("1900-01-01") }),
    pessoa({ id: 5, linhaReta: true, data_nasc: new Date("1905-01-01") }),
    pessoa({ id: 98, linhaReta: false, data_nasc: new Date("1906-01-01") }), // cônjuge de 5
  ]
  const unioes: UniaoParaLinhagem[] = [{ pessoa1Id: 5, pessoa2Id: 98 }]
  const r = calcularNumerosLinhagem(pessoas, unioes)

  chk(r.get(5) != null, "a pessoa de sangue isolada recebe número (fallback)")
  chk(r.get(98) != null, "o cônjuge NÃO fica com numeroLinhagem nulo — herda o número do parceiro de sangue")
  chk(r.get(98) === r.get(5), "o número herdado é exatamente o do parceiro de sangue")
}

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
