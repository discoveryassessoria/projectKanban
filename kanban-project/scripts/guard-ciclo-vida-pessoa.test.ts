/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — CICLO DE VIDA DA PESSOA NO PROCESSO.
 * Rodar: npm run test:guard-pessoa   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 * Existe UM fluxo canônico para remover uma pessoa da árvore/processo:
 *   src/services/pessoa-ciclo-vida.ts → removerPessoaDaArvore()
 *
 * Nenhuma rota, componente ou script de runtime pode apagar por conta própria:
 *   · Pessoa                    (o nó da árvore)
 *   · ProcessoRequerente        (o vínculo pessoa↔processo)
 *   · Documento                 (documento operacional)
 *   · ReceitaRequerente         (participante financeiro)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * A exclusão anterior vivia INLINE numa rota. Ela apagava a `Pessoa` e o que
 * era local à genealogia; tudo o que era derivado no processo sobrevivia,
 * porque as FKs para Pessoa são `onDelete: SetNull` — ou nem são FK.
 *
 * O resultado medido em produção (processo 513, 07/08/2026): árvore com ZERO
 * pessoas, 6 vínculos de requerente vivos com `personId` nulo, 16 tarefas
 * "Localizar registro da certidão" sem passo, sem necessidade e sem documento,
 * e uma receita de R$ 2.800 sem dono.
 *
 * Nada disso deu erro. Nada alertou. Só a contagem ficou errada — e ao
 * readicionar a mesma pessoa nasceu uma segunda representação dela.
 *
 * Sintoma que não interrompe ninguém não se defende com disciplina.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO ESTE TESTE FALHA
 * ═══════════════════════════════════════════════════════════════════════════
 * Varre o repositório inteiro. Ponto de escrita novo reprova até entrar na
 * allowlist NOMINAL abaixo, com justificativa. Entrada morta também reprova,
 * para a lista não virar depósito de exceções.
 *
 * Se o CI reprovou: a resposta quase certa NÃO é adicionar seu arquivo à lista.
 * É chamar o serviço canônico.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

// ═══════════════════════════════════════════════════════════════════════════
// DONOS — quem pode escrever cada modelo, e mais ninguém.
// ═══════════════════════════════════════════════════════════════════════════

interface Alvo {
  /** Nome do modelo no Prisma Client (camelCase). */
  modelo: string
  /** Nome da tabela no banco — para pegar desvio por SQL cru. */
  tabela: string
  /** Arquivos de RUNTIME autorizados a escrever. */
  donos: string[]
  /** O que dizer a quem foi reprovado. */
  saida: string
}

const ALVOS: Alvo[] = [
  {
    modelo: "pessoa",
    tabela: "Pessoa",
    donos: [
      "src/services/pessoa-ciclo-vida.ts",
      // Criação e edição do nó da árvore — não é remoção; o guard mira em delete.
      "lib/genealogia/vincular-requerente.ts",
    ],
    saida: "chame removerPessoaDaArvore() em src/services/pessoa-ciclo-vida.ts",
  },
  {
    modelo: "processoRequerente",
    tabela: "ProcessoRequerente",
    donos: [
      "src/services/pessoa-ciclo-vida.ts",
      "lib/genealogia/vincular-requerente.ts",
      "src/services/criar-processo.ts",
      // Edição do processo troca o CONJUNTO de requerentes (deleteMany+createMany).
      "src/app/api/processos/[processoId]/route.ts",
    ],
    saida: "o vínculo pessoa↔processo sai por removerPessoaDaArvore()",
  },
  {
    modelo: "documento",
    tabela: "Documento",
    donos: ["src/services/documento-operacional.ts"],
    saida: "chame removerDocumento()/removerDocumentosDoSujeito() em src/services/documento-operacional.ts",
  },
  {
    modelo: "receitaRequerente",
    tabela: "ReceitaRequerente",
    donos: [
      "src/services/pessoa-ciclo-vida.ts",
      // Distribuição financeira: dono da composição de participantes da Receita.
      "src/app/api/financeiro/receitas/[id]/route.ts",
      "src/app/api/financeiro/receitas/[id]/distribuicao/route.ts",
      "src/lib/motor/executor.ts",
    ],
    saida: "participante financeiro de pessoa removida sai por removerPessoaDaArvore()",
  },
]

/**
 * FORA DO RUNTIME: backfills (ato administrativo, com dry-run e relatório) e
 * testes (precisam montar e limpar cenário). Cada entrada é nominal — não há
 * regra "tudo em scripts/ pode".
 */
const AUTORIZADOS_FORA_DO_RUNTIME: Record<string, string> = {
  "scripts/concluir-etapa.test.ts":
    "porta de conclusão de etapa: monta e derruba os PRÓPRIOS processos (marca ETAPA) " +
    "só no banco de teste",
  "scripts/portas-tarefa.test.ts":
    "portas canônicas da tarefa: monta e derruba os PRÓPRIOS processos (marca PORTAS) " +
    "só no banco de teste",
  "scripts/motor-operacional-fases.test.ts":
    "motor operacional através das fases: monta e derruba os PRÓPRIOS processos " +
    "(marca MOTOR-FASE) só no banco de teste",
  "scripts/tarefa-atribuicao.test.ts":
    "atribuição/transferência/notificação: cria e derruba o PRÓPRIO cenário (marca ATRIB-TEST) " +
    "só no banco de teste",
  // ── Guard ────────────────────────────────────────────────────────────────
  // O backfill de resíduos NÃO entra aqui: ele não remove nenhum dos quatro
  // modelos protegidos (só Tarefa, Passo e Necessidade — esta pelo serviço dono).
  "scripts/guard-ciclo-vida-pessoa.test.ts": "este guard (cita os padrões que procura)",

  // ── Teste do próprio ciclo de vida ───────────────────────────────────────
  "scripts/pessoa-tortura.test.ts": "teste de tortura: 10 ciclos criar→excluir→recriar",
  "scripts/pessoa-equivalencia-rotas.test.ts": "teste de equivalência das duas rotas: monta dois cenários e limpa",
  "scripts/smoke-ui-setup.ts": "smoke autenticado em produção: monta e REMOVE o cenário marcado (SMOKE-UI-CICLO-VIDA)",
  "scripts/reconciliacao-derivada-requerente.test.ts":
    "cenários A–N da reconciliação do estado derivado: monta e limpa o próprio cenário (marca RECONC-DERIVADO)",
  "scripts/porta-unica-requerente.test.ts":
    "equivalência das três portas de inserção: monta e limpa o próprio cenário (marca PORTA-UNICA)",
  "scripts/matriz-estados-requerente.test.ts":
    "matriz de estados do requerente: monta e limpa o próprio cenário (marca MATRIZ-ESTADOS)",
  "scripts/planilha-documental-projecao.test.ts":
    "projeção da Planilha Documental: monta e limpa o próprio cenário (marca PLANILHA-PROJ)",
  "scripts/guard-estado-derivado.test.ts":
    "guard do estado derivado (cita os padrões de escrita que procura, como este arquivo)",

  // ── Testes de integração que montam e derrubam cenário com banco ─────────
  // Cada um limpa o que ele mesmo criou. Nenhum é caminho de runtime.
  "scripts/lancamento-manual.integration.ts": "integração: limpa a base antes do cenário",
  "scripts/cancelamento-avancado.test.ts": "integração financeira: limpa participantes do cenário",
  "scripts/custo-documental.test.ts": "integração de custo documental: limpa documentos do cenário",
  "scripts/excluir-receita.test.ts": "integração: limpa participantes das receitas do cenário",
  "scripts/int-adversarial-db.test.ts": "integração adversarial: limpa participantes e requerentes do cenário",
  "scripts/int-financeiro-db.test.ts": "integração financeira: limpa participantes e requerentes do cenário",
  "scripts/int-geral-acoes-db.test.ts": "integração de ações: limpa participantes do cenário",
  "scripts/int-p0-motor-db.test.ts": "integração do motor: limpa participantes do cenário",
  "scripts/int-receita-manual-db.test.ts": "integração de receita manual: limpa participantes e requerentes",
  "scripts/motor-documental-idempotencia.test.ts": "20 rodadas de idempotência: limpa documentos do cenário",
  "scripts/mrg-e2e.test.ts": "e2e do Motor Registral: monta e limpa cenário documental",
  "scripts/participante-conta.test.ts": "integração de participante: limpa participantes do cenário",
  "scripts/requerimento-doc21.test.ts": "integração DOC21: limpa documentos do cenário",
  "scripts/arvore-membership.test.ts":
    "teste de membership: monta e limpa o próprio cenário; prova que requerente do processo ≠ membro da árvore",
  "scripts/arvore-preview-impacto.test.ts":
    "integração do preview de impacto: limpa a árvore de teste que ele mesmo criou (a simulação não grava — ver o rollback)",

  // ── Preparação de ambiente ───────────────────────────────────────────────
  "scripts/preview-sandbox-setup.mjs": "sandbox de Preview: derruba dados do ambiente descartável",
  "prisma/test-tipo-novo.ts": "script de verificação de tipo: cria e apaga o próprio documento",
  "scripts/tarefa-unidade-operacional.test.ts":
    "unidade operacional da Tarefa: monta e derruba as próprias árvores (marca TAREFA-OP), " +
    "só no banco de teste; prova que 7 etapas continuam sendo 1 tarefa",
  "scripts/equivalencia-portas-etapa.test.ts":
    "equivalência das portas de conclusão de etapa: monta e derruba DUAS árvores idênticas " +
    "(marca EQUIV), só no banco de teste; a prova depende de os dois cenários serem gêmeos",
  "scripts/fronteira-documento-operacao.test.ts":
    "fronteira de documento-operacao: monta e derruba a PRÓPRIA operação por documento (marca FRONT), só no banco de teste — prova que a transição migrou para o motor sem perder metadata, necessidade nem ativação do próximo passo",
  "scripts/palco-central-500.ts":
    "palco visual de escala: monta e derrubа a PRÓPRIA árvore (marca ESCALA500), só no banco de teste",
  "scripts/distribuicao-500-tarefas.test.ts":
    "escala da distribuição: monta e derruba a PRÓPRIA árvore (marca DIST500), só no banco de teste",
  "scripts/avisos-prazo.test.ts":
    "varredura de prazos: monta e derruba a PRÓPRIA árvore (marca AVISO), só no banco de teste",
  "scripts/central-fase-500-docs.test.ts":
    "escala da Central: monta e derruba a PRÓPRIA árvore (marca ESCALA500), só no banco de teste — " +
    "vinte e cinco pessoas com quinhentas certidões entre elas",
  "scripts/palco-retrocesso-motor.ts":
    "palco do retrocesso de fase: monta e derruba a PRÓPRIA árvore (marca PALCO-RETROCESSO), só no banco de teste — o requerente precisa existir para a fase documental ter obrigação, e o ciclo A→B→A precisa de duas certidões da mesma pessoa",
  "scripts/palco-fila-operacional.ts":
    "palco visual da Minha Fila: monta e derruba a PRÓPRIA árvore (marca PALCO-FILA), só no banco de teste — precisa de pessoas homônimas para a validação visual provar que \"Continuar\" abre a certidão certa",
  "scripts/fila-ciclo-de-vida.test.ts":
    "ciclo de vida da tarefa na fila: monta e derruba a PRÓPRIA árvore (marca FILA-CICLO), só no banco de teste — o palco precisa de pessoas homônimas para provar que a navegação abre o documento certo por ID, e não pelo título",
  "scripts/fase-nao-duplica-tarefa.test.ts":
    "mudança de fase não duplica tarefa: monta e derruba a PRÓPRIA árvore (marca FASEDUP), " +
    "só no banco de teste — reproduz o caso em que a mesma certidão virou duas tarefas vivas",
  "scripts/fluxo-distribuicao.test.ts":
    "fluxo de distribuição: monta e derruba os PRÓPRIOS processos (marca DISTR), só no banco de teste — o cenário precisa de obrigação real para o motor criar a tarefa sozinho, que é justamente o que se prova",
  "scripts/palco-distribuicao.ts":
    "palco visual da Operação: monta e derruba os PRÓPRIOS processos (marca PALCO), só no banco de teste, para a captura de tela com dados realistas — não roda em produção",
  "scripts/navegacao-operacional.test.ts":
    "deep-link operacional: monta e derruba as PRÓPRIAS 15 certidões de 5 pessoas (marca NAV), só no banco de teste — a prova de que cada tarefa abre exatamente a sua exige quinze unidades reais, com necessidade e documento próprios",
  "scripts/identidade-operacional.test.ts":
    "invariantes da operação: monta e derruba o PRÓPRIO processo (marca IDENT), só no banco de teste — prova que atribuir não inicia, abrir não inicia e iniciar é idempotente; a limpeza remove a necessidade que o palco criou",
  "scripts/organizacao-capacidade.test.ts":
    "ontologia operacional: monta e derruba as PRÓPRIAS unidades de trabalho, tipos, itens e necessidades (marca ORG), só no banco de teste — a prova de que fase ≠ aptidão exige DUAS unidades distintas alcançadas pela mesma fase macro, e a necessidade é o que liga a tarefa à sua unidade",
  "scripts/palco-gerencial.ts":
    "palco da visão gerencial global: monta e derruba os PRÓPRIOS processos (marca GERENCIAL), só no banco de teste — precisa de uma tarefa em CADA estado operacional para provar que o quadro coloca cada uma na sua coluna; os estados são alcançados pelas portas canônicas, só o cenário é montado aqui",
  "scripts/etapa-nao-e-tarefa.test.ts":
    "etapa não é tarefa: monta e derruba os PRÓPRIOS processos (marca ETAPA5), só no banco de teste — prova que 5 passos publicados de um documento produzem 1 tarefa, e que 2 documentos produzem 2 tarefas e não 10",
  "scripts/workflow-documental-completo.test.ts":
    "workflow documental completo: monta e derruba os PRÓPRIOS processos (marca WFDOC), só no banco de teste — percorre os cinco executores pela mesma porta que os modais usam e prova que o taskId sobrevive do pedido à validação",
  "scripts/override-isolamento.test.ts":
    "isolamento do override entre processos: monta e derruba as próprias árvores (marca ISOLAMENTO), " +
    "só no banco de teste",
  "scripts/planilha-override.test.ts":
    "combinado da célula: monta e derrube o próprio cenário (marca OVERRIDE-TEST) e prova que " +
    "remover a Pessoa leva o override junto — a exclusão faz PARTE do que ele verifica",
  "scripts/palco-planilha-referencia.ts":
    "palco de comparação visual da Planilha Documental: monta e derruba a PRÓPRIA árvore fictícia, " +
    "só no banco de teste (exigirBancoDeTeste) — nunca remove pessoa de árvore real",
}

const RUNTIME = ["src", "lib"]
const OUTROS = ["scripts", "prisma"]
const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp"])

// ═══════════════════════════════════════════════════════════════════════════

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

/** Código executável: comentários fora, para citar o padrão em doc não reprovar. */
const semComentarios = (texto: string) =>
  texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

function varrer(dir: string, out: string[] = []): string[] {
  const abs = join(RAIZ, dir)
  if (!existsSync(abs)) return out
  for (const entrada of readdirSync(abs)) {
    if (IGNORAR.has(entrada)) continue
    const rel = `${dir}/${entrada}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(entrada)) out.push(rel)
  }
  return out
}

/** Só REMOÇÃO. Criar e atualizar pessoa é operação comum e não é o alvo. */
const REMOCOES = ["delete", "deleteMany"]

console.log("GUARD ARQUITETURAL — ciclo de vida da Pessoa no Processo\n")

const arquivosRuntime = RUNTIME.flatMap((d) => varrer(d))
const arquivosOutros = OUTROS.flatMap((d) => varrer(d))
console.log(`  varridos: ${arquivosRuntime.length + arquivosOutros.length} arquivos (${arquivosRuntime.length} de runtime)`)

interface Ocorrencia { arquivo: string; linha: number; trecho: string; alvo: Alvo; tipo: "orm" | "sql" }

const conteudo = new Map<string, string>()
const ler = (rel: string) => {
  if (!conteudo.has(rel)) conteudo.set(rel, semComentarios(readFileSync(join(RAIZ, rel), "utf8")))
  return conteudo.get(rel)!
}

function remocoesEm(rel: string): Ocorrencia[] {
  const limpo = ler(rel)
  const achados: Ocorrencia[] = []
  const linhas = limpo.split("\n")
  for (const alvo of ALVOS) {
    const padrao = new RegExp(`\\b${alvo.modelo}\\s*\\.\\s*(${REMOCOES.join("|")})\\b`, "g")
    linhas.forEach((linha, i) => {
      padrao.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = padrao.exec(linha)) != null) {
        achados.push({ arquivo: rel, linha: i + 1, trecho: m[0], alvo, tipo: "orm" })
      }
    })
    const sql = new RegExp(`\\$(?:execute|query)Raw(?:Unsafe)?[\\s\\S]{0,400}?DELETE\\s+FROM\\s+"?${alvo.tabela}"?`, "gi")
    if (sql.test(limpo)) {
      achados.push({ arquivo: rel, linha: 0, trecho: `DELETE cru em ${alvo.tabela}`, alvo, tipo: "sql" })
    }
  }
  return achados
}

const ocorrencias = [...arquivosRuntime, ...arquivosOutros].flatMap(remocoesEm)

// ── 1) RUNTIME: cada modelo tem donos declarados ───────────────────────────
secao("1) Runtime (src/, lib/) — remoção só pelos donos declarados")

for (const alvo of ALVOS) {
  const escritores = [...new Set(
    ocorrencias.filter((o) => o.alvo === alvo && arquivosRuntime.includes(o.arquivo)).map((o) => o.arquivo),
  )].sort()
  const invasores = escritores.filter((f) => !alvo.donos.includes(f))
  ok(`${alvo.tabela}: nenhum removedor fora dos donos`, invasores.length === 0,
    invasores.length ? `${invasores.join(", ")} → ${alvo.saida}` : `donos: ${escritores.join(", ") || "(nenhum uso)"}`)
}

// ── 2) Fora do runtime: allowlist nominal ──────────────────────────────────
secao("2) Scripts e backfills — allowlist nominal")

const escritoresFora = [...new Set(
  ocorrencias.filter((o) => arquivosOutros.includes(o.arquivo)).map((o) => o.arquivo),
)].sort()
for (const f of escritoresFora) {
  const motivo = AUTORIZADOS_FORA_DO_RUNTIME[f]
  ok(`autorizado: ${f}`, !!motivo, motivo ?? "NÃO está na allowlist — justifique no guard ou use o serviço canônico")
}
const mortas = Object.keys(AUTORIZADOS_FORA_DO_RUNTIME).filter(
  (f) => f !== "scripts/guard-ciclo-vida-pessoa.test.ts" && !escritoresFora.includes(f),
)
ok("a allowlist não tem entrada morta", mortas.length === 0, mortas.join(", ") || "—")

// ── 3) Sem desvio por SQL cru ──────────────────────────────────────────────
secao("3) Sem desvio por SQL cru")
const sqls = ocorrencias.filter((o) => o.tipo === "sql" && arquivosRuntime.includes(o.arquivo))
ok("nenhum DELETE cru nos modelos protegidos", sqls.length === 0,
  sqls.map((o) => `${o.arquivo}: ${o.trecho}`).join(" | ") || "—")

// ── 4) O caminho canônico continua ligado ──────────────────────────────────
secao("4) A cadeia canônica está ligada")

const servico = ler("src/services/pessoa-ciclo-vida.ts")
ok("removerPessoaDaArvore roda em transação", /prisma\.\$transaction\(/.test(servico))
ok("o plano é RECALCULADO dentro da transação",
  servico.indexOf("prisma.$transaction(") < servico.indexOf("analisarRemocaoPessoa(input.pessoaId, tx)"))
ok("a linha da Pessoa é travada antes de decidir (FOR UPDATE)", /FOR UPDATE/.test(servico))
ok("hard delete contra fato protegido é RECUSADO, não degradado",
  /FATO_PROTEGIDO_IMPEDE_HARD_DELETE/.test(servico))
ok("a necessidade sai pelo serviço canônico dela", /removerNecessidadesDoSujeito\(/.test(servico))
ok("o documento sai pelo serviço canônico dele", /removerDocumentosDoSujeito\(/.test(servico))
ok("o vínculo pessoa↔processo é removido no hard delete",
  /processoRequerente\.deleteMany\(/.test(servico))
ok("toda remoção é auditada", /logAuditoria\.create\(/.test(servico))

const rota = ler("src/app/api/pessoas/[id]/route.ts")
const rotaArvore = ler("src/app/api/arvore/[arvoreid]/route.ts")
ok("DELETE /api/pessoas/[id] delega ao serviço", /removerPessoaDaArvore\(/.test(rota))
ok("DELETE /api/arvore/[arvoreid] delega ao MESMO serviço", /removerPessoaDaArvore\(/.test(rotaArvore))
ok("a rota de pessoa não apaga nada por conta própria",
  !/tx\.(pessoa|documento|uniao)\.delete/.test(rota))
ok("a rota de árvore não apaga pessoa por conta própria",
  !/pessoa\.deleteMany\(/.test(rotaArvore))

// A ORIGEM DA AÇÃO NÃO PODE MUDAR O ESTADO FINAL. A reconciliação vivia na rota
// de pessoa; a de árvore chamava o mesmo serviço e não reconciliava — duas
// portas, dois estados finais. Agora ela é do serviço, e rota que reconciliar
// por conta própria reprova aqui.
ok("a reconciliação é do SERVIÇO, não da rota",
  /export async function reconciliarAposRemocao/.test(servico) &&
  /await reconciliarAposRemocao\(/.test(servico))
ok("a reconciliação roda DEPOIS do commit",
  servico.indexOf("}, { timeout: 60_000") < servico.indexOf("await reconciliarAposRemocao("),
  "materialização e reconcile abrem transações próprias")
for (const [arquivo, texto] of [["pessoas/[id]", rota], ["arvore/[arvoreid]", rotaArvore]] as const) {
  ok(`rota ${arquivo} não tem reconciliação própria`,
    !/dispararMaterializacaoPorArvore\(|reconciliarEconomicoDoProcesso\(/.test(
      texto.slice(texto.indexOf("export async function DELETE")),
    ))
}
ok("a reconciliação reusa os serviços canônicos existentes",
  /dispararMaterializacaoPorArvore\(/.test(servico) && /reconciliarEconomicoDoProcesso\(/.test(servico),
  "sem versão alternativa deles")

// ── 5) O recorte "ativo" tem fonte única ───────────────────────────────────
secao("5) Recorte ATIVO — fonte única, sem definição improvisada")

const CONSUMIDORES_OBRIGATORIOS = [
  ["src/services/genealogia/materializar-genealogia.ts", "materialização não recria dados de pessoa removida"],
  ["src/lib/motor/executor.ts", "motor financeiro ignora pessoa removida"],
  ["src/app/api/arvore/[arvoreid]/route.ts", "a árvore não exibe nó removido"],
  ["src/app/api/processos/[processoId]/route.ts", "o processo não lista vínculo removido"],
  ["src/app/api/processos/[processoId]/central-operacional/route.ts", "a Central não lista pessoa removida"],
  ["src/services/registral/estado.ts", "o motor registral ignora vínculo removido"],
  ["src/lib/cambio/servico-cambio.ts", "o câmbio ignora pessoa removida"],
]
for (const [arquivo, porque] of CONSUMIDORES_OBRIGATORIOS) {
  ok(`${arquivo} usa o recorte canônico`, /vinculo-ativo/.test(ler(arquivo)), porque)
}

// Ninguém pode redefinir "ativo" com literal próprio fora do módulo canônico.
const literaisSoltos: string[] = []
for (const f of arquivosRuntime) {
  if (f === "src/lib/genealogia/vinculo-ativo.ts") continue
  if (f === "src/services/pessoa-ciclo-vida.ts") continue // o serviço ESCREVE o campo
  if (f === "lib/genealogia/vincular-requerente.ts") continue // reativa na reinserção
  const txt = ler(f)
  if (/removidaEm:\s*null/.test(txt) || /removidoEm:\s*null/.test(txt)) literaisSoltos.push(f)
}
ok('nenhum arquivo define "ativo" por literal próprio', literaisSoltos.length === 0,
  literaisSoltos.join(", ") || "—")

// ── 6) A reinserção reativa em vez de duplicar ─────────────────────────────
secao("6) Reinserção: criar → excluir → recriar")

const vinc = ler("lib/genealogia/vincular-requerente.ts")
ok("o nó removido é REATIVADO, não recriado", /removidaEm:\s*null/.test(vinc))
ok("o vínculo do processo volta junto", /processoRequerente\.updateMany\(/.test(vinc))

// ── 7) As constraints estruturais existem no schema ────────────────────────
secao("7) Constraints que tornam a duplicação impossível")

const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8")
ok("Requerente.personId é único (uma Pessoa ⇒ um Requerente)",
  /personId\s+Int\?\s+@unique/.test(schema))
ok("ReceitaRequerente é único por (receita, requerente)",
  /@@unique\(\[receitaId,\s*requerenteId\]\)/.test(schema))
ok("ProcessoRequerente registra a remoção", /removidoEm\s+DateTime\?/.test(schema))
ok("Pessoa registra a remoção", /removidaEm\s+DateTime\?/.test(schema))

// ── 8) Nenhuma relação estrutural resolvida por texto ──────────────────────
secao("8) Identidade por ID, nunca por texto")

// O escopo é o CAMINHO DE REMOÇÃO. O gerador legado de tarefas de certidão que
// ainda vive nesta rota é dívida conhecida e separada (WF Interno é o dono das
// tarefas); ele não é caminho de exclusão e não entra neste guard.
const rotaDoc = ler("src/app/api/documentos/[id]/route.ts")
const corpoDelete = rotaDoc.slice(rotaDoc.indexOf("export async function DELETE"))
ok("o DELETE de documento não acha tarefa por título",
  !/tarefa\.(findFirst|findMany|deleteMany)\([\s\S]{0,200}titulo:/.test(corpoDelete),
  "buscar tarefa por igualdade de título deixa órfã quando o rótulo ou o nome muda")
ok("o DELETE de documento delega ao serviço canônico", /removerDocumento\(/.test(corpoDelete))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(64)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: remover pessoa da árvore é ato de UM serviço — src/services/pessoa-ciclo-vida.ts.")
  process.exit(1)
}
console.log(`Ciclo de vida da Pessoa: um dono, ${Object.keys(AUTORIZADOS_FORA_DO_RUNTIME).length - 1} exceções nomeadas.\n`)
