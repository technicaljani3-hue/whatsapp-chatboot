// WhatsApp Business AI Bot — Netlify Function version
// Meta Cloud API + Groq (free). History Netlify Blobs me save hoti hai.

import { getStore } from "@netlify/blobs";

// ====== YAHAN APNI BUSINESS INFO CHANGE KARO (har client ke liye alag) ======
const BUSINESS = {
  name: "AZ Creator",
  owner: "Amjad",
  services:
    "Website development for real estate, e-commerce stores, hospitals/clinics, restaurants, gyms and agencies",
  contact: "WhatsApp: (apna number yahan likho)",
  extra:
    "Pricing project ke hisab se hoti hai, isliye pehle requirement samajhni parti hai.",
};

const SYSTEM_PROMPT = `Tum ${BUSINESS.name} ke WhatsApp assistant ho. Owner ka naam ${BUSINESS.owner} hai.
Services: ${BUSINESS.services}.
${BUSINESS.extra}

Rules:
- Customer jis language/style me likhe (Roman Urdu, Urdu, English ya mix) usi me jawab do.
- Jawab chote rakho (2-4 lines), friendly aur professional tone.
- Customer ka business type, usay kya chahiye (new website / redesign / online store), aur timeline poochte jao, ek waqt me sirf ek sawal.
- Kabhi price, discount ya delivery time khud se fix mat karo. Agar poochay to kaho ke ${BUSINESS.owner} requirement dekh kar quote denge.
- Jab customer ki requirement mil jaye to kaho ke ${BUSINESS.owner} jald khud rabta karenge.
- Agar jawab nahi pata to jhoot mat bolo, kaho ke ${BUSINESS.owner} se confirm karke batate hain.
- Business ke ilawa kisi aur topic par lamba jawab mat do.`;

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_TURNS = 10;
const PAUSE_HOURS = 12;
const HUMAN_WORDS = ["human", "insan", "call me", "call karo", "owner se baat"];

const store = getStore("whatsapp-bot");

async function safeGetJSON(key) {
  try {
    return await store.get(key, { type: "json" });
  } catch {
    return null;
  }
}

async function safeSetJSON(key, value) {
  try {
    await store.setJSON(key, value);
  } catch (e) {
    console.error("Blob save error:", e.message);
  }
}

async function askGroq(history) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.6,
      max_tokens: 300,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function sendWhatsApp(to, body) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    }
  );
  if (!res.ok) console.error("WhatsApp send error:", await res.text());
}

async function handleIncoming(body) {
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return; // delivered/read status updates ignore

  // Duplicate message check (Meta kabhi kabhi dobara bhejta hai)
  if (await safeGetJSON(`seen-${msg.id}`)) return;
  await safeSetJSON(`seen-${msg.id}`, { t: Date.now() });

  const from = msg.from;

  // Human takeover pause check
  const pausedAt = await safeGetJSON(`paused-${from}`);
  if (pausedAt && Date.now() - pausedAt.t < PAUSE_HOURS * 3600 * 1000) return;

  if (msg.type !== "text") {
    await sendWhatsApp(
      from,
      "Shukriya! Abhi main sirf text messages samajh sakta hun. Apni requirement text me likh dein please."
    );
    return;
  }

  const text = msg.text.body;
  console.log(`[${from}] ${text}`);

  if (HUMAN_WORDS.some((w) => text.toLowerCase().includes(w))) {
    await safeSetJSON(`paused-${from}`, { t: Date.now() });
    await sendWhatsApp(
      from,
      `Theek hai, ${BUSINESS.owner} khud aap se jald rabta karenge.`
    );
    console.log(`>>> HUMAN REQUESTED by ${from}`);
    return;
  }

  let history = (await safeGetJSON(`chat-${from}`)) || [];
  history.push({ role: "user", content: text });
  while (history.length > MAX_TURNS * 2) history.shift();

  let reply;
  try {
    reply = await askGroq(history);
  } catch (e) {
    console.error(e.message);
    reply = `Shukriya aap ke message ka! ${BUSINESS.owner} jald aap ko reply karenge.`;
  }

  history.push({ role: "assistant", content: reply });
  await safeSetJSON(`chat-${from}`, history);
  await sendWhatsApp(from, reply);
}

export default async (req) => {
  const url = new URL(req.url);

  // Meta webhook verify (ek baar hota hai)
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === process.env.VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge"), {
        status: 200,
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // Incoming WhatsApp messages
  if (req.method === "POST") {
    try {
      const body = await req.json();
      await handleIncoming(body);
    } catch (e) {
      console.error("Handler error:", e.message);
    }
    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/webhook" };
