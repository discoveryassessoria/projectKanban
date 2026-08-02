# Reestruturação do Gerenciamento — 25/07/2026

Reorganização **da camada de navegação** (menu, agrupamentos, rotas lógicas e breadcrumbs)
para a arquitetura oficial de 11 módulos. Nenhuma tela foi reescrita, nenhuma API teve
contrato alterado, nenhum dado foi migrado ou apagado.

Fonte única: `src/components/gerenciamentoComponents/managementNavigation.tsx`
(estrutura + regras de submenu/seção, puras e testáveis).
`src/app/administrator/page.tsx` apenas **renderiza** e mapeia `screen → componente`.

Guardas: `npm run test:nav` (73 asserções), `npm run test:accordion` (11 asserções) e `npm run lint:gerenciamento` (0 erros).

---

## 1. Tabela de migração — itens que existiam no menu antigo

| Item antigo | Rota antiga | Novo menu | Nova rota | Página/componente reaproveitado | Compatibilidade | Redirecionamento |
|---|---|---|---|---|---|---|
| Painel do Gerenciamento | `?screen=overview` | Visão Geral (módulo direto) | `?screen=overview` | `OverviewTab` | idêntica | — |
| Tipos de Processo | `?screen=proctypes` | Processos › Cadastros | igual | `TipoProcessoTab` | idêntica | — |
| Países e Regiões | `?screen=countrycatalog` | Processos › Cadastros | igual | **`PaisesRegioesTab`** (era `CatalogTab` sem persistência) | rota igual, tela agora real | — |
| — (só existia como modal em Tipos de Processo) | — | Processos › Cadastros › Modalidades | `?screen=modalidades` | **`ModalidadesTab`** (mesma API do modal) | novo item, API existente | — |
| Variações da Fase | `?screen=phasemodes` | Processos › Estrutura | igual | `ModosInternosFasesTab` | idêntica | — |
| — (catálogo só era lido pelo Workflow Macro) | — | Processos › Estrutura › Fases | `?screen=fases` | **`CatalogoFasesTab`** + API `catalogo-fases` | novo item | — |
| Versões por Processo | `?screen=cfgversions` | Processos › Configurações › Versões | igual | **`VersoesConfiguracaoTab`** (era scaffold; rascunho em `?screen=cfgversions-rascunho`) | rota igual, tela agora real | — |
| Workflow Macro | `?screen=macrokanban` | Workflow › Fluxos | igual | `MacroKanbanTab` | idêntica | — |
| Workflow Interno | `?screen=phaseiwf` | Workflow › Fluxos | igual | `PhaseWorkflowsFasesTab` | idêntica | — |
| Automações por Fase | `?screen=opauto` | Automações › Financeiras | `?screen=autofin` | `PhaseAutomationsFasesTab` (mesma tela, aba inicial `financial`) | preservada | **alias `opauto → autofin`** |
| Automações por Fase (aba Eventos) | `?screen=opauto` | Automações › Eventos | `?screen=autoevt` | `PhaseAutomationsFasesTab` (aba inicial `event`) | preservada | — |
| Simulação | `?screen=simfase` | Automações › Configurações | igual | `SimulacaoFaseTab` | idêntica | — |
| Histórico de Execuções | `?screen=execmatrix` | Automações › Configurações | igual | `ExecMatrixTab` | idêntica | — |
| Tipos de Documento | `?screen=doctypes` | Documentos e Protocolos › Documentos | igual | `TiposDocumentoTab` | idêntica | — |
| Categorias Documentais | `?screen=doccats` | Documentos e Protocolos › Documentos | igual | `CategoriasDocumentaisTab` | idêntica | — |
| Regras Documentais | `?screen=docrules` | Documentos e Protocolos › Regras | igual | `RegrasDocumentaisTab` | idêntica | — |
| Catálogo de Serviços | `?screen=products` | Serviços | igual | `ProdutosServicosTab` | idêntica | — |
| Configurações Financeiras | `?screen=catalog` | Financeiro | igual | `ProdutosTab` | idêntica | — |
| Tabelas de Preços | `?screen=pricingtable` | Financeiro › Tabela de Valores | igual | `TabelaValoresTab` | idêntica | — |
| Regras de Precificação | `?screen=discrules` | Financeiro › Tabela de Valores | igual | `RegrasDescontoTab` | idêntica | — |
| Aplicabilidade Econômica | `?screen=pricing` | Financeiro › Tabela de Valores | igual | `AplicabilidadeEconomicaTab` | idêntica | — |
| Contas Bancárias | `?screen=accounts` | Financeiro › Tesouraria | igual | `ContasTab` | idêntica | — |
| Bancos | `?screen=banks` | Financeiro › Tesouraria | igual | `BancosTab` | idêntica | — |
| Carteiras de Recebimento | `?screen=wallets` | Financeiro › Tesouraria | igual | `CarteirasTab` | idêntica | — |
| Moedas | `?screen=currencies` | Financeiro › Moedas | igual | `MoedasTab` | idêntica | — |
| Câmbio | `?screen=fx` | Financeiro › Moedas | igual | `CambioTab` | idêntica | — |
| Formas de Pagamento | `?screen=methods` | Financeiro › Cobrança | igual | `FormasPagamentoTab` | idêntica | — |
| Condições de Pagamento | `?screen=paycond` | Financeiro › Cobrança | igual | `CondicoesPagamentoTab` | idêntica | — |
| Taxas de Pagamento | `?screen=fees` | Financeiro › Cobrança | igual | `TaxasPagamentoTab` | idêntica | — |
| Impostos | `?screen=taxes` | Financeiro › Fiscal | igual | `ImpostosTab` | idêntica | — |
| Comissões | `?screen=commrules` | Financeiro › Comissões | igual | `RegrasComissaoTab` | idêntica | — |
| Fornecedores | `?screen=suppliers` (Financeiro **e** Pessoas) | **Órgãos e Organizações › Organizações** (ocorrência única) | igual | `FornecedoresTab` | idêntica; deixa de aparecer 2× | — |
| Cartórios e Órgãos | `?screen=organs` | Órgãos e Organizações › Organizações | igual | `OrgaosProtocoloTab` | idêntica | — |
| Diagnóstico Executivo | `?screen=mgmthealth` | Relatórios e Indicadores › Indicadores | igual | `HealthTab` | idêntica | — |
| Diagnósticos | `?screen=diagnostics` | Relatórios e Indicadores › Relatórios | igual | `DiagnosticsTab` | idêntica | — |
| Diagnóstico de Configuração | `?screen=cfgdiagnosis` | Relatórios e Indicadores › Relatórios | igual | **`DiagnosticoConfiguracaoTab`** (era scaffold; rascunho em `?screen=cfgdiagnosis-rascunho`) | rota igual, tela agora real | — |
| Usuários | `?screen=users` | Usuários e Acessos | igual | `UsersTab` | idêntica | — |
| Perfis e Permissões | `?screen=roles` | Usuários e Acessos › **Perfis** | igual | `RolesTab` | idêntica | — |
| Equipes | `?screen=teams` | Usuários e Acessos › Grupos | igual | `TeamsTab` | idêntica | — |
| Departamentos | `?screen=departments` | Usuários e Acessos › Grupos | igual | `DepartamentosTab` | idêntica | — |
| Cargos | `?screen=rolecat` | Usuários e Acessos › Grupos | igual | `RoleCatalogTab` | idêntica | — |
| Módulo “Pessoas e Organizações” | `?module=grp_pessoas` | Órgãos e Organizações | `?module=grp_orgaos` | — | preservada | **alias de módulo** |

## 2. Telas que existiam registradas mas estavam FORA do menu (órfãs) — agora com casa

| Tela | Rota | Novo menu | Situação anterior |
|---|---|---|---|
| Executor do Motor | `?screen=execmotor` | Workflow › Configurações | componente real sem item de menu |
| Diagnóstico de Runtime | `?screen=runtimediag` | Workflow › Configurações | componente real sem item de menu |
| Migração do Motor | `?screen=migmotor` | Workflow › Configurações | componente real **sem rota** (não estava no mapa de telas) |
| Perfis de Permissão do Motor | `?screen=permmotor` | Usuários e Acessos › Permissões | componente real **sem rota** |
| Catálogo Mestre | `?screen=catalogmestre` | Sistema › Cadastros Auxiliares | oculto |
| Auditoria e Logs | `?screen=audit` | Sistema | registrado, fora do menu |
| SLA e Prazos | `?screen=sla` | Processos › Configurações › SLA | registrado, fora do menu — agora tela REAL (`SLAConfiguracaoTab`); rascunho em `?screen=sla-rascunho` |
| Configurações Gerais | `?screen=settings` | Sistema | registrado, fora do menu |
| Modelos | `?screen=templates` | Sistema › Cadastros Auxiliares | registrado, fora do menu |
| Notificações | `?screen=notifications` | Sistema › Comunicações | registrado, fora do menu |
| Importação / Exportação | `?screen=impexp` | Relatórios › Exportações | registrado, fora do menu |
| Saúde do Sistema | `?screen=syshealth` | Relatórios › Indicadores | registrado, fora do menu |

## 3. Telas mantidas OCULTAS (rota preservada, sem item de menu)

`certtypes` (alias → `doctypes`), `docmatrix`, `protocols`, `backup`, `permprofiles` (alias
histórico de `roles`), `honorariums`, `estruturafin`, `precificacao`, `comercial`,
`pagamentos`, `fornecedoresconc`, `integracaofin`.

São telas legadas/concentradoras que duplicariam conceitos no menu. Continuam acessíveis por
`?screen=<key>` — nenhuma foi removida do mapa de telas.

## 4. Segunda leva (26/07) — consultas consolidadas sobre dados reais

Cinco itens que estavam desabilitados (ou eram rascunho) viraram telas REAIS, todas sobre
um **read-model único** `/api/gerenciamento/configuracao-processo` (somente leitura — a
edição continua nas telas donas, sem segunda porta de escrita):

| Item oficial | Rota | O que mostra |
|---|---|---|
| Processos › Configurações › SLA | `?screen=sla` | prazo de cada fase, acumulado das obrigatórias e maior SLA de passo |
| Processos › Configurações › Versões | `?screen=cfgversions` | versão do Macro, de cada fase e de cada Workflow Interno |
| Processos › Configurações Gerais | `?screen=proccfg` | identidade e situação de todos os tipos de processo |
| Workflow › Transições | `?screen=transicoes` | cadeia de→para com a regra de entrada de cada fase |
| Relatórios › Diagnóstico de Configuração | `?screen=cfgdiagnosis` | checklist real do que falta para o tipo operar |

Mais dois, por reuso e por status real:

| Item oficial | Rota | Implementação |
|---|---|---|
| Financeiro › Governança | `?screen=governanca` | `LogAuditoriaTab escopo="financeiro"` — MESMA trilha e API, recorte das entidades financeiras |
| Sistema › Integrações | `?screen=integracoes` | `IntegracoesTab` + `/api/gerenciamento/integracoes` — estado real de câmbio, storage, motor e cron (nunca expõe valor de variável) |

Os rascunhos substituídos continuam acessíveis: `?screen=sla-rascunho`,
`?screen=cfgversions-rascunho`, `?screen=cfgdiagnosis-rascunho`.

## 5. Terceira leva (26/07) — os 8 últimos itens implementados

Os itens que restavam desabilitados passaram a ter tela real. **Zero itens desabilitados no menu.**

Tabelas novas (migration `20260821000000_cadastros_gerenciamento`, 100% aditiva e idempotente,
aplicada em produção pelo `prod-apply-cadastros-aditivas.mjs`):
`CategoriaServico`, `CategoriaOrganizacao` + `OrganizacaoCategoria`, `GrupoUsuario` +
`GrupoUsuarioMembro`, `CargoCadastro`, `ConfiguracaoSistema`,
`ModeloDocumento`, `RegraNotificacao`.

| Item oficial | Rota | Implementação |
|---|---|---|
| Serviços › Categorias | `?screen=servcats` | cadastro real `CategoriaServico` |
| Órgãos › Categorias | `?screen=orgcats` | cadastro real `CategoriaOrganizacao` (N:N com organização) |
| Financeiro › Crédito | `?screen=credito` | consulta real: gerado/disponível/utilizado/revogado por crédito |
| Financeiro › Documentos Financeiros | `?screen=docfin` | recibos e faturas emitidos + numerações em uso |
| Usuários › Auditoria de Acessos | `?screen=accaudit` | **o login passou a gravar trilha** (`entidade=ACESSO`, LOGIN/LOGIN_NEGADO, IP e agente; nunca a senha) |
| Sistema › Identidade Visual | `?screen=identidade` | marca, logo e cores persistidos em `ConfiguracaoSistema`, com pré-visualização |
| Relatórios › Dashboards | `?screen=dashboards` | índice dos painéis reais com números vivos e link que abre cada um |

> **Classificação financeira — eliminada em 02/08/2026.** A seção
> `Financeiro › Classificação` e os três cadastros que viviam nela — **Categorias
> Financeiras** (`?screen=categories`, `CategoriaFinanceira`), **Plano de Contas**
> (`?screen=coa`, `PlanoConta`) e **Centros de Custo** (`?screen=costcenters`,
> `CentroCusto`) — foram removidos por inteiro: menu, telas, APIs
> (`/api/gerenciamento/{categorias,plano-contas,centros-custo}`,
> `/api/categorias-financeiras`, `/api/financeiro/v3/centros-custo`,
> `/api/financas/cc`), exportações, seeds e tabelas
> (migration `20260902200000_remove_classificacao_financeira`).
> Sem substituto: **o comportamento financeiro pertence ao CADASTRO MESTRE**, na sua
> própria Configuração Financeira (`ProdutoFinanceiro`) — natureza financeira,
> cobrável, repasse, reembolsável, comissão (novo `regraComissaoId`, quando
> aplicável), fornecedor padrão, condição de pagamento e ativo/inativo. Preço
> continua exclusivo da Tabela de Valores. As URLs antigas caem em Configurações
> Financeiras (alias → `catalog`). O Ledger do motor V3 não é afetado: ele grava a
> conta contábil como texto, do plano fixo em `lib/financeiro/ledger/plano-contas.ts`
> (`PlanoContaFinanceira`, tabela interna do motor, permanece).
> Onde havia quebra por categoria (DRE, Contas a Pagar), a dimensão passou a ser o
> **fornecedor** — real, já existente, sem inventar rótulo.
> Guardas: `npm run test:nav`, `test:overview-projecao`, `ssot-financeiro`.

> **Protocolos — eliminado em 02/08/2026.** O item
> `Documentos e Protocolos › Protocolos › Tipos de Protocolo` (`?screen=prottypes`,
> tabela `TipoProtocoloCadastro`), o rascunho `?screen=protocols` e o catálogo
> `op_prottypes` foram removidos por inteiro. Não houve cadastro substituto: um
> protocolo é uma OCORRÊNCIA operacional registrada dentro do Processo (aba
> Protocolos), que gera Evento na Timeline e entra no Histórico — a única fonte
> cronológica oficial. O módulo passa a ter apenas **Documentos** e **Regras**.
> As URLs antigas caem no painel do Gerenciamento (alias → `overview`).
> Migration `20260902000001_protocolo_ocorrencia_do_processo`. Guarda: `npm run test:nav`.

> **Marcos — eliminado em 02/08/2026.** O item `Processos › Estrutura › Marcos`
> (`?screen=marcos`, tabela `MarcoProcesso`) foi removido por inteiro: menu, rota,
> spec do motor de cadastros, exportação e tabela (migration
> `20260902000000_remove_marcos_processo`). Ele não foi substituído por outro
> cadastro — eventos importantes do processo passam a ser registrados
> EXCLUSIVAMENTE na Timeline/Histórico do Processo (Diário Operacional, sobre
> `WorkflowEvento` + `Evento` + `LogAuditoria`), que é a única fonte cronológica.
> Guarda: `npm run test:nav`.

### Rascunhos do mockup substituídos por telas reais

`teams` (Equipes), `rolecat` (Cargos), `templates` (Modelos),
`notifications` (Notificações), `settings` (Configurações Gerais), `impexp` (Exportações — download
real em CSV/JSON das rotas canônicas), `diagnostics`, `mgmthealth`, `syshealth` e `execmatrix`
(quatro lentes sobre `/api/gerenciamento/diagnostico`).

Todos os rascunhos continuam acessíveis em `?screen=<key>-rascunho`, com entrada oculta na
navegação — nada foi apagado.

### Motor genérico de cadastros

`src/lib/gerenciamento/cadastros-registry.ts` é o registro ÚNICO (allow-list) que alimenta a API
`/api/gerenciamento/cadastros/[entidade]` e a tela `CadastroGenericoTab`. Oito cadastros com um
só CRUD: sem spec duplicada entre backend e frontend, sem tabela arbitrária exposta.

## 6. Telas-rascunho remanescentes

Nenhuma no menu. Os rascunhos do mockup seguem apenas como `?screen=<key>-rascunho`
(referência histórica), com aviso no topo e ações desabilitadas (`_RascunhoUI.tsx`).

## 7. Regras de arquitetura garantidas por teste

- fases cadastradas **exclusivamente** em Processos › Estrutura › Fases (`test:nav`);
- Workflow não cadastra fases — só referencia;
- Automações só financeiras/eventos — sem motor paralelo de tarefas;
- Serviços sem preço/precificação — preço só na Tabela de Valores;
- Documentos e Protocolos sem submenu “Configurações”;
- nenhuma tela aparece duas vezes no menu;
- nomenclaturas “Pessoas e Organizações”, “Produtos”, “Produtos Financeiros” ausentes.
