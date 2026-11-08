// workers/ai-assistant/index.js
// Cloudflare Workers AI + Vectorize Knowledge Base for Manila Prime Staycation

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const DEFAULT_DOCUMENTS = [
  {
    id: "checkin-checkout-rules",
    text: "Check-in time at Shore Residences is 2:00 PM. Check-out time is 12:00 PM (Noon). Early check-in or late check-out is subject to unit availability on your dates and can be coordinated directly with our staff."
  },
  {
    id: "pool-rules-and-fees",
    text: "Resort swimming pool passes at Shore Residences are ₱150 per guest on regular weekdays and weekends, and ₱300 on peak holidays. Pool fees are paid directly to the condo administration counter. Please note that swimming pools are closed on Mondays for regular maintenance."
  },
  {
    id: "parking-options",
    text: "Pay parking is available at Shore Residences in the building basement parking areas and nearby open outdoor parking lots. Rates are approximately ₱50 for the first 4 hours, and around ₱300 for overnight parking."
  },
  {
    id: "condo-rules-pets-smoking",
    text: "Pets are strictly prohibited inside Shore Residences towers by the building administration. All condo units are strictly non-smoking; designated smoking areas are located on the ground level."
  },
  {
    id: "unit-inclusions",
    text: "All Manila Prime staycation units include fast fiber WiFi, Smart TV with free Netflix access, air conditioning, induction cooker with cookware, refrigerator, microwave, rice cooker, hot and cold shower, clean towels, and hotel-quality bed linens."
  },
  {
    id: "location-and-transit",
    text: "Manila Prime units are situated at Shore Residences, Seaside Boulevard, Pasay City. It is within short walking distance to SM Mall of Asia (MOA), MOA Arena, SMX Convention Center, and approximately 15-20 minutes from NAIA International Airport."
  },
  {
    id: "payment-methods",
    text: "We accept payments via GCash, Maya, and direct bank transfers (BDO, BPI). A refundable incidental deposit of ₱1,000 is settled upon check-in and returned upon check-out after room inspection."
  }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Enable CORS for website chat widget
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // 1. Seed Knowledge Base into Vectorize
    if (url.pathname === "/seed" && request.method === "POST") {
      try {
        const vectors = [];

        for (const doc of DEFAULT_DOCUMENTS) {
          const { data } = await env.AI.run(EMBEDDING_MODEL, { text: [doc.text] });
          const values = data[0];

          vectors.push({
            id: doc.id,
            values,
            metadata: { text: doc.text }
          });
        }

        await env.VECTOR_INDEX.upsert(vectors);

        return jsonResponse({
          success: true,
          message: `Seeded ${vectors.length} knowledge chunks into Vectorize!`
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 2. Chat Query with Semantic Retrieval
    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const { question } = await request.json();
        if (!question) {
          return jsonResponse({ error: "question field is required" }, 400);
        }

        // Generate embedding for query
        const { data } = await env.AI.run(EMBEDDING_MODEL, { text: [question] });
        const queryVector = data[0];

        // Search Vectorize index
        const matches = await env.VECTOR_INDEX.query(queryVector, {
          topK: 3,
          returnMetadata: true
        });

        const retrievedContext = matches.matches
          .filter(m => m.metadata?.text)
          .map(m => m.metadata.text)
          .join("\n\n");

        // Generate friendly answer with LLM
        const prompt = `
You are the friendly, helpful Chat Assistant for Manila Prime Staycation at Shore Residences in Pasay City.
Answer the guest's inquiry warmly, casually, and concisely in 2-3 sentences based on the official guidelines below.
Never sound robotic or like textbook AI. Always speak as "we" or "our staff".

Official Guidelines:
${retrievedContext || "Check-in 2PM, Check-out 12PM. Walking distance to MOA. Fiber WiFi, Netflix, full kitchen."}

Guest Question: "${question}"

Direct Answer:
`;

        const aiResponse = await env.AI.run(CHAT_MODEL, {
          prompt,
          max_tokens: 250,
          temperature: 0.7
        });

        return jsonResponse({
          answer: aiResponse.response,
          contextRetrieved: matches.matches.length
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    return jsonResponse({
      service: "Manila Prime Workers AI & Vectorize Knowledge Service",
      endpoints: ["POST /chat", "POST /seed"]
    });
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
