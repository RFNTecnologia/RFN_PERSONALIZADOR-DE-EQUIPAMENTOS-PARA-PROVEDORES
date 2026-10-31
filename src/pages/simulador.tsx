import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  RotateCcw,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEstado } from '@/lib/store'
import { rotuloMetodo, rotuloTipo } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TelaLogin } from '@/components/preview/tela-login'

type SituacaoPasso = 'pendente' | 'executando' | 'concluido'

export function Simulador() {
  const { equipamentos, clientes, perfis, branding, politica, atualizarEquipamento, registrarLog } =
    useEstado()
  const [params, setParams] = useSearchParams()
  const inicial = params.get('equipamento') ?? equipamentos[0]?.id ?? ''
  const [selecionado, setSelecionado] = useState(inicial)
  const [passo, setPasso] = useState(0)
  const [rodando, setRodando] = useState(false)
  const [concluido, setConcluido] = useState(false)

  const eq = equipamentos.find((e) => e.id === selecionado) ?? equipamentos[0]
  const perfil = perfis.find((p) => p.id === eq?.perfilId)
  const cliente = clientes.find((c) => c.id === eq?.clienteId)

  const passos = useMemo(() => {
    if (!eq || !perfil) return []
    const metodo = perfil.gestao.metodoRestore
    const base = [
      {
        titulo: 'Reset de fábrica acionado pelo cliente',
        detalhe:
          'Botão físico pressionado por 10 segundos. O equipamento apaga toda a configuração local.',
      },
      {
        titulo: 'CPE reinicia sem configuração do provedor',
        detalhe:
          'Sem WAN, sem SSID do provedor e com a tela de login padrão do fabricante. O cliente fica sem internet.',
      },
    ]

    if (metodo === 'tr069-acs') {
      base.push(
        {
          titulo: 'CPE obtém IP e registra no ACS',
          detalhe: `Ciclo TR-069 concluído em ${perfil.gestao.intervaloMin} min de polling. O ACS reconhece o serial ${eq.serial}.`,
        },
        {
          titulo: 'Token de recuperação validado',
          detalhe: `Token ${eq.tokenRecuperacao} confere com o cadastro do cliente e da serialização do equipamento.`,
        },
      )
    } else if (metodo === 'url-bootstrap') {
      base.push(
        {
          titulo: 'Servidor DHCP entrega option 43/60',
          detalhe: `CPE recebe a URL ${perfil.gestao.urlBootstrap} (option 43 → ${perfil.gestao.dhcpOption43}, option 60 → ${perfil.gestao.dhcpOption60}).`,
        },
        {
          titulo: 'CPE baixa a configuração base',
          detalhe: 'O arquivo de bootstrap traz o perfil de WAN e a chave de identificação do provedor.',
        },
      )
    } else {
      base.push(
        {
          titulo: 'CPE se apresenta ao serviço de nuvem',
          detalhe: `Serial ${eq.serial} + token ${eq.tokenRecuperacao} enviados para validação.`,
        },
        {
          titulo: 'Perfil solicitado ao serviço',
          detalhe: 'O serviço devolve o perfil vinculado ao contrato do cliente.',
        },
      )
    }

    base.push(
      {
        titulo: 'Perfil do provedor aplicado',
        detalhe: `WAN ${perfil.wan.modo.toUpperCase()} (VLAN ${perfil.wan.vlan || '—'}), gateway ${perfil.lan.gateway} e SSID ${perfil.wifi.ssid}.`,
      },
      {
        titulo: 'Tela de login personalizada publicada',
        detalhe: `Template "${branding.nome}" injetado no painel web do equipamento.`,
      },
      {
        titulo: 'Equipamento online com a configuração do provedor',
        detalhe:
          'O cliente navega normalmente na tela do provedor. Nenhuma intervenção da central foi necessária.',
      },
    )
    return base
  }, [eq, perfil, branding])

  useEffect(() => {
    if (!rodando) return
    if (passo >= passos.length) {
      setRodando(false)
      setConcluido(true)
      if (eq) {
        atualizarEquipamento(eq.id, {
          status: 'online',
          restaurado: true,
          sincronizadoEm: new Date().toISOString(),
          configHash: Math.random().toString(16).slice(2, 10),
          ultimoContato: new Date().toISOString(),
        })
        registrarLog({
          tipo: 'restauracao',
          equipamentoId: eq.id,
          mensagem: 'Restauração automática concluída após reset',
          detalhe: `${rotuloMetodo[perfil?.gestao.metodoRestore ?? politica.metodoPadrao]} — perfil e tela de login reaplicados.`,
          resultado: 'sucesso',
        })
      }
      toast.success('Restauração concluída: o CPE voltou para a configuração do provedor.')
      return
    }
    const t = setTimeout(() => setPasso((p) => p + 1), 850)
    return () => clearTimeout(t)
  }, [rodando, passo, passos.length, eq, perfil, atualizarEquipamento, registrarLog, politica.metodoPadrao])

  function iniciar() {
    setPasso(0)
    setConcluido(false)
    setRodando(true)
  }

  function situacao(indice: number): SituacaoPasso {
    if (indice < passo) return 'concluido'
    if (indice === passo) return rodando ? 'executando' : 'pendente'
    return 'pendente'
  }

  if (!eq) return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Simulador de reset</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reproduza o que acontece quando o cliente reseta o equipamento e confirme que ele volta
          para a configuração do provedor.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Fluxo de recuperação</CardTitle>
            <CardDescription>
              {perfil ? rotuloMetodo[perfil.gestao.metodoRestore] : 'Sem perfil vinculado'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <label htmlFor="equip" className="text-sm font-medium">
                  Equipamento
                </label>
                <Select
                  value={eq.id}
                  onValueChange={(v) => {
                    setSelecionado(v)
                    setParams({ equipamento: v })
                    setPasso(0)
                    setConcluido(false)
                  }}
                >
                  <SelectTrigger id="equip">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {equipamentos.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.modelo} — {e.serial}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={iniciar} disabled={rodando}>
                  {rodando ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {rodando ? 'Executando...' : 'Simular reset do cliente'}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <User className="size-4 text-muted-foreground" aria-hidden="true" />
                {cliente?.nome} · {cliente?.plano}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {eq.modelo} ({rotuloTipo[eq.tipo]}) · {eq.mac} · política global{' '}
                {politica.ativa ? 'ativa' : 'inativa'}
              </p>
            </div>

            <ol className="space-y-2">
              {passos.map((p, i) => {
                const s = situacao(i)
                return (
                  <li
                    key={p.titulo}
                    className={`flex gap-3 rounded-lg border p-3 transition-colors ${
                      s === 'executando' ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      {s === 'concluido' ? (
                        <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
                      ) : s === 'executando' ? (
                        <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                      ) : (
                        <CircleDashed className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {i + 1}. {p.titulo}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{p.detalhe}</p>
                    </div>
                  </li>
                )
              })}
            </ol>

            {concluido && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p>
                  O equipamento voltou sozinho para a configuração do provedor. O cliente não precisou
                  de suporte.
                </p>
                <Link to={`/equipamentos/${eq.id}`} className="font-medium underline">
                  Ver equipamento
                </Link>
              </div>
            )}

            {!politica.ativa && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                A política global está desativada: sem ela, o fluxo para no passo 2 e o cliente fica
                sem internet. Ative em <Link to="/restauracao" className="underline">Restauração</Link>.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="size-4" aria-hidden="true" /> Resultado para o cliente
              </CardTitle>
              <CardDescription>Tela que o cliente terá ao acessar o equipamento</CardDescription>
            </CardHeader>
            <CardContent>
              <TelaLogin branding={branding} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estado final simulado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                ['WAN', perfil ? `${perfil.wan.modo.toUpperCase()} · VLAN ${perfil.wan.vlan || '—'}` : '—'],
                ['Gateway', perfil?.lan.gateway ?? '—'],
                ['Wi-Fi', perfil?.wifi.ssid ?? '—'],
                ['Sincronizado', eq.sincronizadoEm ? 'sim' : 'pendente'],
                ['Config hash', eq.configHash],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <span className="text-muted-foreground">{rotulo}</span>
                  <Badge variant="secondary">{valor}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
