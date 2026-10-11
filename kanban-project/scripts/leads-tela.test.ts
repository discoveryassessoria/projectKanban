// scripts/leads-tela.test.ts — a tela de Leads: quem vê, a lista, a resposta da pessoa, devolver, encerrar, reabrir e o
// aviso do sino (docs/leads-mandato.md, regras 15, 16 e 19 a 27; §10).
// WhatsApp e IA de MENTIRA + banco de TESTE: nenhuma chamada sai para a Meta nem para a IA, e só mexe no que ele mesmo criou.
//   node scripts/ci/gate-build.mjs --so leads-tela
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("leads-tela.test.ts")

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { signAuthToken } from "@/lib/auth-jwt"
import { avisosDoSino } from "@/lib/operacional/notificacao-canonica"
import { LINK_DOS_LEADS_AGUARDANDO } from "@/lib/operacional/avisos-fatos"
import { calcularPermissoes, PERMISSOES, PERMISSOES_EXCLUSIVAS, temPermissao } from "@/src/lib/permissoes"
import {
  devolverAoAgente, encerrarLead, ErroDoLead, FRASE_DE_ESPERA, MAX_RESPOSTAS_DO_AGENTE, MOTIVO_ASSUMIDO_PELA_TELA,
  reabrirLead, receberMensagemDoLead, responderComoPessoa, responderConversa, type Dependencias,
} from "@/src/services/leads/atendimento"
import { configuracaoDoAgente } from "@/src/services/leads/config"
import { usuariosQueAtendemLeads } from "@/src/services/leads/destinatarios"
import type { IA, RespostaDoAgente, TurnoDaConversa } from "@/src/services/leads/ia"
import { lerLead, listarLeads } from "@/src/services/leads/leitura"
import type { EventoDoLead, WhatsApp } from "@/src/services/leads/whatsapp"
import { GET as rotaLista } from "@/src/app/api/leads/route"
import { GET as rotaLead } from "@/src/app/api/leads/[id]/route"
import { POST as rotaMensagens } from "@/src/app/api/leads/[id]/mensagens/route"
import { POST as rotaDevolver } from "@/src/app/api/leads/[id]/devolver/route"
import { POST as rotaEncerrar } from "@/src/app/api/leads/[id]/encerrar/route"
import { POST as rotaReabrir } from "@/src/app/api/leads/[id]/reabrir/route"
import { GET as rotaArquivo } from "@/src/app/api/leads/arquivo/[mensagemId]/route"

const PREFIXO = "5500088" // telefones que só este teste cria
const MARCA = "LEADSTELA"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const HORA = 60 * 60 * 1000

let seq = 0
const telefoneNovo = () => `${PREFIXO}${String(++seq).padStart(6, "0")}`
const texto = (telefone: string, t: string, nome = "Fulano de Teste"): EventoDoLead => ({ tipo: "texto", wamid: `wamid.TELA.${++seq}`, telefone, nome, texto: t, midiaId: null, midiaTipo: null, midiaNome: null })
const arquivo = (telefone: string, midiaTipo: string, midiaId: string, midiaNome: string | null = null): EventoDoLead => ({ tipo: "arquivo", wamid: `wamid.TELA.${++seq}`, telefone, nome: "", texto: "", midiaId, midiaTipo, midiaNome })
const fala = (mensagens: string[], mais: Partial<RespostaDoAgente> = {}): RespostaDoAgente => ({ mensagens, ficha: {}, linhagem: [], passar_para_equipe: false, motivo: "", resumo: "", ...mais })
const FRASE_DA_BUSCA = "Um momento, vou iniciar a sua busca genealógica para verificar o que consigo localizar."
const passagem = (mais: Partial<RespostaDoAgente> = {}) => fala([FRASE_DA_BUSCA], { passar_para_equipe: true, motivo: "Triagem concluída", ...mais })

function montar(opcoes: { respostas?: RespostaDoAgente[]; agora?: () => Date; envioFalha?: boolean } = {}) {
  const enviados: { para: string; texto: string }[] = []
  const pedidos: TurnoDaConversa[][] = []
  const respostas = opcoes.respostas ?? [fala(["Certo."])]
  let n = 0
  const ia: IA = {
    async responder(a) {
      pedidos.push(structuredClone(a.turnos))
      return respostas[Math.min(n++, respostas.length - 1)]
    },
  }
  const whats: WhatsApp = {
    async enviarTexto(para, t) {
      if (opcoes.envioFalha) throw new Error("recusado (131047)")
      enviados.push({ para, texto: t })
      return `wamid.SAIDA.TELA.${++seq}`
    },
    async digitando() {},
    async baixarArquivo() { throw new Error("não usado") },
  }
  const deps: Dependencias = {
    whats, ia,
    agente: { ...configuracaoDoAgente({} as NodeJS.ProcessEnv), esperaMs: 120, digitacaoBaseMs: 0, digitacaoPorLetraMs: 0, digitacaoMaxMs: 0, repeticaoDaTravaMs: 30, soAtender: new Set() },
    esperar: pausa,
    agora: opcoes.agora ?? (() => new Date()),
    registrar: { error() {} },
  }
  return { deps, enviados, pedidos }
}

const conversaDe = (telefone: string) => prisma.leadConversa.findUniqueOrThrow({ where: { telefone }, include: { mensagens: { orderBy: { id: "asc" } } } })
/** Um lead que o agente já triou e passou adiante: situação AGUARDANDO RESPOSTA. */
async function leadPassado(nome = "Fulano de Teste", mais: Partial<RespostaDoAgente> = {}) {
  const tel = telefoneNovo()
  const t = montar({ respostas: [passagem(mais)] })
  await receberMensagemDoLead(texto(tel, "Meu avô nasceu na Itália", nome), t.deps)
  return { tel, id: (await conversaDe(tel)).id }
}
const erroDe = async (f: () => Promise<unknown>): Promise<ErroDoLead | null> => {
  try { await f(); return null } catch (e) { if (e instanceof ErroDoLead) return e; throw e }
}
const avisoDeLead = async (usuarioId: number) => (await avisosDoSino(prisma, usuarioId)).naoLidos.filter((a) => a.tipo === "LEAD")

async function limpar(usuarios: number[]) {
  const conversas = await prisma.leadConversa.findMany({ where: { telefone: { startsWith: PREFIXO } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "LEAD_CONVERSA", entidadeId: { in: conversas.map((c) => c.id) } } })
  await prisma.leadConversa.deleteMany({ where: { telefone: { startsWith: PREFIXO } } }) // cascata: mensagens
  if (usuarios.length) {
    await prisma.notificacaoOperacional.deleteMany({ where: { destinatarioId: { in: usuarios } } })
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

function arquivosEm(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => { const p = join(pasta, n); return statSync(p).isDirectory() ? arquivosEm(p) : [p] })
}

async function main() {
  await limpar([])
  const antes = { tarefas: await prisma.tarefa.count(), processos: await prisma.processo.count() }
  const criados: number[] = []
  const usuario = async (sufixo: string, tipo: string, custom: Record<string, boolean> | null) => {
    const u = await prisma.usuario.create({
      data: { nome: `${MARCA} ${sufixo}`, email: `${MARCA.toLowerCase()}.${sufixo}.${Date.now()}@teste.local`, senha: "x", tipo, permissoesCustom: custom ?? undefined },
      select: { id: true, email: true, nome: true },
    })
    criados.push(u.id)
    return { ...u, token: await signAuthToken({ userId: u.id, email: u.email, tipo, sessaoInicio: Date.now() }) }
  }

  try {
    const dono = await usuario("dono", "admin", { "leads.atender": true })
    const outroAdmin = await usuario("admin", "admin", null)
    const req = (method: string, url: string, token: string | null, body?: unknown) =>
      new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
    const ctxMsg = (id: number) => ({ params: Promise.resolve({ mensagemId: String(id) }) })

    console.log("\n1) Só quem recebeu `leads.atender` vê e responde (regras 19 e 20)")
    {
      ok("`leads.atender` existe e é EXCLUSIVA", "leads.atender" in PERMISSOES && PERMISSOES_EXCLUSIVAS.has("leads.atender"))
      ok("administrador sem concessão nominal NÃO tem a permissão", !temPermissao(calcularPermissoes("admin", null, null), "leads.atender"))
      ok("administrador com concessão nominal tem", temPermissao(calcularPermissoes("admin", null, { "leads.atender": true }), "leads.atender"))
      const quem = await usuariosQueAtendemLeads()
      ok("quem atende leads: o que recebeu a concessão; o outro administrador não", quem.includes(dono.id) && !quem.includes(outroAdmin.id))

      const { id } = await leadPassado()
      const chamadas: [string, (token: string | null) => Promise<Response>][] = [
        ["GET /api/leads", (t) => rotaLista(req("GET", "/api/leads", t))],
        ["GET /api/leads/[id]", (t) => rotaLead(req("GET", `/api/leads/${id}`, t), ctx(id))],
        ["POST mensagens", (t) => rotaMensagens(req("POST", `/api/leads/${id}/mensagens`, t, { texto: "oi" }), ctx(id))],
        ["POST devolver", (t) => rotaDevolver(req("POST", `/api/leads/${id}/devolver`, t, {}), ctx(id))],
        ["POST encerrar", (t) => rotaEncerrar(req("POST", `/api/leads/${id}/encerrar`, t, { motivo: "sem interesse" }), ctx(id))],
        ["POST reabrir", (t) => rotaReabrir(req("POST", `/api/leads/${id}/reabrir`, t, {}), ctx(id))],
        ["GET arquivo", (t) => rotaArquivo(req("GET", `/api/leads/arquivo/1`, t), ctxMsg(1))],
      ]
      for (const [nome, chamar] of chamadas) {
        const semLogin = await chamar(null)
        const semPermissao = await chamar(outroAdmin.token)
        ok(`${nome}: sem login é recusado e administrador sem a concessão recebe 403`, semLogin.status === 401 && semPermissao.status === 403, `${semLogin.status}/${semPermissao.status}`)
      }
      const depois = await conversaDe((await prisma.leadConversa.findUniqueOrThrow({ where: { id } })).telefone)
      ok("nenhuma das chamadas recusadas mexeu no lead", depois.estado === "EQUIPE" && depois.mensagens.every((m) => m.de !== "ATENDENTE"))

      const rotas = arquivosEm("src/app/api/leads").filter((p) => p.endsWith("route.ts"))
      ok(`todas as ${rotas.length} rotas de /api/leads conferem a permissão no servidor`, rotas.length === 7 && rotas.every((p) => /await autorizarLeads\(request\)/.test(readFileSync(p, "utf8"))))
      const menu = readFileSync("src/components/bitrix-sidebar.tsx", "utf8")
      ok("o item Leads do menu só aparece com a permissão", /title: "Leads",[\s\S]{0,200}permissao: "leads\.atender"/.test(menu))
      ok("a página /leads só abre com a permissão", /pode\("leads\.atender"\)/.test(readFileSync("src/app/leads/page.tsx", "utf8")))
      // O lead desta seção é apagado (só teste apaga lead); o aviso que ele gerou sai junto, para as contagens seguintes.
      await limpar([])
      await prisma.notificacaoOperacional.deleteMany({ where: { destinatarioId: dono.id } })
    }

    console.log("\n2) O sino avisa quando o lead passa do agente (regra 27)")
    const A = await leadPassado("Ana de Teste", { ficha: { nome: "Ana Rossi", pais: "Itália" }, linhagem: [{ quem: "avô", nome: "Giuseppe Rossi", conjuge: "Maria Bianchi", pais: "", nasceu: "Itália" }], resumo: "Avô italiano." })
    {
      let avisos = await avisoDeLead(dono.id)
      ok("um aviso: '1 lead aguardando resposta', que leva à lista filtrada", avisos.length === 1 && avisos[0].titulo === "1 lead aguardando resposta" && avisos[0].link === LINK_DOS_LEADS_AGUARDANDO, JSON.stringify(avisos))
      ok("o aviso não tem família nem tarefa (lead não é tarefa)", avisos[0].familiaId === null && (await prisma.notificacaoOperacional.findUniqueOrThrow({ where: { id: avisos[0].id } })).tarefaIds.length === 0)
      ok("administrador sem a concessão não recebe aviso de lead", (await avisoDeLead(outroAdmin.id)).length === 0)
    }
    const B = await leadPassado("Bruno de Teste")
    {
      let avisos = await avisoDeLead(dono.id)
      ok("segundo lead: o MESMO aviso passa a dizer '2 leads aguardando resposta'", avisos.length === 1 && avisos[0].titulo === "2 leads aguardando resposta" && avisos[0].contagem === 2, JSON.stringify(avisos))
      const t = montar()
      const r = await receberMensagemDoLead(texto(A.tel, "Alguém aí?"), t.deps)
      avisos = await avisoDeLead(dono.id)
      ok("o mesmo lead escreve de novo: o agente fica calado e o aviso não conta o lead duas vezes", r === "REGISTRADA" && t.enviados.length === 0 && t.pedidos.length === 0 && avisos.length === 1 && avisos[0].contagem === 2, `${r} ${JSON.stringify(avisos)}`)
    }

    console.log("\n3) A lista: situação, contagem e busca saem de um lugar só (regras 21 e 22)")
    const C = telefoneNovo()
    {
      await receberMensagemDoLead(texto(C, "Oi", "Carla de Teste"), montar({ respostas: [fala(["Olá, boa tarde. Tudo bem?"])] }).deps)
      const lista = await listarLeads({})
      const meus = lista.leads.filter((l) => l.telefone.startsWith(PREFIXO))
      const por = (tel: string) => meus.find((l) => l.telefone === tel)
      ok("lead que o agente passou: Aguardando resposta; lead em triagem: Com o agente", por(A.tel)?.situacao === "AGUARDANDO_RESPOSTA" && por(B.tel)?.situacao === "AGUARDANDO_RESPOSTA" && por(C)?.situacao === "COM_O_AGENTE")
      ok("a soma das situações é o total da lista", Object.values(lista.contagem).reduce((s, n) => s + n, 0) === lista.total && lista.total === lista.leads.length && !lista.cortada)
      ok("o nome é o que o lead informou ao agente; sem isso, o do WhatsApp", por(A.tel)?.nome === "Ana Rossi" && por(A.tel)?.pais === "Itália" && por(B.tel)?.nome === "Bruno de Teste")
      ok("a prévia é a última mensagem da conversa", por(A.tel)?.ultimaMensagem?.texto === "Alguém aí?" && por(A.tel)?.ultimaMensagem?.de === "LEAD" && por(C)?.ultimaMensagem?.de === "AGENTE")
      ok("mais recente primeiro", igual(meus.map((l) => l.telefone), [C, A.tel, B.tel]), JSON.stringify(meus.map((l) => l.telefone)))
      const filtrada = await listarLeads({ situacao: "COM_O_AGENTE" })
      ok("o filtro mostra só a situação pedida, e a contagem continua a de todos", filtrada.leads.every((l) => l.situacao === "COM_O_AGENTE") && filtrada.leads.some((l) => l.telefone === C) && igual(filtrada.contagem, lista.contagem))
      ok("busca por nome", igual((await listarLeads({ busca: "rossi" })).leads.map((l) => l.telefone), [A.tel]))
      ok("busca por telefone, com ou sem pontuação", igual((await listarLeads({ busca: `(${B.tel.slice(2, 4)}) ${B.tel.slice(4)}` })).leads.map((l) => l.telefone), [B.tel]))
      ok("busca sem resultado devolve lista vazia", (await listarLeads({ busca: "zzzz-ninguem" })).leads.length === 0)
    }

    console.log("\n4) O lead aberto: conversa, ficha e pessoas para pesquisar (regras 23 e 24)")
    {
      const lead = await lerLead(A.id)
      ok("traz a conversa inteira em ordem, com quem escreveu", igual(lead?.mensagens.map((m) => m.de), ["LEAD", "AGENTE", "LEAD"]) && lead?.mensagens[1].texto === FRASE_DA_BUSCA)
      ok("traz o que o agente levantou: ficha, linhagem, resumo e motivo da passagem", lead?.ficha.nome === "Ana Rossi" && lead?.linhagem[0]?.nome === "Giuseppe Rossi" && lead?.linhagem[0]?.conjuge === "Maria Bianchi" && lead?.resumo === "Avô italiano." && lead?.motivoPassagem === "Triagem concluída")
      ok("dentro das 24 horas dá para responder; depois, não (regra 15)", lead?.podeResponder === true && (await lerLead(A.id, new Date(Date.now() + 25 * HORA)))?.podeResponder === false)
      ok("lead que não existe: nada", (await lerLead(999_999_999)) === null)
    }

    console.log("\n5) A pessoa responde pela tela (regras 15 e 16)")
    {
      const t = montar()
      const r = await responderComoPessoa({ conversaId: A.id, texto: "  Olá, Ana. Sou eu quem segue com você.  ", autorId: dono.id }, t.deps)
      const c = await conversaDe(A.tel)
      const ultima = c.mensagens.at(-1)
      ok("a resposta sai pelo WhatsApp para o telefone do lead, sem espaços sobrando", igual(t.enviados, [{ para: A.tel, texto: "Olá, Ana. Sou eu quem segue com você." }]))
      ok("fica gravada como resposta de PESSOA, com o autor", ultima?.de === "ATENDENTE" && ultima.autorId === dono.id && ultima.id === r.id && Boolean(ultima.wamid))
      const lead = await lerLead(A.id)
      ok("a situação passa a Respondido e a tela mostra o nome de quem respondeu", lead?.situacao === "RESPONDIDO" && lead.mensagens.at(-1)?.autor === dono.nome)
      const avisos = await avisoDeLead(dono.id)
      ok("o lead respondido sai do aviso: '1 lead aguardando resposta'", avisos.length === 1 && avisos[0].titulo === "1 lead aguardando resposta", JSON.stringify(avisos))

      const t2 = montar()
      await receberMensagemDoLead(texto(A.tel, "Obrigada! Quanto custa?"), t2.deps)
      ok("o lead responde: volta a Aguardando resposta, o agente continua calado e o aviso volta a contar 2", (await lerLead(A.id))?.situacao === "AGUARDANDO_RESPOSTA" && t2.enviados.length === 0 && t2.pedidos.length === 0 && (await avisoDeLead(dono.id))[0]?.contagem === 2)

      const vazio = await erroDe(() => responderComoPessoa({ conversaId: A.id, texto: "   ", autorId: dono.id }, t.deps))
      const longo = await erroDe(() => responderComoPessoa({ conversaId: A.id, texto: "x".repeat(4097), autorId: dono.id }, t.deps))
      const sumiu = await erroDe(() => responderComoPessoa({ conversaId: 999_999_999, texto: "oi", autorId: dono.id }, t.deps))
      ok("mensagem vazia, longa demais ou para lead que não existe é recusada com explicação", vazio?.status === 400 && longo?.codigo === "MENSAGEM_LONGA" && sumiu?.status === 404 && t.enviados.length === 1)

      const tarde = montar({ agora: () => new Date(Date.now() + 25 * HORA) })
      const fora = await erroDe(() => responderComoPessoa({ conversaId: A.id, texto: "Ainda tem interesse?", autorId: dono.id }, tarde.deps))
      ok("depois de 24 horas da última mensagem do lead a resposta é recusada, e nada sai", fora?.codigo === "FORA_DA_JANELA" && fora.status === 409 && tarde.enviados.length === 0 && /24 horas/.test(fora.message))

      const quebrado = montar({ envioFalha: true })
      const antesDoEnvio = (await conversaDe(A.tel)).mensagens.length
      const falha = await erroDe(() => responderComoPessoa({ conversaId: A.id, texto: "Teste", autorId: dono.id }, quebrado.deps))
      ok("se o WhatsApp recusa o envio, a tela recebe o erro e a mensagem NÃO fica gravada como enviada", falha?.codigo === "ENVIO_FALHOU" && falha.status === 502 && (await conversaDe(A.tel)).mensagens.length === antesDoEnvio)
    }

    console.log("\n6) A pessoa responde um lead que ainda está com o agente: ele sai da conversa (regra 16)")
    {
      const t = montar()
      await responderComoPessoa({ conversaId: (await conversaDe(C)).id, texto: "Oi, Carla. Aqui é da equipe.", autorId: dono.id }, t.deps)
      const c = await conversaDe(C)
      ok("a conversa passa a ser da pessoa, com o motivo registrado", c.estado === "EQUIPE" && c.motivoPassagem === MOTIVO_ASSUMIDO_PELA_TELA && c.passouEm !== null && c.mensagens.every((m) => !m.aguardaAgente))
      ok("fica registrado quem assumiu", (await prisma.logAuditoria.count({ where: { entidade: "LEAD_CONVERSA", entidadeId: c.id, acao: "ASSUMIR", usuarioId: dono.id } })) === 1)
      const t2 = montar()
      const r = await receberMensagemDoLead(texto(C, "Tenho um bisavô português"), t2.deps)
      ok("o lead escreve de novo: o agente não responde mais", r === "REGISTRADA" && t2.enviados.length === 0 && t2.pedidos.length === 0)
    }

    console.log("\n7) Devolver ao agente (regra 25)")
    {
      // C: o agente cumprimentou, a pessoa respondeu, o lead falou do bisavô. A última palavra é do lead.
      const idC = (await conversaDe(C)).id
      const r = await devolverAoAgente({ conversaId: idC, autorId: dono.id })
      let c = await conversaDe(C)
      ok("a conversa volta para o agente e a mensagem sem resposta fica para ele", r.devolvida && r.responderAgora && c.estado === "AGENTE" && c.motivoPassagem === null && c.passouEm === null && igual(c.mensagens.filter((m) => m.aguardaAgente).map((m) => m.texto), ["Tenho um bisavô português"]))
      ok("fica registrado quem devolveu, e o lead sai do aviso", (await prisma.logAuditoria.count({ where: { entidade: "LEAD_CONVERSA", entidadeId: idC, acao: "DEVOLVER", usuarioId: dono.id } })) === 1 && !JSON.stringify((await prisma.notificacaoOperacional.findMany({ where: { destinatarioId: dono.id, tipo: "LEAD", lidaEm: null } })).map((a) => a.resumo)).includes(`"lead:${idC}"`))
      const t = montar({ respostas: [fala(["Entendi. Como ele se chamava?"])] })
      await responderConversa(idC, t.deps)
      c = await conversaDe(C)
      const turnos = t.pedidos[0] ?? []
      ok("o agente responde sabendo o que a pessoa disse enquanto ele esteve fora", t.pedidos.length === 1 && turnos.some((x) => x.role === "assistant" && x.content.includes("Oi, Carla. Aqui é da equipe.")) && turnos.at(-1)?.role === "user" && turnos.at(-1)?.content === "Tenho um bisavô português", JSON.stringify(turnos))
      ok("a resposta do agente sai e a conversa segue com ele", igual(t.enviados.map((e) => e.texto), ["Entendi. Como ele se chamava?"]) && c.estado === "AGENTE" && c.mensagens.at(-1)?.de === "AGENTE")
      ok("devolver um lead que já está com o agente não faz nada", igual(await devolverAoAgente({ conversaId: idC, autorId: dono.id }), { devolvida: false, responderAgora: false }))

      // B: a última palavra é da pessoa. Devolvido, o agente espera o lead escrever.
      await responderComoPessoa({ conversaId: B.id, texto: "Bruno, me conta mais.", autorId: dono.id }, montar().deps)
      const rB = await devolverAoAgente({ conversaId: B.id, autorId: dono.id })
      ok("quando a última palavra é da pessoa, o agente volta mas só fala quando o lead escrever", rB.devolvida && !rB.responderAgora && (await conversaDe(B.tel)).mensagens.every((m) => !m.aguardaAgente))
      const tB = montar({ respostas: [fala(["Certo. Quem é o ascendente italiano na sua linhagem?"])] })
      await receberMensagemDoLead(texto(B.tel, "Meu avô era de Treviso"), tB.deps)
      ok("o lead escreve: agora é o agente quem responde", tB.enviados.length === 1 && tB.pedidos[0]?.some((x) => x.role === "assistant" && x.content.includes("Bruno, me conta mais.")))
    }

    console.log("\n8) Encerrar e reabrir (regra 26)")
    {
      const curto = await erroDe(() => encerrarLead({ conversaId: A.id, motivo: " não ", autorId: dono.id }))
      ok("encerrar exige motivo escrito", curto?.codigo === "MOTIVO_CURTO" && (await conversaDe(A.tel)).estado === "EQUIPE")
      await encerrarLead({ conversaId: A.id, motivo: "Não tem ascendente dos países atendidos", autorId: dono.id })
      const c = await conversaDe(A.tel)
      const lead = await lerLead(A.id)
      ok("o lead fica Encerrado, com o motivo, a data e quem encerrou", c.estado === "ENCERRADA" && c.encerradaEm !== null && lead?.situacao === "ENCERRADO" && lead.motivoEncerramento === "Não tem ascendente dos países atendidos" && (await prisma.logAuditoria.count({ where: { entidade: "LEAD_CONVERSA", entidadeId: A.id, acao: "ENCERRAR", usuarioId: dono.id } })) === 1)
      ok("o lead encerrado sai do aviso do sino (não sobra aviso vazio)", (await avisoDeLead(dono.id)).length === 0, JSON.stringify(await avisoDeLead(dono.id)))
      const t = montar()
      const responder = await erroDe(() => responderComoPessoa({ conversaId: A.id, texto: "oi", autorId: dono.id }, t.deps))
      const devolver = await erroDe(() => devolverAoAgente({ conversaId: A.id, autorId: dono.id }))
      const deNovo = await erroDe(() => encerrarLead({ conversaId: A.id, motivo: "repetido", autorId: dono.id }))
      ok("lead encerrado não recebe resposta, não é devolvido nem encerrado de novo", responder?.codigo === "ENCERRADO" && devolver?.codigo === "ENCERRADO" && deNovo?.codigo === "JA_ENCERRADO" && t.enviados.length === 0 && lead?.podeResponder === false)

      await reabrirLead({ conversaId: A.id, autorId: dono.id })
      const reaberto = await conversaDe(A.tel)
      ok("reabrir devolve o lead para a pessoa (nunca direto para o agente), com tudo o que já havia", reaberto.estado === "EQUIPE" && reaberto.encerradaEm === null && reaberto.motivoEncerramento === null && reaberto.mensagens.length === c.mensagens.length && (await lerLead(A.id))?.situacao === "AGUARDANDO_RESPOSTA")
      ok("reabrir um lead que não está encerrado é recusado", (await erroDe(() => reabrirLead({ conversaId: A.id, autorId: dono.id })))?.codigo === "NAO_ENCERRADO")
    }

    console.log("\n9) Lead encerrado que escreve de novo volta para o agente como conversa nova (regra 26)")
    {
      await encerrarLead({ conversaId: A.id, motivo: "Sem resposta do lead", autorId: dono.id })
      const antesDe = await conversaDe(A.tel)
      const t = montar({ respostas: [fala(["Olá, boa tarde. Tudo bem?", "Meu nome é Marco, prazer.", "Como posso ajudar?"])] })
      const r = await receberMensagemDoLead(texto(A.tel, "Oi, voltei"), t.deps)
      const c = await conversaDe(A.tel)
      ok("o agente atende de novo", r === "PROCESSADA" && c.estado === "AGENTE" && t.enviados.length === 3 && (await lerLead(A.id))?.situacao === "COM_O_AGENTE")
      ok("para a IA a conversa recomeça: ela recebe só a mensagem nova", t.pedidos.length === 1 && igual(t.pedidos[0], [{ role: "user", content: "Oi, voltei" }]), JSON.stringify(t.pedidos[0]))
      ok("o encerramento sai, mas o que já se sabia do lead e as mensagens antigas ficam", c.encerradaEm === null && c.motivoEncerramento === null && c.motivoPassagem === null && (c.ficha as Record<string, string>).nome === "Ana Rossi" && c.mensagens.length === antesDe.mensagens.length + 4)
    }

    console.log("\n10) Teto de respostas do agente numa conversa")
    {
      const contexto = (n: number) => Array.from({ length: n }, (_, i) => [{ role: "user", content: `pergunta ${i}` }, { role: "assistant", content: JSON.stringify(fala([`resposta ${i}`])) }]).flat()
      const quase = telefoneNovo()
      await prisma.leadConversa.create({ data: { telefone: quase, contextoIa: contexto(MAX_RESPOSTAS_DO_AGENTE - 1) } })
      const t1 = montar()
      await receberMensagemDoLead(texto(quase, "mais uma"), t1.deps)
      ok(`com ${MAX_RESPOSTAS_DO_AGENTE - 1} respostas dadas, o agente ainda responde`, t1.pedidos.length === 1 && (await conversaDe(quase)).estado === "AGENTE")

      const t2 = montar()
      await receberMensagemDoLead(texto(quase, "e mais outra"), t2.deps)
      const c = await conversaDe(quase)
      ok(`na resposta seguinte à ${MAX_RESPOSTAS_DO_AGENTE}ª, a IA não é chamada: o lead recebe a frase de espera e vai para uma pessoa`, t2.pedidos.length === 0 && igual(t2.enviados.map((e) => e.texto), [FRASE_DE_ESPERA]) && c.estado === "EQUIPE" && /limite de respostas/.test(c.motivoPassagem ?? ""), `${t2.pedidos.length} ${JSON.stringify(t2.enviados)} ${c.estado} ${c.motivoPassagem}`)
      ok("e quem atende é avisado no sino", JSON.stringify((await prisma.notificacaoOperacional.findMany({ where: { destinatarioId: dono.id, tipo: "LEAD", lidaEm: null } })).map((a) => a.resumo)).includes(`"lead:${c.id}"`))
    }

    console.log("\n11) O arquivo que o lead mandou (regras 13 e 23; §8)")
    const telArq = telefoneNovo()
    {
      await receberMensagemDoLead(arquivo(telArq, "document", "MIDIA-SECRETA-123", "certidao.pdf"), montar().deps)
      const c = await conversaDe(telArq)
      const comArquivo = c.mensagens.find((m) => m.midiaId)!
      const semArquivo = c.mensagens.find((m) => !m.midiaId)!
      const lead = await lerLead(c.id)
      ok("a tela sabe que há um arquivo (tipo e nome), mas o identificador dele na Meta não sai do servidor", igual(lead?.mensagens[0].arquivo, { tipo: "document", nome: "certidao.pdf" }) && !JSON.stringify(lead).includes("MIDIA-SECRETA-123"))
      ok("sem o WhatsApp configurado, a rota do arquivo avisa em vez de falhar", (await rotaArquivo(req("GET", `/api/leads/arquivo/${comArquivo.id}`, dono.token), ctxMsg(comArquivo.id))).status === 503)

      const envAntes = { ...process.env }
      const fetchAntes = globalThis.fetch
      Object.assign(process.env, { WHATSAPP_TOKEN: "token-de-teste", WHATSAPP_PHONE_ID: "111", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" })
      const pedidosAMeta: { url: string; autorizacao: string | null }[] = []
      let tipoDevolvido = "application/pdf"
      let metaFora = false
      globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
        const url = String(entrada)
        pedidosAMeta.push({ url, autorizacao: new Headers(init?.headers).get("authorization") })
        if (metaFora) return new Response("{}", { status: 404 })
        if (url.endsWith("/MIDIA-SECRETA-123")) return Response.json({ url: "https://lookaside.invalid/arquivo", mime_type: tipoDevolvido })
        if (url === "https://lookaside.invalid/arquivo") return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
        if (url.endsWith("/111/messages")) return Response.json({ messages: [{ id: "wamid.ROTA.1" }] })
        return new Response("{}", { status: 500 })
      }) as typeof fetch
      try {
        const pdf = await rotaArquivo(req("GET", `/api/leads/arquivo/${comArquivo.id}`, dono.token), ctxMsg(comArquivo.id))
        ok("PDF: buscado na Meta com o token do servidor e entregue para abrir", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && (pdf.headers.get("content-disposition") ?? "").startsWith("inline") && pdf.headers.get("x-content-type-options") === "nosniff" && pdf.headers.get("cache-control") === "private, no-store" && (await pdf.arrayBuffer()).byteLength === 4 && pedidosAMeta.every((p) => p.autorizacao === "Bearer token-de-teste"))
        tipoDevolvido = "text/html; charset=utf-8"
        const html = await rotaArquivo(req("GET", `/api/leads/arquivo/${comArquivo.id}`, dono.token), ctxMsg(comArquivo.id))
        ok("arquivo que o navegador executaria (HTML) NUNCA abre dentro do sistema: sai como download", html.status === 200 && html.headers.get("content-type") === "application/octet-stream" && (html.headers.get("content-disposition") ?? "").startsWith("attachment"))
        tipoDevolvido = "image/svg+xml"
        const svg = await rotaArquivo(req("GET", `/api/leads/arquivo/${comArquivo.id}`, dono.token), ctxMsg(comArquivo.id))
        ok("SVG também só como download", svg.headers.get("content-type") === "application/octet-stream" && (svg.headers.get("content-disposition") ?? "").startsWith("attachment"))
        ok("mensagem sem arquivo: 404", (await rotaArquivo(req("GET", `/api/leads/arquivo/${semArquivo.id}`, dono.token), ctxMsg(semArquivo.id))).status === 404)
        metaFora = true
        const sumiu = await rotaArquivo(req("GET", `/api/leads/arquivo/${comArquivo.id}`, dono.token), ctxMsg(comArquivo.id))
        ok("arquivo que a Meta já não guarda: a tela recebe a explicação, não um erro cru", sumiu.status === 502 && /não está mais disponível/.test((await sumiu.json()).error))
        metaFora = false

        console.log("\n12) As rotas, com a permissão")
        const lista = await rotaLista(req("GET", "/api/leads?situacao=AGUARDANDO_RESPOSTA", dono.token))
        const corpoLista = await lista.json()
        ok("GET /api/leads devolve a lista filtrada e a contagem", lista.status === 200 && Array.isArray(corpoLista.leads) && corpoLista.leads.every((l: { situacao: string }) => l.situacao === "AGUARDANDO_RESPOSTA") && corpoLista.leads.some((l: { id: number }) => l.id === c.id) && typeof corpoLista.contagem.ENCERRADO === "number")
        const aberto = await rotaLead(req("GET", `/api/leads/${c.id}`, dono.token), ctx(c.id))
        ok("GET /api/leads/[id] devolve o lead; id inválido ou inexistente é recusado", aberto.status === 200 && (await aberto.json()).lead.id === c.id && (await rotaLead(req("GET", "/api/leads/abc", dono.token), { params: Promise.resolve({ id: "abc" }) })).status === 400 && (await rotaLead(req("GET", "/api/leads/999999999", dono.token), ctx(999_999_999))).status === 404)
        const enviada = await rotaMensagens(req("POST", `/api/leads/${c.id}/mensagens`, dono.token, { texto: "Recebi o documento, obrigado." }), ctx(c.id))
        const chamada = pedidosAMeta.at(-1)
        ok("POST mensagens envia pelo número do agente e grava a resposta da pessoa", enviada.status === 201 && Boolean(chamada?.url.endsWith("/111/messages")) && (await conversaDe(telArq)).mensagens.at(-1)?.de === "ATENDENTE")
        ok("POST mensagens vazia: 400 com explicação", (await rotaMensagens(req("POST", `/api/leads/${c.id}/mensagens`, dono.token, { texto: "" }), ctx(c.id))).status === 400)
        const devolvida = await rotaDevolver(req("POST", `/api/leads/${c.id}/devolver`, dono.token, {}), ctx(c.id))
        ok("POST devolver: a conversa volta para o agente", devolvida.status === 200 && igual(await devolvida.json(), { devolvida: true, responderAgora: false }) && (await conversaDe(telArq)).estado === "AGENTE")
        ok("POST encerrar sem motivo: 400; com motivo: encerra", (await rotaEncerrar(req("POST", `/api/leads/${c.id}/encerrar`, dono.token, {}), ctx(c.id))).status === 400 && (await rotaEncerrar(req("POST", `/api/leads/${c.id}/encerrar`, dono.token, { motivo: "Só mandou um documento" }), ctx(c.id))).status === 200 && (await conversaDe(telArq)).estado === "ENCERRADA")
        ok("POST mensagens em lead encerrado: 409", (await rotaMensagens(req("POST", `/api/leads/${c.id}/mensagens`, dono.token, { texto: "oi" }), ctx(c.id))).status === 409)
        ok("POST reabrir: volta para a pessoa; de novo: 409", (await rotaReabrir(req("POST", `/api/leads/${c.id}/reabrir`, dono.token, {}), ctx(c.id))).status === 200 && (await conversaDe(telArq)).estado === "EQUIPE" && (await rotaReabrir(req("POST", `/api/leads/${c.id}/reabrir`, dono.token, {}), ctx(c.id))).status === 409)
      } finally {
        globalThis.fetch = fetchAntes
        for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"]) { if (envAntes[k] === undefined) delete process.env[k]; else process.env[k] = envAntes[k] }
      }
    }

    console.log("\n13) Lead não é tarefa (mandato §5)")
    {
      const depois = { tarefas: await prisma.tarefa.count(), processos: await prisma.processo.count() }
      ok("nenhuma Tarefa nem Processo foi criado ou removido", igual(antes, depois), `${JSON.stringify(antes)} → ${JSON.stringify(depois)}`)
      const tela = readFileSync("src/components/leads/Leads.tsx", "utf8")
      ok("a tela não atribui nem distribui: não há seletor de pessoa nem campo de data", !/<select/.test(tela) && !/type="date"|datetime-local/.test(tela) && !/Atribuir|responsavel/i.test(tela))
      ok("a tela não calcula situação: só desenha o que o servidor mandou", !/situacaoDoLead\(|podeResponderAoLead\(/.test(tela) && /ROTULO_DA_SITUACAO/.test(tela))
    }
  } finally {
    await limpar(criados)
  }

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  await prisma.$disconnect()
  if (falhou) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1) })
