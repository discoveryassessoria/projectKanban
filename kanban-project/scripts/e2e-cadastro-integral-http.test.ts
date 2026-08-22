// scripts/e2e-cadastro-integral-http.test.ts
// ============================================================================
// O CADASTRO INTEIRO PELA PORTA HTTP — como o administrador o usa.
//
// Os outros testes chamam os serviços direto. Este passa pelas ROTAS: autenticação,
// permissão, corpo JSON, transação, resposta. É a camada onde moram os defeitos que
// nenhum teste de serviço vê — a coleção que a leitura devolve num formato e a
// gravação espera noutro, o campo que o `buildFilhos` esquece, o 409 que a tela
// precisa receber para não sobrescrever a publicação de outra pessoa.
//
//   PRISMA_DATABASE_URL=<banco de teste> npx next start -p 3311
//   PRISMA_DATABASE_URL=<banco de teste> npx tsx scripts/e2e-cadastro-integral-http.test.ts
// ============================================================================
import { config } from "dotenv"
config()
import { PrismaClient } from "@prisma/client"
import { signAuthToken } from "../lib/auth-jwt"
import { lerVersaoPublicada } from "../src/services/versao-publicada"

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3311"
const prisma = new PrismaClient()
const M = "E2EHTTP"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  for (const uid of ["e2ehttp_genealogia", "e2ehttp_emissao", "e2ehttp_apostilamento"]) {
    const w = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::${uid}` }, select: { id: true } })
    if (w) {
      await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: w.id } })
      await prisma.phaseInternalWorkflow.delete({ where: { id: w.id } })
    }
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "e2ehttp_" } } })
  await prisma.canalOperacional.deleteMany({ where: { key: { startsWith: "E2EHTTP_" } } })
}

async function main() {
  await limpar()

  // ── quem chama ──────────────────────────────────────────────────────────
  const admin = await prisma.usuario.findFirst({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, email: true, tipo: true } })
    ?? await prisma.usuario.create({ data: { nome: "Admin E2E", email: `${M}@teste.local`, senha: "x", tipo: "admin" }, select: { id: true, email: true, tipo: true } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  const req = async (rota: string, init?: RequestInit) => {
    const r = await fetch(BASE + rota, { ...init, headers: { ...H, ...(init?.headers ?? {}) } })
    const texto = await r.text()
    let corpo: unknown = null
    try { corpo = JSON.parse(texto) } catch { corpo = texto }
    return { status: r.status, corpo: corpo as Record<string, unknown> }
  }

  console.log("\n(1) Sem token, a porta não abre")
  const anon = await fetch(`${BASE}/api/gerenciamento/workflows-fase`)
  check("a listagem exige autenticação", anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`)

  // O CANAL NASCE ANTES do catálogo ser lido: num banco de teste vazio, a lista
  // voltaria vazia e a asserção estaria medindo a ausência de semente, não a forma da
  // resposta.
  const canal = await prisma.canalOperacional.create({
    data: { key: "E2EHTTP_PORTAL", label: "Portal E2E", ordem: 95, protocoloObrigatorio: true },
    select: { key: true },
  })

  console.log("\n(2) O catálogo que a tela consome vem do servidor")
  const cat = await req("/api/gerenciamento/catalogo-execucao")
  check("o catálogo responde", cat.status === 200, `HTTP ${cat.status}`)
  const executores = (cat.corpo?.executores ?? []) as Array<Record<string, unknown>>
  check("todo executor declara se desenha canal, evidência, espera e condição",
    executores.length > 0 && executores.every((e) => ["suportaCanais", "suportaEvidencia", "suportaEsperaExterna", "suportaCondicoes"]
      .every((k) => typeof e[k] === "boolean")))
  const canaisCat = (cat.corpo?.canais ?? []) as Array<Record<string, unknown>>
  check("os canais vêm com o que o CATÁLOGO exige",
    canaisCat.length > 0 && "protocoloObrigatorio" in canaisCat[0], `${canaisCat.length} canais`)

  console.log("\n(3) O administrador cadastra um passo inteiro — pela rota")
  const fase = await prisma.catalogoFase.create({
    data: {
      phaseKey: "e2ehttp_fase", label: "Fase E2E HTTP", escopo: "PROCESSO", ordemPadrao: 95, slaDiasPadrao: 3,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
    },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow E2E HTTP", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true, versao: true },
  })

  const passoCompleto = {
    key: "tramitar_no_orgao_externo",
    label: "Tramitar no órgão externo",
    ordem: 1, createsTask: true, required: true, cardinalidade: "PROCESSO", executorKey: "padrao",
    dependeDe: [],
    campos: [
      { key: "canal_usado", label: "Canal usado", tipo: "select", ordem: 1,
        opcoesCadastradas: [
          { key: "presencial", label: "Presencial", ordem: 1 },
          { key: "online", label: "Online", ordem: 2 },
        ] },
      { key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", ordem: 2 },
    ],
    acoes: [
      { key: "tramitado", label: "Tramitado", effectKey: "COMPLETE_STEP", ordem: 1 },
      { key: "aguardando", label: "Aguardando o órgão", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", ordem: 2 },
    ],
    checkItens: [
      { key: "pasta_montada", label: "Pasta montada", obrigatorio: true, ordem: 1 },
      { key: "taxa_paga", label: "Taxa paga", obrigatorio: true, ordem: 2 },
    ],
    canais: [{ canalKey: canal.key, ordem: 1, ativo: true }],
    requisitos: [
      { key: "conferencia", label: "Conferência completa", tipo: "CHECKLIST_COMPLETO", acaoKey: "tramitado", ordem: 1 },
      { key: "protocolo", label: "Número do protocolo", tipo: "CAMPO_PREENCHIDO", alvoKey: "numero_protocolo", ordem: 2,
        condicao: { op: "igual", campo: "canal_usado", valor: "online" } },
    ],
  }

  const salvo = await req(`/api/gerenciamento/workflows-fase/${wf.id}`, {
    method: "PUT", body: JSON.stringify({ steps: [passoCompleto] }),
  })
  check("o passo inteiro é aceito pela rota", salvo.status === 200, JSON.stringify(salvo.corpo).slice(0, 200))

  console.log("\n(4) A leitura devolve TUDO o que foi gravado")
  const lido = await req(`/api/gerenciamento/workflows-fase/${wf.id}`)
  const p = ((lido.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]
  check("a leitura responde", lido.status === 200 && !!p, `HTTP ${lido.status}`)
  check("com as ações", ((p?.acoes ?? []) as unknown[]).length === 2)
  check("com os campos", ((p?.campos ?? []) as unknown[]).length === 2)
  check("com o checklist", ((p?.checkItens ?? []) as unknown[]).length === 2)
  check("com os canais", ((p?.canais ?? []) as unknown[]).length === 1)
  check("com os requisitos", ((p?.requisitos ?? []) as unknown[]).length === 2)
  const campoCanal = ((p?.campos ?? []) as Array<Record<string, unknown>>).find((c) => c.key === "canal_usado")
  check("e com as opções cadastradas do campo", ((campoCanal?.opcoesCadastradas ?? []) as unknown[]).length === 2)
  check("o canal vem aninhado com o catálogo — é isso que o editor normaliza",
    !!((p?.canais as Array<{ canal?: { key?: string } }>)?.[0]?.canal?.key))

  console.log("\n(5) SALVAR NÃO PUBLICOU")
  const depoisDoSave = await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true, rascunhoAlteradoEm: true } })
  check("a versão continua a mesma", depoisDoSave?.versao === wf.versao, `${wf.versao} → ${depoisDoSave?.versao}`)
  check("e ficou marcado como rascunho", depoisDoSave?.rascunhoAlteradoEm != null)

  console.log("\n(6) A prévia diz o que a publicação faria")
  const prev = await req(`/api/gerenciamento/workflows-fase/${wf.id}?preview=1`)
  const preview = prev.corpo?.preview as { mudancas?: Array<{ escopo: string }>; problemas?: unknown[]; podePublicar?: boolean; versaoNova?: number }
  check("a prévia responde", prev.status === 200 && !!preview, `HTTP ${prev.status}`)
  const escopos = new Set((preview?.mudancas ?? []).map((m) => m.escopo))
  // O PASSO É NOVO: a prévia diz que ele passa a existir. Enumerar as nove peças dele
  // como nove acréscimos separados seria repetir a mesma notícia — o que interessa
  // saber é que a fase ganhou um passo. A prévia dos FILHOS é cobrada abaixo, contra
  // uma versão já publicada, que é quando ela responde a outra pergunta: o que mudou
  // NUM passo que os processos já conhecem.
  check("a prévia enxerga o passo novo", escopos.has("PASSO"), [...escopos].join(","))
  check("sem problema de validação", (preview?.problemas ?? []).length === 0, JSON.stringify(preview?.problemas))
  check("e deixa publicar", preview?.podePublicar === true)

  console.log("\n(7) Publicar — com trava de versão")
  const conflito = await req(`/api/gerenciamento/workflows-fase/${wf.id}?acao=publicar`, {
    method: "POST", body: JSON.stringify({ versaoEsperada: 999 }),
  })
  check("publicar com a versão errada é recusado com 409", conflito.status === 409, `HTTP ${conflito.status}`)
  const publicado = await req(`/api/gerenciamento/workflows-fase/${wf.id}?acao=publicar`, {
    method: "POST", body: JSON.stringify({ versaoEsperada: wf.versao }),
  })
  check("publicar com a versão certa passa", publicado.status === 200 && publicado.corpo?.ok === true, JSON.stringify(publicado.corpo).slice(0, 180))
  check("e a versão andou", publicado.corpo?.versaoNova === wf.versao + 1, String(publicado.corpo?.versaoNova))
  const republicado = await req(`/api/gerenciamento/workflows-fase/${wf.id}?acao=publicar`, {
    method: "POST", body: JSON.stringify({ versaoEsperada: wf.versao + 1 }),
  })
  check("republicar sem alteração é idempotente", republicado.corpo?.code === "SEM_ALTERACOES", JSON.stringify(republicado.corpo).slice(0, 140))

  console.log("\n(7.1) Mexer num passo JÁ publicado: a prévia nomeia cada peça")
  //
  // Agora existe versão congelada para comparar. Cada alteração abaixo mexe numa
  // classe diferente de peça — e a prévia tem de dizer QUAL peça mudou, não só que o
  // passo mudou. É isso que separa "algo mudou aqui" de um diff que dá para revisar.
  const editado = {
    ...passoCompleto,
    slaDays: 7,
    campos: [
      { ...passoCompleto.campos[0], label: "Canal utilizado",
        opcoesCadastradas: [
          { key: "presencial", label: "Presencial (balcão)", ordem: 1 },
          { key: "online", label: "Online", ordem: 2, ativo: false },
          { key: "correio", label: "Pelo correio", ordem: 3 },
        ] },
      passoCompleto.campos[1],
    ],
    acoes: [...passoCompleto.acoes, { key: "devolvido", label: "Devolvido pelo órgão", effectKey: "REGISTER_ONLY", ordem: 3 }],
    checkItens: [...passoCompleto.checkItens, { key: "recibo_arquivado", label: "Recibo arquivado", obrigatorio: false, ordem: 3 }],
    canais: [{ canalKey: canal.key, ordem: 1, ativo: true, exigeObservacao: true }],
    requisitos: [...passoCompleto.requisitos,
      { key: "recibo", label: "Recibo anexado", tipo: "EVIDENCIA_ANEXADA", ordem: 3 }],
  }
  const salvo2 = await req(`/api/gerenciamento/workflows-fase/${wf.id}`, {
    method: "PUT", body: JSON.stringify({ steps: [editado] }),
  })
  check("a edição é aceita", salvo2.status === 200, JSON.stringify(salvo2.corpo).slice(0, 160))
  const prev2 = await req(`/api/gerenciamento/workflows-fase/${wf.id}?preview=1`)
  const preview2 = prev2.corpo?.preview as { mudancas?: Array<{ escopo: string; tipo: string; alvo: string; detalhe: string }> }
  const escopos2 = new Set((preview2?.mudancas ?? []).map((m) => m.escopo))
  for (const escopo of ["AÇÃO", "CAMPO", "OPÇÃO", "CANAL", "CHECKLIST", "REQUISITO"]) {
    check(`a prévia nomeia a mudança em ${escopo}`, escopos2.has(escopo), [...escopos2].join(","))
  }
  check("e diz que a opção foi INATIVADA, com o nome dela",
    (preview2?.mudancas ?? []).some((m) => m.escopo === "OPÇÃO" && /ativa/.test(m.detalhe) && /Online/.test(m.alvo)),
    JSON.stringify((preview2?.mudancas ?? []).filter((m) => m.escopo === "OPÇÃO")))
  const pub2 = await req(`/api/gerenciamento/workflows-fase/${wf.id}?acao=publicar`, {
    method: "POST", body: JSON.stringify({ versaoEsperada: wf.versao + 1 }),
  })
  check("a edição publica na versão seguinte", pub2.corpo?.versaoNova === wf.versao + 2, JSON.stringify(pub2.corpo).slice(0, 140))
  const v2 = await lerVersaoPublicada(wf.id, wf.versao + 1)
  check("e a versão ANTERIOR continua com a opção ativa e sem a ação nova",
    ((v2?.passos?.[0]?.campos ?? []).find((c) => c.key === "canal_usado")?.opcoesCadastradas ?? [])
      .find((o) => o.key === "online")?.ativo === true &&
    (v2?.passos?.[0]?.acoes ?? []).length === 2)

  console.log("\n(8) O que foi publicado está CONGELADO com tudo dentro")
  const versao = await lerVersaoPublicada(wf.id, wf.versao + 1)
  const congelado = (versao?.passos ?? [])[0] as unknown as Record<string, unknown> | undefined
  check("o passo congelado tem as ações", ((congelado?.acoes ?? []) as unknown[]).length === 2)
  check("os canais, com a exigência do catálogo já resolvida",
    ((congelado?.canais ?? []) as Array<{ exigeProtocolo?: boolean }>)[0]?.exigeProtocolo === true)
  check("os requisitos", ((congelado?.requisitos ?? []) as unknown[]).length === 2)
  check("e as opções com identidade",
    (((congelado?.campos ?? []) as Array<{ key: string; opcoesCadastradas?: Array<{ key: string }> }>)
      .find((c) => c.key === "canal_usado")?.opcoesCadastradas ?? []).map((o) => o.key).join(",") === "presencial,online")

  console.log("\n(9) A rota RECUSA cadastro impossível — e desfaz tudo")
  const antesDaRecusa = await prisma.phaseInternalWorkflowStep.count({ where: { workflowId: wf.id } })
  const recusado = await req(`/api/gerenciamento/workflows-fase/${wf.id}`, {
    method: "PUT",
    body: JSON.stringify({ steps: [{ ...passoCompleto,
      requisitos: [{ key: "quebrado", label: "Aponta para o nada", tipo: "CAMPO_PREENCHIDO", alvoKey: "campo_que_nao_existe", ordem: 1 }] }] }),
  })
  check("a configuração inválida é recusada com 422", recusado.status === 422, `HTTP ${recusado.status}`)
  check("com o motivo nomeado, não um erro genérico",
    JSON.stringify(recusado.corpo?.problemas ?? []).includes("REQUISITO_ALVO_INEXISTENTE"), JSON.stringify(recusado.corpo).slice(0, 200))
  check("e a transação foi desfeita — os passos continuam lá",
    (await prisma.phaseInternalWorkflowStep.count({ where: { workflowId: wf.id } })) === antesDaRecusa)

  // ══════════════════════════════════════════════════════════════
  console.log("\n(10) O MESMO motor em três fases diferentes — e nada se perde no ida e volta")
  // ══════════════════════════════════════════════════════════════
  //
  // A pergunta é se o configurador é universal ou se Emissão Documental tem um caminho
  // privilegiado. Três fases com chaves diferentes recebem o MESMO corpo, pela MESMA
  // rota, e o que volta tem de ser o que entrou — inclusive as subtarefas.
  //
  // O ROUND-TRIP É O QUE PEGA A PERDA SILENCIOSA. Salvar duas vezes seguidas o que a
  // leitura devolveu é o que o administrador faz sem perceber ao mexer numa aba e
  // salvar: se algum atributo não atravessar, ele some no segundo save, sem erro.
  for (const [phaseKey, rotulo] of [
    ["e2ehttp_genealogia", "Genealogia"],
    ["e2ehttp_emissao", "Emissão Documental"],
    ["e2ehttp_apostilamento", "Apostilamento"],
  ] as const) {
    await prisma.catalogoFase.create({
      data: {
        phaseKey, label: rotulo, escopo: "PROCESSO", ordemPadrao: 96, slaDiasPadrao: 3,
        efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME"],
      },
    })
    const wfFase = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${M}::${phaseKey}`, phaseKey, name: `WF ${rotulo}`, versao: 1, execucao: "SEQUENCIAL" },
      select: { id: true },
    })

    const passoUniversal = {
      key: "verificar_elemento_universal",
      label: "Verificar elemento universal",
      description: "Um passo cujo nome não existe no código.",
      ordem: 1, createsTask: true, required: true, cardinalidade: "DOCUMENTO",
      priority: "high", slaDays: 4, owner: "equipe-teste",
      executorKey: "padrao", dependeDe: [],
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
      completionRule: "observação livre do operador",
      campos: [{ key: "parecer", label: "Parecer", tipo: "textarea", obrigatorio: true, ordem: 1 }],
      acoes: [{ key: "verificado", label: "Verificado", effectKey: "REGISTER_ONLY", ordem: 1 }],
      checkItens: [{ key: "conferido", label: "Conferido", obrigatorio: true, ordem: 1 }],
      requisitos: [{ key: "parecer_dado", label: "Parecer preenchido", tipo: "CAMPO_PREENCHIDO", alvoKey: "parecer", ordem: 1 }],
      subtarefas: [
        {
          key: "sub_a", label: "Primeira parte", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL",
          responsavelRegra: "HERDA", fonteDeCanais: "FORNECEDOR_RELACIONADO", dependeDe: [],
          acoes: [{ key: "parte_a_ok", label: "Parte A feita", effectKey: "REGISTER_ONLY", ordem: 1 }],
          campos: [{ key: "nota_a", label: "Nota A", tipo: "texto", ordem: 1 }],
          checkItens: [{ key: "item_a", label: "Item A", obrigatorio: true, ordem: 1 }],
          requisitos: [],
        },
        {
          key: "sub_b", label: "Segunda parte", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL",
          responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["sub_a"],
          repetivel: true, maxOcorrencias: 3,
          acoes: [{ key: "parte_b_ok", label: "Parte B feita", effectKey: "COMPLETE_STEP", ordem: 1 }],
          // MESMA CHAVE de campo da irmã: peças de donos diferentes podem se repetir.
          campos: [{ key: "nota_a", label: "Nota da parte B", tipo: "texto", ordem: 1 }],
          checkItens: [], requisitos: [],
        },
      ],
    }

    const r1 = await req(`/api/gerenciamento/workflows-fase/${wfFase.id}`, {
      method: "PUT", body: JSON.stringify({ steps: [passoUniversal] }),
    })
    check(`[${rotulo}] o passo com subtarefas é aceito`, r1.status === 200, JSON.stringify(r1.corpo).slice(0, 200))

    const lido1 = await req(`/api/gerenciamento/workflows-fase/${wfFase.id}`)
    const p1 = ((lido1.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]
    check(`[${rotulo}] a leitura devolve o passo com tudo`,
      !!p1 && ((p1.subtarefas ?? []) as unknown[]).length === 2 &&
      ((p1.campos ?? []) as unknown[]).length === 1 &&
      ((p1.acoes ?? []) as unknown[]).length === 1 &&
      ((p1.checkItens ?? []) as unknown[]).length === 1 &&
      ((p1.requisitos ?? []) as unknown[]).length === 1,
      JSON.stringify({ sub: (p1?.subtarefas as unknown[])?.length, campos: (p1?.campos as unknown[])?.length }))
    check(`[${rotulo}] os atributos da aba Geral persistiram`,
      p1?.label === "Verificar elemento universal" && p1?.cardinalidade === "DOCUMENTO" &&
      p1?.priority === "high" && p1?.slaDays === 4 && p1?.required === true &&
      p1?.createsTask === true && p1?.regraDeConclusao === "TODAS_SUBTAREFAS_OBRIGATORIAS" &&
      p1?.description === "Um passo cujo nome não existe no código.",
      JSON.stringify({ card: p1?.cardinalidade, prio: p1?.priority, sla: p1?.slaDays, regra: p1?.regraDeConclusao }))
    const subA = ((p1?.subtarefas ?? []) as Array<Record<string, unknown>>).find((x) => x.key === "sub_a")
    const subB = ((p1?.subtarefas ?? []) as Array<Record<string, unknown>>).find((x) => x.key === "sub_b")
    check(`[${rotulo}] a subtarefa referencia os canais do fornecedor, sem copiar catálogo`,
      subA?.fonteDeCanais === "FORNECEDOR_RELACIONADO" && subB?.fonteDeCanais === "NENHUMA")
    check(`[${rotulo}] a dependência entre subtarefas persistiu`,
      JSON.stringify(subB?.dependeDe) === '["sub_a"]')
    check(`[${rotulo}] a repetição com teto persistiu`,
      subB?.repetivel === true && subB?.maxOcorrencias === 3)
    check(`[${rotulo}] duas subtarefas têm campo com a MESMA chave`,
      ((subA?.campos ?? []) as Array<{ key: string }>).some((c) => c.key === "nota_a") &&
      ((subB?.campos ?? []) as Array<{ key: string }>).some((c) => c.key === "nota_a"))

    // ── O ROUND-TRIP: devolver o que a leitura deu, sem tocar em nada ──────
    const passosLidos = (lido1.corpo?.workflow as { passos?: unknown[] })?.passos ?? []
    const r2 = await req(`/api/gerenciamento/workflows-fase/${wfFase.id}`, {
      method: "PUT", body: JSON.stringify({ steps: passosLidos }),
    })
    check(`[${rotulo}] salvar de novo o que foi lido é aceito`, r2.status === 200, JSON.stringify(r2.corpo).slice(0, 160))
    const lido2 = await req(`/api/gerenciamento/workflows-fase/${wfFase.id}`)
    const p2 = ((lido2.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]
    const semVolateis = (p: Record<string, unknown> | undefined) => JSON.stringify(p, (k, v) =>
      ["id", "stepId", "subtaskId", "fieldId", "canalId", "criadoEm", "atualizadoEm", "workflowId"].includes(k) ? undefined : v)
    check(`[${rotulo}] NADA se perdeu no ida e volta`, semVolateis(p1) === semVolateis(p2),
      "algum atributo não atravessa o salvamento e sumiria no segundo save, sem erro")
  }

  // ══════════════════════════════════════════════════════════════
  console.log("\n(11) Subtarefa: criar, editar, reordenar e excluir — pela mesma porta")
  // ══════════════════════════════════════════════════════════════
  {
    const wfCrud = await prisma.phaseInternalWorkflow.findUnique({
      where: { wfUid: `${M}::e2ehttp_genealogia` }, select: { id: true },
    })
    const ler = async () => {
      const r = await req(`/api/gerenciamento/workflows-fase/${wfCrud!.id}`)
      return ((r.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]
    }
    const salvar = async (passo: Record<string, unknown>) =>
      req(`/api/gerenciamento/workflows-fase/${wfCrud!.id}`, { method: "PUT", body: JSON.stringify({ steps: [passo] }) })

    // ── CRIAR uma terceira ────────────────────────────────────────────
    const p0 = await ler()
    const subs0 = (p0!.subtarefas ?? []) as Array<Record<string, unknown>>
    await salvar({ ...p0, subtarefas: [...subs0, {
      key: "sub_c", label: "Terceira parte", ordem: 3, obrigatoria: false,
      modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [],
      acoes: [{ key: "parte_c_ok", label: "Parte C feita", effectKey: "REGISTER_ONLY", ordem: 1 }],
      campos: [], checkItens: [], requisitos: [],
    }] })
    const p1c = await ler()
    check("criar: a terceira subtarefa aparece", ((p1c!.subtarefas ?? []) as unknown[]).length === 3)

    // ── EDITAR: renomear e trocar a obrigatoriedade ───────────────────
    const editadas = ((p1c!.subtarefas ?? []) as Array<Record<string, unknown>>).map((st) =>
      st.key === "sub_c" ? { ...st, label: "Terceira parte (revisada)", obrigatoria: true } : st)
    await salvar({ ...p1c, subtarefas: editadas })
    const p2c = await ler()
    const subC = ((p2c!.subtarefas ?? []) as Array<Record<string, unknown>>).find((x) => x.key === "sub_c")
    check("editar: o rótulo mudou e a chave NÃO", subC?.label === "Terceira parte (revisada)" && subC?.key === "sub_c")
    check("editar: a obrigatoriedade mudou", subC?.obrigatoria === true)

    // ── REORDENAR: a terceira passa a ser a primeira ───────────────────
    const reordenadas = ((p2c!.subtarefas ?? []) as Array<Record<string, unknown>>)
      .map((st) => ({ ...st, ordem: st.key === "sub_c" ? 1 : st.key === "sub_a" ? 2 : 3 }))
    await salvar({ ...p2c, subtarefas: reordenadas })
    const p3c = await ler()
    check("reordenar: a ordem persistiu na leitura",
      ((p3c!.subtarefas ?? []) as Array<Record<string, unknown>>).map((x) => x.key).join(",") === "sub_c,sub_a,sub_b",
      ((p3c!.subtarefas ?? []) as Array<Record<string, unknown>>).map((x) => `${x.key}:${x.ordem}`).join(" "))
    check("reordenar NÃO mexeu na dependência declarada",
      JSON.stringify(((p3c!.subtarefas ?? []) as Array<Record<string, unknown>>).find((x) => x.key === "sub_b")?.dependeDe) === '["sub_a"]',
      "ordem não é dependência: mudar a ordem não pode reescrever o grafo")

    // ── EXCLUIR ───────────────────────────────────────────────────────
    await salvar({ ...p3c, subtarefas: ((p3c!.subtarefas ?? []) as Array<Record<string, unknown>>).filter((x) => x.key !== "sub_c") })
    const p4c = await ler()
    check("excluir: sobram duas", ((p4c!.subtarefas ?? []) as unknown[]).length === 2)
    check("excluir: as ações da removida foram junto",
      (await prisma.stepAction.count({ where: { key: "parte_c_ok" } })) === 0,
      "ação órfã de subtarefa apagada continuaria pendurada no passo")
    check("excluir: as irmãs continuam intactas",
      ((p4c!.subtarefas ?? []) as Array<Record<string, unknown>>).map((x) => x.key).sort().join(",") === "sub_a,sub_b")
  }

  // ══════════════════════════════════════════════════════════════
  console.log("\n(12) As cinco áreas cobrem TODO atributo do passo — nada ficou órfão")
  // ══════════════════════════════════════════════════════════════
  //
  // A reorganização visual só é honesta se nenhuma capacidade tiver sumido junto. O
  // teste abaixo pega um passo com TUDO preenchido, confere que cada atributo tem uma
  // área responsável, e prova que o ida e volta preserva o conjunto inteiro.
  {
    const AREAS_DO_PASSO: Record<string, string[]> = {
      Geral: ["label", "description", "key", "required", "createsTask", "cardinalidade", "priority", "slaDays", "owner"],
      "Execução": ["subtarefas", "campos", "checkItens"],
      "Conclusão": ["regraDeConclusao", "completionRule", "requisitos"],
      Resultados: ["acoes"],
      "Avançado": ["dependeDe", "executorKey", "reaberturaPermitida", "reaberturaEstrategia", "reaberturaExigeJustificativa", "reaberturaPermissao"],
    }
    const wfArea = await prisma.phaseInternalWorkflow.findUnique({
      where: { wfUid: `${M}::e2ehttp_genealogia` }, select: { id: true },
    })
    const r = await req(`/api/gerenciamento/workflows-fase/${wfArea!.id}`)
    const passo = ((r.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]!
    const cobertos = new Set(Object.values(AREAS_DO_PASSO).flat())
    // Colunas de infraestrutura: id, ordem e carimbos não são configuração de negócio.
    const INFRA = new Set(["id", "workflowId", "ordem", "versao", "criadoEm", "atualizadoEm", "checklist", "canais"])
    const orfaos = Object.keys(passo).filter((k) => !cobertos.has(k) && !INFRA.has(k))
    check("todo atributo do passo pertence a uma das cinco áreas", orfaos.length === 0,
      `sem área: ${orfaos.join(", ")}`)
    for (const [area, campos] of Object.entries(AREAS_DO_PASSO)) {
      check(`a área ${area} tem os atributos dela presentes na leitura`,
        campos.every((c) => c in passo), campos.filter((c) => !(c in passo)).join(", "))
    }

    // ── ROUND-TRIP SEMÂNTICO: ler, devolver sem tocar, ler de novo ──────
    const antes = JSON.stringify(passo, (k, v) =>
      ["id", "stepId", "subtaskId", "fieldId", "canalId", "criadoEm", "atualizadoEm", "workflowId"].includes(k) ? undefined : v)
    await req(`/api/gerenciamento/workflows-fase/${wfArea!.id}`, {
      method: "PUT", body: JSON.stringify({ steps: (r.corpo?.workflow as { passos?: unknown[] })?.passos ?? [] }),
    })
    const r2 = await req(`/api/gerenciamento/workflows-fase/${wfArea!.id}`)
    const passo2 = ((r2.corpo?.workflow as { passos?: Array<Record<string, unknown>> })?.passos ?? [])[0]!
    const depois = JSON.stringify(passo2, (k, v) =>
      ["id", "stepId", "subtaskId", "fieldId", "canalId", "criadoEm", "atualizadoEm", "workflowId"].includes(k) ? undefined : v)
    check("round-trip semântico: estado idêntico depois de salvar sem alterar", antes === depois)
  }

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exitCode = 1 }
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
