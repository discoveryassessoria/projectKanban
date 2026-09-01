// scripts/navegacao-operacional.test.ts
// ============================================================================
// PARA ONDE UMA TAREFA LEVA — o deep-link operacional.
//
//   npx tsx scripts/navegacao-operacional.test.ts
//
// A pergunta que esta suíte protege é operacional, não técnica: com QUINZE
// certidões distribuídas entre várias pessoas, clicar em uma tarefa da fila tem
// de abrir exatamente aquela — não a primeira, não a mais parecida.
//
// E protege o outro lado: a URL é do usuário. Trocar um número nela não pode
// virar chave de um processo que não é dele.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { urlOperacionalDaTarefa } from '../lib/operacional/navegacao'
import { criarTarefaManual, decidirSobreCausaRemovida } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'
import { minhaFila } from '../lib/operacional/tarefa-projecoes'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'NAV'
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@nav.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco da navegação operacional')
  console.log('O DEEP-LINK OPERACIONAL — quinze certidões, zero ambiguidade\n')
  await limpar()

  // ══════════════════════════════════════════════════════════════════════════
  secao('§39/§3) UMA função monta a URL — e ela usa IDs, não nomes')
  // ══════════════════════════════════════════════════════════════════════════
  const url = urlOperacionalDaTarefa({ taskId: 42, processoId: 7 })
  ok('§4) leva ao processo, na Central', url.includes('processoId=7') && url.includes('tab=central'))
  ok('§3) carrega o taskId', url.includes('taskId=42'))
  ok('§3) e NADA de nome', !/nome|titulo|pessoa=[a-z]/i.test(url), url)
  ok('§4) é deep-link de verdade — query, não estado em memória', url.startsWith('/kanban?'))
  ok('§4) sem processo, ainda leva à tarefa',
    urlOperacionalDaTarefa({ taskId: 42, processoId: null }) === '/operacao?taskId=42')

  // Todas as entradas usam a MESMA função.
  for (const [tela, arquivo] of [
    ['Minha Fila', 'src/components/operacao/central-tarefas.tsx'],
    ['Tarefas e Projetos / Kanban global', 'src/components/operacao/visao-global.tsx'],
    ['notificações', 'lib/operacional/tarefa-comandos.ts'],
  ] as const) {
    ok(`§36-§38) ${tela} usa o helper canônico`,
      /urlOperacionalDaTarefa/.test(semComentarios(ler(arquivo))))
  }
  const espalhadas = ['src/components/operacao/central-tarefas.tsx', 'src/components/operacao/visao-global.tsx']
    .filter((f) => /`\/kanban\?/.test(semComentarios(ler(f))))
  ok('§39) e ninguém concatena URL à mão', espalhadas.length === 0, espalhadas.join(', ') || 'nenhuma')

  // ── palco: 15 certidões, 5 pessoas ────────────────────────────────────────
  const gestor = await prisma.usuario.create({ data: { nome: 'Gestor Nav', email: 'gestor@nav.test', senha: 'x', tipo: 'admin' }, select: { id: true } })
  const dani = await prisma.usuario.create({
    data: { nome: 'Dani Nav', email: 'dani@nav.test', senha: 'x', tipo: 'assistente',
      permissoesCustom: { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true } },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: 'emissao_documental' },
    select: { id: true },
  })

  const PESSOAS = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena']
  const TIPOS = ['Certidão de Nascimento', 'Certidão de Casamento', 'Certidão de Óbito']
  const criadas: Array<{ taskId: number; documentoId: number; pessoaId: number; rotulo: string }> = []
  let seq = 0
  for (const nome of PESSOAS) {
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome, sobrenome: 'Nav' }, select: { id: true } })
    for (const tipo of TIPOS) {
      const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: tipo, natureza: 'DOCUMENTO' }, select: { id: true } })
      const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: `${MARCA} ${tipo}` }, select: { id: true } })
      const nec = await prisma.necessidadeDocumental.create({
        data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${seq}` },
        select: { id: true },
      })
      const r = await criarTarefaManual({
        titulo: `${tipo} · ${nome} Nav`, processoId: proc.id, autorId: gestor.id,
        motivo: 'palco da navegação', confirmarDuplicidade: true,
        faseMacroKey: 'emissao_documental', pessoaId: pes.id, documentoId: doc.id, necessidadeId: nec.id,
      })
      if (!r.ok) throw new Error(`criar ${tipo}/${nome}: ${'mensagem' in r ? r.mensagem : '?'}`)
      await atribuirTarefa({ tarefaId: r.tarefaId, responsavelId: dani.id, autorId: gestor.id })
      criadas.push({ taskId: r.tarefaId, documentoId: doc.id, pessoaId: pes.id, rotulo: `${tipo} · ${nome}` })
      seq++
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao('§40) QUINZE certidões — cada uma abre exatamente a sua')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§40) o palco tem 15 tarefas', criadas.length === 15, `${criadas.length}`)
  const fila = await minhaFila(dani.id)
  ok('§40) e as 15 estão na fila de quem recebeu',
    criadas.every((c) => fila.some((l) => l.taskId === c.taskId)), `${fila.length} na fila`)

  // A resolução do deep-link é a mesma que a rota usa: taskId → documento/pessoa.
  const resolver = async (taskId: number) =>
    prisma.tarefa.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        processoId: true, pessoaId: true, documentoId: true,
        workflowStepInstance: { select: { pessoaId: true, documentoId: true } },
      },
    })

  let certas = 0
  for (const c of criadas) {
    const alvo = await resolver(c.taskId)
    const doc = alvo.workflowStepInstance?.documentoId ?? alvo.documentoId
    const pes = alvo.workflowStepInstance?.pessoaId ?? alvo.pessoaId
    if (doc === c.documentoId && pes === c.pessoaId && alvo.processoId === proc.id) certas++
    else console.log(`     ⚠ ${c.rotulo}: doc ${doc} ≠ ${c.documentoId}`)
  }
  ok('§40) 15/15 resolvem o documento e a pessoa CERTOS', certas === 15, `${certas}/15`)

  // §15 — a identidade não é posicional.
  const urls = criadas.map((c) => urlOperacionalDaTarefa({ taskId: c.taskId, processoId: proc.id }))
  ok('§15) as 15 URLs são distintas', new Set(urls).size === 15)
  ok('§15) e nenhuma usa índice de linha', !urls.some((u) => /row|index|posicao/i.test(u)))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§33/§34) A URL é do usuário — o servidor é quem decide')
  // ══════════════════════════════════════════════════════════════════════════
  const rota = semComentarios(ler('src/app/api/operacao/tarefas/[tarefaId]/navegacao/route.ts'))
  ok('§33) a resolução confere permissão', /verificarPermissao\(request, 'tarefas\.ver'\)/.test(rota))
  ok('§33) e confere o dono da tarefa', /negarSeNaoForDonoDaTarefa/.test(rota))
  ok('§34) tarefa inexistente e sem acesso respondem igual',
    /tarefa não encontrada/.test(rota) && /status: 404/.test(rota))
  ok('§31) e a rota é leitura pura',
    /export async function GET/.test(rota) &&
    !/\b(prisma|tx)\s*\.\s*\w+\s*\.\s*(create|update|delete)/.test(rota))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§26/§27) "Requer decisão" não é tratado como trabalho normal')
  // ══════════════════════════════════════════════════════════════════════════
  const alvoDecisao = criadas[0].taskId
  await prisma.tarefa.update({
    where: { id: alvoDecisao },
    data: { causaRemovidaEm: new Date(), causaRemovidaMotivo: 'O workflow que originou este trabalho foi encerrado.' },
  })
  const comDecisao = (await minhaFila(dani.id)).find((l) => l.taskId === alvoDecisao)
  ok('§26) a fila marca a tarefa', comDecisao?.requerDecisao === true)

  const tela = semComentarios(ler('src/components/operacao/central-tarefas.tsx'))
  ok('§27) e a ação principal deixa de ser "Continuar"',
    /requerDecisao\) return \{ rotulo: 'Ver decisão'|requerDecisao\) return \{ rotulo: "Ver decisão"/.test(tela))
  const central = semComentarios(ler('src/components/kanban/ProcessoCentralOperacional.tsx'))
  ok('§26) e a Central NÃO abre o executor para ela',
    /if \(!alvo \|\| alvo\.requerDecisao\) return/.test(central))

  // ── E A DECISÃO TEM ONDE SER TOMADA ──────────────────────────────────────
  // Marcar sem oferecer saída é beco: o cartão pede uma decisão e a tela não
  // aceita nenhuma. As duas respostas legítimas vivem na porta canônica.
  ok('§27) a Central oferece a decisão', /DecisaoSobreCausa/.test(central))
  ok('§27) com as duas saídas do domínio',
    /decidir\("MANTER"\)/.test(central) && /decidir\("ENCERRAR"\)/.test(central))
  ok('§27) pela porta única de comandos',
    /\/api\/tarefas\/\$\{taskId\}\/comando/.test(central) && /acao: "decidir_causa"/.test(central))
  ok('§27) e sem justificativa não decide',
    /if \(!justificativa\.trim\(\)\)/.test(central))

  const semJustificativa = await decidirSobreCausaRemovida({
    tarefaId: alvoDecisao, autorId: gestor.id, decisao: 'MANTER', motivo: '   ',
  })
  ok('§27) o serviço também recusa decisão sem porquê',
    !semJustificativa.ok && semJustificativa.codigo === 'SEM_MOTIVO')

  const mantida = await decidirSobreCausaRemovida({
    tarefaId: alvoDecisao, autorId: gestor.id, decisao: 'MANTER',
    motivo: 'A certidão já foi pedida ao cartório — o documento continua necessário.',
  })
  ok('§27) MANTER devolve o trabalho à fila', mantida.ok)
  const depoisDeManter = (await minhaFila(dani.id)).find((l) => l.taskId === alvoDecisao)
  ok('§27) e a tarefa deixa de pedir decisão', depoisDeManter?.requerDecisao === false)
  const decidida = await prisma.tarefa.findUnique({
    where: { id: alvoDecisao },
    select: { causaDecididaEm: true, causaDecisao: true, causaDecisaoMotivo: true, statusTarefa: true },
  })
  ok('§27) a decisão fica registrada', decidida?.causaDecisao === 'MANTER' && decidida?.causaDecididaEm != null)
  ok('§27) e o motivo do que aconteceu não se perde',
    (decidida?.causaDecisaoMotivo ?? '').includes('cartório'))
  ok('§27) decidir não inicia nem conclui a tarefa', decidida?.statusTarefa !== 'CONCLUIDO_RECEBIDO')
  const auditoriaDecisao = await prisma.logAuditoria.count({
    where: { entidade: 'Tarefa', entidadeId: alvoDecisao, acao: 'TAREFA_CAUSA_DECIDIDA' },
  })
  ok('§27) com auditoria', auditoriaDecisao === 1)

  // O reconciliador olha o WORKFLOW encerrado, não a marca. Sem respeitar a
  // decisão, ele remarcaria a tarefa e pediria de novo o que já foi decidido.
  const respeita = semComentarios(ler('lib/operacional/reconciliar-tarefas.ts'))
  ok('§27) o reconciliador respeita a decisão tomada', /causaDecididaEm: null,/.test(respeita))

  const denovo = await decidirSobreCausaRemovida({
    tarefaId: alvoDecisao, autorId: gestor.id, decisao: 'MANTER', motivo: 'de novo',
  })
  ok('§27) decidir de novo o mesmo é inócuo', denovo.ok)
  const trocaDeRumo = await decidirSobreCausaRemovida({
    tarefaId: alvoDecisao, autorId: gestor.id, decisao: 'ENCERRAR', motivo: 'mudei de ideia',
  })
  ok('§27) e trocar a decisão exige a porta do estado atual',
    !trocaDeRumo.ok && trocaDeRumo.codigo === 'JA_DECIDIDA')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§6/§16/§17/§18) A Central se posiciona sozinha')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§6) resolve o alvo pelo servidor', /\/navegacao/.test(central))
  ok('§7) abre o painel pela porta ÚNICA já existente', /abrirDetalhes\(doc\)/.test(central))
  ok('§6) e localiza o documento por ID, não por posição',
    /find\(\(d\) => d\.documentoId === alvo\.documentoId\)/.test(central))
  const painel = semComentarios(ler('src/components/kanban/PainelDaFase.tsx'))
  ok('§16) a linha alvo recebe realce', /documentoDestacadoId/.test(painel) && /ring-sky-300/.test(painel))
  ok('§17) e entra em vista sozinha', /scrollIntoView/.test(painel))
  ok('§18) a pessoa do alvo expande — e só ela', /chaveDaPessoaAlvo/.test(painel))
  ok('§12) a Minha Fila não virou executor: "Continuar" navega',
    /router\.push\(urlOperacionalDaTarefa/.test(tela))

  // ── ABRIR ≠ INICIAR, INCLUSIVE NO GESTO ──────────────────────────────────
  // Clicar no cartão e clicar no botão chegam ao mesmo lugar e NÃO fazem a
  // mesma coisa. Enquanto o cartão inteiro chamava a ação principal, passar os
  // olhos numa tarefa A FAZER a marcava como iniciada: data de início, evento e
  // prazo correndo, sem ninguém ter decidido nada.
  ok('§33) abrir o cartão apenas navega',
    /const abrirOTrabalho = useCallback\(\(l: LinhaOperacional\) => \{\s*router\.push/.test(tela),
    'sem comando nenhum antes do push')
  ok('§33) e é ele que o corpo do cartão usa',
    /onClick=\{aoAbrir\} className="min-w-0 flex-1/.test(tela))
  ok('§34) iniciar continua explícito, no botão',
    /onClick=\{aoExecutar\}[\s\S]{0,200}?\{acao\.rotulo\}/.test(tela))
  ok('§34) e só o botão comanda',
    /const irParaOTrabalho[\s\S]{0,400}?acao\.comando === "iniciar"[\s\S]{0,200}?comandar\(/.test(tela))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§18/§22) NÃO EXISTEM DOIS LUGARES PARA EXECUTAR O MESMO TRABALHO')
  // ══════════════════════════════════════════════════════════════════════════
  const { existsSync } = await import('node:fs')
  ok('§18) o painel local da Minha Fila não existe mais',
    !existsSync(join(RAIZ, 'src/components/operacao/tarefa-operacional.tsx')),
    'era um segundo lugar para executar a mesma etapa')
  ok('§1) a Minha Fila não monta executor de etapa', !/StepEditorRouter/.test(tela))
  const global = semComentarios(ler('src/components/operacao/visao-global.tsx'))
  ok('§17) a visão global também não', !/StepEditorRouter/.test(global))

  // O executor vive num lugar só.
  const varrer = (dir: string, acc: string[] = []): string[] => {
    for (const e of require('node:fs').readdirSync(join(RAIZ, dir))) {
      const rel = `${dir}/${e}`
      if (require('node:fs').statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, acc)
      else if (/\.tsx$/.test(rel)) acc.push(rel)
    }
    return acc
  }
  const montam = varrer('src').filter((f) => /<StepEditorRouter/.test(semComentarios(ler(f))))
  ok('§2) UM único lugar monta o executor', montam.length === 1, montam.join(', ') || 'nenhum')
  ok('§4) e é a Central, dentro do processo', montam[0]?.includes('kanban/workflow'), montam[0] ?? '—')

  // §6/§8 — chegar pela fila abre o Workflow, não a visão geral do documento.
  ok('§8) o drawer do documento aceita a aba inicial',
    /abaInicial/.test(semComentarios(ler('src/components/kanban/DocumentoOperationalDrawer.tsx'))))
  ok('§8) e a Central pede WORKFLOW quando veio por deep-link',
    /abaInicial=\{alvo\?\.documentoId != null && alvo\.documentoId === drawerDocId \? "workflow"/.test(central))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§15) O LINK SOBREVIVE — refresh, cópia, e o país certo')
  // ══════════════════════════════════════════════════════════════════════════
  const kanban = semComentarios(ler('src/app/kanban/kanban-content.tsx'))
  // Abrir NÃO pode limpar a URL: quem limpa é fechar. Enquanto o contexto está
  // à vista, o endereço tem de descrevê-lo — senão F5 perde tudo e o link não
  // pode ser passado adiante.
  ok('§15) abrir o processo não apaga o deep-link da barra de endereços',
    !/onModalOpened/.test(kanban),
    'a limpeza no OPEN fazia o refresh cair em /kanban puro')
  ok('§15) fechar é que consome o link', /onModalClosed=\{handleModalClosed\}/.test(kanban))
  ok('§15) e é só aí que a URL é reescrita',
    /handleModalClosed[\s\S]{0,400}?replaceState/.test(kanban))
  // O quadro mostra UM país e UM tipo por vez: chegar pelo link exige posicionar.
  ok('§5) o quadro se posiciona no país/tipo do processo alvo',
    /\/api\/processos\/\$\{initialProcessoId\}\/localizacao/.test(kanban)
    && /setPaisSelecionado\(loc\.pais\)/.test(kanban),
    'sem isso, link de processo espanhol aberto por quem está na Itália não acha nada')
  ok('§5) posicionar é LEITURA — o endpoint só responde onde o processo mora',
    !/\bprisma\.\w+\.(update|create|delete|upsert)/.test(
      semComentarios(ler('src/app/api/processos/[processoId]/localizacao/route.ts'))))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§13/§14) TODA superfície usa o MESMO construtor de URL')
  // ══════════════════════════════════════════════════════════════════════════
  const superficies = [
    ['Minha Fila / cockpit', 'src/components/operacao/central-tarefas.tsx'],
    ['Visão global (Tarefas e Projetos)', 'src/components/operacao/visao-global.tsx'],
  ] as const
  for (const [nome, arq] of superficies) {
    const src = semComentarios(ler(arq))
    ok(`§13) ${nome} navega pelo construtor único`, /urlOperacionalDaTarefa/.test(src))
    ok(`§13) ${nome} não monta \`/kanban?\` na unha`, !/["'`]\/kanban\?/.test(src), arq)
  }
  // A notificação carrega o link JÁ PRONTO — e ele vem do mesmo lugar.
  const comandos = semComentarios(ler('lib/operacional/tarefa-comandos.ts'))
  ok('§14) a notificação usa o mesmo construtor',
    /linkDaTarefa[\s\S]{0,300}?urlOperacionalDaTarefa/.test(comandos))
  ok('§14) e ninguém mais escreve o caminho à mão',
    !/["'`]\/kanban\?processoId=/.test(comandos))

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Quinze certidões, quinze destinos certos — por id, nunca por nome ou posição.'
    : 'A navegação operacional divergiu do contrato.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
