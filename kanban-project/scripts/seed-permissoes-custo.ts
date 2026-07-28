// HOMOLOGAÇÃO — SEED da matriz de permissões de CUSTO nos perfis existentes.
// ============================================================================
// Matriz homologada (28/07):
//   Administrador · Gerente → as 10 operações
//   Assistente             → criar, editar, arquivar (ORIGINA o custo; não decide
//                            nem movimenta dinheiro)
//   Estagiário             → nenhuma
//
// REGRAS DE SEGURANÇA:
//  • Toca SOMENTE as 10 chaves `financeiro.custo_*`. Qualquer outra permissão do perfil
//    é preservada byte a byte — "não alterar os demais perfis do sistema neste ciclo".
//  • Perfil fora da matriz não é tocado (nem criado, nem zerado).
//  • Idempotente: rodar duas vezes não muda nada na segunda vez.
//  • Em banco NÃO-local exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.
//  • `--dry-run` mostra o diff sem gravar.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { OPERACOES_CUSTO, CHAVE_CUSTO, type OperacaoCusto } from '@/lib/financeiro/permissoes-custo'

type Mapa = Record<string, boolean>

/** MATRIZ CANÔNICA — fonte única do seed e dos testes de autorização. */
export const MATRIZ_CUSTO: Record<string, OperacaoCusto[]> = {
  Administrador: [...OPERACOES_CUSTO],
  Gerente: [...OPERACOES_CUSTO],
  Assistente: ['criar', 'editar', 'arquivar'],
  'Estagiário': [],
}

/** Aplica a matriz sobre um mapa existente, mexendo SÓ nas chaves de custo. */
export function aplicarMatriz(atual: Mapa | null | undefined, permitidas: OperacaoCusto[]): Mapa {
  const saida: Mapa = { ...(atual ?? {}) }
  const set = new Set(permitidas)
  for (const op of OPERACOES_CUSTO) saida[CHAVE_CUSTO[op]] = set.has(op)
  return saida
}

/** Só as diferenças nas chaves de custo (para log honesto do que muda). */
export function diffCusto(antes: Mapa | null | undefined, depois: Mapa): string[] {
  const out: string[] = []
  for (const op of OPERACOES_CUSTO) {
    const k = CHAVE_CUSTO[op]
    const a = !!antes?.[k], d = !!depois[k]
    if (a !== d) out.push(`${op}: ${a ? 'sim' : 'não'} → ${d ? 'sim' : 'não'}`)
  }
  return out
}

async function main() {
  const dry = process.argv.includes('--dry-run')
  const url = process.env.PRISMA_DATABASE_URL ?? ''
  const local = /(127\.0\.0\.1|localhost)/.test(url)
  // Duas convenções de confirmação convivem no projeto: '1' (scripts de seed) e a
  // frase exigida pelo guard de migration. Ambas são a MESMA autorização humana
  // explícita, dada fora do código — aceitar as duas evita que o rollout de
  // produção tenha de reescrever a variável no meio do build.
  const confirmado = ['1', 'SIM, ESCREVER EM PRODUCAO'].includes(process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO ?? '')
  if (!local && !confirmado && !dry) {
    console.error("❌ Banco não-local: exija EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 (ou 'SIM, ESCREVER EM PRODUCAO'), ou rode com --dry-run.")
    process.exit(1)
  }
  console.log(`Seed de permissões de custo — ${local ? 'banco LOCAL' : 'banco REMOTO'}${dry ? ' (dry-run)' : ''}\n`)

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, permissoes: true } })
  let alterados = 0
  for (const perfil of perfis) {
    const permitidas = MATRIZ_CUSTO[perfil.nome.trim()]
    if (!permitidas) { console.log(`  ·  ${perfil.nome}: fora da matriz — NÃO tocado`); continue }
    const antes = (perfil.permissoes ?? {}) as Mapa
    const depois = aplicarMatriz(antes, permitidas)
    const mudou = diffCusto(antes, depois)
    if (!mudou.length) { console.log(`  =  ${perfil.nome}: já conforme`); continue }
    console.log(`  ${dry ? '~' : '↻'}  ${perfil.nome}: ${mudou.join(' · ')}`)
    if (!dry) await prisma.perfil.update({ where: { id: perfil.id }, data: { permissoes: depois } })
    alterados++
  }

  console.log(`\n${alterados} perfil(is) ${dry ? 'seriam alterados' : 'atualizados'}; ${perfis.length} analisado(s).`)
  await prisma.$disconnect()
}
if (require.main === module) main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
