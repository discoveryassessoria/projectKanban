/**
 * GUARDA — motor da Saúde do Sistema.
 * Rodar: npm run test:saude
 *
 * O que este teste prova (sem banco, sobre o consolidador puro):
 *  1. crítico → estado CRÍTICO; erro → DEGRADADO; alerta → ATENÇÃO;
 *  2. verificação NÃO EXECUTADA ou com FALHA TÉCNICA nunca vira OK — vira
 *     DIAGNÓSTICO INCOMPLETO;
 *  3. nada executado → INDISPONÍVEL;
 *  4. o estado geral é sempre o PIOR encontrado (nunca média);
 *  5. o catálogo é versionado, sem id/código duplicado e com metadados completos;
 *  6. fila com evento antigo NÃO é saudável (a regra que faltava);
 *  7. a tela não pode declarar "Saudável" por conta própria.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogo, cobertura, dominiosSemCobertura, elegiveis, VERSAO_CATALOGO } from '../lib/saude/catalogo'
import { consolidar } from '../lib/saude/motor'
import { LIMITES_FILA } from '../lib/saude/verificacoes/filas'
import { avaliarCapacidade, capacidades, piorProntidao, type Capacidade } from '../lib/saude/capacidades'
import { montarPlano, agruparPorCausaRaiz } from '../lib/saude/plano'
import { mapearSuperficie, lacunasDeCobertura, matrizCobertura } from '../lib/saude/superficie'
import { ROTAS_SMOKE } from '../lib/saude/smoke'
import { DOMINIOS, ESTADOS, SEVERIDADES, piorEstado, piorSeveridade, type ExecucaoVerificacao } from '../lib/saude/tipos'
import '../lib/saude' // registra o catálogo

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0, failed = 0
const falhas: string[] = []
const ok = (cond: boolean, nome: string) => {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const fake = (codigo: string, obrigatoria = true) => ({
  id: `t.${codigo}`, codigo, nome: codigo, descricao: '', dominio: 'BANCO' as const, modulo: 'teste',
  severidadePadrao: 'ERRO' as const, obrigatoria, modos: ['COMPLETO' as const], introduzidaEm: '1.0.0',
  timeoutMs: 1000, orientacao: '', responsavel: 'teste', ativo: true,
  executar: async () => ({ achados: [] }),
})
const exec = (codigo: string, status: ExecucaoVerificacao['status'], achados: ExecucaoVerificacao['achados'] = []): ExecucaoVerificacao =>
  ({ codigo, status, duracaoMs: 1, achados })
const achado = (severidade: 'CRITICO' | 'ERRO' | 'ALERTA' | 'INFORMATIVO') =>
  ({ chave: `k-${severidade}`, severidade, titulo: 't', descricao: 'd' })

// `semCobertura: []` isola a REGRA DE SEVERIDADE. A regra de cobertura é
// testada à parte, no bloco 6 — as duas juntas mascarariam uma à outra.
const consolidarCom = (execucoes: ExecucaoVerificacao[], elegiveisDoModo = execucoes.map((e) => fake(e.codigo))) =>
  consolidar({ modo: 'COMPLETO', iniciadoEm: new Date(0).toISOString(), duracaoMs: 10, execucoes, elegiveisDoModo, semCobertura: [] })

// ═══════════ 1) SEVERIDADE DEFINE O ESTADO ═══════════
console.log('\n1) A severidade do achado define o estado geral')
ok(consolidarCom([exec('A', 'COM_ACHADOS', [achado('CRITICO')])]).estado === 'CRITICO', 'achado crítico → estado CRÍTICO')
ok(consolidarCom([exec('A', 'COM_ACHADOS', [achado('ERRO')])]).estado === 'DEGRADADO', 'achado de erro → estado DEGRADADO')
ok(consolidarCom([exec('A', 'COM_ACHADOS', [achado('ALERTA')])]).estado === 'ATENCAO', 'achado de alerta → estado ATENÇÃO')
ok(consolidarCom([exec('A', 'COM_ACHADOS', [achado('INFORMATIVO')])]).estado === 'SAUDAVEL', 'informativo não degrada o estado')
ok(consolidarCom([exec('A', 'APROVADA')]).estado === 'SAUDAVEL', 'tudo aprovado → SAUDÁVEL')

// ═══════════ 2) FALHA DE DIAGNÓSTICO NUNCA É OK ═══════════
console.log('\n2) Falha de diagnóstico nunca vira "sem problema"')
const comFalha = consolidarCom([exec('A', 'APROVADA'), exec('B', 'FALHA_TECNICA')])
ok(comFalha.estado === 'DIAGNOSTICO_INCOMPLETO', 'falha técnica → DIAGNÓSTICO INCOMPLETO (não SAUDÁVEL)')
ok(comFalha.aprovadas === 1 && comFalha.falhasTecnicas === 1, 'falha técnica não é contada como aprovada')
const comTimeout = consolidarCom([exec('A', 'APROVADA'), exec('B', 'TIMEOUT')])
ok(comTimeout.estado === 'DIAGNOSTICO_INCOMPLETO', 'timeout → DIAGNÓSTICO INCOMPLETO')
const naoExecutada = consolidarCom([exec('A', 'APROVADA'), exec('B', 'NAO_EXECUTADA')])
ok(naoExecutada.estado === 'DIAGNOSTICO_INCOMPLETO', 'verificação não executada → DIAGNÓSTICO INCOMPLETO')
ok(naoExecutada.coberturaPercentual === 50, 'cobertura reflete o que REALMENTE rodou (50%)')
const opcionalPendente = consolidarCom(
  [exec('A', 'APROVADA'), exec('B', 'NAO_EXECUTADA')],
  [fake('A'), fake('B', false)],
)
ok(opcionalPendente.estado === 'SAUDAVEL', 'verificação OPCIONAL pendente não bloqueia o estado saudável')

// ═══════════ 3) MOTOR INDISPONÍVEL ═══════════
console.log('\n3) Motor sem conseguir executar nada')
ok(consolidarCom([exec('A', 'FALHA_TECNICA'), exec('B', 'FALHA_TECNICA')]).estado === 'INDISPONIVEL',
  'nenhuma verificação executada → INDISPONÍVEL (saúde desconhecida)')

// ═══════════ 4) SEMPRE O PIOR, NUNCA A MÉDIA ═══════════
console.log('\n4) O estado geral é o PIOR encontrado')
const misto = consolidarCom([
  exec('A', 'APROVADA'), exec('B', 'APROVADA'), exec('C', 'APROVADA'),
  exec('D', 'COM_ACHADOS', [achado('ALERTA')]), exec('E', 'COM_ACHADOS', [achado('CRITICO')]),
])
ok(misto.estado === 'CRITICO', '3 aprovadas + 1 alerta + 1 crítico → CRÍTICO (média não dilui)')
ok(misto.criticos === 1 && misto.alertas === 1, 'contagem por severidade preservada')
ok(piorEstado('SAUDAVEL', 'CRITICO') === 'CRITICO' && piorEstado('CRITICO', 'ATENCAO') === 'CRITICO', 'piorEstado é monotônico')
ok(piorSeveridade('ALERTA', 'CRITICO') === 'CRITICO', 'piorSeveridade é monotônico')
ok(ESTADOS.indexOf('CRITICO') > ESTADOS.indexOf('ATENCAO'), 'ordem dos estados: crítico é pior que atenção')
ok(SEVERIDADES.indexOf('CRITICO') > SEVERIDADES.indexOf('ALERTA'), 'ordem das severidades')

// ═══════════ 5) CATÁLOGO VERSIONADO ═══════════
console.log('\n5) Catálogo oficial e versionado')
const todas = catalogo()
ok(todas.length >= 15, `catálogo com verificações declaradas (${todas.length})`)
ok(/^\d+\.\d+\.\d+$/.test(VERSAO_CATALOGO), `catálogo versionado (v${VERSAO_CATALOGO})`)
ok(new Set(todas.map((v) => v.id)).size === todas.length, 'nenhum id duplicado')
ok(new Set(todas.map((v) => v.codigo)).size === todas.length, 'nenhum código duplicado')
ok(todas.every((v) => v.nome && v.descricao && v.orientacao && v.responsavel), 'toda verificação tem nome, descrição, orientação e responsável')
ok(todas.every((v) => v.timeoutMs > 0), 'toda verificação declara timeout')
ok(todas.every((v) => v.modos.length > 0), 'toda verificação declara em que modos roda')
ok(todas.every((v) => DOMINIOS.includes(v.dominio)), 'todo domínio declarado é um domínio oficial')
ok(elegiveis('RAPIDO').length > 0 && elegiveis('COMPLETO').length >= elegiveis('RAPIDO').length,
  'modo rápido é subconjunto do completo')
ok(cobertura().length === DOMINIOS.length, `matriz de cobertura cobre os ${DOMINIOS.length} domínios obrigatórios`)
const semCob = dominiosSemCobertura()
console.log(`     (${DOMINIOS.length - semCob.length}/${DOMINIOS.length} domínios com cobertura; ${semCob.length} ainda sem)`)
ok(semCob.length < DOMINIOS.length, 'existe cobertura real em pelo menos parte dos domínios')

// ═══════════ 6) LACUNA DE COBERTURA IMPEDE "SAUDÁVEL" ═══════════
console.log('\n6) Domínio obrigatório sem cobertura impede declarar saudável')
const comLacuna = consolidar({
  modo: 'COMPLETO', iniciadoEm: new Date(0).toISOString(), duracaoMs: 10,
  execucoes: [exec('A', 'APROVADA')], elegiveisDoModo: [fake('A')], semCobertura: ['PERFORMANCE'],
})
ok(comLacuna.estado === 'DIAGNOSTICO_INCOMPLETO', 'com lacuna de cobertura o motor devolve DIAGNÓSTICO INCOMPLETO mesmo sem achados')
ok(comLacuna.dominiosSemCobertura.includes('PERFORMANCE'), 'o resultado declara quais domínios estão descobertos')
const semLacuna = consolidarCom([exec('A', 'APROVADA')])
ok(semLacuna.estado === 'SAUDAVEL', 'sem lacuna e sem achado, o estado é SAUDÁVEL')
// e o catálogo REAL, hoje, ainda tem lacunas — então produção não pode ser "saudável"
const real = consolidar({
  modo: 'COMPLETO', iniciadoEm: new Date(0).toISOString(), duracaoMs: 10,
  execucoes: [exec('A', 'APROVADA')], elegiveisDoModo: [fake('A')],
})
ok(
  semCob.length === 0 ? real.estado === 'SAUDAVEL' : real.estado === 'DIAGNOSTICO_INCOMPLETO',
  'com o catálogo real, o estado respeita as lacunas de cobertura existentes',
)

// ═══════════ 7) FILA NÃO SE JULGA POR NÚMERO ABSOLUTO ═══════════
console.log('\n7) Fila com evento antigo não é saudável')
const filaSrc = ler('lib/saude/verificacoes/filas.ts')
ok(/idadeAtencaoMin|idadeErroMin|idadeCriticoMin/.test(filaSrc), 'a fila é avaliada por IDADE do evento mais antigo')
ok(/silencioDispatcherMin/.test(filaSrc), 'a fila é avaliada pela ATIVIDADE do dispatcher')
ok(LIMITES_FILA.idadeErroMin > LIMITES_FILA.idadeAtencaoMin && LIMITES_FILA.idadeCriticoMin > LIMITES_FILA.idadeErroMin,
  'os limites de idade são crescentes (atenção < erro < crítico)')
ok(/severidade: 'CRITICO'[\s\S]{0,400}dispatcher/i.test(filaSrc) || /dispatcher-sem-atividade[\s\S]{0,200}CRITICO/.test(filaSrc),
  'dispatcher parado com fila é CRÍTICO')
ok(LIMITES_FILA.quantidadeAtencao <= 25, 'acúmulo de fila vira alerta cedo (≤ 25 eventos)')

// ═══════════ 8) A TELA NÃO INVENTA "SAUDÁVEL" ═══════════
console.log('\n8) A interface só reflete o veredito do motor')
const telaSrc = ler('src/components/gerenciamentoComponents/SaudeSistemaTab.tsx')
ok(!/criticos === 0 && alertas === 0 \? "Saudável"/.test(telaSrc), 'a tela não calcula "Saudável" por conta própria')
ok(/rot\.estados\[estado\]/.test(telaSrc), 'a tela exibe o estado que o motor devolveu')
ok(/estadoAtual/.test(ler('src/app/api/gerenciamento/saude/route.ts')), 'a API expõe o estado real da última execução')
ok(/INDISPONIVEL/.test(ler('src/app/api/gerenciamento/saude/route.ts')), 'sem execução registrada, o estado é INDISPONÍVEL — nunca saudável')

// ═══════════ 9) PERSISTÊNCIA E HISTÓRICO ═══════════
console.log('\n9) Achados têm vida: novo, recorrente, resolvido')
const persistSrc = ler('lib/saude/persistencia.ts')
ok(/primeiraDeteccao/.test(persistSrc) && /ultimaDeteccao/.test(persistSrc), 'grava primeira e última detecção')
ok(/REINCIDENTE/.test(persistSrc), 'problema que volta depois de resolvido é marcado como reincidente')
ok(/recorrencias: anterior\.recorrencias \+ 1/.test(persistSrc), 'conta recorrências')
ok(/codigosConclusivos/.test(persistSrc), 'só verificação CONCLUSIVA pode resolver um achado')
ok(!/deleteMany|\.delete\(/.test(persistSrc), 'o histórico de saúde nunca é apagado')

// ═══════════ 10) CORREÇÃO AUTOMÁTICA — SÓ O QUE É SEGURO ═══════════
console.log('\n10) Correção automática')
const corr = ler('lib/saude/correcoes.ts')
ok(/reprocessar-outbox/.test(corr) && /reconciliar-sequencias/.test(corr), 'catálogo de correções seguras declarado')
ok(/NUNCA_AUTOMATICO/.test(corr), 'o que NUNCA é automático está declarado explicitamente')
for (const proibida of ['exclusão de registros', 'fusão de organizações', 'alteração de valor financeiro', 'alteração de permissões']) {
  ok(corr.includes(proibida), `proibição declarada: ${proibida}`)
}
ok(!/\.delete\(|deleteMany|DROP /i.test(corr), 'nenhuma correção automática apaga dado')
ok(/porqueSegura/.test(corr), 'toda correção declara POR QUE é segura')
const rotaCorr = ler('src/app/api/gerenciamento/saude/corrigir/route.ts')
ok(/correcaoPorId\(id\)/.test(rotaCorr) && /não existe no catálogo/.test(rotaCorr), 'correção fora do catálogo é recusada')
ok(/registrarAuditoria/.test(rotaCorr), 'toda correção é auditada')
ok(/CORRECAO_AUTOMATICA_FALHOU/.test(rotaCorr), 'falha de correção também é auditada')
ok(/'EM_CORRECAO'/.test(rotaCorr), 'o achado vai para EM_CORREÇÃO — a correção não se autodeclara resolvida')

// ═══════════ 11) NOTIFICAÇÃO SEM SPAM ═══════════
console.log('\n11) Notificação agrupada e com cooldown')
const notif = ler('lib/saude/notificacoes.ts')
ok(/COOLDOWN_MIN/.test(notif), 'existe janela de cooldown')
ok(/assinaturaDo/.test(notif), 'incidente tem assinatura estável (mesmo incidente não vira aviso novo)')
ok(/repeticoes/.test(notif), 'incidente em curso é ATUALIZADO em vez de duplicado')
ok(/r\.criticos > 0/.test(notif) && /p\.reincidentes > 0/.test(notif), 'notifica crítico e reincidência')

// ═══════════ 12) EXECUÇÃO AGENDADA ═══════════
console.log('\n12) Diagnóstico roda sozinho')
const cron = ler('src/app/api/cron/saude/route.ts')
ok(/modoDoRelogio/.test(cron), 'o modo é escolhido pelo relógio (rápido/completo/profundo)')
ok(/persistirDiagnostico/.test(cron) && /notificarAchados/.test(cron), 'execução agendada persiste e notifica')
ok(/status: 500/.test(cron) && /INDISPONIVEL/.test(cron), 'falha do motor devolve erro ao agendador — nunca sucesso silencioso')
const vercel = JSON.parse(ler('vercel.json')) as { crons: { path: string }[] }
ok(vercel.crons.some((c) => c.path === '/api/cron/saude'), 'cron da saúde registrado no vercel.json')

// ═══════════ 13) FILA: TIPO SEM CONSUMIDOR ═══════════
console.log('\n13) Evento sem consumidor é detectado')
const disp = ler('src/services/outbox-dispatcher.ts')
ok(/export const TIPOS_DRENADOS/.test(disp), 'os tipos drenados são declarados e exportados')
ok(/phase-workflow\.instanced/.test(disp), 'o tipo que represou a fila por 12 dias agora é drenado')
ok(/TIPOS_DRENADOS/.test(filaSrc), 'a verificação compara a fila com os tipos realmente drenados')

async function assincronos() {
  // ═══════════ 14) PRONTIDÃO OPERACIONAL ═══════════
  console.log('\n14) Capacidades e dependências')

  const dep = (over: Partial<{ ok: boolean; indeterminada: boolean; erro: string }>, tipo = 'CADASTRO', obrigatoria = true) => ({
    codigo: `d-${tipo}-${obrigatoria}-${over.ok}-${over.indeterminada ?? false}`,
    nome: `dependência ${tipo}`,
    tipo: tipo as 'CADASTRO',
    obrigatoria,
    acao: 'faça algo',
    avaliar: async () => ({ ok: over.ok ?? false, detalhe: 'x', indeterminada: over.indeterminada, erro: over.erro }),
  })
  const cap = (deps: ReturnType<typeof dep>[]): Capacidade => ({
    codigo: 'CAP-TESTE', nome: 'Capacidade de teste', descricao: 'd', modulo: 'Teste',
    operacao: 'operar', dominio: 'PONTA_A_PONTA', prioridade: 1, severidadeFalha: 'CRITICO',
    dependencias: deps, introduzidaEm: '2.0.0', ativo: true,
  })

  const pronta = await avaliarCapacidade(cap([dep({ ok: true })]))
  ok(pronta.estado === 'PRONTO', 'todas as dependências atendidas ⇒ PRONTO')
  ok(pronta.faltantes.length === 0, 'capacidade pronta não gera faltantes')

  const semCadastro = await avaliarCapacidade(cap([dep({ ok: false })]))
  ok(semCadastro.estado === 'NAO_CONFIGURADO', 'só falta cadastro/configuração ⇒ NÃO CONFIGURADO')
  ok(semCadastro.faltantes.length === 1, 'a dependência não atendida aparece como faltante')

  const bloqueada = await avaliarCapacidade(cap([dep({ ok: false }, 'TECNICA')]))
  ok(bloqueada.estado === 'BLOQUEADO', 'dependência TÉCNICA obrigatória falhando ⇒ BLOQUEADO')

  const invalida = await avaliarCapacidade(cap([dep({ ok: false }, 'VINCULO')]))
  ok(invalida.estado === 'CONFIGURACAO_INVALIDA', 'vínculo obrigatório ausente ⇒ CONFIGURAÇÃO INVÁLIDA')

  const parcial = await avaliarCapacidade(cap([dep({ ok: true }), dep({ ok: false }, 'CADASTRO', false)]))
  ok(parcial.estado === 'PARCIALMENTE_PRONTO', 'só dependência recomendada falhando ⇒ PARCIALMENTE PRONTO')

  const indet = await avaliarCapacidade(cap([dep({ ok: false, indeterminada: true, erro: 'timeout' })]))
  ok(indet.estado === 'DIAGNOSTICO_INCOMPLETO', 'dependência indeterminada ⇒ DIAGNÓSTICO INCOMPLETO, nunca "pronto"')

  const explode = await avaliarCapacidade(cap([{
    codigo: 'boom', nome: 'que explode', tipo: 'CADASTRO' as const, obrigatoria: true, acao: 'x',
    avaliar: async () => { throw new Error('falha de banco') },
  }]))
  ok(explode.estado === 'DIAGNOSTICO_INCOMPLETO', 'erro ao avaliar dependência NÃO vira aprovação — vira incompleto')
  ok(explode.faltantes[0]?.indeterminada === true, 'a dependência que explodiu é marcada como indeterminada')

  ok(piorProntidao('PRONTO', 'BLOQUEADO') === 'BLOQUEADO', 'a pior prontidão vence na agregação')
  ok(capacidades().length >= 9, `catálogo de capacidades operacionais populado (${capacidades().length})`)
  ok(new Set(capacidades().map((c) => c.codigo)).size === capacidades().length, 'não há capacidade com código duplicado')
  ok(capacidades().every((c) => c.dependencias.length > 0), 'toda capacidade declara ao menos uma dependência')

  // ═══════════ 15) PLANO DE CORREÇÃO ═══════════
  console.log('\n15) Plano ordenado e causa raiz')
  const compartilhada = dep({ ok: false })
  const c1 = await avaliarCapacidade({ ...cap([compartilhada]), codigo: 'CAP-A', nome: 'A', prioridade: 1 })
  const c2 = await avaliarCapacidade({ ...cap([compartilhada]), codigo: 'CAP-B', nome: 'B', prioridade: 2 })
  const c3 = await avaliarCapacidade({ ...cap([dep({ ok: false }, 'PERMISSAO')]), codigo: 'CAP-C', nome: 'C', prioridade: 3, severidadeFalha: 'ALERTA' })
  const plano = montarPlano([c1, c2, c3], [])
  ok(plano.length === 2, 'a mesma dependência em duas capacidades vira UMA recomendação, não duas')
  ok(plano[0].destrava.length === 2, 'a recomendação acumula as capacidades que destrava')
  ok(plano[0].severidade === 'CRITICO', 'o que bloqueia mais e é mais grave vem primeiro')
  ok(plano.every((r, i) => r.ordem === i + 1), 'a ordem é sequencial e explícita')
  ok(plano.every((r) => r.problema && r.causa && r.impacto && r.acao), 'toda recomendação diz problema, causa, impacto e ação')

  const contratoFake = [{ cadastro: 'servico', rotulo: 'Serviços', rota: '/x', totalAtivos: 10,
    incompletos: [{ id: 1, rotulo: 'S', faltando: ['preço'] }], requisitos: ['preço'] }]
  ok(montarPlano([], contratoFake).length === 1, 'contrato descumprido também entra no plano')

  const raiz = agruparPorCausaRaiz(plano)
  ok(raiz.length <= plano.length, 'causa raiz agrupa — não multiplica alertas')
  ok(raiz[0].capacidadesAfetadas.length > 0, 'a causa raiz diz quais capacidades ela afeta')

  // ═══════════ 16) SUPERFÍCIE E SMOKE ═══════════
  console.log('\n16) Descoberta de superfície e smoke autenticado')
  const sup = mapearSuperficie()
  ok(sup.apis.length > 50, `as rotas de API são descobertas por varredura (${sup.apis.length})`)
  ok(sup.paginas.length > 5, `as páginas são descobertas (${sup.paginas.length})`)
  ok(sup.entidades.length > 50, `as entidades do schema são descobertas (${sup.entidades.length})`)
  ok(sup.itensDeMenu.length > 0, 'os itens de menu são descobertos do código de navegação')
  ok(Array.isArray(lacunasDeCobertura(sup)), 'as lacunas de cobertura são calculáveis')
  ok(lacunasDeCobertura(sup).every((l) => l.detalhe.length > 0), 'toda lacuna explica por que é lacuna')
  ok(sup.crons.length === 3, 'os três jobs agendados são descobertos do vercel.json')
  ok(lacunasDeCobertura(sup).every((l) => l.tipo !== 'CRON'), 'todo job agendado tem verificação que o vigie (inclusive o próprio cron da saúde)')
  const agendados = ler('lib/saude/verificacoes/agendados.ts')
  ok(/saudeExecucao/.test(agendados), 'a vigilância do cron da saúde é por EVIDÊNCIA de execução, não por ausência de erro')
  ok(/status: \{ in: \['RECEBIDO', 'EM_PROCESSAMENTO'\] \}/.test(agendados), 'o worker registral é medido por backlog envelhecido — sistema ocioso não vira alarme')
  const matriz = matrizCobertura(new Set(capacidades().map((c) => c.codigo)))
  ok(matriz.length > 0 && matriz.every((m) => typeof m.verificacoes === 'number'), 'a matriz módulo × cobertura é montada')

  const smokeSrc = ler('lib/saude/smoke.ts')
  ok(ROTAS_SMOKE.every((r) => r.rota.startsWith('/api/')), 'o smoke só visita rotas de API')
  ok(!/method: '(POST|PUT|PATCH|DELETE)'/.test(smokeSrc), 'o smoke NUNCA escreve — somente GET')
  ok(/signAuthToken/.test(smokeSrc), 'o smoke usa identidade técnica autenticada (401 não é rota testada)')
  ok(!/console\.log\(.*token/i.test(smokeSrc), 'o token técnico nunca é registrado em log')
  ok(/autorização negada/.test(smokeSrc), '401 com identidade técnica é reportado como falha, não como sucesso')
  const pron = ler('lib/saude/verificacoes/prontidao.ts')
  ok(/todasRecusaram/.test(pron), 'identidade recusada em TODAS as rotas vira um achado só — nove rotas "quebradas" seria alarme falso')
  ok(/smoke-rotas-nao-alcancadas/.test(pron), 'rota que não respondeu vira achado — "não testada" nunca passa por "saudável"')
  ok(/VERCEL_PROJECT_PRODUCTION_URL/.test(smokeSrc), 'o smoke prefere o domínio de produção à URL protegida do deployment')

  // ═══════════ 17) NADA DESTRUTIVO ═══════════
  console.log('\n17) O motor não destrói nada')
  for (const arq of ['lib/saude/capacidades.ts', 'lib/saude/contratos.ts', 'lib/saude/plano.ts', 'lib/saude/superficie.ts', 'lib/saude/smoke.ts', 'lib/saude/verificacoes/prontidao.ts']) {
    const src = ler(arq)
    ok(!/\.delete\(|\.deleteMany\(|DROP |TRUNCATE/i.test(src), `${arq} não apaga nada`)
    ok(!/\.catch\(\(\) => \[\]\)|\.catch\(\(\) => 0\)/.test(src), `${arq} não engole erro fingindo resultado vazio`)
  }
  const corr = ler('lib/saude/correcoes.ts')
  for (const proibido of ['exclus', 'fus', 'permiss']) {
    ok(new RegExp(proibido, 'i').test(corr), `a lista do que NUNCA é automático menciona "${proibido}"`)
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
  console.log('Motor da Saúde do Sistema: validado ✅')
}

assincronos().catch((e) => { console.error(e); process.exit(1) })
