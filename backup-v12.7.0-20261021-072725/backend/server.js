import express from "express";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRouterOSConfigured, routerOSConnectionTest, routerOSServiceAction } from "./mikrotik.js";

const { Pool } = pg;
const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 8080);
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const cpeAdminPassword = process.env.CPE_ADMIN_PASSWORD;
const cookieSecure = process.env.API_COOKIE_SECURE === "true";
const sessionLifetimeSeconds = 60 * 60;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY para usar Supabase Auth");
}
if (!databaseUrl) {
  throw new Error("Configure DATABASE_URL para o PostgreSQL operacional usado pelo RFN");
}
const pool = new Pool({ connectionString: databaseUrl });
const genieAcsNbiUrl = process.env.GENIEACS_NBI_URL || "http://genieacs:7557";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDirectory = path.join(__dirname, "migrations");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));

async function nbiRequest(endpoint, options = {}) {
  const response = await fetch(`${genieAcsNbiUrl}${endpoint}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(`GenieACS NBI ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return { status: response.status, data };
}

async function nbiFetch(endpoint, options = {}) {
  const result = await nbiRequest(endpoint, options);
  return result.data;
}


function sessionCookie(req) {
  const cookies = req.headers.cookie?.split(";") || [];
  const session = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith("rfn_session="));
  return session?.slice("rfn_session=".length) || "";
}

function setSessionCookie(res, token, maxAge = sessionLifetimeSeconds) {
  const secure = cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `rfn_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

async function getSupabaseUser(token) {
  if (!token) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function getProfile(userId, token) {
  // Profiles live in the same Supabase project used for Auth. Use the user's
  // access token so the profiles_select_own RLS policy remains in force.
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name,role&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 200);
    throw new Error(`Supabase profile lookup failed (${response.status}): ${details}`);
  }
  const profiles = await response.json();
  return Array.isArray(profiles) ? profiles[0] || null : null;
}

async function requireAdminSession(req, res, next) {
  try {
    const token = sessionCookie(req);
    const user = await getSupabaseUser(token);
    if (!user?.id) return res.status(401).json({ error: "Autenticação necessária" });
    const profile = await getProfile(user.id, token);
    if (!profile) return res.status(403).json({ error: "Perfil de acesso não encontrado" });
    if (profile.role !== "admin") return res.status(403).json({ error: "Acesso restrito a administradores" });
    req.authUser = user;
    req.authProfile = profile;
    next();
  } catch (error) { next(error); }
}
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.post("/api/auth/session", async (req, res) => {
  try {
    const token = String(req.body?.access_token || "");
    if (!token || token.length > 10000) return res.status(400).json({ error: "Token de sessão inválido" });
    const user = await getSupabaseUser(token);
    if (!user?.id) return res.status(401).json({ error: "Sessão Supabase inválida ou expirada" });
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: "Não foi possível validar a sessão Supabase" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  setSessionCookie(res, "", 0);
  res.status(204).end();
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  return requireAdminSession(req, res, next);
});

// The global /api middleware intentionally skips /auth/* routes so login/logout
// can work before a session exists. The identity endpoint must enforce the admin
// session explicitly because Nginx uses it as auth_request for /genieacs/.
app.get("/api/auth/me", requireAdminSession, (req, res) => {
  res.json({ authenticated: true, user: { id: req.authUser.id, email: req.authUser.email }, profile: req.authProfile });
});

async function syncAcsDevices() {
  const devices = await nbiFetch("/devices/", { headers: {} });
  if (!Array.isArray(devices)) return [];
  for (const d of devices) {
    const id = d._id || null;
    if (!id) continue;
    const manufacturer = d?._deviceId?._Manufacturer
      || d?.Device?.DeviceInfo?.Manufacturer?.value
      || d?.InternetGatewayDevice?.DeviceInfo?.Manufacturer?.value
      || "Desconhecido";
    const model = d?._deviceId?._ProductClass
      || d?.Device?.DeviceInfo?.ModelName?.value
      || d?.InternetGatewayDevice?.DeviceInfo?.ModelName?.value
      || "Desconhecido";
    const serial = d?._deviceId?._SerialNumber
      || d?.Device?.DeviceInfo?.SerialNumber?.value
      || d?.InternetGatewayDevice?.DeviceInfo?.SerialNumber?.value
      || id;
    const oui = d?._deviceId?._OUI || null;
    const mac = d?.Device?.Ethernet?.Interface?.[1]?.MACAddress?.value
      || d?.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANIPConnection?.[1]?.MACAddress?.value
      || (oui ? `${oui}-${serial}` : null);
    const lastInform = d._lastInform || null;

    const existingByAcs = await pool.query(
      "select id from equipment where acs_device_id=$1 limit 1",
      [id]
    );

    if (existingByAcs.rowCount) {
      await pool.query(`
        update equipment set
          manufacturer=$1,
          model=$2,
          equipment_type=$3,
          serial_number=$4,
          mac=coalesce($5, mac),
          status=$6,
          last_seen=$7
        where id=$8
      `, [manufacturer, model, "router", String(serial), mac, lastInform ? "online" : "unknown", lastInform, existingByAcs.rows[0].id]);
    } else {
      await pool.query(`
        insert into equipment(acs_device_id, manufacturer, model, equipment_type, serial_number, mac, status, last_seen)
        values($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict(serial_number) do update set
          acs_device_id=excluded.acs_device_id,
          manufacturer=excluded.manufacturer,
          model=excluded.model,
          equipment_type=excluded.equipment_type,
          mac=coalesce(excluded.mac, equipment.mac),
          status=excluded.status,
          last_seen=excluded.last_seen
      `, [id, manufacturer, model, "router", String(serial), mac, lastInform ? "online" : "unknown", lastInform]);
    }
  }
  return devices;
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, database: "up" });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const q = await pool.query(`
      select
        (select count(*) from customers) customers,
        (select count(*) from equipment) equipment,
        (select count(*) from equipment where status='online') online_equipment,
        (select count(*) from equipment_profiles) profiles
    `);
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/provider-settings", async (_req, res, next) => {
  try {
    const q = await pool.query("select * from provider_settings where id=1");
    if (!q.rowCount) return res.status(404).json({ error: "Configuração do provedor não encontrada" });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/provider-settings", async (req, res, next) => {
  try {
    const { company_name, logo_url, favicon_url, support_phone, support_whatsapp, portal_title, portal_message, default_wifi_ssid, default_wifi_ssid_5g, acs_url, acs_username, connection_request_path, reset_policy } = req.body;
    if (!company_name) return res.status(400).json({ error: "company_name é obrigatório" });
    const q = await pool.query(`
      update provider_settings set
        company_name=$1, logo_url=$2, favicon_url=$3, support_phone=$4, support_whatsapp=$5,
        portal_title=$6, portal_message=$7, default_wifi_ssid=$8, default_wifi_ssid_5g=$9,
        acs_url=$10, acs_username=$11, connection_request_path=$12, reset_policy=$13, updated_at=now()
      where id=1 returning *
    `, [company_name, logo_url || null, favicon_url || null, support_phone || null, support_whatsapp || null, portal_title || 'Configuração do Equipamento', portal_message || null, default_wifi_ssid || null, default_wifi_ssid_5g || null, acs_url || null, acs_username || null, connection_request_path || null, reset_policy || 'Após reset de fábrica, a recuperação do padrão personalizado depende do suporte do fabricante/firmware.']);
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/customers", async (_req, res, next) => {
  try {
    const q = await pool.query("select * from customers order by id desc limit 200");
    res.json(q.rows);
  } catch (e) { next(e); }
});

app.post("/api/customers", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const document = String(req.body?.document || "").trim() || null;
    const phone = String(req.body?.phone || "").trim() || null;
    const address = String(req.body?.address || "").trim() || null;
    const pppoeUsername = String(req.body?.pppoe_username || "").trim() || null;
    if (!name) return res.status(400).json({ error: "Informe o nome completo ou razão social do cliente." });
    if (name.length > 180 || (document && document.length > 40) || (phone && phone.length > 50) || (address && address.length > 300)) {
      return res.status(400).json({ error: "Um ou mais campos do cliente excedem o tamanho permitido." });
    }
    if (pppoeUsername && pppoeUsername.length > 180) {
      return res.status(400).json({ error: "O usuário PPPoE deve ter até 180 caracteres." });
    }
    const q = await pool.query(
      `insert into customers(name, document, phone, address, pppoe_username)
       values($1,$2,$3,$4,$5) returning *`,
      [name, document, phone, address, pppoeUsername]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505" && e.constraint === "customers_pppoe_username_unique_idx") {
      return res.status(409).json({ error: "Esse usuário PPPoE já está vinculado a outro cliente." });
    }
    next(e);
  }
});

app.patch("/api/customers/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "ID de cliente inválido." });
  const name = String(req.body?.name || "").trim();
  const document = String(req.body?.document || "").trim() || null;
  const phone = String(req.body?.phone || "").trim() || null;
  const address = String(req.body?.address || "").trim() || null;
  const pppoeUsername = String(req.body?.pppoe_username || "").trim() || null;
  if (!name) return res.status(400).json({ error: "Informe o nome completo ou razão social do cliente." });
  if (name.length > 180 || (document && document.length > 40) || (phone && phone.length > 50) || (address && address.length > 300)) {
    return res.status(400).json({ error: "Um ou mais campos do cliente excedem o tamanho permitido." });
  }
  if (pppoeUsername && pppoeUsername.length > 180) {
    return res.status(400).json({ error: "O usuário PPPoE deve ter até 180 caracteres." });
  }
  try {
    const q = await pool.query(
      `update customers
          set name=$1, document=$2, phone=$3, address=$4, pppoe_username=$5
        where id=$6 returning *`,
      [name, document, phone, address, pppoeUsername, id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "Cliente não encontrado." });
    res.json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505" && e.constraint === "customers_pppoe_username_unique_idx") {
      return res.status(409).json({ error: "Esse usuário PPPoE já está vinculado a outro cliente." });
    }
    next(e);
  }
});

app.get("/api/equipment", async (_req, res, next) => {
  try {
    const q = await pool.query(`
      select e.*, c.name customer_name, c.pppoe_username as customer_pppoe_username, p.name profile_name
      from equipment e
      left join customers c on c.id=e.customer_id
      left join equipment_profiles p on p.id=e.profile_id
      order by e.id desc limit 500
    `);
    res.json(q.rows);
  } catch (e) { next(e); }
});

app.post("/api/equipment", async (req, res, next) => {
  try {
    const { customer_id, manufacturer, model, equipment_type, serial_number, mac, profile_id, acs_device_id } = req.body;
    if (!manufacturer || !model || !serial_number) {
      return res.status(400).json({ error: "manufacturer, model e serial_number são obrigatórios" });
    }
    const q = await pool.query(`
      insert into equipment(customer_id, profile_id, acs_device_id, manufacturer, model, equipment_type, serial_number, mac)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning *
    `, [customer_id || null, profile_id || null, acs_device_id || null, manufacturer, model, equipment_type || "router", serial_number, mac || null]);
    res.status(201).json(q.rows[0]);
  } catch (e) { next(e); }
});

app.patch("/api/equipment/:id", async (req, res, next) => {
  const body = req.body || {};
  const hasProfile = Object.prototype.hasOwnProperty.call(body, "profile_id");
  const hasCustomer = Object.prototype.hasOwnProperty.call(body, "customer_id");
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  if (!hasProfile && !hasCustomer && !hasStatus) {
    return res.status(400).json({ error: "Informe ao menos um campo para atualizar." });
  }
  const equipmentId = Number(req.params.id);
  if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) {
    return res.status(400).json({ error: "ID de equipamento inválido." });
  }
  const parseNullableId = (value, label) => {
    if (value === null || value === "" || value === undefined) return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} inválido.`);
    return id;
  };
  let profileId = null;
  let customerId = null;
  try {
    if (hasProfile) profileId = parseNullableId(body.profile_id, "Perfil");
    if (hasCustomer) customerId = parseNullableId(body.customer_id, "Cliente");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (hasStatus && (typeof body.status !== "string" || !["online", "offline", "unknown"].includes(body.status))) {
    return res.status(400).json({ error: "Status de equipamento inválido." });
  }

  const setParts = [];
  const values = [];
  if (hasProfile) { values.push(profileId); setParts.push(`profile_id=$${values.length}`); }
  if (hasCustomer) { values.push(customerId); setParts.push(`customer_id=$${values.length}`); }
  if (hasStatus) { values.push(body.status); setParts.push(`status=$${values.length}`); }
  values.push(equipmentId);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const q = await client.query(
      `update equipment set ${setParts.join(", ")} where id=$${values.length}
       returning id, customer_id, profile_id, acs_device_id`, values
    );
    if (!q.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "Equipamento não encontrado" });
    }
    // When a customer is first linked to this CPE, attach the formerly unassigned
    // activation records to the same customer. Existing explicit historical links stay intact.
    if (hasCustomer && customerId !== null) {
      await client.query(
        `update provisioning_activations
            set customer_id=$1
          where equipment_id=$2 and customer_id is null`,
        [customerId, equipmentId]
      );
    }
    await client.query("commit");
    res.json(q.rows[0]);
  } catch (e) {
    try { await client.query("rollback"); } catch { /* Preserve original database error. */ }
    next(e);
  } finally {
    client.release();
  }
});

app.get("/api/mikrotik/status", (_req, res) => {
  const configured = isRouterOSConfigured();
  res.json({
    configured,
    host: configured ? String(process.env.MIKROTIK_HOST).trim() : null,
    port: configured ? Number(process.env.MIKROTIK_PORT || 8728) : null,
    message: configured
      ? "Integração MikroTik configurada; o comando só será executado após confirmação do operador."
      : "Integração MikroTik pendente: configure MIKROTIK_HOST, MIKROTIK_USERNAME e MIKROTIK_PASSWORD no .env."
  });
});

app.post("/api/mikrotik/test", async (_req, res) => {
  try {
    const result = await routerOSConnectionTest();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: String(error.message || "Não foi possível conectar ao MikroTik.") });
  }
});

app.get("/api/equipment/:id/service-history", async (req, res, next) => {
  const equipmentId = Number(req.params.id);
  if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) return res.status(400).json({ error: "ID de equipamento inválido." });
  try {
    const q = await pool.query(`
      select id, pppoe_username, action, result, detail, requested_by_email, created_at
      from equipment_service_actions where equipment_id=$1 order by id desc limit 30
    `, [equipmentId]);
    res.json(q.rows);
  } catch (error) { next(error); }
});

app.post("/api/equipment/:id/service-action", async (req, res) => {
  const equipmentId = Number(req.params.id);
  const action = String(req.body?.action || "");
  if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) return res.status(400).json({ error: "ID de equipamento inválido." });
  if (!["block", "unblock"].includes(action)) return res.status(400).json({ error: "Selecione bloquear ou desbloquear." });
  if (!isRouterOSConfigured()) return res.status(503).json({ error: "Integração MikroTik não configurada. Nenhuma alteração foi feita." });

  let target = null;
  try {
    const lookup = await pool.query(`
      select e.id, e.customer_id, e.service_status, e.manufacturer, e.model,
             c.name as customer_name, c.pppoe_username
      from equipment e left join customers c on c.id=e.customer_id
      where e.id=$1 limit 1
    `, [equipmentId]);
    target = lookup.rows[0] || null;
    if (!target) return res.status(404).json({ error: "Equipamento não encontrado." });
    if (!target.customer_id || !target.customer_name) return res.status(409).json({ error: "Associe o equipamento ao cadastro do cliente antes de controlar o acesso." });
    if (!target.pppoe_username || !String(target.pppoe_username).trim()) return res.status(409).json({ error: "Cadastre o usuário PPPoE do cliente em Clientes → Editar dados / PPPoE antes de controlar o acesso." });

    try {
      const result = await routerOSServiceAction(target.pppoe_username, action);
      const serviceStatus = action === "block" ? "blocked" : "enabled";
      await pool.query("update equipment set service_status=$1 where id=$2", [serviceStatus, equipmentId]);
      await pool.query(`
        insert into equipment_service_actions(equipment_id, customer_id, pppoe_username, action, result, detail, requested_by, requested_by_email)
        values($1,$2,$3,$4,'success',$5::jsonb,$6,$7)
      `, [equipmentId, target.customer_id, target.pppoe_username, action, JSON.stringify(result), req.authUser?.id || null, req.authUser?.email || null]);
      return res.json({ ok: true, service_status: serviceStatus, customer_name: target.customer_name, ...result });
    } catch (error) {
      const partial = Boolean(error.partial);
      if (partial && action === "block") {
        await pool.query("update equipment set service_status='blocked' where id=$1", [equipmentId]);
      }
      try {
        await pool.query(`
          insert into equipment_service_actions(equipment_id, customer_id, pppoe_username, action, result, detail, requested_by, requested_by_email)
          values($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        `, [equipmentId, target.customer_id, target.pppoe_username, action, partial ? "partial" : "failed", JSON.stringify({ message: String(error.message || "Falha ao executar comando") }), req.authUser?.id || null, req.authUser?.email || null]);
      } catch (auditError) { console.error("Não foi possível gravar auditoria de serviço", auditError.message); }
      const status = partial ? 502 : (String(error.message || "").includes("não foi encontrada") ? 409 : 502);
      return res.status(status).json({ error: String(error.message || "Falha ao executar ação no MikroTik."), service_status: partial ? "blocked" : target.service_status });
    }
  } catch (error) {
    console.error("Falha no controle de serviço MikroTik", error);
    return res.status(500).json({ error: "Falha interna ao registrar a operação de serviço." });
  }
});

app.get("/api/profiles", async (_req, res, next) => {
  try {
    const q = await pool.query("select * from equipment_profiles order by id");
    res.json(q.rows);
  } catch (e) { next(e); }
});

app.post("/api/profiles", async (req, res, next) => {
  try {
    const { name, description, config } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    if (typeof config !== "object" || Array.isArray(config)) return res.status(400).json({ error: "config deve ser um objeto JSON" });
    const q = await pool.query(
      `insert into equipment_profiles(name, description, config) values($1,$2,$3) returning *`,
      [name, description || null, config]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/profiles/:id", async (req, res, next) => {
  try {
    const { name, description, config } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const q = await pool.query(
      `update equipment_profiles set name=$1, description=$2, config=$3 where id=$4 returning *`,
      [name, description || null, config || {}, req.params.id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "Perfil não encontrado" });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/acs/status", async (_req, res) => {
  try {
    const devices = await nbiFetch("/devices/");
    res.json({ ok: true, devices: Array.isArray(devices) ? devices.length : 0 });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.get("/api/acs/devices", async (_req, res) => {
  try {
    const devices = await nbiFetch("/devices/");
    res.json(Array.isArray(devices) ? devices : []);
  } catch (e) {
    res.status(502).json({ error: "Não foi possível consultar o GenieACS", details: e.details || e.message });
  }
});

app.get("/api/acs/devices/:deviceId", async (req, res) => {
  try {
    const query = encodeURIComponent(JSON.stringify({ _id: req.params.deviceId }));
    const devices = await nbiFetch(`/devices/?query=${query}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    res.json(device);
  } catch (e) {
    res.status(502).json({ error: "Não foi possível consultar o CPE", details: e.details || e.message });
  }
});

function isSensitiveParameterPath(parameterPath) {
  const low = String(parameterPath || "").toLowerCase();
  return /password|passphrase|presharedkey|secret/.test(low);
}

function flattenDevice(node, prefix = "", out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node !== "object") {
    if (prefix) out.push({ path: prefix, value: isSensitiveParameterPath(prefix) ? "[redacted]" : node, sensitive: isSensitiveParameterPath(prefix), type: typeof node, writable: false, timestamp: null });
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(node, "_value")) {
    const sensitive = isSensitiveParameterPath(prefix);
    out.push({
      path: prefix,
      value: sensitive ? "[redacted]" : node._value,
      sensitive,
      type: node._type || typeof node._value,
      writable: node._writable === true,
      timestamp: node._timestamp || null,
    });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("_")) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    flattenDevice(value, next, out);
  }
  return out;
}

const MR60X_PARAMETER_CATALOG = [
  // PPPoE / WAN
  { id: "pppoe.enable", category: "PPPoE / WAN", label: "PPPoE habilitado", path: "Device.PPP.Interface.1.Enable", safeProbe: true, critical: true },
  { id: "pppoe.username", category: "PPPoE / WAN", label: "Usuário PPPoE", path: "Device.PPP.Interface.1.Username", critical: true },
  { id: "pppoe.password", category: "PPPoE / WAN", label: "Senha PPPoE", path: "Device.PPP.Interface.1.Password", sensitive: true, critical: true },
  { id: "pppoe.trigger", category: "PPPoE / WAN", label: "Disparo da conexão", path: "Device.PPP.Interface.1.ConnectionTrigger", safeProbe: true, critical: true, options: ["AlwaysOn", "OnDemand"] },
  { id: "pppoe.mru", category: "PPPoE / WAN", label: "MRU PPPoE", path: "Device.PPP.Interface.1.MaxMRUSize", safeProbe: true, critical: true },
  { id: "pppoe.dns", category: "PPPoE / WAN", label: "DNS PPPoE", path: "Device.PPP.Interface.1.IPCP.DNSServers", critical: true },
  { id: "pppoe.acname", category: "PPPoE / WAN", label: "Nome do concentrador (ACName)", path: "Device.PPP.Interface.1.PPPoE.ACName", critical: true },
  { id: "pppoe.servicename", category: "PPPoE / WAN", label: "Nome do serviço PPPoE", path: "Device.PPP.Interface.1.PPPoE.ServiceName", critical: true },
  { id: "pppoe.idle", category: "PPPoE / WAN", label: "Tempo ocioso antes de desconectar", path: "Device.PPP.Interface.1.IdleDisconnectTime", critical: true },
  { id: "pppoe.echo", category: "PPPoE / WAN", label: "Intervalo de eco LCP", path: "Device.PPP.Interface.1.LCPEcho", critical: true },
  // Wi-Fi 2.4 GHz
  { id: "wifi24.radio", category: "Wi-Fi 2,4 GHz", label: "Rádio 2,4 GHz habilitado", path: "Device.WiFi.Radio.1.Enable" },
  { id: "wifi24.auto", category: "Wi-Fi 2,4 GHz", label: "Seleção automática de canal", path: "Device.WiFi.Radio.1.AutoChannelEnable" },
  { id: "wifi24.channel", category: "Wi-Fi 2,4 GHz", label: "Canal 2,4 GHz", path: "Device.WiFi.Radio.1.Channel", optionsPath: "Device.WiFi.Radio.1.PossibleChannels" },
  { id: "wifi24.bandwidth", category: "Wi-Fi 2,4 GHz", label: "Largura do canal 2,4 GHz", path: "Device.WiFi.Radio.1.OperatingChannelBandwidth", optionsPath: "Device.WiFi.Radio.1.SupportedOperatingChannelBandwidths" },
  { id: "wifi24.standards", category: "Wi-Fi 2,4 GHz", label: "Padrões Wi-Fi 2,4 GHz", path: "Device.WiFi.Radio.1.OperatingStandards" },
  { id: "wifi24.power", category: "Wi-Fi 2,4 GHz", label: "Potência de transmissão 2,4 GHz", path: "Device.WiFi.Radio.1.TransmitPower", optionsPath: "Device.WiFi.Radio.1.TransmitPowerSupported" },
  { id: "wifi24.ssid_enable", category: "Wi-Fi 2,4 GHz", label: "SSID principal habilitado", path: "Device.WiFi.SSID.1.Enable" },
  { id: "wifi24.ssid", category: "Wi-Fi 2,4 GHz", label: "Nome do Wi-Fi 2,4 GHz", path: "Device.WiFi.SSID.1.SSID" },
  { id: "wifi24.ap_enable", category: "Wi-Fi 2,4 GHz", label: "Ponto de acesso habilitado", path: "Device.WiFi.AccessPoint.1.Enable" },
  { id: "wifi24.security", category: "Wi-Fi 2,4 GHz", label: "Segurança Wi-Fi", path: "Device.WiFi.AccessPoint.1.Security.ModeEnabled", optionsPath: "Device.WiFi.AccessPoint.1.Security.ModesSupported" },
  { id: "wifi24.password", category: "Wi-Fi 2,4 GHz", label: "Senha do Wi-Fi 2,4 GHz", path: "Device.WiFi.AccessPoint.1.Security.PreSharedKey", sensitive: true },
  // Wi-Fi 5 GHz
  { id: "wifi5.radio", category: "Wi-Fi 5 GHz", label: "Rádio 5 GHz habilitado", path: "Device.WiFi.Radio.2.Enable" },
  { id: "wifi5.auto", category: "Wi-Fi 5 GHz", label: "Seleção automática de canal", path: "Device.WiFi.Radio.2.AutoChannelEnable" },
  { id: "wifi5.channel", category: "Wi-Fi 5 GHz", label: "Canal 5 GHz", path: "Device.WiFi.Radio.2.Channel", optionsPath: "Device.WiFi.Radio.2.PossibleChannels" },
  { id: "wifi5.bandwidth", category: "Wi-Fi 5 GHz", label: "Largura do canal 5 GHz", path: "Device.WiFi.Radio.2.OperatingChannelBandwidth", optionsPath: "Device.WiFi.Radio.2.SupportedOperatingChannelBandwidths" },
  { id: "wifi5.standards", category: "Wi-Fi 5 GHz", label: "Padrões Wi-Fi 5 GHz", path: "Device.WiFi.Radio.2.OperatingStandards" },
  { id: "wifi5.power", category: "Wi-Fi 5 GHz", label: "Potência de transmissão 5 GHz", path: "Device.WiFi.Radio.2.TransmitPower", optionsPath: "Device.WiFi.Radio.2.TransmitPowerSupported" },
  { id: "wifi5.ssid_enable", category: "Wi-Fi 5 GHz", label: "SSID principal habilitado", path: "Device.WiFi.SSID.3.Enable" },
  { id: "wifi5.ssid", category: "Wi-Fi 5 GHz", label: "Nome do Wi-Fi 5 GHz", path: "Device.WiFi.SSID.3.SSID" },
  { id: "wifi5.ap_enable", category: "Wi-Fi 5 GHz", label: "Ponto de acesso habilitado", path: "Device.WiFi.AccessPoint.3.Enable" },
  { id: "wifi5.security", category: "Wi-Fi 5 GHz", label: "Segurança Wi-Fi", path: "Device.WiFi.AccessPoint.3.Security.ModeEnabled", optionsPath: "Device.WiFi.AccessPoint.3.Security.ModesSupported" },
  { id: "wifi5.password", category: "Wi-Fi 5 GHz", label: "Senha do Wi-Fi 5 GHz", path: "Device.WiFi.AccessPoint.3.Security.PreSharedKey", sensitive: true },
  // Guest SSIDs/APs
  { id: "guest24.ssid_enable", category: "Wi-Fi convidado", label: "SSID convidado 2,4 GHz habilitado", path: "Device.WiFi.SSID.2.Enable" },
  { id: "guest24.ssid", category: "Wi-Fi convidado", label: "Nome do Wi-Fi convidado 2,4 GHz", path: "Device.WiFi.SSID.2.SSID" },
  { id: "guest24.ap_enable", category: "Wi-Fi convidado", label: "Ponto de acesso convidado 2,4 GHz habilitado", path: "Device.WiFi.AccessPoint.2.Enable" },
  { id: "guest24.security", category: "Wi-Fi convidado", label: "Segurança do Wi-Fi convidado 2,4 GHz", path: "Device.WiFi.AccessPoint.2.Security.ModeEnabled", optionsPath: "Device.WiFi.AccessPoint.2.Security.ModesSupported" },
  { id: "guest24.password", category: "Wi-Fi convidado", label: "Senha do Wi-Fi convidado 2,4 GHz", path: "Device.WiFi.AccessPoint.2.Security.PreSharedKey", sensitive: true },
  { id: "guest5.ssid_enable", category: "Wi-Fi convidado", label: "SSID convidado 5 GHz habilitado", path: "Device.WiFi.SSID.4.Enable" },
  { id: "guest5.ssid", category: "Wi-Fi convidado", label: "Nome do Wi-Fi convidado 5 GHz", path: "Device.WiFi.SSID.4.SSID" },
  { id: "guest5.ap_enable", category: "Wi-Fi convidado", label: "Ponto de acesso convidado 5 GHz habilitado", path: "Device.WiFi.AccessPoint.4.Enable" },
  { id: "guest5.security", category: "Wi-Fi convidado", label: "Segurança do Wi-Fi convidado 5 GHz", path: "Device.WiFi.AccessPoint.4.Security.ModeEnabled", optionsPath: "Device.WiFi.AccessPoint.4.Security.ModesSupported" },
  { id: "guest5.password", category: "Wi-Fi convidado", label: "Senha do Wi-Fi convidado 5 GHz", path: "Device.WiFi.AccessPoint.4.Security.PreSharedKey", sensitive: true },
  // LAN / DHCP
  { id: "lan.ip", category: "LAN / DHCP", label: "Endereço IP LAN", path: "Device.IP.Interface.1.IPv4Address.1.IPAddress", critical: true },
  { id: "lan.mask", category: "LAN / DHCP", label: "Máscara de sub-rede LAN", path: "Device.IP.Interface.1.IPv4Address.1.SubnetMask", critical: true },
  { id: "lan.mtu", category: "LAN / DHCP", label: "MTU da interface LAN", path: "Device.IP.Interface.1.MaxMTUSize", critical: true },
  { id: "dhcp.enable", category: "LAN / DHCP", label: "Servidor DHCP habilitado", path: "Device.DHCPv4.Server.Enable", critical: true },
  { id: "dhcp.pool_enable", category: "LAN / DHCP", label: "Pool DHCP habilitado", path: "Device.DHCPv4.Server.Pool.1.Enable", critical: true },
  { id: "dhcp.start", category: "LAN / DHCP", label: "Primeiro IP do DHCP", path: "Device.DHCPv4.Server.Pool.1.MinAddress", critical: true },
  { id: "dhcp.end", category: "LAN / DHCP", label: "Último IP do DHCP", path: "Device.DHCPv4.Server.Pool.1.MaxAddress", critical: true },
  { id: "dhcp.mask", category: "LAN / DHCP", label: "Máscara do pool DHCP", path: "Device.DHCPv4.Server.Pool.1.SubnetMask", critical: true },
  { id: "dhcp.dns", category: "LAN / DHCP", label: "DNS distribuído pelo DHCP", path: "Device.DHCPv4.Server.Pool.1.DNSServers", critical: true },
  { id: "dhcp.lease", category: "LAN / DHCP", label: "Tempo da concessão DHCP (segundos)", path: "Device.DHCPv4.Server.Pool.1.LeaseTime", critical: true },
  // VLAN and ACS management
  { id: "vlan.enable", category: "VLAN", label: "VLAN de terminação habilitada", path: "Device.Ethernet.VLANTermination.1.Enable", critical: true },
  { id: "vlan.id", category: "VLAN", label: "ID da VLAN de terminação", path: "Device.Ethernet.VLANTermination.1.VLANID", critical: true },
  { id: "mgmt.cwmp", category: "TR-069 / ACS", label: "TR-069 (CWMP) habilitado", path: "Device.ManagementServer.EnableCWMP", critical: true },
  { id: "mgmt.url", category: "TR-069 / ACS", label: "URL do ACS", path: "Device.ManagementServer.URL", critical: true },
  { id: "mgmt.username", category: "TR-069 / ACS", label: "Usuário de autenticação ACS", path: "Device.ManagementServer.Username", critical: true },
  { id: "mgmt.password", category: "TR-069 / ACS", label: "Senha de autenticação ACS", path: "Device.ManagementServer.Password", sensitive: true, critical: true },
  { id: "mgmt.periodic", category: "TR-069 / ACS", label: "Inform periódico habilitado", path: "Device.ManagementServer.PeriodicInformEnable", critical: true },
  { id: "mgmt.interval", category: "TR-069 / ACS", label: "Intervalo do Inform (segundos)", path: "Device.ManagementServer.PeriodicInformInterval", critical: true },
  { id: "mgmt.connection_user", category: "TR-069 / ACS", label: "Usuário Connection Request", path: "Device.ManagementServer.ConnectionRequestUsername", critical: true },
  { id: "mgmt.connection_password", category: "TR-069 / ACS", label: "Senha Connection Request", path: "Device.ManagementServer.ConnectionRequestPassword", sensitive: true, critical: true },
  { id: "mgmt.stun", category: "TR-069 / ACS", label: "STUN habilitado", path: "Device.ManagementServer.STUNEnable", critical: true },
  { id: "mgmt.stun_server", category: "TR-069 / ACS", label: "Servidor STUN", path: "Device.ManagementServer.STUNServerAddress", critical: true },
  { id: "mgmt.stun_port", category: "TR-069 / ACS", label: "Porta STUN", path: "Device.ManagementServer.STUNServerPort", critical: true },
];

function modelCatalogFor(device) {
  const manufacturer = String(device?._deviceId?._Manufacturer || "").trim().toLowerCase();
  const model = String(device?._deviceId?._ProductClass || "").trim().toUpperCase();
  if (manufacturer === "mercusys" && model === "MR60X") return MR60X_PARAMETER_CATALOG;
  return [];
}

function catalogSnapshot(device) {
  const values = flattenDevice(device);
  const byPath = new Map(values.map((item) => [item.path, item]));
  return modelCatalogFor(device).map((candidate) => {
    const live = byPath.get(candidate.path) || null;
    const optionValue = candidate.optionsPath ? byPath.get(candidate.optionsPath)?.value : null;
    const options = Array.isArray(candidate.options) ? candidate.options
      : typeof optionValue === "string" ? optionValue.split(",").map((item) => item.trim()).filter(Boolean) : null;
    return { ...candidate, discovered: Boolean(live), writable: live?.writable === true,
      type: live?.type || null, value: redactValue(live?.value ?? null, candidate.sensitive),
      sensitive: Boolean(candidate.sensitive || live?.sensitive), timestamp: live?.timestamp || null,
      valueAvailable: Boolean(live), options };
  });
}

function redactValue(value, sensitive = false) {
  return sensitive ? (value === null || value === undefined ? null : "[redacted]") : value;
}

function informAgeMs(lastInform) {
  if (!lastInform) return Number.POSITIVE_INFINITY;
  const ts = Date.parse(lastInform);
  return Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : Number.POSITIVE_INFINITY;
}

function connectionState(lastInform) {
  const age = informAgeMs(lastInform);
  if (!lastInform) return "unknown";
  if (age <= 3 * 60 * 1000) return "online";
  return "stale";
}

async function reconcileLabRuns(deviceId, device) {
  const values = flattenDevice(device);
  const liveByPath = new Map(values.map((item) => [item.path, item]));
  const latestInformMs = Date.parse(device?._lastInform || "");
  const runs = await pool.query(
    `select id, test_type, parameter_path, status, requested_value, observed_value, task_result, created_at
     from lab_runs where device_id=$1 and status='queued' order by id desc limit 50`,
    [deviceId]
  );

  for (const run of runs.rows) {
    const createdMs = new Date(run.created_at).getTime();
    const live = run.parameter_path ? liveByPath.get(run.parameter_path) : null;
    const liveMs = live?.timestamp ? Date.parse(live.timestamp) : Number.NaN;
    const informedAfterTask = Number.isFinite(latestInformMs) && latestInformMs > createdMs;
    const parameterRefreshedAfterTask = Number.isFinite(liveMs) && liveMs > createdMs;

    if (run.test_type === "refresh" && informedAfterTask) {
      await pool.query(
        `update lab_runs set status='executed', observed_value=$1::jsonb, task_result=$2::jsonb where id=$3`,
        [JSON.stringify({ lastInform: device._lastInform || null }), JSON.stringify({ ...(run.task_result || {}), reconciled: true, reconciled_at: new Date().toISOString() }), run.id]
      );
    } else if (run.test_type === "read" && (parameterRefreshedAfterTask || informedAfterTask)) {
      const candidate = modelCatalogFor(device).find((item) => item.path === run.parameter_path);
      const observedValue = live ? redactValue(live.value, candidate?.sensitive) : null;
      await pool.query(
        `update lab_runs set status='executed', observed_value=$1::jsonb, task_result=$2::jsonb where id=$3`,
        [JSON.stringify(observedValue), JSON.stringify({ ...(run.task_result || {}), reconciled: true, reconciled_at: new Date().toISOString() }), run.id]
      );
    } else if (run.test_type === "write-probe" && (parameterRefreshedAfterTask || informedAfterTask)) {
      const candidate = modelCatalogFor(device).find((item) => item.path === run.parameter_path);
      const observedValue = live ? redactValue(live.value, candidate?.sensitive) : null;
      await pool.query(
        `update lab_runs set status='confirmed', observed_value=$1::jsonb, task_result=$2::jsonb where id=$3`,
        [JSON.stringify(observedValue), JSON.stringify({ ...(run.task_result || {}), reconciled: true, reconciled_at: new Date().toISOString() }), run.id]
      );
    } else if (run.test_type === "write" && (parameterRefreshedAfterTask || informedAfterTask)) {
      const candidate = modelCatalogFor(device).find((item) => item.path === run.parameter_path);
      const expected = run.requested_value;
      const observedValue = live ? redactValue(live.value, candidate?.sensitive) : null;
      const confirmed = Boolean(live) && (candidate?.sensitive || normalizeProvisionValue(live.value) === normalizeProvisionValue(expected));
      // A secret value is never stored or compared; a later Inform only confirms CPE contact.
      const nextStatus = candidate?.sensitive ? "executed" : confirmed ? "confirmed" : "partial";
      await pool.query(
        `update lab_runs set status=$1, observed_value=$2::jsonb, task_result=$3::jsonb where id=$4`,
        [nextStatus, JSON.stringify(observedValue), JSON.stringify({ ...(run.task_result || {}), reconciled: true, reconciled_at: new Date().toISOString(), secretValueReadBack: candidate?.sensitive ? false : undefined }), run.id]
      );
    } else if (run.test_type === "reboot" && informedAfterTask) {
      await pool.query(
        `update lab_runs set status='executed', observed_value=$1::jsonb, task_result=$2::jsonb where id=$3`,
        [JSON.stringify({ lastInform: device._lastInform || null }), JSON.stringify({ ...(run.task_result || {}), rebootObserved: true, reconciled_at: new Date().toISOString() }), run.id]
      );
    }
  }
}

async function insertLabRun(data) {
  const q = await pool.query(
    `insert into lab_runs (device_id, manufacturer, model, test_type, parameter_path, requested_value, observed_value, task_result, status)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
     returning id, created_at`,
    [
      data.deviceId, data.manufacturer || null, data.model || null, data.testType, data.parameterPath || null,
      JSON.stringify(data.requestedValue ?? null), JSON.stringify(data.observedValue ?? null), JSON.stringify(data.taskResult ?? null), data.status,
    ]
  );
  return q.rows[0];
}

function categorizeParameters(values) {
  const info = [];
  const wifi = [];
  const wan = [];
  const tr069 = [];
  const other = [];
  for (const item of values) {
    const path = String(item.path || "");
    const low = path.toLowerCase();
    if (low.includes("managementserver") || low.includes("tr069") || low.includes("tr-069") || low.includes("connectionrequest") || low.includes("stun")) {
      tr069.push(item);
    } else if (low.includes("wifi") || low.includes("wlan") || low.includes("wireless") || low.includes("ssid") || low.includes("pre-sharedkey")) {
      wifi.push(item);
    } else if (low.includes("wan") || low.includes("pppoe") || low.includes("internet") || low.includes("vlan") || low.includes("ipv4") || low.includes("ipv6")) {
      wan.push(item);
    } else if (low.includes("deviceinfo") || low.includes("hardwareversion") || low.includes("softwareversion") || low.includes("serialnumber") || low.includes("productclass") || low.includes("manufacturer") || low.includes("modelname") || low.includes("firmware")) {
      info.push(item);
    } else {
      other.push(item);
    }
  }
  return { info, wifi, wan, tr069, other };
}

app.get("/api/acs/devices/:deviceId/parameters", async (req, res) => {
  try {
    const query = encodeURIComponent(JSON.stringify({ _id: req.params.deviceId }));
    const devices = await nbiFetch(`/devices/?query=${query}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const values = flattenDevice(device);
    const categories = categorizeParameters(values);
    res.json({
      deviceId: device._id,
      identity: device._deviceId || {},
      lastInform: device._lastInform || null,
      lastBoot: device._lastBoot || null,
      registered: device._registered || null,
      parameterCount: values.length,
      categories,
      values
    });
  } catch (e) {
    res.status(502).json({ error: "Não foi possível carregar os parâmetros do CPE", details: e.details || e.message });
  }
});

app.post("/api/acs/sync", async (_req, res) => {
  try {
    const devices = await syncAcsDevices();
    res.json({ ok: true, synced: devices.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao sincronizar com GenieACS", details: e.details || e.message });
  }
});

app.post("/api/acs/devices/:deviceId/task", async (req, res) => {
  try {
    const { task, connection_request = true } = req.body;
    if (!task || typeof task !== "object") return res.status(400).json({ error: "task é obrigatório" });
    const suffix = connection_request ? "?connection_request" : "";
    const result = await nbiFetch(`/devices/${encodeURIComponent(req.params.deviceId)}/tasks${suffix}`, {
      method: "POST",
      body: JSON.stringify(task),
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao enviar tarefa ao CPE", details: e.details || e.message });
  }
});

const MR60X_PROVISIONING_ALLOWLIST = new Set([
  "Device.PPP.Interface.1.Enable",
  "Device.PPP.Interface.1.ConnectionTrigger",
  "Device.PPP.Interface.1.Username",
  "Device.PPP.Interface.1.Password",
  "Device.PPP.Interface.1.MaxMRUSize",
  "Device.WiFi.Radio.1.Enable",
  "Device.WiFi.SSID.1.Enable",
  "Device.WiFi.AccessPoint.1.Enable",
  "Device.WiFi.SSID.1.SSID",
  "Device.WiFi.AccessPoint.1.Security.PreSharedKey",
  "Device.WiFi.Radio.2.Enable",
  "Device.WiFi.SSID.3.Enable",
  "Device.WiFi.AccessPoint.3.Enable",
  "Device.WiFi.SSID.3.SSID",
  "Device.WiFi.AccessPoint.3.Security.PreSharedKey",
]);

const MR60X_SENSITIVE_PATHS = new Set([
  "Device.PPP.Interface.1.Password",
  "Device.WiFi.AccessPoint.1.Security.PreSharedKey",
  "Device.WiFi.AccessPoint.3.Security.PreSharedKey",
]);

function provisioningSnapshot(device) {
  const values = flattenDevice(device);
  const byPath = new Map(values.map((entry) => [entry.path, entry]));
  const value = (...paths) => {
    for (const path of paths) {
      const entry = byPath.get(path);
      if (entry && entry.value !== undefined && entry.value !== null) return entry.value;
    }
    return null;
  };
  let wanIp = value("Device.IP.Interface.5.IPv4Address.1.IPAddress");
  if (!wanIp || String(wanIp) === "0.0.0.0") wanIp = null;
  return {
    lastInform: device?._lastInform || null,
    wanPortStatus: value("Device.Ethernet.Interface.3.Status"),
    wanLinkStatus: value("Device.Ethernet.Link.2.Status"),
    pppoeStatus: value("Device.PPP.Interface.1.ConnectionStatus"),
    pppoeUsername: value("Device.PPP.Interface.1.Username"),
    wanIp,
    ssid24: value("Device.WiFi.SSID.1.SSID"),
    ssid5: value("Device.WiFi.SSID.3.SSID"),
  };
}

function normalizeProvisionValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function safeTaskMetadata(taskData) {
  const task = Array.isArray(taskData) ? taskData[0] : taskData;
  if (!task || typeof task !== "object") return { responseType: task === null ? "null" : typeof task };
  const metadata = {};
  for (const key of ["_id", "id", "name", "timestamp", "status"]) {
    const value = task[key];
    if (["string", "number", "boolean"].includes(typeof value)) metadata[key] = value;
  }
  return metadata;
}

async function reconcileProvisioningActivations(deviceId, device) {
  const pending = await pool.query(
    `select id, status, requested_values, created_at, submitted_at, equipment_id, profile_id
       from provisioning_activations
      where device_id=$1 and status in ('queued','partial','needs_review')
      order by id desc limit 50`,
    [deviceId]
  );
  const byPath = new Map(flattenDevice(device).map((entry) => [entry.path, entry]));
  const snapshot = provisioningSnapshot(device);
  const informMs = Date.parse(snapshot.lastInform || "");
  const nowMs = Date.now();

  for (const operation of pending.rows) {
    const referenceMs = new Date(operation.submitted_at || operation.created_at).getTime();
    if (!Number.isFinite(informMs) || informMs <= referenceMs) {
      if (nowMs - referenceMs > 10 * 60 * 1000 && operation.status !== "needs_review") {
        await pool.query(
          `update provisioning_activations
              set status='needs_review', status_note=$1, updated_at=now()
            where id=$2`,
          ["Nenhum Inform posterior à solicitação foi observado em 10 minutos; verifique a tarefa e atualize o CPE.", operation.id]
        );
      }
      continue;
    }

    const expected = operation.requested_values && typeof operation.requested_values === "object"
      ? operation.requested_values : {};
    const mismatches = [];
    for (const [parameterPath, expectedValue] of Object.entries(expected)) {
      const live = byPath.get(parameterPath);
      if (!live || normalizeProvisionValue(live.value) !== normalizeProvisionValue(expectedValue)) {
        mismatches.push(parameterPath);
      }
    }
    const confirmed = mismatches.length === 0 && Object.keys(expected).length > 0;
    const status = confirmed ? "confirmed" : "partial";
    const note = confirmed
      ? (String(snapshot.pppoeStatus || "").toLowerCase() === "connected"
          ? "Parâmetros não secretos conferidos no cache após Inform; sessão PPPoE Connected. As senhas não são lidas de volta pelo histórico."
          : `Parâmetros não secretos conferidos no cache após Inform; estado PPPoE atual: ${snapshot.pppoeStatus || "não informado"}.`)
      : `O CPE enviou Inform após a tarefa, mas ${mismatches.length} valor(es) esperado(s) ainda divergem do cache.`;
    await pool.query(
      `update provisioning_activations
          set status=$1, status_note=$2, observed_summary=$3::jsonb,
              last_observed_at=now(),
              confirmed_at=case when $5::boolean then coalesce(confirmed_at, now()) else null end,
              updated_at=now()
        where id=$4`,
      [status, note, JSON.stringify({ ...snapshot, mismatchedPaths: mismatches }), operation.id, confirmed]
    );
    if (confirmed && operation.equipment_id && operation.profile_id) {
      await pool.query("update equipment set profile_id=$1 where id=$2", [operation.profile_id, operation.equipment_id]);
    }
  }
}

app.post("/api/acs/devices/:deviceId/provision", async (req, res) => {
  let operationId = null;
  try {
    const deviceId = String(req.params.deviceId || "");
    const parameterValues = Array.isArray(req.body?.parameterValues) ? req.body.parameterValues : [];
    const operationMode = req.body?.operationMode === "customer" ? "customer" : "lab";
    if (!parameterValues.length) return res.status(400).json({ error: "parameterValues é obrigatório" });
    if (operationMode === "customer" && req.body?.confirmCustomerPppoe !== true) {
      return res.status(400).json({ error: "Confirmação explícita obrigatória para ativação de cliente." });
    }
    const validPairs = parameterValues.every((item) =>
      Array.isArray(item) && item.length >= 2 && typeof item[0] === "string" && item[0].trim() && item[1] !== undefined
    );
    if (!validPairs) return res.status(400).json({ error: "Cada parâmetro deve ser [caminho, valor]" });

    const seenPaths = new Set();
    for (const [parameterPath] of parameterValues) {
      const pathValue = parameterPath.trim();
      if (!MR60X_PROVISIONING_ALLOWLIST.has(pathValue)) {
        return res.status(400).json({ error: `Parâmetro fora da lista permitida para provisionamento MR60X: ${pathValue}` });
      }
      if (seenPaths.has(pathValue)) return res.status(400).json({ error: `Parâmetro duplicado no plano: ${pathValue}` });
      seenPaths.add(pathValue);
    }
    if (seenPaths.size !== MR60X_PROVISIONING_ALLOWLIST.size || [...MR60X_PROVISIONING_ALLOWLIST].some((pathValue) => !seenPaths.has(pathValue))) {
      return res.status(400).json({ error: "O plano de provisionamento MR60X está incompleto. Gere novamente a prévia no RFN." });
    }

    const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
    const devices = await nbiFetch(`/devices/?query=${query}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const manufacturer = String(device?._deviceId?._Manufacturer || device?.Device?.DeviceInfo?.Manufacturer?._value || "");
    const model = String(device?._deviceId?._ProductClass || device?.Device?.DeviceInfo?.ProductClass?._value || device?.Device?.DeviceInfo?.ModelName?._value || "");
    if (!/mercusys/i.test(manufacturer) || !/mr60x/i.test(model)) {
      return res.status(409).json({ error: "Este plano de parâmetros é específico ao MERCUSYS MR60X. Não será enviado para outro modelo." });
    }

    const liveByPath = new Map(flattenDevice(device).map((entry) => [entry.path, entry]));
    const notWritable = [...seenPaths].filter((pathValue) => liveByPath.get(pathValue)?.writable !== true);
    if (notWritable.length) {
      return res.status(409).json({ error: "Envio bloqueado: existem parâmetros ausentes ou não graváveis no cache atual.", parameters: notWritable });
    }
    const cleanPairs = parameterValues.map(([parameterPath, value]) => {
      const normalizedPath = parameterPath.trim();
      const normalizedValue = normalizedPath === "Device.PPP.Interface.1.Username" && typeof value === "string"
        ? value.trim() : value;
      return [normalizedPath, normalizedValue];
    });
    const getRequested = (pathValue) => cleanPairs.find(([path]) => path === pathValue)?.[1];
    const booleanPaths = [
      "Device.PPP.Interface.1.Enable",
      "Device.WiFi.Radio.1.Enable",
      "Device.WiFi.SSID.1.Enable",
      "Device.WiFi.AccessPoint.1.Enable",
      "Device.WiFi.Radio.2.Enable",
      "Device.WiFi.SSID.3.Enable",
      "Device.WiFi.AccessPoint.3.Enable",
    ];
    for (const pathValue of booleanPaths) {
      if (typeof getRequested(pathValue) !== "boolean") {
        return res.status(400).json({ error: `Valor booleano obrigatório para ${pathValue}` });
      }
    }
    if (getRequested("Device.PPP.Interface.1.ConnectionTrigger") !== "AlwaysOn") {
      return res.status(400).json({ error: "ConnectionTrigger deve ser AlwaysOn neste perfil residencial." });
    }
    const mru = getRequested("Device.PPP.Interface.1.MaxMRUSize");
    if (!Number.isInteger(mru) || mru < 576 || mru > 1492) {
      return res.status(400).json({ error: "MaxMRUSize precisa ser um inteiro entre 576 e 1492." });
    }
    for (const pathValue of ["Device.PPP.Interface.1.Username", "Device.PPP.Interface.1.Password", "Device.WiFi.SSID.1.SSID", "Device.WiFi.SSID.3.SSID", "Device.WiFi.AccessPoint.1.Security.PreSharedKey", "Device.WiFi.AccessPoint.3.Security.PreSharedKey"]) {
      if (typeof getRequested(pathValue) !== "string") {
        return res.status(400).json({ error: `Valor de texto obrigatório para ${pathValue}` });
      }
    }
    const pppoeUsername = String(getRequested("Device.PPP.Interface.1.Username") || "").trim();
    const pppoePassword = String(getRequested("Device.PPP.Interface.1.Password") || "");
    const ssid24 = String(getRequested("Device.WiFi.SSID.1.SSID") || "").trim();
    const ssid5 = String(getRequested("Device.WiFi.SSID.3.SSID") || "").trim();
    const wifiPass = String(getRequested("Device.WiFi.AccessPoint.1.Security.PreSharedKey") || "");
    const wifiPass5 = String(getRequested("Device.WiFi.AccessPoint.3.Security.PreSharedKey") || "");
    if (!pppoeUsername || pppoeUsername.length > 180 || !pppoePassword || pppoePassword.length > 256) {
      return res.status(400).json({ error: "Usuário e senha PPPoE são obrigatórios e precisam ter tamanho válido." });
    }
    if (!ssid24 || !ssid5 || ssid24.length > 32 || ssid5.length > 32) {
      return res.status(400).json({ error: "Os dois SSIDs são obrigatórios e devem ter até 32 caracteres." });
    }
    if (wifiPass.length < 8 || wifiPass.length > 63 || wifiPass5.length < 8 || wifiPass5.length > 63) {
      return res.status(400).json({ error: "Cada senha Wi-Fi precisa ter entre 8 e 63 caracteres." });
    }

    const safeExpectedValues = Object.fromEntries(cleanPairs.filter(([pathValue]) => !MR60X_SENSITIVE_PATHS.has(pathValue)));
    const sensitivePaths = cleanPairs.filter(([pathValue]) => MR60X_SENSITIVE_PATHS.has(pathValue)).map(([pathValue]) => pathValue);
    const equipmentQuery = await pool.query(
      `select e.id, e.customer_id, e.profile_id, c.name as customer_name,
              c.pppoe_username as customer_pppoe_username, p.name as equipment_profile_name
         from equipment e
         left join customers c on c.id=e.customer_id
         left join equipment_profiles p on p.id=e.profile_id
        where e.acs_device_id=$1 limit 1`,
      [deviceId]
    );
    const registeredEquipment = equipmentQuery.rows[0] || null;
    if (operationMode === "customer" && !registeredEquipment?.customer_id) {
      return res.status(409).json({ error: "Antes da ativação de cliente final, cadastre o cliente e associe-o ao equipamento em Equipamentos → Abrir → Cliente responsável." });
    }
    if (operationMode === "customer" && registeredEquipment?.equipment_profile_name !== "RESIDENCIAL") {
      return res.status(409).json({ error: "Para ativação de cliente final, associe ao equipamento o perfil RESIDENCIAL em Equipamentos → Abrir → Perfil." });
    }
    if (operationMode === "customer" && !registeredEquipment?.customer_pppoe_username) {
      return res.status(409).json({ error: "Cadastre o usuário PPPoE esperado no cadastro do cliente antes de ativar. Use Clientes → Editar dados / PPPoE. A senha PPPoE não deve ser salva no cadastro." });
    }
    if (operationMode === "customer" && pppoeUsername !== String(registeredEquipment.customer_pppoe_username).trim()) {
      return res.status(409).json({ error: "O usuário PPPoE informado não coincide com o usuário cadastrado para este cliente. Confira Clientes e a conta criada no MikroTik antes de enviar." });
    }
    const residentialProfile = await pool.query("select id, name from equipment_profiles where name='RESIDENCIAL' limit 1");
    const created = await pool.query(
      `insert into provisioning_activations
        (device_id, equipment_id, customer_id, profile_id, profile_name, manufacturer, model, operation_mode, pppoe_username,
         wifi_ssid_24, wifi_ssid_5g, parameter_count, requested_values, sensitive_paths,
         status, requested_by, requested_by_email, observed_summary)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'submitting',$15,$16,$17::jsonb)
       returning id, created_at`,
      [deviceId, registeredEquipment?.id || null, registeredEquipment?.customer_id || null,
        residentialProfile.rows[0]?.id || registeredEquipment?.profile_id || null,
        residentialProfile.rows[0]?.name || "RESIDENCIAL", manufacturer || null, model || null, operationMode,
        pppoeUsername, ssid24, ssid5, cleanPairs.length, JSON.stringify(safeExpectedValues), sensitivePaths,
        req.authUser?.id || null, req.authUser?.email || null, JSON.stringify(provisioningSnapshot(device))]
    );
    operationId = created.rows[0].id;

    const task = { name: "setParameterValues", parameterValues: cleanPairs };
    try {
      const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
        method: "POST", body: JSON.stringify(task)
      });
      const taskData = result.data;
      const taskObject = Array.isArray(taskData) ? taskData[0] : taskData;
      const taskId = taskObject && typeof taskObject === "object" ? (taskObject._id || taskObject.id || null) : null;
      await pool.query(
        `update provisioning_activations
            set status='queued', task_id=$1, task_metadata=$2::jsonb,
                submitted_at=now(), status_note=$3, updated_at=now()
          where id=$4`,
        [taskId ? String(taskId) : null, JSON.stringify(safeTaskMetadata(taskData)),
          "GenieACS aceitou a tarefa. A aplicação será confirmada somente após um Inform posterior e conferência dos valores não secretos.", operationId]
      );
      res.status(result.status === 202 ? 202 : 200).json({
        ok: true, count: cleanPairs.length, operationId, status: "queued", taskId,
        taskAccepted: true,
        message: "Tarefa aceita pelo GenieACS; aguarde o próximo Inform para confirmar os valores no CPE."
      });
    } catch (error) {
      await pool.query(
        `update provisioning_activations set status='failed', status_note=$1, updated_at=now() where id=$2`,
        [String(error?.message || "Falha ao enviar tarefa ao GenieACS").slice(0, 300), operationId]
      );
      throw error;
    }
  } catch (e) {
    if (operationId !== null) {
      // The operation table stores only non-secret requested values; never save passwords or the raw task payload.
      try {
        await pool.query(
          `update provisioning_activations set status='failed', status_note=$1, updated_at=now() where id=$2 and status='submitting'`,
          [String(e?.message || "Falha ao enviar provisionamento").slice(0, 300), operationId]
        );
      } catch { /* Preserve the original provisioning error. */ }
    }
    res.status(e.status === 400 ? 400 : 502).json({ ok: false, error: "Falha ao enviar provisionamento ao CPE", details: e.details || e.message });
  }
});

app.get("/api/acs/devices/:deviceId/activations", async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "");
    const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
    const devices = await nbiFetch(`/devices/?query=${query}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    await reconcileProvisioningActivations(deviceId, device);
    const history = await pool.query(
      `select a.id, a.device_id, a.equipment_id, a.customer_id, c.name as customer_name,
              a.profile_id, a.profile_name, a.manufacturer, a.model, a.operation_mode, a.pppoe_username,
              a.wifi_ssid_24, a.wifi_ssid_5g, a.parameter_count, a.sensitive_paths, a.task_id, a.task_metadata,
              a.status, a.status_note, a.observed_summary, a.requested_by_email, a.created_at, a.submitted_at, a.updated_at,
              a.last_observed_at, a.confirmed_at
         from provisioning_activations a left join customers c on c.id=a.customer_id
        where a.device_id=$1 order by a.id desc limit 30`,
      [deviceId]
    );
    res.json({ ok: true, current: provisioningSnapshot(device), operations: history.rows });
  } catch (e) {
    res.status(502).json({ error: "Não foi possível carregar o histórico de ativações", details: e.details || e.message });
  }
});


app.post("/api/acs/devices/:deviceId/apply-profile", async (req, res) => {
  try {
    const profileId = Number(req.body.profile_id);
    if (!profileId) return res.status(400).json({ error: "profile_id é obrigatório" });
    const p = await pool.query("select * from equipment_profiles where id=$1", [profileId]);
    if (!p.rowCount) return res.status(404).json({ error: "Perfil não encontrado" });
    const config = p.rows[0].config || {};
    const parameterValues = Array.isArray(config.parameterValues) ? config.parameterValues : [];
    if (!parameterValues.length) {
      return res.status(400).json({ error: "O perfil ainda não possui parameterValues TR-069" });
    }
    const task = { name: "setParameterValues", parameterValues };
    const result = await nbiFetch(`/devices/${encodeURIComponent(req.params.deviceId)}/tasks?connection_request`, {
      method: "POST",
      body: JSON.stringify(task),
    });
    res.json({ ok: true, profile: p.rows[0].name, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao aplicar perfil", details: e.details || e.message });
  }
});

app.get("/api/acs/devices/:deviceId/lab", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const identity = device._deviceId || {};
    await reconcileLabRuns(deviceId, device);
    const catalog = catalogSnapshot(device);
    const liveByPath = new Map(flattenDevice(device).map((item) => [item.path, item]));
    const runs = await pool.query(
      `select id, test_type, parameter_path, status, requested_value, observed_value, task_result, created_at
       from lab_runs where device_id=$1 order by id desc limit 30`,
      [deviceId]
    );
    const enrichedRuns = runs.rows.map((run) => {
      const live = run.parameter_path ? liveByPath.get(run.parameter_path) : null;
      return {
        ...run,
        cache_observed: Boolean(live),
        cache_value: live ? redactValue(live.value, modelCatalogFor(device).find((c) => c.path === run.parameter_path)?.sensitive) : null,
        cache_writable: live?.writable === true,
        cache_type: live?.type || null,
        interpretation: run.status === "queued"
          ? "tarefa enfileirada no ACS; aguardando novo Inform do CPE"
          : run.test_type === "write-probe"
            ? "write-probe confirmado após Inform; isso não prova sozinho persistência após reboot/reset"
            : run.test_type === "write"
              ? (modelCatalogFor(device).find((item) => item.path === run.parameter_path)?.sensitive
                  ? "Inform observado; o parâmetro é secreto e não é lido de volta pelo histórico"
                  : run.status === "confirmed" ? "valor não secreto conferido no cache após Inform" : run.status === "partial" ? "o valor observado diverge do solicitado; confira o CPE" : "tarefa enviada; aguardando confirmação no cache do CPE")
              : run.test_type === "reboot"
                ? "solicitação de reinicialização; confirme o retorno do CPE após o boot"
                : run.test_type === "read"
                  ? (live ? "leitura executada; valor confirmado no cache após a tarefa" : "leitura executada, mas o parâmetro não foi encontrado no cache")
                  : "refresh executado; novo Inform recebido do CPE",
      };
    });
    res.json({
      deviceId,
      identity,
      supported: catalog.length > 0,
      model: { manufacturer: identity._Manufacturer || null, productClass: identity._ProductClass || null },
      lastInform: device._lastInform || null,
      lastBoot: device._lastBoot || null,
      connection: { state: connectionState(device._lastInform || null), ageMs: informAgeMs(device._lastInform || null) },
      candidates: catalog,
      runs: enrichedRuns,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao carregar laboratório do CPE", details: e.details || e.message });
  }
});

app.post("/api/acs/devices/:deviceId/lab/refresh", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const task = { name: "refreshObject", objectName: "" };
    const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`, { method: "POST", body: JSON.stringify(task) });
    const status = result.status === 200 ? "executed" : "queued";
    const latestDevices = status === "executed"
      ? await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`)
      : [];
    const latestDevice = Array.isArray(latestDevices) ? latestDevices[0] : null;
    const run = await insertLabRun({
      deviceId, manufacturer: device?._deviceId?._Manufacturer, model: device?._deviceId?._ProductClass,
      testType: "refresh", taskResult: result.data, observedValue: latestDevice ? { lastInform: latestDevice._lastInform || null } : null, status,
    });
    res.status(result.status === 202 ? 202 : 200).json({ ok: true, status, runId: run.id, result: result.data, observed: latestDevice ? { lastInform: latestDevice._lastInform || null } : null });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao solicitar refreshObject", details: e.details || e.message });
  }
});

app.post("/api/acs/devices/:deviceId/lab/read", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const pathValue = String(req.body?.path || "").trim();
    if (!pathValue) return res.status(400).json({ error: "path é obrigatório" });
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const candidate = modelCatalogFor(device).find((item) => item.path === pathValue);
    if (!candidate) return res.status(422).json({ error: "Parâmetro fora do catálogo determinístico do modelo" });
    if (connectionState(device._lastInform || null) !== "online") {
      return res.status(409).json({ error: "CPE sem Inform recente. Conecte o MR60X ao ACS antes de iniciar uma nova leitura." });
    }
    const existing = await pool.query(
      `select id from lab_runs where device_id=$1 and test_type='read' and parameter_path=$2 and status='queued' order by id desc limit 1`,
      [deviceId, pathValue]
    );
    if (existing.rowCount) {
      return res.json({ ok: true, status: "queued", runId: existing.rows[0].id, path: pathValue, observedValue: null, deduplicated: true, result: null });
    }
    const task = { name: "getParameterValues", parameterNames: [pathValue] };
    const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`, { method: "POST", body: JSON.stringify(task) });
    const status = result.status === 200 ? "executed" : "queued";
    let observedValue = null;
    if (status === "executed") {
      const latestDevices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
      const latestDevice = Array.isArray(latestDevices) ? latestDevices[0] : null;
      const live = latestDevice ? flattenDevice(latestDevice).find((item) => item.path === pathValue) : null;
      observedValue = live ? redactValue(live.value, candidate.sensitive) : null;
    }
    const run = await insertLabRun({
      deviceId, manufacturer: device?._deviceId?._Manufacturer, model: device?._deviceId?._ProductClass,
      testType: "read", parameterPath: pathValue, taskResult: result.data, observedValue, status,
    });
    res.status(result.status === 202 ? 202 : 200).json({ ok: true, status, runId: run.id, path: pathValue, observedValue, result: result.data });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao solicitar leitura ao CPE", details: e.details || e.message });
  }
});

app.post("/api/acs/devices/:deviceId/lab/write-probe", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const pathValue = String(req.body?.path || "").trim();
    if (!pathValue) return res.status(400).json({ error: "path é obrigatório" });
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS" });
    const candidate = modelCatalogFor(device).find((item) => item.path === pathValue);
    if (!candidate) return res.status(422).json({ error: "Parâmetro fora do catálogo determinístico do modelo" });
    if (!candidate.safeProbe) return res.status(409).json({ error: "Este parâmetro não está autorizado para write-probe seguro" });
    if (connectionState(device._lastInform || null) !== "online") {
      return res.status(409).json({ error: "CPE sem Inform recente. Conecte o MR60X ao ACS antes de iniciar um novo write-probe." });
    }
    const existing = await pool.query(
      `select id from lab_runs where device_id=$1 and test_type='write-probe' and parameter_path=$2 and status='queued' order by id desc limit 1`,
      [deviceId, pathValue]
    );
    if (existing.rowCount) {
      return res.json({ ok: true, status: "queued", runId: existing.rows[0].id, path: pathValue, observedValue: null, deduplicated: true, result: null });
    }
    const live = flattenDevice(device).find((item) => item.path === pathValue);
    if (!live) return res.status(409).json({ error: "Parâmetro ainda não está presente no cache; execute Refresh/Inform antes do teste" });
    if (live.writable !== true) return res.status(409).json({ error: "O CPE/firmware reportou o parâmetro como não gravável" });
    const parameterValues = [[pathValue, live.value, live.type || candidate.type || "xsd:string"]];
    const task = { name: "setParameterValues", parameterValues };
    const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`, { method: "POST", body: JSON.stringify(task) });
    const status = result.status === 200 ? "executed" : "queued";
    let observedValue = null;
    if (status === "executed") {
      const latestDevices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
      const latestDevice = Array.isArray(latestDevices) ? latestDevices[0] : null;
      const latestLive = latestDevice ? flattenDevice(latestDevice).find((item) => item.path === pathValue) : null;
      observedValue = latestLive ? redactValue(latestLive.value, candidate.sensitive) : null;
    }
    const run = await insertLabRun({
      deviceId, manufacturer: device?._deviceId?._Manufacturer, model: device?._deviceId?._ProductClass,
      testType: "write-probe", parameterPath: pathValue, requestedValue: redactValue(live.value, candidate.sensitive),
      observedValue, taskResult: result.data, status,
    });
    res.status(result.status === 202 ? 202 : 200).json({ ok: true, status, runId: run.id, path: pathValue, requestedValue: redactValue(live.value, candidate.sensitive), observedValue, result: result.data });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao executar write-probe", details: e.details || e.message });
  }
});

function isValidIpv4(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
function isValidSubnetMask(value) {
  if (!isValidIpv4(value)) return false;
  const n = String(value).split(".").map(Number).reduce((acc, part) => acc * 256 + part, 0) >>> 0;
  const inv = (~n) >>> 0;
  return (inv & (inv + 1)) === 0;
}
function catalogValidationError(candidate, value, byPath) {
  const pathValue = candidate.path;
  if (Array.isArray(candidate.options) && candidate.options.length && !candidate.options.includes(String(value))) {
    return `Valor inválido para ${candidate.label}. Valores aceitos: ${candidate.options.join(", ")}.`;
  }
  if (candidate.optionsPath) {
    const supported = String(byPath.get(candidate.optionsPath)?.value || "").split(",").map((v) => v.trim()).filter(Boolean);
    if (supported.length && !supported.includes(String(value))) return `Valor inválido para ${candidate.label}. Valores suportados: ${supported.join(", ")}.`;
  }
  if (/\.SSID$/.test(pathValue) && (String(value).length < 1 || String(value).length > 32)) return "O nome da rede Wi-Fi deve ter de 1 a 32 caracteres.";
  if (/PreSharedKey$/.test(pathValue) && (String(value).length < 8 || String(value).length > 63)) return "A senha Wi-Fi deve ter entre 8 e 63 caracteres.";
  if (pathValue === "Device.PPP.Interface.1.Username" && (!String(value).trim() || String(value).length > 180)) return "Informe um usuário PPPoE de até 180 caracteres.";
  if (pathValue === "Device.PPP.Interface.1.Password" && (!String(value) || String(value).length > 256)) return "Informe a senha PPPoE (máximo 256 caracteres).";
  if (pathValue === "Device.PPP.Interface.1.MaxMRUSize" && (!Number.isInteger(value) || value < 576 || value > 1492)) return "MRU PPPoE deve ser um inteiro entre 576 e 1492.";
  if (pathValue.endsWith(".IPv4Address.1.IPAddress") || pathValue.endsWith(".MinAddress") || pathValue.endsWith(".MaxAddress")) if (!isValidIpv4(value)) return "Informe um endereço IPv4 válido.";
  if (pathValue.endsWith(".SubnetMask") && !isValidSubnetMask(value)) return "Informe uma máscara IPv4 válida e contínua.";
  if (/DNSServers$/.test(pathValue) && String(value).trim()) {
    const items = String(value).split(",").map((v) => v.trim());
    if (items.some((item) => !isValidIpv4(item))) return "Informe endereços IPv4 separados por vírgula para os servidores DNS.";
  }
  if (pathValue === "Device.Ethernet.VLANTermination.1.VLANID" && (!Number.isInteger(value) || value < 0 || value > 4094)) return "O VLAN ID deve estar entre 0 e 4094.";
  if (pathValue === "Device.ManagementServer.URL") {
    try { const url = new URL(String(value)); if (!['http:', 'https:'].includes(url.protocol)) return "A URL do ACS deve usar HTTP ou HTTPS."; }
    catch { return "Informe uma URL válida para o ACS."; }
  }
  if (pathValue === "Device.ManagementServer.PeriodicInformInterval" && (!Number.isInteger(value) || value < 30 || value > 86400)) return "O intervalo de Inform deve estar entre 30 e 86400 segundos.";
  if (pathValue === "Device.DHCPv4.Server.Pool.1.LeaseTime" && (!Number.isInteger(value) || value < 60 || value > 604800)) return "A concessão DHCP deve estar entre 60 e 604800 segundos.";
  if (/\.TransmitPower$/.test(pathValue) && (!Number.isInteger(value) || ![25, 50, 100].includes(value))) return "A potência deve corresponder a um dos níveis reportados pelo equipamento.";
  if (pathValue.endsWith(".MaxMTUSize") && (!Number.isInteger(value) || value < 576 || value > 1500)) return "MTU deve estar entre 576 e 1500.";
  if (typeof value === "string" && (value.length > 1024 || value.includes(String.fromCharCode(0)))) return "O valor ultrapassa o limite permitido.";
  return null;
}

app.post("/api/acs/devices/:deviceId/lab/write", async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "");
    const pathValue = String(req.body?.path || "").trim();
    const rawValue = req.body?.value;
    if (!pathValue || rawValue === undefined || rawValue === null) return res.status(400).json({ error: "path e value são obrigatórios." });
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS." });
    const identity = device._deviceId || {};
    const candidate = modelCatalogFor(device).find((item) => item.path === pathValue);
    if (!candidate) return res.status(422).json({ error: "Parâmetro fora do catálogo de controle validado para este modelo." });
    if (candidate.critical && req.body?.confirmCritical !== true) return res.status(400).json({ error: "Esta alteração pode interromper o acesso ao CPE; confirmação explícita obrigatória." });
    if (connectionState(device._lastInform || null) !== "online") return res.status(409).json({ error: "CPE sem Inform recente. Atualize a comunicação com o GenieACS antes de gravar." });
    const values = flattenDevice(device);
    const byPath = new Map(values.map((item) => [item.path, item]));
    const live = byPath.get(pathValue);
    if (!live) return res.status(409).json({ error: "O parâmetro ainda não está no cache do CPE. Execute RefreshObject e tente novamente." });
    if (live.writable !== true) return res.status(409).json({ error: "O firmware reportou este parâmetro como não gravável; o RFN não tentará forçar a alteração." });
    let value;
    const type = String(live.type || "xsd:string");
    if (type === "xsd:boolean") {
      if (typeof rawValue === "boolean") value = rawValue;
      else if (rawValue === "true" || rawValue === "false") value = rawValue === "true";
      else return res.status(400).json({ error: "Use true ou false para este parâmetro." });
    } else if (/xsd:(unsignedInt|int|short|unsignedShort|byte|unsignedByte)$/.test(type)) {
      value = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isSafeInteger(value)) return res.status(400).json({ error: "Informe um número inteiro válido." });
      if (/unsigned/.test(type) && value < 0) return res.status(400).json({ error: "Este parâmetro não aceita valor negativo." });
    } else {
      if (typeof rawValue !== "string") return res.status(400).json({ error: "Informe texto para este parâmetro." });
      value = rawValue;
    }
    const error = catalogValidationError(candidate, value, byPath);
    if (error) return res.status(400).json({ error });
    const task = { name: "setParameterValues", parameterValues: [[pathValue, value, type]] };
    const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`, { method: "POST", body: JSON.stringify(task) });
    const status = result.status === 200 ? "executed" : "queued";
    const run = await insertLabRun({ deviceId, manufacturer: identity._Manufacturer || null, model: identity._ProductClass || null,
      testType: "write", parameterPath: pathValue, requestedValue: candidate.sensitive ? "[redacted]" : value,
      observedValue: null, taskResult: safeTaskMetadata(result.data), status });
    res.status(result.status === 202 ? 202 : 200).json({ ok: true, status, runId: run.id, path: pathValue,
      requestedValue: candidate.sensitive ? "[redacted]" : value, secretValueReadBack: candidate.sensitive ? false : undefined,
      result: safeTaskMetadata(result.data) });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao aplicar parâmetro no CPE", details: e.details || e.message });
  }
});

app.post("/api/acs/devices/:deviceId/lab/reboot", async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "");
    if (req.body?.confirmCritical !== true) return res.status(400).json({ error: "Confirmação explícita obrigatória para reiniciar o CPE." });
    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) return res.status(404).json({ error: "CPE não encontrado no GenieACS." });
    if (!modelCatalogFor(device).length) return res.status(422).json({ error: "Reinicialização remota só está habilitada para modelos com catálogo validado." });
    if (connectionState(device._lastInform || null) !== "online") return res.status(409).json({ error: "CPE sem Inform recente; reinicialização remota bloqueada." });
    const result = await nbiRequest(`/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000&connection_request`, { method: "POST", body: JSON.stringify({ name: "reboot" }) });
    const status = result.status === 200 ? "executed" : "queued";
    const run = await insertLabRun({ deviceId, manufacturer: device?._deviceId?._Manufacturer || null, model: device?._deviceId?._ProductClass || null,
      testType: "reboot", taskResult: safeTaskMetadata(result.data), status });
    res.status(result.status === 202 ? 202 : 200).json({ ok: true, status, runId: run.id, result: safeTaskMetadata(result.data) });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao solicitar reinicialização do CPE", details: e.details || e.message });
  }
});

// V11: endpoint mantido apenas para evitar chamadas antigas. A lógica baseada em Device.User.1/2 foi removida.
app.post("/api/acs/devices/:deviceId/enable-reset-recovery", async (_req, res) => {
  res.status(410).json({
    error: "Recuperação pós-reset automática está desativada na V12. Use o Laboratório MR60X para descobrir e validar o mecanismo suportado pelo firmware.",
    code: "RESET_RECOVERY_LAB_ONLY",
  });
});

app.get("/api/work-orders", async (_req, res, next) => {
  try {
    const q = await pool.query(`select w.*, c.name customer_name from work_orders w left join customers c on c.id=w.customer_id order by w.id desc limit 100`);
    res.json(q.rows);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno da aplicação", details: process.env.NODE_ENV === "production" ? undefined : err.message });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

async function bootstrap() {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (migrationFiles.length === 0) {
    throw new Error(`Nenhuma migration SQL encontrada em ${migrationsDirectory}`);
  }
  for (const file of migrationFiles) {
    await pool.query(await readFile(path.join(migrationsDirectory, file), "utf8"));
    console.log(`Migration aplicada: ${file}`);
  }
  app.listen(port, () => console.log(`API ouvindo em ${port}`));
}

bootstrap().catch((e) => {
  console.error("Falha ao iniciar API", e);
  process.exit(1);
});
