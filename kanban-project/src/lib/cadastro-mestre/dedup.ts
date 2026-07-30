// src/lib/cadastro-mestre/dedup.ts
//
// MDM-3 — Triagem de duplicidade antes de criar Pessoa.
//
// Regra do domínio: **nenhuma Pessoa nasce sem triagem**. Hoje
// `POST /api/pessoas` cria direto, e como não existe serviço de fusão, cada
// duplicata criada é permanente. Impedir a entrada é a única defesa disponível.
//
// Módulo PURO. Reutiliza o que já existe — `chaveDedupPessoa` de
// `src/services/identity.ts` (CP-1) e as distâncias de `motor/texto.ts`. Não
// reescreve nenhuma das duas: escala de similaridade divergente entre módulos é
// como o mesmo par de fichas passa a ter dois veredictos diferentes.

import { chaveDedupPessoa, apenasDigitos, dataISO } from "@/src/services/identity"
import { anoDe, similaridadeLocal, similaridadeNome } from "@/src/lib/genealogia/motor/texto"

/** O que se sabe de quem está sendo cadastrado. */
export interface DadosPessoaNova {
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  cpf?: string | null
  dataNascimento?: Date | string | null
  localNascimento?: string | null
  paiId?: number | null
  maeId?: number | null
}

/** Pessoa já existente no Cadastro Mestre, para comparação. */
export interface PessoaCandidata {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  cpf?: string | null
  data_nasc?: Date | string | null
  local_nasc?: string | null
  paiId?: number | null
  maeId?: number | null
  /** Já pertence a alguma árvore — informativo para a tela. */
  arvoreId?: number | null
  /** Pessoa fundida (MDM-4) nunca é candidata. */
  fundidaEmId?: number | null
}

export type NivelTriagem = "BLOQUEIO" | "CONFIRMACAO" | "INFORMATIVO" | "LIVRE"

export interface Evidencia {
  campo: string
  descricao: string
  /** Positiva soma, negativa subtrai — a tela mostra as duas. */
  favoravel: boolean
}

export interface CandidatoDuplicidade {
  pessoaId: number
  score: number
  nivel: NivelTriagem
  evidencias: Evidencia[]
}

export interface ResultadoTriagem {
  /** Nível mais severo entre todos os candidatos. */
  nivel: NivelTriagem
  candidatos: CandidatoDuplicidade[]
  /** Chave de dedup dos dados informados (CP-1). */
  chaveDedup: string
  /**
   * true quando o operador PODE criar sem decisão explícita. Falso obriga a
   * registrar uma `DecisaoDeduplicacao`.
   */
  criacaoLivre: boolean
}

/** Limiares. Únicos no Discovery — nenhum consumidor redefine os seus. */
export const LIMIAR_CONFIRMACAO = 0.85
export const LIMIAR_INFORMATIVO = 0.6

/**
 * Compara os dados novos com um candidato.
 *
 * CPF é decisivo nos dois sentidos: igual bloqueia a criação; diferente e ambos
 * preenchidos elimina o candidato. Documento é identidade — nome parecido não
 * vence documento diferente.
 */
export function compararCandidato(
  novo: DadosPessoaNova,
  cand: PessoaCandidata,
): CandidatoDuplicidade | null {
  if (cand.fundidaEmId != null) return null // já fundida: não é identidade viva

  const evidencias: Evidencia[] = []
  const cpfNovo = apenasDigitos(novo.cpf)
  const cpfCand = apenasDigitos(cand.cpf)

  if (cpfNovo.length >= 11 && cpfCand.length >= 11) {
    if (cpfNovo === cpfCand) {
      return {
        pessoaId: cand.id,
        score: 1,
        nivel: "BLOQUEIO",
        evidencias: [{ campo: "cpf", descricao: "Mesmo CPF", favoravel: true }],
      }
    }
    // CPFs distintos: são pessoas distintas, ponto final.
    return null
  }

  // Sexo divergente derruba — antes de gastar cálculo de similaridade.
  const sexoNovo = (novo.sexo || "").charAt(0).toUpperCase()
  const sexoCand = (cand.sexo || "").charAt(0).toUpperCase()
  if (sexoNovo && sexoCand && sexoNovo !== sexoCand) return null

  let pontos = 0
  let peso = 0
  const somar = (valor: number, p: number, ev?: Evidencia) => {
    pontos += valor * p
    peso += p
    if (ev && valor > 0.75) evidencias.push(ev)
  }

  const simNome = similaridadeNome(novo.nome, cand.nome)
  somar(simNome, 3, {
    campo: "nome",
    descricao: simNome > 0.95 ? `Mesmo nome “${cand.nome}”` : `Nome equivalente a “${cand.nome}”`,
    favoravel: true,
  })

  if (novo.sobrenome && cand.sobrenome) {
    const simSob = similaridadeNome(novo.sobrenome, cand.sobrenome)
    somar(simSob, 2.5, {
      campo: "sobrenome",
      descricao: simSob > 0.95 ? `Mesmo sobrenome “${cand.sobrenome}”` : `Sobrenome equivalente a “${cand.sobrenome}”`,
      favoravel: true,
    })
  }

  const anoNovo = anoDe(novo.dataNascimento)
  const anoCand = anoDe(cand.data_nasc)
  if (anoNovo != null && anoCand != null) {
    const dif = Math.abs(anoNovo - anoCand)
    if (dif > 5) return null // nascimentos incompatíveis
    const valor = dif === 0 ? 1 : dif <= 1 ? 0.8 : dif <= 3 ? 0.45 : 0.15
    somar(valor, 3, {
      campo: "dataNascimento",
      descricao: dif === 0 ? `Mesmo ano de nascimento (${anoCand})` : `Nascimento a ${dif} ano(s) de distância`,
      favoravel: true,
    })
  }

  if (novo.localNascimento && cand.local_nasc) {
    const simLocal = similaridadeLocal(novo.localNascimento, cand.local_nasc)
    somar(simLocal, 1.5, {
      campo: "localNascimento",
      descricao: `Mesma localidade (${cand.local_nasc})`,
      favoravel: true,
    })
  }

  // Filiação: coincidir reforça muito; divergir com ambos conhecidos derruba.
  const paisNovo = [novo.paiId, novo.maeId].filter((x): x is number => x != null)
  const paisCand = [cand.paiId, cand.maeId].filter((x): x is number => x != null)
  if (paisNovo.length && paisCand.length) {
    const comum = paisNovo.filter((x) => paisCand.includes(x)).length
    if (comum > 0) {
      somar(1, 2.5, {
        campo: "filiacao",
        descricao: comum === 2 ? "Mesmos pais cadastrados" : "Um ascendente em comum",
        favoravel: true,
      })
    } else {
      evidencias.push({ campo: "filiacao", descricao: "Filiação diferente", favoravel: false })
      somar(0, 2.5)
    }
  }

  if (peso === 0) return null
  const score = pontos / peso

  const nivel: NivelTriagem =
    score >= LIMIAR_CONFIRMACAO ? "CONFIRMACAO" : score >= LIMIAR_INFORMATIVO ? "INFORMATIVO" : "LIVRE"

  if (nivel === "LIVRE") return null
  return { pessoaId: cand.id, score, nivel, evidencias }
}

const SEVERIDADE: Record<NivelTriagem, number> = {
  BLOQUEIO: 3,
  CONFIRMACAO: 2,
  INFORMATIVO: 1,
  LIVRE: 0,
}

/** Triagem completa contra a lista de candidatos vinda do Cadastro Mestre. */
export function triar(novo: DadosPessoaNova, candidatos: PessoaCandidata[]): ResultadoTriagem {
  const achados: CandidatoDuplicidade[] = []
  for (const c of candidatos) {
    const r = compararCandidato(novo, c)
    if (r) achados.push(r)
  }
  achados.sort((a, b) => b.score - a.score || a.pessoaId - b.pessoaId)

  const nivel = achados.reduce<NivelTriagem>(
    (pior, c) => (SEVERIDADE[c.nivel] > SEVERIDADE[pior] ? c.nivel : pior),
    "LIVRE",
  )

  return {
    nivel,
    candidatos: achados.slice(0, 10),
    chaveDedup: chaveDedupPessoa({
      cpf: novo.cpf,
      nome: [novo.nome, novo.sobrenome].filter(Boolean).join(" "),
      dataNascimento: novo.dataNascimento,
    }),
    criacaoLivre: nivel === "LIVRE" || nivel === "INFORMATIVO",
  }
}

export type DecisaoDedup = "CRIOU_NOVA" | "VINCULOU_EXISTENTE"

export type ErroDedup =
  | "BLOQUEIO_CPF"
  | "DECISAO_OBRIGATORIA"
  | "DECISAO_NAO_CORRESPONDE"
  | "CANDIDATO_INVALIDO"

export type Veredito =
  | { permitido: true; exigeRegistro: boolean }
  | { permitido: false; codigo: ErroDedup; mensagem: string }

/**
 * Decide se a criação pode prosseguir.
 *
 * `BLOQUEIO` (mesmo CPF) não tem escapatória: não existe motivo legítimo para
 * duas Pessoas com o mesmo documento, e sem serviço de fusão o estrago seria
 * permanente. `CONFIRMACAO` exige decisão explícita registrada.
 */
export function avaliarCriacao(
  triagem: ResultadoTriagem,
  decisao: { tipo: DecisaoDedup; justificativa?: string | null; pessoaEscolhidaId?: number | null } | null,
): Veredito {
  if (triagem.nivel === "BLOQUEIO") {
    return {
      permitido: false,
      codigo: "BLOQUEIO_CPF",
      mensagem:
        "Já existe uma Pessoa com este CPF. Vincule a existente — criar uma segunda geraria duplicidade permanente, porque o serviço de fusão ainda não existe.",
    }
  }

  if (triagem.nivel === "CONFIRMACAO") {
    if (!decisao) {
      return {
        permitido: false,
        codigo: "DECISAO_OBRIGATORIA",
        mensagem:
          "Há pessoa muito parecida no Cadastro Mestre. Registre a decisão — vincular a existente ou declarar que nenhuma serve.",
      }
    }
    if (decisao.tipo === "VINCULOU_EXISTENTE") {
      const escolhido = decisao.pessoaEscolhidaId
      if (escolhido == null || !triagem.candidatos.some((c) => c.pessoaId === escolhido)) {
        return {
          permitido: false,
          codigo: "CANDIDATO_INVALIDO",
          mensagem: "A pessoa escolhida não está entre os candidatos apresentados na triagem.",
        }
      }
    } else if (!decisao.justificativa?.trim()) {
      return {
        permitido: false,
        codigo: "DECISAO_NAO_CORRESPONDE",
        mensagem: "Criar apesar de candidato forte exige justificativa escrita.",
      }
    }
    return { permitido: true, exigeRegistro: true }
  }

  // INFORMATIVO e LIVRE: pode criar; registro só quando houve candidato exibido.
  return { permitido: true, exigeRegistro: triagem.candidatos.length > 0 }
}

/** Termos de busca para varrer o Cadastro Mestre atrás de candidatos. */
export function termosBusca(novo: DadosPessoaNova): string[] {
  const termos = new Set<string>()
  if (novo.nome?.trim()) termos.add(novo.nome.trim())
  if (novo.sobrenome?.trim()) termos.add(novo.sobrenome.trim())
  return [...termos]
}

/** Resumo textual da triagem, para auditoria e para a tela. */
export function descreverTriagem(t: ResultadoTriagem): string {
  if (t.nivel === "BLOQUEIO") return "CPF já cadastrado — criação bloqueada"
  if (t.nivel === "CONFIRMACAO") return `${t.candidatos.length} candidato(s) forte(s) — decisão obrigatória`
  if (t.nivel === "INFORMATIVO") return `${t.candidatos.length} candidato(s) parecido(s) — conferir`
  return "Nenhum candidato encontrado"
}

export { chaveDedupPessoa, dataISO }
