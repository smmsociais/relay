// index.js
import express from "express";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import morgan from "morgan";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(morgan("combined"));

const PORT = process.env.PORT || 8080;
const RELAY_TOKEN = process.env.RELAY_TOKEN || "4769";
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "";
const ASAAS_API_URL = process.env.ASAAS_API_URL || "https://api.asaas.com/v3/transfers"; // ajuste conforme docs
const IDEMPOTENCY_FILE = process.env.IDEMPOTENCY_FILE || "./processed_references.json";

async function fetchWithTimeout(url, opts = {}, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return r;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// --- Idempotency store (simples, persistido em arquivo)
async function loadProcessed() {
  try {
    const txt = await fs.readFile(IDEMPOTENCY_FILE, "utf8");
    return new Set(JSON.parse(txt));
  } catch (e) {
    return new Set();
  }
}
async function saveProcessed(set) {
  try {
    await fs.writeFile(IDEMPOTENCY_FILE, JSON.stringify(Array.from(set)), "utf8");
  } catch (e) {
    console.error("[IDEMPOTENCY] Falha ao salvar arquivo:", e);
  }
}

// Health: reporta outbound IP (tenta ipify)
app.get("/health", async (req, res) => {
  let outboundIp = null;
  try {
    const r = await fetchWithTimeout("https://api.ipify.org?format=json", {}, 3000);
    if (r.ok) {
      const j = await r.json();
      outboundIp = j.ip || null;
    }
  } catch (err) {
    console.warn("[HEALTH] não conseguiu obter ip público:", err?.message || err);
  }

  return res.json({
    ok: true,
    message: "Relay ativo",
    timestamp: new Date().toISOString(),
    outboundIp,
    env: { asaasConfigured: !!ASAAS_API_KEY }
  });
});

// Rota para Asaas webhook (opcional) — registre no painel do Asaas para receber atualizações de status.
// Aqui deixamos um handler simples que apenas loga e retorna 200.
app.post("/relay/webhook", async (req, res) => {
  console.log("[WEBHOOK] recebido:", JSON.stringify(req.body).slice(0,2000));
  // TODO: validar assinatura/secret do Asaas se houver (confere docs Asaas)
  // Atualize seus saques no DB conforme payload (localização por externalReference ou id)
  return res.status(200).json({ ok: true });
});

// Rota principal que seu backend (Vercel) chamará
app.post("/relay/withdraw", async (req, res) => {
  try {
    const incomingToken = (req.headers["x-relay-token"] || "").toString();
    if (!incomingToken || incomingToken !== RELAY_TOKEN) {
      return res.status(401).json({ error: "invalid_relay_token" });
    }

    const { value, operationType, pixAddressKey, pixAddressKeyType, externalReference, bankAccount } = req.body || {};

    if (!value || !externalReference || !pixAddressKey) {
      return res.status(400).json({ error: "payload_incomplete", required: ["value","externalReference","pixAddressKey"] });
    }

    // Idempotency: evita enviar duas vezes para a Asaas
    const processed = await loadProcessed();
    if (processed.has(externalReference)) {
      console.log("[IDEMPOTENCY] externalReference já processado:", externalReference);
      return res.status(200).json({ message: "already_processed", externalReference });
    }

    // Monta payload para Asaas — **ajuste conforme a API real do Asaas**
    const asaasPayload = {
      // Exemplo genérico — adapteos campos ao endpoint específico do Asaas que a sua conta usa:
      externalReference,
      amount: Number(value),
      paymentMethod: "PIX",
      pix: {
        key: pixAddressKey,
        keyType: pixAddressKeyType || "CPF"
      },
      // se precisar enviar dados do recebedor (bankAccount), inclua aqui
      bankAccount: bankAccount || undefined
    };

    console.log("[RELAY] Enviando para Asaas:", { externalReference, amount: asaasPayload.amount });

    // Chamada real ao Asaas
    const resp = await fetchWithTimeout(ASAAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ASAAS_API_KEY}`
      },
      body: JSON.stringify(asaasPayload)
    }, 15000);

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      console.error("[RELAY] Asaas retornou erro:", resp.status, data);
      return res.status(resp.status).json({ error: "asaas_error", details: data });
    }

    // Marca como processado (idempotency)
    processed.add(externalReference);
    await saveProcessed(processed);

    console.log("[RELAY] Transferência criada com sucesso:", data?.id || "(no id)");
    return res.status(200).json({
      message: "Saque enviado ao Asaas",
      data
    });

  } catch (err) {
    console.error("[RELAY] erro interno:", err);
    return res.status(500).json({ error: "relay_internal_error", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[RELAY] rodando na porta ${PORT} - PID: ${process.pid}`);
});

