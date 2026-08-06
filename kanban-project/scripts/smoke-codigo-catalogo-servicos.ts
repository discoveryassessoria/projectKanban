// scripts/smoke-codigo-catalogo-servicos.ts
//
// SMOKE — o que o Catálogo de Serviços vai RENDERIZAR em produção.
//
// Não conferimos a tabela: conferimos a projeção. A consulta é a MESMA da rota
// GET /api/gerenciamento/produtos-servicos e das rotas do mestre, e o resultado
// passa por `unificarCatalogo` — a função que a tela usa para montar as linhas.
// Assim o smoke prova a coluna Código, e não um campo do banco que a tela
// poderia estar ignorando.
//
// Somente leitura.

import { prisma } from '@/lib/prisma'
import { unificarCatalogo, filtrarCatalogo } from '@/lib/gerenciamento/catalogo-servicos'

async function main() {
  const [servicos, itens] = await Promise.all([
    prisma.servicoProduto.findMany({
      orderBy: { code: 'asc' },
      include: {
        itemCatalogo: {
          select: {
            id: true, natureza: true, unidade: true, categoriaId: true,
            categoria: { select: { id: true, nome: true } },
            _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
          },
        },
        paises: { select: { paisId: true }, orderBy: { criadoEm: 'asc' } },
      },
    }),
    prisma.itemCatalogo.findMany({
      include: { categoria: { select: { id: true, nome: true } }, _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } } },
    }),
  ])

  const linhas = unificarCatalogo({ servicos: servicos as never, itens: itens as never })
  const comercial = filtrarCatalogo(linhas, { escopo: 'comercial' })

  console.log('\nCATÁLOGO DE SERVIÇOS — o que a tela renderiza\n')
  console.log('  CÓDIGO   NOME')
  for (const l of comercial) console.log(`  ${(l.codigo ?? '—').padEnd(8)} ${l.nome}`)

  const semCodigo = comercial.filter((l) => !l.codigo)
  const codigos = comercial.map((l) => l.codigo)
  const duplicados = codigos.filter((c, i) => c && codigos.indexOf(c) !== i)
  const nomeComCodigo = comercial.filter((l) => /\bSRV[-_]/i.test(l.nome))
  const chaveVazando = comercial.filter((l) => /^SRV_/.test(String(l.codigo)))

  console.log('')
  const ok = (t: string, c: boolean) => console.log(`  ${c ? '✅' : '❌'} ${t}`)
  ok(`nenhum serviço comercializável sem código (${semCodigo.length} sem)`, semCodigo.length === 0)
  ok(`nenhum código repetido (${duplicados.length} repetidos)`, duplicados.length === 0)
  ok('todos no formato SRV-{n}', comercial.every((l) => /^SRV-\d+$/.test(String(l.codigo))))
  ok('nome não carrega o código (colunas separadas)', nomeComCodigo.length === 0)
  ok('a chave estrutural não vaza para a coluna Código', chaveVazando.length === 0)
  ok('a busca pelo código encontra o serviço', filtrarCatalogo(linhas, { escopo: 'todos', busca: String(comercial[0]?.codigo) }).length >= 1)

  const falhou = semCodigo.length > 0 || duplicados.length > 0 || nomeComCodigo.length > 0 || chaveVazando.length > 0
    || !comercial.every((l) => /^SRV-\d+$/.test(String(l.codigo)))
  console.log('')
  if (falhou) throw new Error('Smoke reprovado — há serviço sem código ou código malformado.')
  console.log(`OK: ${comercial.length} serviços, todos com código canônico.\n`)
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
