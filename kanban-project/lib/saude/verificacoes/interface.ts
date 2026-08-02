// lib/saude/verificacoes/interface.ts
//
// A SUÍTE DE INTERFACE COBRE O QUE O MENU OFERECE?
//
// As demais verificações leem banco e código. Nenhuma delas sabe se a TELA
// abriu. Isso quem responde é o navegador, na suíte `tests/ui` — e esta
// verificação garante que a suíte continua existindo, continua se alimentando
// da navegação oficial (sem lista paralela que envelhece) e continua deixando
// erro de console falhar o teste.
//
// Suíte que silencia erro em massa é pior que suíte inexistente: dá a sensação
// de cobertura sem a prova.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const RAIZ = process.cwd()
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const existe = (p: string) => existsSync(join(RAIZ, p))

/** Quantidade acima da qual a lista de "ruído ignorado" deixa de ser exceção. */
const LIMITE_RUIDO = 10

registrar({
  id: 'saude.interface.suite-navegador',
  codigo: 'UI-001',
  nome: 'Suíte de interface cobre as telas do menu',
  descricao: 'Verifica se os testes de navegador existem, derivam da navegação oficial e continuam falhando diante de erro de console.',
  dominio: 'INTERFACE',
  modulo: 'Interface / Testes de navegador',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '2.0.0',
  timeoutMs: 15_000,
  orientacao: 'Rode `npm run test:ui`. Tela nova entra em teste automaticamente ao entrar no menu; se não entrou, a suíte perdeu o vínculo com a navegação.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const achados: Achado[] = []

    const temConfig = existe('playwright.config.ts')
    const temPasta = existe('tests/ui')
    const specs = temPasta
      ? readdirSync(join(RAIZ, 'tests/ui')).filter((f) => f.endsWith('.spec.ts'))
      : []

    if (!temConfig || !specs.length) {
      return {
        achados: [{
          chave: 'suite-interface-ausente',
          severidade: 'ERRO',
          titulo: 'Não há suíte de testes de interface',
          descricao: `${temConfig ? 'A configuração existe' : 'Falta playwright.config.ts'} e ${specs.length} spec(s) foram encontrados.`,
          explicacao: 'Sem navegador nenhum teste prova que a tela abre. Erro de renderização só apareceria para o operador.',
          impacto: 'Tela quebrada chega ao usuário sem nenhum alarme antes.',
          entidade: 'Interface',
          quantidade: specs.length,
          recomendacao: 'Restaure a suíte em tests/ui e o script npm run test:ui.',
        }],
        metricas: { specs: specs.length },
        resumo: 'Suíte de interface ausente.',
      }
    }

    // 1) a lista de telas precisa vir da navegação, não de cópia manual
    const telas = existe('tests/ui/telas.ts') ? ler('tests/ui/telas.ts') : ''
    if (!/MANAGEMENT_NAVIGATION/.test(telas)) {
      achados.push({
        chave: 'suite-interface-lista-paralela',
        severidade: 'ERRO',
        titulo: 'A suíte de interface não deriva da navegação oficial',
        descricao: 'tests/ui/telas.ts não importa MANAGEMENT_NAVIGATION.',
        explicacao: 'Lista de telas mantida à mão envelhece: tela nova nasce sem teste e ninguém percebe, porque a suíte segue verde.',
        impacto: 'Cobertura aparente maior que a real.',
        entidade: 'Interface',
        quantidade: 1,
        recomendacao: 'Derive as telas testadas de MANAGEMENT_NAVIGATION.',
      })
    }

    // 2) erro de console precisa continuar reprovando
    const conteudo = specs.map((f) => ler(join('tests/ui', f))).join('\n')
    if (!/pageerror/.test(conteudo) || !/toEqual\(\[\]\)/.test(conteudo)) {
      achados.push({
        chave: 'suite-interface-ignora-console',
        severidade: 'ALERTA',
        titulo: 'A suíte de interface não reprova erro de navegador',
        descricao: 'Nenhum spec escuta `pageerror` exigindo lista de erros vazia.',
        explicacao: 'Tela que renderiza com exceção no console está quebrada mesmo parecendo inteira.',
        impacto: 'Defeito silencioso passa pela suíte.',
        entidade: 'Interface',
        quantidade: specs.length,
        recomendacao: 'Volte a falhar o teste quando houver erro de console.',
      })
    }

    // 3) a lista de ruído ignorado precisa continuar sendo exceção
    const ruido = (telas.match(/RUIDO_CONSOLE = \[([\s\S]*?)\]/)?.[1] ?? '')
      .split('\n').filter((l) => l.includes("'")).length
    if (ruido > LIMITE_RUIDO) {
      achados.push({
        chave: 'suite-interface-ruido-demais',
        severidade: 'ALERTA',
        titulo: `${ruido} padrões de erro estão sendo ignorados na suíte de interface`,
        descricao: `A lista de ruído tolerado cresceu para ${ruido} entradas (limite ${LIMITE_RUIDO}).`,
        explicacao: 'Cada padrão ignorado é um defeito que a suíte deixou de ver. Silenciar em massa transforma o teste em carimbo.',
        impacto: 'A suíte passa a dar garantia que não tem.',
        entidade: 'Interface',
        quantidade: ruido,
        recomendacao: 'Corrija a origem do erro em vez de ampliar a lista de exceções.',
      })
    }

    return {
      achados,
      metricas: { specs: specs.length, ruidoTolerado: ruido },
      resumo: `${specs.length} spec(s) de interface, derivados da navegação oficial.`,
    }
  },
})
