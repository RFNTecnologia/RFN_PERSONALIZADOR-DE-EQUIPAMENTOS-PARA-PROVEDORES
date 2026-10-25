import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, FileText, LoaderCircle, PackageCheck, Save, ShieldAlert, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Json, Tables } from "@/integrations/supabase/types";

type ProviderSettings = Tables<"provider_settings">;
type PersonalizationProfile = Tables<"personalization_profiles">;

const MODEL_CATALOG = [
  {
    key: "cdata-fd511g-x-f670",
    manufacturer: "C-Data",
    model: "FD511G-X-F670",
    kind: "ONU XPON 1GE",
    nextStep: "Solicitar ao OEM/distribuidor o build de ISP específico e confirmar logo, padrões após reset e retorno do gerenciamento.",
    vendorQuestions: [
      "Existe firmware/build ISP autorizado para o FD511G-X-F670 nesta revisão de hardware e versão de firmware?",
      "O build permite logo/favicon próprios na interface web e esses elementos permanecem após factory reset?",
      "É possível definir SSIDs e demais padrões do provedor como novos padrões persistentes após reset?",
      "Qual método de gestão é suportado nesta variante: OLT/EMS, OMCI/OAM, TR-069 ou API do fabricante?",
      "Após reset, como a ONU mantém/recupera o registro na OLT e o endereço/bootstrap do ACS?",
      "Enviar pacote autorizado, checksum, release notes, requisitos de PON/autenticação, backup e procedimento de recuperação/rollback.",
    ],
  },
  {
    key: "zte-f6600p",
    manufacturer: "ZTE",
    model: "ZXHN F6600P",
    kind: "ONT GPON Wi-Fi 6",
    nextStep: "Confirmar variante de operadora, build OEM e método oficial para aplicar branding e recuperar a gestão depois do reset.",
    vendorQuestions: [
      "Existe build de ISP autorizado para o ZXHN F6600P correspondente à revisão, região e firmware informados?",
      "A variante permite substituir logo/favicon e definir padrões de fábrica persistentes após factory reset?",
      "Quais recursos de gestão estão habilitados no firmware entregue: OMCI, TR-069, EMS/OLT ou mecanismo proprietário?",
      "Como a configuração de ACS/bootstrap e o gerenciamento remoto são restaurados após reset de fábrica?",
      "Enviar pacote autorizado, checksum, release notes, requisitos da OLT e procedimento documentado de recuperação/rollback.",
    ],
  },
  {
    key: "zte-f6201b",
    manufacturer: "ZTE",
    model: "ZXHN F6201B",
    kind: "ONT GPON Wi-Fi 6",
    nextStep: "A ZTE documenta OMCI/TR-069 e dual-image; falta confirmar branding e padrões persistentes na variante exata.",
    vendorQuestions: [
      "Existe build de ISP autorizado para esta revisão de hardware, região e firmware do ZXHN F6201B?",
      "A variante permite logo/favicon próprios e padrões persistentes após reset? Solicita-se confirmação por escrito.",
      "Confirmar suporte OMCI e TR-069 no firmware específico e o método de provisionamento pela OLT/EMS.",
      "Informar o mecanismo de retorno ao ACS/bootstrap após factory reset e quais dados de registro GPON sobrevivem.",
      "Esclarecer separadamente se dual-image/rollback protege apenas a atualização de software ou também os defaults após reset.",
      "Enviar pacote autorizado, checksum, notas da versão e procedimento de recuperação/rollback.",
    ],
  },
  {
    key: "mercusys-mr60x-v2",
    manufacturer: "MERCUSYS",
    model: "MR60X V2",
    kind: "Roteador Wi-Fi 6",
    nextStep: "A página ISP Preset lista o MR60X V2 no Agile Config 2.1; falta obter/validar o General Config gerado para HW/FW exatos.",
    vendorQuestions: [
      "Confirmar acesso autorizado à geração do General Config compatível com esta revisão e firmware exatos.",
      "Confirmar requisitos do arquivo de logo/favicon e habilitação de Keep New Defaults.",
      "Fornecer procedimento seguro de aplicação, indicador de sucesso e recuperação se o processo falhar.",
      "O backup comum da interface web não deve ser tratado como General Config ou pacote Agile Config.",
    ],
  },
] as const;

const BRANDING_METHODS = [
  ["pending_oem", "Aguardando método/pacote OEM"],
  ["oem_firmware", "Firmware/pacote OEM"],
  ["vendor_preset", "Preset oficial do fabricante"],
  ["tr069_parameter", "Parâmetro TR-069 (não altera logo por si só)"],
  ["unsupported", "Não suportado nesta variante"],
  ["unknown", "Ainda não identificado"],
] as const;

const PERSISTENCE_METHODS = [
  ["pending_oem", "Aguardando confirmação do fabricante"],
  ["persistent_oem_defaults", "Padrões persistentes OEM"],
  ["olt_reprovision", "Reprovisionamento pela OLT após registro"],
  ["acs_bootstrap", "Bootstrap/retorno ao ACS"],
  ["local_recovery", "Recuperação local"],
  ["unsupported", "Não suportado"],
  ["unknown", "Ainda não identificado"],
] as const;

const RECOVERY_METHODS = [
  ["pending_oem", "Aguardando confirmação do fabricante"],
  ["olt_omci", "Reprovisionamento pela OLT/OMCI"],
  ["tr069_bootstrap", "Bootstrap TR-069 comprovado"],
  ["vendor_bootstrap", "Bootstrap proprietário do fabricante"],
  ["local_recovery", "Recuperação local necessária"],
  ["unknown", "Ainda não identificado"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  waiting_oem: "Aguardando OEM",
  package_ready: "Pacote compatível informado — ainda não aplicado",
  applied: "Aplicado (registro manual)",
  verified: "Verificado (registro manual)",
  reset_tested: "Reset testado (registro manual)",
  recovery_verified: "Recuperação verificada (registro manual)",
  manual_recovery_required: "Requer recuperação local",
};

type Draft = {
  profileName: string;
  modelKey: string;
  hardwareRevision: string;
  firmwareVersion: string;
  companyName: string;
  logoUrl: string;
  faviconUrl: string;
  ssid24: string;
  ssid5: string;
  brandingMethod: string;
  persistenceStrategy: string;
  recoveryStrategy: string;
  packageReference: string;
  vendorConfirmed: boolean;
  notes: string;
};

function emptyDraft(settings: ProviderSettings | null): Draft {
  return {
    profileName: "Megapix - C-Data FD511G-X-F670",
    modelKey: "cdata-fd511g-x-f670",
    hardwareRevision: "",
    firmwareVersion: "",
    companyName: settings?.company_name ?? "Megapix Provedor de Internet",
    logoUrl: settings?.logo_url ?? "",
    faviconUrl: settings?.favicon_url ?? "",
    ssid24: settings?.default_wifi_ssid ?? "",
    ssid5: settings?.default_wifi_ssid_5g ?? "",
    brandingMethod: "pending_oem",
    persistenceStrategy: "pending_oem",
    recoveryStrategy: "pending_oem",
    packageReference: "",
    vendorConfirmed: false,
    notes: "",
  };
}

function draftFromProfile(profile: PersonalizationProfile): Draft {
  const model = MODEL_CATALOG.find((item) => item.manufacturer === profile.manufacturer && item.model === profile.model);
  const config = profile.config && typeof profile.config === "object" && !Array.isArray(profile.config)
    ? profile.config as Record<string, Json>
    : {};
  const wifi = config.wifi && typeof config.wifi === "object" && !Array.isArray(config.wifi)
    ? config.wifi as Record<string, Json>
    : {};
  return {
    profileName: profile.profile_name,
    modelKey: model?.key ?? MODEL_CATALOG[0].key,
    hardwareRevision: profile.hardware_revision ?? "",
    firmwareVersion: profile.firmware_version ?? "",
    companyName: profile.company_name ?? "",
    logoUrl: profile.logo_url ?? "",
    faviconUrl: profile.favicon_url ?? "",
    ssid24: typeof wifi.ssid24 === "string" ? wifi.ssid24 : profile.default_wifi_ssid_24 ?? "",
    ssid5: typeof wifi.ssid5 === "string" ? wifi.ssid5 : profile.default_wifi_ssid_5 ?? "",
    brandingMethod: profile.branding_method,
    persistenceStrategy: profile.persistence_strategy,
    recoveryStrategy: profile.recovery_strategy,
    packageReference: profile.package_reference ?? "",
    vendorConfirmed: profile.oem_compatibility_confirmed,
    notes: profile.notes ?? "",
  };
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold">{label}</span>{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</label>;
}

function SelectField({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}

export function PersistentPersonalizationPanel({ settings, onNotify }: {
  settings: ProviderSettings | null;
  onNotify: (message: string) => void;
}) {
  const [profiles, setProfiles] = useState<PersonalizationProfile[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(settings));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedModel = useMemo(
    () => MODEL_CATALOG.find((model) => model.key === draft.modelKey) ?? MODEL_CATALOG[0],
    [draft.modelKey],
  );

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("personalization_profiles")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      onNotify(`Não foi possível carregar os planos de personalização. Confira se a migração do módulo foi aplicada: ${error.message}`);
      setProfiles([]);
    } else {
      setProfiles((data ?? []) as PersonalizationProfile[]);
    }
    setLoading(false);
  }, [onNotify]);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function chooseModel(modelKey: string) {
    const model = MODEL_CATALOG.find((item) => item.key === modelKey) ?? MODEL_CATALOG[0];
    setDraft((previous) => ({
      ...previous,
      modelKey,
      profileName: selectedId ? previous.profileName : `${previous.companyName || "ISP"} - ${model.manufacturer} ${model.model}`,
      brandingMethod: "pending_oem",
      persistenceStrategy: "pending_oem",
      recoveryStrategy: "pending_oem",
      packageReference: "",
      vendorConfirmed: false,
      hardwareRevision: "",
      firmwareVersion: "",
    }));
  }

  function resetDraft() {
    setSelectedId(null);
    setDraft(emptyDraft(settings));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult.user) throw new Error("Sua sessão expirou. Entre novamente no RFN.");
      if (!draft.profileName.trim()) throw new Error("Informe um nome para o plano de personalização.");
      if (!draft.companyName.trim()) throw new Error("Informe o nome do provedor.");

      const methodIsResolved = (method: string) => !["pending_oem", "unsupported", "unknown"].includes(method);
      const packageReady = draft.vendorConfirmed
        && Boolean(draft.hardwareRevision.trim())
        && Boolean(draft.firmwareVersion.trim())
        && Boolean(draft.packageReference.trim())
        && methodIsResolved(draft.brandingMethod)
        && methodIsResolved(draft.persistenceStrategy)
        && methodIsResolved(draft.recoveryStrategy);

      const payload = {
        user_id: userResult.user.id,
        profile_name: draft.profileName.trim(),
        manufacturer: selectedModel.manufacturer,
        model: selectedModel.model,
        hardware_revision: draft.hardwareRevision.trim() || null,
        firmware_version: draft.firmwareVersion.trim() || null,
        branding_method: draft.brandingMethod,
        persistence_strategy: draft.persistenceStrategy,
        recovery_strategy: draft.recoveryStrategy,
        package_reference: draft.packageReference.trim() || null,
        oem_compatibility_confirmed: draft.vendorConfirmed,
        company_name: draft.companyName.trim(),
        logo_url: draft.logoUrl.trim() || null,
        favicon_url: draft.faviconUrl.trim() || null,
        default_wifi_ssid_24: draft.ssid24.trim() || null,
        default_wifi_ssid_5: draft.ssid5.trim() || null,
        status: packageReady ? "package_ready" : "waiting_oem",
        notes: draft.notes.trim() || null,
        config: {
          schemaVersion: 1,
          purpose: "persistent-device-personalization-plan",
          wifi: { ssid24: draft.ssid24.trim(), ssid5: draft.ssid5.trim() },
          secretsIncluded: false,
          statusMeaning: packageReady
            ? "OEM compatibility was marked confirmed by the operator; no firmware action is executed by saving this plan."
            : "Plan saved; OEM package or exact compatibility evidence remains pending.",
        } as Json,
      };

      const query = selectedId
        ? supabase.from("personalization_profiles").update(payload).eq("id", selectedId)
        : supabase.from("personalization_profiles").insert(payload);
      const { error } = await query;
      if (error) throw error;
      onNotify(packageReady
        ? "Plano salvo com referência de compatibilidade OEM. Nenhuma gravação foi enviada ao equipamento."
        : "Plano salvo como aguardando OEM. Nenhuma gravação foi enviada ao equipamento.");
      await loadProfiles();
      resetDraft();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Não foi possível salvar o plano.");
    } finally {
      setSaving(false);
    }
  }

  function exportPlan() {
    const plan = {
      schemaVersion: 1,
      purpose: "RFN persistent personalization plan",
      profileName: draft.profileName,
      provider: { name: draft.companyName, logoUrl: draft.logoUrl || null, faviconUrl: draft.faviconUrl || null },
      target: {
        manufacturer: selectedModel.manufacturer,
        model: selectedModel.model,
        hardwareRevision: draft.hardwareRevision || null,
        firmwareVersion: draft.firmwareVersion || null,
      },
      branding: { method: draft.brandingMethod },
      afterFactoryReset: {
        persistenceStrategy: draft.persistenceStrategy,
        recoveryStrategy: draft.recoveryStrategy,
      },
      defaults: { wifiSsid24: draft.ssid24 || null, wifiSsid5: draft.ssid5 || null },
      oemPackageReference: draft.packageReference || null,
      oemCompatibilityConfirmedByOperator: draft.vendorConfirmed,
      notes: draft.notes || null,
      secretsIncluded: false,
      executionStatus: "plan-only-no-device-action-performed",
    };
    const safeName = draft.profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rfn-personalizacao";
    downloadJson(`${safeName}.json`, plan);
    onNotify("Plano JSON exportado. O arquivo descreve a intenção de configuração; não é firmware nem um pacote de gravação.");
  }

  function exportSupportRequest() {
    const message = [
      "Solicitação de personalização ISP persistente — RFN",
      "",
      `Provedor: ${draft.companyName || "[nome do provedor]"}`,
      `Fabricante: ${selectedModel.manufacturer}`,
      `Modelo: ${selectedModel.model}`,
      `Revisão de hardware: ${draft.hardwareRevision || "[informar]"}`,
      `Firmware completo: ${draft.firmwareVersion || "[informar]"}`,
      "",
      "Solicitamos confirmação por escrito e procedimento oficial para este modelo/variante:",
      ...selectedModel.vendorQuestions.map((question, index) => `${index + 1}. ${question}`),
      "",
      "O material comum solicitado é um pacote/ferramenta autorizado, checksum, notas de versão, pré-requisitos, evidência de compatibilidade e procedimento de recuperação/rollback.",
      "Um backup comum da interface web não será considerado firmware, General Config ou pacote de personalização sem confirmação do OEM.",
      "",
      "Objetivo: validar primeiro em unidade de laboratório, sem aplicar em equipamento ativo de cliente.",
    ].join("\n");
    downloadText("solicitacao-personalizacao-oem.txt", message);
    onNotify("Solicitação técnica ao fabricante exportada como TXT.");
  }

  const statusTone = (status: string) => status === "recovery_verified" || status === "reset_tested" || status === "verified"
    ? "border-success/40 bg-success/10 text-success"
    : status === "waiting_oem" || status === "manual_recovery_required"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-border bg-muted text-muted-foreground";

  return <div className="space-y-5">
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/15 text-primary"><Wrench size={21}/></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">Personalização persistente de equipamentos</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">Prepare perfis por fabricante, modelo, revisão e firmware para a identidade visual do provedor e o retorno após reset. O RFN só poderá aplicar um perfil quando o método oficial do equipamento estiver confirmado.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {MODEL_CATALOG.filter((model) => model.manufacturer !== "MERCUSYS").map((model) => (
          <article key={model.key} className="rounded-md border border-border bg-background p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{model.manufacturer}</p>
            <h3 className="mt-1 font-semibold">{model.model}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{model.kind}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{model.nextStep}</p>
            <span className="mt-3 inline-flex rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">Aguardando método OEM</span>
          </article>
        ))}
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning"/>
        <p>O bloqueio PPPoE continua no MikroTik. Esta tela trata somente da personalização do equipamento, padrões após reset e recuperação do gerenciamento. Salvar/exportar o plano não altera firmware nem executa reset.</p>
      </div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
      <form onSubmit={saveProfile} className="space-y-5 rounded-lg border border-border bg-card p-5 sm:p-6">
        <div>
          <h3 className="text-lg font-bold">{selectedId ? "Editar plano" : "Novo plano de personalização"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Não inclua senhas PPPoE, senhas de administração nem credenciais ACS neste plano.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do plano">
            <Input required value={draft.profileName} onChange={(event) => update("profileName", event.target.value)} />
          </Field>
          <Field label="Modelo alvo">
            <select value={draft.modelKey} onChange={(event) => chooseModel(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
              {MODEL_CATALOG.map((model) => <option key={model.key} value={model.key}>{model.manufacturer} — {model.model}</option>)}
            </select>
          </Field>
          <Field label="Revisão de hardware" hint="Copie o valor exato da etiqueta ou da interface.">
            <Input value={draft.hardwareRevision} onChange={(event) => update("hardwareRevision", event.target.value)} placeholder="Ex.: V2.0" />
          </Field>
          <Field label="Versão completa do firmware" hint="Não use apenas o nome comercial do modelo.">
            <Input value={draft.firmwareVersion} onChange={(event) => update("firmwareVersion", event.target.value)} placeholder="Versão/build completo" />
          </Field>
          <Field label="Nome do provedor">
            <Input required value={draft.companyName} onChange={(event) => update("companyName", event.target.value)} />
          </Field>
          <Field label="URL pública da logo">
            <Input type="url" value={draft.logoUrl} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://.../logo.png" />
          </Field>
          <Field label="URL pública do favicon">
            <Input type="url" value={draft.faviconUrl} onChange={(event) => update("faviconUrl", event.target.value)} placeholder="https://.../favicon.ico" />
          </Field>
          <Field label="SSID padrão 2,4 GHz">
            <Input value={draft.ssid24} onChange={(event) => update("ssid24", event.target.value)} placeholder="Nome da rede 2,4 GHz" />
          </Field>
          <Field label="SSID padrão 5 GHz">
            <Input value={draft.ssid5} onChange={(event) => update("ssid5", event.target.value)} placeholder="Nome da rede 5 GHz" />
          </Field>
          <Field label="Método de branding">
            <SelectField value={draft.brandingMethod} onChange={(value) => update("brandingMethod", value)} options={BRANDING_METHODS} />
          </Field>
          <Field label="Persistência após reset">
            <SelectField value={draft.persistenceStrategy} onChange={(value) => update("persistenceStrategy", value)} options={PERSISTENCE_METHODS} />
          </Field>
          <Field label="Recuperação do gerenciamento">
            <SelectField value={draft.recoveryStrategy} onChange={(value) => update("recoveryStrategy", value)} options={RECOVERY_METHODS} />
          </Field>
          <Field label="Referência do pacote ou chamado OEM" hint="Nome do pacote autorizado, número do chamado ou link da documentação. Não é um firmware carregado aqui.">
            <Input value={draft.packageReference} onChange={(event) => update("packageReference", event.target.value)} placeholder="Ex.: ticket do fabricante / pacote aprovado" />
          </Field>
          <div className="sm:col-span-2 rounded-md border border-border bg-background p-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={draft.vendorConfirmed} onChange={(event) => update("vendorConfirmed", event.target.checked)} className="mt-1 size-4 accent-primary"/>
              <span><span className="font-semibold">O fabricante confirmou a compatibilidade deste método para este modelo, revisão e firmware exatos.</span><span className="mt-1 block text-xs text-muted-foreground">Só marque após obter confirmação/documentação do OEM. Isso registra a evidência, mas não aplica nem valida o pacote automaticamente.</span></span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <Field label="Observações técnicas" hint="Registre caminho autorizado de recuperação, limitações ou referência da documentação. Não coloque segredos.">
              <Textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Modelo, variante, requisitos de laboratório, recuperação após reset..." />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin"/> : <Save/>}{saving ? "Salvando..." : "Salvar plano"}</Button>
          <Button type="button" variant="secondary" onClick={exportPlan}><Download/>Exportar plano JSON</Button>
          <Button type="button" variant="outline" onClick={exportSupportRequest}><FileText/>Solicitação técnica OEM</Button>
          {selectedId && <Button type="button" variant="ghost" onClick={resetDraft}>Novo plano</Button>}
        </div>
      </form>

      <aside className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="font-bold">Sequência exigida antes da aplicação</h3>
          <ol className="mt-4 space-y-3 text-sm">
            {[
              ["1", "Identificar revisão e firmware", "Os valores precisam corresponder à etiqueta/interface real."],
              ["2", "Obter método/pacote OEM", "Logo e padrões persistentes exigem suporte do fabricante."],
              ["3", "Definir recuperação pós-reset", "Confirmar persistência OEM, OLT/bootstrap ou recuperação local."],
              ["4", "Validar em laboratório", "Só registrar aplicado/resetado/recuperado após evidência real."],
            ].map(([number, title, description]) => <li key={number} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">{number}</span><span><span className="font-semibold">{title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span></span></li>)}
          </ol>
        </section>
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Planos salvos</h3><Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void loadProfiles()}><LoaderCircle className={loading ? "animate-spin" : ""}/>Atualizar</Button></div>
          {loading ? <p className="mt-4 text-sm text-muted-foreground">Carregando...</p> : profiles.length ? <div className="mt-3 space-y-3">{profiles.map((profile) => <article key={profile.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{profile.profile_name}</p><p className="mt-1 text-xs text-muted-foreground">{profile.manufacturer} · {profile.model}</p></div><button type="button" className="text-xs font-semibold text-primary underline" onClick={() => { setSelectedId(profile.id); setDraft(draftFromProfile(profile)); }}>Editar</button></div><span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(profile.status)}`}>{STATUS_LABELS[profile.status] ?? profile.status}</span>{profile.hardware_revision || profile.firmware_version ? <p className="mt-2 text-xs text-muted-foreground">HW: {profile.hardware_revision || "não informado"} · FW: {profile.firmware_version || "não informado"}</p> : null}</article>)}</div> : <p className="mt-3 text-sm text-muted-foreground">Nenhum plano salvo. Crie um plano para iniciar a preparação do modelo.</p>}
        </section>
        <section className="rounded-lg border border-border bg-card p-4 text-xs leading-5 text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-semibold text-foreground"><PackageCheck size={15}/> Limite desta etapa</div>
          Este módulo guarda o plano, exporta metadados sem segredos e registra a confirmação OEM informada pelo operador. Ainda não grava firmware, não envia comandos à ONU/ONT/roteador e não testa reset. A aplicação real será ligada apenas a um adaptador autorizado e compatível com o modelo/firmware.
        </section>
      </aside>
    </div>
  </div>;
}
