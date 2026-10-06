// scripts/arvore-desenho-camadas.test.ts
// ============================================================================
// GUARDA DO DESENHO DA ÁRVORE (06/10/2026) — o motor `desenharArvore` (algoritmo em camadas para casais) e a geometria das linhas.
// Estrutura de exemplo: casal ancestral → casal filho → dois filhos (um com DOIS casamentos, um filho de cada união; outro com cônjuge sem
// ascendentes e sem filhos) → netos. Vale para RETRATO e PAISAGEM.
//   npx tsx scripts/arvore-desenho-camadas.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { comandoResetarLayout } from "../src/lib/genealogia/vinculos-edicao"
import {
  desenharArvore, ladosDoCasal, FOLGAS,
  type Disposicao, type PessoaDoDesenho, type UniaoDoDesenho, type Retangulo,
} from "../src/lib/genealogia/layout/arvore-camadas"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const TAM: Record<Disposicao, { largura: number; altura: number }> = { retrato: { largura: 160, altura: 120 }, paisagem: { largura: 240, altura: 90 } }

// ─── A árvore de exemplo ───────────────────────────────────────────────────
const P = (id: number, sexo: string, nasc: string, paiId?: number, maeId?: number): PessoaDoDesenho => ({ id, sexo, data_nasc: nasc, paiId: paiId ?? null, maeId: maeId ?? null })
const ID = { avo: 1, avoa: 2, pai: 3, mae: 4, x: 5, y: 6, w1: 7, w2: 8, z: 9, n1: 10, n2: 11 }
const pessoas: PessoaDoDesenho[] = [
  P(ID.avo, "masculino", "1900-01-01"), P(ID.avoa, "feminino", "1902-01-01"),
  P(ID.pai, "masculino", "1930-01-01", ID.avo, ID.avoa), P(ID.mae, "feminino", "1932-01-01"), // mãe: SEM ascendentes
  P(ID.x, "masculino", "1960-01-01", ID.pai, ID.mae), P(ID.y, "feminino", "1965-01-01", ID.pai, ID.mae),
  P(ID.w1, "feminino", "1962-01-01"), P(ID.w2, "feminino", "1970-01-01"), P(ID.z, "masculino", "1963-01-01"), // cônjuges SEM ascendentes
  P(ID.n1, "feminino", "1990-01-01", ID.x, ID.w1), P(ID.n2, "masculino", "2001-01-01", ID.x, ID.w2),
]
const unioes: UniaoDoDesenho[] = [
  { id: 1, pessoa1Id: ID.avo, pessoa2Id: ID.avoa, data_inicio: "1925-01-01" },
  { id: 2, pessoa1Id: ID.pai, pessoa2Id: ID.mae, data_inicio: "1955-01-01" },
  { id: 3, pessoa1Id: ID.x, pessoa2Id: ID.w2, data_inicio: "1999-01-01" }, // o SEGUNDO casamento é o 1º registrado: a ordem vem da DATA, não do id
  { id: 4, pessoa1Id: ID.x, pessoa2Id: ID.w1, data_inicio: "1988-01-01" },
  { id: 5, pessoa1Id: ID.y, pessoa2Id: ID.z, data_inicio: "1990-01-01" },
]

const ret = (d: Disposicao, pos: Map<number, { x: number; y: number }>, id: number): Retangulo => ({ ...pos.get(id)!, w: TAM[d].largura, h: TAM[d].altura })
const u = (d: Disposicao, r: Retangulo) => (d === "retrato" ? r.x : r.y) // eixo transversal
const linha = (d: Disposicao, r: Retangulo) => (d === "retrato" ? r.y : r.x) // eixo da geração
const sobrepoe = (a: Retangulo, b: Retangulo) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

for (const d of ["retrato", "paisagem"] as Disposicao[]) {
  secao(`Exemplo — ${d}`)
  const r = desenharArvore(pessoas, unioes, { disposicao: d, ...TAM[d], principalId: ID.n1 })
  const R = (id: number) => ret(d, r.posicoes, id)
  const todos = pessoas.map((p) => ({ id: p.id, r: R(p.id) }))
  const f = FOLGAS[d]

  // 1) geração = linha
  const porGeracao = new Map<number, number[]>()
  for (const p of pessoas) { const g = r.geracao.get(p.id)!; if (!porGeracao.has(g)) porGeracao.set(g, []); porGeracao.get(g)!.push(p.id) }
  ok("toda pessoa da mesma geração fica na mesma altura (eixo da geração)", [...porGeracao.values()].every((ids) => new Set(ids.map((i) => Math.round(linha(d, R(i))))).size === 1))
  ok("4 gerações, na ordem certa: ancestral(0) → casal(1) → filhos e cônjuges(2) → netos(3)",
    r.geracao.get(ID.avo) === 0 && r.geracao.get(ID.avoa) === 0 && r.geracao.get(ID.pai) === 1 && r.geracao.get(ID.mae) === 1 &&
    [ID.x, ID.y, ID.w1, ID.w2, ID.z].every((i) => r.geracao.get(i) === 2) && r.geracao.get(ID.n1) === 3 && r.geracao.get(ID.n2) === 3)
  ok("cônjuge sem ascendente fica na geração do parceiro (mãe, w1, w2, z)", r.geracao.get(ID.mae) === r.geracao.get(ID.pai) && r.geracao.get(ID.w1) === r.geracao.get(ID.x) && r.geracao.get(ID.z) === r.geracao.get(ID.y))

  // 4) cônjuge colado ao parceiro, nada entre os dois
  const entre = (a: number, b: number) => {
    const lo = Math.min(u(d, R(a)), u(d, R(b))), hi = Math.max(u(d, R(a)), u(d, R(b)))
    return todos.filter((t) => t.id !== a && t.id !== b && Math.round(linha(d, t.r)) === Math.round(linha(d, R(a))) && u(d, t.r) > lo && u(d, t.r) < hi).length
  }
  const encostados = (a: number, b: number) => {
    const A_ = R(a), B_ = R(b)
    const lado = d === "retrato" ? Math.abs(A_.x - B_.x) - A_.w : Math.abs(A_.y - B_.y) - A_.h
    return Math.abs(lado - f.casal) < 0.5 && entre(a, b) === 0
  }
  ok("cada casal fica encostado (folga de casal, ninguém no meio): avós, pais, x+w1, x+w2, y+z", [[ID.avo, ID.avoa], [ID.pai, ID.mae], [ID.x, ID.w1], [ID.x, ID.w2], [ID.y, ID.z]].every(([a, b]) => encostados(a, b)))

  // 3) pivô no meio, ordem cronológica
  ok("pessoa com duas uniões fica no MEIO: 1º casamento (1988) de um lado, 2º (1999) do outro, em ordem cronológica", u(d, R(ID.w1)) < u(d, R(ID.x)) && u(d, R(ID.x)) < u(d, R(ID.w2)))

  // 5) filhos sob o casal certo, em ordem de nascimento; irmãos juntos
  const centroU = (id: number) => u(d, R(id)) + (d === "retrato" ? R(id).w : R(id).h) / 2
  const meio1 = (centroU(ID.w1) + centroU(ID.x)) / 2, meio2 = (centroU(ID.x) + centroU(ID.w2)) / 2
  ok("filho da 1ª união fica mais perto do ponto médio de x+w1; o da 2ª, de x+w2", Math.abs(centroU(ID.n1) - meio1) < Math.abs(centroU(ID.n1) - meio2) && Math.abs(centroU(ID.n2) - meio2) < Math.abs(centroU(ID.n2) - meio1))
  ok("filhos de uniões diferentes: o da 1ª união vem antes do da 2ª", centroU(ID.n1) < centroU(ID.n2))
  const medida = d === "retrato" ? TAM[d].largura : TAM[d].altura
  ok("os netos ficam perto do ponto médio do casal (desvio ≤ meio cartão)", Math.abs(centroU(ID.n1) - meio1) <= medida / 2 && Math.abs(centroU(ID.n2) - meio2) <= medida / 2, `${centroU(ID.n1) - meio1} / ${centroU(ID.n2) - meio2}`)
  ok("irmãos juntos, em ordem de nascimento: x (1960) antes de y (1965)", centroU(ID.x) < centroU(ID.y) && entre(ID.x, ID.y) === 2) // entre x e y só w2 e (… ) — ver abaixo
  const paisMeio = (centroU(ID.pai) + centroU(ID.mae)) / 2
  const irmaosMeio = (centroU(ID.x) + centroU(ID.y)) / 2
  ok("os irmãos (x, y) ficam centralizados sob o casal dos pais (desvio ≤ um cartão)", Math.abs(irmaosMeio - paisMeio) <= medida, `${irmaosMeio - paisMeio}`)

  // 6) nenhuma sobreposição
  let sobrepostos = 0
  for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) if (sobrepoe(todos[i].r, todos[j].r)) sobrepostos++
  ok("nenhum cartão sobre outro", sobrepostos === 0, `${sobrepostos} par(es)`)

  // 2) a linha de casamento sai dos lados que se tocam
  const lados = (a: number, b: number) => ladosDoCasal(R(a), R(b))
  const esperado = d === "retrato" ? { esq: "right", dir: "left" } : { esq: "bottom", dir: "top" }
  const esqDir = (a: number, b: number) => (u(d, R(a)) < u(d, R(b)) ? [a, b] : [b, a])
  const todosCasais = r.casais.every(({ a, b }) => { const [e, di] = esqDir(a, b); const l = lados(e, di); return l.a === esperado.esq && l.b === esperado.dir })
  ok(`linha de casamento: lado "${esperado.esq}" de quem vem antes e "${esperado.dir}" de quem vem depois, em TODOS os casais`, todosCasais && r.casais.length === 5)
  const trocados = { ...R(ID.w1), ...(d === "retrato" ? { x: R(ID.x).x + 500 } : { y: R(ID.x).y + 500 }) }
  const ldt = ladosDoCasal(R(ID.x), trocados)
  const ldo = ladosDoCasal(R(ID.x), R(ID.w1))
  ok("se o cônjuge é arrastado para o OUTRO lado, a linha troca de lado", ldt.a !== ldo.a && ldt.b !== ldo.b)
  const acima = { ...R(ID.x), y: R(ID.x).y - 400 }
  ok("e se vai para cima/baixo, a linha passa para os lados de cima/baixo", ladosDoCasal(R(ID.x), acima).a === "top" && ladosDoCasal(R(ID.x), { ...R(ID.x), y: R(ID.x).y + 400 }).a === "bottom")

}

// ─── Família do cônjuge e ramos colaterais ──────────────────────────────────
secao("Cônjuge COM ascendentes, irmão colateral, três casamentos")
for (const d of ["retrato", "paisagem"] as Disposicao[]) {
  const ps: PessoaDoDesenho[] = [
    P(1, "masculino", "1900-01-01"), P(2, "feminino", "1901-01-01"), // avós paternos
    P(3, "masculino", "1925-01-01"), P(4, "feminino", "1927-01-01"), // avós maternos (família do cônjuge) — pais de 6
    P(5, "masculino", "1950-01-01", 1, 2), P(6, "feminino", "1952-01-01", 3, 4), P(7, "feminino", "1955-01-01", 1, 2), // 7: irmã sem descendentes (colateral)
    P(8, "masculino", "1980-01-01", 5, 6), P(9, "feminino", "1982-01-01", 5, 6),
    P(10, "feminino", "1979-01-01"), P(11, "masculino", "1985-01-01"), P(12, "feminino", "1990-01-01"), // cônjuges de 8 (3 casamentos)
    P(13, "feminino", "2005-01-01", 8, 10), P(14, "masculino", "2010-01-01", 8, 11), P(15, "feminino", "2015-01-01", 8, 12),
  ]
  const us: UniaoDoDesenho[] = [
    { id: 1, pessoa1Id: 1, pessoa2Id: 2 }, { id: 2, pessoa1Id: 3, pessoa2Id: 4 }, { id: 3, pessoa1Id: 5, pessoa2Id: 6 },
    { id: 4, pessoa1Id: 8, pessoa2Id: 10, data_inicio: "2003-01-01" }, { id: 5, pessoa1Id: 8, pessoa2Id: 11, data_inicio: "2008-01-01" }, { id: 6, pessoa1Id: 8, pessoa2Id: 12, data_inicio: "2013-01-01" },
  ]
  const r = desenharArvore(ps, us, { disposicao: d, ...TAM[d], principalId: 13 })
  const rects = ps.map((p) => ({ id: p.id, r: ret(d, r.posicoes, p.id) }))
  let sob = 0
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (sobrepoe(rects[i].r, rects[j].r)) sob++
  ok(`${d}: nenhuma sobreposição`, sob === 0, `${sob}`)
  ok(`${d}: a família do cônjuge (3, 4) fica na MESMA linha dos avós paternos (1, 2)`, [3, 4, 2].every((i) => r.geracao.get(i) === r.geracao.get(1)))
  const L = (i: number) => u(d, ret(d, r.posicoes, i))
  ok(`${d}: pessoa 8 com TRÊS uniões fica no meio do 1º e do 2º, o 3º vem depois, em ordem cronológica`, L(10) < L(8) && L(8) < L(11) && L(11) < L(12))
  ok(`${d}: a irmã colateral (7) fica na linha dos irmãos (5), sem descendentes`, r.geracao.get(7) === r.geracao.get(5))
  const ger = new Map<number, Set<number>>()
  for (const p of ps) { const g = r.geracao.get(p.id)!; if (!ger.has(g)) ger.set(g, new Set()); ger.get(g)!.add(Math.round(d === "retrato" ? ret(d, r.posicoes, p.id).y : ret(d, r.posicoes, p.id).x)) }
  ok(`${d}: uma única altura por geração`, [...ger.values()].every((s) => s.size === 1))
}

// ─── Propriedades em árvores aleatórias ─────────────────────────────────────
secao("Propriedades em 300 árvores aleatórias (semente fixa)")
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
let ruim = ""
for (let t = 0; t < 300 && !ruim; t++) {
  const n = 5 + Math.floor(rnd() * 40)
  const ps: PessoaDoDesenho[] = []
  const us: UniaoDoDesenho[] = []
  for (let i = 1; i <= n; i++) {
    const sexo = rnd() < 0.5 ? "masculino" : "feminino"
    const pais: number[] = []
    if (i > 3 && rnd() < 0.8) {
      const a = 1 + Math.floor(rnd() * (i - 1)), b = rnd() < 0.7 ? 1 + Math.floor(rnd() * (i - 1)) : 0
      pais.push(a); if (b && b !== a) pais.push(b)
    }
    ps.push({ id: i, sexo, data_nasc: `${1900 + Math.floor(i * 1.5 + rnd() * 5)}-01-01`, paiId: pais[0] ?? null, maeId: pais[1] ?? null })
  }
  for (let k = 0; k < n / 2; k++) {
    const a = 1 + Math.floor(rnd() * n), b = 1 + Math.floor(rnd() * n)
    if (a !== b) us.push({ id: 100 + k, pessoa1Id: a, pessoa2Id: b, data_inicio: rnd() < 0.7 ? `${1930 + Math.floor(rnd() * 60)}-01-01` : null })
  }
  for (const d of ["retrato", "paisagem"] as Disposicao[]) {
    const r = desenharArvore(ps, us, { disposicao: d, ...TAM[d], principalId: 1 })
    const rs = ps.map((p) => ({ id: p.id, r: ret(d, r.posicoes, p.id) }))
    for (let i = 0; i < rs.length && !ruim; i++) for (let j = i + 1; j < rs.length; j++) if (sobrepoe(rs[i].r, rs[j].r)) { ruim = `árvore ${t} (${d}): ${rs[i].id} sobre ${rs[j].id}`; break }
    const alt = new Map<number, number>()
    for (const p of ps) {
      const g = r.geracao.get(p.id)!, v = Math.round(linha(d, ret(d, r.posicoes, p.id)))
      if (alt.has(g) && alt.get(g) !== v && !ruim) ruim = `árvore ${t} (${d}): geração ${g} em alturas diferentes`
      alt.set(g, v)
    }
    for (const c of r.clusters) {
      for (let i = 1; i < c.length && !ruim; i++) {
        const a = ret(d, r.posicoes, c[i - 1]), b = ret(d, r.posicoes, c[i])
        const gap = d === "retrato" ? b.x - (a.x + a.w) : b.y - (a.y + a.h)
        if (Math.abs(gap - FOLGAS[d].casal) > 0.5) ruim = `árvore ${t} (${d}): cluster ${c.join(",")} não está encostado (gap ${gap})`
      }
    }
  }
}
ok("300 árvores × 2 disposições: sem sobreposição, uma altura por geração, clusters (casais) encostados", !ruim, ruim)

// ─── Posições manuais (item 9) ──────────────────────────────────────────────
secao("Posições: o desenho automático é o padrão; arrastar cria ajuste manual explícito, por disposição, com reset e desfazer")
const tela = readFileSync("src/components/arvore/react-flow-tree.tsx", "utf8")
const view = readFileSync("src/components/arvore/arvore-genealogica-view.tsx", "utf8")
ok("o desenho vem do motor em camadas (desenharArvore), não mais do dagre", /desenharArvore\(/.test(tela) && !/dagre\.layout|new dagre/.test(tela))
ok("ajustes manuais ficam em chave PRÓPRIA por disposição (manual-paisagem / manual-retrato)", /const chaveManual = \(modo: ViewMode\): string => `manual-\$\{modo\}`/.test(tela))
ok("as chaves antigas (paisagem/retrato = retrato de TODOS os cartões) não mandam mais no desenho", !/savedPositionsRef\.current\?\.\[mode\]/.test(tela) && /savedPositionsRef\.current\?\.\[chaveManual\(mode\)\]/.test(tela))
ok("arrastar grava SÓ os cartões movidos — nunca um retrato de todos (sem getNodes().forEach gravando)", !/getNodes\(\)\.forEach\(n => \{\s*const m = n\.id\.match/.test(tela) && /persistirPosicoes\(mode, movidos\)/.test(tela))
ok("voltar ao ponto do desenho automático deixa de ser ajuste (a entrada some)", /delete doModo\[id\]/.test(tela))
ok("o ajuste manual é MARCADO na tela (contorno tracejado + aviso com contador)", /outline: '2px dashed #d97706'/.test(tela) && /aviso-ajustes-manuais/.test(tela))
ok("o reset é por ÁRVORE e só da disposição visível (apaga apenas manual-<modo>; nunca outras árvores nem a outra disposição)", /delete atuais\[chaveManual\(modoAlvo\)\]/.test(tela) && !/posicoesNodes: \{\}/.test(tela))
ok("o reset entra no Desfazer (onLayoutResetado → comandoResetarLayout)", /onLayoutResetado=\{aoResetarLayout\}/.test(view) && /comandoResetarLayout\(/.test(view))
const chamadas: string[] = []
const cmd = comandoResetarLayout("retrato", { "5": { x: 1, y: 2 } }, (m, p) => chamadas.push(`aplicar ${m} ${JSON.stringify(p)}`), (m) => chamadas.push(`resetar ${m}`))
const fim = () => {
  console.log(`\n${passou} ok, ${falhou} falha(s)`)
  if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
}
ok("a linha de casamento tem pontos de ligação nos 4 lados e acompanha o arrasto (ajustarLadosDeCasamento a cada movimento)", /id=\{`ms-\$\{lado\}`\}/.test(tela) && /id=\{`mt-\$\{lado\}`\}/.test(tela) && /ajustarLadosDeCasamento\(nodes, edges, mode\)/.test(tela))
ok("a filiação NÃO sai do meio do casal: é o fio de sempre, de baixo de cada genitor até o filho (sem aresta própria)", !/LinhaDeFiliacao|type: 'filiacao'|edgeTypes/.test(tela))
ok("a linha de casamento só existe para casal SEM filhos em comum", /temFilhosEmComum/.test(tela) && /filter\(\(\{ a, b \}\) => !temFilhosEmComum\(a, b\)\)/.test(tela))

void cmd.aplicar().then(() => cmd.desfazer()).then(() => {
  ok("desfazer devolve os ajustes que havia; refazer limpa de novo; não mexe em dado", chamadas.join("|") === 'resetar retrato|aplicar retrato {"5":{"x":1,"y":2}}' && cmd.afetaDados === false)
  fim()
})
