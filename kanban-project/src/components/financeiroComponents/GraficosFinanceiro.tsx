// CRIAR EM: src/components/financeiroComponents/GraficosFinanceiro.tsx
"use client"

import { useMemo } from "react"
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Treemap
} from "recharts"

// ============================================
// TIPOS
// ============================================

interface Fatura {
  id: number
  descricao: string
  moeda: string
  valor: number
  valorPago: number
  valorRestante: number
  valorTotalBRL: number
  valorPagoBRL: number
  valorRestanteBRL: number
  vencidoBRL: number
  pendenteBRL: number
  cambio: number
  status: string
  metodoPagamento: string | null
  parcelas: number
  dataEmissao: string
  dataVencimento: string | null
  processo: { id: number; nome: string; pais: string } | null
  destinatarios: { id: number; nome: string }[]
  pagamentos: any[]
  parcelasBoleto: any[]
  createdAt: string
}

interface ProcessoResumo {
  id: number
  nome: string
  pais: string
  totalBRL: number
  pagoBRL: number
  pendenteBRL: number
  vencidoBRL: number
  qtdFaturas: number
}

interface TotaisGeralBRL {
  total: number
  pago: number
  pendente: number
  vencido: number
}

interface GraficosFinanceiroProps {
  faturas: Fatura[]
  totaisGeralBRL: TotaisGeralBRL
  totaisPorMoeda: Record<string, { total: number; pago: number; pendente: number; vencido: number }>
  porProcesso: ProcessoResumo[]
}

// ============================================
// CONSTANTES
// ============================================

const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal', ESPANHA: 'Espanha', ALEMANHA: 'Alemanha', ITALIA: 'Itália'
}

const STATUS_COLORS: Record<string, string> = {
  PAGO: '#22C55E',
  PARCIAL: '#F59E0B',
  PENDENTE: '#3B82F6',
  VENCIDO: '#EF4444',
}

const STATUS_LABELS: Record<string, string> = {
  PAGO: 'Pago',
  PARCIAL: 'Parcial',
  PENDENTE: 'Pendente',
  VENCIDO: 'Vencido',
}

const PAIS_COLORS: Record<string, string> = {
  PORTUGAL: '#3B82F6',
  ESPANHA: '#F59E0B',
  ALEMANHA: '#EF4444',
  ITALIA: '#22C55E',
}

const MOEDA_COLORS: Record<string, string> = {
  BRL: '#22C55E',
  EUR: '#3B82F6',
  USD: '#F59E0B',
}

function formatCurrencyBRL(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCurrencyShort(valor: number): string {
  if (valor >= 1000000) return `R$ ${(valor / 1000000).toFixed(1)}M`
  if (valor >= 1000) return `R$ ${(valor / 1000).toFixed(1)}K`
  return `R$ ${valor.toFixed(0)}`
}

// ============================================
// CUSTOM TOOLTIP
// ============================================

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
      {label && <p className="text-white/70 text-xs mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-medium" style={{ color: p.color || p.fill }}>
          {p.name}: {formatCurrencyBRL(p.value)}
        </p>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const data = payload[0]
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm font-medium" style={{ color: data.payload.fill }}>
        {data.name}
      </p>
      <p className="text-white text-sm font-bold">{formatCurrencyBRL(data.value)}</p>
      {data.payload.percent && (
        <p className="text-white/40 text-xs">{(data.payload.percent * 100).toFixed(1)}%</p>
      )}
    </div>
  )
}

// ============================================
// CUSTOM LABEL
// ============================================

function renderCustomPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) {
  if (percent < 0.05) return null // Não mostrar labels < 5%
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export default function GraficosFinanceiro({ faturas, totaisGeralBRL, totaisPorMoeda, porProcesso }: GraficosFinanceiroProps) {

  // 1. Dados por status (Donut)
  const dadosPorStatus = useMemo(() => {
    const statusCount: Record<string, number> = {}
    faturas.forEach(f => {
      statusCount[f.status] = (statusCount[f.status] || 0) + f.valorTotalBRL
    })
    return Object.entries(statusCount)
      .map(([status, valor]) => ({
        name: STATUS_LABELS[status] || status,
        value: valor,
        fill: STATUS_COLORS[status] || '#6B7280',
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [faturas])

  // 2. Dados por país (Donut)
  const dadosPorPais = useMemo(() => {
    const paisCount: Record<string, number> = {}
    faturas.forEach(f => {
      const pais = f.processo?.pais || 'OUTROS'
      paisCount[pais] = (paisCount[pais] || 0) + f.valorTotalBRL
    })
    return Object.entries(paisCount)
      .map(([pais, valor]) => ({
        name: PAIS_LABELS[pais] || pais,
        value: valor,
        fill: PAIS_COLORS[pais] || '#6B7280',
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [faturas])

  // 3. Dados por processo (Bar chart horizontal)
  const dadosPorProcesso = useMemo(() => {
    return [...porProcesso]
      .sort((a, b) => b.totalBRL - a.totalBRL)
      .slice(0, 10)
      .map(p => ({
        nome: p.nome.length > 20 ? p.nome.substring(0, 18) + '…' : p.nome,
        nomeCompleto: p.nome,
        Recebido: p.pagoBRL,
        Pendente: p.pendenteBRL,
        Vencido: p.vencidoBRL,
        total: p.totalBRL,
      }))
  }, [porProcesso])

  // 4. Dados por moeda (Bar chart)
  const dadosPorMoeda = useMemo(() => {
    return Object.entries(totaisPorMoeda).map(([moeda, vals]) => ({
      moeda,
      Total: vals.total,
      Recebido: vals.pago,
      Pendente: vals.pendente,
      Vencido: vals.vencido,
    }))
  }, [totaisPorMoeda])

  // 5. Dados por mês (faturas agrupadas por mês de emissão)
  const dadosPorMes = useMemo(() => {
    const meses: Record<string, { emitido: number; recebido: number }> = {}
    faturas.forEach(f => {
      const data = new Date(f.dataEmissao)
      const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
      if (!meses[chave]) meses[chave] = { emitido: 0, recebido: 0 }
      meses[chave].emitido += f.valorTotalBRL
      meses[chave].recebido += f.valorPagoBRL
    })
    return Object.entries(meses)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, vals]) => {
        const [ano, mesNum] = mes.split('-')
        const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
        return {
          mes: `${mesesNomes[parseInt(mesNum) - 1]}/${ano.slice(2)}`,
          Emitido: vals.emitido,
          Recebido: vals.recebido,
        }
      })
  }, [faturas])

  // 6. Quantidade de faturas por status
  const qtdPorStatus = useMemo(() => {
    const counts: Record<string, number> = {}
    faturas.forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1 })
    return Object.entries(counts)
      .map(([status, qtd]) => ({
        name: STATUS_LABELS[status] || status,
        value: qtd,
        fill: STATUS_COLORS[status] || '#6B7280',
      }))
      .sort((a, b) => b.value - a.value)
  }, [faturas])

  if (faturas.length === 0) {
    return <div className="text-center py-16 text-white/50">Nenhuma fatura para exibir gráficos</div>
  }

  return (
    <div className="space-y-6" id="graficos-financeiro">
      {/* Row 1: Status + País */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Donut - Por Status (Valor) */}
        <ChartCard title="Distribuição por Status" subtitle="Valores em BRL">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={dadosPorStatus}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                dataKey="value"
                labelLine={false}
                label={renderCustomPieLabel}
                strokeWidth={2}
                stroke="rgba(0,0,0,0.3)"
              >
                {dadosPorStatus.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={10}
                formatter={(value: string) => <span className="text-white/80 text-xs ml-1">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Centro do donut */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginTop: '-30px' }}>
            <div className="text-center">
              <p className="text-white/50 text-[10px]">Total</p>
              <p className="text-white font-bold text-sm">{formatCurrencyShort(totaisGeralBRL.total)}</p>
            </div>
          </div>
        </ChartCard>

        {/* Donut - Por País */}
        <ChartCard title="Distribuição por País" subtitle="Valores em BRL">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={dadosPorPais}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                dataKey="value"
                labelLine={false}
                label={renderCustomPieLabel}
                strokeWidth={2}
                stroke="rgba(0,0,0,0.3)"
              >
                {dadosPorPais.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={10}
                formatter={(value: string) => <span className="text-white/80 text-xs ml-1">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginTop: '-30px' }}>
            <div className="text-center">
              <p className="text-white/50 text-[10px]">Total</p>
              <p className="text-white font-bold text-sm">{formatCurrencyShort(totaisGeralBRL.total)}</p>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Row 2: Por Processo (barras horizontais) */}
      {dadosPorProcesso.length > 0 && (
        <ChartCard title="Valores por Família / Processo" subtitle={`Top ${dadosPorProcesso.length} processos`}>
          <ResponsiveContainer width="100%" height={Math.max(250, dadosPorProcesso.length * 50)}>
            <BarChart data={dadosPorProcesso} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={formatCurrencyShort}
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="nome"
                width={130}
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingBottom: 10 }}
                formatter={(value: string) => <span className="text-white/70 text-xs ml-1">{value}</span>}
              />
              <Bar dataKey="Recebido" stackId="a" fill="#22C55E" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Pendente" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Vencido" stackId="a" fill="#EF4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Row 3: Por Mês + Por Moeda */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Barras - Emitido vs Recebido por Mês */}
        {dadosPorMes.length > 0 && (
          <ChartCard title="Emitido vs Recebido por Mês" subtitle="Valores em BRL">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dadosPorMes} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis
                  dataKey="mes"
                  tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={formatCurrencyShort}
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingBottom: 10 }}
                  formatter={(value: string) => <span className="text-white/70 text-xs ml-1">{value}</span>}
                />
                <Bar dataKey="Emitido" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Recebido" fill="#22C55E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Barras - Por Moeda */}
        {dadosPorMoeda.length > 1 && (
          <ChartCard title="Comparativo por Moeda" subtitle="Valores na moeda original">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dadosPorMoeda} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis
                  dataKey="moeda"
                  tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 12 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toString()}
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingBottom: 10 }}
                  formatter={(value: string) => <span className="text-white/70 text-xs ml-1">{value}</span>}
                />
                <Bar dataKey="Recebido" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Pendente" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Vencido" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Se só tem uma moeda, mostrar donut de qtd por status */}
        {dadosPorMoeda.length <= 1 && (
          <ChartCard title="Quantidade de Faturas por Status" subtitle={`${faturas.length} faturas`}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={qtdPorStatus}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  dataKey="value"
                  labelLine={false}
                  label={({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
                    if (value === 0) return null
                    const RADIAN = Math.PI / 180
                    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
                    const x = cx + radius * Math.cos(-midAngle * RADIAN)
                    const y = cy + radius * Math.sin(-midAngle * RADIAN)
                    return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight="bold">{value}</text>
                  }}
                  strokeWidth={2}
                  stroke="rgba(0,0,0,0.3)"
                >
                  {qtdPorStatus.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
                      <p className="text-sm font-medium" style={{ color: payload[0].payload.fill }}>{payload[0].name}: {payload[0].value} fatura(s)</p>
                    </div>
                  )
                }} />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={10}
                  formatter={(value: string) => <span className="text-white/80 text-xs ml-1">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginTop: '-30px' }}>
              <div className="text-center">
                <p className="text-white/50 text-[10px]">Total</p>
                <p className="text-white font-bold text-lg">{faturas.length}</p>
              </div>
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  )
}

// ============================================
// CHART CARD WRAPPER
// ============================================

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="relative bg-white/5 border border-white/10 rounded-xl p-5">
      <div className="mb-3">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-white/40 text-xs">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}