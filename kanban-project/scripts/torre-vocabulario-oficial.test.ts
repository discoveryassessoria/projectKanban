// scripts/torre-vocabulario-oficial.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — VOCABULÁRIO OFICIAL (A6): varredura estática + valores reais.
//
//   npx tsx scripts/torre-vocabulario-oficial.test.ts   (sem banco)
//
// 'Aguardando terceiros' (nunca 'Com o cartório') · 'Sem responsável' (nunca 'Sem ninguém'/'ninguém') · aba 'Tarefas' (nunca 'Certidões') ·
// sem 'Equipe e Terceiros' · 'Aguardando a equipe'/'Aguardando terceiro' · 'Precisa de você' · 'Revisar o dia'.
// As CHAVES internas (kpi=aguard, `cartorio`, `ninguem`…) e as URLs NÃO mudam — a varredura olha só o que a pessoa lê (comentários não contam).
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { KPIS, KPI_POR_CHAVE, CARTOES_DA_SITUACAO, PREDICADO_DO_KPI } from "../lib/operacional/torre-kpis"
import { fraseDoDia, textoDaFrase, TIPOS_NA_FRASE } from "../lib/operacional/torre-topo"
import { ABAS_DA_TORRE } from "../lib/operacional/torre-abas"
import { ROTULO_STATUS } from "../src/lib/home/rotulo-status-tarefa"
import { rotuloDoLado } from "../lib/operacional/torre-bola"
import { escolherResponsavel, textoDaSugestao, type ContextoDeSugestao } from "../lib/operacional/precisa-de-voce"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n)
    if (statSync(f).isDirectory()) arquivos(f, acc)
    else if (/\.(ts|tsx)$/.test(n)) acc.push(f)
  }
  return acc
}

// O QUE A PESSOA LÊ NA TORRE: os componentes, os textos de lib/operacional/torre-*.ts e das decisões do dia, as rotas e a sub-aba de metas.
const ALVOS = [
  ...arquivos("src/components/torre"), ...arquivos("src/app/torre"), ...arquivos("src/app/api/torre"),
  ...readdirSync("lib/operacional").filter((f) => /^torre-.*\.ts$/.test(f)).map((f) => `lib/operacional/${f}`),
  "lib/operacional/precisa-de-voce.ts", "lib/operacional/regras-torre.ts",
  ...readdirSync("src/services").filter((f) => /^torre-.*\.ts$/.test(f)).map((f) => `src/services/${f}`),
  "src/services/precisa-de-voce-acoes.ts", "src/services/processo-pausa.ts",
  "src/components/gerenciamentoComponents/saude/SaudeMetas.tsx",
]

secao("varredura estática do que a pessoa lê (comentários não contam)")
const PROIBIDOS: Array<[RegExp, string]> = [
  [/com o cart[óo]rio/i, "'Com o cartório' → 'Aguardando terceiros'"],
  [/sem ningu[ée]m/i, "'Sem ninguém' → 'Sem responsável'"],
  [/ningu[é]m/i, "'ninguém' → 'Sem responsável'"],
  [/Equipe e Terceiros/i, "'Equipe e Terceiros' não existe"],
  [/aba Certid[õo]es|"Certid[õo]es"\s*\]/i, "a aba 'Certidões' não existe (é 'Tarefas')"],
]
const achados: string[] = []
for (const f of ALVOS) {
  const cod = semComentarios(ler(f))
  for (const [re, porque] of PROIBIDOS) { const m = re.exec(cod); if (m) achados.push(`${f}: "${m[0]}" — ${porque}`) }
}
ok(`${ALVOS.length} arquivos varridos: nenhum 'Com o cartório', 'Sem ninguém' ou 'ninguém' visível na Torre`, achados.length === 0, achados.join(" | "))
// o scanner precisa ENXERGAR (controle positivo)
ok("controle positivo: o scanner pega a frase proibida em string e ignora o comentário", (() => {
  const fonte = `// Sem ninguém no comentário\nconst t = "Sem ninguém" \n /* Com o cartório */ const u = 'ok'`
  const cod = semComentarios(fonte)
  return /sem ningu[ée]m/i.test(cod) && !/com o cart[óo]rio/i.test(cod)
})())

secao("os rótulos reais")
ok("Situação: Tarefas abertas · Com a equipe · Aguardando terceiros · Sem responsável", CARTOES_DA_SITUACAO.map((k) => KPI_POR_CHAVE[k].rotulo).join(" · ") === "Tarefas abertas · Com a equipe · Aguardando terceiros · Sem responsável")
ok("as CHAVES internas não mudaram (cartorio, ninguem, equipe, abertas) e todas têm predicado", CARTOES_DA_SITUACAO.join(",") === "abertas,equipe,cartorio,ninguem" && ["cartorio", "ninguem", "equipe"].every((k) => typeof PREDICADO_DO_KPI[k as "cartorio"] === "function"))
ok("as chaves legadas de ?kpi= seguem válidas (aguard, semdono) — só o rótulo mudou", KPIS.some((k) => k.chave === "aguard" && k.rotulo.startsWith("Aguardando terceiros")) && KPIS.some((k) => k.chave === "semdono" && k.rotulo === "Sem responsável"))
ok("nenhum rótulo de indicador contém os termos proibidos", KPIS.every((k) => !/cart[óo]rio|ningu[ée]m/i.test(k.rotulo)) )
ok("nenhuma REGRA escrita (title do cartão) usa 'Sem ninguém'/'Com o cartório'", KPIS.every((k) => !/sem ningu[ée]m|com o cart[óo]rio/i.test(k.regra)))
const frase = textoDaFrase(fraseDoDia({ processos: 3, noRitmo: 1, decisoes: [{ tipo: "SEM_DONO" }, { tipo: "ESCALADA" }], gargalo: null }))
ok("a frase-resumo diz 'sem dono' e 'escalada de cartório' (vocabulário do protótipo) e nunca 'Com o cartório'/'ninguém'", /1 sem dono, 1 escalada de cartório\.$/.test(frase) && !/com o cart[óo]rio|ningu/i.test(frase), frase)
ok("os tipos da frase têm o vocabulário oficial", TIPOS_NA_FRASE.map((x) => x.varios).join(" · ") === "sem dono · fases deixadas · escaladas de cartório · divergências · bloqueadas · de carga da equipe")
ok("as abas: a aba é 'Tarefas' (nunca 'Certidões') e não há 'Equipe e Terceiros'", ABAS_DA_TORRE.some(([, r]) => r === "Tarefas") && ABAS_DA_TORRE.every(([, r]) => !/certid|Equipe e Terceiros/i.test(r)))
ok("'Aguardando a equipe' / 'Aguardando terceiros'", rotuloDoLado("Equipe") === "Aguardando a equipe" && rotuloDoLado("Cartório") === "Aguardando terceiros" && rotuloDoLado("Cliente") === "Aguardando terceiros")
ok("os nomes oficiais seguem no cabeçalho: 'Precisa de você', 'Revisar o dia', 'Briefing do dia'", ABAS_DA_TORRE.some(([, r]) => r === "Precisa de você") && /Revisar o dia/.test(ler("src/components/torre/TorreCabecalho.tsx")) && /Briefing do dia/.test(ler("src/components/torre/TorreCabecalho.tsx")))
ok("a visão de Tarefas se chama 'Aguardando terceiros' e 'Sem responsável'", /\['aguard', 'Aguardando terceiros'\]/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && /\['semdono', 'Sem responsável'\]/.test(ler("lib/operacional/torre-tarefas-tela.ts")))
// Torre nova: a aba Processos (por fase) não repete os 4 números por linha; o vocabulário vale nela e no Radar do mesmo jeito.
ok("os 4 números do Foco dizem 'Aguardando terceiros'; Processos e Radar usam 'Sem responsável' e nunca 'Com o cartório'/'Sem ninguém'", /"Aguardando terceiros", foco\.numeros\.comCartorio/.test(ler("src/components/torre/FocoFamilia.tsx")) && [ "src/components/torre/TorreProcessos.tsx", "src/components/torre/TorreRadar.tsx", "lib/operacional/torre-fase.ts", "lib/operacional/torre-radar.ts" ].every((a) => !/Com o cart[oó]rio|Sem ningu[eé]m|Ninguém/.test(ler(a))) && /SEM_RESPONSAVEL = 'Sem responsável'/.test(ler("lib/operacional/torre-fase.ts")))
ok("a coluna 'Aguardando' mostra 'Sem responsável' (nunca 'Ninguém')", /txt: "Sem responsável", cls: "red"/.test(ler("src/components/torre/tipos.ts")))

secao("vocabulário de STATUS em TODA a interface (30/09/2026+): 'Aguardando terceiros', nunca 'Aguardando cartório/juízo/consulado' nem 'Com o cartório'")
// Varredura ampla do código de exibição (comentários não contam). Nomes de passo configurados no Gerenciamento ('Aguardar retorno do cartório') não casam: são DADO, não rótulo de status.
const RAIZES_DE_EXIBICAO = ["src/components", "src/app", "src/lib", "src/services", "lib/operacional", "lib/home", "lib/saude"].filter((d) => { try { return statSync(d).isDirectory() } catch { return false } })
const EXCECOES_DE_EXIBICAO = new Set(["src/components/arvore/pessoa-sidebar.tsx", "src/components/arvore/pessoa-card.tsx"]) // Árvore está congelada (ADR13): rótulo singular próprio, fora do escopo.
const STATUS_PROIBIDOS: Array<[RegExp, string]> = [
  [/Aguardando (o |a )?(cart[óo]rio|ju[íi]zo|consulado)/i, "'Aguardando cartório/juízo/consulado' → 'Aguardando terceiros'"],
  [/\bCom o cart[óo]rio/, "'Com o cartório' (rótulo, com C maiúsculo) → 'Aguardando terceiros'"],
  [/Equipe e Terceiros/i, "'Equipe e Terceiros' não existe"],
  [/["'`>]Aguardando terceiro["'`<]/, "rótulo singular 'Aguardando terceiro' → 'Aguardando terceiros'"],
]
const achadosStatus: string[] = []
for (const raiz of RAIZES_DE_EXIBICAO) {
  for (const f of arquivos(raiz)) {
    if (EXCECOES_DE_EXIBICAO.has(f)) continue
    const cod = semComentarios(ler(f))
    for (const [re, porque] of STATUS_PROIBIDOS) { const m = re.exec(cod); if (m) achadosStatus.push(`${f}: "${m[0]}" — ${porque}`) }
  }
}
ok(`nenhum rótulo de status antigo no código de exibição (${RAIZES_DE_EXIBICAO.join(", ")})`, achadosStatus.length === 0, achadosStatus.join(" | "))
ok("controle positivo da varredura ampla", STATUS_PROIBIDOS.every(([re]) => re.test(['Aguardando cartório', 'Com o cartório', 'Equipe e Terceiros', '"Aguardando terceiro"'].join(' ') )))
ok("a fonte única diz 'Aguardando terceiros' para AGUARDANDO_TERCEIRO", ROTULO_STATUS.AGUARDANDO_TERCEIRO === "Aguardando terceiros")

secao("o texto da sugestão sem aptidão (decisões do dia)")
type U = ContextoDeSugestao["usuarios"][number]
const u = (id: number, nome: string): U => ({ id, nome, tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true }, perfil: null })
const org = (id: number, nome: string) => ({ usuarioId: id, nome, equipes: [], aptidoes: [], aptidoesDetalhadas: [], paisesAptos: [], paisesAptosDetalhados: [], indisponivelPor: null, indisponibilidades: [], limiteExecutaveis: null, observacaoCapacidade: null })
const ctx: ContextoDeSugestao = {
  organizacao: new Map([[2, org(2, "Dani")]]) as never, usuarios: [u(2, "Dani")], ativasPorUsuario: new Map(), atribuicoes30dPorUsuario: new Map(),
  unidadesComAptidao: new Set(), paisesComAptidao: new Set(), rotulos: new Map() as never, equipes: new Map(),
}
const fb = escolherResponsavel(ctx, { unidadeOperacionalId: null, equipeExigida: null, paisId: null })
ok("'Sem aptidão cadastrada para esta tarefa; sugiro Dani por menor carga (0 ativa(s)).'", textoDaSugestao(fb) === "Sem aptidão cadastrada para esta tarefa; sugiro Dani por menor carga (0 ativa(s)).", textoDaSugestao(fb) ?? "")

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
