# 26 — DELETE de Processo: lifecycle seguro

Consolidado em 13/09/2026. Corrige exclusivamente o achado CRÍTICO (G1) das
auditorias de integridade sistêmica ([21](21-integridade-sistemica-grafo-dependencias.md)–
[25](25-fechamento-compreensao-sistemica.md)). Nenhum outro gap foi tocado
nesta rodada — ver seção "Fora de escopo" ao final.

## Problema

`DELETE /api/processos/[processoId]` fazia `prisma.processo.delete()` cru.
`ObrigacaoEconomica.processoId` tem `onDelete: Cascade` no schema — apagar o
Processo apagava fisicamente, sem nenhuma pergunta ao domínio, obrigações
financeiras já `PAGO`/`CONCILIADO`/liquidadas. A mesma rota também chamava
`prisma.arvore.delete()` diretamente quando o processo era o último de uma
árvore — sem `analisarExclusaoArvore`, sem frase de confirmação, contornando
o guard que `DELETE /api/arvore/[arvoreid]` já paga o preço de ter.

## Causa-raiz

A rota foi escrita à parte do mecanismo de análise de impacto que
`src/services/pessoa-ciclo-vida.ts` já construiu para Pessoa. Esse mecanismo,
além disso, é **insuficiente por desenho** para Processo: `levantarFatosProtegidos`
só enxerga obrigação ligada a `personId`/`documentoId` — uma obrigação lançada
direto no `processoId` (contrato, custo administrativo) é invisível para ele.

## Semântica de DELETE de Processo (a partir de agora)

1. **Fato financeiro materializado bloqueia por inteiro.** Se existe qualquer
   `OcorrenciaFinanceira` de movimento (pagamento/estorno/baixa/etc., mesma
   lista `OCORRENCIAS_DE_MOVIMENTO` de `pessoa-ciclo-vida.ts`) ou `LedgerEntry`
   de liquidação (conta Caixa/Banco) ligado a uma `ObrigacaoEconomica` deste
   processo, a exclusão é **recusada por inteiro** (409). Binário, como
   Pessoa: sem fato → exclusão completa; com fato → nada é tocado. Não existe
   "exclusão parcial que preserva só o financeiro" — decidiu-se não criar essa
   semântica nesta rodada (ver "Fora de escopo").
2. **Árvore/Família nunca são tocadas por este DELETE.** A chamada direta a
   `prisma.arvore.delete()` foi removida — não foi substituída por nenhuma
   outra ação sobre a Árvore. Se o processo excluído era o último de uma
   árvore, ela fica órfã (sem processo) e permanece para os mecanismos
   canônicos já existentes (`DELETE /api/arvore/[arvoreid]` ou o job
   `limpar-arvores-orfas`) decidirem o destino dela. `removerFamiliaSeOrfa`
   (comportamento preexistente, já guardado por recontagem) continua sendo
   chamado depois — não foi alterado.
3. **O que é exclusivo do processo sai junto** (Tarefas, `NecessidadeDocumental`,
   `PhaseWorkflowStepInstance`, `AnexoProcesso`, `SolicitacaoDocumento`, e a
   própria `ObrigacaoEconomica`/histórico financeiro **quando não há fato
   protegido**) — via `onDelete: Cascade` do schema, inalterado; nenhuma
   anotação de FK foi tocada nesta correção (ver Passo 4 do mandato: FK é
   integridade referencial, não lifecycle — a guarda vive no serviço).

## Arquivos alterados

- **`src/services/processo-ciclo-vida.ts`** (novo) — `analisarExclusaoProcesso`
  (plano só-leitura, mesmo usado pelo preview e recalculado dentro da
  transação) e `excluirProcesso` (execução transacional: `SELECT ... FOR
  UPDATE` na linha do Processo, recálculo do plano com o lock em mãos,
  recusa se houver fato protegido, senão `processo.delete()` + `LogAuditoria`
  na mesma transação).
- **`src/services/pessoa-ciclo-vida.ts`** — 1 linha: `OCORRENCIAS_DE_MOVIMENTO`
  passou a `export` para o novo serviço reusar a MESMA régua de fato
  financeiro protegido, sem redefini-la. Nenhum comportamento de Pessoa
  mudou (confirmado por `pessoa-tortura.test.ts`, 197/197 continuam verdes).
- **`src/app/api/processos/[processoId]/route.ts`** — `DELETE` reescrito para
  chamar `excluirProcesso` em vez de `prisma.processo.delete()` cru; exige
  `processos.excluirDefinitivo` em vez de `processos.excluir`; não chama mais
  `prisma.arvore.delete()`.
- **`src/app/api/processos/[processoId]/impacto-exclusao/route.ts`** (novo) —
  `GET`, preview server-side (`analisarExclusaoProcesso`), mesma permissão do
  DELETE.
- **`src/lib/confirmar-exclusao-processo.ts`** (novo) — busca o preview e
  confirma com o operador; usado pelos DOIS pontos de entrada reais da ação
  (lista de processos e modal de detalhes), para não duplicar o texto do
  aviso em dois lugares que podem divergir.
- **`src/components/processos-lista.tsx`** / **`src/components/kanban/atividade-details-modal.tsx`**
  — os dois `window.confirm` genéricos viraram `confirmarExclusaoProcesso`;
  os dois gates de UI (`pode(...)`) migraram para `processos.excluirDefinitivo`.
- **`src/lib/permissoes.ts`** — nova permissão `processos.excluirDefinitivo`,
  classificada **EXCLUSIVA** (mesma classe de `processos.moverFaseManual`):
  nunca concedida por perfil padrão nem por `tipo='admin'`, só por concessão
  nominal (perfil ou `permissoesCustom`). `processos.excluir` **não foi
  alterada** — continua existindo e sendo usada por `DELETE /api/familias/[id]`,
  fora de escopo desta correção.
- **`scripts/delete-processo-lifecycle-seguro.test.ts`** (novo, 33 asserções).
- **`scripts/guard-necessidade-documental.test.ts`** /
  **`scripts/guard-ciclo-vida-pessoa.test.ts`** — allowlist nominal para o
  novo arquivo de teste (padrão já estabelecido no projeto para qualquer
  script que crie/leia os modelos protegidos por esses guards).
- **`package.json`** — `test:delete-processo`.

## Por que a proteção não foi feita trocando `onDelete`

Nenhuma anotação do `schema.prisma` foi alterada. Trocar `Cascade` por
`Restrict`/`SetNull` quebraria o caso legítimo (processo sem fato protegido
deve sair inteiro, sem fricção) e não resolveria nada sozinho — o problema
nunca foi a anotação, foi a ausência de uma pergunta ao domínio ANTES de
chegar nela. A guarda vive inteiramente em `processo-ciclo-vida.ts`.

## RBAC

`processos.excluirDefinitivo` — EXCLUSIVA. Nenhuma permissão existente
representa esta ação corretamente: `processos.excluir` é comum demais (é o
próprio achado CRÍTICO da auditoria — Assistente/Estagiário são o único
corte hoje) e é compartilhada com `DELETE /api/familias/[id]` (fora de
escopo, não pode ser restringida sem afetar aquela rota);
`sistema.exclusaoDefinitiva` é do domínio de config/catálogo, semanticamente
errado para Processo. Enforcement no backend (`verificarPermissao`) e no
frontend (`usePermissoes().pode`) usam a mesma chave. Nenhum perfil ganhou
poder novo — o efeito é estritamente de restrição: hoje, nenhum usuário real
em produção tem essa permissão (3 usuários reais confirmados, 0 com
`permissoesCustom` tocando este ponto) até que um administrador a conceda
nominalmente pela UI de perfis/permissões (que já lista `PERMISSOES`
dinamicamente — nenhuma tela nova foi necessária).

## Preview

`GET /api/processos/[processoId]/impacto-exclusao` — server-side, mesma
função (`analisarExclusaoProcesso`) que o DELETE recalcula depois. Mostra
contagem de tarefas/necessidades/passos/anexos/solicitações que sairiam, e
a lista de fatos financeiros protegidos quando existirem (nesse caso a
exclusão é bloqueada e o preview já informa isso antes de qualquer tentativa).

## Concorrência e idempotência

`excluirProcesso` trava a linha do Processo (`SELECT ... FOR UPDATE`) antes
de recalcular o plano — mesmo padrão de `pessoa-ciclo-vida.ts` e
`exclusao-definitiva.ts`. Duas exclusões concorrentes serializam: a segunda,
ao destravar, encontra a linha já removida e retorna `PROCESSO_NAO_ENCONTRADO`
sem tentar nada — idempotente por construção, sem estado parcial possível
(provado no Caso 7 do teste, 2 chamadas concorrentes reais via `Promise.all`).
Não foi necessário `lockVersion` — o próprio lock de linha basta para este
caso (Processo não tem esse campo; não foi criado agora).

## Migration

Nenhuma. Nenhum model, campo ou `onDelete` foi alterado no `schema.prisma`.

## Registros existentes

Consulta somente leitura em produção (13/09/2026, sem escrita): 2 Processos
reais, 2 `ObrigacaoEconomica` com `processoId`, **zero** ocorrência de
movimento financeiro ligada a elas. **Nenhum processo real seria bloqueado
pelo novo guard hoje, e nenhum dado existente ficou semanticamente
inconsistente** — nenhuma reconciliação foi necessária, e nenhuma foi feita.

## Testes

`scripts/delete-processo-lifecycle-seguro.test.ts`, 33 asserções, banco de
teste local:
- RBAC: permissão é EXCLUSIVA; `tipo=admin` sozinho não concede; concessão
  nominal concede.
- Processo limpo → exclusão sucede, histórico gravado.
- Obrigação aberta (sem movimento) → não bloqueia, sai junto.
- **Obrigação PAGA (sem personId/documentoId — o caso que `pessoa-ciclo-vida.ts`
  não via) → exclusão RECUSADA, processo e obrigação intactos, nenhuma
  auditoria de "excluído" gravada.**
- Árvore compartilhada por 2 processos → excluir um não afeta o outro nem a
  árvore nem a pessoa.
- Processo único da árvore → árvore fica órfã, mas **não é apagada** por
  este DELETE.
- DELETE repetido → idempotente, sem duplicar auditoria.
- 2 exclusões concorrentes → exatamente uma efetiva.
- Preview bate com o que realmente sai (contagem de anexo).

Regressão: `pessoa-tortura.test.ts` (197/197) e `test:guards-arquitetura`
(20 sub-suítes, 100% verde) rodados depois da mudança — nenhuma quebra.
`npm run typecheck`, `npm run lint` (0 erros, mesmos 13 warnings
pré-existentes em arquivos não tocados) e `npm run build` (produção) limpos.

## Validação autenticada pela interface real (rodada de fechamento, mesma data)

Encontrado e corrigido durante esta validação: `confirmar-exclusao-processo.ts`
(preview) e `processos-lista.tsx` (DELETE) chamavam `fetch()` **sem o header
`Authorization`** — `extrairUsuarioKanban` só lê o header, nunca o cookie de
sessão, então as duas chamadas voltavam 401 e a interface caía no fallback
genérico (sem contagem, sem o aviso de bloqueio financeiro). Corrigido nos
dois pontos (commit `d62a3760`). Regressão confirmada depois: `npm run build`
completo (guards + baseline + `next build`) e o teste de serviço (33/33)
verdes.

**Banco de teste local (mutação real, controlada)** —
`tests/ui/delete-processo-lifecycle.smoke.ts`, 2 testes, 100% verde:
preview real citando contagens corretas; bloqueio por fato financeiro visual
(`alert`) **e** server-side (409) para o mesmo processo; exclusão real de um
processo limpo, persistindo depois de `reload`; Árvore/Pessoa compartilhada
com outro processo continuam intactas ao excluir um dos dois; segunda
exclusão do mesmo processo → 404 (idempotente); RBAC frontend (item
"Excluir" ausente do menu) e backend (403) para um `tipo='admin'` **sem** a
concessão nominal — mesmo sendo admin; zero 5xx; todo 4xx de API é um dos
provocados de propósito pelo próprio teste.

**Produção real (leitura + RBAC, sem exclusão destrutiva)** — servidor local
rodando o build já deployado, apontado para o banco de produção (token
assinado localmente não é aceito pelo Vercel real — mesma técnica já usada
nas Etapas 4-6 desta sessão): `GET /api/me/permissoes` do admin real inclui
`processos.excluirDefinitivo: false`; `GET .../impacto-exclusao` e `DELETE`
para o Processo 592 real ("Teste") retornam 403 **sem tocar em nada**;
requisição sem token retorna 401; navegação autenticada real
(`/kanban`→Itália→Lista) mostra o Processo 592 real e confirma que "Excluir"
não aparece no menu para este admin; zero 5xx, console limpo. Processo 592
confirmado byte-idêntico (`id`/`nome`) antes e depois de toda a validação —
**nenhuma exclusão destrutiva foi executada contra produção**.

## Evidência de produção

Consulta de leitura confirmou 2 Processos / 2 obrigações / 0 movimento —
ver "Registros existentes" acima. Deploy realizado (`vercel --prod`,
commit `d62a3760`, alias `https://app.discovery.com.br`, `readyState: READY`)
e validado conforme a seção anterior.

## Limitações / itens FORA DE ESCOPO (não tocados nesta rodada)

DELETE de Pessoa/Requerente/Documento/Serviço/Árvore; `limpar-arvores-orfas`;
`Fornecedor`×`OrgaoProtocolo`; `/api/anexos`; `VersaoGenealogica`; dual-write
financeiro; `Receita`/`Custo`; `FINANCEIRO_DUAL_WRITE`;
`FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA`; preço global/override local; usuário
inativo; lifecycle documental; invalidação documental; `phase.completed`/
outbox; jobs/crons; reconciliações globais; qualquer outro gap das
auditorias 22–25. Nenhum desses foi alterado, mesmo onde a investigação
desta correção passou perto deles.

---

DELETE DE PROCESSO CORRIGIDO E VALIDADO — NENHUMA OUTRA CORREÇÃO IMPLEMENTADA
