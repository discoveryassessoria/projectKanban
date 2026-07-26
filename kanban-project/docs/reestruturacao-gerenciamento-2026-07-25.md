# Reestruturação do Gerenciamento — 25/07/2026

Reorganização **da camada de navegação** (menu, agrupamentos, rotas lógicas e breadcrumbs)
para a arquitetura oficial de 11 módulos. Nenhuma tela foi reescrita, nenhuma API teve
contrato alterado, nenhum dado foi migrado ou apagado.

Fonte única: `src/components/gerenciamentoComponents/managementNavigation.tsx`
(estrutura + regras de submenu/seção, puras e testáveis).
`src/app/administrator/page.tsx` apenas **renderiza** e mapeia `screen → componente`.

Guardas: `npm run test:nav` (73 asserções) e `npm run test:accordion` (11 asserções).

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
| Tipos de Protocolo | `?screen=prottypes` | Documentos e Protocolos › Protocolos | igual | `CatalogTab('op_prottypes')` | idêntica | — |
| Regras Documentais | `?screen=docrules` | Documentos e Protocolos › Regras | igual | `RegrasDocumentaisTab` | idêntica | — |
| Catálogo de Serviços | `?screen=products` | Serviços | igual | `ProdutosServicosTab` | idêntica | — |
| Configurações Financeiras | `?screen=catalog` | Financeiro | igual | `ProdutosTab` | idêntica | — |
| Categorias Financeiras | `?screen=categories` | Financeiro › Classificação | igual | `CategoriasTab` | idêntica | — |
| Plano de Contas | `?screen=coa` | Financeiro › Classificação | igual | `PlanoContasTab` | idêntica | — |
| Centros de Custo | `?screen=costcenters` | Financeiro › Classificação | igual | `CentrosCustoTab` | idêntica | — |
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

## 5. Itens da arquitetura oficial ainda SEM tela própria (8)

Aparecem no menu **desabilitados**, com tooltip honesto dizendo onde a função vive hoje.
Nunca viram página falsa nem botão morto.

| Item | Por que ainda não tem tela |
|---|---|
| Processos › Estrutura › Marcos | não existe cadastro de marco no domínio — exige definir os campos e o efeito |
| Serviços › Categorias | categoria de serviço hoje é campo texto do próprio serviço; virar cadastro exige tabela nova |
| Órgãos e Organizações › Categorias | idem, com o requisito extra de múltiplas categorias por organização |
| Financeiro › Crédito | gestão de crédito é operacional e já existe em Financeiro Geral › Créditos — replicar seria duplicar conceito |
| Financeiro › Documentos Financeiros | recibos/faturas são emitidos pelo Financeiro Geral; não há cadastro no Gerenciamento |
| Usuários › Auditoria de Acessos | **não há trilha de autenticação**: nenhum ponto do login/sessão grava LogAuditoria |
| Sistema › Identidade Visual | a identidade é código (motor de ambiente por país), sem tabela de configuração |
| Relatórios › Dashboards | as composições visuais vivem nos módulos operacionais; dashboards configuráveis exigem modelo próprio |

## 6. Telas-rascunho remanescentes (estrutura pronta, sem persistência)

Continuam no menu (não são órfãs), mas com **aviso no topo** e **ações desabilitadas**
(`_RascunhoUI.tsx`): `teams`, `rolecat`, `settings`, `templates`, `notifications`,
`impexp`, `syshealth`, `execmatrix`, `mgmthealth`, `diagnostics`, `prottypes`.

## 7. Regras de arquitetura garantidas por teste

- fases cadastradas **exclusivamente** em Processos › Estrutura › Fases (`test:nav`);
- Workflow não cadastra fases — só referencia;
- Automações só financeiras/eventos — sem motor paralelo de tarefas;
- Serviços sem preço/precificação — preço só na Tabela de Valores;
- Documentos e Protocolos sem submenu “Configurações”;
- nenhuma tela aparece duas vezes no menu;
- nomenclaturas “Pessoas e Organizações”, “Produtos”, “Produtos Financeiros” ausentes.
