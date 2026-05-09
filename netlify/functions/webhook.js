// netlify/functions/webhook.js
// Mollie → Claude API → Resend email + MailerLite
// Het Is Voorspeld — mijnlevensgetal.nl

const https = require("https");

// ─── GROEPSNAMEN ───────────────────────────────────────────────────────────
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

// ─── MOLLIE ────────────────────────────────────────────────────────────────
async function getMolliePayment(paymentId) {
  const res = await httpsRequest({
    hostname: "api.mollie.com",
    path: `/v2/payments/${paymentId}`,
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.MOLLIE_API_KEY}` },
  });
  return res.body;
}

// ─── MAILERLITE ─────────────────────────────────────────────────────────────
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
  if (res.status !== 200) throw new Error(`Groups ophalen mislukt: ${res.status}`);
  const groups = res.body.data || [];
  const match = groups.find(g => g.name.toLowerCase().trim() === name.toLowerCase().trim());
  if (!match) throw new Error(`Groep niet gevonden: "${name}"`);
  return String(match.id);
}

async function addToMailerLite(data, groupId) {
  const payload = JSON.stringify({
    email: data.email,
    fields: {
      name:          data.naam          || "",
      levensgetal:   String(data.levensgetal  || ""),
      geboortedatum: data.geboortedatum || "",
      product:       data.product       || "",
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
    throw new Error(`MailerLite fout: ${res.status} — ${JSON.stringify(res.body)}`);
  }
  console.log(`✅ MailerLite: ${data.email} toegevoegd`);
}

// ─── CLAUDE API ─────────────────────────────────────────────────────────────
async function generateRapportEmail(meta) {
  const prompt = `Je bent Saskia, numeroloog uit Amsterdam. Schrijf een persoonlijke email aan ${meta.naam || "jou"} na aankoop van hun numerologisch rapport.

KLANTPROFIEL:
- Naam: ${meta.naam || "onbekend"}
- Geboortedatum: ${meta.geboortedatum || "onbekend"}
- Levensgetal: ${meta.levensgetal || "onbekend"}
- Zielsgetal: ${meta.zielsgetal || "onbekend"}
- Jaarcyclus 2026: ${meta.jaarcyclus || "onbekend"}

QUIZ ANTWOORDEN:
- Geslacht: ${meta.gender || "-"}
- Leeftijd: ${meta.age || "-"}
- Focus gebied: ${meta.focus || "-"}
- Herkenbaar patroon: ${meta.pattern || "-"}
- Hoe ze zich voelen: ${meta.feeling || "-"}
- Besluitvorming: ${meta.decision || "-"}
- Relaties: ${meta.relation || "-"}
- Grootste blokkade: ${meta.block || "-"}
- Geloof in synchroniciteit: ${meta.belief || "-"}

Schrijf een warme, persoonlijke email van Saskia. Verwerk hun specifieke antwoorden en levensgetal erin. Begin met een persoonlijke opening gebaseerd op hun naam en gevoel. Verwijs naar hun levensgetal en wat dat betekent. Ga in op hun grootste focus gebied en blokkade. Sluit af met een preview van wat er in het rapport staat. Gebruik Nederlandse spreektaal, warm maar professioneel. Max 350 woorden. Geen markdown, gewone tekst met alinea's.`;

  const requestBody = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }]
  });

  const res = await httpsRequest({
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(requestBody),
    },
  }, requestBody);

  if (res.status !== 200) {
    throw new Error(`Claude API fout: ${res.status} — ${JSON.stringify(res.body)}`);
  }

  return res.body.content[0].text;
}

// ─── RESEND EMAIL ───────────────────────────────────────────────────────────
async function sendEmail(to, naam, emailBody) {
  const htmlBody = emailBody
    .split("\n\n")
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#2d1b4e;background:#faf8f5">
  <div style="text-align:center;margin-bottom:32px">
    <p style="font-size:13px;color:#8b7a9e;letter-spacing:2px;margin:0">HET IS VOORSPELD</p>
    <p style="font-size:11px;color:#c9a96e;margin:4px 0 0">mijnlevensgetal.nl</p>
  </div>
  <div style="background:white;border-radius:12px;padding:32px;border:1px solid #e8e0f0">
    ${htmlBody}
    <p style="margin:24px 0 0;color:#8b7a9e;font-size:13px">Veel liefde en licht,</p>
    <p style="margin:4px 0 0;font-size:15px;color:#2d1b4e"><strong>Saskia</strong></p>
    <p style="margin:2px 0 0;font-size:12px;color:#8b7a9e">Numeroloog — Het Is Voorspeld</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#c9b8d4;margin-top:24px">
    Je ontvangt dit omdat je een rapport hebt aangevraagd via mijnlevensgetal.nl
  </p>
</body>
</html>`;

  const payload = JSON.stringify({
    from: "Saskia <saskia@mijnlevensgetal.nl>",
    to: [to],
    subject: `${naam ? naam.split(" ")[0] + ", " : ""}jouw numerologisch rapport is klaar ✨`,
    html: html,
  });

  const res = await httpsRequest({
    hostname: "api.resend.com",
    path: "/emails",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Length": Buffer.byteLength(payload),
    },
  }, payload);

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Resend fout: ${res.status} — ${JSON.stringify(res.body)}`);
  }
  console.log(`📧 Email verstuurd naar ${to}`);
}

// ─── PRODUCT BEPALEN ────────────────────────────────────────────────────────
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

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────
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

  if (!paymentId) return { statusCode: 400, body: "Geen payment ID" };

  console.log(`🔔 Webhook: ${paymentId}`);

  try {
    const payment = await getMolliePayment(paymentId);
    console.log(`💳 Status: ${payment.status} | ${payment.amount?.value} | ${payment.metadata?.email}`);

    if (payment.status !== "paid") {
      return { statusCode: 200, body: "OK - niet betaald" };
    }

    const meta = payment.metadata || {};
    if (!meta.email) {
      console.error("❌ Geen email in metadata");
      return { statusCode: 200, body: "OK - geen email" };
    }

    const productKey = getProductKey(payment);

    // 1. MailerLite subscriber toevoegen
    try {
      const groepNaam = GROEP_NAMEN[productKey];
      const groupId   = await getGroupIdByName(groepNaam);
      await addToMailerLite({
        email:          meta.email,
        naam:           meta.naam          || meta.name || "",
        levensgetal:    meta.levensgetal   || "",
        geboortedatum:  meta.geboortedatum || "",
        product:        productKey,
      }, groupId);
    } catch (err) {
      console.error("⚠️ MailerLite fout (niet fataal):", err.message);
    }

    // 2. Alleen voor rapport: AI email genereren + versturen
    if (productKey === "rapport") {
      try {
        console.log("🤖 Claude API aanroepen...");
        const emailBody = await generateRapportEmail({
          naam:          meta.naam          || meta.name || "",
          geboortedatum: meta.geboortedatum || "",
          levensgetal:   meta.levensgetal   || "",
          zielsgetal:    meta.zielsgetal    || "",
          jaarcyclus:    meta.jaarcyclus    || "",
          gender:        meta.gender        || "",
          age:           meta.age           || "",
          focus:         meta.focus         || "",
          pattern:       meta.pattern       || "",
          feeling:       meta.feeling       || "",
          decision:      meta.decision      || "",
          relation:      meta.relation      || "",
          block:         meta.block         || "",
          belief:        meta.belief        || "",
        });

        await sendEmail(
          meta.email,
          meta.naam || meta.name || "",
          emailBody
        );
      } catch (err) {
        console.error("⚠️ Email generatie/verzending fout:", err.message);
      }
    }

    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error("❌ Webhook fout:", err.message);
    return { statusCode: 200, body: "OK - fout gelogd" };
  }
};
