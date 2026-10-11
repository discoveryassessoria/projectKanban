// scripts/leads-whatsapp-ia.test.ts — as peças do agente de leads que não tocam o banco (docs/leads-mandato.md §7, §8 e §10):
// leitura do que a Meta entrega, assinatura do webhook, formato do que sai para a Meta e para a IA, configuração e situação do lead.
// Rede de MENTIRA: nenhuma chamada sai de verdade.   npx tsx scripts/leads-whatsapp-ia.test.ts
import { createHmac } from "node:crypto"
import { chaveDoTelefone, configuracaoDaIA, configuracaoDoAgente, configuracaoDoWhatsApp, modoDeTesteInvalido } from "@/src/services/leads/config"
import { criarIA, extrairJson, juntarTurnos, normalizarResposta, CAMPOS_DA_FICHA } from "@/src/services/leads/ia"
import { instrucaoDaHora, instrucoesFixas } from "@/src/services/leads/instrucoes"
import { horaLocal, saudacao } from "@/src/services/leads/atendimento"
import { podeResponderAoLead, situacaoDoLead } from "@/src/services/leads/situacao"
import { assinaturaValida, criarWhatsApp, lerEventos } from "@/src/services/leads/whatsapp"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv
const LEAD = "5519987654321"
const FRASE_DA_BUSCA = "Um momento, vou iniciar a sua busca genealógica para verificar o que consigo localizar."

async function main() {
  console.log("\n1) O que a Meta entrega vira uma lista simples")
  {
    const corpo = {
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [
        { field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "999" }, contacts: [{ profile: { name: "Marcos" }, wa_id: LEAD }], messages: [
          { from: LEAD, id: "wamid.1", timestamp: "1", type: "text", text: { body: "Oi" } },
          { from: LEAD, id: "wamid.2", timestamp: "2", type: "audio", audio: { id: "AUD", mime_type: "audio/ogg; codecs=opus", voice: true } },
          { from: LEAD, id: "wamid.3", timestamp: "3", type: "button", button: { text: "Quero saber mais", payload: "x" } },
          { from: LEAD, id: "wamid.4", timestamp: "4", type: "image", image: { id: "IMG", caption: "certidão do meu avô" } },
          { from: LEAD, id: "wamid.5", timestamp: "5", type: "document", document: { id: "DOC", filename: "certidao.pdf" } },
          { from: LEAD, id: "wamid.6", timestamp: "6", type: "reaction", reaction: { emoji: "👍", message_id: "wamid.0" } },
          { from: LEAD, id: "wamid.7", timestamp: "7", type: "location", location: { latitude: 1, longitude: 2 } },
          { from: LEAD, id: "wamid.8", timestamp: "8", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "a", title: "Sim" } } },
        ] } },
        { field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "999" }, statuses: [{ id: "wamid.S", status: "delivered", recipient_id: LEAD }] } },
        { field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "111" }, messages: [{ from: "5511900000000", id: "wamid.OUTRO", type: "text", text: { body: "número de teste" } }] } },
      ] }],
    }
    const ev = lerEventos(corpo, "999")
    ok("texto, botão e resposta de lista entram como texto; áudio, foto, documento e localização como arquivo; reação é ignorada",
      igual(ev.map((e) => e.tipo), ["texto", "arquivo", "texto", "arquivo", "arquivo", "ignorar", "arquivo", "texto"]), JSON.stringify(ev.map((e) => e.tipo)))
    ok("nome do contato, texto do botão e da lista", ev[0].nome === "Marcos" && ev[2].texto === "Quero saber mais" && ev[7].texto === "Sim")
    ok("áudio com identificador; foto com legenda; documento com nome", ev[1].midiaId === "AUD" && ev[1].midiaTipo === "audio" && ev[3].texto === "certidão do meu avô" && ev[3].midiaTipo === "image" && ev[4].midiaNome === "certidao.pdf" && ev[4].midiaTipo === "document")
    ok("o que não tem tipo conhecido entra como arquivo \"outro\" (vai para uma pessoa)", ev[6].midiaTipo === "outro" && ev[6].midiaId === null)
    ok("aviso de entrega não é mensagem", ev.every((e) => e.wamid !== "wamid.S"))
    ok("mensagem recebida por OUTRO número do mesmo aplicativo fica de fora", ev.every((e) => e.wamid !== "wamid.OUTRO") && lerEventos(corpo, "111").length === 1)
    ok("sem informar o número, lê tudo", lerEventos(corpo).length === 9)
    ok("corpo vazio ou estranho não quebra", igual(lerEventos({}), []) && igual(lerEventos(null), []) && igual(lerEventos("texto"), []))
  }

  console.log("\n2) A assinatura da Meta")
  {
    const corpo = '{"a":1}'
    const boa = "sha256=" + createHmac("sha256", "segredo").update(corpo).digest("hex")
    ok("aceita a verdadeira", assinaturaValida(corpo, boa, "segredo"))
    ok("recusa corpo alterado, chave errada, ausente, sem prefixo e chave vazia",
      !assinaturaValida('{"a":2}', boa, "segredo") && !assinaturaValida(corpo, boa, "outro") && !assinaturaValida(corpo, null, "segredo") && !assinaturaValida(corpo, boa.slice(7), "segredo") && !assinaturaValida(corpo, boa, ""))
  }

  console.log("\n3) O que sai para a Meta")
  {
    const chamadas: { url: string; corpo: Record<string, unknown> | null; auth: string }[] = []
    const buscar = async (url: string, init?: RequestInit) => {
      chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null, auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") })
      if (url.endsWith("/MID1")) return new Response(JSON.stringify({ url: "https://lookaside.invalid/arquivo", mime_type: "application/pdf" }), { status: 200 })
      if (url.includes("lookaside")) return new Response("PDF", { status: 200 })
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 })
    }
    const w = criarWhatsApp({ token: "TOKEN", telefoneId: "123", verifyToken: "v", appSecret: "s", versaoApi: "v25.0" }, buscar)
    const id = await w.enviarTexto(LEAD, "Olá")
    await w.digitando("wamid.IN")
    await w.digitando(null)
    ok("texto vai para o endereço do número, com o token", chamadas[0].url === "https://graph.facebook.com/v25.0/123/messages" && chamadas[0].auth === "Bearer TOKEN" && id === "wamid.X")
    ok("formato do texto", igual(chamadas[0].corpo, { messaging_product: "whatsapp", recipient_type: "individual", to: LEAD, type: "text", text: { preview_url: false, body: "Olá" } }))
    ok("\"digitando…\" marca como lida e mostra o indicador; sem mensagem do lead não chama nada", igual(chamadas[1].corpo, { messaging_product: "whatsapp", status: "read", message_id: "wamid.IN", typing_indicator: { type: "text" } }) && chamadas.length === 2)
    const arq = await w.baixarArquivo("MID1")
    ok("arquivo do lead: pergunta o endereço à Meta e baixa com o token", arq.tipo === "application/pdf" && arq.bytes.toString() === "PDF" && chamadas[3].auth === "Bearer TOKEN")
    const recusa = criarWhatsApp({ token: "T", telefoneId: "1", verifyToken: "v", appSecret: "s", versaoApi: "v25.0" }, async () => new Response('{"error":{"message":"token vencido"}}', { status: 401 }))
    let erro = ""
    await recusa.enviarTexto(LEAD, "x").catch((e: Error) => { erro = e.message })
    ok("envio recusado vira erro com o código da Meta", /401/.test(erro))
    let lancou = false
    await recusa.digitando("wamid.IN").catch(() => { lancou = true })
    ok("falha no \"digitando…\" nunca derruba a resposta", !lancou)
  }

  console.log("\n4) O que sai para a IA")
  {
    const pedidos: { url: string; corpo: Record<string, any>; h: Record<string, string> }[] = []
    let vez = 0
    const buscar = async (url: string, init?: RequestInit) => {
      pedidos.push({ url, corpo: JSON.parse(String(init?.body)), h: init?.headers as Record<string, string> })
      vez++
      const text = vez === 1 ? "Claro! Vou responder." : '```json\n{"mensagens":[" Certo. "],"ficha":{"pais":"Itália"},"linhagem":[{"quem":"avô","nome":"José"}],"passar_para_equipe":false,"motivo":"","resumo":"r"}\n```'
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 })
    }
    const ia = criarIA({ chave: "K", modelo: "modelo-x" }, buscar)
    const r = await ia.responder({ instrucoesFixas: "FIXO", instrucaoDaHora: "Agora são 14:05.", turnos: [{ role: "assistant", content: "sobra" }, { role: "user", content: "a" }, { role: "user", content: "b" }] })
    ok("resposta fora do formato é pedida de novo, uma vez", pedidos.length === 2 && igual(r.mensagens, ["Certo."]))
    ok("a ficha vem completa (campos ausentes viram vazio) e a linhagem normalizada", r.ficha.pais === "Itália" && CAMPOS_DA_FICHA.every((c) => typeof r.ficha[c] === "string") && igual(r.linhagem, [{ quem: "avô", nome: "José", conjuge: "", pais: "", nasceu: "" }]))
    const c = pedidos[0].corpo
    ok("endereço, chave e versão da API", pedidos[0].url === "https://api.anthropic.com/v1/messages" && pedidos[0].h["x-api-key"] === "K" && pedidos[0].h["anthropic-version"] === "2023-06-01" && c.model === "modelo-x")
    ok("o texto fixo vai marcado para cache e a hora vai depois, fora do cache", igual(c.system, [{ type: "text", text: "FIXO", cache_control: { type: "ephemeral" } }, { type: "text", text: "Agora são 14:05." }]))
    ok("turnos seguidos do mesmo lado viram um, começando pelo lead", igual(c.messages, [{ role: "user", content: "a\nb" }]))
    const esquema = c.output_config?.format?.schema
    ok("a resposta é pedida no formato fixo das instruções", c.output_config?.format?.type === "json_schema" && igual(esquema?.required, ["mensagens", "ficha", "linhagem", "passar_para_equipe", "motivo", "resumo"]) && esquema.additionalProperties === false && igual(esquema.properties.ficha.required, [...CAMPOS_DA_FICHA]) && esquema.properties.ficha.additionalProperties === false && esquema.properties.linhagem.items.additionalProperties === false)

    const fora = criarIA({ chave: "K", modelo: "m" }, async () => new Response(JSON.stringify({ content: [{ type: "text", text: "nada" }] }), { status: 200 }))
    let erro = ""
    await fora.responder({ instrucoesFixas: "F", instrucaoDaHora: "h", turnos: [{ role: "user", content: "x" }] }).catch((e: Error) => { erro = e.message })
    ok("duas respostas fora do formato viram erro (quem chama passa a conversa)", /fora do formato/.test(erro))
    let chamadas = 0
    const caiu = criarIA({ chave: "K", modelo: "m" }, async () => { chamadas++; return new Response('{"type":"error"}', { status: 529 }) })
    await caiu.responder({ instrucoesFixas: "F", instrucaoDaHora: "h", turnos: [{ role: "user", content: "x" }] }).catch((e: Error) => { erro = e.message })
    ok("API fora do ar: tenta duas vezes e devolve o erro com o código", chamadas === 2 && /529/.test(erro))
    ok("leitura do objeto com texto em volta", extrairJson('antes {"a":1} depois')?.a === 1 && extrairJson("sem nada") === null && extrairJson(null) === null)
    ok("sem mensagem para enviar não é resposta", normalizarResposta({ mensagens: ["  ", 3] }) === null && normalizarResposta(null) === null)
    ok("no máximo 4 mensagens por resposta", normalizarResposta({ mensagens: ["1", "2", "3", "4", "5", "6"] })?.mensagens.length === 4)
    ok("só `true` passa a conversa", normalizarResposta({ mensagens: ["a"], passar_para_equipe: "true" })?.passar_para_equipe === false && normalizarResposta({ mensagens: ["a"], passar_para_equipe: true })?.passar_para_equipe === true)
    ok("juntar turnos descarta resposta sem pergunta antes", igual(juntarTurnos([{ role: "assistant", content: "x" }]), []))
  }

  console.log("\n5) Configuração: desligado sem as chaves; modo de teste (regras 17 e 18)")
  {
    ok("sem nenhuma chave: desligado", configuracaoDoWhatsApp(env({})) === null)
    ok("faltando uma das quatro: desligado", configuracaoDoWhatsApp(env({ WHATSAPP_TOKEN: "a", WHATSAPP_PHONE_ID: "b", WHATSAPP_VERIFY_TOKEN: "c" })) === null && configuracaoDoWhatsApp(env({ WHATSAPP_TOKEN: "a", WHATSAPP_PHONE_ID: "b", WHATSAPP_VERIFY_TOKEN: "c", WHATSAPP_APP_SECRET: "  " })) === null)
    const cfg = configuracaoDoWhatsApp(env({ WHATSAPP_TOKEN: " a ", WHATSAPP_PHONE_ID: "b", WHATSAPP_VERIFY_TOKEN: "c", WHATSAPP_APP_SECRET: "d" }))
    ok("com as quatro: ligado, versão padrão da API", cfg?.token === "a" && cfg.versaoApi === "v25.0")
    const ag = configuracaoDoAgente(env({ LEADS_SO_ATENDER: " (19) 98765-4321 , 5511912345678 " }))
    ok("o agente se chama Marco e espera 6 segundos", ag.nome === "Marco" && ag.esperaMs === 6000)
    ok("modo de teste: lista lida com espaços e máscara", ag.soAtender.size === 2 && ag.soAtender.has(chaveDoTelefone("5519987654321")) && ag.soAtender.has(chaveDoTelefone("5511912345678")))
    ok("sem lista: atende todos", configuracaoDoAgente(env({})).soAtender.size === 0 && !modoDeTesteInvalido(env({})))
    ok("lista preenchida sem nenhum telefone válido NÃO vira \"atender todos\"", modoDeTesteInvalido(env({ LEADS_SO_ATENDER: "abc, 123" })) && !modoDeTesteInvalido(env({ LEADS_SO_ATENDER: "19987654321" })))
    ok("IA: sem chave não há IA; com chave, modelo padrão ou o informado", configuracaoDaIA(env({})) === null && configuracaoDaIA(env({ ANTHROPIC_API_KEY: "k" }))?.modelo === "claude-sonnet-5-5" && configuracaoDaIA(env({ ANTHROPIC_API_KEY: "k", LEADS_MODELO: "outro" }))?.modelo === "outro")
  }

  console.log("\n6) Instruções do agente (regras 2, 4, 6 e 8)")
  {
    const t = instrucoesFixas("Marco")
    ok("levam o nome do agente e a abertura em três mensagens", t.startsWith("Você é Marco,") && t.includes('"Meu nome é Marco, prazer."') && t.includes('"Como posso ajudar?"'))
    ok("levam a frase exata da busca genealógica", t.includes(FRASE_DA_BUSCA))
    ok("a regra de nunca dizer que é robô nem pessoa está lá", t.includes("você nunca diz que é robô, assistente virtual ou inteligência artificial") && t.includes("nunca afirma que é uma pessoa"))
    ok("valores e garantia ficam com o atendente", t.includes("Valor, forma de pagamento, parcelamento e garantia: você não informa nada disso."))
    ok("o texto fixo não muda com a hora (pode ficar em cache)", !/Agora são/.test(t) && instrucoesFixas("Marco") === t && instrucaoDaHora("09:07") === "Agora são 09:07.")
  }

  console.log("\n7) Hora e cumprimento no horário de Brasília")
  {
    ok("meia-noite e meio da tarde", horaLocal("America/Sao_Paulo", new Date("2026-10-10T03:05:00Z")) === "00:05" && horaLocal("America/Sao_Paulo", new Date("2026-10-10T17:30:00Z")) === "14:30")
    ok("bom dia, boa tarde e boa noite", saudacao("09:10") === "bom dia" && saudacao("14:30") === "boa tarde" && saudacao("21:00") === "boa noite" && saudacao("00:05") === "boa noite")
  }

  console.log("\n8) A situação do lead sai de uma função só (regras 15 e 21)")
  {
    ok("com o agente", situacaoDoLead({ estado: "AGENTE", ultimaDe: "LEAD" }) === "COM_O_AGENTE")
    ok("passou e ninguém respondeu: aguardando resposta", situacaoDoLead({ estado: "EQUIPE", ultimaDe: "AGENTE" }) === "AGUARDANDO_RESPOSTA" && situacaoDoLead({ estado: "EQUIPE", ultimaDe: null }) === "AGUARDANDO_RESPOSTA")
    ok("a última palavra é do lead: aguardando resposta", situacaoDoLead({ estado: "EQUIPE", ultimaDe: "LEAD" }) === "AGUARDANDO_RESPOSTA")
    ok("uma pessoa respondeu por último: respondido", situacaoDoLead({ estado: "EQUIPE", ultimaDe: "ATENDENTE" }) === "RESPONDIDO")
    ok("encerrado vence qualquer mensagem", situacaoDoLead({ estado: "ENCERRADA", ultimaDe: "LEAD" }) === "ENCERRADO")
    const agora = new Date("2026-10-11T15:00:00Z")
    ok("23h59 depois da última mensagem do lead ainda dá para responder; 24h01 não", podeResponderAoLead({ estado: "EQUIPE", ultimaDoLeadEm: new Date("2026-10-10T15:01:00Z"), agora }) && !podeResponderAoLead({ estado: "EQUIPE", ultimaDoLeadEm: new Date("2026-10-10T14:59:00Z"), agora }))
    ok("lead encerrado ou que nunca escreveu não recebe resposta", !podeResponderAoLead({ estado: "ENCERRADA", ultimaDoLeadEm: agora, agora }) && !podeResponderAoLead({ estado: "EQUIPE", ultimaDoLeadEm: null, agora }))
  }

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
