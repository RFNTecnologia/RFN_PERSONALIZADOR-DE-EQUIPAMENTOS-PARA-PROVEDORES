import { createClient } from "npm:@supabase/supabase-js@2";

const FUNCTION_PREFIX = "/functions/v1/genieacs-proxy";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const PARAMETER_PATH = /^(?:Device|InternetGatewayDevice)(?:\.[A-Za-z0-9_-]+)+$/;
const SECRET_KEY = /(password|passwd|passphrase|secret|token|private.?key|pre.?shared.?key|wpa.?psk)/i;

type NbiConfig = {
  baseUrl: URL;
  username: string;
  password: string;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function getSupabasePublishableKey(): string | undefined {
  const direct = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  if (direct) return direct;
  const rawKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!rawKeys) return undefined;
  try {
    const parsed = JSON.parse(rawKeys) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0];
  } catch {
    return undefined;
  }
}

async function ensureAdmin(req: Request): Promise<Response | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getSupabasePublishableKey();
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !publishableKey || !authorization) {
    return jsonResponse(503, { error: "Não foi possível validar a sessão administrativa no Supabase. Nenhuma operação ACS foi executada." });
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const jwt = authorization.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse(401, { error: "Sessão inválida ou expirada. Entre novamente no RFN." });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      return jsonResponse(403, { error: "Seu usuário não possui um perfil autorizado para acessar o GenieACS." });
    }
    if (profile.role !== "admin") {
      return jsonResponse(403, { error: "A integração GenieACS está restrita a usuários com função admin no RFN." });
    }
    return null;
  } catch (error) {
    console.error("RFN admin verification failed", error);
    return jsonResponse(503, { error: "Falha ao validar a autorização administrativa. Nenhuma operação ACS foi executada." });
  }
}

function getNbiConfig(): { config?: NbiConfig; error?: string } {
  const rawUrl = Deno.env.get("GENIEACS_NBI_URL")?.trim();
  const username = Deno.env.get("GENIEACS_NBI_USERNAME")?.trim();
  const password = Deno.env.get("GENIEACS_NBI_PASSWORD");

  if (!rawUrl || !username || !password) {
    return {
      error: "GenieACS ainda não foi configurado no backend. Defina GENIEACS_NBI_URL, GENIEACS_NBI_USERNAME e GENIEACS_NBI_PASSWORD nos secrets do ambiente.",
    };
  }

  try {
    const baseUrl = new URL(rawUrl);
    if (baseUrl.protocol !== "https:") {
      return { error: "GENIEACS_NBI_URL deve usar HTTPS público. Um endereço privado da rede local não é acessível por uma Edge Function hospedada." };
    }
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      return { error: "GENIEACS_NBI_URL deve conter somente o endereço base do NBI, sem credenciais, query ou fragmento." };
    }

    const host = baseUrl.hostname.toLowerCase();
    const isPrivateIpv4 = (() => {
      const octets = host.split(".").map((part) => Number(part));
      if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      return octets[0] === 10
        || octets[0] === 127
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168)
        || (octets[0] === 169 && octets[1] === 254);
    })();
    if (host === "localhost" || host.endsWith(".local") || isPrivateIpv4 || host === "::1") {
      return { error: "O NBI informado é local/privado. Configure um endpoint HTTPS acessível pela Edge Function, protegido por autenticação; não use 172.16.x.x ou outro IP da LAN." };
    }

    baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");
    return { config: { baseUrl, username, password } };
  } catch {
    return { error: "GENIEACS_NBI_URL não é uma URL válida." };
  }
}

function redactSecrets(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "_value" in value) {
      return { ...(value as Record<string, unknown>), _value: "[REDACTED]" };
    }
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactSecrets(childValue, childKey),
      ]),
    );
  }
  return value;
}

function normalizePath(url: URL): string {
  const suffix = url.pathname.startsWith(FUNCTION_PREFIX)
    ? url.pathname.slice(FUNCTION_PREFIX.length)
    : "";
  return !suffix || suffix === "/" ? "/devices" : suffix;
}

function validateQuery(url: URL, allowed: string[]): string | null {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) return `Query param não permitido: ${key}`;
  }
  return null;
}

function readParameter(device: Record<string, unknown>, path: string): unknown {
  let current: unknown = device;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function nbiFetch(
  config: NbiConfig,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const target = new URL(`${config.baseUrl.pathname}${path}`, config.baseUrl.origin);
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
  });
  if (body !== undefined) headers.set("Content-Type", "application/json");

  return await fetch(target, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

function validateTask(task: unknown): { task?: Record<string, unknown>; error?: string } {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return { error: "O corpo da tarefa deve ser um objeto JSON." };
  }
  const value = task as Record<string, unknown>;
  if (value.name === "refreshObject") {
    if (typeof value.objectName !== "string" || value.objectName.length > 300) {
      return { error: "refreshObject exige objectName textual de até 300 caracteres." };
    }
    return { task: { name: "refreshObject", objectName: value.objectName } };
  }
  if (value.name === "getParameterValues") {
    const names = value.parameterNames;
    if (!Array.isArray(names) || names.length < 1 || names.length > 100
      || names.some((name) => typeof name !== "string" || !PARAMETER_PATH.test(name))) {
      return { error: "getParameterValues exige de 1 a 100 caminhos TR-069 válidos." };
    }
    return { task: { name: "getParameterValues", parameterNames: names } };
  }
  if (value.name === "setParameterValues") {
    const pairs = value.parameterValues;
    if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > 50) {
      return { error: "setParameterValues exige de 1 a 50 parâmetros." };
    }
    for (const entry of pairs) {
      if (!Array.isArray(entry) || (entry.length !== 2 && entry.length !== 3)
        || typeof entry[0] !== "string" || !PARAMETER_PATH.test(entry[0])
        || (entry.length === 3 && typeof entry[2] !== "string")
        || (typeof entry[1] !== "string" && typeof entry[1] !== "number" && typeof entry[1] !== "boolean")) {
        return { error: "Formato de parâmetro inválido. Use [caminho, valor] ou [caminho, valor, tipo]." };
      }
    }
    return { task: { name: "setParameterValues", parameterValues: pairs } };
  }
  if (value.name === "reboot") return { task: { name: "reboot" } };
  return { error: "Tipo de tarefa não permitido. Permitidos: refreshObject, getParameterValues, setParameterValues e reboot. Factory reset não é disponibilizado por esta API." };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse(405, { error: "Método não permitido." });
  }

  // The gateway verifies the JWT; this handler additionally requires the RFN admin role.
  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Faça login no RFN para acessar o GenieACS." });
  }
  const authorizationError = await ensureAdmin(req);
  if (authorizationError) return authorizationError;

  const resolved = getNbiConfig();
  if (!resolved.config) return jsonResponse(503, { error: resolved.error ?? "GenieACS não configurado." });
  const config = resolved.config;
  const url = new URL(req.url);
  const path = normalizePath(url);

  try {
    if (req.method === "GET" && (path === "/devices" || path === "/devices/")) {
      const queryError = validateQuery(url, ["query", "projection", "limit"]);
      if (queryError) return jsonResponse(400, { error: queryError });
      if (url.searchParams.has("limit")) {
        const limit = Number(url.searchParams.get("limit"));
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
          return jsonResponse(400, { error: "limit deve ser um inteiro entre 1 e 1000." });
        }
      }

      const upstream = await nbiFetch(config, `/devices/${url.search}`, "GET");
      if (!upstream.ok) {
        return jsonResponse(502, { error: `GenieACS NBI respondeu HTTP ${upstream.status} ao consultar dispositivos.` });
      }
      const data: unknown = await upstream.json();
      return new Response(JSON.stringify(redactSecrets(data)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const taskMatch = /^\/devices\/([^/]+)\/tasks\/?$/.exec(path);
    if (req.method === "POST" && taskMatch) {
      const queryError = validateQuery(url, ["connection_request", "timeout"]);
      if (queryError) return jsonResponse(400, { error: queryError });
      const timeout = url.searchParams.get("timeout");
      if (timeout !== null && (!/^\d{1,5}$/.test(timeout) || Number(timeout) > 30000)) {
        return jsonResponse(400, { error: "timeout deve ser um inteiro entre 0 e 30000 ms." });
      }

      let deviceId: string;
      try {
        deviceId = decodeURIComponent(taskMatch[1]);
      } catch {
        return jsonResponse(400, { error: "ID de dispositivo inválido." });
      }
      if (!deviceId || deviceId.length > 300 || /[/?#]/.test(deviceId)) {
        return jsonResponse(400, { error: "ID de dispositivo inválido." });
      }

      let rawTask: unknown;
      try {
        rawTask = await req.json();
      } catch {
        return jsonResponse(400, { error: "O corpo da tarefa não contém JSON válido." });
      }
      const validated = validateTask(rawTask);
      if (!validated.task) return jsonResponse(400, { error: validated.error ?? "Tarefa inválida." });

      if (validated.task.name === "setParameterValues") {
        const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
        const deviceResponse = await nbiFetch(config, `/devices/?query=${query}`, "GET");
        if (!deviceResponse.ok) {
          return jsonResponse(502, { error: `GenieACS NBI respondeu HTTP ${deviceResponse.status} ao validar o equipamento.` });
        }
        const devices: unknown = await deviceResponse.json();
        const device = Array.isArray(devices)
          ? devices.find((item) => item && typeof item === "object" && (item as Record<string, unknown>)._id === deviceId)
          : null;
        if (!device || typeof device !== "object") {
          return jsonResponse(404, { error: "Equipamento não encontrado no GenieACS. Confirme o ID e se ele já enviou Inform." });
        }
        const parameterValues = validated.task.parameterValues as unknown[][];
        const notWritable = parameterValues
          .map((entry) => String(entry[0]))
          .filter((parameterPath) => {
            const node = readParameter(device as Record<string, unknown>, parameterPath);
            return !node || typeof node !== "object" || (node as Record<string, unknown>)._writable !== true;
          });
        if (notWritable.length) {
          return jsonResponse(409, {
            error: "O CPE não reportou esses parâmetros como graváveis. Nenhuma alteração foi enviada.",
            notWritable,
          });
        }
      }

      const encodedDeviceId = encodeURIComponent(deviceId);
      const upstreamPath = `/devices/${encodedDeviceId}/tasks${url.search}`;
      const upstream = await nbiFetch(config, upstreamPath, "POST", validated.task);
      if (!upstream.ok) {
        return jsonResponse(502, { error: `GenieACS NBI rejeitou a tarefa (HTTP ${upstream.status}).` });
      }
      let result: Record<string, unknown> = {};
      try {
        const data: unknown = await upstream.json();
        if (data && typeof data === "object") result = data as Record<string, unknown>;
      } catch {
        // The task may complete without a JSON response in some deployments.
      }
      return jsonResponse(upstream.status, {
        accepted: true,
        status: upstream.status,
        taskId: typeof result._id === "string" ? result._id : null,
        taskName: validated.task.name,
        message: upstream.status === 202
          ? "Tarefa enfileirada no GenieACS; o CPE pode executá-la no próximo Inform."
          : "Tarefa aceita pelo GenieACS.",
      });
    }

    return jsonResponse(404, { error: "Rota não permitida. Disponíveis: GET /devices e POST /devices/{id}/tasks." });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return jsonResponse(504, { error: "Tempo esgotado ao consultar o GenieACS NBI." });
    }
    console.error("GenieACS proxy failure", error);
    return jsonResponse(502, { error: "Não foi possível alcançar o GenieACS NBI. Verifique o endpoint HTTPS e a conectividade do servidor." });
  }
});
