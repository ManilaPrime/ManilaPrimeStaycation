// js/ai-chat.js
// AI Chat Assistant with Live Human Host Fallback & Hand-off

import { db, ensureVisitorAuth, API_BASE_URL, getUnitsCatalog } from "./firebase-app.js";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  arrayUnion, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let chatId = localStorage.getItem("mp_guest_chat_id");
if (!chatId) {
  chatId = "chat_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  localStorage.setItem("mp_guest_chat_id", chatId);
}

let isHumanMode = false;
let chatUnsubscribe = null;
let cachedUnits = [];

const STAYCATION_KNOWLEDGE = `
You are the friendly, professional virtual concierge for Manila Prime Staycation, a luxury condo staycation business located at Shore Residences, Seaside Boulevard, Pasay City, Metro Manila (near SM Mall of Asia).

Key Information:
- Properties: Shore 1, Shore 2, and Shore 3 Residences.
- Check-in Time: 2:00 PM (Strict condo security protocol).
- Check-out Time: 12:00 PM.
- Early check-in/late check-out: Subject to availability and approval from the host.
- Typical Nightly Rates: ₱1,899 to ₱2,399 depending on unit & dates.
- Capacity: Up to 4 guests per unit (Base rate covers 2 guests; extra guest fee is ₱350/night).
- Inclusions: High-speed Fiber WiFi, Smart TV with free Netflix, Air conditioning, Refrigerator, Microwave, Rice Cooker, Induction Cooker, Hot & Cold Shower.
- Swimming Pool: Resort-style pools. Pool pass is ₱150/head on regular days, ₱300/head on holidays (paid directly to the building admin). Pools are closed on Mondays for cleaning.
- Parking: Paid guest parking available in the building basement and open lots (around ₱50 for first 4 hours, ₱300 overnight).
- Security Deposit: ₱1,000 incidental deposit, fully refunded upon checkout inspection.
- Payment Methods: GCash, Maya, and Bank Transfer (BDO, BPI).
- Pets: Strictly not allowed by condo building administration.
- Smoking: Strictly prohibited inside units; designated smoking area at ground floor.

Guidelines:
- Keep answers concise, helpful, and warm.
- If the guest wants to book, tell them they can select their dates on the Booking section of the website.
- If the guest asks for custom discounts, special requests (parties/events), expresses a complaint, or asks to speak with a person, let them know you can connect them directly to a live human host immediately.
`;

async function initAiChat() {
  cachedUnits = await getUnitsCatalog();
  renderChatWidget();
  listenToChatUpdates();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAiChat);
} else {
  initAiChat();
}

function renderChatWidget() {
  // Floating Action Button
  const launcher = document.createElement("div");
  launcher.id = "mp-chat-launcher";
  launcher.className = "fixed bottom-6 right-6 z-50 flex items-center gap-3";
  launcher.innerHTML = `
    <div id="mp-chat-tooltip" class="hidden sm:flex items-center bg-white text-charcoal text-xs font-semibold px-3 py-2 rounded-xl shadow-lg border border-gray-100 animate-bounce">
      <span>💬 Need help booking? Ask AI or Host!</span>
    </div>
    <button 
      id="mp-chat-toggle-btn" 
      class="bg-yellow hover:bg-yellow-dark text-charcoal w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 relative group border-2 border-white"
      title="Chat with us"
    >
      <i class="fas fa-comment-dots text-2xl group-hover:scale-110 transition-transform"></i>
      <span class="absolute top-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></span>
    </button>
  `;
  document.body.appendChild(launcher);

  // Chat Window Container
  const chatWindow = document.createElement("div");
  chatWindow.id = "mp-chat-window";
  chatWindow.className = "fixed bottom-24 right-4 sm:right-6 w-[92vw] sm:w-[380px] h-[520px] max-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-100 z-50 flex flex-col overflow-hidden transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-none";
  chatWindow.innerHTML = `
    <!-- Header -->
    <div class="bg-charcoal text-white p-4 flex items-center justify-between border-b border-gray-800">
      <div class="flex items-center gap-3">
        <div class="relative">
          <div class="w-10 h-10 rounded-full bg-yellow text-charcoal flex items-center justify-center font-bold">
            <i class="fas fa-robot text-lg" id="chat-header-icon"></i>
          </div>
          <span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-charcoal rounded-full"></span>
        </div>
        <div>
          <h3 class="font-bold text-sm" id="chat-header-title">Manila Prime Concierge</h3>
          <p class="text-[11px] text-gray-300 flex items-center gap-1.5" id="chat-header-status">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400"></span> Online • Instant Answers
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button id="chat-request-human-header-btn" class="text-xs bg-white/10 hover:bg-yellow hover:text-charcoal text-white px-2.5 py-1 rounded-full transition-colors" title="Switch to Live Human Host">
          <i class="fas fa-user mr-1"></i> Host
        </button>
        <button id="chat-close-btn" class="text-gray-400 hover:text-white p-1 rounded-lg text-lg leading-none">
          &times;
        </button>
      </div>
    </div>

    <!-- Live Human Banner (hidden by default) -->
    <div id="human-active-banner" class="hidden bg-yellow-light border-b border-yellow/30 px-3 py-1.5 text-xs text-charcoal-dark flex items-center justify-between">
      <span class="font-medium"><i class="fas fa-headset mr-1 text-yellow-dark"></i> Connected to Human Host</span>
      <span class="text-[10px] bg-yellow font-bold px-1.5 py-0.5 rounded">Live</span>
    </div>

    <!-- Messages Container -->
    <div id="chat-messages" class="flex-1 p-4 overflow-y-auto space-y-3 bg-gray-50/60 text-sm">
      <!-- Greeting message -->
      <div class="flex gap-2.5 items-start">
        <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold">
          MP
        </div>
        <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 text-gray-800 max-w-[85%]">
          Hello! Welcome to <strong>Manila Prime Staycation</strong> ✨<br><br>
          I'm your AI concierge. Feel free to ask about unit rates, availability, pool rules, or tap below:
        </div>
      </div>
    </div>

    <!-- Quick Chips -->
    <div id="chat-quick-chips" class="px-3 py-2 bg-white border-t border-gray-100 flex gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-2.5 py-1 rounded-full whitespace-nowrap transition-colors" data-text="What are your rates?">
        💰 Rates
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-2.5 py-1 rounded-full whitespace-nowrap transition-colors" data-text="Pool access and fees?">
        🏊 Pool Rules
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-2.5 py-1 rounded-full whitespace-nowrap transition-colors" data-text="Check-in and check-out time?">
        ⏰ Check-in Time
      </button>
      <button class="chip-btn text-xs bg-yellow/20 hover:bg-yellow text-charcoal font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-colors" data-action="talk-to-human">
        🙋 Speak to Host
      </button>
    </div>

    <!-- Input Footer -->
    <form id="chat-input-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2">
      <input 
        type="text" 
        id="chat-user-input" 
        placeholder="Ask a question..." 
        autocomplete="off" 
        class="flex-1 bg-gray-50 border border-gray-200 focus:border-yellow focus:bg-white rounded-full px-4 py-2 text-sm text-charcoal outline-none transition-all"
      />
      <button 
        type="submit" 
        id="chat-send-btn" 
        class="w-9 h-9 bg-yellow hover:bg-yellow-dark text-charcoal rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-sm"
      >
        <i class="fas fa-paper-plane text-xs"></i>
      </button>
    </form>
  `;
  document.body.appendChild(chatWindow);

  // Attach Event Handlers
  const toggleBtn = document.getElementById("mp-chat-toggle-btn");
  const closeBtn = document.getElementById("chat-close-btn");
  const humanHeaderBtn = document.getElementById("chat-request-human-header-btn");
  const form = document.getElementById("chat-input-form");

  toggleBtn.onclick = () => toggleChatWindow();
  closeBtn.onclick = () => toggleChatWindow(false);
  humanHeaderBtn.onclick = () => requestHumanHost();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-user-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await handleUserMessage(text);
  };

  // Quick Chips
  chatWindow.querySelectorAll(".chip-btn").forEach(chip => {
    chip.onclick = () => {
      if (chip.getAttribute("data-action") === "talk-to-human") {
        requestHumanHost();
      } else {
        const text = chip.getAttribute("data-text");
        handleUserMessage(text);
      }
    };
  });
}

function toggleChatWindow(forceState) {
  const win = document.getElementById("mp-chat-window");
  const tooltip = document.getElementById("mp-chat-tooltip");
  if (!win) return;

  const isOpen = !win.classList.contains("pointer-events-none");
  const shouldOpen = forceState !== undefined ? forceState : !isOpen;

  if (shouldOpen) {
    win.classList.remove("pointer-events-none", "opacity-0", "translate-y-4");
    win.classList.add("opacity-100", "translate-y-0");
    if (tooltip) tooltip.classList.add("hidden");
    document.getElementById("chat-user-input")?.focus();
  } else {
    win.classList.add("pointer-events-none", "opacity-0", "translate-y-4");
    win.classList.remove("opacity-100", "translate-y-0");
  }
}

/**
 * Handle incoming user message
 */
async function handleUserMessage(text) {
  appendMessage("user", text);

  // Save to Firestore guest chat session
  await recordChatMessage("user", text);

  // Detect if user is asking for a person/human
  const isAskingHuman = /\b(human|agent|host|person|call|speak|talk to someone|staff|owner)\b/i.test(text);
  if (isAskingHuman && !isHumanMode) {
    await requestHumanHost(text);
    return;
  }

  if (isHumanMode) {
    // If in human mode, host is notified, show pending host indicator
    return;
  }

  // AI Response Generation
  showTypingIndicator(true);
  try {
    const aiAnswer = await generateAIAnswer(text);
    showTypingIndicator(false);
    appendMessage("assistant", aiAnswer);
    await recordChatMessage("assistant", aiAnswer);
  } catch (err) {
    console.error("AI error:", err);
    showTypingIndicator(false);
    appendMessage("assistant", "I'm having a brief connection hiccup. Would you like me to connect you with our live host directly?");
  }
}

/**
 * Generate AI Response using Gemini
 */
async function generateAIAnswer(userQuery) {
  // Construct listing details context from cached units
  const unitsSummary = cachedUnits.map(u => 
    `- ${u.name} (${u.type}): ₱${u.rate}/night, max ${u.maxOccupancy || 4} guests.`
  ).join("\n");

  const fullPrompt = `
${STAYCATION_KNOWLEDGE}

Current Available Units on Website:
${unitsSummary}

Guest Question: "${userQuery}"

Provide a direct, friendly answer:
`;

  try {
    // Call Cloud Functions AI endpoint
    const response = await fetch(`${API_BASE_URL}/ai/guest-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestInquiry: userQuery,
        listingDetails: unitsSummary,
        hostInstructions: STAYCATION_KNOWLEDGE,
        model: "gemini-3.8-flash"
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.generatedResponse) {
        return data.generatedResponse;
      }
    }
  } catch (e) {
    console.warn("Backend AI route unavailable, using smart local fallback:", e);
  }

  // Smart local fallback for common FAQs
  return getLocalFaqAnswer(userQuery);
}

function getLocalFaqAnswer(query) {
  const q = query.toLowerCase();
  if (q.includes("rate") || q.includes("price") || q.includes("cost") || q.includes("magkano")) {
    return "Our studio units start from ₱1,899/night up to ₱2,399/night depending on unit and dates. Each unit comfortably accommodates up to 4 guests with full amenities and Netflix included!";
  }
  if (q.includes("pool") || q.includes("swimming")) {
    return "Shore Residences features expansive resort pools! Pool passes are ₱150/guest regular days and ₱300 on holidays, payable directly to the admin. Note that pools are closed Mondays for routine maintenance.";
  }
  if (q.includes("checkin") || q.includes("check in") || q.includes("time") || q.includes("checkout")) {
    return "Standard Check-in is at 2:00 PM and Check-out is at 12:00 PM. Early check-in or late check-out is subject to unit availability.";
  }
  if (q.includes("pet") || q.includes("dog") || q.includes("cat")) {
    return "Unfortunately, building regulations strictly prohibit pets inside the units.";
  }
  if (q.includes("park") || q.includes("car")) {
    return "Yes! Pay parking is available in the basement and outdoor lots at Shore Residences (around ₱50 for first 4 hours, ₱300 overnight).";
  }
  return "I'm here to help! You can check all available units and live calendar dates right in the booking section above, or click 'Speak to Host' to chat directly with our team!";
}

/**
 * Switch session to Live Human Host
 */
export async function requestHumanHost(initialQuery = "") {
  isHumanMode = true;
  await ensureVisitorAuth();

  const banner = document.getElementById("human-active-banner");
  const headerIcon = document.getElementById("chat-header-icon");
  const headerTitle = document.getElementById("chat-header-title");
  const headerStatus = document.getElementById("chat-header-status");

  if (banner) banner.classList.remove("hidden");
  if (headerIcon) headerIcon.className = "fas fa-user-tie text-lg";
  if (headerTitle) headerTitle.textContent = "Live Host (Manila Prime)";
  if (headerStatus) headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400"></span> Host Notified • Standing By`;

  appendMessage("system", "🔔 Live Host Requested! Our property team has been notified via Discord and will reply to you right here shortly.");

  try {
    const chatRef = doc(db, "guest-chats", chatId);
    await setDoc(chatRef, {
      id: chatId,
      status: "needs_human",
      lastInquiry: initialQuery || "Guest requested live human host assistance.",
      updatedAt: serverTimestamp(),
      platform: "website"
    }, { merge: true });

    // Send discord notification to host
    await fetch(`${API_BASE_URL}/sendDiscordNotification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🚨 **Live Guest Chat Request!**\nA website visitor has asked to speak with a human host.\n**Chat ID:** \`${chatId}\`\n**Last Message:** "${initialQuery || 'Needs host assistance'}"\n*Open your Admin Dashboard to reply live!*`
      })
    }).catch(() => {});
  } catch (e) {
    console.warn("Error notifying host:", e);
  }
}

/**
 * Listen for replies from Host in Admin Dashboard
 */
function listenToChatUpdates() {
  if (chatUnsubscribe) chatUnsubscribe();

  const chatRef = doc(db, "guest-chats", chatId);
  chatUnsubscribe = onSnapshot(chatRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (data.status === "human_active" && !isHumanMode) {
      isHumanMode = true;
      document.getElementById("human-active-banner")?.classList.remove("hidden");
    }

    if (data.messages && Array.isArray(data.messages)) {
      // Find latest message from host
      const latestMsg = data.messages[data.messages.length - 1];
      if (latestMsg && latestMsg.sender === "host" && !latestMsg.renderedInClient) {
        appendMessage("host", latestMsg.text);
        latestMsg.renderedInClient = true;
      }
    }
  }, (err) => {
    console.warn("Chat listener error:", err);
  });
}

async function recordChatMessage(sender, text) {
  try {
    await ensureVisitorAuth();
    const chatRef = doc(db, "guest-chats", chatId);
    await setDoc(chatRef, {
      id: chatId,
      lastMessage: text,
      lastSender: sender,
      updatedAt: serverTimestamp(),
      messages: arrayUnion({
        sender,
        text,
        timestamp: new Date().toISOString()
      })
    }, { merge: true });
  } catch (err) {
    console.warn("Could not record chat message:", err);
  }
}

function appendMessage(sender, text) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  const msgDiv = document.createElement("div");

  if (sender === "user") {
    msgDiv.className = "flex justify-end";
    msgDiv.innerHTML = `
      <div class="bg-charcoal text-white p-3 rounded-2xl rounded-tr-none shadow-sm max-w-[85%]">
        ${escapeHtml(text)}
      </div>
    `;
  } else if (sender === "host") {
    msgDiv.className = "flex gap-2.5 items-start";
    msgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold shadow-sm">
        <i class="fas fa-user-tie"></i>
      </div>
      <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-yellow/40 text-charcoal max-w-[85%]">
        <div class="text-[10px] text-yellow-dark font-bold uppercase mb-0.5">Host Manila Prime</div>
        ${escapeHtml(text)}
      </div>
    `;
  } else if (sender === "system") {
    msgDiv.className = "flex justify-center my-1";
    msgDiv.innerHTML = `
      <div class="bg-yellow-light/80 text-charcoal-dark border border-yellow/30 text-xs px-3 py-1.5 rounded-full text-center">
        ${text}
      </div>
    `;
  } else {
    // assistant
    msgDiv.className = "flex gap-2.5 items-start";
    msgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold shadow-sm">
        MP
      </div>
      <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 text-gray-800 max-w-[85%]">
        ${escapeHtml(text).replace(/\n/g, "<br>")}
      </div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator(show) {
  const container = document.getElementById("chat-messages");
  const existing = document.getElementById("chat-typing-indicator");
  if (existing) existing.remove();

  if (show && container) {
    const indicator = document.createElement("div");
    indicator.id = "chat-typing-indicator";
    indicator.className = "flex gap-2.5 items-center text-gray-400 text-xs py-1";
    indicator.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold">
        MP
      </div>
      <div class="bg-white px-3 py-2 rounded-2xl rounded-tl-none border border-gray-100 flex items-center gap-1">
        <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
        <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
        <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
      </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
