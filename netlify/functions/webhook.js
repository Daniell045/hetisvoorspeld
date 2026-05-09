// netlify/functions/webhook.js
// Mollie webhook → MailerLite koppeling
// Het Is Voorspeld — mijnlevensgetal.nl

const https = require("https");

// ─── GROEPSNAMEN (geen IDs nodig — worden automatisch opgezocht) ────────────
const GROEP_NAMEN = {
  rapport:  "rapport kopers",
  maand:    "maand leden",
  kwartaal: "kwartaal leden",
  jaar:     "jaar leden",
  ebooks:   "e book kopers",
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getMolliePayment(paymentId) {
  const res = await httpsRequest({
    hostname: "api.mollie.com",
    path: `/v2/payments/${paymentId}`,
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.MOLLIE_API_KEY}` },
  });
  return res.body;
}

// Haal alle MailerLite groepen op en zoek de juiste op naam
async function getGroupIdByName(name) {
  const res = await httpsRequest({
    hostname: "connect.mailerlite.com",
    path: "/api/groups?limit=100",
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status !== 200) {
    throw new Error(`MailerLite groups ophalen mislukt: ${res.status}`);
  }

  const groups = res.body.data || [];
  const match = groups.find(
    (g) => g.name.toLowerCase().trim() === name.toLowerCase().trim()
  );

  if (!match) {
    throw new Error(`Groep niet gevonden: "${name}". Beschikbaar: ${groups.map(g => g.name).join(", ")}`);
  }

  return String(match.id);
}

async function addToMailerLite(subscriberData, groupId) {
  const payload = JSON.stringify({
    email: subscriberData.email,
    fields: {
      name:          subscriberData.naam          || "",
      last_name:     "",
      levensgetal:   String(subscriberData.levensgetal   || ""),
      geboortedatum: subscriberData.geboortedatum || "",
      product:       subscriberData.product       || "",
    },
    groups: [groupId],
    status: "active",
  });

  const res = await httpsRequest({
    hostname: "connect.mailerlite.com",
    path: "/api/subscribers",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
      "Content-Length": Buffer.byteLength(payload),
    },
  }, payload);

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`MailerLite subscriber fout: ${res.status} — ${JSON.stringify(res.body)}`);
  }

  console.log(`✅ MailerLite: ${subscriberData.email} toegevoegd aan groep ID ${groupId}`);
  return res.body;
}

// ─── PRODUCT BEPALEN ───────────────────────────────────────────────────────
function getProductKey(payment) {
  const plan   = (payment.metadata?.plan || "").toLowerCase();
  const amount = parseFloat(payment.amount?.value || "0");

  if (plan === "rapport"  || (amount > 0  && amount <= 8))  return "rapport";
  if (plan === "maand"    || (amount > 8  && amount <= 12)) return "maand";
  if (plan === "kwartaal" || (amount > 12 && amount <= 35)) return "kwartaal";
  if (plan === "jaar"     || amount > 35)                   return "jaar";
  if (plan === "ebooks")                                    return "ebooks";
  return "rapport";
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let paymentId;
  try {
    const params = new URLSearchParams(event.body);
    paymentId = params.get("id");
  } catch {
    return { statusCode: 400, body: "Ongeldige body" };
  }

  if (!paymentId) {
    return { statusCode: 400, body: "Geen payment ID" };
  }

  console.log(`🔔 Webhook ontvangen: ${paymentId}`);

  try {
    // 1. Betaling ophalen bij Mollie
    const payment = await getMolliePayment(paymentId);
    console.log(`💳 Status: ${payment.status} | ${payment.amount?.value} | ${payment.metadata?.email}`);

    // 2. Alleen verwerken als betaald
    if (payment.status !== "paid") {
      return { statusCode: 200, body: "OK - niet betaald" };
    }

    // 3. Email verplicht
    const meta = payment.metadata || {};
    if (!meta.email) {
      console.error("❌ Geen email in metadata");
      return { statusCode: 200, body: "OK - geen email" };
    }

    // 4. Groepsnaam → ID automatisch ophalen via API
    const productKey = getProductKey(payment);
    const groepNaam  = GROEP_NAMEN[productKey];
    const groupId    = await getGroupIdByName(groepNaam);

    console.log(`📦 Product: ${productKey} → groep: "${groepNaam}" (ID: ${groupId})`);

    // 5. Subscriber toevoegen aan MailerLite
    await addToMailerLite({
      email:          meta.email,
      naam:           meta.naam          || meta.name || "",
      levensgetal:    meta.levensgetal   || "",
      geboortedatum:  meta.geboortedatum || "",
      product:        productKey,
    }, groupId);

    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error("❌ Webhook fout:", err.message);
    return { statusCode: 200, body: "OK - fout gelogd" };
  }
};
