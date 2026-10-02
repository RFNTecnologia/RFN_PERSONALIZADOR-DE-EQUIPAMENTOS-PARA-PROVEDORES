import express from "express";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 8080);
const databaseUrl = process.env.DATABASE_URL;
const adminUsername = process.env.API_ADMIN_USERNAME;
const adminPassword = process.env.API_ADMIN_PASSWORD;
const cpeAdminPassword = process.env.CPE_ADMIN_PASSWORD;
const sessionSecret = process.env.API_SESSION_SECRET;
const cookieSecure = process.env.API_COOKIE_SECURE === "true";
const sessionLifetimeSeconds = 8 * 60 * 60;
const loginAttempts = new Map();

if (!adminUsername || !adminPassword || adminPassword.length < 14 || !sessionSecret || sessionSecret.length < 32) {
  throw new Error("Configure API_ADMIN_USERNAME, API_ADMIN_PASSWORD (mínimo 14 caracteres) e API_SESSION_SECRET (mínimo 32 caracteres)");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL deve apontar para o PostgreSQL do Supabase");
}
const pool = new Pool({ connectionString: databaseUrl });
const genieAcsNbiUrl = process.env.GENIEACS_NBI_URL || "http://genieacs:7557";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDirectory = path.join(__dirname, "migrations");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));

async function nbiFetch(endpoint, options = {}) {
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
  return data;
}


function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionCookie(req) {
  const cookies = req.headers.cookie?.split(";") || [];
  const session = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith("rfn_session="));
  return session?.slice("rfn_session=".length) || "";
}

function validSession(req) {
  const token = sessionCookie(req);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.sub === adminUsername && Number(claims.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function requireAdminSession(req, res, next) {
  if (!validSession(req)) return res.status(401).json({ error: "Autenticação necessária" });
  next();
}
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.post("/api/auth/login", (req, res) => {
  const now = Date.now();
  const ip = req.ip || "unknown";
  for (const [address, entry] of loginAttempts) {
    if (entry.expiresAt <= now) loginAttempts.delete(address);
  }
  let attempt = loginAttempts.get(ip);
  if (!attempt || attempt.expiresAt <= now) {
    if (loginAttempts.size >= 10000) return res.status(429).json({ error: "Muitas tentativas. Aguarde e tente novamente." });
    attempt = { count: 0, expiresAt: now + 15 * 60 * 1000 };
    loginAttempts.set(ip, attempt);
  }
  if (attempt.count >= 5) return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos." });

  const usernameMatches = constantTimeEqual(req.body?.username || "", adminUsername);
  const passwordMatches = constantTimeEqual(req.body?.password || "", adminPassword);
  if (!usernameMatches || !passwordMatches) {
    attempt.count += 1;
    return res.status(401).json({ error: "Usuário ou senha inválidos" });
  }

  loginAttempts.delete(ip);
  const claims = Buffer.from(JSON.stringify({
    sub: adminUsername,
    exp: Math.floor(now / 1000) + sessionLifetimeSeconds,
  })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(claims).digest("base64url");
  const secure = cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `rfn_session=${claims}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure}`);
  res.json({ ok: true, username: adminUsername });
});

app.post("/api/auth/logout", (_req, res) => {
  const secure = cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `rfn_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  res.status(204).end();
});

app.use("/api", requireAdminSession);

app.get("/api/auth/me", (_req, res) => {
  res.json({ authenticated: true, username: adminUsername });
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
    const { name, document, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const q = await pool.query(
      `insert into customers(name, document, phone, address) values($1,$2,$3,$4) returning *`,
      [name, document || null, phone || null, address || null]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/equipment", async (_req, res, next) => {
  try {
    const q = await pool.query(`
      select e.*, c.name customer_name, p.name profile_name
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
  try {
    const { profile_id, customer_id, status } = req.body;
    const q = await pool.query(`
      update equipment set
        profile_id=coalesce($1, profile_id),
        customer_id=coalesce($2, customer_id),
        status=coalesce($3, status)
      where id=$4 returning *
    `, [profile_id ?? null, customer_id ?? null, status ?? null, req.params.id]);
    if (!q.rowCount) return res.status(404).json({ error: "Equipamento não encontrado" });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
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

function flattenDevice(node, prefix = "", out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node !== "object") {
    if (prefix) out.push({ path: prefix, value: node, type: typeof node });
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(node, "_value")) {
    out.push({ path: prefix, value: node._value, type: node._type || typeof node._value, timestamp: node._timestamp || null });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "_value" || key === "_type" || key === "_timestamp") continue;
    const next = prefix ? `${prefix}.${key}` : key;
    flattenDevice(value, next, out);
  }
  return out;
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

app.post("/api/acs/devices/:deviceId/provision", async (req, res) => {
  try {
    const parameterValues = Array.isArray(req.body?.parameterValues) ? req.body.parameterValues : [];
    if (!parameterValues.length) return res.status(400).json({ error: "parameterValues é obrigatório" });
    const valid = parameterValues.every(x => Array.isArray(x) && x.length >= 2 && typeof x[0] === 'string' && x[0].trim() && x[1] !== undefined);
    if (!valid) return res.status(400).json({ error: "Cada parâmetro deve ser [caminho, valor]" });
    const task = { name: "setParameterValues", parameterValues: parameterValues.map(([path, value]) => [path.trim(), value]) };
    const result = await nbiFetch(`/devices/${encodeURIComponent(req.params.deviceId)}/tasks?connection_request`, {
      method: "POST", body: JSON.stringify(task)
    });
    res.json({ ok: true, count: parameterValues.length, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao enviar provisionamento ao CPE", details: e.details || e.message });
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

app.post("/api/acs/devices/:deviceId/enable-reset-recovery", async (req, res) => {
  try {
    if (!cpeAdminPassword || !/^[a-f0-9]{32}$/i.test(cpeAdminPassword)) {
      return res.status(503).json({ error: "CPE_ADMIN_PASSWORD ausente ou inválida no .env" });
    }

    const deviceId = req.params.deviceId;
    const equipment = await pool.query(`
      select e.manufacturer, e.model, e.serial_number, e.profile_id,
        p.name profile_name, p.config profile_config
      from equipment e
      left join equipment_profiles p on p.id=e.profile_id
      where e.acs_device_id=$1
      limit 1
    `, [deviceId]);
    if (!equipment.rowCount) return res.status(404).json({ error: "CPE não vinculado ao cadastro local" });

    const row = equipment.rows[0];
    if (String(row.manufacturer).toLowerCase() !== "mercusys" || String(row.model).toUpperCase() !== "MR60X") {
      return res.status(422).json({ error: "Esta recuperação está preparada somente para o MERCUSYS MR60X" });
    }
    if (row.profile_name !== "RESIDENCIAL") {
      return res.status(409).json({ error: "Associe primeiro o perfil RESIDENCIAL" });
    }

    const devices = await nbiFetch(`/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}`);
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device?._lastInform) return res.status(409).json({ error: "O MR60X precisa estar online no GenieACS" });

    const flattened = flattenDevice(device);
    const parameter = (parameterPath) => flattened.find((item) => item.path === parameterPath);
    const adminUsernameValue = parameter("Device.User.1.Username")?.value;
    const superadminUsernameValue = parameter("Device.User.2.Username")?.value;
    const adminPasswordWritable = parameter("Device.User.1.Password._writable")?.value === true;
    const superadminPasswordWritable = parameter("Device.User.2.Password._writable")?.value === true;
    if (adminUsernameValue !== "admin" || superadminUsernameValue !== "superadmin" || !adminPasswordWritable || !superadminPasswordWritable) {
      return res.status(422).json({ error: "Árvore TR-069 não confirma as contas admin/superadmin graváveis" });
    }

    const profileValues = Array.isArray(row.profile_config?.parameterValues)
      ? row.profile_config.parameterValues.filter((entry) => Array.isArray(entry) && entry.length >= 2)
      : [];
    if (!profileValues.length) return res.status(409).json({ error: "O perfil RESIDENCIAL não contém parâmetros TR-069" });

    const parameterValues = [
      ["Device.User.1.Password", cpeAdminPassword],
      ["Device.User.2.Password", cpeAdminPassword],
      ...profileValues.filter(([parameterPath]) => !["Device.User.1.Password", "Device.User.2.Password"].includes(parameterPath)),
    ];
    const provisionValues = parameterValues.map(([parameterPath, value]) => {
      if (["Device.ManagementServer.EnableCWMP", "Device.ManagementServer.PeriodicInformEnable"].includes(parameterPath)) {
        return [parameterPath, value === true || String(value).toLowerCase() === "true"];
      }
      if (parameterPath === "Device.ManagementServer.PeriodicInformInterval") return [parameterPath, Number(value)];
      return [parameterPath, String(value)];
    });

    const suffix = createHash("sha256").update(deviceId).digest("hex").slice(0, 12);
    const provisionName = `rfn-mr60x-reset-${suffix}`;
    const presetName = `rfn-mr60x-reset-${suffix}`;
    const script = `const parameterValues = ${JSON.stringify(provisionValues)};\nfor (const [parameterPath, value] of parameterValues) {\n  declare(parameterPath, null, { value });\n}\n`;
    const serialNumber = device?._deviceId?._SerialNumber || row.serial_number;

    await nbiFetch(`/provisions/${encodeURIComponent(provisionName)}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: script,
    });
    await nbiFetch(`/presets/${encodeURIComponent(presetName)}`, {
      method: "PUT",
      body: JSON.stringify({
        weight: 100,
        channel: "default",
        schedule: "",
        events: { "0 BOOTSTRAP": true },
        precondition: `DeviceID.SerialNumber = ${JSON.stringify(String(serialNumber))}`,
        provision: provisionName,
        provisionArgs: "",
      }),
    });

    const result = await nbiFetch(`/devices/${encodeURIComponent(deviceId)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ name: "setParameterValues", parameterValues }),
    });
    res.json({ ok: true, preset: presetName, queued: true, parameterCount: parameterValues.length, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: "Falha ao configurar recuperação via GenieACS", details: e.details || e.message });
  }
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
