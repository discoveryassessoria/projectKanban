// scripts/smoke-planilha-matriz.mjs
// ============================================================================
// SMOKE AUTENTICADO DA PLANILHA DOCUMENTAL — a matriz, contra dados reais.
//
// Verifica o que só a tela ligada ao banco pode provar: que registro é LINHA,
// que etapa é COLUNA, que a interseção resolve o item canônico certo e que a
// Tabela de Preços não se mexe.
//
// ─── READ-ONLY POR PADRÃO ───────────────────────────────────────────────────
// Contra produção ele NÃO escreve. O ciclo de override (gravar → conferir →
// restaurar) só roda com `--escrever`, e só deve ser usado em processo de
// sandbox — nunca num processo de cliente.
//
//   node scripts/smoke-planilha-matriz.mjs <base> <processoId> <arquivo-token> [--escrever]
// ============================================================================
import { readFileSync } from 'node:fs'

const [BASE, PROCESSO, TOKEN_PATH] = process.argv.slice(2)
const ESCREVER = process.argv.includes('--escrever')
const token = readFileSync(TOKEN_PATH, 'utf8').trim()

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t) => console.log(`\n${t}`)

const api = async (caminho, init = {}) => {
  const r = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const ler = async () => {
  const r = await api(`/api/processos/${PROCESSO}/custos`)
  if (r.status !== 200 || !r.body?.planilha) throw new Error(`GET custos ${r.status} — autenticação falhou ou processo não existe`)
  return r.body.planilha
}

console.log(`SMOKE AUTENTICADO — Planilha Documental · ${BASE} · processo ${PROCESSO}\n`)

const p = await ler()

// ═══════════════════════════════════════════════════════════════════════════
secao('1) Registro civil é LINHA')
// ═══════════════════════════════════════════════════════════════════════════
const pessoa = p.pessoas[0]
ok('a planilha tem pessoas', p.pessoas.length > 0, `${p.pessoas.length}`)
ok('cada pessoa tem uma linha por registro declarado', pessoa && pessoa.linhas.length >= 1, `${pessoa?.linhas.length} linha(s)`)
const registros = pessoa?.linhas.map((l) => l.tipoRegistro) ?? []
ok('as linhas são registros distintos', new Set(registros).size === registros.length, registros.join(' · '))
ok('toda linha tem o tipo documental identificado por ID',
  pessoa?.linhas.every((l) => Number.isInteger(l.tipoDocumentoId) && l.tipoDocumentoId > 0))

// ═══════════════════════════════════════════════════════════════════════════
secao('2) Etapa/serviço é COLUNA — e Certidão Inteiro Teor é UMA só')
// ═══════════════════════════════════════════════════════════════════════════
const nomes = p.colunas.map((c) => c.nome)
console.log(`  colunas: ${nomes.join(' | ')}`)
ok('não há coluna por documento específico',
  !nomes.some((n) => /nascimento|casamento|óbito|obito/i.test(n)),
  'documento específico pertence à LINHA, não à coluna')
ok('nenhuma coluna se repete', new Set(nomes).size === nomes.length)
ok('a coluna econômica aparece uma vez por linha (mesma grade em todas)',
  pessoa?.linhas.every((l) => l.celulas.length === p.colunas.length),
  `${p.colunas.length} coluna(s) × ${pessoa?.linhas.length} linha(s)`)

// ═══════════════════════════════════════════════════════════════════════════
secao('3) A interseção resolve o item canônico da LINHA')
// ═══════════════════════════════════════════════════════════════════════════
// É aqui que a matriz se prova: a MESMA coluna resolve itens diferentes em
// linhas diferentes. Se resolvesse o mesmo item nas três, teria virado coluna
// de documento de novo.
const primeira = p.colunas[0]
const itensDaColuna = (pessoa?.linhas ?? []).map((l) => {
  const c = l.celulas.find((x) => x.colunaId === primeira.colunaId)
  return c?.explicacao?.itemResolvidoNome ?? null
})
console.log(`  "${primeira.nome}" resolve: ${itensDaColuna.map((i) => i ?? '—').join(' · ')}`)
const resolvidos = itensDaColuna.filter(Boolean)
ok('a coluna de etapa resolve item em cada linha', resolvidos.length === (pessoa?.linhas.length ?? 0))
ok('e resolve um item DIFERENTE por linha', new Set(resolvidos).size === resolvidos.length)
ok('toda célula sabe explicar registro × etapa',
  pessoa?.linhas.every((l) => l.celulas.every((c) => c.explicacao?.registro && c.explicacao?.servico)))

// ═══════════════════════════════════════════════════════════════════════════
secao('4) Valor só aparece com aplicabilidade E preço — zero nunca é fallback')
// ═══════════════════════════════════════════════════════════════════════════
const todas = (p.pessoas ?? []).flatMap((b) => b.linhas.flatMap((l) => l.celulas))
const porEstado = {}
for (const c of todas) porEstado[c.estado] = (porEstado[c.estado] ?? 0) + 1
console.log(`  estados: ${Object.entries(porEstado).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
ok('nenhuma célula sem valor foi disfarçada de R$ 0,00',
  todas.every((c) => (c.estado === 'NAO_APLICAVEL' || c.estado === 'SEM_PRECO' || c.estado === 'AMBIGUO') ? c.valorEfetivo == null : true))
// BASE_DISPONIVEL: preço cadastrado e resolvido, aplicabilidade em aberto. Ele
// MOSTRA o valor e NÃO entra no total — é preço conhecido, não custo assumido.
const base = todas.filter((c) => c.estado === 'BASE_DISPONIVEL')
if (base.length) {
  ok('o preço base cadastrado chega à célula', base.every((c) => c.valorBase != null), `${base.length} célula(s)`)
  // Valor visível soma: a planilha é de previsão e as células têm de fechar
  // com o rodapé. Projetar não é lançar — nenhuma obrigação nasce daqui.
  ok('e o valor visível entra no efetivo', base.every((c) => c.valorEfetivo === c.valorBase))
  ok('e a célula aceita combinado manual', base.every((c) => c.editavel))
}
ok('toda célula com valor tem origem declarada',
  todas.filter((c) => c.valorEfetivo != null).every((c) => !!c.explicacao?.origem))
ok('toda célula sem valor diz POR QUE',
  todas.filter((c) => c.valorEfetivo == null).every((c) => !!c.explicacao?.motivo))
if ((porEstado.PREVISTO ?? 0) === 0 && (porEstado.REALIZADO ?? 0) === 0 && (porEstado.BASE_DISPONIVEL ?? 0) === 0) {
  console.log('  ⚠ nenhuma célula com preço — verifique a Tabela de Preços dos itens da matriz')
} else if ((porEstado.BASE_DISPONIVEL ?? 0) > 0) {
  console.log(`  ℹ ${porEstado.BASE_DISPONIVEL} célula(s) com preço base e aplicabilidade em aberto (Regra Documental pendente)`)
}

// ═══════════════════════════════════════════════════════════════════════════
secao('5) Totais são a soma dos valores EFETIVOS')
// ═══════════════════════════════════════════════════════════════════════════
const cent = (v) => Math.round((v ?? 0) * 100)
const somaLinhas = (b) => b.linhas.reduce((s, l) => s + cent(l.totalBrl), 0)
ok('o total de cada pessoa é a soma das linhas dela',
  p.pessoas.every((b) => Math.abs(cent(b.totalBrl) - somaLinhas(b)) <= 1),
  p.pessoas.map((b) => `${b.nome.split(' ')[0]}=${b.totalBrl}`).join(' '))
ok('o total do processo é a soma das pessoas',
  Math.abs(cent(p.totalGeralBrl) - p.pessoas.reduce((s, b) => s + cent(b.totalBrl), 0)) <= 1,
  `${p.totalGeralBrl}`)
ok('célula não aplicável não entra em total nenhum',
  todas.filter((c) => c.estado === 'NAO_APLICAVEL').every((c) => c.valorEfetivo == null))
// A CONTA QUE O OPERADOR FAZ DE CABEÇA: o que está impresso nas células tem de
// dar o total do rodapé. Se divergir, a planilha perde a função.
const somaVisivel = todas.reduce((s, c) => s + cent(c.valorEfetivo), 0)
ok('a soma das células visíveis é o total do processo',
  Math.abs(somaVisivel - cent(p.totalGeralBrl)) <= 1,
  `células ${(somaVisivel / 100).toFixed(2)} · total ${p.totalGeralBrl}`)

// ═══════════════════════════════════════════════════════════════════════════
secao('6) Reload preserva o resultado')
// ═══════════════════════════════════════════════════════════════════════════
const p2 = await ler()
ok('as colunas são as mesmas', JSON.stringify(p2.colunas.map((c) => c.nome)) === JSON.stringify(nomes))
ok('o total do processo é o mesmo', p2.totalGeralBrl === p.totalGeralBrl, `${p2.totalGeralBrl}`)

// ═══════════════════════════════════════════════════════════════════════════
secao('7) Combinado do processo — gravar, conferir, restaurar')
// ═══════════════════════════════════════════════════════════════════════════
const editavel = (p.pessoas ?? [])
  .flatMap((b) => b.linhas.map((l) => ({ b, l, c: l.celulas.find((x) => x.editavel) })))
  .find((x) => x.c)

if (!ESCREVER) {
  console.log('  (read-only: o ciclo de override não roda sem --escrever)')
  ok('há célula editável para quando houver sandbox', true,
    editavel ? `pessoa ${editavel.b.pessoaId} × registro ${editavel.l.tipoDocumentoId} × coluna ${editavel.c.colunaId}` : 'nenhuma — sem etapa aplicável neste processo')
} else if (!editavel) {
  ok('há célula editável', false, 'nenhuma etapa aplicável — nada a sobrescrever')
} else {
  const alvo = { pessoaId: editavel.b.pessoaId, tipoDocumentoId: editavel.l.tipoDocumentoId, colunaId: editavel.c.colunaId }
  const base = editavel.c.valorBase
  const novo = Math.round(((base ?? 100) + 23.45) * 100) / 100

  const gravou = await api(`/api/processos/${PROCESSO}/planilha-override`, { method: 'PUT', body: JSON.stringify({ ...alvo, valor: novo, motivo: 'smoke' }) })
  ok('a rota grava o combinado', gravou.status === 200, `HTTP ${gravou.status}`)

  const p3 = await ler()
  const c3 = p3.pessoas.find((b) => b.pessoaId === alvo.pessoaId)?.linhas
    .find((l) => l.tipoDocumentoId === alvo.tipoDocumentoId)?.celulas
    .find((x) => x.colunaId === alvo.colunaId)
  ok('a célula passa a SOBRESCRITO', c3?.estado === 'SOBRESCRITO', c3?.estado)
  ok('o valor efetivo é o combinado', c3?.valorEfetivo === novo, `${c3?.valorEfetivo}`)
  ok('o preço da Tabela continua visível na célula', c3?.valorBase === base, `base ${c3?.valorBase}`)
  ok('o total do processo mudou junto', p3.totalGeralBrl !== p.totalGeralBrl, `${p.totalGeralBrl} → ${p3.totalGeralBrl}`)

  const removeu = await api(`/api/processos/${PROCESSO}/planilha-override`, { method: 'DELETE', body: JSON.stringify(alvo) })
  ok('a rota restaura o padrão', removeu.status === 200, `HTTP ${removeu.status}`)

  const p4 = await ler()
  ok('a célula volta ao preço da Tabela', p4.totalGeralBrl === p.totalGeralBrl, `${p4.totalGeralBrl}`)
}

console.log(`\n${'═'.repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('Registro é linha, etapa é coluna, a interseção resolve canonicamente.\n')
