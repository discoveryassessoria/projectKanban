/**
 * Árvore Genealógica — guarda de arquitetura. Rodar: tsx scripts/genealogia-arvore-guard.test.ts
 *
 * Trava, em teste, as decisões que se perdem em refatoração futura:
 *  · a árvore é módulo GENEALÓGICO — não gere documento, não fala com o banco;
 *  · existe UMA implementação de árvore, não três;
 *  · o layout é próprio (sem dagre) e a câmera é própria (sem reactflow);
 *  · cor só vem de token do DS;
 *  · não existe ação morta (botão sem handler, ou sem rótulo acessível).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

const RAIZ = join(__dirname, "..")
const DIR_MOTOR_UI = join(RAIZ, "src/components/arvore/motor")
const DIR_MOTOR_LIB = join(RAIZ, "src/lib/genealogia")

function ler(p: string): string {
  return readFileSync(join(RAIZ, p), "utf8")
}
function arquivos(dir: string, ext = ".ts"): string[] {
  const out: string[] = []
  const andar = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) andar(full)
      else if (e.name.endsWith(ext) || e.name.endsWith(".tsx")) out.push(full)
    }
  }
  andar(dir)
  return out
}

// ============================================================
console.log("\n1) Uma única árvore (sem implementação duplicada)")
ok(
  !existsSync(join(RAIZ, "src/components/arvore/react-flow-tree.tsx")),
  "react-flow-tree.tsx removido (substituído pelo motor próprio)",
)
ok(
  !existsSync(join(RAIZ, "src/components/genealogical-tree.tsx")),
  "genealogical-tree.tsx removido (era uma terceira árvore, morta)",
)
ok(
  existsSync(join(DIR_MOTOR_UI, "arvore-inteligente.tsx")),
  "existe exatamente uma montagem: arvore-inteligente.tsx",
)
{
  const view = ler("src/components/arvore/arvore-genealogica-view.tsx")
  ok(view.includes("ArvoreInteligente"), "a view usa a árvore nova")
  ok(!view.includes("ReactFlowTree"), "a view não referencia mais a árvore antiga")
  ok(!view.includes('from "dagre"') && !view.includes("import dagre"), "a view não importa dagre")
}

// ============================================================
console.log("\n2) Motor próprio de layout e câmera")
{
  const todos = [...arquivos(DIR_MOTOR_UI), ...arquivos(DIR_MOTOR_LIB)]
  const comReactflow = todos.filter((f) => readFileSync(f, "utf8").includes("reactflow"))
  const comDagre = todos.filter((f) => /from ["']dagre["']/.test(readFileSync(f, "utf8")))
  ok(comReactflow.length === 0, "nenhum arquivo do motor importa reactflow")
  ok(comDagre.length === 0, "nenhum arquivo do motor importa dagre")
  ok(existsSync(join(DIR_MOTOR_LIB, "layout/layout-familiar.ts")), "layout próprio presente")
  ok(existsSync(join(DIR_MOTOR_UI, "use-viewport.ts")), "câmera própria presente")
}

// ============================================================
console.log("\n3) Escopo: a árvore NÃO gere documento nem toca o banco")
{
  const libs = arquivos(DIR_MOTOR_LIB)
  const comPrisma = libs.filter((f) => /from ["']@\/lib\/prisma["']|prisma\./.test(readFileSync(f, "utf8")))
  ok(comPrisma.length === 0, "o motor genealógico é puro (não importa prisma)")

  const comFetch = libs.filter((f) => /\bfetch\(|authFetch/.test(readFileSync(f, "utf8")))
  ok(comFetch.length === 0, "o motor não faz rede — é determinístico e testável")

  // Escrita documental: a árvore pode LER status, nunca criar/alterar documento.
  const ui = arquivos(DIR_MOTOR_UI)
  const escreveDoc = ui.filter((f) => {
    const s = readFileSync(f, "utf8")
    return /\/api\/documentos/.test(s) && /method:\s*["'](POST|PUT|PATCH|DELETE)/.test(s)
  })
  ok(escreveDoc.length === 0, "nenhuma escrita em /api/documentos a partir da árvore")

  const pesquisa = ler("src/lib/genealogia/motor/regras/pesquisa.ts")
  ok(
    pesquisa.includes("NÃO é gestão documental"),
    "a regra de pesquisa declara explicitamente o limite de escopo",
  )
}

// ============================================================
console.log("\n4) Cor vem do DS (token), não do componente")
{
  const ui = arquivos(DIR_MOTOR_UI, ".tsx")
  const proibido = /#[0-9a-fA-F]{6}\b/g
  const excecoes = new Set(["tokens.ts", "tokens.tsx"])
  const infratores: string[] = []
  for (const f of ui) {
    const nome = f.split("/").pop() || ""
    if (excecoes.has(nome)) continue
    const s = readFileSync(f, "utf8")
    const achados = s.match(proibido) || []
    if (achados.length) infratores.push(`${nome}: ${[...new Set(achados)].join(", ")}`)
  }
  ok(infratores.length === 0, `nenhuma cor hexadecimal solta fora de tokens.ts${infratores.length ? " — " + infratores.join(" | ") : ""}`)

  // O canvas da árvore é uma SUPERFÍCIE CLARA por decisão de produto (leitura de
  // documento genealógico, referência FamilySearch). Por isso as superfícies
  // deste módulo são literais e não herdam os tokens escuros globais — se
  // herdassem, o canvas voltaria a ser preto. O que continua obrigatório:
  //   · o acento institucional do Discovery vem do DS, não de um hex local;
  //   · a decisão está DOCUMENTADA no arquivo (senão vira cor solta com desculpa);
  //   · nenhum outro arquivo do módulo define cor (regra acima, já verificada).
  const tokens = ler("src/components/arvore/motor/tokens.ts")
  ok(tokens.includes("--accent-primary"), "tokens.ts usa o acento institucional do DS")
  ok(
    tokens.includes("SUPERFÍCIE CLARA"),
    "tokens.ts documenta por que as superfícies da árvore são claras e literais",
  )
  ok(
    !/var\(--(surface-overlay|app-background|surface-popover)/.test(tokens),
    "as superfícies da árvore não herdam os tokens escuros globais",
  )
  ok(
    tokens.includes(".arv-hover"),
    "estado de hover é classe do módulo (cor não vaza para o componente)",
  )
}

// ============================================================
console.log("\n4b) Sem afordância de editor de grafos")
{
  // A árvore é um DOCUMENTO que se lê, não um diagrama que se edita. Estas
  // capacidades foram deliberadamente removidas por não existirem na
  // experiência de referência e por serem exatamente o que dava à tela cara de
  // ferramenta técnica. O teste existe para que não voltem por distração.
  const ui = arquivos(DIR_MOTOR_UI, ".tsx")
  const todo = ui.map((f) => readFileSync(f, "utf8")).join("\n")

  ok(!/aoMoverPessoa/.test(todo), "não existe arrastar card (layout é sempre automático)")
  ok(!/IndicadorZoom/.test(todo), "não existe medidor de zoom em porcentagem")
  // O MINIMAPA VOLTOU — e a regra anterior estava errada.
  //
  // Este teste dizia "não existe minimapa (mobília de editor de nós)". A
  // experiência de referência tem um, no canto inferior esquerdo, e o motivo é
  // de leitura, não de enfeite: com pan livre não há barra de rolagem, e numa
  // árvore mais larga que a tela o operador perde a noção de onde está. O que
  // continua proibido é o minimapa VIRAR um segundo canvas — por isso a regra
  // agora verifica que ele existe E que não desenha cards nem tem seleção
  // própria.
  const minimapa = ler("src/components/arvore/motor/minimapa.tsx")
  ok(minimapa.length > 0, "existe minimapa (a referência tem um, e ele orienta o pan)")
  ok(
    /aria-label="Minimapa/.test(minimapa),
    "o minimapa é acessível (tem rótulo)",
  )
  ok(
    !/CartaoPessoa|CartaoRetrato/.test(minimapa),
    "o minimapa não monta cards — ele pinta blocos, não é um segundo canvas",
  )
  ok(
    /data-minimapa="recolhido"/.test(minimapa),
    "o minimapa pode ser recolhido e reaberto (não some sem volta)",
  )
  ok(
    !ui.some((f) => /barra-filtros/i.test(f)),
    "não existe barra de filtros avançados sobre a árvore",
  )
  ok(!/densidade\s*===\s*"compacta"/.test(todo), "não existe seletor de densidade de card")
  ok(
    !/backgroundImage:\s*`?radial-gradient/.test(todo),
    "o canvas não tem grade pontilhada",
  )

  const canvas = ler("src/components/arvore/motor/arvore-canvas.tsx")
  ok(
    canvas.includes("NÃO EXISTE arrastar card"),
    "a ausência do arrasto está documentada onde ele existiria",
  )

  // A CAUSA NA ORIGEM: enquanto a biblioteca de editor de grafos continuasse
  // instalada, bastava um import distraído para o visual reprovado voltar
  // inteiro — com minimapa, grade e fundo próprio. Removida do projeto; este
  // teste impede que volte pela porta dos fundos.
  const pkg = ler("package.json")
  ok(!/"reactflow"\s*:/.test(pkg), "reactflow não é mais dependência do projeto")
  ok(!/"dagre"\s*:/.test(pkg), "dagre não é mais dependência do projeto")

  // "Localizar" abre para procurar PESSOA, não para listar funções do sistema.
  const paleta = ler("src/components/arvore/motor/paleta-comandos.tsx")
  ok(
    /if \(!t\) return \[\]/.test(paleta),
    "sem texto digitado, nenhuma ação é listada (não é paleta de comandos)",
  )
}

// ============================================================
console.log("\n5) Sem ação morta")
{
  const ui = arquivos(DIR_MOTOR_UI, ".tsx")
  const semHandler: string[] = []
  const semRotulo: string[] = []

  for (const f of ui) {
    const nome = f.split("/").pop() || ""
    const s = readFileSync(f, "utf8")

    // botão declarado sem onClick e sem type=submit é botão inerte
    // O cabeçalho de um <button> em JSX é multilinha e contém `=>` dentro dos
    // handlers, então procurar o primeiro ">" corta o elemento no meio. A
    // janela fixa é grosseira de propósito: o que importa é não deixar passar
    // um botão inerte, não fazer parsing de JSX aqui.
    const botoes = s.split(/<button\b/).slice(1)
    for (const b of botoes) {
      const cabecalho = b.slice(0, 800)
      if (!/onClick|type="submit"/.test(cabecalho)) semHandler.push(nome)
      if (!/aria-label|title=/.test(cabecalho) && !/>\s*[^\s<]/.test(b)) semRotulo.push(nome)
    }

    ok(!/onClick=\{\(\) => \{\}\}/.test(s), `${nome}: sem onClick vazio (placeholder)`)
    ok(!/\bTODO\b|\bFIXME\b/.test(s), `${nome}: sem TODO/FIXME pendente`)
  }
  ok(semHandler.length === 0, `todo botão tem handler${semHandler.length ? " — " + [...new Set(semHandler)].join(", ") : ""}`)
  ok(semRotulo.length === 0, `todo botão tem rótulo acessível${semRotulo.length ? " — " + [...new Set(semRotulo)].join(", ") : ""}`)
}

// ============================================================
console.log("\n6) Acessibilidade mínima do canvas")
{
  const canvas = ler("src/components/arvore/motor/arvore-canvas.tsx")
  ok(canvas.includes('role="application"'), "canvas tem role de aplicação")
  ok(canvas.includes("aria-label"), "canvas tem rótulo acessível")
  ok(canvas.includes("ArrowUp") && canvas.includes("ArrowDown"), "navegação por teclado entre parentes")
  const cartao = ler("src/components/arvore/motor/cartao-pessoa.tsx")
  ok(cartao.includes("aria-label"), "cartão tem rótulo acessível")
  const paleta = ler("src/components/arvore/motor/paleta-comandos.tsx")
  ok(paleta.includes('aria-modal="true"'), "paleta é diálogo modal acessível")
  ok(paleta.includes('role="option"'), "resultados da paleta são opções acessíveis")
}

// ============================================================
console.log("\n6b) Movimento reduzido e ponto de entrada do teclado")
{
  const viewport = ler("src/components/arvore/motor/use-viewport.ts")
  ok(viewport.includes("prefers-reduced-motion"), "câmera respeita prefers-reduced-motion")
  ok(/reduzido\.current/.test(viewport), "inércia e tween consultam a preferência em tempo real")

  const tokens = ler("src/components/arvore/motor/tokens.ts")
  ok(tokens.includes("prefers-reduced-motion"), "animações declarativas também são reduzidas")

  const montagem = ler("src/components/arvore/motor/arvore-inteligente.tsx")
  ok(montagem.includes("data-arvore"), "contêiner marcado para a folha de movimento reduzido")

  const canvas = ler("src/components/arvore/motor/arvore-canvas.tsx")
  ok(
    canvas.includes("selecionarPrimeira"),
    "teclado tem ponto de partida (seta sem seleção escolhe a raiz)",
  )
}

// ============================================================
console.log("\n6c) Escopo documental — a árvore não gere documento")
{
  // A view hospedeira pode excluir documento (fluxo legado, sob permissão
  // arvore.excluir_documento). O MOTOR não pode conhecer isso.
  const ui = arquivos(DIR_MOTOR_UI)
  const tocaDocumento = ui.filter((f) => /\/api\/documentos/.test(readFileSync(f, "utf8")))
  ok(tocaDocumento.length === 0, "nenhum arquivo do motor referencia /api/documentos")

  const libs = arquivos(DIR_MOTOR_LIB)
  const criaDocumento = libs.filter((f) =>
    /criarDocumento|gerarDocumento|solicitarDocumento/.test(readFileSync(f, "utf8")),
  )
  ok(criaDocumento.length === 0, "o motor não tem verbo de criação documental")
}

// ============================================================
console.log("\n6d) B1 — autorização, indicador oficial e histórico próprio")
{
  // Autenticado ≠ autorizado. Toda rota da árvore precisa de guarda de
  // permissão no servidor, não só de botão escondido na tela.
  const rotas = [
    "src/app/api/arvore/route.ts",
    "src/app/api/arvore/[arvoreid]/route.ts",
    "src/app/api/pessoas/route.ts",
    "src/app/api/pessoas/[id]/route.ts",
    "src/app/api/unioes/route.ts",
    "src/app/api/unioes/[id]/route.ts",
  ]
  for (const r of rotas) {
    const s = ler(r)
    const verbos = (s.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) || []).length
    const guardas = (s.match(/verificarPermissao\(request/g) || []).length
    ok(verbos > 0 && guardas >= verbos, `${r.replace("src/app/api/", "")}: ${guardas}/${verbos} verbos protegidos`)
  }

  // O indicador documental é CONSUMIDO do Sistema Documental.
  const ind = ler("src/lib/genealogia/documental/indicadores.ts")
  ok(!/prisma|fetch\(/.test(ind), "projeção documental é pura (não consulta banco nem rede)")
  ok(
    !/matriz|obrigatoriaSe|regraDocumental/i.test(ind),
    "não reimplementa regra de obrigatoriedade documental",
  )
  const view = ler("src/components/arvore/arvore-genealogica-view.tsx")
  ok(view.includes("/necessidades"), "a view consome o endpoint oficial de necessidades")
  const cartao = ler("src/components/arvore/motor/cartao-pessoa.tsx")
  ok(!/documentos\b/.test(cartao), "o cartão não lê mais Documento cru")

  // Histórico é da árvore, não do navegador.
  const hist = ler("src/lib/genealogia/navegacao/historico.ts")
  ok(!/window|history\.|pushState|useRouter/.test(hist), "histórico não toca o do navegador")
  const montagem = ler("src/components/arvore/motor/arvore-inteligente.tsx")
  ok(!/pushState|router\.push/.test(montagem), "a árvore não empurra estado interno para a URL")

  // Parentesco é regra de domínio, fora do componente visual.
  const par = ler("src/lib/genealogia/motor/parentesco.ts")
  ok(par.includes("bisav"), "vocabulário de parentesco vive no domínio")
  ok(!/tsx|React/.test(par), "cálculo de parentesco não conhece React")
}

// ============================================================
console.log("\n6e) Correções arquiteturais — documental e criação de Pessoa")
{
  const arvoreUI = [...arquivos(join(RAIZ, "src/components/arvore"), ".tsx")]
  // A checagem precisa correlacionar a URL com o verbo NA MESMA chamada. Um
  // arquivo pode citar /api/documentos num comentário e ter um DELETE de Pessoa
  // 300 linhas abaixo — procurar os dois soltos acusaria falso positivo.
  const excluiDoc = arvoreUI.filter((f) => {
    const s = readFileSync(f, "utf8")
    const chamadas = s.matchAll(/\/api\/documentos[^\n]{0,240}/g)
    for (const c of chamadas) {
      const trecho = s.slice(c.index ?? 0, (c.index ?? 0) + 400)
      if (/method:\s*['"](DELETE|PUT|PATCH|POST)/.test(trecho)) return true
    }
    return false
  })
  ok(excluiDoc.length === 0, "nenhuma escrita/exclusão documental em toda a árvore")

  const permsDoc = arvoreUI.filter((f) =>
    /pode\(['"]arvore\.(criar|editar|excluir)_documento/.test(readFileSync(f, "utf8")),
  )
  ok(permsDoc.length === 0, "nenhuma permissão documental reimplementada na árvore")

  // Criação de Pessoa só depois da checagem no Cadastro Mestre.
  const view = ler("src/components/arvore/arvore-genealogica-view.tsx")
  ok(view.includes("ChecagemDuplicidade"), "fluxo de criação passa pela checagem de duplicidade")
  ok(view.includes("if (!criacaoLiberada) return"), "submit bloqueado sem checagem")
  ok(/disabled=\{[^}]*!criacaoLiberada/.test(view), "botão de criar desabilitado sem checagem")
  ok(view.includes("handleVincularExistente"), "existe caminho de vincular Pessoa existente")

  const checagem = ler("src/components/arvore/checagem-duplicidade.tsx")
  // MDM-3 F2: a checagem passou a usar a triagem OFICIAL do servidor em vez de
  // pontuar por conta própria. Dois algoritmos de similaridade dariam dois
  // veredictos para o mesmo par de fichas.
  ok(checagem.includes("/api/pessoas/triagem"), "checagem usa a triagem oficial do servidor")
  ok(/decisaoDedupId/.test(checagem), "checagem registra a decisão e devolve o id")
  const rotaPessoas = ler("src/app/api/pessoas/route.ts")
  ok(/decisaoDedupId/.test(rotaPessoas), "POST /api/pessoas conhece a trava de deduplicação")
  ok(/decisao !== "CRIOU_NOVA"/.test(rotaPessoas), "criação recusa decisão que era de vínculo")
  ok(
    /não tem serviço oficial de criação com deduplicação/.test(checagem),
    "a limitação arquitetural é dita na tela, não mascarada",
  )
  ok(!/prisma|pessoa\.create/.test(checagem), "a checagem não cria serviço paralelo de Pessoa")
}

// ============================================================
console.log("\n6f) Timeline e filtros — projeção, sem entidade nova")
{
  const ev = ler("src/lib/genealogia/motor/eventos.ts")
  ok(!/prisma|fetch\(|create|insert/i.test(ev), "eventos são projeção pura (não persistem nada)")
  ok(ev.includes("PROJEÇÃO, não entidade"), "o arquivo declara que não é entidade")
  for (const campo of ["data_nasc", "data_obito", "data_inicio", "data_naturalizacao"]) {
    ok(ev.includes(campo), `projeta a coluna canônica ${campo}`)
  }
  const fil = ler("src/lib/genealogia/navegacao/filtros.ts")
  ok(!/prisma|fetch\(/.test(fil), "filtros são puros")
  ok(fil.includes("NÃO esconde"), "filtro marca quem casa em vez de mutilar a topologia")
}

// ============================================================
console.log("\n7) Virtualização e memoização preservadas")
{
  const canvas = ler("src/components/arvore/motor/arvore-canvas.tsx")
  ok(canvas.includes("renderizarTudo"), "existe escape de virtualização só para exportação")
  ok(/areaVis/.test(canvas), "a virtualização usa a área visível medida")
  const hook = ler("src/components/arvore/motor/use-arvore-motor.ts")
  ok((hook.match(/useMemo/g) || []).length >= 4, "análise, busca, visíveis e layout memoizados")

  // Teto de exibição: sem ele, uma árvore grande devolve dezenas de milhares
  // de achados para a lista — memória e ilegibilidade.
  const analisar = ler("src/lib/genealogia/motor/analisar.ts")
  ok(analisar.includes("TETO_CATEGORIA") && analisar.includes("TETO_TOTAL"), "corte de exibição existe")
  ok(analisar.includes("totais"), "totais reais expostos junto do corte")
  const painel = ler("src/components/arvore/motor/painel-inteligencia.tsx")
  ok(painel.includes("analise.totais"), "painel conta pelo total real, não pelo exibido")
  ok(painel.includes("analise.truncado"), "painel avisa quando a lista foi cortada")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA DA ÁRVORE — ${passed} ok, ${failed} falhas`)
if (failed > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
