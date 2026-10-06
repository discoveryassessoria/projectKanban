// scripts/torre-foco-um-so-comportamento.test.ts
// "Foco" na Torre tem UM comportamento só: link de verdade (href) para /torre/processo/[id]. Nenhum botão abre mais a janela "Foco da família".
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { haPaginaAnteriorNoSistema, DESTINO_SEM_ANTERIOR } from "../src/lib/torre-voltar"
import { linkDoAvisoParaAdmin, destinoDaOperacaoParaAdmin } from "../src/lib/torre-absorcao"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const dir = "src/components/torre"

const tabela = ler(join(dir, "TarefasTabela.tsx"))
ok('aba Tarefas: "Foco ›" é <Link href="/torre/processo/{id}">', /<Link[^>]*className="foco"[^>]*href=\{`\/torre\/processo\/\$\{processoId\}`\}[^>]*>Foco ›<\/Link>/.test(tabela))
ok('aba Tarefas: não sobrou botão "Foco" nem a propriedade onFocoDaFamilia', !/<button[^>]*className="foco"/.test(tabela) && !tabela.includes("onFocoDaFamilia"))
const procs = ler(join(dir, "TorreProcessos.tsx"))
ok('aba Processos: "Foco" é <Link href="/torre/processo/{id}">', /<Link href=\{`\/torre\/processo\/\$\{p\.processoId\}`\}[^>]*>Foco<\/Link>/.test(procs))

const usos: string[] = []
for (const f of readdirSync(dir)) {
  if (!/\.tsx?$/.test(f) || f === "torre-base.tsx" || f === "Torre.tsx") continue
  if (/abrirFoco\s*[(,}=)]|onFocoDaFamilia/.test(ler(join(dir, f)))) usos.push(f)
}
ok("nenhum componente da Torre chama abrirFoco (a janela não abre por botão)", usos.length === 0 && !/abrirFoco/.test(ler(join(dir, "TorreTarefas.tsx"))))
ok("a janela 'Foco da família' foi removida (arquivo, estado e abrirFoco do contexto)", !existsSync(join(dir, "FocoFamilia.tsx")) && !/FocoFamilia|abrirFoco|setFoco/.test(ler(join(dir, "Torre.tsx"))) && !/abrirFoco/.test(ler(join(dir, "torre-base.tsx"))))
ok("endereço antigo '?processo=' (sem ?tarefa=) redireciona para a página do processo", /router\.replace\(`\/torre\/processo\/\$\{paraPaginaDoProcesso\}`\)/.test(ler(join(dir, "Torre.tsx"))) && /processoPedido\.tarefa == null/.test(ler(join(dir, "Torre.tsx"))))
const pag = "/torre/processo/651"
ok("sino: aviso /operacao?processo=651&aba=fila → página", linkDoAvisoParaAdmin("/operacao?processo=651&aba=fila", "admin") === pag)
ok("sino: /operacao/distribuicao?processo=651 → página", linkDoAvisoParaAdmin("/operacao/distribuicao?processo=651", "admin") === pag)
ok("sino: /tarefas?processo=651 → página", linkDoAvisoParaAdmin("/tarefas?processo=651", "admin") === pag)
ok("sino: /kanban?tab=central&processoId=651 (fase, sem tarefa) → página", linkDoAvisoParaAdmin("/kanban?tab=central&processoId=651", "admin") === pag)
ok("sino: com tarefa continua no drawer da tarefa", linkDoAvisoParaAdmin("/kanban?tab=central&processoId=651&taskId=9", "admin") === "/torre?aba=tarefas&tarefa=9&processo=651")
ok("destinoDaOperacaoParaAdmin('processo=651') → página", destinoDaOperacaoParaAdmin("processo=651") === pag)
ok("não-admin: o link volta como veio", linkDoAvisoParaAdmin("/tarefas?processo=651", "operador") === "/tarefas?processo=651")
const cab = ler(join(dir, "ProcessoCabecalho.tsx"))
ok("página do processo mostra os 4 contadores (mesma fonte d.numeros)", ["Abertas", "Vencidas", "Aguardando terceiros", "Sem responsável"].every((r) => cab.includes(`"${r}"`)) && /d\.numeros\.abertas.*d\.numeros\.vencidas.*d\.numeros\.comCartorio.*d\.numeros\.semResponsavel/.test(cab))

// ── "← Voltar" das páginas da Torre ──
const pagina = ler(join(dir, "TorreProcessoPagina.tsx"))
ok("Voltar: a página do processo o renderiza ACIMA da trilha (antes do cabeçalho), também nos estados de carregando e de erro", (pagina.match(/<VoltarDaTorre \/>/g) ?? []).length === 3 && pagina.indexOf("<VoltarDaTorre />", pagina.indexOf("<ProcessoCabecalho") - 80) < pagina.indexOf("<ProcessoCabecalho"))
const voltar = ler(join(dir, "VoltarDaTorre.tsx"))
ok("Voltar: com página anterior do sistema faz router.back(); sem ela vai para a Torre, aba Processos", /router\.back\(\)/.test(voltar) && /router\.push\(DESTINO_SEM_ANTERIOR\)/.test(voltar) && DESTINO_SEM_ANTERIOR === "/torre?aba=processos")
const o = "https://app.discovery.com.br"
ok("regra: Navigation API com anterior da mesma origem → volta (qualquer aba/filtros da Torre)", haPaginaAnteriorNoSistema({ anteriorUrl: `${o}/torre?aba=tarefas&visao=vencidas`, origem: o, referrer: "", tamanhoHistorico: 3 }))
ok("regra: sem entrada anterior (aba nova / link direto) → Torre, aba Processos", !haPaginaAnteriorNoSistema({ anteriorUrl: null, origem: o, referrer: "", tamanhoHistorico: 1 }))
ok("regra: anterior de OUTRO site ou a tela de login → não volta para lá", !haPaginaAnteriorNoSistema({ anteriorUrl: "https://google.com/", origem: o, referrer: "", tamanhoHistorico: 4 }) && !haPaginaAnteriorNoSistema({ anteriorUrl: `${o}/login`, origem: o, referrer: "", tamanhoHistorico: 4 }))
ok("regra (navegador sem Navigation API): só volta se veio de página do sistema e há mais de uma entrada", haPaginaAnteriorNoSistema({ origem: o, referrer: `${o}/torre?aba=radar`, tamanhoHistorico: 2 }) && !haPaginaAnteriorNoSistema({ origem: o, referrer: "", tamanhoHistorico: 2 }) && !haPaginaAnteriorNoSistema({ origem: o, referrer: `${o}/torre`, tamanhoHistorico: 1 }))
ok("a Torre em si (/torre) não tem Voltar; a trilha da página continua", !/VoltarDaTorre/.test(ler("src/components/torre/Torre.tsx")) && /tpr-crumb/.test(ler(join(dir, "ProcessoCabecalho.tsx"))))

// ── Lista "Certidões da fase atual": ativas por padrão; bloco "Cancelada / não exigida" liga e desliga ──
const caminho = ler(join(dir, "ProcessoCaminho.tsx"))
ok("página: o estado da lista nasce em ATIVAS e é UM só (bloco e select de Status mexem nele)", /useState<FiltroDeStatusDaTabela>\("ATIVAS"\)/.test(pagina) && /status=\{statusDaLista\} onStatus=\{setStatusDaLista\}/.test(pagina) && /encerradasNaLista=/.test(pagina) && /onAlternarEncerradas=/.test(pagina))
ok("bloco 'Cancelada / não exigida' é um botão (aria-pressed) que alterna", /<button[^>]*aria-pressed=\{encerradasNaLista\}/.test(caminho) && /onClick=\{onAlternarEncerradas\}/.test(caminho))
ok("o título da lista usa as linhas mostradas", /tituloDaTabela\(d\.tabela, \(l\) => l\.documentoId != null, linhas\)/.test(ler(join(dir, "ProcessoCertidoes.tsx"))))
const textos = ["ProcessoCertidoes.tsx", "ProcessoCaminho.tsx", "TorreProcessoPagina.tsx"].map((f) => ler(join(dir, f))).join("\n") + ler("lib/operacional/torre-processo-puro.ts") + ler("lib/operacional/torre-foco.ts")
ok("o nome 'fora do jogo' não existe mais na Torre", !/fora do jogo/i.test(textos))
console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
