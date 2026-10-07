// scripts/torre-nova-equipe-visual.test.ts
// ============================================================================
// TORRE NOVA, FRENTE F (01/10/2026) — ABA EQUIPE: textos, cores e regras de exibição do PROTÓTIPO (CHECKLIST-T T325–T362).
//
//   npx tsx scripts/torre-nova-equipe-visual.test.ts   (sem banco)
//
// Prova, por funções puras (`equipe-visual.ts`, a ÚNICA fonte dos textos/cores da aba) e por varredura estática dos componentes:
//   • textos literais do protótipo (título, explicação, colunas, nota, modais, botões, toasts);
//   • barra de carga (vermelha > limite, âmbar > 80 %, verde), Atrasadas em alerta só > 5, Fila (> 3 "cheia", > 1,5, livre; decimal com ponto);
//   • "sem limite cadastrado" e "sem base" — a tela diz o que não sabe, nunca inventa;
//   • previsão: zero = "·", semana vermelha acima do que a pessoa fecha (Sem responsável sempre), Vencidas âmbar > 0;
//   • a soma da linha da previsão fecha com as abertas (a função servidora é testada em torre-previsao-soma-fecha-com-abertas);
//   • vocabulário oficial: nada de "ninguém"/"Com o cartório"; a tela de Equipe só tem a equipe (sem terceiros/tradutores).
// ============================================================================
import { readFileSync } from "node:fs"
import {
  TITULO_EQUIPE, TEXTO_EXPLICATIVO, TITULO_PREVISAO, SUBTITULO_PREVISAO, NOTA_PREVISAO, NOTA_SIMULACAO, TEXTO_MARCAR_AUSENCIA,
  COLUNAS_DA_TABELA, COLUNAS_DA_PREVISAO, TIPOS_DE_AUSENCIA, barraDaCarga, textoDaCarga, atrasadasEmAlerta, filaVisual, classeDaCelula, textoDaCelula,
  rotuloDaSemana, textoDaAusencia, textoDoPapel, nomeCurto, pedacosDaSugestao, toastAusenciaMarcada, toastAusenciaCancelada, toastSimulacaoAplicada,
  toastCarteiraMovida, toastDistribuicao, toastRedistribuicao, type AusenciaDaPessoa,
} from "../src/components/torre/equipe-visual"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")

secao("T325/T326/T327 — título, explicação e colunas (literais do protótipo)")
ok("título 'Quem está carregando o quê'", TITULO_EQUIPE === "Quem está carregando o quê")
ok("explicação de Carga e Fila, literal", TEXTO_EXPLICATIVO === "Carga = certidões que a pessoa pode tocar agora (fora as que aguardam terceiros) ÷ limite cadastrado. Fila = carga ÷ o que ela fecha por semana (média das últimas 4). Limite e aptidões vêm de Capacidade Operacional.")
ok("colunas: Pessoa · Carga · Ativas · Atrasadas · Aguard. terceiros · Fila · Ações", COLUNAS_DA_TABELA.join(" · ") === "Pessoa · Carga · Ativas · Atrasadas · Aguard. terceiros · Fila · Ações")

secao("T328–T332 — a linha da pessoa (papel, aptidões, disponibilidade)")
const agora = "2026-09-30T15:00:00.000Z"
const dani = { papel: "assistente", aptidoes: ["Certidões de registro civil"], aptidoesPais: ["Itália", "Espanha"], ausencia: null }
ok("Daniela: 'Assistente · aptidões: Itália, Espanha · disponível' (aptidões = países em que é apta)", textoDoPapel(dani, agora) === "Assistente · aptidões: Itália, Espanha · disponível", textoDoPapel(dani, agora))
const rafaelAus: AusenciaDaPessoa = { id: 1, tipo: "FERIAS", rotulo: "férias", inicio: "2026-09-25T03:00:00.000Z", fim: "2026-10-10T20:00:00.000Z", motivo: null, sucessorSugerido: { usuarioId: 2, nome: "Priscila" } }
ok("Rafael ausente: 'Assistente · aptidões: Itália · ausente (férias até 10/10 · sucessor sugerido: Priscila)'",
  textoDoPapel({ papel: "assistente", aptidoes: [], aptidoesPais: ["Itália"], ausencia: rafaelAus }, agora) === "Assistente · aptidões: Itália · ausente (férias até 10/10 · sucessor sugerido: Priscila)")
ok("Marco: 'Administrador · decisões · disponível' (o administrador não é 'apto' por país)", textoDoPapel({ papel: "Administrador", aptidoes: [], aptidoesPais: [], ausencia: null, ehAdministrador: true }, agora) === "Administrador · decisões · disponível")
ok("sem aptidão alguma: diz 'sem aptidão cadastrada' (nunca inventa)", textoDoPapel({ papel: "assistente", aptidoes: [], aptidoesPais: [], ausencia: null }, agora) === "Assistente · sem aptidão cadastrada · disponível")
ok("sem país, mostra as unidades de trabalho cadastradas", textoDoPapel({ papel: "assistente", aptidoes: ["Emissão de certidão"], aptidoesPais: [], ausencia: null }, agora) === "Assistente · aptidões: Emissão de certidão · disponível")
const futura: AusenciaDaPessoa = { ...rafaelAus, inicio: "2026-10-06T03:00:00.000Z", fim: "2026-10-17T20:00:00.000Z", sucessorSugerido: null }
ok("ausência que começa depois: 'férias 06/10 a 17/10'", textoDaAusencia(futura, agora) === "férias 06/10 a 17/10", textoDaAusencia(futura, agora))
ok("ausência aplicada pela simulação: 'saída simulada · 10 dias'", textoDaAusencia({ ...futura, motivo: "saída simulada · 10 dias" }, agora) === "saída simulada · 10 dias")
ok("sem data de retorno e já começada: 'ausência sem data de retorno'", textoDaAusencia({ ...rafaelAus, rotulo: "ausência", fim: null, sucessorSugerido: null }, agora) === "ausência sem data de retorno")

secao("T328/T334 — Carga: texto e barra (vermelha > limite, âmbar > 80 %, verde)")
ok("'91 executáveis · limite 80 · fecha 46/sem'", textoDaCarga(91, 80, 46) === "91 executáveis · limite 80 · fecha 46/sem")
ok("fecha arredonda (46,4 → 46/sem) como o protótipo", textoDaCarga(57, 150, 58.4) === "57 executáveis · limite 150 · fecha 58/sem")
ok("sem limite cadastrado: o texto DIZ, não inventa teto", textoDaCarga(12, null, 3) === "12 executáveis · sem limite cadastrado · fecha 3/sem")
ok("Daniela 91 de 80: vermelha, barra cheia (100 %)", JSON.stringify(barraDaCarga(91, 80)) === JSON.stringify({ largura: 100, cor: "verm" }))
ok("Marco 46 de 60 (77 %): verde", barraDaCarga(46, 60).cor === "verde")
ok("limites exatos: =100 % é âmbar (só > limite é vermelha); =80 % é verde (só > 80 % é âmbar)", barraDaCarga(80, 80).cor === "amb" && barraDaCarga(64, 80).cor === "verde" && barraDaCarga(65, 80).cor === "amb" && barraDaCarga(81, 80).cor === "verm")
ok("largura proporcional e nunca passa de 100", barraDaCarga(57, 150).largura === 38 && barraDaCarga(300, 150).largura === 100)

secao("T335/T328 — Atrasadas e Fila")
ok("Atrasadas em alerta (vermelho 700) só quando > 5", !atrasadasEmAlerta(5) && atrasadasEmAlerta(6) && !atrasadasEmAlerta(0))
ok("Fila 2.0 sem → âmbar, decimal com PONTO", JSON.stringify(filaVisual(2, 91)) === JSON.stringify({ texto: "2.0 sem", cor: "amb" }))
ok("Fila 1,5 ou menos → livre (verde)", filaVisual(1.5, 50).texto === "livre" && filaVisual(0.4, 3).cor === "grn")
ok("Fila > 3 → 'x.x sem · cheia' vermelho", JSON.stringify(filaVisual(3.04, 100)) === JSON.stringify({ texto: "3.0 sem · cheia", cor: "red" }) && filaVisual(3, 100).cor === "amb")
ok("sem base de medição COM trabalho = 'sem base' (nunca 'livre' fingido); sem trabalho = livre", filaVisual(null, 4).texto === "sem base" && filaVisual(null, 4).cor === "gry" && filaVisual(null, 0).texto === "livre")

secao("T352–T362 — Previsão de carga")
ok("título, subtítulo e nota literais", TITULO_PREVISAO === "Previsão de carga · próximas 4 semanas" && SUBTITULO_PREVISAO === "quantos prazos vencem por pessoa em cada semana"
  && NOTA_PREVISAO === "As 4 semanas + vencidas + depois + sem prazo somam o total de abertas da pessoa. Vermelho = semana acima do que a pessoa costuma fechar.")
ok("colunas: ... Vencidas · Depois · Sem prazo · Abertas", COLUNAS_DA_PREVISAO.join(" · ") === "Vencidas · Depois · Sem prazo · Abertas")
ok("rótulo da semana 'dd/mm–dd/mm' no fuso de São Paulo", rotuloDaSemana({ inicio: "2026-09-30T03:00:00.000Z", fim: "2026-10-07T02:59:59.999Z" }) === "30/09–06/10")
ok("zero aparece como '·' cinza", textoDaCelula(0) === "·" && textoDaCelula(7) === "7" && classeDaCelula(1, 0, 10) === "zero")
ok("semana vermelha quando > fecha/sem (58 > 46), branca quando <= (41 <= 46)", classeDaCelula(0, 58, 46) === "verm" && classeDaCelula(1, 41, 46) === "neutra" && classeDaCelula(0, 46, 46) === "neutra")
ok("quem fecha 0 (e a linha Sem responsável) fica vermelho com qualquer prazo > 0", classeDaCelula(0, 1, 0) === "verm" && classeDaCelula(3, 8, 0) === "verm")
ok("Vencidas âmbar quando > 0; Depois e Sem prazo nunca coloridas", classeDaCelula(4, 19, 46) === "amb" && classeDaCelula(4, 0, 46) === "zero" && classeDaCelula(5, 24, 0) === "neutra" && classeDaCelula(6, 11, 0) === "neutra")
// Os números do protótipo (T354–T359): a soma das 7 colunas é a coluna Abertas.
const protoPrev: Array<[string, number[], number]> = [
  ["Daniela Brait", [58, 41, 37, 22, 19, 24, 11], 212], ["Priscila", [30, 28, 22, 17, 6, 21, 7], 131], ["Rafael", [19, 21, 14, 12, 2, 15, 5], 88],
  ["Marco Rovatti", [9, 6, 8, 4, 3, 11, 5], 46], ["Tradutora parceira", [18, 14, 9, 6, 0, 10, 0], 57], ["Sem responsável", [32, 21, 11, 8, 14, 9, 1], 96],
]
ok("a soma das 7 colunas = Abertas, em todas as linhas do protótipo", protoPrev.every(([, v, t]) => v.reduce((a, b) => a + b, 0) === t))

secao("T351 — Sugestão automática (rodapé)")
const nomes = ["Daniela Brait", "Priscila Tavares", "Rafael Souza", "Marco Rovatti"]
ok("nomeCurto: primeiro nome; nome inteiro se dois dividem o primeiro", nomeCurto("Daniela Brait", nomes) === "Daniela" && nomeCurto("Ana Souza", ["Ana Souza", "Ana Lima"]) === "Ana Souza")
const sug = pedacosDaSugestao({
  movimentos: [{ deNome: "Daniela Brait", paraNome: "Priscila Tavares", quantidade: 40 }],
  semResponsavel: { total: 96, porPessoa: [{ nome: "Priscila Tavares", quantidade: 51 }, { nome: "Rafael Souza", quantidade: 45 }], semApto: 0, seguradas: 0 }, temAcao: true,
}, nomes)
ok("'Sugestão automática: passar 40 certidões de Daniela para Priscila e distribuir as 96 sem responsável entre Priscila e Rafael.'",
  sug.map((p) => p.texto).join("") === "Sugestão automática: passar 40 certidões de Daniela para Priscila e distribuir as 96 sem responsável entre Priscila e Rafael.", sug.map((p) => p.texto).join(""))
ok("o trecho 'N certidões de X para Y' vai em destaque (negrito)", sug.filter((p) => p.destaque).map((p) => p.texto).join() === "40 certidões de Daniela para Priscila")
const semNada = pedacosDaSugestao({ movimentos: [], semResponsavel: { total: 0, porPessoa: [], semApto: 0, seguradas: 0 }, temAcao: false }, nomes)
ok("sem o que sugerir, a frase diz isso (e o botão Redistribuir não aparece — teste da tela abaixo)", /^Sugestão automática: nenhuma/.test(semNada[0].texto))
const semApto = pedacosDaSugestao({ movimentos: [], semResponsavel: { total: 5, porPessoa: [], semApto: 5, seguradas: 0 }, temAcao: false }, nomes)
ok("sem apto comprovado: as sem responsável ficam para você atribuir em Tarefas", /ficam para você atribuir em Tarefas/.test(semApto.map((p) => p.texto).join("")))
ok("singular: '1 certidão de Lucas para Priscila'", pedacosDaSugestao({ movimentos: [{ deNome: "Lucas Ferraz", paraNome: "Priscila Tavares", quantidade: 1 }], semResponsavel: { total: 0, porPessoa: [], semApto: 0, seguradas: 0 }, temAcao: true }, ["Lucas Ferraz", "Priscila Tavares"]).map((p) => p.texto).join("").includes("1 certidão de Lucas para Priscila"))

secao("T337/T339/T340/T343/T348/T351 — toasts (textos do protótipo)")
ok("'Ausência marcada · Daniela Brait' · 'Ausência de Daniela Brait cancelada'", toastAusenciaMarcada("Daniela Brait") === "Ausência marcada · Daniela Brait" && toastAusenciaCancelada("Daniela Brait") === "Ausência de Daniela Brait cancelada")
ok("'184 tarefas movidas de Daniela Brait'", toastCarteiraMovida("Daniela Brait", { movidas: 184 }) === "184 tarefas movidas de Daniela Brait")
ok("…e o que ficou, quando o destino não é apto a tudo", toastCarteiraMovida("Daniela Brait", { movidas: 10, naoAptas: 3, falhas: 1 }) === "10 tarefas movidas de Daniela Brait · 3 ficaram (destino não apto) · 1 não passaram")
ok("'Ausência marcada e carteira de Daniela Brait movida'", toastSimulacaoAplicada("Daniela Brait") === "Ausência marcada e carteira de Daniela Brait movida")
ok("'96 certidões distribuídas por aptidão e carga: Rafael 51 · Priscila 45'", toastDistribuicao({ atribuidas: 96, porPessoa: [{ nome: "Rafael Souza", quantidade: 51 }, { nome: "Priscila Tavares", quantidade: 45 }], semApto: 0, seguradas: 0 }, nomes) === "96 certidões distribuídas por aptidão e carga: Rafael 51 · Priscila 45")
ok("distribuição parcial diz quantas ficaram para você atribuir em Tarefas", /· 4 ficam para você atribuir em Tarefas/.test(toastDistribuicao({ atribuidas: 2, porPessoa: [{ nome: "Rafael Souza", quantidade: 2 }], semApto: 3, seguradas: 1 }, nomes)))
ok("nada distribuído: diz que ficaram para você atribuir em Tarefas (não finge)", /^Nenhuma certidão distribuída: 5 sem apto/.test(toastDistribuicao({ atribuidas: 0, porPessoa: [], semApto: 5, seguradas: 0 }, nomes)))
ok("'40 certidões de Daniela movidas para Priscila · 96 sem dono distribuídas'", toastRedistribuicao({ movimentos: [{ deNome: "Daniela Brait", paraNome: "Priscila Tavares", movidas: 40 }], atribuidas: 96, semApto: 0, seguradas: 0 }, nomes) === "40 certidões de Daniela movidas para Priscila · 96 sem dono distribuídas")

secao("T338/T342/T344/T347 — modais e cartão de simulação (literais)")
ok("Marcar ausência: texto do modal", TEXTO_MARCAR_AUSENCIA === 'Só registra a ausência. Nada é movido; para mover use "Mover carteira" ou a simulação.')
ok("tipos: Férias · Afastamento · Ausência · Bloqueio operacional", TIPOS_DE_AUSENCIA.map(([, l]) => l).join(" · ") === "Férias · Afastamento · Ausência · Bloqueio operacional")
ok("nota da simulação, literal", NOTA_SIMULACAO === 'Nada foi gravado. "Aplicar" marca a ausência e move a carteira para o sucessor sugerido, com "Desfazer" (que também encerra a ausência).')
const modais = ler("src/components/torre/EquipeModais.tsx"), sim = ler("src/components/torre/EquipeSimulacao.tsx"), tabela = ler("src/components/torre/EquipeTabela.tsx"), tela = ler("src/components/torre/TorreEquipe.tsx")
ok("modal de ausência: 'Marcar ausência · {nome}', campos Tipo/De · Até/Motivo, botões Cancelar e Marcar",
  /`Marcar ausência · \$\{pessoa\.nome\}`/.test(modais) && modais.includes("Tipo (Férias · Afastamento · Ausência · Bloqueio operacional)") && modais.includes("De · Até") && modais.includes("Motivo")
  && modais.includes('cancelar="Cancelar"') && modais.includes('rotulo: "Marcar"'))
ok("modal de carteira: 'Mover carteira · {nome}', texto com {ativas} tarefas ativas, campos Destino/Incluir…, botões Cancelar e Mover",
  /`Mover carteira · \$\{origem\.nome\}`/.test(modais) && modais.includes("tarefas ativas. Só vai o que o destino é apto a fazer, a não ser que você marque o contrário.")
  && modais.includes("Destino (padrão: sucessor sugerido)") && modais.includes("Incluir tarefas para as quais o destino não é apto? (sim/não)") && modais.includes('rotulo: "Mover"'))
ok("simulação: 'Simulação: se {nome} sair {dias} dias', botões 'Aplicar: marcar ausência e mover carteira' e 'Fechar'",
  sim.includes("Simulação: se {sim.nome} sair {sim.dias} dias") && sim.includes("Aplicar: marcar ausência e mover carteira") && sim.includes(">Fechar<"))
ok("botões da linha: Marcar ausência · Cancelar ausência · Mover carteira · Simular saída", ["Marcar ausência", "Cancelar ausência", "Mover carteira", "Simular saída"].every((t) => tabela.includes(`>${t}<`)))
ok("linha Sem responsável: nome, '—', 'N sem dono', pílula 'distribuir' e botão 'Distribuir as N por aptidão e carga'",
  tabela.includes("Sem responsável") && tabela.includes("sem dono") && tabela.includes('"distribuir"') && /Distribuir as \{sr\.ativas\} por aptidão e carga/.test(tabela))
ok("rodapé: 'Redistribuir', '· Dias da simulação de saída' e o campo com aria-label 'Dias da simulação'", tabela.includes(">Redistribuir<") && tabela.includes("· Dias da simulação de saída") && tabela.includes('aria-label="Dias da simulação"'))
ok("Redistribuir e Distribuir só aparecem para quem pode editar e quando há o que fazer", /temAcao && acoes\.podeEditar/.test(tabela) && /sr\.ativas > 0 && acoes\.podeEditar/.test(tabela))
ok("a tela: breadcrumb 'Torre de Controle › Equipe' e título", tela.includes("Torre de Controle</a> › Equipe") && tela.includes("{TITULO_EQUIPE}"))

secao("T360/T362 — a previsão desenha as 4 semanas + Vencidas + Depois + Sem prazo + Abertas")
const prev = ler("src/components/torre/EquipePrevisao.tsx")
ok("as 7 células e o total, na ordem", /\[\.\.\.l\.porSemana\.map\(\(s\) => s\.n\), l\.vencidas, l\.depois, l\.semPrazo\]/.test(prev) && prev.includes("{l.total}"))
ok("a linha 'Sem responsável' usa fecha = 0 (sempre vermelha se > 0)", /semDono \? 0/.test(prev))

secao("Equipe só tem a equipe nossa + vocabulário oficial")
const todos = [modais, sim, tabela, tela, prev, ler("src/components/torre/equipe-visual.ts"), ler("lib/operacional/torre-equipe.ts"), ler("lib/operacional/torre-equipe-distribuicao.ts")].map(semComentarios).join("\n")
ok("nenhum 'ninguém', 'Sem ninguém' ou 'Com o cartório' na aba", !/ningu[ée]m|com o cart[óo]rio/i.test(todos))
ok("a aba não lista terceiros nem tradutores como pessoas (a lista é de Usuário que executa; nada de órgão/tradutora)", !/tradutor|OrgaoProtocolo|orgaoProtocolo/i.test(semComentarios(tabela + tela + prev)))
ok("sem placeholder/TODO/exemplo de protótipo na interface", !/\bTODO\b|FIXME|placeholder=|exemplo/.test(semComentarios(modais + sim + tabela + tela + prev)))
ok("o CSS é próprio (equipe.css) e usa só tokens (nenhum hex)", !/#[0-9a-fA-F]{3,8}\b/.test(semComentarios(ler("src/components/torre/equipe.css"))))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
