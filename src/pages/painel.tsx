import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Cpu,
  LifeBuoy,
  Palette,
  Power,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useEstado } from '@/lib/store'
import { formatarRelativo } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'

export function Painel() {
  const { equipamentos, clientes, logs, politica, branding } = useEstado()

  const total = equipamentos.length
  const online = equipamentos.filter((e) => e.status === 'online').length
  const recuperacao = equipamentos.filter((e) => e.status === 'em-recuperacao').length
  const restaurados = equipamentos.filter((e) => e.restaurado).length
  const desync = equipamentos.filter((e) => e.configHash === '—').length

  const porTipo = Object.entries(
    equipamentos.reduce<Record<string, number>>((acc, eq) => {
      acc[eq.tipo] = (acc[eq.tipo] ?? 0) + 1
      return acc
    }, {}),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Painel da frota</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estado dos equipamentos de cliente e da restauração automática após reset de fábrica.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Cpu className="size-4" aria-hidden="true" /> Equipamentos gerenciados
            </CardDescription>
            <CardTitle className="text-3xl">{total}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {clientes.length} clientes ativos
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Power className="size-4" aria-hidden="true" /> Online agora
            </CardDescription>
            <CardTitle className="text-3xl">{online}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {total ? Math.round((online / total) * 100) : 0}% da frota respondendo
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <LifeBuoy className="size-4" aria-hidden="true" /> Em recuperação pós-reset
            </CardDescription>
            <CardTitle className="text-3xl">{recuperacao}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {restaurados} já voltaram sozinhos para a config do provedor
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Palette className="size-4" aria-hidden="true" /> Personalização publicada
            </CardDescription>
            <CardTitle className="text-3xl">{branding.marca}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {desync === 0
              ? 'Todos os CPEs sincronizados com o template'
              : `${desync} equipamento(s) aguardando sincronização`}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Como a restauração pós-reset funciona</CardTitle>
            <CardDescription>
              Cadeia acionada quando o cliente reseta o equipamento pela primeira vez.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['1. Reset de fábrica', 'O cliente pressiona o botão por 10s. O CPE reinicia vazio, sem a configuração do provedor.'],
              ['2. Bootstrap na rede', 'Na primeira subida ele obtém IP por DHCP e recebe a URL de configuração (DHCP option 43/60) ou é reconhecido pelo ACS via TR-069.'],
              ['3. Identificação', `O serial casa com o cadastro e o token de recuperação (ex.: ${equipamentos[0]?.tokenRecuperacao ?? 'rcv_...'}) autentica o dispositivo.`],
              ['4. Reconfiguração', `O provedor reenvia perfil, Wi-Fi, VLAN e a tela de login personalizada. O equipamento volta ao estado gerenciado, sem intervenção humana.`],
            ].map(([titulo, texto]) => (
              <div key={titulo} className="flex gap-3 rounded-lg border bg-muted/30 p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{titulo}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{texto}</p>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm">
                <Link to="/restauracao">
                  Ajustar política
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/simulador">Simular reset de cliente</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Composição da frota</CardTitle>
            <CardDescription>Equipamentos por tipo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {porTipo.map(([tipo, qtd]) => (
              <div key={tipo}>
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize">{tipo}</span>
                  <span className="text-muted-foreground">{qtd}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(qtd / total) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <TriangleAlert className="size-4 text-amber-600" aria-hidden="true" />
                Política {politica.ativa ? 'ativa' : 'desligada'}
              </p>
              <p className="mt-1">
                {politica.ativa
                  ? `Espera de ${politica.esperaBootSegundos}s antes de considerar o CPE offline e ${politica.intervaloTentativasMin} min entre tentativas de recuperação.`
                  : 'Sem restauração automática: CPEs voltam ao padrão de fábrica.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Atividade recente</CardTitle>
              <CardDescription>Últimos eventos de provisionamento e restauração</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/auditoria">
                Ver tudo
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {logs.slice(0, 5).map((evento) => {
            const eq = equipamentos.find((e) => e.id === evento.equipamentoId)
            return (
              <div key={evento.id} className="flex items-start justify-between gap-4 border-b py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{evento.mensagem}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {eq ? `${eq.serial} · ${eq.modelo}` : 'Frota'} — {evento.detalhe}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {eq && <StatusBadge status={eq.status} />}
                  <Badge variant="secondary">{formatarRelativo(evento.em)}</Badge>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
