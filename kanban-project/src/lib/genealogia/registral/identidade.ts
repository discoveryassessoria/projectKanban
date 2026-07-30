// src/lib/genealogia/registral/identidade.ts
//
// MRG — etapa RESOLVENDO_IDENTIDADES. Pura.
//
// Pergunta que este módulo responde: "esta MENÇÃO num documento é qual PESSOA do
// Cadastro Mestre?". A resposta é conservadora por construção:
//
//   · vincular automaticamente só quando é inequívoco E sem consequência
//     estrutural sensível;
//   · homônimo NUNCA é fundido;
//   · divergência de filiação, data ou local derruba a correspondência;
//   · na dúvida, o motor devolve candidatos e o humano decide.
//
// Reusa `lib/cadastro-mestre/dedup.ts` (MDM-3) como base de comparação de dados
// cadastrais e acrescenta o que o dedup não vê: aliases (nome de casada),
// relações citadas na certidão, referência registral e idade declarada.
// Não redefine limiar de similaridade — importa os do dedup.

import {
  LIMIAR_CONFIRMACAO,
  LIMIAR_INFORMATIVO,
  compararCandidato,
  type PessoaCandidata,
} from "@/src/lib/cadastro-mestre/dedup"
import { anoDe, normalizar, similaridadeLocal, similaridadeNome } from "@/src/lib/genealogia/motor/texto"
import { ehVariacaoDeCasamento, normalizarNome, prenomeDe, sobrenomeDe } from "./normalizacao"
import type {
  ClasseCorrespondencia,
  Correspondencia,
  EvidenciaIdentidade,
  OcorrenciaExtraida,
  PessoaConhecida,
  ResultadoIdentidade,
} from "./tipos"

/** Score a partir do qual a correspondência é CONFIRMADA. */
export const LIMIAR_CONFIRMADA = 0.93
/** Score a partir do qual é ALTAMENTE_PROVAVEL. */
export const LIMIAR_ALTAMENTE_PROVAVEL = LIMIAR_CONFIRMACAO // 0.85
/** Score a partir do qual é POSSIVEL. */
export const LIMIAR_POSSIVEL = LIMIAR_INFORMATIVO // 0.6

export interface ContextoIdentidade {
  /** Pessoas já resolvidas nesta mesma execução/lote (pai/mãe já identificados). */
  paiResolvidoId?: number | null
  maeResolvidoId?: number | null
  conjugeResolvidoId?: number | null
  /** Sujeito a que o documento está anexado — é uma pista forte, não uma prova. */
  pessoaDoDocumentoId?: number | null
  /**
   * Árvore do processo. NÃO altera score: é DESEMPATE. Quando dois candidatos
   * empatam (homônimos em famílias diferentes, situação comum num escritório com
   * centenas de clientes), a pessoa que já está na árvore deste processo é a que
   * o operador precisa ver primeiro — e a que não pode ser cortada pelo teto da
   * lista.
   */
  arvorePreferidaId?: number | null
}

/**
 * Resolve a identidade de UMA ocorrência contra os candidatos do Cadastro Mestre.
 */
export function resolverIdentidade(
  ocorrencia: OcorrenciaExtraida,
  candidatos: PessoaConhecida[],
  ctx: ContextoIdentidade = {},
): ResultadoIdentidade {
  const correspondencias: Correspondencia[] = []

  for (const cand of candidatos) {
    const c = avaliar(ocorrencia, cand, ctx)
    if (c) correspondencias.push(c)
  }

  // Ordem: score desc → candidato da árvore do processo → id (determinismo).
  const daArvore = new Map(candidatos.map((c) => [c.id, c.arvoreId ?? null]))
  const preferida = ctx.arvorePreferidaId ?? null
  const pesoArvore = (id: number) => (preferida != null && daArvore.get(id) === preferida ? 0 : 1)
  correspondencias.sort(
    (a, b) => b.score - a.score || pesoArvore(a.pessoaId) - pesoArvore(b.pessoaId) || a.pessoaId - b.pessoaId,
  )

  const classeFinal = classeMaisForte(correspondencias)
  const veredicto = decidirAutomatico(ocorrencia, correspondencias)

  return {
    correspondencias: correspondencias.slice(0, 10),
    pessoaAutomatica: veredicto.pessoaId,
    classeFinal,
    explicacao: veredicto.explicacao,
  }
}

// ---------------------------------------------------------------- avaliação

function avaliar(
  o: OcorrenciaExtraida,
  p: PessoaConhecida,
  ctx: ContextoIdentidade,
): Correspondencia | null {
  const evidencias: EvidenciaIdentidade[] = []
  let pontos = 0
  let peso = 0
  const somar = (valor: number, w: number, ev?: EvidenciaIdentidade) => {
    pontos += valor * w
    peso += w
    if (ev) evidencias.push(ev)
  }

  // ---- 1. Nome, considerando aliases oficiais (nome de casada, grafia de documento).
  const nomeCompletoPessoa = [p.nome, p.sobrenome].filter(Boolean).join(" ")
  let melhorNome = similaridadeNome(o.nomeNormalizado, nomeCompletoPessoa)
  let viaAlias: string | null = null
  for (const alias of p.aliases ?? []) {
    const formaAlias = [alias.nome, alias.sobrenome].filter(Boolean).join(" ")
    const sim = similaridadeNome(o.nomeNormalizado, formaAlias)
    if (sim > melhorNome) {
      melhorNome = sim
      viaAlias = `${formaAlias} (${alias.tipo})`
    }
  }

  // Variação de casamento: prenome preservado + sobrenome do cônjuge.
  //
  // A verificação roda SEMPRE que há cônjuge citado e as formas diferem — não só
  // quando a similaridade está baixa. Motivo: mesmo quando o nome já bate por
  // continência ("Maria Souza" ⊂ "Maria Souza Bianchi"), a EXPLICAÇÃO precisa
  // dizer que se trata de nome de casada. Sem essa evidência, o operador vê uma
  // correspondência sem entender por que o sobrenome mudou — e é justamente esse
  // caso que costuma virar pessoa duplicada. O score só é elevado quando estava
  // abaixo do limiar: a evidência é informativa, não um bônus cumulativo.
  let viaCasamento = false
  if (o.atributos.nomeConjuge && normalizar(nomeCompletoPessoa) !== normalizar(o.nomeNormalizado)) {
    const r = ehVariacaoDeCasamento(nomeCompletoPessoa, o.nomeNormalizado, o.atributos.nomeConjuge)
    if (r.compativel) {
      viaCasamento = true
      if (melhorNome < LIMIAR_ALTAMENTE_PROVAVEL) melhorNome = 0.88
      evidencias.push({
        campo: "nome_casado",
        descricao: `Nome compatível com variação de casamento: ${r.motivo}`,
        favoravel: true,
        peso: 2,
      })
    }
  }

  if (melhorNome < 0.5) return null // nomes sem relação: não é candidato

  somar(melhorNome, 3, {
    campo: "nome",
    descricao: viaAlias
      ? `Nome bate com forma alternativa registrada: ${viaAlias}`
      : melhorNome > 0.97
        ? `Mesmo nome “${nomeCompletoPessoa}”`
        : `Nome equivalente a “${nomeCompletoPessoa}” (${(melhorNome * 100).toFixed(0)}%)`,
    favoravel: true,
    peso: 3,
  })

  // ---- 2. Sexo: divergência derruba (papel no documento é objetivo).
  const sexoO = (o.sexoInferido || "").charAt(0).toUpperCase()
  const sexoP = (p.sexo || "").charAt(0).toUpperCase()
  if (sexoO && sexoP && sexoO !== sexoP) {
    return {
      pessoaId: p.id,
      classe: "PESSOAS_DISTINTAS",
      score: 0,
      evidencias: [
        ...evidencias,
        { campo: "sexo", descricao: "Sexo incompatível com o papel no documento", favoravel: false, peso: 5 },
      ],
      motivoBloqueio: "Sexo incompatível.",
    }
  }

  // ---- 3. Datas
  let conflitoData = false
  const anoNascO = anoDe(o.atributos.dataNascimento)
  const anoNascP = anoDe(p.data_nasc)
  if (anoNascO != null && anoNascP != null) {
    const dif = Math.abs(anoNascO - anoNascP)
    if (dif > 3) {
      conflitoData = true
      evidencias.push({
        campo: "dataNascimento",
        descricao: `Nascimento declarado ${anoNascO} contra ${anoNascP} no cadastro (${dif} anos)`,
        favoravel: false,
        peso: 4,
      })
      somar(0, 3)
    } else {
      somar(dif === 0 ? 1 : dif === 1 ? 0.85 : 0.5, 3, {
        campo: "dataNascimento",
        descricao: dif === 0 ? `Mesmo ano de nascimento (${anoNascP})` : `Nascimento a ${dif} ano(s) de distância`,
        favoravel: true,
        peso: 3,
      })
    }
  }

  const anoObitoO = anoDe(o.atributos.dataObito)
  const anoObitoP = anoDe(p.data_obito)
  if (anoObitoO != null && anoObitoP != null) {
    const dif = Math.abs(anoObitoO - anoObitoP)
    if (dif > 1) {
      conflitoData = true
      evidencias.push({
        campo: "dataObito",
        descricao: `Óbito declarado ${anoObitoO} contra ${anoObitoP} no cadastro`,
        favoravel: false,
        peso: 4,
      })
      somar(0, 2)
    } else {
      somar(1, 2, { campo: "dataObito", descricao: "Óbito coincidente", favoravel: true, peso: 2 })
    }
  }

  // Idade declarada × data de nascimento cadastrada (evidência independente).
  if (o.atributos.idadeDeclarada != null && anoNascP != null && o.atributos.dataObito) {
    const anoEvento = anoDe(o.atributos.dataObito)
    if (anoEvento != null) {
      const idadeEsperada = anoEvento - anoNascP
      const dif = Math.abs(idadeEsperada - o.atributos.idadeDeclarada)
      if (dif <= 2) {
        somar(1, 1.5, {
          campo: "idadeDeclarada",
          descricao: `Idade declarada (${o.atributos.idadeDeclarada}) compatível com o nascimento cadastrado`,
          favoravel: true,
          peso: 1.5,
        })
      } else if (dif > 5) {
        evidencias.push({
          campo: "idadeDeclarada",
          descricao: `Idade declarada (${o.atributos.idadeDeclarada}) incompatível: esperada ${idadeEsperada}`,
          favoravel: false,
          peso: 2,
        })
        somar(0, 1.5)
      }
    }
  }

  // ---- 4. Local de nascimento
  if (o.atributos.localNascimento && p.local_nasc) {
    const sim = similaridadeLocal(o.atributos.localNascimento, p.local_nasc)
    if (sim >= 0.6) {
      somar(sim, 1.5, {
        campo: "localNascimento",
        descricao: `Localidade compatível (${p.local_nasc})`,
        favoravel: true,
        peso: 1.5,
      })
    } else {
      evidencias.push({
        campo: "localNascimento",
        descricao: `Localidade divergente: “${o.atributos.localNascimento}” contra “${p.local_nasc}”`,
        favoravel: false,
        peso: 2,
      })
      somar(0, 1.5)
    }
  }

  // ---- 5. FILIAÇÃO — a evidência mais decisiva em genealogia.
  const filiacao = compararFiliacao(o, p, ctx)
  if (filiacao) {
    somar(filiacao.valor, 4, filiacao.evidencia)
    if (!filiacao.evidencia.favoravel) conflitoData = conflitoData || filiacao.conflito
  }

  // ---- 6. Relações citadas (cônjuge/filhos já conhecidos)
  if (ctx.conjugeResolvidoId != null && (p.conjugesIds ?? []).includes(ctx.conjugeResolvidoId)) {
    somar(1, 2.5, {
      campo: "conjuge",
      descricao: "Cônjuge citado no documento já é cônjuge desta pessoa no cadastro",
      favoravel: true,
      peso: 2.5,
    })
  }

  // ---- 7. Profissão (evidência fraca, mas discrimina homônimo)
  if (o.atributos.profissao && p.profissao) {
    const sim = similaridadeNome(o.atributos.profissao, p.profissao)
    if (sim > 0.85) {
      somar(1, 0.8, {
        campo: "profissao",
        descricao: `Profissão coincidente (${p.profissao})`,
        favoravel: true,
        peso: 0.8,
      })
    }
  }

  // ---- 8. Reforço do dedup cadastral (MDM-3) — mesma escala, sem redefinir nada.
  const nome = normalizarNome(o.nomeNormalizado)
  const viaDedup = compararCandidato(
    {
      nome: nome ? prenomeDe(nome.completo) || nome.completo : o.nomeNormalizado,
      sobrenome: nome ? sobrenomeDe(nome.completo) : null,
      sexo: o.sexoInferido,
      dataNascimento: o.atributos.dataNascimento ?? null,
      localNascimento: o.atributos.localNascimento ?? null,
      paiId: ctx.paiResolvidoId ?? null,
      maeId: ctx.maeResolvidoId ?? null,
    },
    toCandidata(p),
  )
  if (viaDedup) {
    somar(viaDedup.score, 1.5, {
      campo: "triagem_mdm3",
      descricao: `Triagem do Cadastro Mestre classificou como ${viaDedup.nivel} (${(viaDedup.score * 100).toFixed(0)}%)`,
      favoravel: true,
      peso: 1.5,
    })
  }

  if (peso === 0) return null
  const score = pontos / peso

  const contrarias = evidencias.filter((e) => !e.favoravel)
  const classe = classificar(score, contrarias, conflitoData, {
    temFiliacaoCoincidente: evidencias.some((e) => e.campo === "filiacao" && e.favoravel),
    viaCasamento,
  })

  return {
    pessoaId: p.id,
    classe,
    score,
    evidencias,
    motivoBloqueio: motivoBloqueio(classe, contrarias),
  }
}

function toCandidata(p: PessoaConhecida): PessoaCandidata {
  return {
    id: p.id,
    nome: p.nome,
    sobrenome: p.sobrenome ?? null,
    sexo: p.sexo ?? null,
    cpf: p.cpf ?? null,
    data_nasc: p.data_nasc ?? null,
    local_nasc: p.local_nasc ?? null,
    paiId: p.paiId ?? null,
    maeId: p.maeId ?? null,
    arvoreId: p.arvoreId ?? null,
  }
}

interface ResultadoFiliacao {
  valor: number
  conflito: boolean
  evidencia: EvidenciaIdentidade
}

function compararFiliacao(
  o: OcorrenciaExtraida,
  p: PessoaConhecida,
  ctx: ContextoIdentidade,
): ResultadoFiliacao | null {
  // (a) Filiação por ID já resolvido nesta execução — sinal mais forte.
  const idsCtx = [ctx.paiResolvidoId, ctx.maeResolvidoId].filter((x): x is number => x != null)
  const idsP = [p.paiId, p.maeId].filter((x): x is number => x != null)
  if (idsCtx.length && idsP.length) {
    const comuns = idsCtx.filter((x) => idsP.includes(x)).length
    if (comuns > 0) {
      return {
        valor: 1,
        conflito: false,
        evidencia: {
          campo: "filiacao",
          descricao: comuns === 2 ? "Mesmos pais já cadastrados" : "Um genitor em comum já cadastrado",
          favoravel: true,
          peso: 4,
        },
      }
    }
    // Ambas as filiações conhecidas e sem interseção: são pessoas distintas.
    if (idsCtx.length === 2 && idsP.length === 2) {
      return {
        valor: 0,
        conflito: true,
        evidencia: {
          campo: "filiacao",
          descricao: "Filiação cadastrada é diferente da citada no documento",
          favoravel: false,
          peso: 5,
        },
      }
    }
  }

  // (b) Filiação por NOME: compara o genitor citado na certidão com o genitor
  //     cadastrado. É o desempate clássico entre homônimos.
  const paresNome: Array<[string | null | undefined, string | null | undefined, string]> = [
    [o.atributos.nomePai, p.nomePai, "pai"],
    [o.atributos.nomeMae, p.nomeMae, "mãe"],
  ]
  let coincidentes = 0
  let divergentes = 0
  const detalhes: string[] = []
  for (const [citado, cadastrado, rotulo] of paresNome) {
    if (!citado || !cadastrado) continue
    const sim = similaridadeNome(citado, cadastrado)
    if (sim >= 0.9) {
      coincidentes++
      detalhes.push(`${rotulo} coincide (“${cadastrado}”)`)
    } else if (sim < 0.6) {
      divergentes++
      detalhes.push(`${rotulo} divergente: “${citado}” contra “${cadastrado}”`)
    }
  }

  if (coincidentes === 0 && divergentes === 0) return null

  if (divergentes > 0 && coincidentes === 0) {
    return {
      valor: 0,
      conflito: true,
      evidencia: {
        campo: "filiacao",
        descricao: `Filiação citada no documento não corresponde à cadastrada — ${detalhes.join("; ")}`,
        favoravel: false,
        peso: divergentes === 2 ? 5 : 3,
      },
    }
  }

  return {
    valor: divergentes > 0 ? 0.5 : coincidentes === 2 ? 1 : 0.8,
    conflito: false,
    evidencia: {
      campo: "filiacao",
      descricao: `Filiação compatível — ${detalhes.join("; ")}`,
      favoravel: true,
      peso: 4,
    },
  }
}

function classificar(
  score: number,
  contrarias: EvidenciaIdentidade[],
  conflitoData: boolean,
  extra: { temFiliacaoCoincidente: boolean; viaCasamento: boolean },
): ClasseCorrespondencia {
  // Evidência contrária forte manda, independentemente do score: é a regra que
  // impede homônimo com filiação diferente de virar "mesma pessoa".
  const pesoContra = contrarias.reduce((s, e) => s + e.peso, 0)
  if (pesoContra >= 5) return "PESSOAS_DISTINTAS"
  if (pesoContra >= 2 || conflitoData) return "REGISTROS_CONFLITANTES"

  if (score >= LIMIAR_CONFIRMADA && extra.temFiliacaoCoincidente) return "CORRESPONDENCIA_CONFIRMADA"
  if (score >= LIMIAR_CONFIRMADA) return "ALTAMENTE_PROVAVEL"
  if (score >= LIMIAR_ALTAMENTE_PROVAVEL) return "ALTAMENTE_PROVAVEL"
  if (score >= LIMIAR_POSSIVEL) return "POSSIVEL"
  return "PESSOAS_DISTINTAS"
}

function motivoBloqueio(classe: ClasseCorrespondencia, contrarias: EvidenciaIdentidade[]): string | null {
  if (classe === "CORRESPONDENCIA_CONFIRMADA") return null
  if (classe === "REGISTROS_CONFLITANTES") {
    return `Há evidência contrária: ${contrarias.map((c) => c.descricao).join("; ")}`
  }
  if (classe === "PESSOAS_DISTINTAS") return "As evidências indicam pessoas distintas."
  return "Correspondência não é inequívoca — decisão humana obrigatória."
}

function classeMaisForte(cs: Correspondencia[]): ClasseCorrespondencia {
  if (!cs.length) return "PESSOAS_DISTINTAS"
  const ordem: ClasseCorrespondencia[] = [
    "CORRESPONDENCIA_CONFIRMADA",
    "ALTAMENTE_PROVAVEL",
    "POSSIVEL",
    "REGISTROS_CONFLITANTES",
    "PESSOAS_DISTINTAS",
  ]
  for (const cl of ordem) {
    if (cs.some((c) => c.classe === cl)) return cl
  }
  return "PESSOAS_DISTINTAS"
}

/**
 * O PORTÃO da vinculação automática.
 *
 * Só vincula sozinho quando existe UMA correspondência confirmada e nenhuma
 * outra correspondência com força suficiente para ser confundida com ela. Dois
 * candidatos fortes = homônimo, e homônimo é decisão humana, sempre.
 */
export function decidirAutomatico(
  o: OcorrenciaExtraida,
  cs: Correspondencia[],
): { pessoaId: number | null; explicacao: string } {
  const confirmadas = cs.filter((c) => c.classe === "CORRESPONDENCIA_CONFIRMADA")
  const fortes = cs.filter(
    (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
  )
  const conflitantes = cs.filter((c) => c.classe === "REGISTROS_CONFLITANTES")

  if (confirmadas.length === 1 && fortes.length === 1 && conflitantes.length === 0) {
    return {
      pessoaId: confirmadas[0].pessoaId,
      explicacao: `“${o.nomeBruto}” (${o.papel}) vinculado automaticamente: correspondência única e confirmada por nome, filiação e datas coincidentes.`,
    }
  }

  if (fortes.length > 1) {
    return {
      pessoaId: null,
      explicacao: `“${o.nomeBruto}” (${o.papel}) tem ${fortes.length} candidatos fortes no Cadastro Mestre — possível homônimo. Vinculação automática bloqueada; decisão humana obrigatória.`,
    }
  }
  if (conflitantes.length) {
    return {
      pessoaId: null,
      explicacao: `“${o.nomeBruto}” (${o.papel}) tem candidato com registro conflitante. O motor não escolhe: conflito aberto para revisão.`,
    }
  }
  if (fortes.length === 1) {
    return {
      pessoaId: null,
      explicacao: `“${o.nomeBruto}” (${o.papel}) tem correspondência altamente provável, mas sem filiação confirmada. Proposta de vínculo criada para aprovação.`,
    }
  }
  if (cs.some((c) => c.classe === "POSSIVEL")) {
    return {
      pessoaId: null,
      explicacao: `“${o.nomeBruto}” (${o.papel}) tem apenas correspondência possível. Nada é aplicado automaticamente.`,
    }
  }
  return {
    pessoaId: null,
    explicacao: `“${o.nomeBruto}” (${o.papel}) não corresponde a nenhuma pessoa cadastrada — candidata a nova pessoa (proposta).`,
  }
}

/**
 * Verifica se uma FUSÃO de pessoas pode ser proposta como aplicável.
 * Sempre devolve `false` em `podeAutomatico` — fusão é bloqueio por definição —
 * e enumera os impedimentos, que é o que a tela e a auditoria precisam ver.
 */
export function avaliarFusao(params: {
  a: PessoaConhecida
  b: PessoaConhecida
  score: number
  requerentesAfetados: number
  processosAfetados: number
  afetaLinhaCidadania: boolean
}): { podeAutomatico: false; impedimentos: string[]; recomendacao: string } {
  const imp: string[] = []
  const { a, b } = params

  const nomeA = [a.nome, a.sobrenome].filter(Boolean).join(" ")
  const nomeB = [b.nome, b.sobrenome].filter(Boolean).join(" ")
  if (similaridadeNome(nomeA, nomeB) > 0.97 && anoDe(a.data_nasc) == null && anoDe(b.data_nasc) == null) {
    imp.push("Homônimo sem data de nascimento nos dois lados — não há como distinguir identidade de coincidência.")
  }

  const paisA = [a.paiId, a.maeId].filter((x): x is number => x != null)
  const paisB = [b.paiId, b.maeId].filter((x): x is number => x != null)
  if (paisA.length && paisB.length && !paisA.some((x) => paisB.includes(x))) {
    imp.push("Filiação divergente entre os dois registros.")
  }

  const anoA = anoDe(a.data_nasc)
  const anoB = anoDe(b.data_nasc)
  if (anoA != null && anoB != null && Math.abs(anoA - anoB) > 1) {
    imp.push(`Datas de nascimento divergentes (${anoA} × ${anoB}).`)
  }

  if (a.local_nasc && b.local_nasc && similaridadeLocal(a.local_nasc, b.local_nasc) < 0.6) {
    imp.push(`Locais de nascimento divergentes (“${a.local_nasc}” × “${b.local_nasc}”).`)
  }

  if (a.cpf && b.cpf && normalizar(a.cpf).replace(/\D/g, "") !== normalizar(b.cpf).replace(/\D/g, "")) {
    imp.push("CPFs diferentes — são pessoas distintas.")
  }

  if (params.requerentesAfetados > 0) imp.push(`${params.requerentesAfetados} requerente(s) dependem destes registros.`)
  if (params.processosAfetados > 1) imp.push(`A fusão impacta ${params.processosAfetados} processos.`)
  if (params.afetaLinhaCidadania) imp.push("A fusão altera a linha de transmissão da cidadania.")
  if (params.score < LIMIAR_CONFIRMADA) imp.push(`Score de identidade insuficiente (${(params.score * 100).toFixed(0)}%).`)

  return {
    podeAutomatico: false,
    impedimentos: imp,
    recomendacao: imp.length
      ? "Fusão bloqueada. Resolva os impedimentos e registre decisão humana com permissão de fusão."
      : "Fusão possível somente por decisão humana com permissão dedicada, após análise de impacto.",
  }
}
