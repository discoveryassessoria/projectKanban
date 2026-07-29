// src/lib/genealogia/motor/regras/completude.ts
//
// Completude por pessoa e narrativa automática.
//
// A completude NÃO é "quantos campos estão preenchidos". É "quanto do que este
// papel exige está resolvido". Um colateral com nome e data está 100% do que se
// espera dele; um dante causa com os mesmos dados está longe disso. Medir
// igual seria mentir para o operador.

import type { GrafoGenealogico } from "../grafo"
import type { Insight, PapelLinha, PessoaEntrada } from "../tipos"
import { anoDe, formatarData, nomeCompleto } from "../texto"

interface CampoExigido {
  chave: string
  rotulo: string
  peso: number
  preenchido: (p: PessoaEntrada, g: GrafoGenealogico) => boolean
  /** Só exigido quando a condição bate (ex.: óbito só se falecida). */
  quando?: (p: PessoaEntrada, g: GrafoGenealogico) => boolean
}

const CAMPOS: CampoExigido[] = [
  { chave: "nome", rotulo: "Nome", peso: 3, preenchido: (p) => !!p.nome?.trim() },
  { chave: "sobrenome", rotulo: "Sobrenome", peso: 3, preenchido: (p) => !!p.sobrenome?.trim() },
  { chave: "sexo", rotulo: "Sexo", peso: 1.5, preenchido: (p) => !!p.sexo },
  { chave: "data_nasc", rotulo: "Data de nascimento", peso: 3, preenchido: (p) => !!p.data_nasc },
  { chave: "local_nasc", rotulo: "Cidade de nascimento", peso: 2.5, preenchido: (p) => !!p.local_nasc },
  { chave: "pais_nasc", rotulo: "País de nascimento", peso: 2, preenchido: (p) => !!p.pais_nasc },
  {
    chave: "filiacao",
    rotulo: "Filiação (pai e mãe)",
    peso: 3,
    preenchido: (p) => p.paiId != null && p.maeId != null,
  },
  {
    chave: "data_obito",
    rotulo: "Data de óbito",
    peso: 2,
    quando: (p) => p.vivo === false,
    preenchido: (p) => !!p.data_obito,
  },
  {
    chave: "casamento",
    rotulo: "Dados do casamento",
    peso: 2.5,
    quando: (p, g) => g.unioesDe(p.id).length > 0 || !!p.casado,
    preenchido: (p, g) => g.unioesDe(p.id).some((u) => !!u.data_inicio && !!u.local),
  },
]

/** Campos exigidos a mais de quem está na linha (o dossiê real do processo). */
const CAMPOS_LINHA: CampoExigido[] = [
  {
    chave: "profissao",
    rotulo: "Profissão",
    peso: 0.8,
    preenchido: (p) => !!p.profissao,
  },
  {
    chave: "migracao",
    rotulo: "Dados de imigração (navio, porto, chegada)",
    peso: 2,
    quando: (p, g) => !!p.pais_nasc && g.filhos(p.id).some((f) => !!f.pais_nasc && f.pais_nasc !== p.pais_nasc),
    preenchido: (p) => !!p.data_chegada || !!p.navio || !!p.porto_chegada,
  },
]

const CAMPOS_DANTE_CAUSA: CampoExigido[] = [
  {
    chave: "naturalizacao",
    rotulo: "Situação de naturalização",
    peso: 4,
    preenchido: (p) => p.naturalizado === true || !!p.data_naturalizacao,
  },
]

export interface ResultadoCompletude {
  completude: number
  faltando: string[]
}

export function calcularCompletude(
  g: GrafoGenealogico,
  p: PessoaEntrada,
  papel: PapelLinha,
): ResultadoCompletude {
  const campos = [...CAMPOS]
  if (papel === "linha" || papel === "dante_causa" || papel === "requerente") campos.push(...CAMPOS_LINHA)
  if (papel === "dante_causa") campos.push(...CAMPOS_DANTE_CAUSA)

  // A filiação do dante causa não é exigida — ele é o topo da linha.
  const efetivos = papel === "dante_causa" ? campos.filter((c) => c.chave !== "filiacao") : campos

  let total = 0
  let obtido = 0
  const faltando: string[] = []

  for (const c of efetivos) {
    if (c.quando && !c.quando(p, g)) continue
    total += c.peso
    if (c.preenchido(p, g)) obtido += c.peso
    else faltando.push(c.rotulo)
  }

  const completude = total === 0 ? 100 : Math.round((obtido / total) * 100)
  return { completude, faltando }
}

/** Lacunas viram insight só quando doem: linha reta ou pessoa documentável. */
export function analisarLacunas(
  g: GrafoGenealogico,
  papeis: Map<number, PapelLinha>,
  completudes: Map<number, ResultadoCompletude>,
): Insight[] {
  const out: Insight[] = []
  for (const p of g.pessoas) {
    const papel = papeis.get(p.id) || "colateral"
    const r = completudes.get(p.id)
    if (!r) continue
    const naLinha = papel === "linha" || papel === "dante_causa" || papel === "requerente"
    if (!naLinha && p.documentacao === false) continue
    if (r.faltando.length === 0) continue

    const grave = naLinha && r.completude < 60
    const medio = naLinha && r.completude < 85
    if (!grave && !medio && !(!naLinha && r.completude < 40)) continue

    out.push({
      id: `lacuna-${p.id}`,
      categoria: "lacuna",
      severidade: grave ? "alto" : medio ? "medio" : "baixo",
      titulo: `${nomeCompleto(p)} — ficha ${r.completude}% completa`,
      explicacao: `Faltam: ${r.faltando.join(", ")}.${naLinha ? " Esta pessoa está na linha de transmissão, então cada campo ausente vira exigência mais adiante." : ""}`,
      acao: `Completar ${r.faltando[0].toLowerCase()}.`,
      pessoaIds: [p.id],
      confianca: 1,
      peso: Math.round((100 - r.completude) * (naLinha ? 0.9 : 0.25)),
    })
  }
  return out
}

/** Resumo de uma linha, gerado automaticamente — o "quem é quem" instantâneo. */
export function resumirPessoa(g: GrafoGenealogico, p: PessoaEntrada, papel: PapelLinha): string {
  const partes: string[] = []

  const anoN = anoDe(p.data_nasc)
  const anoO = anoDe(p.data_obito)
  if (anoN && anoO) partes.push(`${anoN}–${anoO}`)
  else if (anoN) partes.push(`nascida(o) em ${anoN}`)
  else if (anoO) partes.push(`falecida(o) em ${anoO}`)

  const local = [p.local_nasc, p.pais_nasc].filter(Boolean).join(", ")
  if (local) partes.push(`de ${local}`)
  if (p.profissao) partes.push(p.profissao.toLowerCase())

  const conjuges = g.conjuges(p.id)
  if (conjuges.length === 1) partes.push(`casada(o) com ${nomeCompleto(conjuges[0])}`)
  else if (conjuges.length > 1) partes.push(`${conjuges.length} uniões`)

  const filhos = g.filhosIds(p.id).length
  if (filhos > 0) partes.push(`${filhos} ${filhos === 1 ? "filho" : "filhos"}`)

  const rotuloPapel: Record<PapelLinha, string> = {
    requerente: "Requerente",
    dante_causa: "Dante causa",
    linha: "Linha de transmissão",
    conjuge: "Cônjuge",
    colateral: "Colateral",
  }

  return `${rotuloPapel[papel]} · ${partes.join(" · ") || "sem dados registrados"}`
}

/** Narrativa de família — o resumo que o operador leria antes de uma reunião. */
export function narrarFamilia(g: GrafoGenealogico, pessoaId: number): string {
  const p = g.pessoa(pessoaId)
  if (!p) return ""
  const frases: string[] = []

  const nasc = p.data_nasc ? formatarData(p.data_nasc) : null
  const localNasc = [p.local_nasc, p.pais_nasc].filter(Boolean).join(", ")
  frases.push(
    `${nomeCompleto(p)}${nasc ? ` nasceu em ${nasc}` : ""}${localNasc ? `${nasc ? "," : " nasceu"} em ${localNasc}` : ""}.`.replace(/\s+/g, " "),
  )

  const pais = g.paisDe(pessoaId)
  if (pais.length) {
    frases.push(`Filha(o) de ${pais.map((x) => nomeCompleto(x)).join(" e ")}.`)
  } else {
    frases.push("Filiação ainda não localizada.")
  }

  for (const u of g.unioesDe(pessoaId)) {
    const outroId = u.pessoa1Id === pessoaId ? u.pessoa2Id : u.pessoa1Id
    const outro = outroId != null ? g.pessoa(outroId) : null
    if (!outro) continue
    const quando = u.data_inicio ? ` em ${formatarData(u.data_inicio)}` : ""
    const onde = u.local ? `, em ${u.local}` : ""
    frases.push(`Casou-se com ${nomeCompleto(outro)}${quando}${onde}.`)
  }

  const filhos = g.filhosOrdenados(g.filhosIds(pessoaId)).map((id) => g.pessoa(id)!).filter(Boolean)
  if (filhos.length) {
    const nomes = filhos.map((f) => {
      const a = anoDe(f.data_nasc)
      return a ? `${nomeCompleto(f)} (${a})` : nomeCompleto(f)
    })
    frases.push(`${filhos.length === 1 ? "Teve um filho:" : `Teve ${filhos.length} filhos:`} ${nomes.join(", ")}.`)
  }

  if (p.data_emigracao || p.navio || p.porto_chegada || p.data_chegada) {
    const det = [
      p.data_emigracao ? `partiu em ${formatarData(p.data_emigracao)}` : null,
      p.porto_embarque ? `de ${p.porto_embarque}` : null,
      p.navio ? `a bordo do ${p.navio}` : null,
      p.data_chegada ? `chegou em ${formatarData(p.data_chegada)}` : null,
      p.porto_chegada ? `em ${p.porto_chegada}` : null,
    ].filter(Boolean)
    if (det.length) frases.push(`Migração: ${det.join(", ")}.`)
  }

  if (p.data_naturalizacao) {
    frases.push(`Naturalizou-se em ${formatarData(p.data_naturalizacao)}${p.pais_naturalizacao ? ` (${p.pais_naturalizacao})` : ""}.`)
  }

  if (p.data_obito) {
    frases.push(`Faleceu em ${formatarData(p.data_obito)}.`)
  }

  return frases.join(" ")
}
