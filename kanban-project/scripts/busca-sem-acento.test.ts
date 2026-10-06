// scripts/busca-sem-acento.test.ts
// ============================================================================
// A BUSCA DO CABEÇALHO NÃO DEPENDE DE ACENTO NEM DE CAIXA — e o Kanban acompanha o que se digita.
//   node scripts/ci/gate-build.mjs --so busca-sem-acento      (banco de teste descartável)
// ("antao" tem que achar "Antão"; o Kanban mostra só os processos que a MESMA busca do menu acha; vazio = tudo volta.)
// ============================================================================
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { exigirBancoDeTeste } from './_banco-de-teste'
exigirBancoDeTeste('busca-sem-acento.test.ts')

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signAuthToken } from '../lib/auth-jwt'
import { GET } from '../src/app/api/home/search/route'
import { normalizarBusca, idsQueContem } from '../src/lib/busca-sem-acento'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }
const MARCA = 'BUSCAAC'

async function main() {
  console.log('\n1) normalização (pura)')
  ok('tira acento e caixa: "Antão" → "antao", "SÁNCHEZ" → "sanchez", "Müller-Çelik" → "muller-celik"', normalizarBusca('Antão') === 'antao' && normalizarBusca('SÁNCHEZ') === 'sanchez' && normalizarBusca('Müller-Çelik') === 'muller-celik')
  ok('texto sem acento passa igual; espaços das pontas saem', normalizarBusca('  Sanches ') === 'sanches' && normalizarBusca('ES-12') === 'es-12')

  const admin = await prisma.usuario.create({ data: { nome: `${MARCA} admin`, email: `${MARCA.toLowerCase()}@t.t`, senha: 'x', tipo: 'admin' }, select: { id: true, email: true, tipo: true } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const familia = await prisma.familia.create({ data: { nome: `${MARCA} Sánchez Ferreira` }, select: { id: true } })
  const p1 = await prisma.processo.create({ data: { nome: `${MARCA} Antão`, familiaId: familia.id }, select: { id: true } })
  const p2 = await prisma.processo.create({ data: { nome: `${MARCA} Outro Nome` }, select: { id: true } })
  const buscar = async (q: string, ids = false) => {
    const r = await GET(new NextRequest(`http://t/api/home/search?q=${encodeURIComponent(q)}${ids ? '&ids=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } }))
    return (await r.json()) as { resultados?: Array<{ tipo: string; processoId: number; label: string }>; processoIds?: number[] }
  }
  try {
    console.log('\n2) o menu: sem acento acha com acento (e o contrário)')
    ok('"buscaac antao" (sem til) acha o processo "Antão"', (await buscar(`${MARCA.toLowerCase()} antao`)).resultados?.some((r) => r.tipo === 'processo' && r.processoId === p1.id) === true)
    ok('"ANTÃO" (com til e em maiúsculas) também', (await buscar(`${MARCA} ANTÃO`)).resultados?.some((r) => r.processoId === p1.id) === true)
    ok('pedaço do nome: "buscaac ant"', (await buscar(`${MARCA} ant`)).resultados?.some((r) => r.processoId === p1.id) === true)
    ok('família com acento ("Sánchez") achada por "sanchez"', (await buscar('buscaac sanchez')).resultados?.some((r) => r.tipo === 'familia' && r.processoId === p1.id) === true)
    ok('e por "sánchez" (acento digitado)', (await buscar('buscaac sánchez')).resultados?.some((r) => r.tipo === 'familia') === true)
    ok('termo que não existe: nenhum resultado', ((await buscar('buscaac zzzz')).resultados ?? []).length === 0)
    ok('% e _ são letras, não curinga (nada de "tudo")', ((await buscar('%%')).resultados ?? []).length === 0 && ((await buscar('__')).resultados ?? []).length === 0)

    console.log('\n3) o Kanban: a mesma busca, todos os processos que casam')
    const ids = (await buscar(`${MARCA} antao`, true)).processoIds ?? []
    ok('?ids=1 devolve os processos que casam (sem o teto do menu) e só eles', ids.includes(p1.id) && !ids.includes(p2.id), ids.join(','))
    ok('pela família: o processo da família Sánchez entra', ((await buscar('buscaac sanchez', true)).processoIds ?? []).includes(p1.id))
    ok('busca com menos de 2 letras não devolve nada', ((await buscar('a', true)).processoIds ?? []).length === 0)
    ok('idsQueContem acha por nome sem acento (e respeita o limite)', (await idsQueContem('Processo', `${MARCA} antao`)).includes(p1.id) && (await idsQueContem('Processo', MARCA, 1)).length === 1)

    console.log('\n4) a tela')
    const rota = readFileSync('src/app/api/home/search/route.ts', 'utf8')
    ok('a rota não usa mais "contains insensitive" (que ignora só a caixa): as quatro buscas passam por idsQueContem', !/mode: "insensitive"/.test(rota) && ['Processo', 'Familia', 'Requerente', 'Contratante'].every((t) => rota.includes(`idsQueContem("${t}"`)))
    const header = readFileSync('src/components/header-bar.tsx', 'utf8'), kanban = readFileSync('src/app/kanban/kanban-content.tsx', 'utf8')
    ok('o cabeçalho avisa o Kanban a cada letra (e limpa quando a busca esvazia ou um resultado é aberto)', /onBuscaProcessos\?\.\(null\)/.test(header) && (header.match(/onBuscaProcessos\?\.\(null\)/g) ?? []).length >= 2 && /buscarProcessoIds\(query\)/.test(header))
    ok('o Kanban mostra só os processos da busca (e o contador e a Lista seguem junto)', /processosVisiveis = useMemo/.test(kanban) && /processos=\{processosDoTipo\}/.test(kanban) && /\{processosVisiveis\.length\}/.test(kanban) && /processos=\{processosVisiveis as any\}/.test(kanban) && /onBuscaProcessos=\{onBuscaProcessos\}/.test(kanban))
  } finally {
    await prisma.processo.deleteMany({ where: { id: { in: [p1.id, p2.id] } } }).catch(() => {})
    await prisma.familia.deleteMany({ where: { id: familia.id } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: admin.id } }).catch(() => {})
  }
  console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
  await prisma.$disconnect(); process.exit(falhou ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
