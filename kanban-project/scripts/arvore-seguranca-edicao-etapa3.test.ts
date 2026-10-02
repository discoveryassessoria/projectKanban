// scripts/arvore-seguranca-edicao-etapa3.test.ts
// ============================================================================
// ETAPA 3 DA REFORMA DA ÁRVORE — SEGURANÇA DE EDIÇÃO.
//
//   a) a lixeira sai da barra: exclusão da árvore vive no menu "⋯" e exige
//      digitar o NOME do processo (comparação exata);
//   b) Delete/Backspace não apaga mais vínculo nem pessoa no canvas; remover
//      vínculo é ação explícita com confirmação, pela porta oficial;
//   c) Desfazer/Refazer (Ctrl/Cmd+Z): pilha pura de comandos, inverso pelas
//      MESMAS rotas (nunca direto no banco), falha sem corromper a pilha.
//
// Lógica de histórico = módulo PURO testado de verdade (unitário). UI = varredura
// de fonte (padrão de arvore-moldura-etapa2.test.ts).
//
//   npx tsx scripts/arvore-seguranca-edicao-etapa3.test.ts
// ============================================================================
import { readFileSync } from "node:fs"

import { criarHistorico, type ComandoEdicao, type ResultadoComando } from "@/src/lib/genealogia/historico-edicao"
import {
  classificarVinculo,
  comandoMoverNos,
  comandoRemoverFiliacao,
  comandoRemoverUniao,
  efeitoDoVinculo,
  houveMovimento,
  type Http,
  type VinculoRemovivel,
} from "@/src/lib/genealogia/vinculos-edicao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" || extra == null ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}${e}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

type Filiacao = Extract<VinculoRemovivel, { tipo: "pai" | "mae" }>
type Uniao = Extract<VinculoRemovivel, { tipo: "uniao" }>

async function main() {
  // ═══ 1) PILHA DE COMANDOS ═════════════════════════════════════════════════
  secao("1) histórico: pilha pura de comandos")
  const log: string[] = []
  const cmd = (nome: string, r?: { aplicar?: ResultadoComando; desfazer?: ResultadoComando }): ComandoEdicao => ({
    rotulo: nome,
    aplicar: async () => { log.push(`+${nome}`); return r?.aplicar ?? { ok: true } },
    desfazer: async () => { log.push(`-${nome}`); return r?.desfazer ?? { ok: true } },
  })

  const h = criarHistorico()
  ok((await h.desfazer()).status === "vazio" && (await h.refazer()).status === "vazio", "pilha vazia: desfazer/refazer não fazem nada")
  h.registrar(cmd("a")); h.registrar(cmd("b"))
  ok(h.podeDesfazer() && !h.podeRefazer(), "registrar habilita desfazer")
  const r1 = await h.desfazer()
  ok(r1.status === "ok" && r1.rotulo === "b" && log.join() === "-b", "desfazer desfaz o ÚLTIMO comando")
  ok(h.podeRefazer(), "e habilita refazer")
  await h.refazer()
  ok(log.join() === "-b,+b", "refazer reaplica o mesmo comando")
  await h.desfazer()
  h.registrar(cmd("c"))
  ok(!h.podeRefazer(), "ação nova limpa o refazer (histórico linear)")

  const pequeno = criarHistorico(3)
  for (const n of ["1", "2", "3", "4", "5"]) pequeno.registrar(cmd(n))
  ok(pequeno.tamanho().desfazer === 3, "pilha é limitada (descarta o mais antigo)")
  const padrao = criarHistorico()
  for (let i = 0; i < 80; i++) padrao.registrar(cmd("n"))
  ok(padrao.tamanho().desfazer === 50, "limite padrão = 50")

  // falha transitória: o comando FICA, dá para tentar de novo
  let tentativas = 0
  const instavel: ComandoEdicao = {
    rotulo: "instável",
    aplicar: async () => ({ ok: true }),
    desfazer: async () => (++tentativas < 2 ? { ok: false, erro: "rede caiu" } : { ok: true }),
  }
  const h2 = criarHistorico(); h2.registrar(instavel)
  const f1 = await h2.desfazer()
  ok(f1.status === "falhou" && f1.erro === "rede caiu" && !f1.descartado && h2.podeDesfazer() && !h2.podeRefazer(), "falha transitória: erro claro, comando permanece, nada vai para o refazer")
  const f2 = await h2.desfazer()
  ok(f2.status === "ok" && h2.podeRefazer(), "tentar de novo funciona")

  // falha definitiva: sai da pilha, o resto continua utilizável
  const h3 = criarHistorico()
  h3.registrar(cmd("antigo"))
  h3.registrar(cmd("impossível", { desfazer: { ok: false, erro: "Pessoa não existe mais.", definitivo: true } }))
  const f3 = await h3.desfazer()
  ok(f3.status === "falhou" && f3.descartado && f3.erro === "Pessoa não existe mais.", "falha definitiva: mensagem do servidor + descartado")
  ok(h3.tamanho().desfazer === 1 && !h3.podeRefazer(), "pilha não corrompe: o anterior segue disponível")
  const f3b = await h3.desfazer()
  ok(f3b.status === "ok" && f3b.rotulo === "antigo", "e o anterior desfaz normalmente")

  // exceção dentro do comando vira falha, não derruba a pilha
  const h4 = criarHistorico()
  h4.registrar({ rotulo: "explode", aplicar: async () => ({ ok: true }), desfazer: async () => { throw new Error("boom") } })
  const f4 = await h4.desfazer()
  ok(f4.status === "falhou" && f4.erro === "boom" && h4.podeDesfazer(), "exceção vira falha e mantém o comando")

  // concorrência: uma operação por vez
  let liberar: () => void = () => {}
  const lento: ComandoEdicao = {
    rotulo: "lento",
    aplicar: async () => ({ ok: true }),
    desfazer: () => new Promise((res) => { liberar = () => res({ ok: true }) }),
  }
  const h5 = criarHistorico(); h5.registrar(cmd("x")); h5.registrar(lento)
  const emVoo = h5.desfazer()
  ok((await h5.desfazer()).status === "ocupado", "segunda chamada durante uma operação devolve 'ocupado'")
  liberar(); await emVoo
  ok(h5.tamanho().desfazer === 1 && h5.tamanho().refazer === 1, "e a operação em voo termina limpa")

  // limpar durante o voo (troca de árvore) não empurra comando antigo
  const h6 = criarHistorico()
  h6.registrar(lento)
  const voo = h6.desfazer()
  h6.limpar(); liberar(); await voo
  ok(!h6.podeRefazer() && !h6.podeDesfazer(), "trocar de árvore no meio do desfazer não deixa resto na pilha")
  h6.registrar(cmd("p")); h6.limpar()
  ok(!h6.podeDesfazer(), "limpar zera a pilha")

  // ═══ 2) CLASSIFICAR O VÍNCULO ════════════════════════════════════════════
  secao("2) aresta → vínculo real")
  const pessoas = [
    { id: 1, nome: "Ana", sobrenome: "Silva", paiId: 2, maeId: 3 },
    { id: 2, nome: "João", sobrenome: "Silva" },
    { id: 3, nome: "Maria", sobrenome: "Souza" },
    { id: 4, nome: "Lia" },
  ]
  const unioes = [{ id: 10, pessoa1Id: 2, pessoa2Id: 3 }]
  const pai = classificarVinculo({ id: "edge-pai-1", source: "person-1", target: "person-2" }, pessoas, unioes) as Filiacao
  ok(pai?.tipo === "pai" && pai.filhoId === 1 && pai.progenitorId === 2, "aresta filho→pai vira vínculo 'pai'")
  const mae = classificarVinculo({ id: "edge-filho-1-mae", source: "person-1", target: "person-3" }, pessoas, unioes) as Filiacao
  ok(mae?.tipo === "mae" && mae.progenitorNome === "Maria Souza", "aresta filho→mãe vira vínculo 'mae'")
  const uni = classificarVinculo({ id: "edge-marriage-2-3", source: "person-3", target: "person-2" }, pessoas, unioes) as Uniao
  ok(uni?.tipo === "uniao" && uni.uniaoId === 10, "aresta de casamento vira a união certa (qualquer ordem)")
  ok(classificarVinculo({ id: "edge-grupo-x", source: "grupo-x", target: "person-1" }, pessoas, unioes) === null, "tracejado '+N irmãos' não é vínculo")
  ok(classificarVinculo({ id: "edge-x", source: "person-1", target: "person-4" }, pessoas, unioes) === null, "aresta sem vínculo real não é removível")
  ok(classificarVinculo({ id: "edge-marriage-1-4", source: "person-1", target: "person-4" }, pessoas, unioes) === null, "casamento sem união cadastrada não é removível")
  const ef = efeitoDoVinculo(pai)
  ok(ef.afetados[0].includes("João Silva") && ef.afetados[0].includes("Ana Silva") && ef.efeitos.length >= 2, "o efeito diz QUEM é afetado e o que muda na documentação")
  ok(efeitoDoVinculo(uni).efeitos.some((t) => /certidão de casamento/i.test(t)), "união: fala da certidão de casamento")

  // ═══ 3) COMANDOS PELAS PORTAS OFICIAIS ═══════════════════════════════════
  secao("3) remover vínculo: aplicar e desfazer pelas mesmas rotas")
  type Chamada = { m: string; u: string; c?: unknown }
  const chamadas: Chamada[] = []
  const httpFalso = (resp: (c: Chamada) => { ok: boolean; status: number; corpo: unknown }): Http => async (m, u, c) => {
    const ch = { m, u, c }; chamadas.push(ch); return resp(ch)
  }
  const c1 = comandoRemoverFiliacao(pai, httpFalso(() => ({ ok: true, status: 200, corpo: {} })))
  await c1.aplicar(); await c1.desfazer()
  ok(chamadas[0].m === "PUT" && chamadas[0].u === "/api/pessoas/1" && JSON.stringify(chamadas[0].c) === '{"paiId":null}', "remover pai: PUT /api/pessoas/:filho {paiId:null}")
  ok(chamadas[1].m === "PUT" && chamadas[1].u === "/api/pessoas/1" && JSON.stringify(chamadas[1].c) === '{"paiId":2}', "desfazer: PUT com o MESMO pai (rota oficial, não banco)")
  ok(chamadas.every((c) => c.u.startsWith("/api/")), "toda chamada é rota de API (nenhuma escrita direta)")

  const cMae = comandoRemoverFiliacao(mae, httpFalso(() => ({ ok: true, status: 200, corpo: {} })))
  chamadas.length = 0; await cMae.desfazer()
  ok(JSON.stringify(chamadas[0].c) === '{"maeId":3}', "mãe usa maeId")

  const recusa = comandoRemoverFiliacao(pai, httpFalso(() => ({ ok: false, status: 409, corpo: { error: "Guarda bloqueou" } })))
  const rr = await recusa.desfazer()
  ok(!rr.ok && rr.erro === "Guarda bloqueou" && rr.definitivo === true, "4xx: mensagem do servidor intacta e definitiva")
  const rede = comandoRemoverFiliacao(pai, async () => { throw new Error("offline") })
  const rn = await rede.desfazer()
  ok(!rn.ok && !rn.definitivo && /conexão/i.test(rn.erro), "falha de rede: transitória, mensagem clara")
  const erro500 = comandoRemoverFiliacao(pai, httpFalso(() => ({ ok: false, status: 500, corpo: { error: "x", salvo: true } })))
  const r5 = await erro500.aplicar()
  ok(!r5.ok && !r5.definitivo, "5xx não é definitivo")

  // união: retrato antes de apagar, recriação com os mesmos dados e id novo
  chamadas.length = 0
  let proxId = 99
  const httpUniao = httpFalso((c) => {
    if (c.m === "GET") return { ok: true, status: 200, corpo: { id: 10, tipo: "casamento_civil", cartorio: "1º Ofício", livro: "B-4", data_registro: "1950-01-01T00:00:00.000Z", local: null, pessoa1: { x: 1 } } }
    if (c.m === "POST") return { ok: true, status: 201, corpo: { id: proxId++ } }
    return { ok: true, status: 200, corpo: {} }
  })
  const cu = await comandoRemoverUniao(uni, httpUniao)
  ok(cu.ok && chamadas.length === 1 && chamadas[0].m === "GET", "união: lê o retrato ANTES de apagar")
  if (cu.ok) {
    await cu.comando.aplicar()
    await cu.comando.desfazer()
    await cu.comando.aplicar()
    const del1 = chamadas[1], post = chamadas[2], del2 = chamadas[3]
    ok(del1.m === "DELETE" && del1.u === "/api/unioes/10", "apagar: DELETE /api/unioes/:id")
    const corpo = (post.c ?? {}) as Record<string, unknown>
    ok(post.m === "POST" && post.u === "/api/unioes" && corpo.cartorio === "1º Ofício" && corpo.livro === "B-4" && corpo.data_registro === "1950-01-01T00:00:00.000Z" && corpo.pessoa1Id === 3 && corpo.pessoa2Id === 2, "desfazer: POST /api/unioes com os MESMOS dados da união")
    ok(!("pessoa1" in corpo) && !("id" in corpo), "não reenvia relações nem o id antigo")
    ok(del2.u === "/api/unioes/99", "refazer apaga a união RECRIADA (id novo), não a antiga")
  }
  const semLeitura = await comandoRemoverUniao(uni, httpFalso(() => ({ ok: false, status: 404, corpo: { error: "União não encontrada" } })))
  ok(!semLeitura.ok && semLeitura.erro === "União não encontrada", "sem o retrato da união, nada é apagado (comando nem nasce)")

  // mover cartões
  secao("4) mover cartão: inverso = posição anterior")
  const aplicadas: { modo: string; pos: Record<string, { x: number; y: number }> }[] = []
  const mv = comandoMoverNos("paisagem", [{ pessoaId: 7, antes: { x: 10, y: 20 }, depois: { x: 110, y: 220 } }], (modo, pos) => { aplicadas.push({ modo, pos }) })
  await mv.desfazer(); await mv.aplicar()
  ok(aplicadas[0].modo === "paisagem" && aplicadas[0].pos["7"].x === 10 && aplicadas[0].pos["7"].y === 20, "desfazer grava a posição anterior (no modo em que foi feito)")
  ok(aplicadas[1].pos["7"].x === 110, "refazer grava a posterior")
  ok(mv.afetaDados === false, "mover é só layout: não recarrega a árvore")
  const mvErro = comandoMoverNos("retrato", [], () => { throw new Error("x") })
  ok(!(await mvErro.desfazer()).ok, "falha ao reposicionar vira resultado de erro")
  ok(
    houveMovimento([{ pessoaId: 1, antes: { x: 0, y: 0 }, depois: { x: 0.2, y: 0 } }]).length === 0 &&
      houveMovimento([{ pessoaId: 1, antes: { x: 0, y: 0 }, depois: { x: 5, y: 0 } }]).length === 1,
    "clique sem arrastar não é ação",
  )

  // ═══ 5) UI (varredura de fonte) ══════════════════════════════════════════
  secao("5) UI: menu ⋯, confirmação por nome, Delete desligado, Ctrl+Z")
  const view = codigo(ler("src/components/arvore/arvore-genealogica-view.tsx"))
  const tree = codigo(ler("src/components/arvore/react-flow-tree.tsx"))
  const menu = codigo(ler("src/components/arvore/menu-mais-arvore.tsx"))
  const modalEx = codigo(ler("src/components/arvore/exclusao-arvore-modal.tsx"))
  const modalVinc = codigo(ler("src/components/arvore/remover-vinculo-modal.tsx"))

  ok(!/Trash2/.test(view), "nenhuma lixeira solta na barra da árvore")
  ok(/<MenuMaisArvore/.test(view) && /Excluir árvore inteira/.test(view) && /pode\('arvore\.excluir'\) && arvoreId/.test(view), "exclusão da árvore está no menu ⋯, com a mesma permissão de antes")
  ok(/aria-label="Mais ações da árvore"/.test(menu) && /aria-haspopup="menu"/.test(menu) && /aria-expanded/.test(menu) && /role="menu"/.test(menu) && /role="menuitem"/.test(menu), "menu acessível (aria-label, haspopup, expanded, roles)")
  ok(/ArrowDown/.test(menu) && /ArrowUp/.test(menu) && /EVENTO_FECHAR_CAMADA/.test(menu) && /useFecharFora/.test(menu), "navega por teclado, fecha com Esc e clique fora")
  ok(/LAYER\.popover/.test(menu) && /--surface-popover/.test(menu), "popover opaco na camada do SSOT")
  ok(/digitado === nomeAlvo/.test(modalEx) && !/digitado\.trim\(\)/.test(modalEx) && /disabled=\{executando \|\| !nomeOk\}/.test(modalEx), "exclusão da árvore: botão só habilita com o nome EXATO (sem trim)")
  ok(/executar\(arvoreId, FRASE_CONFIRMACAO\)/.test(modalEx), "o servidor continua recebendo a própria frase de confirmação")
  ok(/setErro\(e instanceof Error \? e\.message/.test(modalEx), "erro do servidor aparece no modal (não é engolido)")

  ok(/deleteKeyCode=\{null\}/.test(tree), "Delete/Backspace desligados no canvas")
  ok(!/onEdgesDelete|onNodesDelete/.test(tree), "nenhum handler de remoção por tecla")
  ok(/onEdgeClick=\{selecionarAresta\}/.test(tree) && /onVinculoSelecionado/.test(tree), "a aresta é selecionável (clique/Enter) e informada à tela")
  ok(/Remover vínculo/.test(view) && /setVinculoParaRemover\(vinculoSelecionado\)/.test(view), "botão 'Remover vínculo' ligado a handler real")
  ok(/vinculoSelecionado\.tipo === 'uniao' \? pode\('arvore\.excluir'\) : pode\('arvore\.editar'\)/.test(view), "o botão respeita as permissões das rotas")
  ok(/<RemoverVinculoModal/.test(view) && /Quem é afetado/.test(modalVinc) && /O que muda na documentação/.test(modalVinc), "confirmação diz quem é afetado e o efeito na documentação")
  const iRemover = view.indexOf("const handleRemoveParent")
  ok(iRemover > 0 && !/window\.confirm/.test(view.slice(iRemover, iRemover + 900)), "o 'remover pai/mãe' do painel lateral usa o MESMO modal (sem window.confirm)")
  ok(/comandoRemoverFiliacao/.test(view) && /comandoRemoverUniao/.test(view) && !/fetch\(/.test(codigo(ler("src/lib/genealogia/vinculos-edicao.ts"))), "a remoção usa os comandos (rotas oficiais); o módulo puro não tem fetch")

  ok(/\(e\.metaKey \|\| e\.ctrlKey\)[\s\S]{0,200}k === 'z' \|\| k === 'y'/.test(view), "Ctrl/Cmd+Z (e Y) tratados")
  ok(/if \(digitando \|\| modalAberto\) return/.test(view), "em campo de texto/modal o Ctrl+Z é do campo (não é capturado)")
  ok(/e\.shiftKey/.test(view), "Shift+Ctrl/Cmd+Z refaz")
  ok(/h\.limpar\(\)/.test(view) && /\[arvoreId, processoId\]/.test(view), "pilha limpa ao trocar de árvore/processo")
  ok(/onPosicoesMovidas=\{aoMoverCartoes\}/.test(view) && /aplicarPosicoes/.test(tree), "mover cartão alimenta o histórico")
  ok(/rotulo: 'Desfazer'/.test(view) && /<AvisoEdicao/.test(view), "aviso 'Vínculo removido' com botão Desfazer")
  ok(/zIndex: LAYER\.toast/.test(codigo(ler("src/components/arvore/aviso-edicao.tsx"))), "aviso na camada de toast do SSOT")

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
