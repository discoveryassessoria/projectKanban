// scripts/taxa-identidade.test.ts
// GUARDA — Identidade + agrupamento das Taxas de Pagamento (PURO, sem banco):
// nome/código automáticos, perfil por forma, resumo agrupado da grade, chave de
// unicidade lógica, finalidade do boleto. Cobre a lista #9 do comando.
import {
  perfilForma, nomeTaxaAuto, resumoTaxa, chaveUnicidade, formaPrincipalId,
  finalidadeDoNome, calculoFinalidade, FINALIDADES_BOLETO,
} from '../lib/financeiro/taxa-identidade'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

sec('1 — perfil por forma (config-driven)')
{
  const cred = perfilForma('CARTAO_CREDITO')
  ok('crédito: grade + adquirente + bandeira', cred.calculo === 'GRADE' && cred.mostraGrade && cred.mostraAdquirente && cred.mostraBandeira && !cred.mostraFinalidade)
  const deb = perfilForma('CARTAO_DEBITO')
  ok('débito: taxa única + bandeira, sem grade', deb.calculo === 'PERCENTUAL' && !deb.mostraGrade && deb.mostraBandeira)
  const pix = perfilForma('PIX')
  ok('PIX: sem bandeira, sem grade, sem finalidade', !pix.mostraBandeira && !pix.mostraGrade && !pix.mostraFinalidade)
  const wise = perfilForma('WISE')
  ok('Wise: taxa única sem bandeira', wise.calculo === 'PERCENTUAL' && !wise.mostraBandeira)
  const bol = perfilForma('BOLETO')
  ok('Boleto: finalidade, sem bandeira/grade', bol.calculo === 'BOLETO' && bol.mostraFinalidade && !bol.mostraBandeira && !bol.mostraGrade)
}

sec('2 — nome automático (compatível com os registros já cadastrados)')
{
  ok('crédito Visa → "Cartão de Crédito — Visa"', nomeTaxaAuto({ formaType: 'CARTAO_CREDITO', formaNome: 'Cartão de Crédito', bandeiraNome: 'Visa' }) === 'Cartão de Crédito — Visa')
  ok('débito Elo → "Cartão de Débito — Elo"', nomeTaxaAuto({ formaType: 'CARTAO_DEBITO', formaNome: 'Cartão de Débito', bandeiraNome: 'Elo' }) === 'Cartão de Débito — Elo')
  ok('PIX → "PIX — Taxa"', nomeTaxaAuto({ formaType: 'PIX', formaNome: 'PIX' }) === 'PIX — Taxa')
  ok('Wise → "Wise — Taxa"', nomeTaxaAuto({ formaType: 'WISE', formaNome: 'Wise' }) === 'Wise — Taxa')
  ok('boleto emissão → "Boleto — Taxa de Emissão"', nomeTaxaAuto({ formaType: 'BOLETO', formaNome: 'Boleto', finalidade: 'EMISSAO' }) === 'Boleto — Taxa de Emissão')
  ok('boleto pagamento → "Boleto — Taxa de Pagamento"', nomeTaxaAuto({ formaType: 'BOLETO', formaNome: 'Boleto', finalidade: 'PAGAMENTO' }) === 'Boleto — Taxa de Pagamento')
  ok('bandeira ignorada quando a forma não usa (PIX + bandeira)', nomeTaxaAuto({ formaType: 'PIX', formaNome: 'PIX', bandeiraNome: 'Visa' }) === 'PIX — Taxa')
}

sec('3 — resumo agrupado da grade (12 linhas → 1 linha na lista)')
{
  const grade = [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60]
    .map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p, fixedFee: null }))
  const r = resumoTaxa({ feeType: 'percentage', parcelamento: grade })
  ok('grade: tipo GRADE, 12 linhas', r.tipoCalculo === 'GRADE' && r.nLinhas === 12)
  ok('grade: min 3,25% / max 11,60%', r.taxaMinPercent === 3.25 && r.taxaMaxPercent === 11.6)
  ok('grade: parcelas 1x–12x', r.parcelaMin === 1 && r.parcelaMax === 12)
  const diners = resumoTaxa({ parcelamento: [{ parcelasDe: 1, parcelasAte: 1, feePercent: 3.25, fixedFee: null }] })
  ok('Diners só 1x (não inventa 2x–12x)', diners.nLinhas === 1 && diners.parcelaMax === 1 && diners.taxaMaxPercent === 3.25)
  const deb = resumoTaxa({ feeType: 'percentage', feePercent: 0.86 })
  ok('débito: percentual único 0,86%', deb.tipoCalculo === 'PERCENTUAL' && deb.taxaMinPercent === 0.86 && deb.nLinhas === 0)
  const fixo = resumoTaxa({ feeType: 'fixed', feePercent: 0, fixedFee: 5 })
  ok('boleto: valor fixo R$5', fixo.tipoCalculo === 'FIXO' && fixo.valorFixo === 5)
  const pix = resumoTaxa({ feeType: 'percentage', feePercent: 0 })
  ok('PIX 0%: percentual (não vira fixo)', pix.tipoCalculo === 'PERCENTUAL' && pix.taxaMinPercent === 0)
}

sec('4 — unicidade lógica (bloqueio de duplicidade)')
{
  const visa = { formaId: 30, adquirenteId: null, bandeiraId: 1, finalidade: null, vigenciaInicio: '2026-07-01' }
  const master = { ...visa, bandeiraId: 2 }
  ok('Visa e Mastercard têm chaves diferentes', chaveUnicidade(visa) !== chaveUnicidade(master))
  ok('mesma combinação → mesma chave (duplicata)', chaveUnicidade(visa) === chaveUnicidade({ ...visa }))
  // VALIDADE É ESTADO, NÃO DATA: a mesma combinação é a MESMA taxa, sem "nova
  // versão por data de início". Antes, duas taxas idênticas conviviam como
  // duplicata legítima só por começarem em dias diferentes.
  const emiss = { formaId: 40, adquirenteId: null, bandeiraId: null, finalidade: 'EMISSAO' }
  const pagto = { ...emiss, finalidade: 'PAGAMENTO' }
  ok('boleto emissão ≠ pagamento (encargos separados)', chaveUnicidade(emiss) !== chaveUnicidade(pagto))
}

sec('5 — finalidade do boleto')
{
  ok('deriva EMISSAO do nome', finalidadeDoNome('Boleto — Taxa de Emissão') === 'EMISSAO')
  ok('deriva PAGAMENTO do nome', finalidadeDoNome('Boleto — Taxa de Pagamento') === 'PAGAMENTO')
  ok('não-boleto → null', finalidadeDoNome('Cartão de Crédito — Visa') === null)
  ok('emissão/pagamento = valor FIXO', calculoFinalidade('EMISSAO') === 'FIXO' && calculoFinalidade('PAGAMENTO') === 'FIXO')
  ok('multa/juros = PERCENTUAL', calculoFinalidade('MULTA') === 'PERCENTUAL' && calculoFinalidade('JUROS') === 'PERCENTUAL')
  ok('4 finalidades canônicas', FINALIDADES_BOLETO.length === 4)
}

sec('6 — forma principal (agrupamento)')
{
  ok('usa 1ª de formasAplicaveis', formaPrincipalId({ formasAplicaveis: [30, 31], formaPagamentoId: null }) === 30)
  ok('cai para a legada quando vazio', formaPrincipalId({ formasAplicaveis: [], formaPagamentoId: 40 }) === 40)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxa identidade/agrupamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
