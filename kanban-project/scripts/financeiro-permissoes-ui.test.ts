// F7.3 — GUARDA: toda permissão do Financeiro é CONCEDÍVEL na tela de permissões.
// Regra: nenhuma chave `financeiro.*` pode existir só no catálogo/seed — ela precisa aparecer
// em algum módulo de MODULOS_PERMISSOES (é isso que RolesTab/UsersTab renderizam). Chave órfã
// = permissão que ninguém consegue conceder sem mexer no banco.
// Também fixa a segregação nos perfis padrão: Assistente NÃO opera Contas a Pagar.
import { PERMISSOES, MODULOS_PERMISSOES, PERFIS_PADRAO, PERMISSOES_OPT_IN, calcularPermissoes } from '@/src/lib/permissoes'
import { OPERACOES_CUSTO, CHAVE_CUSTO } from '@/lib/financeiro/permissoes-custo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const naUI = new Set<string>()
  for (const mod of MODULOS_PERMISSOES) for (const k of mod.permissoes as readonly string[]) naUI.add(k)

  // (1) nenhuma chave financeira órfã
  const financeiras = Object.keys(PERMISSOES).filter((k) => k.startsWith('financeiro.'))
  const orfas = financeiras.filter((k) => !naUI.has(k))
  if (orfas.length) console.log('  Chaves financeiras fora da UI:', orfas.join(', '))
  chk(orfas.length === 0, `toda permissão financeira é concedível na tela (${financeiras.length} chaves, ${orfas.length} órfã(s))`)

  // (2) as 10 chaves de custo do helper batem com o catálogo E estão na UI
  for (const op of OPERACOES_CUSTO) {
    const chave = CHAVE_CUSTO[op]
    if (!(chave in PERMISSOES)) chk(false, `chave ${chave} existe no catálogo`)
    if (!naUI.has(chave)) chk(false, `chave ${chave} aparece na tela de permissões`)
  }
  chk(OPERACOES_CUSTO.every((op) => (CHAVE_CUSTO[op] in PERMISSOES) && naUI.has(CHAVE_CUSTO[op])),
    'as 10 operações segregadas de custo estão no catálogo E na tela')

  // (3) nenhuma chave duplicada entre módulos (a UI marcaria/desmarcaria em dois lugares)
  const todas = MODULOS_PERMISSOES.flatMap((m) => m.permissoes as readonly string[])
  chk(todas.length === new Set(todas).size, 'nenhuma permissão aparece em dois módulos')

  // (4) todo item exibido existe de fato no catálogo (sem chave fantasma na UI)
  const fantasmas = todas.filter((k) => !(k in PERMISSOES))
  chk(fantasmas.length === 0, `nenhuma chave fantasma na UI (${fantasmas.join(', ') || 'nenhuma'})`)

  // (5) PERFIS PADRÃO — segregação real
  const assistente = PERFIS_PADRAO.find((p) => p.nome === 'Assistente')!
  const efetivasAssistente = calcularPermissoes('operador', assistente.permissoes)
  chk(OPERACOES_CUSTO.every((op) => efetivasAssistente[CHAVE_CUSTO[op]] === false),
    'Assistente NÃO opera Contas a Pagar (coerente com a descrição do perfil)')
  chk(efetivasAssistente['financeiro.ver'] === true, 'Assistente continua VENDO o financeiro')

  const gerente = PERFIS_PADRAO.find((p) => p.nome === 'Gerente')!
  const efetivasGerente = calcularPermissoes('operador', gerente.permissoes)
  chk(OPERACOES_CUSTO.every((op) => efetivasGerente[CHAVE_CUSTO[op]] === true), 'Gerente opera Contas a Pagar')

  const estagiario = PERFIS_PADRAO.find((p) => p.nome === 'Estagiário')!
  const efetivasEstagiario = calcularPermissoes('operador', estagiario.permissoes)
  chk(OPERACOES_CUSTO.every((op) => efetivasEstagiario[CHAVE_CUSTO[op]] === false), 'Estagiário não opera Contas a Pagar')

  // (6) OPT-IN continua fora dos perfis padrão, mesmo estando visível na tela
  for (const perfil of PERFIS_PADRAO) {
    const ef = calcularPermissoes('operador', perfil.permissoes)
    for (const chave of PERMISSOES_OPT_IN) {
      if (ef[chave] === true) chk(false, `perfil ${perfil.nome} NÃO deveria conceder opt-in ${chave}`)
    }
  }
  chk(PERFIS_PADRAO.every((p) => [...PERMISSOES_OPT_IN].every((c) => calcularPermissoes('operador', p.permissoes)[c] !== true)),
    'permissões OPT-IN seguem fora de todo perfil padrão (visíveis, mas nunca automáticas)')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
