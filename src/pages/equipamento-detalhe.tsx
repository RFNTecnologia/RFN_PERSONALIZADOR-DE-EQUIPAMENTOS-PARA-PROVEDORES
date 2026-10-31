import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CloudDownload,
  Fingerprint,
  Palette,
  RotateCcw,
  Router,
  Settings2,
  Wifi,
} from 'lucide-react'
import { useEstado } from '@/lib/store'
import { formatarData, formatarRelativo, rotuloMetodo, rotuloTipo } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status-badge'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'

export function EquipamentoDetalhe() {
  const { id = '' } = useParams()
  const { equipamentos, clientes, perfis, logs, atualizarEquipamento, registrarLog } = useEstado()
  const eq = equipamentos.find((e) => e.id === id)

  if (!eq) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Equipamento não encontrado.</p>
        <Button asChild variant="outline">
          <Link to="/equipamentos">
            <ArrowLeft aria-hidden="true" /> Voltar
          </Link>
        </Button>
      </div>
    )
  }

  const cliente = clientes.find((c) => c.id === eq.clienteId)
  const perfil = perfis.find((p) => p.id === eq.perfilId)
  const historico = logs.filter((l) => l.equipamentoId === eq.id)

  function reaplicarBranding() {
    atualizarEquipamento(eq!.id, { status: 'provisionando' })
    registrarLog({
      tipo: 'branding',
      equipamentoId: eq!.id,
      mensagem: 'Personalização reenviada ao equipamento',
      detalhe: 'Template de tela de login publicado novamente via ACS.',
      resultado: 'pendente',
    })
  }

  function forcarRestauracao() {
    atualizarEquipamento(eq!.id, { status: 'em-recuperacao', sincronizadoEm: null })
    registrarLog({
      tipo: 'restauracao',
      equipamentoId: eq!.id,
      mensagem: 'Restauração forçada a partir do painel',
      detalhe: 'O ACS reenvia perfil, branding e credenciais de WAN ao CPE.',
      resultado: 'pendente',
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/equipamentos"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" aria-hidden="true" /> Equipamentos
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Router className="size-6 text-muted-foreground" aria-hidden="true" />
            {eq.modelo}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{eq.serial}</span>
            <span aria-hidden="true">·</span>
            <span>{eq.fabricante}</span>
            <Badge variant="outline">{rotuloTipo[eq.tipo]}</Badge>
            <StatusBadge status={eq.status} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/simulador?equipamento=${eq.id}`}>
              <RotateCcw aria-hidden="true" /> Simular reset
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={reaplicarBranding}>
            <Palette aria-hidden="true" /> Reenviar tela de login
          </Button>
          <Button size="sm" onClick={forcarRestauracao}>
            <CloudDownload aria-hidden="true" /> Forçar restauração
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
            <CardDescription>Dados de rede e identificação</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-muted-foreground">Cliente</TableCell>
                  <TableCell className="text-right">
                    <p>{cliente?.nome ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {cliente?.contrato} · {cliente?.plano}
                    </p>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">MAC</TableCell>
                  <TableCell className="text-right font-mono text-xs">{eq.mac}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">IP</TableCell>
                  <TableCell className="text-right font-mono text-xs">{eq.ip}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Firmware</TableCell>
                  <TableCell className="text-right text-xs">
                    {eq.firmware}
                    {eq.firmware !== eq.firmwareAlvo && (
                      <p className="text-amber-700">alvo: {eq.firmwareAlvo}</p>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Config hash</TableCell>
                  <TableCell className="text-right font-mono text-xs">{eq.configHash}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Último contato</TableCell>
                  <TableCell className="text-right text-xs">
                    {formatarRelativo(eq.ultimoContato)}
                    <p className="text-muted-foreground">{formatarData(eq.ultimoContato)}</p>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Sincronizado em</TableCell>
                  <TableCell className="text-right text-xs">
                    {eq.sincronizadoEm ? formatarData(eq.sincronizadoEm) : 'pendente'}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="size-4" aria-hidden="true" /> Configuração aplicada
            </CardTitle>
            <CardDescription>{perfil?.nome ?? 'Sem perfil vinculado'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {perfil ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-medium text-muted-foreground">WAN</p>
                    <p className="mt-1 text-sm font-medium uppercase">{perfil.wan.modo}</p>
                    <p className="text-xs text-muted-foreground">
                      VLAN {perfil.wan.vlan || '—'} · MTU {perfil.wan.mtu}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-medium text-muted-foreground">LAN</p>
                    <p className="mt-1 text-sm font-medium">{perfil.lan.gateway}</p>
                    <p className="text-xs text-muted-foreground">{perfil.lan.faixa}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Wifi className="size-3" aria-hidden="true" /> Wi-Fi
                    </p>
                    <p className="mt-1 text-sm font-medium">{perfil.wifi.ssid}</p>
                    <p className="text-xs text-muted-foreground">
                      {perfil.wifi.banda} · {perfil.wifi.larguraCanal}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Fingerprint className="size-4 text-primary" aria-hidden="true" />
                    Recuperação após reset de fábrica
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Método: {rotuloMetodo[perfil.gestao.metodoRestore]} · token{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{eq.tokenRecuperacao}</code>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ACS {perfil.gestao.acsUrl} · polling a cada {perfil.gestao.intervaloMin} min ·
                    bootstrap {perfil.gestao.dhcpOption60} via option 43 ({perfil.gestao.dhcpOption43})
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Vincule um perfil de configuração a este equipamento.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico do equipamento</CardTitle>
          <CardDescription>Eventos registrados para {eq.serial}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {historico.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem eventos registrados.</p>
          )}
          {historico.map((evento) => (
            <div key={evento.id} className="flex items-start justify-between gap-4 border-b py-2.5 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{evento.mensagem}</p>
                <p className="text-xs text-muted-foreground">{evento.detalhe}</p>
              </div>
              <Badge variant="secondary">{formatarRelativo(evento.em)}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
