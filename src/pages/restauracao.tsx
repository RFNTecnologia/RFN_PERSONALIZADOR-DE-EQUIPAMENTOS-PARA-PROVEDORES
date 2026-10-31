import { Link } from 'react-router-dom'
import {
  CloudCog,
  Globe,
  KeyRound,
  Link2,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEstado } from '@/lib/store'
import { formatarRelativo, rotuloMetodo } from '@/lib/format'
import type { MetodoRestore } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status-badge'

const metodos: {
  id: MetodoRestore
  titulo: string
  icone: typeof Globe
  resumo: string
  requisitos: string[]
}[] = [
  {
    id: 'tr069-acs',
    titulo: 'TR-069 / ACS',
    icone: Globe,
    resumo:
      'O CPE aponta para o ACS do provedor. Mesmo sem configuration file na rede, ele se registra e recebe perfil, branding e firmware.',
    requisitos: [
      'CPE com firmware gerenciado (TR-069 ou TR-369 habilitado)',
      'ACS acessível a partir da rede do cliente (nuvem ou VPN)',
      'Serial do equipamento cadastrado no painel',
    ],
  },
  {
    id: 'url-bootstrap',
    titulo: 'URL de bootstrap',
    icone: Link2,
    resumo:
      'O servidor DHCP entrega a URL de configuração via option 43/60. O CPE baixa o arquivo na primeira subida, ainda em estado de fábrica.',
    requisitos: [
      'Servidor DHCP com option 43/60 configurado',
      'Cliente ainda está na rede do provedor (não desconectou o CPE da fibra)',
      'Firewall permite saída HTTPS do CPE',
    ],
  },
  {
    id: 'token-nuvem',
    titulo: 'Token na nuvem',
    icone: KeyRound,
    resumo:
      'Cada equipamento recebe um token único. Após o reset, o CPE se apresenta ao serviço de provisionamento com serial + token e recebe sua configuração.',
    requisitos: [
      'Firmware com cliente de provisionamento em nuvem',
      'Token vinculado ao serial no cadastro',
      'Conectividade de saída do CPE',
    ],
  },
]

export function Restauracao() {
  const { politica, equipamentos, perfis, clientes, atualizarPolitica, registrarLog } = useEstado()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Restauração após reset</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Regras que fazem o equipamento voltar para a configuração do provedor em vez do padrão de
          fábrica.
        </p>
      </div>

      {!politica.ativa && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            A política está desativada. Com ela desligada, um reset de fábrica deixa o cliente sem
            internet e sem a tela de login personalizada — ative abaixo.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Política global</CardTitle>
            <CardDescription>Aplica-se a todos os equipamentos, salvo override por perfil</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Restauração automática</p>
                <p className="text-xs text-muted-foreground">
                  Reboot, reset de fábrica ou troca de firmware não deixam o CPE sem gerência.
                </p>
              </div>
              <Switch
                checked={politica.ativa}
                onCheckedChange={(v) => {
                  atualizarPolitica({ ativa: v })
                  toast(v ? 'Restauração automática ativada.' : 'Restauração automática desligada.')
                }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="metodo-padrao">Método padrão</Label>
                <Select
                  value={politica.metodoPadrao}
                  onValueChange={(v) => atualizarPolitica({ metodoPadrao: v as MetodoRestore })}
                >
                  <SelectTrigger id="metodo-padrao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {metodos.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.titulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="espera">Espera de boot (segundos)</Label>
                <Input
                  id="espera"
                  type="number"
                  value={politica.esperaBootSegundos}
                  onChange={(e) =>
                    atualizarPolitica({ esperaBootSegundos: Number(e.target.value) })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tentativas">Intervalo entre tentativas (min)</Label>
                <Input
                  id="tentativas"
                  type="number"
                  value={politica.intervaloTentativasMin}
                  onChange={(e) =>
                    atualizarPolitica({ intervaloTentativasMin: Number(e.target.value) })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha-admin">Senha admin padrão</Label>
                <Input
                  id="senha-admin"
                  value={politica.senhaAdminPadrao}
                  onChange={(e) => atualizarPolitica({ senhaAdminPadrao: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              {[
                {
                  id: 'bloqueiaAcessoLocal',
                  titulo: 'Bloquear acesso administrativo local',
                  descricao:
                    'O cliente não consegue alterar WAN, Wi-Fi ou DNS. Alterações passam pelo painel.',
                },
                {
                  id: 'bloqueiaResetFisico',
                  titulo: 'Impedir reset físico',
                  descricao:
                    'Mantém o botão de reset inativo. Requer firmware com essa proteção habilitada.',
                },
                {
                  id: 'fallbackOffline',
                  titulo: 'Manter último profile em cache',
                  descricao:
                    'Se o ACS estiver fora do ar, o CPE reaplica a última configuração conhecida em vez de falhar.',
                },
                {
                  id: 'notificaCliente',
                  titulo: 'Notificar o cliente',
                  descricao: 'Envia aviso de que o equipamento voltará às configurações do provedor.',
                },
              ].map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{item.titulo}</p>
                    <p className="text-xs text-muted-foreground">{item.descricao}</p>
                  </div>
                  <Switch
                    checked={politica[item.id as 'bloqueiaAcessoLocal']}
                    onCheckedChange={(v) =>
                      atualizarPolitica({ [item.id]: v } as unknown as Partial<typeof politica>)
                    }
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mensagem-cliente">Mensagem para o cliente</Label>
              <Textarea
                id="mensagem-cliente"
                value={politica.mensagemCliente}
                onChange={(e) => atualizarPolitica({ mensagemCliente: e.target.value })}
                disabled={!politica.notificaCliente}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {metodos.map((metodo) => {
            const perfisComMetodo = perfis.filter((p) => p.gestao.metodoRestore === metodo.id)
            return (
              <Card key={metodo.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <metodo.icone className="size-4 text-primary" aria-hidden="true" />
                    {metodo.titulo}
                  </CardTitle>
                  <CardDescription>{metodo.resumo}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {metodo.requisitos.map((r) => (
                      <li key={r} className="flex gap-2">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                        {r}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Perfis usando este método: {perfisComMetodo.length}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Situação por equipamento</CardTitle>
              <CardDescription>
                Apto a recuperar a configuração do provedor após um reset
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/simulador">
                <RotateCcw aria-hidden="true" /> Testar com o simulador
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Último sync</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipamentos.map((eq) => {
                const perfil = perfis.find((p) => p.id === eq.perfilId)
                const cliente = clientes.find((c) => c.id === eq.clienteId)
                const apto = politica.ativa && !!perfil?.gestao.metodoRestore
                return (
                  <TableRow key={eq.id}>
                    <TableCell>
                      <Link
                        to={`/equipamentos/${eq.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {eq.serial}
                      </Link>
                      <p className="text-xs text-muted-foreground">{eq.modelo}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{cliente?.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {rotuloMetodo[perfil?.gestao.metodoRestore ?? politica.metodoPadrao]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {eq.tokenRecuperacao}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatarRelativo(eq.sincronizadoEm)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={eq.status} />
                    </TableCell>
                    <TableCell>
                      {apto ? (
                        <span className="flex items-center gap-1.5 text-sm text-emerald-700">
                          <ShieldAlert className="size-4" aria-hidden="true" /> Apto
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-sm text-amber-700">
                          <CloudCog className="size-4" aria-hidden="true" /> Sem política
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como habilitar nos equipamentos</CardTitle>
          <CardDescription>Checklist de implantação por modelo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            'Atualizar o firmware para a versão gerenciada do provedor (o cliente não pode desativar o TR-069).',
            'Cadastrar serial, MAC e token de recuperação do CPE no painel.',
            'Configurar o servidor DHCP com option 43 apontando para o ACS e option 60 com o identificador do provedor.',
            'Liberar saída HTTPS do CPE para acs.fibrasul.example.com:8443 e boot.fibrasul.example.com.',
            'Publicar o template de tela de login e validar no primeiro equipamento restaurado.',
          ].map((linha, i) => (
            <div key={linha} className="flex gap-3 rounded-lg border p-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <p className="text-muted-foreground">{linha}</p>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            Última atualização da política registrada no histórico de auditoria.
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 align-baseline"
              onClick={() =>
                registrarLog({
                  tipo: 'restauracao',
                  equipamentoId: null,
                  mensagem: 'Política de restauração revisada',
                  detalhe: `Método padrão ${rotuloMetodo[politica.metodoPadrao]}; espera de boot ${politica.esperaBootSegundos}s.`,
                  resultado: 'sucesso',
                })
              }
            >
              Registrar revisão agora
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
