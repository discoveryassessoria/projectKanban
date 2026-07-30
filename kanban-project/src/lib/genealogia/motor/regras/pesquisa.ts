// src/lib/genealogia/motor/regras/pesquisa.ts
//
// Registros PROVÁVEIS e onde eles provavelmente estão.
//
// ⚠️ ESCOPO: isto NÃO é gestão documental. Nada aqui cria, versiona, solicita
// ou armazena documento — o Sistema Documental continua sendo dono único disso.
// O que este módulo produz é HIPÓTESE DE PESQUISA: "para esta pessoa, nascida
// aqui, neste ano, o registro provavelmente existe nesta fonte". É o
// conhecimento que hoje mora na cabeça do pesquisador sênior do escritório.

import type { GrafoGenealogico } from "../grafo"
import type { Insight, PaisAlvo, PessoaEntrada } from "../tipos"
import { anoDe, nomeCompleto, normalizar } from "../texto"
import { rotuloPais } from "./linhagem"

interface FonteProvavel {
  fonte: string
  detalhe: string
  probabilidade: number // 0..1
}

/** Marco do registro civil por país: antes disso, o registro é eclesiástico. */
const INICIO_REGISTRO_CIVIL: Record<string, { ano: number; civil: string; eclesiastico: string }> = {
  ITALIA: {
    ano: 1866,
    civil: "Ufficio di Stato Civile do Comune",
    eclesiastico: "Archivio Parrocchiale (registro paroquial)",
  },
  PORTUGAL: {
    ano: 1911,
    civil: "Conservatória do Registo Civil",
    eclesiastico: "Registos Paroquiais (arquivo distrital / ANTT)",
  },
  ESPANHA: {
    ano: 1871,
    civil: "Registro Civil municipal",
    eclesiastico: "Archivo Histórico Diocesano (registro parroquial)",
  },
  ALEMANHA: {
    ano: 1876,
    civil: "Standesamt (registro civil municipal)",
    eclesiastico: "Kirchenbuch (livro paroquial)",
  },
  BRASIL: {
    ano: 1889,
    civil: "Cartório de Registro Civil das Pessoas Naturais",
    eclesiastico: "Livro paroquial da igreja local (registro pré-1889)",
  },
}

const APELIDOS_BRASIL = ["BRASIL", "BRAZIL", "BRASILEIRA", "BRASILEIRO"]

function paisChave(p: PessoaEntrada): string | null {
  const v = normalizar(p.pais_nasc) || normalizar(p.nacionalidade)
  if (!v) return null
  if (APELIDOS_BRASIL.some((a) => v.includes(a))) return "BRASIL"
  if (v.includes("ITAL")) return "ITALIA"
  if (v.includes("PORTUG")) return "PORTUGAL"
  if (v.includes("ESPAN") || v.includes("SPAIN")) return "ESPANHA"
  if (v.includes("ALEMA") || v.includes("GERMAN") || v.includes("DEUTSCH") || v.includes("PRUSS")) {
    return "ALEMANHA"
  }
  return null
}

/** Onde provavelmente está o registro de um evento desta pessoa. */
export function fonteProvavel(
  p: PessoaEntrada,
  evento: "nascimento" | "casamento" | "obito",
  ano: number | null,
  local: string | null | undefined,
): FonteProvavel | null {
  const chave = paisChave(p)
  if (!chave) return null
  const marco = INICIO_REGISTRO_CIVIL[chave]
  if (!marco) return null

  const cidade = local?.trim()
  const rotuloEvento = { nascimento: "nascimento", casamento: "casamento", obito: "óbito" }[evento]

  if (ano == null) {
    return {
      fonte: marco.civil,
      detalhe: `Sem ano de ${rotuloEvento} não dá para saber se o registro é civil ou paroquial${cidade ? ` — localidade indicada: ${cidade}` : ""}.`,
      probabilidade: 0.4,
    }
  }

  if (ano >= marco.ano) {
    return {
      fonte: cidade ? `${marco.civil} — ${cidade}` : marco.civil,
      detalhe: `Registro civil já obrigatório em ${chave === "BRASIL" ? "1889" : marco.ano} para ${rotuloEvento}s.`,
      probabilidade: cidade ? 0.9 : 0.65,
    }
  }

  return {
    fonte: cidade ? `${marco.eclesiastico} — ${cidade}` : marco.eclesiastico,
    detalhe: `Antes de ${marco.ano} o registro civil não existia neste país: o ${rotuloEvento} está no livro eclesiástico.`,
    probabilidade: cidade ? 0.8 : 0.5,
  }
}

export function analisarPesquisa(
  g: GrafoGenealogico,
  naLinha: Set<number>,
  danteCausaId: number | null,
  paisAlvo: PaisAlvo | null,
): Insight[] {
  const out: Insight[] = []

  for (const p of g.pessoas) {
    const relevante = naLinha.has(p.id)
    // Fora da linha e sem exigência documental: não gera ruído de pesquisa.
    if (!relevante && p.documentacao === false) continue
    const prioridade = relevante ? 1.3 : 0.55

    // 1. Nascimento sem localidade → a pesquisa não tem onde começar
    if (!p.local_nasc && !p.pais_nasc) {
      out.push({
        id: `pesq-sem-local-${p.id}`,
        categoria: "pesquisa",
        severidade: relevante ? "alto" : "baixo",
        titulo: `${nomeCompleto(p)} — sem localidade de nascimento`,
        explicacao: "Sem cidade nem país de nascimento não existe cartório, comune ou paróquia para consultar: a pesquisa fica parada.",
        acao: "Extrair a localidade da certidão de casamento ou de óbito de alguém da mesma família.",
        pessoaIds: [p.id],
        confianca: 1,
        peso: Math.round(70 * prioridade),
      })
    }

    // 2. Registro de nascimento provável.
    //    Só sugerimos buscar o registro quando ele ainda RESOLVE alguma coisa:
    //    falta a data, ou falta a filiação (que é o dado que a certidão de
    //    nascimento traz). Sugerir "procure a certidão" para quem já tem data,
    //    local e pais cadastrados é ruído — e ruído em lista de pendência faz o
    //    operador parar de ler a lista inteira.
    const anoNasc = anoDe(p.data_nasc)
    const nascimentoResolveAlgo = !p.data_nasc || p.paiId == null || p.maeId == null
    if ((p.local_nasc || p.pais_nasc) && nascimentoResolveAlgo) {
      const f = fonteProvavel(p, "nascimento", anoNasc, p.local_nasc)
      if (f && f.probabilidade >= 0.5) {
        out.push({
          id: `pesq-nasc-${p.id}`,
          categoria: "pesquisa",
          severidade: "info",
          titulo: `Nascimento de ${nomeCompleto(p)}: procurar em ${f.fonte}`,
          explicacao: f.detalhe,
          acao: `Consultar ${f.fonte}${anoNasc ? ` — ano ${anoNasc}` : ""}.`,
          pessoaIds: [p.id],
          confianca: f.probabilidade,
          peso: Math.round(f.probabilidade * 30 * prioridade),
        })
      }
    }

    // 3. Casamento provável (quando há união com local, ou casado sem dados)
    for (const u of g.unioesDe(p.id)) {
      if (u.pessoa1Id !== p.id) continue // uma sugestão por casal
      const outroId = u.pessoa2Id
      const outro = outroId != null ? g.pessoa(outroId) : null
      const anoCas = anoDe(u.data_inicio)
      if (!u.local && !u.cartorio) {
        out.push({
          id: `pesq-casamento-sem-local-${u.id}`,
          categoria: "pesquisa",
          severidade: relevante ? "medio" : "baixo",
          titulo: `Casamento de ${nomeCompleto(p)}${outro ? ` e ${nomeCompleto(outro)}` : ""} sem local`,
          explicacao: "A certidão de casamento é o documento que traz a filiação dos dois cônjuges — é a chave para subir uma geração. Sem local não há onde pedi-la.",
          acao: "Registrar cidade/cartório do casamento.",
          pessoaIds: outro ? [p.id, outro.id] : [p.id],
          uniaoIds: [u.id],
          confianca: 1,
          peso: Math.round(55 * prioridade),
        })
      } else {
        // Mesma regra: a certidão de casamento interessa quando ainda falta
        // filiação de algum dos cônjuges (é isso que ela desbloqueia) ou a data.
        const faltaFiliacao = (x: typeof p | null) => !!x && (x.paiId == null || x.maeId == null)
        const casamentoResolveAlgo = !u.data_inicio || faltaFiliacao(p) || faltaFiliacao(outro)
        const f = casamentoResolveAlgo ? fonteProvavel(p, "casamento", anoCas, u.local) : null
        if (f && f.probabilidade >= 0.6) {
          out.push({
            id: `pesq-casamento-${u.id}`,
            categoria: "pesquisa",
            severidade: "info",
            titulo: `Casamento de ${nomeCompleto(p)}: procurar em ${f.fonte}`,
            explicacao: f.detalhe,
            acao: `Consultar ${f.fonte}${anoCas ? ` — ano ${anoCas}` : ""}.`,
            pessoaIds: outro ? [p.id, outro.id] : [p.id],
            uniaoIds: [u.id],
            confianca: f.probabilidade,
            peso: Math.round(f.probabilidade * 28 * prioridade),
          })
        }
      }
    }

    // 4. Óbito de pessoa falecida sem data
    const falecida = p.vivo === false || !!p.data_obito
    if (falecida && !p.data_obito) {
      out.push({
        id: `pesq-obito-${p.id}`,
        categoria: "pesquisa",
        severidade: relevante ? "medio" : "baixo",
        titulo: `${nomeCompleto(p)} — falecimento sem data`,
        explicacao: "Consta como falecida sem data de óbito. A certidão de óbito confirma o último domicílio e frequentemente a filiação.",
        acao: "Pesquisar o óbito no cartório do último domicílio conhecido.",
        pessoaIds: [p.id],
        confianca: 1,
        peso: Math.round(40 * prioridade),
      })
    }

    // 5. Imigração — quando a pessoa nasceu fora e os descendentes não
    const nasceuFora = paisChave(p) && paisChave(p) !== "BRASIL"
    if (nasceuFora && relevante) {
      const filhosNoBrasil = g
        .filhos(p.id)
        .some((f) => paisChave(f) === "BRASIL")
      const semDadosViagem = !p.data_chegada && !p.navio && !p.porto_chegada
      if (filhosNoBrasil && semDadosViagem) {
        out.push({
          id: `pesq-imigracao-${p.id}`,
          categoria: "pesquisa",
          severidade: "alto",
          titulo: `Entrada no Brasil de ${nomeCompleto(p)} não registrada`,
          explicacao: "Esta pessoa nasceu no exterior e teve filhos nascidos no Brasil, mas não há data de chegada, navio nem porto. A lista de desembarque é o que amarra a identidade do imigrante ao registro estrangeiro.",
          acao: "Buscar a lista de bordo (Arquivo Nacional / arquivo público do estado de entrada) e o registro de entrada de estrangeiro.",
          pessoaIds: [p.id],
          confianca: 0.9,
          peso: Math.round(75 * prioridade),
        })
      }
    }

    // 6. Naturalização — decide a transmissão do direito
    if (p.id === danteCausaId && !p.data_naturalizacao) {
      out.push({
        id: `pesq-naturalizacao-${p.id}`,
        categoria: "pesquisa",
        severidade: "critico",
        titulo: `Certidão de naturalização de ${nomeCompleto(p)} (dante causa)`,
        explicacao: `${nomeCompleto(p)} é o ascendente que origina o direito${paisAlvo ? ` à cidadania ${rotuloPais(paisAlvo).toLowerCase()}` : ""}. Se tiver se naturalizado antes do nascimento do descendente, a transmissão foi interrompida — este é o documento que decide a viabilidade do processo inteiro.`,
        acao: "Solicitar a certidão (negativa ou positiva) de naturalização junto ao órgão competente.",
        pessoaIds: [p.id],
        confianca: 1,
        peso: 125,
      })
    }
  }

  return out
}
