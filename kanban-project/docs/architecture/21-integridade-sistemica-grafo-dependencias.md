# 21 — Integridade sistêmica: grafo de dependências e propagação de impacto

Consolidado em 13/09/2026. Princípio arquitetural permanente do Discovery,
não amarrado a nenhuma etapa ou rodada específica — governa toda mudança de
estado do domínio, daqui em diante.

## Regra mestra

> O Discovery é um grafo de domínio conectado. Nenhuma mutação deve ser
> tratada isoladamente. Toda mudança de estado deve propagar suas
> consequências por todas as dependências relevantes, respeitando
> ownership, compartilhamento, histórico, financeiro e semântica de
> negócio, até que o sistema inteiro convirja novamente para uma única
> verdade canônica.

> Não execute o pedido como uma alteração local. Compreenda o sistema como
> operador, admin e engenheiro, e faça o Discovery inteiro convergir para a
> nova verdade.

A unidade de trabalho do engenheiro **não é** a tela, o endpoint, a tabela
ou a função. É a **mudança de estado do domínio** e todas as suas
consequências no sistema.

## Modelo mental obrigatório

Toda alteração deve ser pensada simultaneamente como OPERADOR (efeito no
trabalho diário), ADMINISTRADOR (regras/permissões/auditoria/impacto
organizacional) e ENGENHEIRO (banco/integridade referencial/transação/
idempotência/concorrência/projeções/efeitos colaterais).

## Regra da origem e regra de propriedade

Toda entidade derivada deve ter origem identificável
(`originType`/`originId`/`originRule`/`originEvent` — ou o equivalente já
existente; **não criar esses campos automaticamente**, primeiro auditar
como a proveniência já é representada). Para cada relação, classificar:
OWNER, DEPENDENT, REFERENCE, SHARED RESOURCE, PROJECTION — validado contra
o domínio e o código reais, nunca presumido por FK.

**Dependência semântica > foreign key.** Pode haver dependência sem FK, FK
histórica, JSON/metadata com IDs, vínculo criado só em serviço, relação
indireta. A busca por dependências cobre: schema Prisma, migrations,
services, repositories, handlers, APIs, jobs, cron, eventos, outbox,
materializações, queries, componentes, filtros, cache, metadata/JSON.

## Classificação de dependências (para qualquer exclusão/alteração)

- **A. Exclusiva** — só existe por causa da entidade-pai; some quando a
  origem some legitimamente.
- **B. Compartilhada** — usada por mais de uma entidade; nunca apagar,
  desvincular ou recalcular conforme regra.
- **C. Referência histórica** — representa algo que aconteceu (histórico,
  auditoria, evento, decisão, pagamento, comunicação); não presumir
  destruição — avaliar preservação/anonimização/tombstone.
- **D. Projeção/dado derivado** — não é fonte de verdade; deve
  desaparecer/recalcular/reconstruir quando a origem mudar.
- **E. Registro financeiro/legal materializado** — cancelamento/estorno/
  inativação/reversão em vez de exclusão física.
- **F. Referência externa** — integração/protocolo/fornecedor/terceiro;
  avaliar impacto antes de remover.

## Contrato de ciclo de vida por entidade

Para cada entidade central, determinar quais operações fazem sentido:
CREATE, UPDATE, REASSIGN, ACTIVATE, DEACTIVATE, CANCEL, INVALIDATE, REOPEN,
REPLACE, ARCHIVE, DELETE, RECONCILE. É proibido usar duas ações diferentes
como sinônimo por conveniência técnica:

```
CANCELAR ≠ EXCLUIR          INVALIDAR ≠ EXCLUIR
INATIVAR ≠ EXCLUIR          SUBSTITUIR ≠ SOBRESCREVER
REABRIR ≠ RECRIAR           RECONCILIAR ≠ RECRIAR
CONCLUIR ≠ SATISFAZER NECESSARIAMENTE
ENCERRAR ≠ CONCLUIR COM SUCESSO
```

(Já provado corretamente na prática: `novaViaDocumental` é SUBSTITUIR sem
SOBRESCREVER — `substituidoEm` marca, não apaga; reentrada de fase é HERDAR,
não RECRIAR — ver [19](19-circuito-operacional-completo.md); CANCELADA≠
CONCLUÍDA já é regra permanente — ver `cancelada-diferente-de-concluida` na
memória do projeto.)

## Regra contra orfandade semântica e efeitos zumbis

Não basta ausência de FK quebrada (orfandade referencial). Uma entidade
pode ter FK válida e ainda ser órfã **semanticamente** (ex.: Tarefa aponta
para Processo válido, mas a Pessoa que originou a obrigação foi removida).
Auditar as duas. Uma entidade removida/cancelada não pode continuar
produzindo efeitos futuros: cron recriando o que foi removido, notificação
futura acionável, SLA contando, card reaparecendo, outbox ainda disparando,
custo automático posterior, indicador ainda contabilizando.

## Blast radius, dry-run e reversibilidade

Toda ação destrutiva relevante deve ser classificada em BAIXO/MÉDIO/ALTO/
CRÍTICO e em REVERSÍVEL/PARCIALMENTE REVERSÍVEL/IRREVERSÍVEL. Para ALTO/
CRÍTICO, o backend deve — quando tecnicamente aplicável — conseguir calcular
o impacto sem executar (dry-run), e a operação deve ter pós-condições
verificáveis explícitas antes de ser considerada concluída.

## Definição final de "concluído" para mudança estrutural

1. nova verdade canônica correta; 2. dependências legítimas reagiram;
3. exclusivas inválidas removidas; 4. compartilhadas preservadas;
5. histórico necessário preservado; 6. financeiro coerente; 7. sem
orfandade referencial; 8. sem orfandade semântica; 9. sem efeito zumbi;
10. nenhum job recria indevidamente o removido; 11. projeções refletem a
mesma verdade; 12. RBAC protege a ação; 13. retry seguro; 14. concorrência
tratada; 15. pós-condições verificadas; 16. testes E2E comprovam a
propagação.

## Code review mental obrigatório antes de dar por pronta uma mudança estrutural

*"Se este objeto desaparecer, o que sobra? Se mudar, quem fica incorreto?
Se a operação rodar duas vezes, o que acontece? Se falhar no meio? Se outro
usuário agir ao mesmo tempo? Se um cron rodar depois, ele recria algo? Se os
dados forem antigos, isso quebra? Se alguém consultar outra tela, verá a
mesma verdade?"*

## Onde isso se aplica ao que já foi construído

Este princípio não invalida nada das Etapas 1–6 nem do diagnóstico de
Emissão Documental ([20](20-emissao-documental-diagnostico.md)) — ele é a
generalização explícita de práticas já seguidas ali (ex.: `pessoa-ciclo-vida.ts`
já calcula `fatosProtegidos` antes de permitir hard-delete; `novaViaDocumental`
já preserva a via anterior; a reentrada de fase já herda em vez de recriar).
A auditoria completa do grafo de dependências/lifecycle contracts pedida
nesta rodada (mapa de entidades-raiz, ownership real, cascatas existentes/
ausentes/perigosas, órfãos referenciais e semânticos, efeitos zumbis,
invariantes globais, matriz de risco, plano mínimo) é tratada como rodada
própria — ver acompanhamento em conversa; não implementar nada até
autorização.
