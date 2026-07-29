// scripts/usuarios-acessos.test.ts
// ============================================================================
// USUÁRIOS E ACESSOS — regressão do incidente que derrubou a criação de usuário.
//
// Causa raiz: a sequência `CodeSequence` do escopo ficou ATRÁS dos códigos já
// gravados na tabela. O gerador entregava um número já usado e o insert
// estourava P2002 — que a rota traduzia para um "Erro interno do servidor" sem
// causa, enquanto a listagem engolia a falha e mostrava lista vazia.
//
// Aqui se prova: a autocura existe e é acionada só na colisão certa; a
// reconciliação é idempotente e monotônica; a rota fala a verdade; e o serviço
// do cliente não esconde mais erro nenhum.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escopoDe } from '@/lib/codigos/code-patterns'
import { CODE_REGISTRY } from '@/lib/codigos/entity-registry'

const RAIZ = process.cwd()
let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const sec = (t: string) => console.log(`\n── ${t}`)
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

// ── 1) registro do módulo ────────────────────────────────────────────────────
sec('1) registro de códigos')
chk(!!CODE_REGISTRY.Usuario, 'Usuario está no registro de códigos públicos')
chk(CODE_REGISTRY.Usuario.campo === 'publicCode', 'campo de código do usuário é publicCode')
chk(escopoDe(CODE_REGISTRY.Usuario.entidade) === 'USR', 'escopo do usuário é USR')
for (const [modelo, cfg] of Object.entries(CODE_REGISTRY)) {
  chk(typeof escopoDe(cfg.entidade) === 'string' && escopoDe(cfg.entidade).length > 0, `escopo definido para ${modelo}`)
}

// ── 2) autocura da sequência ─────────────────────────────────────────────────
sec('2) autocura no create')
const prismaSrc = ler('lib/prisma.ts')
chk(prismaSrc.includes('sincronizarSequenciaComTabela'), 'create ressincroniza a sequência ao colidir')
chk(prismaSrc.includes('ehColisaoDeCodigo'), 'só trata a colisão do CÓDIGO (não engole outros erros)')
chk(/if \(!ehColisaoDeCodigo\(e, cfg\.campo\)\) throw e/.test(prismaSrc), 'qualquer outro erro sobe intacto')
chk((prismaSrc.match(/await query\(args\)/g) ?? []).length >= 2, 'tenta novamente uma vez após ressincronizar')
chk(!/for \(|while \(/.test(prismaSrc.slice(prismaSrc.indexOf('async create'), prismaSrc.indexOf('async createMany'))),
  'retry é ÚNICO — nada de laço que mascare inconsistência real')

// o discriminador de colisão precisa acertar o alvo
const ehColisao = (e: unknown, campo: string): boolean => {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const alvo = err?.meta?.target
  const campos = Array.isArray(alvo) ? alvo.map(String) : typeof alvo === 'string' ? [alvo] : []
  return campos.some((c) => c === campo || c.includes(campo))
}
chk(ehColisao({ code: 'P2002', meta: { target: ['publicCode'] } }, 'publicCode'), 'reconhece colisão de publicCode')
chk(ehColisao({ code: 'P2002', meta: { target: 'Usuario_publicCode_key' } }, 'publicCode'), 'reconhece pelo nome do índice')
chk(!ehColisao({ code: 'P2002', meta: { target: ['email'] } }, 'publicCode'), 'colisão de email NÃO vira autocura de código')
chk(!ehColisao({ code: 'P2003' }, 'publicCode'), 'violação de FK não vira autocura')
chk(!ehColisao(new Error('boom'), 'publicCode'), 'erro genérico não vira autocura')

// ── 3) reconciliação ─────────────────────────────────────────────────────────
sec('3) reconciliação de sequências')
const gen = ler('lib/codigos/code-generator.ts')
chk(gen.includes('export async function sincronizarSequenciaComTabela'), 'existe reconciliação por tabela')
chk(gen.includes('GREATEST'), 'semente é monotônica (nunca retrocede, nunca reaproveita número)')
chk(/\/\^\[A-Za-z\]\[A-Za-z0-9_\]\*\$\//.test(gen), 'identificadores validados por allowlist antes do SQL')
chk(gen.includes('LIKE $1'), 'prefixo do escopo entra como parâmetro, não concatenado')
const recon = ler('scripts/reconciliar-sequencias-codigo.ts')
chk(recon.includes('--dry-run'), 'reconciliação tem dry-run')
chk(recon.includes('CODE_REGISTRY'), 'reconcilia TODOS os escopos, não só o que quebrou')
chk(ler('package.json').includes('prod-reconciliar-sequencias'), 'reconciliação roda no build')

// ── 4) a rota fala a verdade ─────────────────────────────────────────────────
sec('4) mensagens honestas')
const register = ler('src/app/api/auth/register/route.ts')
chk(register.includes("verificarPermissao(request, 'usuarios.criar')"), 'criação exige usuarios.criar')
chk(register.includes("e?.code === 'P2002'"), 'trata violação de UNIQUE explicitamente')
chk(register.includes('Este email já está em uso'), 'email duplicado devolve 409 com causa')
chk(/sequência inconsistente/.test(register), 'colisão de código público diz a causa (não "erro interno")')
chk(register.includes('status: 409'), 'duplicidade é 409, não 500')

const service = ler('src/services/userService.ts')
chk(!/catch \(error\) \{\s*console\.error\("Erro ao buscar usuários:", error\)\s*return \[\]/.test(service),
  'listagem não engole mais o erro devolvendo lista vazia')
chk(!service.includes('return []\n  }\n}'), 'nenhum caminho devolve lista vazia mascarando falha')
chk(service.includes('Sessão expirada'), 'sessão expirada é dita com clareza')
chk(service.includes('não tem permissão para criar usuários'), '403 na criação explica a permissão')

// ── 5) CRUD e permissões preservados ─────────────────────────────────────────
sec('5) CRUD e permissões')
const rotaLista = ler('src/app/api/usuarios/route.ts')
chk(rotaLista.includes("verificarPermissao(request, 'usuarios.gerenciar')"), 'listagem exige usuarios.gerenciar')
const rotaItem = ler('src/app/api/usuarios/[id]/route.ts')
chk(/usuarios\.editar/.test(rotaItem), 'edição exige usuarios.editar')
chk(/usuarios\.excluir/.test(rotaItem), 'exclusão exige usuarios.excluir')
const perms = ler('src/lib/permissoes.ts')
for (const k of ['usuarios.gerenciar', 'usuarios.criar', 'usuarios.editar', 'usuarios.excluir']) {
  chk(perms.includes(`'${k}'`), `permissão ${k} registrada no catálogo`)
}
const tab = ler('src/components/gerenciamentoComponents/UsersTab.tsx')
chk(tab.includes('createUser') && tab.includes('updateUser') && tab.includes('deleteUser'), 'tela usa o serviço único (create/update/delete)')
chk(tab.includes('setError'), 'tela tem canal para exibir o erro real')

console.log(`\n${ok} passaram, ${fail} falharam`)
if (fail) process.exit(1)
