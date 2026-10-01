// scripts/torre-vocabulario-oficial.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — VOCABULÁRIO OFICIAL (A6): varredura estática + valores reais.
//
//   npx tsx scripts/torre-vocabulario-oficial.test.ts   (sem banco)
//
// 'Aguardando terceiros' (nunca 'Com o cartório') · 'Sem responsável' (nunca 'Sem ninguém'/'ninguém') · aba 'Tarefas' (nunca 'Certidões') ·
// sem 'Equipe e Terceiros' · 'Bola nossa'/'Bola com terceiro' · 'Precisa de você' · 'Revisar o dia'.
// As CHAVES internas (kpi=aguard, `cartorio`, `ninguem`…) e as URLs NÃO mudam — a varredura olha só o que a pessoa lê (comentários não contam).
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { KPIS, KPI_POR_CHAVE, CARTOES_DA_SITUACAO, PREDICADO_DO_KPI } from "../lib/operacional/torre-kpis"
import { fraseDoDia, type LinhaParaTopo } from "../lib/operacional/torre-topo"
import { ABAS_DA_TORRE } from "../lib/operacional/torre-abas"
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
const L = (o: Partial<LinhaParaTopo> = {}) => ({ processoId: 1, dataPrazo: null, responsavelId: 7, atrasada: false, diasParaPrazo: null, estadoOperacao: "FILA", acompanhamentoVencido: false, escalada: false, faseMacroKey: "x", aIniciar: false, statusTarefa: "NAO_INICIADA", familiaNome: "F", processoNome: null, ...o }) as LinhaParaTopo
const frase = fraseDoDia([L({ estadoOperacao: "AGUARDANDO" }), L({ responsavelId: null })], new Date("2026-09-30T15:00:00Z"))
ok("a frase-resumo diz 'aguardando terceiros' e 'sem responsável'", /1 aguardando terceiros, 1 sem responsável\.$/.test(frase) && !/cart[óo]rio|ningu/i.test(frase), frase)
ok("as abas: a aba é 'Tarefas' (nunca 'Certidões') e não há 'Equipe e Terceiros'", ABAS_DA_TORRE.some(([, r]) => r === "Tarefas") && ABAS_DA_TORRE.every(([, r]) => !/certid|Equipe e Terceiros/i.test(r)))
ok("'Bola nossa' / 'Bola com terceiro'", rotuloDoLado("Nossa") === "Bola nossa" && rotuloDoLado("Cartório") === "Bola com terceiro" && rotuloDoLado("Cliente") === "Bola com terceiro")
ok("os nomes oficiais seguem no cabeçalho: 'Precisa de você', 'Revisar o dia', 'Briefing do dia'", ABAS_DA_TORRE.some(([, r]) => r === "Precisa de você") && /Revisar o dia/.test(ler("src/components/torre/TorreCabecalho.tsx")) && /Briefing do dia/.test(ler("src/components/torre/TorreCabecalho.tsx")))
ok("a visão de Tarefas se chama 'Aguardando terceiros' e 'Sem responsável'", /\["aguard", "Aguardando terceiros"\]/.test(ler("src/components/torre/TorreTarefas.tsx")) && /\["semdono", "Sem responsável"\]/.test(ler("src/components/torre/TorreTarefas.tsx")))
ok("os 4 números do Foco e a linha de Processos dizem 'Aguardando terceiros'", /"Aguardando terceiros", foco\.numeros\.comCartorio/.test(ler("src/components/torre/FocoFamilia.tsx")) && /aguardando terceiros · \{n\.semResponsavel\} sem responsável/.test(ler("src/components/torre/TorreProcessos.tsx")))
ok("a coluna 'Bola com' mostra 'Sem responsável' (nunca 'Ninguém')", /txt: "Sem responsável", cls: "red"/.test(ler("src/components/torre/tipos.ts")))

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
