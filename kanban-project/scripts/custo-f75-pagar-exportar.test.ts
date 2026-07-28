// F7.5 — Paridade operacional da lista de Custos:
//  (1) pagamento de custo RICO (multi-forma + ajustes + comprovantes) pelo motor único,
//      provado no banco através do MESMO serviço que a tela orquestra;
//  (2) exportação CSV da lista (guarda estática: exporta o filtrado/ordenado, não a página);
//  (3) o detalhe compartilhado carrega o fornecedor (contraparte do custo).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'
import { carregarReceitaDetalhe } from '@/lib/financeiro/leitura/receita-detalhe'
import { criarFornecedor } from '@/src/services/fornecedor'
import { calcularRecebimento } from '@/lib/financeiro/dominio/calculo-recebimento'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const PROC = 16
const TS = Date.now()

async function main() {
  // ── fornecedor + custo ──
  const cnpj = `8${String(TS).slice(-13)}`.slice(0, 14)
  const forn = await criarFornecedor({ nome: `Cartório F75 ${TS}`, tipo: 'PJ', cpfCnpj: cnpj })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: 'CUSTO', valorContratado: 1000, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1,
    fornecedorId: forn!.id, observacoes: 'Custo pagamento rico',
  })

  // ── (3) detalhe compartilhado traz a contraparte certa ──
  const det = await carregarReceitaDetalhe(String(obrigacaoId))
  chk(det?.natureza === 'CUSTO', 'detalhe reconhece o lançamento como custo')
  chk(det?.fornecedorNome === `Cartório F75 ${TS}`, `detalhe carrega o fornecedor (${det?.fornecedorNome ?? '—'})`)

  // ── (1) pagamento RICO: 2 formas + ajustes, numa única operação ──
  const contas = await prisma.contaBancaria.findMany({ select: { id: true }, take: 1 }).catch(() => [] as { id: number }[])
  const formas = await prisma.formaPagamentoCadastro.findMany({ select: { id: true, name: true }, take: 2 }).catch(() => [] as { id: number; name: string }[])
  if (!formas.length || !contas.length) {
    // O banco de teste é criado por `prisma db push` (sem seed de cadastros): semeia o mínimo.
    if (!formas.length) formas.push(await prisma.formaPagamentoCadastro.create({ data: { name: 'PIX (teste)', type: 'PIX' }, select: { id: true, name: true } }))
    if (formas.length < 2) formas.push(await prisma.formaPagamentoCadastro.create({ data: { name: 'Transferência (teste)', type: 'TED' }, select: { id: true, name: true } }))
    if (!contas.length) contas.push(await prisma.contaBancaria.create({ data: { nome: 'Conta de teste' }, select: { id: true } }))
  }
  {
    const contaId = contas[0].id
    const f1 = formas[0].id, f2 = (formas[1] ?? formas[0]).id
    // saldo 1000, desconto 100 → devido 900; paga 600 + 300 = 900 → QUITADO
    const esperado = calcularRecebimento({ saldoSelecionado: 1000, linhas: [{ valor: 600 }, { valor: 300 }], desconto: 100 })
    chk(esperado.situacao === 'QUITADO' && esperado.saldoRestante === 0, 'cálculo (fonte única): 600+300 com 100 de desconto quita 1000')

    const r = await registrarPagamentoComposto({
      obrigacaoId,
      moeda: 'BRL',
      formas: [
        { formaPagamentoId: f1, formaLabel: 'Forma 1', valor: 600, contaId, dataRecebimento: new Date().toISOString().slice(0, 10) },
        { formaPagamentoId: f2, formaLabel: 'Forma 2', valor: 300, contaId, dataRecebimento: new Date().toISOString().slice(0, 10) },
      ] as any,
      pagador: { tipo: 'EMPRESA', pessoaId: null } as any,
      ajustes: { desconto: 100, juros: 0, multa: 0, acrescimo: 0, creditoUtilizado: 0 },
      aplicacao: { politica: 'MAIS_ANTIGA' } as any,
      comprovantes: [{ arquivoUrl: 'https://exemplo/comprovante.pdf', arquivoNome: 'comprovante.pdf', tamanho: 1234 }] as any,
      observacao: 'Pagamento de custo (teste F7.5)',
      saldoSelecionado: 1000,
      totais: { totalInformado: 900, saldoRestante: 0, excedente: 0 } as any,
      idempotencyKey: `f75-${obrigacaoId}`,
      criadoPorId: 1,
    } as any)
    chk(r.ok === true, `pagamento composto aceito (${r.erros?.[0] ?? 'ok'})`)
    chk(r.ocorrenciasCriadas >= 2, `duas formas viraram ocorrências no motor (${r.ocorrenciasCriadas})`)
    chk(Math.abs(r.totalRecebido - 900) < 0.01, `total pago registrado = 900 (${r.totalRecebido})`)

    const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { saldo: true, recebidoBruto: true } })
    chk(Number(proj?.saldo ?? -1) === 0, `Ledger quita o custo (saldo ${Number(proj?.saldo ?? -1)})`)
    chk(Number(proj?.recebidoBruto ?? 0) === 900, `Ledger registra 900 de PAGO — desconto abate a dívida mas NÃO é pagamento (${Number(proj?.recebidoBruto ?? 0)})`)

    // idempotência: repetir a MESMA requisição não duplica pagamento.
    // (com o custo já quitado, a revalidação de estado do backend ainda barra o desconto —
    //  o que importa é que nada foi lançado duas vezes)
    const r2 = await registrarPagamentoComposto({
      obrigacaoId, moeda: 'BRL',
      formas: [{ formaPagamentoId: f1, formaLabel: 'Forma 1', valor: 600, contaId }, { formaPagamentoId: f2, formaLabel: 'Forma 2', valor: 300, contaId }] as any,
      pagador: { tipo: 'EMPRESA', pessoaId: null } as any,
      ajustes: { desconto: 100 } as any, saldoSelecionado: 1000,
      idempotencyKey: `f75-${obrigacaoId}`, criadoPorId: 1,
    } as any)
    const projDepois = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { recebidoBruto: true, saldo: true } })
    chk(Number(projDepois?.recebidoBruto ?? 0) === Number(proj?.recebidoBruto ?? 0) && Number(projDepois?.saldo ?? -1) === 0,
      `repetir a requisição NÃO duplica o pagamento (pago ${Number(projDepois?.recebidoBruto ?? 0)}, saldo ${Number(projDepois?.saldo ?? -1)})`)
    chk(r2.ok === false, 'e o backend ainda revalida o estado atual (desconto acima do saldo é recusado)')

    // replay LIMPO: mesma chave, custo ainda em aberto → idempotente de verdade
    const { obrigacaoId: obr2 } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 500, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, fornecedorId: forn!.id, observacoes: 'Custo replay' })
    const chave = `f75-replay-${obr2}`
    const pag = () => registrarPagamentoComposto({ obrigacaoId: obr2, moeda: 'BRL', formas: [{ formaPagamentoId: f1, formaLabel: 'Forma 1', valor: 200, contaId }] as any, pagador: { tipo: 'EMPRESA', pessoaId: null } as any, saldoSelecionado: 500, idempotencyKey: chave, criadoPorId: 1 } as any)
    await pag(); const rep = await pag()
    const projRep = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: obr2 }, select: { recebidoBruto: true } })
    chk(rep.ok === true && Number(projRep?.recebidoBruto ?? 0) === 200, `replay com a MESMA chave é idempotente (pago ${Number(projRep?.recebidoBruto ?? 0)})`)

    const docs = await prisma.receitaDocumento.count({ where: { obrigacaoId } }).catch(() => 0)
    chk(docs >= 1, `comprovante anexado ao custo (${docs})`)
  }

  // ── (2) guardas da tela ──
  const shell = ler('src/components/financeiro/v3/ProcessoFinanceiroShell.tsx')
  chk(shell.includes('exportarCustosCsv'), 'CustosTab tem exportação CSV')
  chk(/exportarCustosCsv = \(\) => baixarCSV\(`custos-processo-\$\{processoId\}`, ordenados\.map/.test(shell),
    'a exportação usa a lista FILTRADA/ORDENADA (ordenados), não a página nem a base bruta')
  chk(shell.includes('<PagarCustoView'), 'CustosTab abre o pagamento rico de custo')
  chk(!/pagar && <RegistrarPagamentoModal/.test(shell), 'CustosTab não usa mais o modal simples para pagar custo')

  const pagar = ler('src/components/financeiro/v3/PagarCustoView.tsx')
  chk(pagar.includes('calcularRecebimento'), 'tela de pagamento usa a fonte única de cálculo (revalidada no backend)')
  chk(pagar.includes('idempotencyKey'), 'tela de pagamento envia chave de idempotência')
  chk(pagar.includes('"EMPRESA"'), 'num custo o pagador é a EMPRESA (nunca requerente)')
  chk(pagar.includes('Conta de origem'), 'conta é de ORIGEM (saída de caixa), não de destino')

  const detalhe = ler('src/components/financeiro/v3/ReceitaDetalheView.tsx')
  chk(detalhe.includes('<PagarCustoView'), 'Detalhe do custo abre o pagamento rico')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
