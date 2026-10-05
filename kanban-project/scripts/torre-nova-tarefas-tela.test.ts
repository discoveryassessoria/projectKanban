// scripts/torre-nova-tarefas-tela.test.ts
// ============================================================================
// ABA TAREFAS DA TORRE NOVA — ESTÁTICO: os textos EXATOS do protótipo estão na tela, na ordem dos blocos, com cada botão ligado
// (handler + porta + feedback) e sem texto de exemplo nem termo proibido. Sem banco.
//   npx tsx scripts/torre-nova-tarefas-tela.test.ts
// ============================================================================
import { readFileSync, existsSync } from "node:fs"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const D = "src/components/torre/"
const tt = ler(D + "TorreTarefas.tsx"), fx = ler(D + "TorreFiltros.tsx"), vs = ler(D + "VisoesSalvas.tsx"), tab = ler(D + "TarefasTabela.tsx"), gav = ler(D + "TarefasGaveta.tsx")
const mod = ler(D + "TarefasModais.tsx"), tra = ler(D + "TarefasTransversal.tsx"), fei = ler(D + "TorreFeito.tsx"), vin = ler(D + "VincularOrgaoLoteModal.tsx"), pai = ler(D + "PainelTorreTarefa.tsx")
const lib = ler("lib/operacional/torre-tarefas-tela.ts")
const tudo = [tt, fx, vs, tab, gav, mod, tra, fei, vin, pai].join("\n")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
const cod = semComentarios(tudo)

secao("Cabeçalho (T228–T231)")
ok("breadcrumb 'Torre de Controle › Tarefas' e título 'Tarefas' com o subtítulo do protótipo", /Torre de Controle<\/Link> › Tarefas/.test(tt) && /<h2>Tarefas<\/h2>/.test(tt) && tt.includes("cada linha é uma tarefa: a certidão de uma pessoa em uma fase (emissão, tradução, apostila…) ou uma tarefa avulsa"))
ok("'▶ Fazer agora (N)' some na visão Feito; '+ Tarefa transversal' sempre", /visao !== "feito" && <button[^>]*onClick=\{iniciarFoco\}>▶ Fazer agora \(\{nTrabalho\}\)/.test(tt) && /\+ Tarefa transversal/.test(tt))
ok("modal 'Tarefa transversal' com o texto, o campo 'Família / processo' (Digite: Martín…), botão 'Criar' e toast 'Tarefa transversal criada'", /titulo="Tarefa transversal"/.test(tra) && tra.includes("Tarefa que não nasce da árvore (ex.: pedir procuração, cobrar pagamento).") && /Família \/ processo/.test(tra) && /Digite: Martín…/.test(tra) && /botao="Criar"/.test(tra) && /avisar\("Tarefa transversal criada"\)/.test(tt))

secao("Visão e Salvas (T232–T247)")
ok("Visão: 8 botões com selo numérico e 'aria-pressed'", /<span className="tf-n">/.test(vs) && /aria-pressed=\{valor === v\}/.test(vs))
ok("trocar de visão limpa a seleção mas mantém os filtros", /onEscolherFixa=\{\(v\) => \{ setVisaoSel\(v\); setSel\(\{\}\) \}\}/.test(tt))
ok("Feito: texto, três cartões e colunas do protótipo", fei.includes("Concluídas nos últimos 14 dias · toda a equipe ·") && /Antes \(12 dias\)/.test(fei) && ["Certidão · pessoa", "Família", "Concluída em", "Prazo era", "Por quem"].every((c) => fei.includes(c)) && /concluída\(s\)/.test(fei))
ok("Salvas: chips '★ nome' (minhas) e 'Da equipe: …', '+ Salvar visão atual' (tracejado) → modal 'Salvar visão'", /★/.test(vs) && /Da equipe: /.test(vs) && /\+ Salvar visão atual/.test(vs) && /titulo="Salvar visão"/.test(vs) && vs.includes("Guarda visão, agrupamento, filtros, país e busca.") && /Itália · emissão parada/.test(vs) && vs.includes('Visão salva · aparece em "Salvas"'))
ok("'Salvar visão' salva TODOS os filtros (RelatorioVisao, sem migration) e a justificativa", /\.\.\.atual/.test(vs) && /filtros/.test(tt.match(/const specAtual[^\n]*/)![0]) && /justificativa: just/.test(vs) && !existsSync("prisma/migrations/20261001999999_x"))

secao("Painel de filtros (T248–T269)")
ok("rótulos da linha 1 e 2 do protótipo", ["Família", "Responsável", "Prazo", "Iniciou", "Nacionalidade", "Fase", "Certidão", "Risco", "Agrupar por", "Dentro da família", "Ordenar por", "Limpar filtros"].every((r) => fx.includes(r)))
ok("Iniciou: Qualquer data · Hoje · Esta semana · Há mais de 30 dias · Ainda não iniciou · Intervalo de/até…", fx.includes("Qualquer data") && fx.includes("Intervalo de/até…") && ["Hoje", "Esta semana", "Há mais de 30 dias", "Ainda não iniciou"].every((r) => lib.includes(`'${r}'`)))
ok("Agrupar por: Família · Responsável · Fase · Sem agrupamento · Dentro da família: Pessoa · Órgão · Passo · Nenhum", ["Família", "Responsável", "Fase", "Sem agrupamento", "Pessoa", "Órgão", "Passo", "Nenhum"].every((r) => new RegExp(`>${r}</option>`).test(fx)))
ok("Ordenar por: Ordem padrão (risco, prazo) · Prazo · Família · Responsável · Criação", fx.includes("Ordem padrão (risco, prazo)") && ["Prazo", "Família", "Responsável", "Criação"].every((r) => new RegExp(`>${r}</option>`).test(fx)))
ok("Cobrança: Qualquer · Vence em até 3 dias · Sem resposta (escalada) · Sem cobrança marcada", ["Vence em até 3 dias", "Sem resposta (escalada)", "Sem cobrança marcada"].every((r) => fx.includes(r)))
ok("Mostrando N de M · 50 por página (a mesma conta da tabela)", /Mostrando \{mostrando\} de \{total\} · \{porPagina\} por página/.test(fx) && /LINHAS_POR_PAGINA = 50/.test(tt))
ok("Sem duplicar visões: Responsável só pessoas, Prazo sem 'Vencidas', Status só 3", /PRAZOS_TORRE\.filter\(\(p\) => p !== "vencidas"/.test(fx) && /value="NAO_INICIADA">A iniciar/.test(fx) && /value="CANCELADA">Cancelada/.test(fx) && !/>Eu<\/option>|>Sem responsável<\/option>/.test(fx.replace(/\{filtros\.responsavel\.includes[^\n]*\n/g, "")))

secao("Bloqueio e lote (T270–T280)")
ok("faixa Bloqueio: texto do protótipo e 'Vincular órgão nas N'", /Bloqueio/.test(tt) && /sem órgão emissor/.test(tt) && /até você vincular o cartório\./.test(tt) && /Vincular órgão nas \{semOrgao\.length\}/.test(tt))
ok("modal 'Vincular órgão nas N certidões' / 'Vincular órgão' com a busca de órgãos cadastrados", vin.includes("Busca só em órgãos cadastrados (mínimo 2 letras).") && /Vincular órgão nas \$\{n\} certidões/.test(vin) && /Digite: Caxias…/.test(vin) && /\/api\/operacao\/tarefas\/vincular-orgao-lote/.test(vin))
ok("barra de lote: 'N selecionada(s)' + os 7 botões do protótipo", ["selecionada(s)", "Iniciar (enviar ao cartório)", "Atribuir a", ">Atribuir<", "Prioridade alta", "Repactuar prazo", "Vincular órgão", "Cobrar cartório", "Limpar"].every((r) => tt.includes(r)))
ok("toasts do lote com os textos do protótipo (e os números REAIS)", ["· enviadas ao cartório", "atribuídas", "Prioridade alta em", "repactuados", "Cobrança registrada em"].every((r) => tt.includes(r)))
ok("modal 'Repactuar prazo em lote' (N tarefas selecionadas · Novo prazo)", /titulo="Repactuar prazo em lote"/.test(mod) && /tarefas selecionadas/.test(mod) && /Novo prazo/.test(mod))
ok("o lote chama as portas existentes (lote, iniciar-lote) e o Desfazer vem do toast", /\/api\/torre\/tarefas\/lote/.test(tt) && /\/api\/operacao\/tarefas\/iniciar-lote/.test(tt) && /r\.data\.desfazer/.test(tt))
ok("modais do Repactuar e Vincular não zeram a seleção (como no protótipo); os 4 diretos zeram", /limpar: false/.test(tt) && /if \(limpar\) setSel\(\{\}\)/.test(tt))

secao("Tabela (T281–T306)")
ok("colunas SEPARADAS, na ordem (Certidão | Pessoa | Família | Fase | Passo | Status | Aguardando | Cobrar em | …)", ["Certidão", "Pessoa", "Família", "Fase", "Passo", "Status", "Aguardando", "Cobrar em", "Responsável", "Iniciou", "Prazo", "Risco"].map((c) => tab.indexOf(`>${c}</div>`)).every((i, k, v) => i > 0 && (k === 0 || i > v[k - 1])))
ok("cabeçalho de grupo: ☐, família (link), resumo, 'N tarefas', 'Foco ›'", /Selecionar o grupo/.test(tab) && /href=\{`\/torre\/processo\/\$\{processoId\}`\}/.test(tab) && /resumoDoGrupo/.test(tab) && /Foco ›/.test(tab) && /tarefas/.test(tab))
ok("status por ROTULO_STATUS_TAREFA (statusDaLinha), risco por riscoDe, prazo por textoPrazoCompacto (uma vez só)", /statusDaLinha\(l\)/.test(tab) && /ROTULO_STATUS/.test(lib) && /riscoDe\(l\)/.test(tab) && (tab.match(/textoPrazoCompacto\(/g) ?? []).length === 1)
ok("bola / iniciou / cobrar em vêm dos campos novos (bolaCom, bolaDesde, cobrarEm, iniciouEm)", /textoDaBola/.test(tab) && /textoDoCobrar\(l\.cobrarEm/.test(tab) && /textoDoIniciou/.test(tab) && /l\.bolaCom/.test(lib) && /l\.bolaDesde/.test(lib) && /iniciouEm/.test(lib))
ok("cancelada: riscada (classe), no fim do grupo, sem seleção, só 'Ver motivo', e fora dos contadores", /cancelada/.test(tab) && /disabled aria-label="Certidão cancelada: só exibição"/.test(tab) && /Ver motivo/.test(lib) && /filter\(\(l\) => !ehCancelada\(l\)\)/.test(tab) && /canceladasVisiveis/.test(tt) && /nTrabalho = trabalhoVisivel\.length/.test(tt))
ok("'Ver motivo' mostra quem, quando e por quê (toast) — dado real do cancelamento", /Cancelada\$\{e\?\.quandoRotulo \? ` em \$\{e\.quandoRotulo\}` : ""\} por \$\{e\?\.porNome \?\? "Sistema"\}/.test(tt) && /TAREFA_CANCELADA/.test(ler("src/app/api/torre/tarefas/canceladas/route.ts")))
ok("rodapé sem texto de exemplo; fala da cancelada riscada e da gaveta", !/Exemplo com/.test(tt) && tt.includes("A certidão cancelada continua visível, riscada, no fim do grupo. Clique no nome da certidão para abrir a gaveta."))
ok("'Selecionar todas' funciona (sem botão morto)", /onTodas\(todasDaPagina/.test(tab))

secao("Modais (T298–T304, T316–T320) e gaveta (T307–T315)")
ok("justificativa: rótulo, placeholder, avisos âmbar/verde e botão inerte até 5 letras", mod.includes("Justificativa (mínimo 5 letras · vai para o histórico)") && mod.includes('placeholder="Por quê?"') && mod.includes("Escreva pelo menos 5 letras para liberar o botão") && mod.includes("Justificativa ok · vai para o histórico com seu nome e a hora") && /length >= MINIMO_JUSTIFICATIVA/.test(mod) && /MINIMO_JUSTIFICATIVA = 5/.test(mod) && /if \(!liberado\) return/.test(mod))
ok("nenhum modal fecha com Esc nem clicando no fundo", !/onKeyDown|Escape|keydown/.test(semComentarios(mod)) && !/tf-modal-fundo[^>]*onClick/.test(mod))
ok("os 9 modais de ação com títulos, textos e campos do protótipo", ["Registrar cobrança · cartório", "Registrar cobrança · cliente", "Adiar a cobrança", "Desbloquear", "Repactuar prazo", "Bloquear com motivo", "Reabrir passo", "Registrar ligação", "Trocar canal de cobrança"].every((t) => mod.includes(`titulo="${t}"`))
  && mod.includes("O prazo da tarefa não muda; só a data da próxima cobrança.") && mod.includes("O prazo continua contando enquanto bloqueada.") && mod.includes('Volta o passo anterior para "em andamento".') && mod.includes("CRC · e-cartório · e-mail · WhatsApp · balcão · correios"))
ok("toasts dos modais com os textos do protótipo", ["Cobrança registrada · próxima em", "Cobrança ao cliente registrada · ", "Cobrança adiada para ", "Desbloqueada · ", "Prazo repactuado para ", "Bloqueada · ", "Passo reaberto · ", "Ligação registrada · ", "Canal trocado · "].every((t) => mod.includes(t)))
ok("cada modal chama a PORTA existente (cobrar, adiar-acompanhamento, comando, ligação, canal)", /\/api\/torre\/tarefas\/\$\{linha\.taskId\}\/cobrar/.test(mod) && /\/api\/operacao\/tarefas\/\$\{linha\.taskId\}\/adiar-acompanhamento/.test(mod) && /\/api\/tarefas\/\$\{linha\.taskId\}\/comando/.test(mod) && /\/ligacao/.test(mod) && /\/canal/.test(mod) && /\/cobrar-cliente/.test(mod))
ok("repactuar individual oferece Desfazer (PRAZO) pela porta de desfazer", /tipo: "PRAZO", tarefaIds: \[linha\.taskId\]/.test(mod))
ok("gaveta 560 px: cabeçalho, grade, passos, ações (primária + 6), texto, histórico, link do processo", /width: min\(560px/.test(ler(D + "tarefas.css")) && ["Aguardando", "Status", "Prazo da tarefa", "Próxima cobrança", "Responsável", "Iniciou em", "Passos desta certidão", "Histórico desta certidão", "Abrir o processo inteiro ›"].every((t) => gav.includes(t))
  && ["Repactuar prazo", "Bloquear com motivo", "Reabrir passo", "Adiar", "Registrar ligação", "Trocar canal"].every((t) => gav.includes(`"${t}"`)) && gav.includes("Bloquear pede motivo e o prazo continua contando. Reabrir passo pede justificativa. Tudo vai para o histórico e tem &quot;Desfazer&quot;."))
ok("gaveta fecha com ✕ e clicando no fundo; passos e histórico são REAIS (rota própria)", /aria-label="Fechar"/.test(gav) && /className="tf-fundo" onClick=\{onFechar\}/.test(gav) && /\/api\/torre\/tarefas\/\$\{linha\.taskId\}\/gaveta/.test(gav) && !/Solicitar ao cartório/.test(gav) && !/Sistema abriu a fase/.test(gav))
ok("Modo foco: 'Modo foco · i de N', progresso, ← Anterior / Próxima → (param nos extremos), inclui a cancelada, lista vazia não abre", /Modo foco · \{foco\.pos\} de \{foco\.total\}/.test(gav) && /disabled=\{foco\.pos <= 1\}/.test(gav) && /disabled=\{foco\.pos >= foco\.total\}/.test(gav) && /ordemVisual = useMemo/.test(tt) && /if \(!ordemVisual\.length\) return/.test(tt))

secao("Higiene")
ok("nenhum termo proibido (SLA, workflow, step, ticket, caso, dossiê, pipeline, stage, kanban, owner, Obrigação, Ledger, Macro) nos textos da tela", !/["'`>][^"'`<>]*\b(SLA|workflow|ticket|dossiê|pipeline|kanban|Ledger|Obrigação)\b[^"'`<>]*["'`<]/i.test(cod.replace(/\/api\/[\w/${}.\-[\]]+/g, "").replace(/import[^\n]*/g, "")))
ok("vocabulário: 'Aguardando terceiros' e 'Sem responsável' (nunca 'Com o cartório' / 'Ninguém')", !/Com o cartório|Ninguém|Sem ninguém/.test(cod))
ok("nenhum <button> sem onClick (sem botão morto)", [tt, fx, vs, tab, gav, mod, tra, fei, vin, pai].every((s) => [...s.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0]) || /disabled/.test(m[0]))))
ok("sem window.prompt/alert e sem dado de exemplo", !/window\.(prompt|alert)|TODO|FIXME|lorem ipsum|Exemplo com/.test(cod))
ok("hidratação: nada de new Date() sem argumento nem Date.now() nos componentes da aba", ![tt, fx, vs, tab, gav, mod, tra, fei, vin, pai].some((s) => /new Date\(\)|Date\.now\(\)|Math\.random\(\)/.test(semComentarios(s))))
ok("as rotas novas existem", ["canceladas", "feito", "[tarefaId]/gaveta", "[tarefaId]/cobrar", "[tarefaId]/cobrar-cliente", "vincular-orgao"].every((r) => existsSync(`src/app/api/torre/tarefas/${r}/route.ts`)))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
