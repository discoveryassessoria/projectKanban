// scripts/torre-nova-terceiros-pedidos.test.ts
// ============================================================================
// TORRE NOVA, FRENTE G (01/10/2026) — TERCEIROS: a lista POR PEDIDO e o resumo POR TIPO (puro: `lib/operacional/terceiros-pedidos.ts`)
// + varredura ESTÁTICA da tela (textos exatos do protótipo, ausência de placar por cartório, hidratação).
//
//   npx tsx scripts/torre-nova-terceiros-pedidos.test.ts   (puro — não precisa de banco)
//
// PROVA (CHECKLIST-T T363–T391):
//   • pedido = tarefa AGUARDANDO; certidão (sem "- Inteiro Teor · pessoa") · pessoa (casal quando há) · família · "pedida há" · "cobrar em";
//   • "cobrar em": ontem (vermelho) · hoje (âmbar) · "há N d" (vencida antiga) · dd/mm (futura) · "—" (sem data) — fuso de São Paulo;
//   • "Cobrar" (primário) só quando a data é hoje/passada ou o acompanhamento venceu; Genealogia nunca; "Ver" nos demais;
//   • os cartões repartem EXATAMENTE o "aguardando terceiros" da Visão geral (`numeroDoKpi('cartorio')`);
//   • agrupado: ordenado por órgão (pt-BR), "<n> pedido(s) · um e-mail só, com todas as certidões", SEM número comparativo;
//   • o texto de um contato ("Priscila cobrou por e-mail · sem resposta") e do pedido ("… enviou o pedido pelo CRC · protocolo X");
//   • a tela: sem Régua/tempo médio/backlog/“Sem resposta (dias)”/“Não localizada”; rodapé e modais com os textos do protótipo.
// ============================================================================
import { readFileSync } from "node:fs"
import {
  ehPedidoDeTerceiro, quandoCobrar, precisaCobrar, pedidaHa, cobrancasTexto, certidaoDe, pedidosDeTerceiros, agruparPorOrgao, subtituloDoGrupo,
  resumoDeTerceiros, idsParaCobrar, ddmmHora, milhar, cartoriosDistintos, textoDoContato, textoDoPedido, SEM_ORGAO, type LinhaParaTerceiros,
} from "../lib/operacional/terceiros-pedidos"
import { numeroDoKpi } from "../lib/operacional/torre-kpis"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

// 01/10/2026 12:00 em São Paulo.
const AGORA = new Date("2026-10-01T15:00:00.000Z")
const dia = (d: number, hora = 12) => new Date(Date.UTC(2026, 9, 1 + d, hora + 3, 0, 0)).toISOString()

let seq = 0
const L = (o: Partial<LinhaParaTerceiros> = {}): LinhaParaTerceiros => ({
  taskId: ++seq, processoId: 1, titulo: "Certidão de nascimento - Inteiro Teor · Pietro Gallo", pessoaNome: "Pietro Gallo", casalNomes: null, familiaNome: "Gallo Pereira", processoNome: null,
  terceiroNome: "1º Ofício de Santos/SP", orgaoId: 10, totalCobrancas: 0, cobravelVencida: false, bolaCom: "Cartório", pedidaEm: dia(-30), cobrarEm: dia(5),
  dataPrazo: null, responsavelId: 7, atrasada: false, diasParaPrazo: null, estadoOperacao: "AGUARDANDO", acompanhamentoVencido: false, escalada: false,
  faseMacroKey: "emissao_documental", ...o,
})

async function main() {
  secao("PEDIDO e CERTIDÃO")
  ok("pedido = tarefa AGUARDANDO (a MESMA definição do cartão Aguardando terceiros)", ehPedidoDeTerceiro(L()) && !ehPedidoDeTerceiro(L({ estadoOperacao: "FILA" })) && !ehPedidoDeTerceiro(L({ estadoOperacao: "CONCLUIDA" })))
  ok("certidão = só o TIPO (sem '- Inteiro Teor' nem a pessoa)", certidaoDe("Certidão de óbito - Inteiro Teor · Giuseppe Bertolucci") === "Certidão de óbito" && certidaoDe("Certidão de casamento") === "Certidão de casamento")
  const [p1] = pedidosDeTerceiros([L({ titulo: "Certidão de casamento", pessoaNome: "Giuseppe Bertolucci", casalNomes: "Giuseppe Bertolucci e Ana Bertolucci", familiaNome: "Bertolucci" })], AGORA)
  ok("pessoa = o casal quando a certidão é de uma união; família ao lado", p1.pessoa === "Giuseppe Bertolucci e Ana Bertolucci" && p1.familia === "Bertolucci" && p1.certidao === "Certidão de casamento")
  ok("sem pessoa/família: '—' (nada inventado)", pedidosDeTerceiros([L({ pessoaNome: null, casalNomes: null, familiaNome: null, processoNome: null })], AGORA).every((p) => p.pessoa === "—" && p.familia === "—"))
  ok("cobranças: nenhuma · 1 cobrança · 2 cobranças", cobrancasTexto(0) === "nenhuma" && cobrancasTexto(1) === "1 cobrança" && cobrancasTexto(2) === "2 cobranças")
  ok("pedida há: dias civis no fuso da operação; sem pedido registrado → '—'", pedidaHa(dia(-52), AGORA) === "52 d" && pedidaHa(dia(0), AGORA) === "0 d" && pedidaHa(null, AGORA) === "—" && pedidaHa("lixo", AGORA) === "—")
  ok("pedida há: 23h50 de ontem ainda é ontem (dia civil, não 24 h)", pedidaHa(new Date("2026-10-01T02:50:00.000Z").toISOString(), AGORA) === "1 d")

  secao("COBRAR EM — ontem (vermelho) · hoje (âmbar) · data futura (cinza)")
  ok("ontem → 'ontem' vencida", quandoCobrar(dia(-1), AGORA).texto === "ontem" && quandoCobrar(dia(-1), AGORA).tom === "vencida")
  ok("hoje → 'hoje' âmbar (mesmo às 23h)", quandoCobrar(dia(0, 23), AGORA).texto === "hoje" && quandoCobrar(dia(0, 23), AGORA).tom === "hoje")
  ok("mais antigo que ontem → 'há N d' vencida", quandoCobrar(dia(-10), AGORA).texto === "há 10 d" && quandoCobrar(dia(-10), AGORA).tom === "vencida")
  ok("futuro → dd/mm no fuso da operação (cinza)", quandoCobrar(dia(4), AGORA).texto === "05/10" && quandoCobrar(dia(4), AGORA).tom === "futura" && quandoCobrar(dia(9), AGORA).texto === "10/10")
  ok("sem data → '—'", quandoCobrar(null, AGORA).texto === "—" && quandoCobrar(null, AGORA).tom === "sem" && quandoCobrar("x", AGORA).tom === "sem")
  ok("meia-noite UTC não vira o dia errado (21h de São Paulo ainda é hoje)", quandoCobrar(new Date("2026-10-02T00:00:00.000Z").toISOString(), AGORA).texto === "hoje")

  secao("COBRAR × VER — a data decide")
  ok("data de hoje ou passada → Cobrar", precisaCobrar(L({ cobrarEm: dia(0) }), AGORA) && precisaCobrar(L({ cobrarEm: dia(-1) }), AGORA))
  ok("data futura → Ver", !precisaCobrar(L({ cobrarEm: dia(1) }), AGORA))
  ok("acompanhamento vencido da Operação (cobravelVencida) → Cobrar, mesmo sem data de cobrança", precisaCobrar(L({ cobrarEm: null, cobravelVencida: true }), AGORA))
  ok("sem data e sem vencimento → Ver (nada a cobrar por suposição)", !precisaCobrar(L({ cobrarEm: null }), AGORA))
  ok("Genealogia nunca é cobrança de cartório", !precisaCobrar(L({ faseMacroKey: "genealogia", cobrarEm: dia(-3), cobravelVencida: true }), AGORA))
  ok("quem não está esperando ninguém não se cobra", !precisaCobrar(L({ estadoOperacao: "FILA", cobrarEm: dia(-3), cobravelVencida: true }), AGORA))

  secao("A LISTA — só pedidos, na ordem de urgência (sem controle de ordenação na tela)")
  const linhas = [
    L({ taskId: 901, cobrarEm: dia(9), pedidaEm: dia(-12) }), L({ taskId: 902, cobrarEm: dia(0), pedidaEm: dia(-21) }), L({ taskId: 903, cobrarEm: dia(-1), pedidaEm: dia(-52) }),
    L({ taskId: 904, cobrarEm: dia(0), pedidaEm: dia(-42) }), L({ taskId: 905, cobrarEm: dia(4), pedidaEm: dia(-33) }), L({ taskId: 906, cobrarEm: null, pedidaEm: null }),
    L({ taskId: 907, estadoOperacao: "FILA" }),
  ]
  const lista = pedidosDeTerceiros(linhas, AGORA)
  ok("a tarefa que não espera terceiro fica fora", !lista.some((p) => p.taskId === 907) && lista.length === 6)
  ok("vencidos antes de hoje, hoje antes do futuro, no mesmo dia o pedido mais antigo primeiro, sem data por último", lista.map((p) => p.taskId).join(",") === "903,904,902,905,901,906", lista.map((p) => p.taskId).join(","))
  ok("'Cobrar' só onde a data é ontem/hoje (903, 904, 902)", lista.filter((p) => p.cobrar).map((p) => p.taskId).join(",") === "903,904,902")

  secao("AGRUPADO POR CARTÓRIO — só para cobrar junto")
  const doGrupo = pedidosDeTerceiros([
    L({ taskId: 1001, terceiroNome: "Registro Civil de Granada", orgaoId: 5 }), L({ taskId: 1002, terceiroNome: "Cartório de Caxias do Sul/RS", orgaoId: 3 }),
    L({ taskId: 1003, terceiroNome: "1º Ofício de Santos/SP", orgaoId: 1 }), L({ taskId: 1004, terceiroNome: "Cartório de Caxias do Sul/RS", orgaoId: 3 }),
    L({ taskId: 1005, terceiroNome: "Conservatória de Braga", orgaoId: 4 }), L({ taskId: 1006, terceiroNome: null, orgaoId: null }),
  ], AGORA)
  const grupos = agruparPorOrgao(doGrupo)
  ok("ordena por nome do órgão (pt-BR); sem órgão vai para o fim, em grupo próprio", grupos.map((g) => g.nome).join(" | ") === `1º Ofício de Santos/SP | Cartório de Caxias do Sul/RS | Conservatória de Braga | Registro Civil de Granada | ${SEM_ORGAO}`)
  ok("o mesmo órgão numa linha só: Caxias do Sul com 2 pedidos", grupos.find((g) => g.orgaoId === 3)!.pedidos.length === 2)
  ok("cabeçalho: '<n> pedido(s) · um e-mail só, com todas as certidões'", subtituloDoGrupo(2) === "2 pedido(s) · um e-mail só, com todas as certidões" && subtituloDoGrupo(1) === "1 pedido(s) · um e-mail só, com todas as certidões")
  ok("o grupo NÃO carrega número comparativo (nada de média, ranking, sem resposta)", grupos.every((g) => Object.keys(g).sort().join(",") === "nome,orgaoId,pedidos"))
  ok("cartórios distintos para o texto do modal", cartoriosDistintos(doGrupo) === 5 && cartoriosDistintos(doGrupo.filter((p) => p.orgaoId === 3)) === 1)

  secao("OS SEIS CARTÕES — fecham com a Visão geral")
  const mix: LinhaParaTerceiros[] = [
    L({ bolaCom: "Cartório" }), L({ bolaCom: "Cartório", responsavelId: 8, cobrarEm: dia(0) }), L({ bolaCom: "Cliente" }), L({ bolaCom: "Tradutor" }), L({ bolaCom: "Tradutor" }),
    L({ bolaCom: "Juízo" }), L({ bolaCom: "Consulado" }), L({ bolaCom: "Cartório", responsavelId: null }),            // sem responsável: lista sim, cartão 1 não
    L({ bolaCom: "Nossa", estadoOperacao: "FILA" }), L({ bolaCom: "Cartório", escalada: true }), L({ bolaCom: "Cartório", cobravelVencida: true, cobrarEm: dia(3) }),
  ]
  const r = resumoDeTerceiros(mix, AGORA)
  ok("cartão 1 = numeroDoKpi('cartorio') — o MESMO número da Visão geral e da aba Tarefas", r.aguardando === numeroDoKpi("cartorio", mix, AGORA) && r.aguardando === 9)
  ok("cartões 2–4 repartem o cartão 1 (cartórios + cliente + tradutora·juízo·consulado)", r.comCartorios + r.comOCliente + r.tradutora + r.juizo + r.consulado === r.aguardando, JSON.stringify(r))
  ok("cada tipo: cartórios 4 · cliente 1 · tradutora 2 · juízo 1 · consulado 1", r.comCartorios === 4 && r.comOCliente === 1 && r.tradutora === 2 && r.juizo === 1 && r.consulado === 1)
  ok("a LISTA mostra também o pedido sem responsável (cobrar um terceiro não depende de a tarefa ter dono)", pedidosDeTerceiros(mix, AGORA).length === 10 && r.aguardando === 9)
  ok("para cobrar hoje ou vencidas = pedidos com Cobrar (também o N do botão 'Cobrar todos os vencidos')", r.paraCobrar === pedidosDeTerceiros(mix, AGORA).filter((p) => p.cobrar).length && idsParaCobrar(mix, AGORA).length === r.paraCobrar)
  ok("escaladas = pedidos escalados", r.escaladas === 1)
  ok("milhar pt-BR sem depender do ambiente", milhar(2328) === "2.328" && milhar(94) === "94" && milhar(1234567) === "1.234.567" && milhar(0) === "0")

  secao("O TEXTO DE UM CONTATO")
  ok("data/hora do contato como no protótipo ('25/09 10:12'), no fuso de São Paulo", ddmmHora("2026-09-25T13:12:00.000Z") === "25/09 10:12" && ddmmHora("2026-10-01T02:50:00.000Z") === "30/09 23:50" && ddmmHora("x") === "—")
  ok("cobrança por e-mail sem resposta", textoDoContato({ quem: "Priscila Tavares", canal: "EMAIL", resultado: "SEM_RESPOSTA", observacao: null }) === "Priscila Tavares cobrou por e-mail · sem resposta")
  ok("ligação com a observação entre aspas", textoDoContato({ quem: "Daniela Brait", canal: "TELEFONE", resultado: "EM_BUSCA", observacao: "em busca no acervo" }) === 'Daniela Brait ligou · em busca · "em busca no acervo"')
  ok("quem não consta no registro não é inventado", /^Alguém da equipe cobrou por WhatsApp · não localizou$/.test(textoDoContato({ quem: null, canal: "WHATSAPP", resultado: "NAO_LOCALIZOU", observacao: "  " })))
  ok("o envio do pedido, com protocolo quando há", textoDoPedido({ quem: "Daniela Brait", canal: "CRC", protocolo: "2026-0819-441" }) === "Daniela Brait enviou o pedido pelo CRC · protocolo 2026-0819-441" && textoDoPedido({ quem: "Daniela Brait", canal: "BALCAO", protocolo: null }) === "Daniela Brait enviou o pedido pelo balcão")

  secao("A TELA — textos do protótipo, sem placar por cartório, sem relógio no render")
  const tela = ler("src/components/torre/TorreTerceiros.tsx"), modais = ler("src/components/torre/TerceirosModais.tsx"), css = ler("src/components/torre/terceiros.css")
  const rodape = 'A lista é por pedido. "Agrupado por cartório" serve só para cobrar junto o que está no mesmo lugar; não há ranking nem média por cartório, porque a maioria aparece uma vez só. Quem decide quando cobrar é a data de cobrança de cada pedido (padrão: 7 dias depois do pedido ou da última cobrança). "Cobrar" registra no histórico da certidão e marca a próxima data.'
  ok("T363 trilha e título", tela.includes("Torre de Controle</Link> › Terceiros") && tela.includes("Terceiros · quem de fora está nos devendo resposta"))
  ok("T364–T366 os seis cartões e seus rótulos", ["aguardando terceiros", "com cartórios", "com o cliente", "tradutora · juízo · consulado", "para cobrar hoje ou vencidas", "escaladas (sem resposta após 2 cobranças)"].every((t) => tela.includes(t)))
  ok("T367–T370 título do cartão, 'Ver:', os dois botões, 'Cobrar todos os vencidos (N)', colunas", ["Pedidos esperando resposta", "Ver:", "por pedido", "agrupado por cartório (para cobrar junto)", "Cobrar todos os vencidos (", "Certidão · pessoa · família", "Pedida a", "Pedida há", "Cobrar em", "Ações"].every((t) => tela.includes(t)))
  ok("T378 'Cobrar' (primário) × 'Ver' (leva ao Detalhe do Processo) + 'Contatos'", /className="tor-btn pri" onClick=\{\(\) => setCobrar\(p\)\}>Cobrar</.test(tela) && /router\.push\(`\/torre\/processo\/\$\{p\.processoId\}`\)/.test(tela) && />Ver</.test(tela) && />Contatos</.test(tela))
  ok("T388 'Cobrar este cartório (n)' e o toast do grupo", tela.includes("Cobrar este cartório (") && tela.includes("registrada em cada uma") && tela.includes("Cobrança enviada a "))
  ok("T380 toast 'Cobrança enviada e registrada · <pessoa>'", tela.includes("`Cobrança enviada e registrada · ${p.pessoa}`"))
  ok("T386 toast do lote", tela.includes("cobranças enviadas e registradas"))
  ok("T390 rodapé do cartão, palavra por palavra", tela.replace(/\s+/g, " ").includes(rodape))
  ok("T391 nenhum filtro, ordenação ou paginação na tela", !/<select|type="search"|placeholder=|pagina|ordenar/i.test(semComentarios(tela)))
  ok("T379 modal Cobrar: texto, campos, botões", modais.includes("O sistema envia pelo canal cadastrado, registra no histórico da certidão e marca a próxima cobrança.") && modais.includes("Canal") && modais.includes("Próxima cobrança em (dias)") && modais.includes("Cancelar") && modais.includes("Enviar e registrar"))
  ok("T386 modal lote: título, texto, botão 'Enviar N cobranças'", modais.includes("Cobrar todos os vencidos") && modais.includes("de cobrança vencida ou de hoje, em") && modais.includes("Um e-mail por cartório pelo canal cadastrado; cada certidão recebe o registro.") && modais.includes("Enviar ${n}"))
  ok("T381 modal Contatos: 'Contatos · <certidão> · <pessoa>', 'Pedido a <órgão> · <cobranças> até agora', botão único Fechar", modais.includes("`Contatos · ${pedido.certidao} · ${pedido.pessoa}`") && modais.includes("até agora") && (modais.match(/>Fechar</g) ?? []).length === 1)
  ok("a próxima cobrança vai ao servidor (porta única), padrão 7 dias", tela.includes("proximaEmDias") && modais.includes("DIAS_PADRAO_DA_COBRANCA") && tela.includes("/api/torre/terceiros/cobrar"))
  const regua = ler("src/components/torre/TerceirosRegua.tsx")
  ok("NÃO há placar por cartório: nada de 'sem resposta (dias)', 'não localizada', ranking ou média por órgão", !/Sem resposta \(dias\)|Não localizada|naoLocalizada|semResposta/i.test(semComentarios(tela) + semComentarios(modais) + semComentarios(regua)))
  ok("o que JÁ EXISTIA fica na aba, abaixo da lista: Régua por órgão, Contatos do órgão, Tempo médio real por fase e Backlog", tela.includes("<TerceirosRegua versao={versao} />") && ["Régua de cobrança por órgão", "Tempo médio real por fase", "Backlog", "/api/torre/terceiros/${o.orgaoId}/contatos", "/api/operacao/tempo-medio-por-fase", "/api/torre/tendencias", "Régua = o que o Gerenciamento cadastrou"].every((t) => regua.includes(t)))
  ok("a régua mostra só o cadastro (nunca 'tempo aprendido')", !/aprendid|mediana|pior caso/i.test(semComentarios(regua)))
  ok("nenhum ranking/média/comparativo por cartório no módulo puro", !/ranking|m[eé]dia|mediana|comparativ|(?<!locale)compar(?!e\()/i.test(semComentarios(ler("lib/operacional/terceiros-pedidos.ts")).replace(/"[^"\n]*"|'[^'\n]*'/g, "")))
  ok("hidratação: nenhum new Date()/Date.now()/Math.random() no CORPO de render (só dentro de effect)", !/new Date\(\)/.test(semComentarios(tela).replace(/useEffect\(\(\) => \{[^}]*\}, \[[^\]]*\]\)/g, "")) && !/Date\.now\(|Math\.random\(|toLocale(Date|Time)?String\(/.test(semComentarios(tela) + semComentarios(modais)))
  ok("o 'agora' vem de useAgora (null no servidor e no 1º render; minuto depois do mount) — nada de relógio no render", /const agora = useAgora\(\)/.test(tela) && /useSyncExternalStore<number \| null>\(semInscricao, minutoAtual, \(\) => null\)/.test(ler("src/lib/torre-agora.ts")))
  ok("CSS próprio, só tokens globais (sem cor fixa)", !/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")))
  ok("a tela usa o vocabulário oficial (nunca 'Com o cartório', 'ninguém', 'Equipe e Terceiros')", !/com o cart[óo]rio|ningu[eé]m|Equipe e Terceiros/i.test(semComentarios(tela) + semComentarios(modais)))

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
