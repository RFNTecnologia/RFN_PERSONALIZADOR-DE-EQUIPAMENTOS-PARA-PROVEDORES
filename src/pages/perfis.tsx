import { useState } from 'react'
import { Cpu, Globe, Router as RouterIcon, Save, Wifi } from 'lucide-react'
import { useEstado } from '@/lib/store'
import { rotuloTipo } from '@/lib/format'
import type { MetodoRestore, Perfil } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function Perfis() {
  const { perfis, equipamentos, atualizarPerfil } = useEstado()
  const [selecionado, setSelecionado] = useState(perfis[0]?.id ?? '')

  const perfil = perfis.find((p) => p.id === selecionado) ?? perfis[0]
  if (!perfil) return null

  const usados = equipamentos.filter((e) => e.perfilId === perfil.id)

  function alterar(patch: Partial<Perfil>) {
    atualizarPerfil(perfil!.id, patch)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Perfis de configuração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Templates aplicados aos equipamentos. O perfil é a fonte da verdade: ele é reenviado
          sempre que o cliente reseta o aparelho.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Perfis</CardTitle>
            <CardDescription>{perfis.length} templates cadastrados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {perfis.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelecionado(p.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  p.id === perfil.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-accent'
                }`}
              >
                <p className="text-sm font-medium">{p.nome}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.descricao}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{rotuloTipo[p.tipo]}</Badge>
                  <Badge variant="secondary">
                    {equipamentos.filter((e) => e.perfilId === p.id).length} equipamentos
                  </Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RouterIcon className="size-4" aria-hidden="true" /> {perfil.nome}
            </CardTitle>
            <CardDescription>
              Aplicado a {usados.length} equipamento(s) · modelos {perfil.modelos.join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="wan">
              <TabsList>
                <TabsTrigger value="wan">
                  <Globe aria-hidden="true" /> WAN
                </TabsTrigger>
                <TabsTrigger value="lan">
                  <Cpu aria-hidden="true" /> LAN
                </TabsTrigger>
                <TabsTrigger value="wifi">
                  <Wifi aria-hidden="true" /> Wi-Fi
                </TabsTrigger>
                <TabsTrigger value="gestao">
                  <Save aria-hidden="true" /> Gestão
                </TabsTrigger>
              </TabsList>

              <TabsContent value="wan" className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="modo">Modo de conexão</Label>
                  <Select
                    value={perfil.wan.modo}
                    onValueChange={(v) =>
                      alterar({
                        wan: {
                          ...perfil.wan,
                          modo: v as Perfil['wan']['modo'],
                        },
                      })
                    }
                  >
                    <SelectTrigger id="modo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pppoe">PPPoE</SelectItem>
                      <SelectItem value="ip-estatico">IP estático</SelectItem>
                      <SelectItem value="dhcp">DHCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usuario">Usuário PPPoE</Label>
                  <Input
                    id="usuario"
                    value={perfil.wan.usuario}
                    onChange={(e) =>
                      alterar({ wan: { ...perfil.wan, usuario: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vlan">VLAN</Label>
                  <Input
                    id="vlan"
                    type="number"
                    value={perfil.wan.vlan}
                    onChange={(e) =>
                      alterar({ wan: { ...perfil.wan, vlan: Number(e.target.value) } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mtu">MTU</Label>
                  <Input
                    id="mtu"
                    type="number"
                    value={perfil.wan.mtu}
                    onChange={(e) =>
                      alterar({ wan: { ...perfil.wan, mtu: Number(e.target.value) } })
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="descricao">Descrição</Label>
                  <Textarea
                    id="descricao"
                    value={perfil.descricao}
                    onChange={(e) => alterar({ descricao: e.target.value })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="lan" className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gateway">Gateway</Label>
                  <Input
                    id="gateway"
                    value={perfil.lan.gateway}
                    onChange={(e) => alterar({ lan: { ...perfil.lan, gateway: e.target.value } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="faixa">Faixa de rede</Label>
                  <Input
                    id="faixa"
                    value={perfil.lan.faixa}
                    onChange={(e) => alterar({ lan: { ...perfil.lan, faixa: e.target.value } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dns">DNS primário</Label>
                  <Input
                    id="dns"
                    value={perfil.lan.dns[0] ?? ''}
                    onChange={(e) =>
                      alterar({
                        lan: {
                          ...perfil.lan,
                          dns: [e.target.value, ...perfil.lan.dns.slice(1)],
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dns2">DNS secundário</Label>
                  <Input
                    id="dns2"
                    value={perfil.lan.dnsSecundario}
                    onChange={(e) =>
                      alterar({ lan: { ...perfil.lan, dnsSecundario: e.target.value } })
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="wifi" className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ssid">SSID</Label>
                  <Input
                    id="ssid"
                    value={perfil.wifi.ssid}
                    onChange={(e) => alterar({ wifi: { ...perfil.wifi, ssid: e.target.value } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="senha">Senha Wi-Fi</Label>
                  <Input
                    id="senha"
                    type="password"
                    placeholder="Gerada pelo provedor"
                    value={perfil.wifi.senha}
                    onChange={(e) => alterar({ wifi: { ...perfil.wifi, senha: e.target.value } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="banda">Banda</Label>
                  <Select
                    value={perfil.wifi.banda}
                    onValueChange={(v) =>
                      alterar({
                        wifi: { ...perfil.wifi, banda: v as Perfil['wifi']['banda'] },
                      })
                    }
                  >
                    <SelectTrigger id="banda">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2.4GHz">2.4 GHz</SelectItem>
                      <SelectItem value="5GHz">5 GHz</SelectItem>
                      <SelectItem value="dual-band">Dual band</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="largura">Largura de canal</Label>
                  <Select
                    value={perfil.wifi.larguraCanal}
                    onValueChange={(v) =>
                      alterar({
                        wifi: {
                          ...perfil.wifi,
                          larguraCanal: v as Perfil['wifi']['larguraCanal'],
                        },
                      })
                    }
                  >
                    <SelectTrigger id="largura">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['20MHz', '40MHz', '80MHz', '160MHz'].map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">Ocultar SSID</p>
                    <p className="text-xs text-muted-foreground">
                      Rede invisível; o cliente precisa informar o nome para conectar.
                    </p>
                  </div>
                  <Switch
                    checked={perfil.wifi.oculta}
                    onCheckedChange={(v) => alterar({ wifi: { ...perfil.wifi, oculta: v } })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="gestao" className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="acs">URL do ACS (TR-069)</Label>
                  <Input
                    id="acs"
                    value={perfil.gestao.acsUrl}
                    onChange={(e) =>
                      alterar({ gestao: { ...perfil.gestao, acsUrl: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="intervalo">Polling (minutos)</Label>
                  <Input
                    id="intervalo"
                    type="number"
                    value={perfil.gestao.intervaloMin}
                    onChange={(e) =>
                      alterar({
                        gestao: { ...perfil.gestao, intervaloMin: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="metodo">Método de restauração</Label>
                  <Select
                    value={perfil.gestao.metodoRestore}
                    onValueChange={(v) =>
                      alterar({
                        gestao: {
                          ...perfil.gestao,
                          metodoRestore: v as MetodoRestore,
                        },
                      })
                    }
                  >
                    <SelectTrigger id="metodo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tr069-acs">TR-069 / ACS</SelectItem>
                      <SelectItem value="url-bootstrap">URL de bootstrap (DHCP 43/60)</SelectItem>
                      <SelectItem value="token-nuvem">Token na nuvem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bootstrap">URL de bootstrap</Label>
                  <Input
                    id="bootstrap"
                    value={perfil.gestao.urlBootstrap}
                    onChange={(e) =>
                      alterar({ gestao: { ...perfil.gestao, urlBootstrap: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opt43">DHCP option 43 (IP do servidor)</Label>
                  <Input
                    id="opt43"
                    value={perfil.gestao.dhcpOption43}
                    onChange={(e) =>
                      alterar({ gestao: { ...perfil.gestao, dhcpOption43: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opt60">DHCP option 60 (identificador)</Label>
                  <Input
                    id="opt60"
                    value={perfil.gestao.dhcpOption60}
                    onChange={(e) =>
                      alterar({ gestao: { ...perfil.gestao, dhcpOption60: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  {[
                    {
                      id: 'aplicarBranding',
                      titulo: 'Enviar tela de login personalizada',
                      descricao: 'Publica o template de branding no CPE junto do perfil.',
                    },
                    {
                      id: 'aplicarFirmware',
                      titulo: 'Gerenciar firmware',
                      descricao: 'Permite atualização de firmware pelo ACS na próxima janela.',
                    },
                    {
                      id: 'forcarAtualizacao',
                      titulo: 'Forçar atualização de firmware',
                      descricao: 'Aplica assim que o CPE voltar, sem esperar janela de manutenção.',
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
                        checked={perfil.gestao[item.id as 'aplicarBranding']}
                        onCheckedChange={(v) =>
                          alterar({
                            gestao: { ...perfil.gestao, [item.id]: v },
                          } as unknown as Partial<Perfil>)
                        }
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <p className="mt-4 text-xs text-muted-foreground">
              Alterações são salvas automaticamente e valem para todos os equipamentos que usam
              este perfil, inclusive os que forem resetados pelo cliente.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
