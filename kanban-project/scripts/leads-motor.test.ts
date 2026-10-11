// scripts/leads-motor.test.ts — o agente de leads dentro do sistema (docs/leads-mandato.md, regras 6 a 18 e §10).
// WhatsApp e IA de MENTIRA + banco de TESTE: nenhuma chamada sai para a Meta nem para a IA, e só mexe no que ele mesmo criou.
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/leads-motor.test.ts
import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { FRASE_DE_ESPERA, receberMensagemDoLead, retomarConversasParadas, type Dependencias } from "@/src/services/leads/atendimento"
import { chaveDoTelefone, configuracaoDoAgente } from "@/src/services/leads/config"
import type { IA, RespostaDoAgente, TurnoDaConversa } from "@/src/services/leads/ia"
import type { EventoDoLead, WhatsApp } from "@/src/services/leads/whatsapp"
import { GET as webhookGet, POST as webhookPost } from "@/src/app/api/whatsapp/webhook/route"

const PREFIXO = "5500077" // telefones que só este teste cria
const FRASE_DA_BUSCA = "Um momento, vou iniciar a sua busca genealógica para verificar o que consigo localizar."
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function limpar() {
  await prisma.leadConversa.deleteMany({ where: { telefone: { startsWith: PREFIXO } } }) // cascata: mensagens
}

let seq = 0
const telefoneNovo = () => `${PREFIXO}${String(++seq).padStart(6, "0")}`
const texto = (telefone: string, t: string): EventoDoLead => ({ tipo: "texto", wamid: `wamid.TESTE.${++seq}`, telefone, nome: "Fulano de Teste", texto: t, midiaId: null, midiaTipo: null, midiaNome: null })
const arquivo = (telefone: string, midiaTipo: string, extra: Partial<EventoDoLead> = {}): EventoDoLead => ({ tipo: "arquivo", wamid: `wamid.TESTE.${++seq}`, telefone, nome: "", texto: "", midiaId: `MID${seq}`, midiaTipo, midiaNome: null, ...extra })
const fala = (mensagens: string[], mais: Partial<RespostaDoAgente> = {}): RespostaDoAgente => ({ mensagens, ficha: {}, linhagem: [], passar_para_equipe: false, motivo: "", resumo: "", ...mais })

type Resposta = RespostaDoAgente | ((turnos: TurnoDaConversa[]) => RespostaDoAgente | Promise<RespostaDoAgente>)

function montar(opcoes: { respostas?: Resposta[]; semIA?: boolean; soAtender?: Set<string>; agora?: () => Date; aoEnviar?: (jaEnviadas: number, para: string) => Promise<void>; esperar?: (ms: number) => Promise<void> } = {}) {
  const enviados: { para: string; texto: string }[] = []
  const digitou: (string | null)[] = []
  const pedidos: { fixas: string; hora: string; turnos: TurnoDaConversa[] }[] = []
  const respostas = opcoes.respostas ?? [fala(["Certo."])]
  let n = 0
  const ia: IA = {
    async responder(a) {
      pedidos.push({ fixas: a.instrucoesFixas, hora: a.instrucaoDaHora, turnos: structuredClone(a.turnos) })
      const r = respostas[Math.min(n, respostas.length - 1)]
      n++
      return typeof r === "function" ? await r(a.turnos) : r
    },
  }
  const whats: WhatsApp = {
    async enviarTexto(para, t) {
      if (opcoes.aoEnviar) await opcoes.aoEnviar(enviados.length, para)
      enviados.push({ para, texto: t })
      return `wamid.SAIDA.${++seq}`
    },
    async digitando(w) { digitou.push(w) },
    async baixarArquivo() { throw new Error("não usado neste teste") },
  }
  const deps: Dependencias = {
    whats,
    ia: opcoes.semIA ? null : ia,
    agente: { ...configuracaoDoAgente({} as NodeJS.ProcessEnv), esperaMs: 250, digitacaoBaseMs: 0, digitacaoPorLetraMs: 0, digitacaoMaxMs: 0, repeticaoDaTravaMs: 40, soAtender: opcoes.soAtender ?? new Set() },
    esperar: opcoes.esperar ?? pausa,
    agora: opcoes.agora ?? (() => new Date()),
    registrar: { error() {} },
  }
  return { deps, enviados, digitou, pedidos }
}

const conversaDe = (telefone: string) => prisma.leadConversa.findUnique({ where: { telefone }, include: { mensagens: { orderBy: { id: "asc" } } } })
const daqui = (ms: number) => () => new Date(Date.now() + ms)

async function main() {
  exigirBancoDeTeste("leads-motor.test.ts")
  await limpar()
  const antes = { tarefas: await prisma.tarefa.count(), processos: await prisma.processo.count(), avisos: await prisma.notificacaoOperacional.count() }

  console.log("\n1) Duas mensagens seguidas do lead viram uma pergunta só (regra 11)")
  {
    const tel = telefoneNovo()
    const t = montar({ respostas: [fala(["Olá, boa tarde. Tudo bem?", "Meu nome é Marco, prazer.", "Como posso ajudar?"])] })
    const a = receberMensagemDoLead(texto(tel, "Oi"), t.deps)
    await pausa(60)
    const b = receberMensagemDoLead(texto(tel, "quero saber da cidadania italiana"), t.deps)
    const [ra, rb] = await Promise.all([a, b])
    ok("a primeira mensagem cede a vez para a mais nova", ra === "ADIADA" && rb === "PROCESSADA", `${ra}/${rb}`)
    ok("a IA é chamada uma vez, com as duas mensagens juntas", t.pedidos.length === 1 && t.pedidos[0].turnos.at(-1)?.content === "Oi\nquero saber da cidadania italiana")
    ok("as três mensagens da abertura saem separadas, na ordem", igual(t.enviados.map((e) => e.texto), ["Olá, boa tarde. Tudo bem?", "Meu nome é Marco, prazer.", "Como posso ajudar?"]))
    ok("mostra \"digitando…\" antes de cada mensagem, apontando a última mensagem do lead", t.digitou.length === 3 && t.digitou.every((w) => typeof w === "string" && w.startsWith("wamid.TESTE.")))
    ok("as instruções levam o nome do agente e a hora vai em bloco separado", t.pedidos[0].fixas.startsWith("Você é Marco,") && !/Agora são/.test(t.pedidos[0].fixas) && /^Agora são \d\d:\d\d\.$/.test(t.pedidos[0].hora))
    const c = await conversaDe(tel)
    ok("a conversa segue com o agente, sem mensagem pendente e sem trava", c?.estado === "AGENTE" && c.mensagens.every((m) => !m.aguardaAgente) && c.processandoAte === null)
    ok("ficam gravadas as 2 do lead e as 3 do agente, com o identificador da Meta", igual(c?.mensagens.map((m) => m.de), ["LEAD", "LEAD", "AGENTE", "AGENTE", "AGENTE"]) && c!.mensagens.every((m) => !!m.wamid))
    ok("o nome do WhatsApp fica na conversa", c?.nomeWhats === "Fulano de Teste")
  }

  console.log("\n2) A mesma mensagem entregue duas vezes pela Meta é respondida uma vez")
  {
    const tel = telefoneNovo()
    const t = montar()
    const m = texto(tel, "Oi")
    const [r1, r2] = await Promise.all([receberMensagemDoLead(m, t.deps), receberMensagemDoLead({ ...m }, t.deps)])
    const r3 = await receberMensagemDoLead({ ...m }, t.deps)
    ok("uma é atendida e as outras são reconhecidas como repetidas", [r1, r2].filter((r) => r === "REPETIDA").length === 1 && r3 === "REPETIDA", `${r1}/${r2}/${r3}`)
    ok("uma chamada à IA e uma mensagem enviada", t.pedidos.length === 1 && t.enviados.length === 1)
    ok("uma única mensagem do lead gravada", (await conversaDe(tel))?.mensagens.filter((x) => x.de === "LEAD").length === 1)
  }

  console.log("\n3) A conversa continua com memória e a ficha nunca perde o que já tinha")
  {
    const tel = telefoneNovo()
    const t = montar({ respostas: [
      fala(["Legal. Quem é o ascendente italiano na sua linhagem?"], { ficha: { pais: "Itália", nome: "" }, resumo: "Quer cidadania italiana." }),
      fala(["Certo. Qual é o nome do seu avô?"], { ficha: { pais: "", antepassado: "avô" }, linhagem: [{ quem: "avô", nome: "", conjuge: "", pais: "", nasceu: "" }], resumo: "" }),
    ] })
    await receberMensagemDoLead(texto(tel, "quero a cidadania italiana"), t.deps)
    await receberMensagemDoLead(texto(tel, "meu avô"), t.deps)
    const c = await conversaDe(tel)
    ok("campo que voltou vazio não apaga o que já estava na ficha", igual(c?.ficha, { pais: "Itália", antepassado: "avô" }), JSON.stringify(c?.ficha))
    ok("a linhagem e o resumo ficam gravados (resumo vazio não apaga o anterior)", Array.isArray(c?.linhagem) && (c!.linhagem as unknown[]).length === 1 && c?.resumo === "Quer cidadania italiana.")
    ok("na segunda resposta a IA relê lead, agente e lead", igual(t.pedidos[1].turnos.map((x) => x.role), ["user", "assistant", "user"]))
    ok("a IA relê a própria resposta no formato em que escreve", JSON.parse(t.pedidos[1].turnos[1].content).mensagens[0] === "Legal. Quem é o ascendente italiano na sua linhagem?")
  }

  console.log("\n4) Na frase da busca genealógica a conversa passa e o agente se cala (regras 6 e 10)")
  {
    const tel = telefoneNovo()
    const t = montar({ respostas: [fala([FRASE_DA_BUSCA], { passar_para_equipe: true, motivo: "Triagem concluída", resumo: "Neto de italiano.", ficha: { nome: "Marcos", pais: "Itália" } })] })
    await receberMensagemDoLead(texto(tel, "não, só eu mesmo"), t.deps)
    let c = await conversaDe(tel)
    ok("sai exatamente a frase aprovada, sozinha", igual(t.enviados.map((e) => e.texto), [FRASE_DA_BUSCA]))
    ok("a conversa passa, com motivo, data e ficha", c?.estado === "EQUIPE" && c.motivoPassagem === "Triagem concluída" && c.passouEm !== null && igual(c.ficha, { nome: "Marcos", pais: "Itália" }))
    const r = await receberMensagemDoLead(texto(tel, "ok, obrigado"), t.deps)
    c = await conversaDe(tel)
    ok("mensagem nova do lead fica registrada, sem resposta do agente", r === "REGISTRADA" && t.pedidos.length === 1 && t.enviados.length === 1)
    ok("ela não fica marcada para o agente", c?.mensagens.at(-1)?.texto === "ok, obrigado" && c.mensagens.every((m) => !m.aguardaAgente))
  }

  console.log("\n5) Áudio, foto e documento: o agente não lê, passa a conversa e o arquivo fica guardado (regra 13)")
  {
    const tel = telefoneNovo()
    const t = montar()
    await receberMensagemDoLead(arquivo(tel, "audio"), t.deps)
    const c = await conversaDe(tel)
    ok("áudio na primeira mensagem: cumprimenta e pede um momento, sem chamar a IA", t.pedidos.length === 0 && t.enviados.length === 2 && /^Olá, (bom dia|boa tarde|boa noite)\.$/.test(t.enviados[0].texto) && t.enviados[1].texto === FRASE_DE_ESPERA)
    ok("a conversa passa, com o motivo", c?.estado === "EQUIPE" && /áudio/.test(c.motivoPassagem ?? ""))
    ok("o áudio fica guardado na conversa", c?.mensagens[0].midiaTipo === "audio" && !!c.mensagens[0].midiaId && c.mensagens[0].texto === "[áudio]")

    const tel2 = telefoneNovo()
    const t2 = montar({ respostas: [fala(["Certo. Qual é o nome do seu avô?"])] })
    await receberMensagemDoLead(texto(tel2, "meu avô era italiano"), t2.deps)
    await receberMensagemDoLead(arquivo(tel2, "document", { texto: "certidão dele", midiaNome: "certidao.pdf" }), t2.deps)
    const c2 = await conversaDe(tel2)
    ok("documento no meio da conversa: só \"Um momento, por favor.\", sem repetir o cumprimento", igual(t2.enviados.map((e) => e.texto), ["Certo. Qual é o nome do seu avô?", FRASE_DE_ESPERA]) && t2.pedidos.length === 1)
    const doc = c2?.mensagens.find((m) => m.midiaTipo === "document")
    ok("o documento fica com nome, legenda e identificador", doc?.midiaNome === "certidao.pdf" && doc.texto === "certidão dele" && !!doc.midiaId && c2?.estado === "EQUIPE" && /documento/.test(c2.motivoPassagem ?? ""))
  }

  console.log("\n6) Figurinha, reação e texto vazio não disparam nada")
  {
    const tel = telefoneNovo()
    const t = montar()
    const r1 = await receberMensagemDoLead({ ...texto(tel, ""), tipo: "ignorar" }, t.deps)
    const r2 = await receberMensagemDoLead(texto(tel, "   "), t.deps)
    ok("nada é gravado nem respondido", r1 === "IGNORADA" && r2 === "IGNORADA" && (await conversaDe(tel)) === null && t.enviados.length === 0)
  }

  console.log("\n7) IA fora do ar ou não configurada: \"Um momento, por favor.\" e a conversa passa (regra 14)")
  {
    const tel = telefoneNovo()
    const t = montar({ respostas: [fala(["Como posso ajudar?"]), () => { throw new Error("fora do ar") }] })
    await receberMensagemDoLead(texto(tel, "Oi"), t.deps)
    await receberMensagemDoLead(texto(tel, "quero a cidadania"), t.deps)
    const c = await conversaDe(tel)
    ok("o lead recebe a frase de espera e não fica sem resposta", t.enviados.at(-1)?.texto === FRASE_DE_ESPERA && t.enviados.length === 2)
    ok("a conversa passa com o motivo \"Falha técnica no agente\"", c?.estado === "EQUIPE" && c.motivoPassagem === "Falha técnica no agente")

    const tel2 = telefoneNovo()
    const t2 = montar({ semIA: true })
    await receberMensagemDoLead(texto(tel2, "Oi"), t2.deps)
    const c2 = await conversaDe(tel2)
    ok("sem chave de IA: cumprimenta, pede um momento e passa", t2.enviados.length === 2 && t2.enviados[1].texto === FRASE_DE_ESPERA && c2?.estado === "EQUIPE" && c2.motivoPassagem === "Agente sem IA configurada")
  }

  console.log("\n8) Mensagem nova enquanto a resposta era preparada: a resposta velha é descartada (regra 11)")
  {
    const tel = telefoneNovo()
    let segunda: Promise<unknown> = Promise.resolve()
    const t = montar({ respostas: [
      async () => {
        segunda = receberMensagemDoLead(texto(tel, "e quanto tempo demora?"), t.deps) // chega com a IA "pensando"
        await pausa(120)
        return fala(["resposta velha"])
      },
      fala(["resposta nova"]),
    ] })
    await receberMensagemDoLead(texto(tel, "quanto custa?"), t.deps)
    await segunda
    const c = await conversaDe(tel)
    ok("só a resposta nova é enviada", igual(t.enviados.map((e) => e.texto), ["resposta nova"]), JSON.stringify(t.enviados))
    ok("a IA é chamada de novo, com as duas mensagens", t.pedidos.length === 2 && t.pedidos[1].turnos.at(-1)?.content === "quanto custa?\ne quanto tempo demora?", JSON.stringify(t.pedidos[1]?.turnos))
    ok("nada fica pendente e a trava é solta", c?.mensagens.every((m) => !m.aguardaAgente) === true && c.processandoAte === null)
  }

  console.log("\n9) Uma pessoa assume no meio do envio: o agente para na hora (regra 16)")
  {
    const tel = telefoneNovo()
    const t = montar({
      respostas: [fala(["um", "dois", "três"])],
      aoEnviar: async (jaEnviadas, para) => {
        if (jaEnviadas !== 0) return
        // Simula a resposta de uma pessoa pela tela de Leads (Bloco 2): a conversa passa a ser dela.
        const c = await prisma.leadConversa.update({ where: { telefone: para }, data: { estado: "EQUIPE", motivoPassagem: "Assumido pela tela de Leads" }, select: { id: true } })
        await prisma.leadMensagem.create({ data: { conversaId: c.id, de: "ATENDENTE", texto: "Deixa comigo." } })
      },
    })
    await receberMensagemDoLead(texto(tel, "Oi"), t.deps)
    const c = await conversaDe(tel)
    ok("a mensagem que já estava saindo sai; as outras duas não", igual(t.enviados.map((e) => e.texto), ["um"]), JSON.stringify(t.enviados))
    ok("a conversa fica com a pessoa e o motivo dela não é sobrescrito", c?.estado === "EQUIPE" && c.motivoPassagem === "Assumido pela tela de Leads")
  }

  console.log("\n10) O WhatsApp recusa o envio: a conversa passa com o motivo e não é respondida de novo")
  {
    const tel = telefoneNovo()
    const t = montar({ aoEnviar: async () => { throw new Error("token vencido") } })
    await receberMensagemDoLead(texto(tel, "Oi"), t.deps)
    const c = await conversaDe(tel)
    ok("a conversa passa com \"Falha no envio pelo WhatsApp\"", c?.estado === "EQUIPE" && c.motivoPassagem === "Falha no envio pelo WhatsApp" && c.processandoAte === null)
    const r = await retomarConversasParadas({ ...t.deps, agora: daqui(10 * 60_000) })
    ok("a retomada não tenta responder de novo", r.encontradas === 0)
  }

  console.log("\n11) Modo de teste: só o telefone liberado é atendido (regra 17)")
  {
    const liberado = telefoneNovo() // 13 dígitos? não: prefixo de teste. A regra do nono dígito é conferida abaixo.
    const fora = telefoneNovo()
    const t = montar({ soAtender: new Set([chaveDoTelefone(liberado)]) })
    const r1 = await receberMensagemDoLead(texto(fora, "Oi"), t.deps)
    const r2 = await receberMensagemDoLead(texto(liberado, "Oi"), t.deps)
    ok("quem está fora da lista é ignorado, sem nada gravado", r1 === "IGNORADA" && (await conversaDe(fora)) === null)
    ok("quem está na lista é atendido", r2 === "PROCESSADA" && t.enviados.length === 1 && t.enviados[0].para === liberado)
    ok("celular do Brasil casa com e sem o nono dígito", chaveDoTelefone("(19) 98765-4321") === chaveDoTelefone("551987654321") && chaveDoTelefone("+55 19 98765-4321") === "551987654321")
  }

  console.log("\n12) Dois leads ao mesmo tempo não se misturam")
  {
    const a = telefoneNovo(), b = telefoneNovo()
    const t = montar({ respostas: [(turnos) => fala(["eco: " + turnos.at(-1)!.content])] })
    await Promise.all([receberMensagemDoLead(texto(a, "sou o A"), t.deps), receberMensagemDoLead(texto(b, "sou o B"), t.deps)])
    ok("cada um recebe a própria resposta", igual([...t.enviados].sort((x, y) => x.para.localeCompare(y.para)), [{ para: a, texto: "eco: sou o A" }, { para: b, texto: "eco: sou o B" }]))
  }

  console.log("\n13) A função morreu antes de responder: a retomada responde, uma vez só (rede de segurança)")
  {
    const tel = telefoneNovo()
    const morta = montar({ esperar: async () => { throw new Error("função encerrada") } })
    await receberMensagemDoLead(texto(tel, "Oi, tem alguém?"), morta.deps).catch(() => {})
    let c = await conversaDe(tel)
    ok("a mensagem ficou gravada e marcada para o agente", c?.mensagens.length === 1 && c.mensagens[0].aguardaAgente === true && morta.enviados.length === 0)

    const t = montar({ respostas: [fala(["Olá, boa tarde. Tudo bem?"])] })
    const cedo = await retomarConversasParadas(t.deps)
    ok("parada há menos de um minuto ainda não é retomada (pode estar sendo respondida)", cedo.encontradas === 0 && t.enviados.length === 0)
    const r = await retomarConversasParadas({ ...t.deps, agora: daqui(2 * 60_000) })
    c = await conversaDe(tel)
    ok("passado um minuto, a retomada responde", r.retomadas === 1 && igual(t.enviados.map((e) => e.texto), ["Olá, boa tarde. Tudo bem?"]))
    ok("nada fica pendente e a trava é solta", c?.mensagens.every((m) => !m.aguardaAgente) === true && c.processandoAte === null)
    const de_novo = await retomarConversasParadas({ ...t.deps, agora: daqui(20 * 60_000) })
    ok("rodar de novo não responde outra vez", de_novo.encontradas === 0 && t.enviados.length === 1)
  }

  console.log("\n14) Conversa sendo respondida não é retomada por outra chamada (trava)")
  {
    const tel = telefoneNovo()
    let liberar: () => void = () => {}
    const t = montar({ respostas: [async () => { await new Promise<void>((r) => (liberar = r)); return fala(["Certo."]) }] })
    const emCurso = receberMensagemDoLead(texto(tel, "Oi"), t.deps)
    while (t.pedidos.length < 1) await pausa(20)
    const c = await conversaDe(tel)
    ok("a conversa fica travada enquanto a resposta é preparada", c?.processandoAte !== null && c!.processandoAte!.getTime() > Date.now())
    const outra = montar()
    const r = await retomarConversasParadas({ ...outra.deps, agora: daqui(2 * 60_000) })
    ok("a retomada não pega conversa travada", r.encontradas === 0 && outra.enviados.length === 0)
    liberar()
    await emCurso
    ok("a resposta sai uma vez só", igual(t.enviados.map((e) => e.texto), ["Certo."]))
    const vencida = await retomarConversasParadas({ ...outra.deps, agora: daqui(10 * 60_000) })
    ok("depois de respondida, nada a retomar", vencida.encontradas === 0)
  }

  console.log("\n15) Webhook: desligado sem as chaves, confirma o endereço para a Meta e recusa assinatura falsa (regra 18, §8)")
  {
    const chaves = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "LEADS_SO_ATENDER"] as const
    for (const k of chaves) delete process.env[k]
    const url = "http://local/api/whatsapp/webhook"
    const corpo = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "999" }, statuses: [{ id: "wamid.S", status: "delivered" }] } }] }] })
    const assinar = (texto_: string, segredo: string) => "sha256=" + createHmac("sha256", segredo).update(texto_).digest("hex")
    const post = (c: string, assinatura?: string) => webhookPost(new NextRequest(url, { method: "POST", body: c, headers: assinatura ? { "x-hub-signature-256": assinatura } : {} }))

    let r = await webhookGet(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=senha&hub.challenge=4321`))
    ok("sem as chaves, o GET responde \"não configurado\"", r.status === 503 && (await r.json()).configurado === false)
    r = await post(corpo, assinar(corpo, "segredo"))
    ok("sem as chaves, o POST responde \"não configurado\"", r.status === 503)

    Object.assign(process.env, { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "999", WHATSAPP_VERIFY_TOKEN: "senha", WHATSAPP_APP_SECRET: "segredo" })
    r = await webhookGet(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=senha&hub.challenge=4321`))
    ok("com a senha certa, devolve o desafio da Meta", r.status === 200 && (await r.text()) === "4321")
    r = await webhookGet(new NextRequest(`${url}?hub.mode=subscribe&hub.verify_token=errada&hub.challenge=4321`))
    ok("com a senha errada, recusa", r.status === 403)
    r = await post(corpo)
    ok("POST sem assinatura é recusado", r.status === 401)
    r = await post(corpo, "sha256=" + "0".repeat(64))
    ok("POST com assinatura falsa é recusado", r.status === 401)
    r = await post(corpo, assinar(corpo, "outro-segredo"))
    ok("POST assinado com outra chave é recusado", r.status === 401)
    r = await post(corpo, assinar(corpo, "segredo"))
    ok("POST assinado pela Meta é aceito (aviso de entrega: nada a atender)", r.status === 200 && (await r.json()).ok === true)
    const lixo = "isto não é json"
    r = await post(lixo, assinar(lixo, "segredo"))
    ok("POST assinado mas ilegível é aceito sem fazer nada", r.status === 200)
    for (const k of chaves) delete process.env[k]
  }

  console.log("\n16) Lead não é tarefa: o módulo não toca tarefa, processo nem sino")
  {
    const depois = { tarefas: await prisma.tarefa.count(), processos: await prisma.processo.count(), avisos: await prisma.notificacaoOperacional.count() }
    ok("nenhuma Tarefa, Processo ou aviso do sino foi criado ou removido", igual(antes, depois), `${JSON.stringify(antes)} → ${JSON.stringify(depois)}`)
  }

  await limpar()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  await prisma.$disconnect()
  if (falhou) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1) })
