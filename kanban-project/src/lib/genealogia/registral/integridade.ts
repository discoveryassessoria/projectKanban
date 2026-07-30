// src/lib/genealogia/registral/integridade.ts
//
// MRG — MOTOR DE INTEGRIDADE GENEALÓGICA (requisito 8 do escopo). Puro.
//
// Este módulo cobre as inconsistências ESTRUTURAIS e BIOLÓGICAS que o motor
// genealógico anterior não cobria (ciclo, autoancestralidade, vínculo duplicado,
// geração quebrada, requerente duplicado, ascendente repetido, divergência entre
// árvore/cadastro/certidão). Ele NÃO reimplementa as regras de cronologia que já
// existem em `motor/regras/cronologia.ts` e `motor/regras/duplicidade.ts` — as
// invoca e traduz para o vocabulário registral (severidade + evidência + ação),
// que é o que a proposta e o conflito precisam.
//
// Toda inconsistência devolvida tem: código estável, severidade, explicação,
// ação sugerida e evidências. Sem esses quatro, o achado não existe.

import { construirGrafo, type GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import { analisarCronologia } from "@/src/lib/genealogia/motor/regras/cronologia"
import { analisarDuplicidade } from "@/src/lib/genealogia/motor/regras/duplicidade"
import type { Insight, PessoaEntrada, Severidade, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { anoDe, nomeCompleto, similaridadeLocal, similaridadeNome } from "@/src/lib/genealogia/motor/texto"
import type { CampoRegistral, Inconsistencia, SeveridadeRegistral } from "./tipos"

export interface EntradaIntegridade {
  pessoas: PessoaEntrada[]
  unioes: UniaoEntrada[]
  /** Pessoas marcadas como requerente no processo (podem ser mais de uma). */
  requerenteIds: number[]
  /**
   * Fatos registrais ATIVOS, para confrontar árvore × certidão.
   * Vem do banco, mas entra como dado puro.
   */
  fatos?: FatoParaIntegridade[]
}

export interface FatoParaIntegridade {
  pessoaId: number | null
  uniaoId: number | null
  campo: CampoRegistral
  valorNormalizado: string | null
  valorData: string | null
  estado: string
  documentoIds: number[]
}

const MAX_IDADE_MATERNA = 55
const MIN_IDADE_MATERNA = 11
const MAX_IDADE_PATERNA = 80
const MIN_IDADE_PATERNA = 12
const MAX_LONGEVIDADE = 115

/**
 * Roda TODAS as regras de integridade. Determinístico: mesma árvore → mesma
 * lista, na mesma ordem.
 */
export function verificarIntegridade(entrada: EntradaIntegridade): Inconsistencia[] {
  const g = construirGrafo(entrada.pessoas, entrada.unioes)
  const achados: Inconsistencia[] = []

  achados.push(...ciclos(g))
  achados.push(...autoAncestralidade(g))
  achados.push(...filiacaoContraditoria(g))
  achados.push(...idadesBiologicas(g))
  achados.push(...longevidade(g))
  achados.push(...casamentoAposObito(g, entrada.unioes))
  achados.push(...obitoAntesNascimento(g))
  achados.push(...vinculosDuplicados(entrada.unioes))
  achados.push(...conjugesIncompativeis(g, entrada.unioes))
  achados.push(...geracoesQuebradas(g, entrada.requerenteIds))
  achados.push(...ascendentesRepetidos(g, entrada.requerenteIds))
  achados.push(...requerentesDuplicados(g, entrada.requerenteIds))
  achados.push(...paisEsperadoAusente(g, entrada.requerenteIds))
  achados.push(...divergenciaArvoreCertidao(g, entrada.fatos ?? []))
  achados.push(...traduzirInsights(g))

  // Determinismo + prioridade: severidade desc, depois código, depois ids.
  const ordem: Record<SeveridadeRegistral, number> = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAIXO: 3, INFO: 4 }
  achados.sort(
    (a, b) =>
      ordem[a.severidade] - ordem[b.severidade] ||
      a.codigo.localeCompare(b.codigo) ||
      (a.pessoaIds[0] ?? 0) - (b.pessoaIds[0] ?? 0),
  )
  return dedupAchados(achados)
}

function dedupAchados(l: Inconsistencia[]): Inconsistencia[] {
  const vistos = new Set<string>()
  const out: Inconsistencia[] = []
  for (const a of l) {
    const k = `${a.codigo}|${[...a.pessoaIds].sort((x, y) => x - y).join(",")}|${a.campo ?? ""}`
    if (vistos.has(k)) continue
    vistos.add(k)
    out.push(a)
  }
  return out
}

// ---------------------------------------------------------------- regras

/** CICLO: A é ancestral de B e B é ancestral de A. */
function ciclos(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  const cor = new Map<number, 0 | 1 | 2>() // 0=branco 1=cinza 2=negro
  const pilha: number[] = []

  const visitar = (id: number): void => {
    cor.set(id, 1)
    pilha.push(id)
    const p = g.pessoa(id)
    if (p) {
      for (const pid of [p.paiId, p.maeId]) {
        if (pid == null || !g.existe(pid)) continue
        const c = cor.get(pid) ?? 0
        if (c === 1) {
          const inicio = pilha.indexOf(pid)
          const ciclo = pilha.slice(inicio >= 0 ? inicio : 0)
          const nomes = ciclo.map((x) => nomeCompleto(g.pessoa(x)!)).join(" → ")
          out.push({
            codigo: "CICLO_GENEALOGICO",
            severidade: "CRITICO",
            pessoaIds: ciclo,
            descricao: "Ciclo na cadeia de filiação",
            explicacao: `A filiação forma um ciclo fechado: ${nomes} → ${nomeCompleto(g.pessoa(pid)!)}. Isso é impossível e trava qualquer cálculo de linhagem.`,
            acaoSugerida: "Conferir a filiação de cada pessoa do ciclo na certidão de nascimento e desfazer o vínculo incorreto.",
            evidencias: [`Cadeia: ${nomes}`],
          })
        } else if (c === 0) {
          visitar(pid)
        }
      }
    }
    pilha.pop()
    cor.set(id, 2)
  }

  for (const p of g.pessoas) if ((cor.get(p.id) ?? 0) === 0) visitar(p.id)
  return out
}

/** AUTOANCESTRALIDADE: pessoa é pai/mãe de si mesma. */
function autoAncestralidade(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const p of g.pessoas) {
    if (p.paiId === p.id || p.maeId === p.id) {
      out.push({
        codigo: "PESSOA_ANCESTRAL_DE_SI",
        severidade: "CRITICO",
        pessoaIds: [p.id],
        descricao: `${nomeCompleto(p)} está registrada como ascendente de si mesma`,
        explicacao: "O campo de pai ou mãe aponta para a própria pessoa.",
        acaoSugerida: "Remover o vínculo incorreto e recadastrar a filiação com base na certidão.",
        evidencias: [`paiId=${p.paiId ?? "-"} maeId=${p.maeId ?? "-"} id=${p.id}`],
      })
    }
  }
  return out
}

/** FILIAÇÃO CONTRADITÓRIA: pai e mãe são a mesma pessoa; sexo incompatível. */
function filiacaoContraditoria(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const p of g.pessoas) {
    if (p.paiId != null && p.paiId === p.maeId) {
      out.push({
        codigo: "FILIACAO_CONTRADITORIA",
        severidade: "CRITICO",
        pessoaIds: [p.id, p.paiId],
        descricao: `${nomeCompleto(p)} tem a mesma pessoa como pai e como mãe`,
        explicacao: "Os dois campos de filiação apontam para o mesmo registro.",
        acaoSugerida: "Conferir a certidão de nascimento e corrigir um dos dois vínculos.",
        evidencias: [`paiId=maeId=${p.paiId}`],
      })
      continue
    }
    const pai = g.pai(p.id)
    if (pai && (pai.sexo || "").toUpperCase().startsWith("F")) {
      out.push({
        codigo: "FILIACAO_SEXO_INCOMPATIVEL",
        severidade: "ALTO",
        pessoaIds: [p.id, pai.id],
        campo: "FILIACAO_PAI",
        descricao: `${nomeCompleto(pai)} está no campo "pai" mas está cadastrada como do sexo feminino`,
        explicacao: "O papel de filiação e o sexo cadastrado se contradizem — um dos dois está errado.",
        acaoSugerida: "Conferir na certidão qual é o papel correto e corrigir o cadastro.",
        evidencias: [`pai.sexo=${pai.sexo}`],
      })
    }
    const mae = g.mae(p.id)
    if (mae && (mae.sexo || "").toUpperCase().startsWith("M")) {
      out.push({
        codigo: "FILIACAO_SEXO_INCOMPATIVEL",
        severidade: "ALTO",
        pessoaIds: [p.id, mae.id],
        campo: "FILIACAO_MAE",
        descricao: `${nomeCompleto(mae)} está no campo "mãe" mas está cadastrado como do sexo masculino`,
        explicacao: "O papel de filiação e o sexo cadastrado se contradizem — um dos dois está errado.",
        acaoSugerida: "Conferir na certidão qual é o papel correto e corrigir o cadastro.",
        evidencias: [`mae.sexo=${mae.sexo}`],
      })
    }
  }
  return out
}

/** IDADE BIOLÓGICA: filho antes dos pais, pais muito novos/velhos. */
function idadesBiologicas(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const p of g.pessoas) {
    const anoFilho = anoDe(p.data_nasc)
    if (anoFilho == null) continue

    for (const [genitor, rotulo, min, max, campo] of [
      [g.pai(p.id), "pai", MIN_IDADE_PATERNA, MAX_IDADE_PATERNA, "FILIACAO_PAI"],
      [g.mae(p.id), "mãe", MIN_IDADE_MATERNA, MAX_IDADE_MATERNA, "FILIACAO_MAE"],
    ] as Array<[PessoaEntrada | null, string, number, number, CampoRegistral]>) {
      if (!genitor) continue
      const anoGenitor = anoDe(genitor.data_nasc)
      if (anoGenitor == null) continue
      const idade = anoFilho - anoGenitor

      if (idade < 0) {
        out.push({
          codigo: "FILHO_NASCIDO_ANTES_DO_GENITOR",
          severidade: "CRITICO",
          pessoaIds: [p.id, genitor.id],
          campo,
          descricao: `${nomeCompleto(p)} nasceu antes do ${rotulo} ${nomeCompleto(genitor)}`,
          explicacao: `Nascimento do filho em ${anoFilho} e do ${rotulo} em ${anoGenitor}. Ou a filiação está errada, ou uma das datas está errada.`,
          acaoSugerida: "Conferir as duas certidões de nascimento antes de usar este vínculo na linha.",
          evidencias: [`filho=${anoFilho}`, `${rotulo}=${anoGenitor}`],
        })
        continue
      }
      if (idade < min) {
        out.push({
          codigo: "GENITOR_IDADE_IMPOSSIVEL",
          severidade: "CRITICO",
          pessoaIds: [p.id, genitor.id],
          campo,
          descricao: `${nomeCompleto(genitor)} teria ${idade} anos ao nascimento de ${nomeCompleto(p)}`,
          explicacao: `Idade biologicamente incompatível para ${rotulo} (mínimo considerado: ${min} anos).`,
          acaoSugerida: "Conferir datas e filiação; é comum haver uma geração faltando entre os dois.",
          evidencias: [`idade_calculada=${idade}`, `limite_min=${min}`],
        })
      } else if (idade > max) {
        out.push({
          codigo: "GENITOR_IDADE_IMPROVAVEL",
          severidade: rotulo === "mãe" ? "ALTO" : "MEDIO",
          pessoaIds: [p.id, genitor.id],
          campo,
          descricao: `${nomeCompleto(genitor)} teria ${idade} anos ao nascimento de ${nomeCompleto(p)}`,
          explicacao: `Idade acima do limite considerado plausível para ${rotulo} (${max} anos). Costuma indicar geração faltando ou homônimo.`,
          acaoSugerida: "Verificar se há um homônimo na linha ou uma geração intermediária não cadastrada.",
          evidencias: [`idade_calculada=${idade}`, `limite_max=${max}`],
        })
      }
    }
  }
  return out
}

/** LONGEVIDADE: intervalo nascimento→óbito acima do plausível. */
function longevidade(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const p of g.pessoas) {
    const nasc = anoDe(p.data_nasc)
    const obito = anoDe(p.data_obito)
    if (nasc == null || obito == null) continue
    const anos = obito - nasc
    if (anos > MAX_LONGEVIDADE) {
      out.push({
        codigo: "LONGEVIDADE_IMPLAUSIVEL",
        severidade: "ALTO",
        pessoaIds: [p.id],
        descricao: `${nomeCompleto(p)} teria vivido ${anos} anos`,
        explicacao: `Nascimento em ${nasc} e óbito em ${obito}. Acima de ${MAX_LONGEVIDADE} anos é praticamente sempre erro de leitura de data ou fusão de dois homônimos.`,
        acaoSugerida: "Conferir as duas datas nas certidões; verificar se dois registros distintos foram tratados como a mesma pessoa.",
        evidencias: [`nascimento=${nasc}`, `obito=${obito}`],
      })
    }
  }
  return out
}

/** CASAMENTO APÓS ÓBITO de um dos cônjuges. */
function casamentoAposObito(g: GrafoGenealogico, unioes: UniaoEntrada[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const u of unioes) {
    const ano = anoDe(u.data_inicio)
    if (ano == null) continue
    for (const pid of [u.pessoa1Id, u.pessoa2Id]) {
      if (pid == null) continue
      const p = g.pessoa(pid)
      const obito = anoDe(p?.data_obito)
      if (p && obito != null && ano > obito) {
        out.push({
          codigo: "CASAMENTO_APOS_OBITO",
          severidade: "CRITICO",
          pessoaIds: [p.id],
          uniaoIds: [u.id],
          campo: "DATA_CASAMENTO",
          descricao: `União registrada em ${ano}, após o óbito de ${nomeCompleto(p)} em ${obito}`,
          explicacao: "Uma das duas datas está errada, ou a união pertence a outro registro.",
          acaoSugerida: "Conferir a certidão de casamento e a de óbito antes de usar qualquer das duas na linha.",
          evidencias: [`uniao=${ano}`, `obito=${obito}`],
        })
      }
    }
  }
  return out
}

/** ÓBITO ANTERIOR AO NASCIMENTO. */
function obitoAntesNascimento(g: GrafoGenealogico): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const p of g.pessoas) {
    const nasc = anoDe(p.data_nasc)
    const obito = anoDe(p.data_obito)
    if (nasc == null || obito == null) continue
    if (obito < nasc) {
      out.push({
        codigo: "OBITO_ANTES_DO_NASCIMENTO",
        severidade: "CRITICO",
        pessoaIds: [p.id],
        descricao: `${nomeCompleto(p)} tem óbito (${obito}) anterior ao nascimento (${nasc})`,
        explicacao: "Impossível. Uma das datas foi trocada ou lida errado.",
        acaoSugerida: "Conferir as duas certidões e corrigir a data incorreta.",
        evidencias: [`nascimento=${nasc}`, `obito=${obito}`],
      })
    }
  }
  return out
}

/** VÍNCULO DUPLICADO: duas Uniões para o mesmo par. */
function vinculosDuplicados(unioes: UniaoEntrada[]): Inconsistencia[] {
  const porPar = new Map<string, UniaoEntrada[]>()
  for (const u of unioes) {
    if (u.pessoa1Id == null || u.pessoa2Id == null) continue
    const a = Math.min(u.pessoa1Id, u.pessoa2Id)
    const b = Math.max(u.pessoa1Id, u.pessoa2Id)
    const k = `${a}:${b}`
    const arr = porPar.get(k)
    if (arr) arr.push(u)
    else porPar.set(k, [u])
  }
  const out: Inconsistencia[] = []
  for (const [k, lista] of porPar) {
    if (lista.length < 2) continue
    const [a, b] = k.split(":").map(Number)
    out.push({
      codigo: "VINCULO_DUPLICADO",
      severidade: "MEDIO",
      pessoaIds: [a, b],
      uniaoIds: lista.map((u) => u.id),
      descricao: "O mesmo par de pessoas tem mais de uma união cadastrada",
      explicacao: `Existem ${lista.length} uniões entre as mesmas duas pessoas. Isso duplica exigência documental e distorce o progresso do dossiê.`,
      acaoSugerida: "Manter a união com a referência registral correta e consolidar as demais por decisão humana.",
      evidencias: lista.map((u) => `uniaoId=${u.id} inicio=${u.data_inicio ?? "-"}`),
    })
  }
  return out
}

/** CÔNJUGES INCOMPATÍVEIS: união entre ascendente e descendente. */
function conjugesIncompativeis(g: GrafoGenealogico, unioes: UniaoEntrada[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const u of unioes) {
    if (u.pessoa1Id == null || u.pessoa2Id == null) continue
    const asc1 = g.ancestrais(u.pessoa1Id)
    if (asc1.has(u.pessoa2Id)) {
      out.push(uniaoAscendente(g, u, u.pessoa2Id, u.pessoa1Id))
      continue
    }
    const asc2 = g.ancestrais(u.pessoa2Id)
    if (asc2.has(u.pessoa1Id)) out.push(uniaoAscendente(g, u, u.pessoa1Id, u.pessoa2Id))
  }
  return out
}

function uniaoAscendente(
  g: GrafoGenealogico,
  u: UniaoEntrada,
  ascendenteId: number,
  descendenteId: number,
): Inconsistencia {
  const asc = g.pessoa(ascendenteId)
  const desc = g.pessoa(descendenteId)
  return {
    codigo: "CONJUGES_INCOMPATIVEIS",
    severidade: "CRITICO",
    pessoaIds: [ascendenteId, descendenteId],
    uniaoIds: [u.id],
    descricao: `União cadastrada entre ${asc ? nomeCompleto(asc) : ascendenteId} e seu descendente ${desc ? nomeCompleto(desc) : descendenteId}`,
    explicacao: "A união liga uma pessoa a um descendente dela própria — indica vínculo de filiação incorreto ou pessoas duplicadas tratadas como uma.",
    acaoSugerida: "Revisar a filiação e a união; provavelmente há dois homônimos representados como a mesma pessoa.",
    evidencias: [`uniaoId=${u.id}`, `ascendente=${ascendenteId}`, `descendente=${descendenteId}`],
  }
}

/** GERAÇÃO QUEBRADA: salto de geração incompatível com as datas. */
function geracoesQuebradas(g: GrafoGenealogico, requerenteIds: number[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const reqId of requerenteIds) {
    if (!g.existe(reqId)) continue
    for (const id of [reqId, ...g.ancestrais(reqId)]) {
      const p = g.pessoa(id)
      if (!p) continue
      const anoP = anoDe(p.data_nasc)
      if (anoP == null) continue
      for (const genitor of g.paisDe(id)) {
        const anoG = anoDe(genitor.data_nasc)
        if (anoG == null) continue
        const salto = anoP - anoG
        if (salto >= 60) {
          out.push({
            codigo: "GERACAO_QUEBRADA",
            // MEDIO, não ALTO: um intervalo grande entre gerações é SUSPEITA de
            // geração faltando, não contradição. Paternidade tardia existe. O que
            // é biologicamente impossível já é coberto por
            // GENITOR_IDADE_IMPOSSIVEL e FILHO_NASCIDO_ANTES_DO_GENITOR. Marcar
            // isto como ALTO classificava como "linha conflitante" toda linha em
            // que houve um pai idoso — e conflito que não é conflito treina o
            // operador a ignorar o alerta.
            severidade: "MEDIO",
            pessoaIds: [id, genitor.id],
            descricao: `Salto de ${salto} anos entre ${nomeCompleto(genitor)} e ${nomeCompleto(p)}`,
            explicacao: "Um intervalo desse tamanho entre gerações consecutivas normalmente significa que falta uma geração entre as duas pessoas.",
            acaoSugerida: "Buscar a certidão de nascimento da pessoa mais nova e conferir o nome dos pais — pode haver um homônimo intermediário.",
            evidencias: [`salto_anos=${salto}`],
          })
        }
      }
    }
  }
  return out
}

/** ASCENDENTE REPETIDO INDEVIDAMENTE na linha do requerente. */
function ascendentesRepetidos(g: GrafoGenealogico, requerenteIds: number[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const reqId of requerenteIds) {
    if (!g.existe(reqId)) continue
    // Conta em quantos caminhos ascendentes distintos a mesma pessoa aparece.
    const contagem = new Map<number, number>()
    const caminhar = (id: number, visitados: Set<number>) => {
      const p = g.pessoa(id)
      if (!p) return
      for (const pid of [p.paiId, p.maeId]) {
        if (pid == null || !g.existe(pid)) continue
        if (visitados.has(pid)) continue
        contagem.set(pid, (contagem.get(pid) ?? 0) + 1)
        caminhar(pid, new Set([...visitados, pid]))
      }
    }
    caminhar(reqId, new Set([reqId]))
    for (const [id, n] of contagem) {
      if (n < 2) continue
      const p = g.pessoa(id)
      out.push({
        codigo: "ASCENDENTE_REPETIDO",
        severidade: "MEDIO",
        pessoaIds: [id, reqId],
        descricao: `${p ? nomeCompleto(p) : id} aparece ${n} vezes na ascendência de um mesmo requerente`,
        explicacao: "Isso ocorre legitimamente em casamento entre parentes, mas na maioria dos casos indica vínculo de filiação incorreto ou pessoa duplicada.",
        acaoSugerida: "Confirmar a filiação nos dois ramos antes de calcular a linha de transmissão.",
        evidencias: [`ocorrencias_na_ascendencia=${n}`],
      })
    }
  }
  return out
}

/** REQUERENTES DUPLICADOS: dois requerentes que são provavelmente a mesma pessoa. */
function requerentesDuplicados(g: GrafoGenealogico, requerenteIds: number[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  const ids = [...new Set(requerenteIds)].filter((id) => g.existe(id))
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = g.pessoa(ids[i])!
      const b = g.pessoa(ids[j])!
      const sim = similaridadeNome(nomeCompleto(a), nomeCompleto(b))
      if (sim < 0.9) continue
      const anoA = anoDe(a.data_nasc)
      const anoB = anoDe(b.data_nasc)
      const datasCompativeis = anoA == null || anoB == null || Math.abs(anoA - anoB) <= 1
      if (!datasCompativeis) continue
      out.push({
        codigo: "REQUERENTE_DUPLICADO",
        severidade: "ALTO",
        pessoaIds: [a.id, b.id],
        descricao: `Dois requerentes com nome equivalente: ${nomeCompleto(a)} e ${nomeCompleto(b)}`,
        explicacao: `Similaridade de ${(sim * 100).toFixed(0)}% e datas compatíveis. Se forem a mesma pessoa, o processo tem requerente contado em dobro.`,
        acaoSugerida: "Confirmar documentos dos dois; se for a mesma pessoa, registrar decisão de identidade (fusão exige permissão dedicada).",
        evidencias: [`similaridade=${sim.toFixed(3)}`, `nasc_a=${anoA ?? "-"}`, `nasc_b=${anoB ?? "-"}`],
      })
    }
  }
  return out
}

/** PESSOA SEM PAI OU MÃE quando é esperado (está na ascendência do requerente). */
function paisEsperadoAusente(g: GrafoGenealogico, requerenteIds: number[]): Inconsistencia[] {
  const out: Inconsistencia[] = []
  const naLinha = new Set<number>()
  for (const id of requerenteIds) {
    if (!g.existe(id)) continue
    naLinha.add(id)
    for (const a of g.ancestrais(id)) naLinha.add(a)
  }
  for (const id of naLinha) {
    const p = g.pessoa(id)
    if (!p) continue
    const semPai = p.paiId == null
    const semMae = p.maeId == null
    if (!semPai && !semMae) continue
    // Topo da linha sem ascendente não é inconsistência: é a fronteira da pesquisa.
    const ehTopo = semPai && semMae
    out.push({
      codigo: ehTopo ? "LINHA_INTERROMPIDA" : "FILIACAO_INCOMPLETA",
      severidade: ehTopo ? "ALTO" : "MEDIO",
      pessoaIds: [id],
      campo: semPai ? "FILIACAO_PAI" : "FILIACAO_MAE",
      descricao: ehTopo
        ? `${nomeCompleto(p)} não tem pai nem mãe cadastrados`
        : `${nomeCompleto(p)} está sem ${semPai ? "pai" : "mãe"} cadastrado(a)`,
      explicacao: ehTopo
        ? "A pessoa está na ascendência de um requerente e a linha para nela."
        : "Falta um dos genitores de alguém que está na ascendência de um requerente — a exigência documental fica incompleta.",
      acaoSugerida: "Localizar a certidão de nascimento (ou casamento) desta pessoa para obter a filiação.",
      evidencias: [`paiId=${p.paiId ?? "-"}`, `maeId=${p.maeId ?? "-"}`],
    })
  }
  return out
}

/**
 * DIVERGÊNCIA ÁRVORE × CERTIDÃO: o fato registral extraído do documento
 * contradiz o que está no cadastro da pessoa.
 */
function divergenciaArvoreCertidao(
  g: GrafoGenealogico,
  fatos: FatoParaIntegridade[],
): Inconsistencia[] {
  const out: Inconsistencia[] = []
  for (const f of fatos) {
    if (f.pessoaId == null || !f.valorNormalizado) continue
    const p = g.pessoa(f.pessoaId)
    if (!p) continue

    const doCadastro = valorDoCadastro(p, f.campo)
    if (!doCadastro) continue

    const divergente = !valoresCompativeis(f.campo, doCadastro, f.valorNormalizado, f.valorData)
    if (!divergente) continue

    out.push({
      codigo: "DIVERGENCIA_ARVORE_CERTIDAO",
      severidade: campoCriticoParaDivergencia(f.campo) ? "ALTO" : "MEDIO",
      pessoaIds: [f.pessoaId],
      campo: f.campo,
      descricao: `${nomeCompleto(p)}: o documento diz “${f.valorNormalizado}” e o cadastro diz “${doCadastro}”`,
      explicacao: "Há evidência documental que contradiz o dado cadastrado. O motor não sobrescreve dado registral: registra a divergência.",
      acaoSugerida: "Revisar a evidência e decidir — corrigir o cadastro, aceitar variação ou solicitar retificação do documento.",
      evidencias: [
        `campo=${f.campo}`,
        `valor_documento=${f.valorNormalizado}`,
        `valor_cadastro=${doCadastro}`,
        ...f.documentoIds.map((d) => `documentoId=${d}`),
      ],
    })
  }
  return out
}

function campoCriticoParaDivergencia(c: CampoRegistral): boolean {
  return (
    c === "NOME_REGISTRAL" ||
    c === "DATA_NASCIMENTO" ||
    c === "FILIACAO_PAI" ||
    c === "FILIACAO_MAE" ||
    c === "DATA_OBITO"
  )
}

export function valorDoCadastro(p: PessoaEntrada, campo: CampoRegistral): string | null {
  switch (campo) {
    case "NOME_REGISTRAL":
      return nomeCompleto(p)
    case "DATA_NASCIMENTO":
      return p.data_nasc ? String(p.data_nasc).slice(0, 10) : null
    case "DATA_OBITO":
      return p.data_obito ? String(p.data_obito).slice(0, 10) : null
    case "LOCAL_NASCIMENTO":
      return p.local_nasc ?? null
    case "PAIS_NASCIMENTO":
      return p.pais_nasc ?? null
    case "DATA_BATISMO":
      return p.data_batismo ? String(p.data_batismo).slice(0, 10) : null
    case "LOCAL_BATISMO":
      return p.local_batismo ?? null
    case "PROFISSAO":
      return p.profissao ?? null
    case "NACIONALIDADE":
      return p.nacionalidade ?? null
    case "SEXO":
      return p.sexo ?? null
    case "NATURALIZACAO":
      return p.data_naturalizacao ? String(p.data_naturalizacao).slice(0, 10) : null
    case "DATA_EMIGRACAO":
      return p.data_emigracao ? String(p.data_emigracao).slice(0, 10) : null
    default:
      return null
  }
}

export function valoresCompativeis(
  campo: CampoRegistral,
  cadastro: string,
  documento: string,
  dataDocumento: string | null,
): boolean {
  if (campo === "DATA_NASCIMENTO" || campo === "DATA_OBITO" || campo === "DATA_BATISMO" || campo === "NATURALIZACAO" || campo === "DATA_EMIGRACAO") {
    const a = cadastro.slice(0, 10)
    const b = (dataDocumento ?? documento).slice(0, 10)
    return a === b
  }
  if (campo === "NOME_REGISTRAL" || campo === "FILIACAO_PAI" || campo === "FILIACAO_MAE" || campo === "CONJUGE") {
    return similaridadeNome(cadastro, documento) >= 0.92
  }
  if (campo === "LOCAL_NASCIMENTO" || campo === "LOCAL_BATISMO" || campo === "PAIS_NASCIMENTO" || campo === "LOCAL_OBITO" || campo === "LOCAL_CASAMENTO") {
    return similaridadeLocal(cadastro, documento) >= 0.7
  }
  return similaridadeNome(cadastro, documento) >= 0.9
}

/**
 * Traduz para o vocabulário registral os insights que as regras JÁ EXISTENTES do
 * motor genealógico produzem (cronologia e duplicidade). Nenhuma regra é
 * reimplementada: só reclassificada.
 */
function traduzirInsights(g: GrafoGenealogico): Inconsistencia[] {
  const insights: Insight[] = [
    ...analisarCronologia(g),
    ...analisarDuplicidade(g),
  ]
  return insights.map((i) => ({
    codigo: `MOTOR_${i.categoria.toUpperCase()}_${i.id.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`.slice(0, 60),
    severidade: mapaSeveridade(i.severidade),
    pessoaIds: i.pessoaIds,
    uniaoIds: i.uniaoIds,
    descricao: i.titulo,
    explicacao: i.explicacao,
    acaoSugerida: i.acao ?? "Revisar o achado do motor genealógico.",
    evidencias: [`origem=motor_genealogico`, `regra=${i.id}`, `confianca=${i.confianca ?? "-"}`],
  }))
}

function mapaSeveridade(s: Severidade): SeveridadeRegistral {
  switch (s) {
    case "critico":
      return "CRITICO"
    case "alto":
      return "ALTO"
    case "medio":
      return "MEDIO"
    case "baixo":
      return "BAIXO"
    default:
      return "INFO"
  }
}
