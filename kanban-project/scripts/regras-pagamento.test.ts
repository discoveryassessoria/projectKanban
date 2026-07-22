// scripts/regras-pagamento.test.ts
// GUARDA — regras de pagamento por natureza + encargos avançados + entrada composta.
// Cobre a lista de testes obrigatórios (#17). Puro.
import { validarParcelamentoPorNatureza, validarFormaEntrada, condicaoDisponivelNoProcesso } from '../lib/financeiro/regras-forma-natureza'
import { calcularEncargosAvancado } from '../lib/financeiro/encargos-avancados'
import { comporEntrada } from '../lib/financeiro/entrada-composta'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const permitido = (forma: string, n: number) => validarParcelamentoPorNatureza(forma, n) === null

sec('1 — parcelamento por natureza da forma')
{
  ok('PIX 1x permitido', permitido('PIX', 1))
  ok('PIX 2x bloqueado', !permitido('PIX', 2))
  ok('Transferência 1x permitida', permitido('TRANSFERENCIA', 1))
  ok('Transferência 2x bloqueada', !permitido('TRANSFERENCIA', 2))
  ok('Dinheiro/Wise/Débito só à vista', !permitido('DINHEIRO', 2) && !permitido('WISE', 2) && !permitido('CARTAO_DEBITO', 2))
  ok('Cartão 2x permitido', permitido('CARTAO_CREDITO', 2))
  ok('Cartão 12x permitido', permitido('CARTAO_CREDITO', 12))
  ok('Cartão 13x bloqueado', !permitido('CARTAO_CREDITO', 13) && validarParcelamentoPorNatureza('CARTAO_CREDITO', 13)?.codigo === 'PARCELAS_ACIMA_MAX')
  ok('Boleto 1x permitido', permitido('BOLETO', 1))
  ok('Boleto 12x permitido', permitido('BOLETO', 12))
  ok('Boleto 13x bloqueado', !permitido('BOLETO', 13))
}

sec('2 — entrada por natureza')
{
  ok('entrada via PIX permitida', validarFormaEntrada('PIX') === null)
  ok('entrada via transferência permitida', validarFormaEntrada('TRANSFERENCIA') === null)
  ok('entrada via cartão bloqueada', validarFormaEntrada('CARTAO_CREDITO')?.codigo === 'ENTRADA_FORMA_INVALIDA')
  ok('entrada via boleto bloqueada', validarFormaEntrada('BOLETO') !== null)
}

sec('3 — multa (após carência) e juros')
{
  const semAtraso = calcularEncargosAvancado(1000, 0, { multaPercent: 2, jurosPercent: 1, carenciaDias: 2 })
  ok('sem atraso → sem encargos', semAtraso.multa === 0 && semAtraso.juros === 0)
  const dentroCarencia = calcularEncargosAvancado(1000, 2, { multaPercent: 2, jurosPercent: 1, carenciaDias: 2 })
  ok('dentro da carência (2d, carência 2) → sem multa', dentroCarencia.multa === 0)
  // multa a partir do 3º dia = carência 2
  const apos3 = calcularEncargosAvancado(1000, 3, { multaPercent: 2, jurosPercent: 1, carenciaDias: 2 })
  ok('multa 2% após 3º dia', apos3.multa === 20 && apos3.diasEfetivos === 1)
  ok('juros 1%/mês pro-rata (1d)', apos3.juros === Math.round(1000 * (0.01 / 30) * 1 * 100) / 100)
  const j30 = calcularEncargosAvancado(1000, 30, { jurosPercent: 1, carenciaDias: 0 })
  ok('juros simples 30d ≈ 1%', Math.abs(j30.juros - 10) < 0.05)
  const jc = calcularEncargosAvancado(1000, 60, { jurosPercent: 1, jurosTipo: 'COMPOSTO', carenciaDias: 0 })
  const js = calcularEncargosAvancado(1000, 60, { jurosPercent: 1, jurosTipo: 'SIMPLES', carenciaDias: 0 })
  ok('juros compostos > simples no mesmo prazo', jc.juros > js.juros)
  const fixa = calcularEncargosAvancado(1000, 10, { multaTipo: 'FIXA', multaValor: 50, jurosPercent: 0, carenciaDias: 0 })
  ok('multa FIXA aplica valor', fixa.multa === 50)
}

sec('4 — entrada composta (entrada + saldo parcelado)')
{
  const r = comporEntrada({ valorTotal: 1000, entrada: { tipoForma: 'PIX', tipo: 'PERCENTUAL', valor: 20 }, saldo: { tipoForma: 'CARTAO_CREDITO', nParcelas: 6 } })
  ok('PIX 20% + saldo 6x cartão: ok', r.ok && r.valorEntrada === 200 && r.valorSaldo === 800)
  ok('soma das parcelas = total', Math.round(r.parcelas.reduce((s, p) => s + p.valor, 0) * 100) / 100 === 1000)
  ok('1ª parcela é a entrada (PIX)', r.parcelas[0].entrada && r.parcelas[0].tipoForma === 'PIX')
  ok('saldo nas 6 parcelas de cartão', r.parcelas.filter((p) => !p.entrada).length === 6 && r.parcelas[1].tipoForma === 'CARTAO_CREDITO')
  const bloq = comporEntrada({ valorTotal: 1000, entrada: { tipoForma: 'CARTAO_CREDITO', valor: 200, tipo: 'VALOR_FIXO' }, saldo: { tipoForma: 'BOLETO', nParcelas: 6 } })
  ok('entrada via cartão → bloqueada', !bloq.ok && bloq.erros.some((e) => e.codigo === 'ENTRADA_FORMA_INVALIDA'))
  const transf = comporEntrada({ valorTotal: 900, entrada: { tipoForma: 'TRANSFERENCIA', valor: 300, tipo: 'VALOR_FIXO' }, saldo: { tipoForma: 'BOLETO', nParcelas: 6 } })
  ok('transferência + 6 boletos: ok, soma = total', transf.ok && Math.round(transf.parcelas.reduce((s, p) => s + p.valor, 0) * 100) / 100 === 900)
}

sec('5 — condição disponível por processo (fallback geral)')
{
  ok('vazio = configuração geral (disponível)', condicaoDisponivelNoProcesso({}, { tipoProcesso: 'X' }) === null)
  ok('restrita a outro tipo → indisponível', condicaoDisponivelNoProcesso({ tiposProcesso: ['ITALIA'] }, { tipoProcesso: 'ALEMANHA' })?.codigo === 'CONDICAO_INDISPONIVEL')
  ok('restrita ao tipo do processo → disponível', condicaoDisponivelNoProcesso({ tiposProcesso: ['ALEMANHA'] }, { tipoProcesso: 'ALEMANHA' }) === null)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Regras de pagamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
