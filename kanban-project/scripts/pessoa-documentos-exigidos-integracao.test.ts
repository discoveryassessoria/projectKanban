// scripts/pessoa-documentos-exigidos-integracao.test.ts
// ============================================================================
// Pessoa.documentosExigidos — INTEGRAÇÃO (rotas reais, token de administrador, banco de TESTE).
//   decisão 1  filtro SUBTRATIVO: marcar sem o fato na árvore NÃO cria nada;
//   decisão 2  (REVISTA em 01/10/2026) o filtro vale para QUALQUER pessoa — linha reta, requerente e fora da linhagem;
//   decisão 3  Casamento (união): ao menos um cônjuge mantém;
//   decisão 4  zero por escolha manual: avanço automático recusado, humano permitido; zero natural inalterado;
//   decisão 5  a_iniciar: nada nasce nem é dispensado; ao mover nasce só o marcado;
//   decisão 6  API: validação, só-grava-se-mudou, auditoria, preview.
//
//   node scripts/ci/gate-build.mjs --suite todas --so pessoa-documentos-exigidos-integracao
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("pessoa-documentos-exigidos-integracao.test.ts")

import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { calcularExigenciasDaGenealogia, materializarGenealogia } from "../src/services/genealogia/materializar-genealogia"
import { atenderNecessidade, iniciarAtendimentoNecessidade } from "../src/services/necessidade-documental"
import { genealogiaZeradaPorEscolhaManual } from "../src/services/genealogia/zero-por-escolha"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { advance } from "../src/lib/motor/phase-advance"
import { reconciliarMotorDeFases } from "../src/lib/motor/reconciliar-motor-fases"
import { verificacaoPorCodigo } from "../lib/saude/catalogo"
import "../lib/saude/verificacoes/genealogia"
import "../lib/saude/verificacoes/agendados"

const MARCA = "PDEX"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n} ${extra}`) } }
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  const P = criarPalco(MARCA)
  await P.limpar()
  await P.montar()
  await P.montarMacroDuasFases()
  // As regras do palco miram a LINHA RETA; aqui precisam alcançar também quem está FORA dela (é a quem o filtro se aplica).
  await prisma.matrizDocumental.updateMany({
    where: { codigo: { in: [P.RULE.NAS, P.RULE.CAS, P.RULE.OBI] } },
    data: { publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE", publicosAlvo: ["TODAS_AS_PESSOAS_DA_ARVORE"] },
  })

  const calc = async (processoId: number) => (await calcularExigenciasDaGenealogia(processoId))!
  const tem = (c: Awaited<ReturnType<typeof calc>>, k: "NAS" | "CAS" | "OBI", alvo: { pessoaId?: number; uniaoId?: number }) =>
    c.exigencias.some((e) => e.chave.includes(`::rd:${P.RULE[k]}:`) && (alvo.pessoaId != null ? e.pessoaId === alvo.pessoaId : e.uniaoId === alvo.uniaoId))
  const removida = (c: Awaited<ReturnType<typeof calc>>, k: "NAS" | "CAS" | "OBI", alvo: { pessoaId?: number; uniaoId?: number }) =>
    c.removidasPorEscolha.some((e) => e.chave.includes(`::rd:${P.RULE[k]}:`) && (alvo.pessoaId != null ? e.pessoaId === alvo.pessoaId : e.uniaoId === alvo.uniaoId))
  const gravado = async (id: number) => (await prisma.pessoa.findUniqueOrThrow({ where: { id }, select: { documentosExigidos: true } })).documentosExigidos
  const putDocs = (id: number, docs: unknown, extra: Record<string, unknown> = {}) => P.putPessoa(id, { documentosExigidos: docs, ...extra })
  const nLogs = (id: number) => prisma.logAuditoria.count({ where: { acao: "PESSOA_DOCUMENTOS_EXIGIDOS_ALTERADOS", entidade: "Pessoa", entidadeId: id } })

  /** Família: titular + cônjuge unidos (ambos casados). `fora=true` tira o titular da linha reta e do requerente (os dois FORA). */
  async function familia(nome: string, fora: boolean) {
    const c = await P.novoCenario(nome, { conjuge: true })
    if (fora) await prisma.pessoa.update({ where: { id: c.titularId }, data: { linhaReta: false, requerente: "nao" } })
    const u = await prisma.uniao.create({ data: { pessoa1Id: c.titularId, pessoa2Id: c.conjugeId!, tipo: "casamento_civil" }, select: { id: true } })
    await prisma.pessoa.updateMany({ where: { id: { in: [c.titularId, c.conjugeId!] } }, data: { casado: true } })
    await materializarGenealogia(c.processoId)
    return { ...c, uniaoId: u.id }
  }

  // ───────────────────────────────────────────────────────────────────────────
  secao("A) Decisão 1/2/3 — titular na LINHA PRINCIPAL (requerente) + cônjuge FORA da linhagem")
  const A = await familia("A", false)
  let c = await calc(A.processoId)
  ok("PRÉ-CONDIÇÃO: Nascimento do titular, Nascimento da cônjuge e Casamento da união são exigidos pela regra automática", tem(c, "NAS", { pessoaId: A.titularId }) && tem(c, "NAS", { pessoaId: A.conjugeId! }) && tem(c, "CAS", { uniaoId: A.uniaoId }))
  ok("EQUIVALÊNCIA: campo NULL em todos ⇒ nada removido por escolha e o conjunto é o de hoje", c.removidasPorEscolha.length === 0 && c.exigencias.filter((e) => e.chave.includes(`::rd:${P.RULE.OBI}:`)).length === 0)
  const chavesNull = c.exigencias.map((e) => e.chave).sort().join("|")

  let r = await putDocs(A.conjugeId!, ["NAS"])
  ok("PUT cônjuge {documentosExigidos:[NAS]} → 200", r.status === 200, String(r.status))
  ok("gravado como ['NAS']", JSON.stringify(await gravado(A.conjugeId!)) === '["NAS"]')
  c = await calc(A.processoId)
  ok("cônjuge segue com Nascimento", tem(c, "NAS", { pessoaId: A.conjugeId! }))
  ok("Casamento da união FICA (o titular está na linha principal ⇒ conta como marcado — decisão 3)", tem(c, "CAS", { uniaoId: A.uniaoId }))

  const necNasConj = (await P.foto(A.processoId)).necDe("NAS", { pessoaId: A.conjugeId! })[0]
  r = await putDocs(A.conjugeId!, [])
  ok("PUT cônjuge {documentosExigidos:[]} (lista vazia) → 200", r.status === 200, String(r.status))
  c = await calc(A.processoId)
  ok("Nascimento da cônjuge sai e vira 'removida por escolha'", !tem(c, "NAS", { pessoaId: A.conjugeId! }) && removida(c, "NAS", { pessoaId: A.conjugeId! }))
  let d = await P.derivados(necNasConj.id)
  ok("necessidade PENDENTE dispensada, Documento NAO_EXIGIDO, passo e tarefa fechados (as quatro camadas)", d.status === "DISPENSADA" && d.docs.every((x) => x.status === "NAO_EXIGIDO") && d.passosVivos === 0 && d.tarefasAbertas === 0, JSON.stringify(d))
  ok("titular (linha principal) e a união continuam exigidos", tem(c, "NAS", { pessoaId: A.titularId }) && tem(c, "CAS", { uniaoId: A.uniaoId }))
  ok("a exigência NÃO zerou (há exigência real) ⇒ não é 'zero por escolha'", !(await genealogiaZeradaPorEscolhaManual(A.processoId)).zerada)

  r = await putDocs(A.conjugeId!, ["NAS", "CAS", "OBI"])
  ok("remarcar os três → 200 e grava NULL (enviado igual aos três = NULL)", r.status === 200 && (await gravado(A.conjugeId!)) === null)
  d = await P.derivados(necNasConj.id)
  ok("remarcar REATIVA a MESMA linha (mesma necessidade, PENDENTE, mesmo Documento, passo e tarefa de volta)", d.status === "PENDENTE" && d.docs.length === 1 && d.passosVivos === 1 && d.tarefasAbertas === 1 && (await P.foto(A.processoId)).necDe("NAS", { pessoaId: A.conjugeId! }).length === 1, JSON.stringify(d))
  c = await calc(A.processoId)
  ok("EQUIVALÊNCIA: depois de ida e volta o conjunto é idêntico ao do campo NULL", c.exigencias.map((e) => e.chave).sort().join("|") === chavesNull && c.removidasPorEscolha.length === 0)

  await prisma.pessoa.update({ where: { id: A.titularId }, data: { documentosExigidos: [] } })
  c = await calc(A.processoId)
  ok("LINHA PRINCIPAL/REQUERENTE APLICA o filtro: titular com lista [] tem o Nascimento removido por escolha", !tem(c, "NAS", { pessoaId: A.titularId }) && removida(c, "NAS", { pessoaId: A.titularId }))
  // PELA ROTA REAL (o que a tela envia): o titular é REQUERENTE e da LINHA RETA — a lista tem de ser aceita e GRAVADA para ele.
  r = await putDocs(A.titularId, ["NAS", "OBI"])
  ok("PUT do titular (requerente / linha reta) com ['NAS','OBI'] → 200 e a lista FICA GRAVADA (era descartada pela tela)", r.status === 200 && JSON.stringify(await gravado(A.titularId)) === '["NAS","OBI"]', String(r.status))
  c = await calc(A.processoId)
  ok("titular da linha principal com ['NAS','OBI']: Nascimento fica; Casamento da UNIÃO fica (a cônjuge sem lista sustenta)", tem(c, "NAS", { pessoaId: A.titularId }) && tem(c, "CAS", { uniaoId: A.uniaoId }))
  r = await putDocs(A.titularId, ["NAS", "CAS", "OBI"])
  ok("remarcar os três no titular → 200 e volta a NULL (regra automática)", r.status === 200 && (await gravado(A.titularId)) === null)
  await prisma.pessoa.update({ where: { id: A.titularId }, data: { documentosExigidos: undefined as never } }).catch(() => null)
  await prisma.$executeRawUnsafe(`UPDATE "Pessoa" SET "documentosExigidos" = NULL WHERE id = ${A.titularId}`)

  secao("A2) Sem o fato na árvore, marcar NADA cria")
  r = await putDocs(A.conjugeId!, ["NAS", "OBI"])
  c = await calc(A.processoId)
  ok("cônjuge viva com Óbito marcado: nenhum Óbito é criado", !tem(c, "OBI", { pessoaId: A.conjugeId! }) && c.exigencias.filter((e) => e.chave.includes(`::rd:${P.RULE.OBI}:`)).length === 0)
  ok("e Casamento fora da lista (cônjuge) tira só o que a árvore pedia — a união fica pelo titular", tem(c, "CAS", { uniaoId: A.uniaoId }))
  await putDocs(A.conjugeId!, ["NAS", "CAS", "OBI"])

  // ───────────────────────────────────────────────────────────────────────────
  secao("B) Decisão 3 — união com os DOIS cônjuges FORA da linhagem")
  const B = await familia("B", true)
  c = await calc(B.processoId)
  ok("PRÉ-CONDIÇÃO: os dois FORA ⇒ Casamento da união exigido", tem(c, "CAS", { uniaoId: B.uniaoId }) && tem(c, "NAS", { pessoaId: B.titularId }) && tem(c, "NAS", { pessoaId: B.conjugeId! }))
  await putDocs(B.titularId, ["NAS", "OBI"])
  c = await calc(B.processoId)
  ok("titular desmarca Casamento, cônjuge (NULL = automático) mantém ⇒ a união FICA", tem(c, "CAS", { uniaoId: B.uniaoId }))
  const necCasB = (await P.foto(B.processoId)).necDe("CAS", { uniaoId: B.uniaoId })[0]
  await putDocs(B.conjugeId!, ["NAS", "OBI"])
  c = await calc(B.processoId)
  ok("os dois desmarcam Casamento ⇒ a união SOME (removida por escolha)", !tem(c, "CAS", { uniaoId: B.uniaoId }) && removida(c, "CAS", { uniaoId: B.uniaoId }))
  d = await P.derivados(necCasB.id)
  ok("necessidade de união PENDENTE dispensada (Documento NAO_EXIGIDO, tarefa fechada)", d.status === "DISPENSADA" && d.docs.every((x) => x.status === "NAO_EXIGIDO") && d.tarefasAbertas === 0, JSON.stringify(d))
  ok("'casou depois': casado=true e união existente, mas sem Casamento marcado em nenhum ⇒ nada nasce", !tem(c, "CAS", { uniaoId: B.uniaoId }))
  await putDocs(B.conjugeId!, ["NAS", "CAS", "OBI"])
  c = await calc(B.processoId)
  ok("um cônjuge volta a marcar Casamento ⇒ a união volta (mesma necessidade reativada)", tem(c, "CAS", { uniaoId: B.uniaoId }) && (await P.foto(B.processoId)).necDe("CAS", { uniaoId: B.uniaoId }).length === 1 && (await P.derivados(necCasB.id)).status === "PENDENTE")
  await putDocs(B.titularId, ["NAS", "OBI"])
  await P.putPessoa(B.conjugeId!, { documentacao: false })
  c = await calc(B.processoId)
  ok("cônjuge com documentação DESLIGADA não sustenta a união: titular sem Casamento ⇒ some", !tem(c, "CAS", { uniaoId: B.uniaoId }))
  await P.putPessoa(B.conjugeId!, { documentacao: true })

  secao("B2) 'Faleceu depois' — Óbito só nasce se estiver marcado")
  await putDocs(B.titularId, ["NAS", "CAS"])
  await P.putPessoa(B.titularId, { vivo: false })
  c = await calc(B.processoId)
  ok("titular falece com Óbito desmarcado ⇒ nenhum Óbito", !tem(c, "OBI", { pessoaId: B.titularId }) && removida(c, "OBI", { pessoaId: B.titularId }))
  await putDocs(B.titularId, ["NAS", "CAS", "OBI"])
  c = await calc(B.processoId)
  ok("marcar Óbito de novo ⇒ o Óbito nasce (a árvore o pede)", tem(c, "OBI", { pessoaId: B.titularId }))

  // ───────────────────────────────────────────────────────────────────────────
  secao("C) Tipo que já ANDOU fica e gera ARV-002")
  const necAndou = (await P.foto(B.processoId)).necDe("NAS", { pessoaId: B.conjugeId! })[0]
  await iniciarAtendimentoNecessidade(necAndou.id) // pelo serviço dono: a necessidade ANDOU (PENDENTE → EM_ATENDIMENTO)
  await putDocs(B.conjugeId!, ["OBI"], { confirmarRemocaoDeCertidao: true, motivoRemocaoDeCertidao: "decisão do operador no teste C" }) // certidão que já andou: decisão humana explícita
  d = await P.derivados(necAndou.id)
  ok("Nascimento EM_ATENDIMENTO NÃO é dispensado ao desmarcar (fato acontecido)", d.status === "EM_ATENDIMENTO", String(d.status))
  const arv = await verificacaoPorCodigo("ARV-002")!.executar({} as never)
  ok("ARV-002 aponta a necessidade que andou e perdeu a causa", arv.achados.some((a) => a.chave === `ARV-002:nec:${necAndou.id}`), arv.achados.map((a) => a.chave).join(","))
  await putDocs(B.conjugeId!, null)

  // ───────────────────────────────────────────────────────────────────────────
  secao("D) Decisão 4 — todos desmarcados: o processo NÃO avança sozinho")
  // Para o gate poder abrir é preciso um REQUERENTE na árvore (titular, linha principal). As regras passam a mirar só quem está
  // FORA da linha reta, e o casal deixa de ser casado: assim a única exigência é a da cônjuge — e é ela que a escolha zera.
  const REGRAS = [P.RULE.NAS, P.RULE.CAS, P.RULE.OBI]
  const alvoDasRegras = (publico: "PESSOA_FORA_DA_LINHA_RETA" | "TODAS_AS_PESSOAS_DA_ARVORE") => prisma.matrizDocumental.updateMany({ where: { codigo: { in: REGRAS } }, data: { publicoAlvo: publico, publicosAlvo: [publico] } })
  await alvoDasRegras("PESSOA_FORA_DA_LINHA_RETA")
  const arquivarReq = (arquivado: boolean) => prisma.matrizDocumental.updateMany({ where: { codigo: P.RULE.REQ }, data: { arquivado } })
  await arquivarReq(true) // a certidão do requerente (regra REQ) também é exigência real; fica de fora só deste cenário
  const D = await familia("D", false)
  await prisma.pessoa.updateMany({ where: { id: { in: [D.titularId, D.conjugeId!] } }, data: { casado: false } })
  await materializarGenealogia(D.processoId)
  ok("PRÉ-CONDIÇÃO: antes da escolha só a cônjuge tem exigência (Nascimento)", (await calc(D.processoId)).exigencias.length === 1)
  ok("PRÉ-CONDIÇÃO: o avanço automático é decidido pelo gate (há exigência real ⇒ não é zero por escolha)", !(await genealogiaZeradaPorEscolhaManual(D.processoId)).zerada)
  await putDocs(D.conjugeId!, [])
  c = await calc(D.processoId)
  ok("exigência zerou e a escolha manual removeu algo", c.exigencias.length === 0 && c.removidasPorEscolha.length >= 1, `${c.exigencias.length}/${c.removidasPorEscolha.length}`)
  const z = await genealogiaZeradaPorEscolhaManual(D.processoId)
  ok("genealogiaZeradaPorEscolhaManual = true (zero POR ESCOLHA)", z.zerada && z.removidasPorEscolha >= 1)
  for (const origem of ["cron-reconciliacao", "reconciliacao", "recalcular", undefined]) {
    const a = await advance(D.processoId, origem ? { origem } : {})
    ok(`advance(origem=${origem ?? "(ausente)"}) → REJEITADO AVANCO_MANUAL_OBRIGATORIO`, !a.success && a.code === "AVANCO_MANUAL_OBRIGATORIO" && /desmarcados/.test(a.message ?? ""), a.success ? "AVANÇOU" : `${a.code}: ${a.message}`)
  }
  const rec = await reconciliarMotorDeFases(D.processoId, { origem: "cron-reconciliacao" })
  ok("reconciliarMotorDeFases (cron): nenhuma transição, segue na Genealogia", rec.transicoes.length === 0 && rec.faseFinal === "genealogia", `${rec.code}/${rec.faseFinal}`)
  ok("a fase não mudou", (await prisma.processo.findUniqueOrThrow({ where: { id: D.processoId }, select: { faseAtualKey: true } })).faseAtualKey === "genealogia")
  const saudeCron = await verificacaoPorCodigo("CRON-005")!.executar({} as never)
  ok("Saúde CRON-005 NÃO acusa 'pode avançar e não avançou' para ele", !saudeCron.achados.some((a) => a.registroId === String(D.processoId)))
  const humano = await advance(D.processoId, { origem: "avancar-fase" })
  ok("avanço MANUAL humano continua permitido (não barrado pela trava de escolha)", !(!humano.success && humano.code === "AVANCO_MANUAL_OBRIGATORIO" && /desmarcados/.test(humano.message ?? "")), humano.success ? "avançou" : `${humano.code}: ${humano.message} ${JSON.stringify(!humano.success && "blockingIssues" in humano ? humano.blockingIssues?.map((b) => b.code) : [])}`)
  ok("e, com o gate aberto, ele realmente sai da Genealogia", humano.success === true, humano.success ? "" : `${humano.code}: ${humano.message} ${JSON.stringify("blockingIssues" in humano ? humano.blockingIssues?.map((b) => b.code) : [])}`)

  // D3) CASO REAL (processo 688, 01/10/2026): havia certidão JÁ CONCLUÍDA (ATENDIDA) e a pessoa desmarcou tudo. A trava contava a
  // necessidade ATENDIDA como "viva" e se desligava; o gate via tudo concluído e o processo seguia sozinho para Análise Documental.
  secao("D3) Certidão já concluída + todos desmarcados: continua sendo decisão humana")
  await alvoDasRegras("PESSOA_FORA_DA_LINHA_RETA")
  await arquivarReq(true)
  const D3 = await familia("D3", false)
  await prisma.pessoa.updateMany({ where: { id: { in: [D3.titularId, D3.conjugeId!] } }, data: { casado: false } })
  await materializarGenealogia(D3.processoId)
  const necD3 = (await prisma.necessidadeDocumental.findMany({ where: { processoId: D3.processoId, pessoaId: D3.conjugeId!, supersedePorId: null, status: { not: "DISPENSADA" } }, select: { id: true } }))
  ok("PRÉ-CONDIÇÃO: a cônjuge tem exatamente 1 necessidade viva", necD3.length === 1, String(necD3.length))
  await atenderNecessidade(necD3[0].id)
  // REGRA FIXA (06/10/2026): tirar certidão que já andou é decisão humana explícita (confirmação + motivo).
  const semConfirmar = await putDocs(D3.conjugeId!, [])
  ok("D3: sem confirmação a remoção da certidão já atendida é recusada (409)", semConfirmar.status === 409)
  await putDocs(D3.conjugeId!, [], { confirmarRemocaoDeCertidao: true, motivoRemocaoDeCertidao: "decisão do operador no teste D3" })
  const c3 = await calc(D3.processoId)
  ok("exigência zerou, a escolha removeu algo e a necessidade segue ATENDIDA (fato acontecido não se desfaz)", c3.exigencias.length === 0 && c3.removidasPorEscolha.length >= 1 && (await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: necD3[0].id }, select: { status: true } })).status === "ATENDIDA")
  ok("genealogiaZeradaPorEscolhaManual = true mesmo com certidão concluída", (await genealogiaZeradaPorEscolhaManual(D3.processoId)).zerada)
  for (const origem of ["cron-reconciliacao", "reconciliacao", "recalcular", "arvore", undefined]) {
    const a = await advance(D3.processoId, origem ? { origem } : {})
    ok(`advance(origem=${origem ?? "(ausente)"}) → REJEITADO AVANCO_MANUAL_OBRIGATORIO`, !a.success && a.code === "AVANCO_MANUAL_OBRIGATORIO", a.success ? "AVANÇOU" : `${a.code}: ${a.message}`)
  }
  const rec3 = await reconciliarMotorDeFases(D3.processoId, { origem: "cron-reconciliacao" })
  ok("reconciliarMotorDeFases: segue na Genealogia", rec3.transicoes.length === 0 && rec3.faseFinal === "genealogia", `${rec3.code}/${rec3.faseFinal}`)

  await alvoDasRegras("TODAS_AS_PESSOAS_DA_ARVORE")
  await arquivarReq(false)
  secao("D2) Zero NATURAL (árvore sem exigência, nenhuma escolha) mantém o comportamento de hoje")
  const N = await P.novoCenario("N", {})
  await prisma.pessoa.update({ where: { id: N.titularId }, data: { linhaReta: false, requerente: "nao", documentacao: false } })
  await materializarGenealogia(N.processoId)
  const cn = await calc(N.processoId)
  ok("sem exigência e sem nada removido por escolha", cn.exigencias.length === 0 && cn.removidasPorEscolha.length === 0)
  ok("NÃO é 'zero por escolha'", !(await genealogiaZeradaPorEscolhaManual(N.processoId)).zerada)
  const an = await advance(N.processoId, { origem: "cron-reconciliacao" })
  ok("o avanço automático NÃO é recusado por esta trava (a decisão é do gate, como sempre)", an.success || !/desmarcados/.test(an.message ?? ""), `${an.success ? "avançou" : an.code + ": " + an.message}`)

  // ───────────────────────────────────────────────────────────────────────────
  secao("E) Decisão 5 — 'Aguardando fechamento' (a_iniciar): nada nasce, nada é dispensado")
  const E = await familia("E", true)
  const antes = await P.foto(E.processoId)
  const necCas = antes.necDe("CAS", { uniaoId: E.uniaoId })[0]
  await prisma.processo.update({ where: { id: E.processoId }, data: { faseAtualKey: "a_iniciar" } })
  const res = await materializarGenealogia(E.processoId)
  ok("materializarGenealogia em a_iniciar: retorno antecipado, sem dispensar nem criar", res.aguardandoFechamento === true && res.dispensadas === 0 && res.necessidadesCriadas === 0 && res.fatos.length === 0)
  r = await putDocs(E.titularId, [])
  ok("marcar/desmarcar em a_iniciar responde 200 e só grava a escolha", r.status === 200 && JSON.stringify(await gravado(E.titularId)) === "[]", String(r.status))
  const meio = await P.foto(E.processoId)
  ok("necessidade existente NÃO foi dispensada nem criada outra (nem documento, passo ou tarefa mudaram)", JSON.stringify(meio.necs) === JSON.stringify(antes.necs) && meio.docs.length === antes.docs.length && meio.passos.length === antes.passos.length && meio.tarefas.length === antes.tarefas.length)
  ok("(prova) o núcleo calcula a exigência sem o titular — mas ninguém a aplicou", !tem(await calc(E.processoId), "NAS", { pessoaId: E.titularId }))
  const F = await P.novoCenario("F", { conjuge: true })
  await prisma.pessoa.update({ where: { id: F.titularId }, data: { linhaReta: false, requerente: "nao" } })
  await prisma.processo.update({ where: { id: F.processoId }, data: { faseAtualKey: "a_iniciar" } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: F.processoId } })
  await putDocs(F.conjugeId!, ["OBI"])
  await putDocs(F.titularId, ["NAS"])
  const fotoF = await P.foto(F.processoId)
  ok("processo NOVO em a_iniciar: zero necessidade, zero documento, zero passo, zero tarefa", fotoF.necs.length === 0 && fotoF.passos.length === 0 && fotoF.tarefas.length === 0 && fotoF.docs.filter((x) => x.necessidadeId != null).length === 0, JSON.stringify({ n: fotoF.necs.length, p: fotoF.passos.length, t: fotoF.tarefas.length }))
  await prisma.processo.update({ where: { id: F.processoId }, data: { faseAtualKey: "genealogia" } })
  await prisma.phaseWorkflowInstance.create({ data: { processoId: F.processoId, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-instF-${F.processoId}` } })
  await materializarExecucaoDaFase({ processoId: F.processoId, fonte: "MOVIMENTACAO_MANUAL" })
  const depoisF = await P.foto(F.processoId)
  const vivas = depoisF.necs.filter((n) => n.status !== "DISPENSADA")
  ok("ao mover para a Genealogia nasce SÓ o que está marcado: Nascimento do titular", vivas.some((n) => n.cod === "NAS" && n.pessoaId === F.titularId))
  ok("cônjuge só com Óbito marcado (e viva): nenhuma necessidade dela; nenhuma de Óbito de ninguém", !vivas.some((n) => n.pessoaId === F.conjugeId) && !vivas.some((n) => n.cod === "OBI"))
  ok("o que nasceu tem Documento (as quatro camadas convergem)", depoisF.docs.some((x) => x.necessidadeId === vivas.find((n) => n.cod === "NAS" && n.pessoaId === F.titularId)?.id))

  // ───────────────────────────────────────────────────────────────────────────
  secao("F) API — validação, ignorar com documentacao=false, só grava se mudou, auditoria")
  const G = await familia("G", true)
  for (const [rotulo, corpo] of [["string", "NAS"], ["code fora da lista", ["XXX"]], ["repetido", ["NAS", "NAS"]], ["minúsculo", ["nas"]], ["objeto", { a: 1 }]] as const) {
    const rr = await putDocs(G.conjugeId!, corpo)
    ok(`PUT recusa ${rotulo} com 400`, rr.status === 400, String(rr.status))
  }
  ok("nada foi gravado pelas recusas", (await gravado(G.conjugeId!)) === null)
  const logs0 = await nLogs(G.conjugeId!)
  await putDocs(G.conjugeId!, ["NAS", "CAS", "OBI"])
  await putDocs(G.conjugeId!, null)
  ok("re-save com NULL ou com os três (= NULL) NÃO grava nem audita", (await gravado(G.conjugeId!)) === null && (await nLogs(G.conjugeId!)) === logs0)
  await P.putPessoa(G.conjugeId!, { nome: "Luana" })
  ok("PUT SEM o campo (re-save de pessoa antiga) NUNCA grava a lista", (await gravado(G.conjugeId!)) === null)
  await putDocs(G.conjugeId!, ["NAS"])
  ok("mudança real grava a lista e UMA linha de auditoria (quem/o quê/quando)", JSON.stringify(await gravado(G.conjugeId!)) === '["NAS"]' && (await nLogs(G.conjugeId!)) === logs0 + 1)
  const log = await prisma.logAuditoria.findFirst({ where: { acao: "PESSOA_DOCUMENTOS_EXIGIDOS_ALTERADOS", entidadeId: G.conjugeId! }, orderBy: { id: "desc" } })
  ok("auditoria: usuário, descrição de/para e data", log?.usuarioId === P.adminId && /de Nascimento, Casamento, Óbito para Nascimento/.test(log?.descricao ?? "") && log?.criadoEm != null, log?.descricao ?? "")
  await putDocs(G.conjugeId!, ["NAS"])
  ok("repetir a MESMA lista não audita de novo", (await nLogs(G.conjugeId!)) === logs0 + 1)
  await P.putPessoa(G.conjugeId!, { documentacao: false, documentosExigidos: [] })
  ok("com documentacao=false a lista é IGNORADA (continua ['NAS'])", JSON.stringify(await gravado(G.conjugeId!)) === '["NAS"]')
  await P.putPessoa(G.conjugeId!, { documentacao: true })
  const pn = await P.postPessoa({ nome: "Nova", arvoreId: G.arvoreId, linhaReta: false, documentacao: true, documentosExigidos: ["CAS"] })
  const pnj = await pn.json() as { id: number }
  ok("POST aceita a lista e grava", pn.status === 201 && JSON.stringify(await gravado(pnj.id)) === '["CAS"]', String(pn.status))
  const pn3 = await P.postPessoa({ nome: "Tres", arvoreId: G.arvoreId, linhaReta: false, documentacao: true, documentosExigidos: ["OBI", "CAS", "NAS"] })
  ok("POST com os três grava NULL", pn3.status === 201 && (await gravado(((await pn3.json()) as { id: number }).id)) === null)
  const pnd = await P.postPessoa({ nome: "SemDoc", arvoreId: G.arvoreId, linhaReta: false, documentacao: false, documentosExigidos: ["CAS"] })
  ok("POST com documentacao=false IGNORA a lista", pnd.status === 201 && (await gravado(((await pnd.json()) as { id: number }).id)) === null)
  const pnx = await P.postPessoa({ nome: "Ruim", arvoreId: G.arvoreId, documentosExigidos: ["ZZZ"] })
  ok("POST recusa lista inválida com 400", pnx.status === 400, String(pnx.status))

  secao("G) Preview de impacto (simular-impacto) cobre a lista e não escreve")
  const { POST: simular } = await import("../src/app/api/processos/[processoId]/genealogia/simular-impacto/route")
  const chamar = (corpo: unknown) => simular(P.req(`/api/processos/${G.processoId}/genealogia/simular-impacto`, "POST", corpo), { params: Promise.resolve({ processoId: String(G.processoId) }) })
  const antesLista = await gravado(G.conjugeId!)
  const sr = await chamar({ pessoaId: G.conjugeId!, mudancas: { documentosExigidos: [] } })
  const sj = await sr.json() as { documental?: { dispensados?: unknown[] } }
  ok("simular {documentosExigidos:[]} → 200 e mostra o que sairia", sr.status === 200 && (sj.documental?.dispensados?.length ?? 0) >= 1, JSON.stringify(sj).slice(0, 200))
  ok("a simulação NÃO gravou nada", JSON.stringify(await gravado(G.conjugeId!)) === JSON.stringify(antesLista))
  ok("lista inválida no preview → 400", (await chamar({ pessoaId: G.conjugeId!, mudancas: { documentosExigidos: ["XXX"] } })).status === 400)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} DOCUMENTOS EXIGIDOS (integração) — ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
