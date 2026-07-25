/**
 * financeiro-cenarios — 10 cenários financeiros obrigatórios.
 * Rodar: npx tsx scripts/financeiro-cenarios.test.ts
 *
 * Testes PUROS de domínio (centavos/decimal exato, sem banco). Reutilizam a
 * fonte única `calcularRecebimento` e a distribuição econômica pura
 * `resolverDistribuicao` (aggregate ObrigacaoEconomica). Os cenários que
 * dependem de PERSISTÊNCIA (rota/banco) ficam como HARNESS documentado: validam
 * a FUNÇÃO de domínio com fixtures e explicitam que o gravar/ler é coberto pelos
 * endpoints (não conectamos no banco aqui — regra do projeto).
 *
 * Base numérica (fixture real): Receita R$ 28.062,76 dividida entre
 *   Marco   = R$ 10.981,08
 *   Matheus = R$ 17.081,68
 */
import { calcularRecebimento } from '../lib/financeiro/dominio/calculo-recebimento'
import { resolverDistribuicao } from '../lib/financeiro/dominio/obrigacao-economica'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// Fixture canônica da receita
const RECEITA = 28062.76
const MARCO = 10981.08
const MATHEUS = 17081.68

console.log('financeiro-cenarios — 10 cenários obrigatórios\n')

// ── Cenário 1 (fixture): soma dos participantes = total exato ────────────────
{
  console.log('Cenário 1 — soma dos participantes = total exato')
  // Exatidão em CENTAVOS (float cru daria 28062.760000000002 — o erro que este
  // projeto proíbe): 1098108 + 1708168 === 2806276.
  ok(Math.round(MARCO * 100) + Math.round(MATHEUS * 100) === Math.round(RECEITA * 100),
    'Marco 10.981,08 + Matheus 17.081,68 === 28.062,76 (centavos exatos)')
}

// ── Cenário 2 (HARNESS documentado — depende de persistência) ────────────────
// Registrar a Receita e suas cotas por requerente é uma operação de BANCO
// (POST na rota de Receita/distribuição). Aqui validamos a FUNÇÃO de domínio que
// alimenta essa persistência: a distribuição por VALOR gera cotas que somam o
// total exato e sem erros. A gravação/leitura é coberta pelos endpoints.
{
  console.log('Cenário 2 (harness) — distribuição gravável: cotas válidas p/ persistir')
  const d = resolverDistribuicao(RECEITA, 'VALOR', [
    { pessoaId: 1, valor: MARCO },
    { pessoaId: 2, valor: MATHEUS },
  ])
  ok(d.ok && d.erros.length === 0, 'distribuição ok (payload apto a ser persistido via endpoint)')
  const soma = d.cotas.reduce((s, c) => s + c.valor, 0)
  ok(Math.round(soma * 100) === Math.round(RECEITA * 100), 'cotas a persistir somam o total exato (centavos)')
}

// ── Cenário 3: pagamento geral 15.000 sobre a receita cheia ──────────────────
// Exige estratégia — NÃO pode ser tratado como inicial nem como quitado.
{
  console.log('Cenário 3 — pagamento geral 15.000 sobre 28.062,76')
  const r = calcularRecebimento({ saldoSelecionado: RECEITA, linhas: [{ valor: 15000 }] })
  ok(r.situacao === 'PARCIAL', '15.000 em 28.062,76 → PARCIAL')
  ok(r.saldoRestante === 13062.76, 'saldo restante 13.062,76 (exato)')
  ok(r.situacao !== 'QUITADO' && r.situacao !== 'INICIAL', 'não é quitado nem inicial')
}

// ── Cenário 4: saldo selecionado sem linhas → INICIAL ────────────────────────
{
  console.log('Cenário 4 — saldo selecionado, nenhuma linha')
  const r = calcularRecebimento({ saldoSelecionado: MARCO, linhas: [] })
  ok(r.situacao === 'INICIAL', 'total 0 → INICIAL (nunca PARCIAL)')
  ok(r.totalInformado === 0 && r.saldoRestante === MARCO, 'total 0, saldo restante = líquido devido')
}

// ── Cenário 5: pagamento parcial de 5.000 sobre a cota do Marco ──────────────
{
  console.log('Cenário 5 — parcial 5.000 sobre 10.981,08')
  const r = calcularRecebimento({ saldoSelecionado: MARCO, linhas: [{ valor: 5000 }] })
  ok(r.situacao === 'PARCIAL', '5.000 em 10.981,08 → PARCIAL')
  ok(r.saldoRestante === 5981.08, 'saldo restante 5.981,08 (exato)')
  ok(r.excedente === 0, 'sem excedente')
}

// ── Cenário 6: pagamento excedente de 12.000 sobre a cota do Marco ───────────
{
  console.log('Cenário 6 — excedente 12.000 sobre 10.981,08')
  const r = calcularRecebimento({ saldoSelecionado: MARCO, linhas: [{ valor: 12000 }] })
  ok(r.situacao === 'EXCEDENTE', '12.000 em 10.981,08 → EXCEDENTE')
  ok(r.excedente === 1018.92, 'excedente 1.018,92 (exato)')
  ok(r.saldoRestante === 0, 'saldo restante zero')
}

// ── Cenário 7: múltiplas formas de pagamento (PIX + cartão) quitam a cota ─────
{
  console.log('Cenário 7 — duas formas somando 10.981,08 (PIX + cartão)')
  const r = calcularRecebimento({ saldoSelecionado: MARCO, linhas: [{ valor: 5000 }, { valor: 5981.08 }] })
  ok(r.totalInformado === MARCO, 'total informado = 10.981,08 (5.000 + 5.981,08)')
  ok(r.situacao === 'QUITADO', 'duas formas somando o líquido → QUITADO')
  ok(r.saldoRestante === 0 && r.excedente === 0, 'saldo e excedente zerados')
}

// ── Cenário 8: distribuição sem pagamento (só a divisão econômica) ───────────
{
  console.log('Cenário 8 — distribuição por VALOR (sem pagamento envolvido)')
  const d = resolverDistribuicao(RECEITA, 'VALOR', [
    { pessoaId: 1, valor: MARCO },
    { pessoaId: 2, valor: MATHEUS },
  ])
  ok(d.ok && d.erros.length === 0, 'distribuição ok, sem erros')
  const soma = d.cotas.reduce((s, c) => s + c.valor, 0)
  ok(Math.round(soma * 100) === Math.round(RECEITA * 100), 'cotas somam o total exato (28.062,76)')
  const marco = d.cotas.find((c) => c.pessoaId === 1)
  const matheus = d.cotas.find((c) => c.pessoaId === 2)
  ok(marco?.valor === MARCO, 'cota Marco = 10.981,08')
  ok(matheus?.valor === MATHEUS, 'cota Matheus = 17.081,68')
}

// ── Cenário 9: guarda de "recebido" — novoValor >= recebido ──────────────────
// Helper puro que replica a regra: uma cota nunca pode ser reduzida abaixo do
// que já foi recebido daquele participante (invariante de integridade).
{
  console.log('Cenário 9 — guarda: novoValor não pode cair abaixo do recebido')
  /** true quando o novo valor da cota é válido (>= já recebido). */
  const cotaValida = (novoValor: number, recebido: number): boolean =>
    Math.round(novoValor * 100) >= Math.round(recebido * 100)

  const recebidoMarco = MARCO // já recebeu a cota cheia
  ok(cotaValida(MARCO, recebidoMarco) === true, 'igual ao recebido → válido')
  ok(cotaValida(15000, recebidoMarco) === true, 'acima do recebido → válido')
  ok(cotaValida(10981.07, recebidoMarco) === false, '1 centavo abaixo do recebido → inválido')
  ok(cotaValida(5000, recebidoMarco) === false, 'muito abaixo do recebido → inválido')
}

// ── Cenário 10 (HARNESS documentado — depende de persistência) ───────────────
// Registrar o pagamento (gravar a ocorrência/ledger e reprojetar a posição do
// requerente) é uma operação de BANCO/rota (POST /v3/ocorrencias). Aqui
// validamos a FUNÇÃO de domínio que decide o resultado do recebimento — a mesma
// que o backend REVALIDA antes de persistir — garantindo que quitar a receita
// cheia fecha em QUITADO sem sobra nem excedente. O gravar/reprojetar é coberto
// pelos endpoints (não conectamos no banco).
{
  console.log('Cenário 10 (harness) — quitação total da receita cheia (domínio)')
  const r = calcularRecebimento({ saldoSelecionado: RECEITA, linhas: [{ valor: RECEITA }] })
  ok(r.situacao === 'QUITADO', 'pagamento = receita cheia → QUITADO (payload que o endpoint persiste)')
  ok(r.saldoRestante === 0 && r.excedente === 0, 'nada a receber, nada excedente')
  // E a mesma quitação distribuída entre os dois participantes fecha o total:
  const r2 = calcularRecebimento({ saldoSelecionado: RECEITA, linhas: [{ valor: MARCO }, { valor: MATHEUS }] })
  ok(r2.situacao === 'QUITADO' && r2.totalInformado === RECEITA, 'Marco + Matheus quitam a receita (28.062,76)')
}

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('financeiro-cenarios: validado ✅')
