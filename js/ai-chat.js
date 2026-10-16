// js/ai-chat.js
// Manila Prime Chat Assistant with two-way staff hand-off

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

let chatId = localStorage.getItem("mp_guest_chat_v3");
if (!chatId) {
  chatId = "chat_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  localStorage.setItem("mp_guest_chat_v3", chatId);
}

let currentMode = "assistant"; // "assistant" | "staff"
let staffNotifiedForSession = false;
let staffActive = false;
let chatUnsubscribe = null;
let cachedUnits = [];

const STAYCATION_KNOWLEDGE = `
You are the helpful chat assistant for Manila Prime Staycation, welcoming guests to cozy, fully furnished condo units at Shore Residences (Shore 1, Shore 2, and Shore 3) in Pasay City — right beside SM Mall of Asia and MOA Arena.

Tone & Persona:
- Warm, polite, hospitable, and conversational — like a helpful friend or staff messaging a guest on Viber or Messenger.
- NEVER sound like a generic robotic AI or textbook. Do NOT say "As an AI...", "I am an artificial intelligence", or "Feel free to inquire". Always speak naturally as "we" or "our staff at Manila Prime".
- Keep responses short (2 to 4 sentences), helpful, and direct.

Stay Details:
- Location: Shore Residences, Seaside Boulevard, Pasay City (walking distance to SM Mall of Asia).
- Check-in: 2:00 PM.
- Check-out: 12:00 PM (Noon).
- Early check-in / late check-out: We can accommodate this if the unit is available on your dates, just ask our staff!
- Nightly Rates: Around ₱1,899 to ₱2,399/night depending on the unit and dates.
- Capacity: Up to 4 guests (Base rate covers 2 guests; extra guest fee is ₱350/night).
- Inclusions: Fast fiber WiFi, Smart TV with free Netflix, air conditioning, refrigerator, microwave, rice cooker, induction cooker with cookware, hot & cold shower, and fresh towels/linens.
- Swimming Pools: Resort pool passes are ₱150 per guest on regular days and ₱300 on holidays (paid directly to the building admin). Pools are closed on Mondays for regular maintenance.
- Parking: Available in the building basement and open outdoor parking lots (around ₱50 for first 4 hours, ₱300 overnight).
- Security Deposit: ₱1,000 refundable incidental deposit upon check-in, returned upon check-out after room inspection.
- Payment Methods: GCash, Maya, or Bank Transfer (BDO, BPI).
- Building Rules: No pets allowed by condo admin; strictly non-smoking inside units (designated smoking area on the ground level).
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
  const launcher = document.createElement("div");
  launcher.id = "mp-chat-launcher";
  launcher.className = "fixed bottom-6 right-6 z-50 flex items-center gap-3";
  launcher.innerHTML = `
    <div id="mp-chat-tooltip" class="hidden sm:flex items-center bg-white text-charcoal text-xs font-semibold px-3 py-2 rounded-xl shadow-lg border border-gray-100 animate-bounce">
      <span>💬 Have questions? Chat with our team!</span>
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

  const chatWindow = document.createElement("div");
  chatWindow.id = "mp-chat-window";
  chatWindow.className = "fixed bottom-24 right-4 sm:right-6 w-[92vw] sm:w-[380px] h-[520px] max-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-100 z-50 flex flex-col overflow-hidden transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-none";
  chatWindow.innerHTML = `
    <!-- Header -->
    <div class="bg-charcoal text-white p-4 flex items-center justify-between border-b border-gray-800">
      <div class="flex items-center gap-3">
        <div class="relative">
          <div class="w-10 h-10 rounded-full bg-yellow text-charcoal flex items-center justify-center font-bold">
            <i class="fas fa-comments text-lg" id="chat-header-icon"></i>
          </div>
          <span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-charcoal rounded-full" id="chat-header-dot"></span>
        </div>
        <div>
          <h3 class="font-bold text-sm" id="chat-header-title">Manila Prime Chat Assistant</h3>
          <p class="text-[11px] text-gray-300 flex items-center gap-1.5" id="chat-header-status">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400"></span> Online • How can we help?
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button 
          id="chat-mode-toggle-btn" 
          class="text-xs bg-white/10 hover:bg-yellow hover:text-charcoal text-white px-2.5 py-1 rounded-full transition-colors font-medium flex items-center gap-1.5" 
          title="Chat directly with our staff"
        >
          <i class="fas fa-user-friends text-[11px]" id="chat-mode-toggle-icon"></i>
          <span id="chat-mode-toggle-label">Chat with Staff</span>
        </button>
        <button id="chat-close-btn" class="text-gray-400 hover:text-white p-1 rounded-lg text-lg leading-none" title="Close chat">
          &times;
        </button>
      </div>
    </div>

    <!-- Live Staff Banner -->
    <div id="human-active-banner" class="hidden bg-amber-50 border-b border-amber-200 px-3.5 py-1.5 text-xs text-amber-900 flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-yellow-500" id="staff-banner-dot"></span>
        <span id="staff-banner-text" class="font-medium">Direct chat with Manila Prime Staff</span>
      </div>
      <button 
        id="banner-switch-assistant-btn" 
        class="text-[10px] bg-white border border-amber-300 hover:bg-yellow hover:text-charcoal text-amber-900 font-semibold px-2 py-0.5 rounded-full shadow-2xs transition-colors flex items-center gap-1"
        title="Switch back to Chat Assistant"
      >
        <i class="fas fa-robot text-[9px]"></i> Back to Assistant
      </button>
    </div>

    <!-- Messages Container -->
    <div id="chat-messages" class="flex-1 p-4 overflow-y-auto space-y-3 bg-gray-50/60 text-sm">
      <div class="flex gap-2.5 items-start">
        <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold shadow-xs">
          MP
        </div>
        <div class="bg-white p-3.5 rounded-2xl rounded-tl-none shadow-xs border border-gray-100 text-gray-800 max-w-[85%] leading-relaxed text-xs">
          Hi! Welcome to <strong>Manila Prime Staycation</strong> at Shore Residences 👋<br><br>
          I'm your <strong>Chat Assistant</strong>. Ask me anything about our units, rates, or pool rules—or tap below to message our staff directly:
        </div>
      </div>
    </div>

    <!-- Quick Chips -->
    <div id="chat-quick-chips" class="px-3 py-2 bg-white border-t border-gray-100 flex gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
      <!-- Injected by renderQuickChips() -->
    </div>

    <!-- Input Footer -->
    <form id="chat-input-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2">
      <input 
        type="text" 
        id="chat-user-input" 
        placeholder="Type a message or question..." 
        autocomplete="off" 
        class="flex-1 bg-gray-50 border border-gray-200 focus:border-yellow focus:bg-white rounded-full px-4 py-2 text-sm text-charcoal outline-none transition-all"
      />
      <button 
        type="submit" 
        id="chat-send-btn" 
        class="w-9 h-9 bg-yellow hover:bg-yellow-dark text-charcoal rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-sm"
        title="Send message"
      >
        <i class="fas fa-paper-plane text-xs"></i>
      </button>
    </form>
  `;
  document.body.appendChild(chatWindow);

  // Attach Event Handlers
  const toggleBtn = document.getElementById("mp-chat-toggle-btn");
  const closeBtn = document.getElementById("chat-close-btn");
  const modeToggleBtn = document.getElementById("chat-mode-toggle-btn");
  const bannerSwitchBtn = document.getElementById("banner-switch-assistant-btn");
  const form = document.getElementById("chat-input-form");

  toggleBtn.onclick = () => toggleChatWindow();
  closeBtn.onclick = () => toggleChatWindow(false);

  // Two-way mode toggle in header
  modeToggleBtn.onclick = () => {
    if (currentMode === "assistant") {
      switchToStaffMode(true);
    } else {
      switchToAssistantMode(true);
    }
  };

  // Switch back button in the banner
  if (bannerSwitchBtn) {
    bannerSwitchBtn.onclick = () => switchToAssistantMode(true);
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-user-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await handleUserMessage(text);
  };

  renderQuickChips();
}

export function switchToStaffMode(showNotice = true) {
  currentMode = "staff";

  const headerIcon = document.getElementById("chat-header-icon");
  const headerTitle = document.getElementById("chat-header-title");
  const headerStatus = document.getElementById("chat-header-status");
  const toggleBtn = document.getElementById("chat-mode-toggle-btn");
  const toggleIcon = document.getElementById("chat-mode-toggle-icon");
  const toggleLabel = document.getElementById("chat-mode-toggle-label");
  const input = document.getElementById("chat-user-input");

  if (headerIcon) headerIcon.className = "fas fa-user-friends text-lg";
  if (headerTitle) headerTitle.textContent = "Manila Prime Staff";
  
  if (headerStatus) {
    if (staffActive) {
      headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span> Staff Active`;
    } else if (staffNotifiedForSession) {
      headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Staff Notified • Connecting`;
    } else {
      headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400"></span> Direct Message • Ready`;
    }
  }

  // Toggle button now allows switching back to Chat Assistant
  if (toggleBtn) {
    toggleBtn.className = "text-xs bg-yellow text-charcoal hover:bg-yellow-dark px-2.5 py-1 rounded-full transition-colors font-semibold flex items-center gap-1.5 shadow-xs";
    toggleBtn.title = "Switch back to Manila Prime Chat Assistant";
  }
  if (toggleIcon) toggleIcon.className = "fas fa-robot text-[11px]";
  if (toggleLabel) toggleLabel.textContent = "Chat Assistant";

  updateStaffBanner();

  if (input) {
    input.placeholder = "Message our staff directly...";
    input.focus();
  }

  renderQuickChips();

  if (showNotice) {
    appendMessage("system", "💬 You are in Staff Chat mode. Send a message below and our team will be notified to reply!");
  }
}

export function switchToAssistantMode(showNotice = true) {
  currentMode = "assistant";

  const headerIcon = document.getElementById("chat-header-icon");
  const headerTitle = document.getElementById("chat-header-title");
  const headerStatus = document.getElementById("chat-header-status");
  const toggleBtn = document.getElementById("chat-mode-toggle-btn");
  const toggleIcon = document.getElementById("chat-mode-toggle-icon");
  const toggleLabel = document.getElementById("chat-mode-toggle-label");
  const banner = document.getElementById("human-active-banner");
  const input = document.getElementById("chat-user-input");

  if (headerIcon) headerIcon.className = "fas fa-comments text-lg";
  if (headerTitle) headerTitle.textContent = "Manila Prime Chat Assistant";
  if (headerStatus) {
    headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400"></span> Online • How can we help?`;
  }

  // Toggle button allows switching back to Staff
  if (toggleBtn) {
    toggleBtn.className = "text-xs bg-white/10 hover:bg-yellow hover:text-charcoal text-white px-2.5 py-1 rounded-full transition-colors font-medium flex items-center gap-1.5";
    toggleBtn.title = "Chat directly with our staff";
  }
  if (toggleIcon) toggleIcon.className = "fas fa-user-friends text-[11px]";
  if (toggleLabel) toggleLabel.textContent = "Chat with Staff";

  if (banner) banner.classList.add("hidden");

  if (input) {
    input.placeholder = "Type a message or question...";
    input.focus();
  }

  renderQuickChips();

  if (showNotice) {
    appendMessage("system", "🤖 Switched back to Manila Prime Chat Assistant. Ask me anything about our units, rates, or pool rules!");
  }
}

function updateStaffBanner() {
  const banner = document.getElementById("human-active-banner");
  const dot = document.getElementById("staff-banner-dot");
  const text = document.getElementById("staff-banner-text");
  if (!banner) return;

  banner.classList.remove("hidden");

  if (staffActive) {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-green-500 animate-pulse";
    if (text) text.textContent = "Manila Prime Staff is in this chat";
  } else if (staffNotifiedForSession) {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-500 animate-pulse";
    if (text) text.textContent = "Staff notified — waiting for reply";
  } else {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-yellow-500";
    if (text) text.textContent = "Direct chat with Manila Prime Staff";
  }
}

function renderQuickChips() {
  const container = document.getElementById("chat-quick-chips");
  if (!container) return;

  if (currentMode === "assistant") {
    container.innerHTML = `
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="What are your unit rates?">
        💰 Unit Rates
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="How does pool access work and what are the fees?">
        🏊 Pool Info
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="What are your check-in and check-out times?">
        ⏰ Check-in / Out
      </button>
      <button class="chip-btn text-xs bg-yellow/20 hover:bg-yellow text-charcoal font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors" data-action="switch-to-staff">
        💬 Chat with Staff
      </button>
    `;
  } else {
    container.innerHTML = `
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="Hi, is early check-in possible on my booking dates?">
        🕒 Early Check-in?
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="Can you assist me with bank or GCash payment confirmation?">
        💳 Payment Help
      </button>
      <button class="chip-btn text-xs bg-gray-100 hover:bg-yellow text-charcoal px-3 py-1.5 rounded-full whitespace-nowrap transition-colors font-medium" data-text="What are the swimming pool rules and passes?">
        🏊 Pool Details
      </button>
      <button class="chip-btn text-xs bg-yellow/20 hover:bg-yellow text-charcoal font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors" data-action="switch-to-assistant">
        🤖 Back to Assistant
      </button>
    `;
  }

  container.querySelectorAll(".chip-btn").forEach(chip => {
    chip.onclick = () => {
      const action = chip.getAttribute("data-action");
      if (action === "switch-to-staff") {
        switchToStaffMode(true);
      } else if (action === "switch-to-assistant") {
        switchToAssistantMode(true);
      } else {
        const text = chip.getAttribute("data-text");
        if (text) handleUserMessage(text);
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

async function handleUserMessage(text) {
  appendMessage("user", text);
  await recordChatMessage("user", text);

  // If in Assistant mode and guest asked for staff/human
  const isAskingHuman = /\b(human|agent|host|person|call|speak|talk to someone|staff|owner)\b/i.test(text);
  if (isAskingHuman && currentMode === "assistant") {
    switchToStaffMode(false);
    await notifyStaff(text);
    return;
  }

  // If in Staff mode, notify staff now that they chatted!
  if (currentMode === "staff") {
    await notifyStaff(text);
    return;
  }

  // Assistant responds to question
  showTypingIndicator(true);
  try {
    const aiAnswer = await generateAIAnswer(text);
    showTypingIndicator(false);
    appendMessage("assistant", aiAnswer);
    await recordChatMessage("assistant", aiAnswer);
  } catch (err) {
    console.error("AI error:", err);
    showTypingIndicator(false);
    appendMessage("assistant", "I'm having a brief connection issue. Tap 'Chat with Staff' above to message our team directly!");
  }
}

async function notifyStaff(messageText) {
  staffNotifiedForSession = true;
  updateStaffBanner();

  const headerStatus = document.getElementById("chat-header-status");
  if (headerStatus && !staffActive) {
    headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Staff Notified • Connecting`;
  }

  appendMessage("system", "👋 Your message has been sent to our staff. Someone from Manila Prime Staff will reply right here in just a moment!");

  try {
    await ensureVisitorAuth();
    const chatRef = doc(db, "guest-chats", chatId);
    await setDoc(chatRef, {
      id: chatId,
      status: "needs_human",
      lastInquiry: messageText,
      lastMessage: messageText,
      lastSender: "user",
      updatedAt: serverTimestamp(),
      platform: "website"
    }, { merge: true });

    // Send discord notification to staff
    await fetch(`${API_BASE_URL}/sendDiscordNotification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🚨 **Live Guest Chat Message!**\nA website visitor sent a message to staff.\n**Chat ID:** \`${chatId}\`\n**Message:** "${messageText}"\n*Open Staff Dashboard to reply live!*`
      })
    }).catch(() => {});
  } catch (e) {
    console.warn("Error notifying staff:", e);
  }
}

async function generateAIAnswer(userQuery) {
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

  return getLocalFaqAnswer(userQuery);
}

function getLocalFaqAnswer(query) {
  const q = query.toLowerCase();
  if (q.includes("rate") || q.includes("price") || q.includes("cost") || q.includes("magkano")) {
    return "Our cozy studio units range from ₱1,899 to ₱2,399 per night depending on your dates. Each unit comfortably fits up to 4 guests and comes with fast fiber WiFi, Netflix, clean hotel-grade linens, and a full kitchen! You can check exact dates in the booking section above.";
  }
  if (q.includes("pool") || q.includes("swimming")) {
    return "Yes! Guests can access the resort pools at Shore Residences. Pool passes are ₱150 per person on regular weekdays/weekends and ₱300 on holidays (settled directly at the building admin counter). Heads up that pools are closed on Mondays for regular cleaning.";
  }
  if (q.includes("checkin") || q.includes("check in") || q.includes("time") || q.includes("checkout")) {
    return "Check-in starts at 2:00 PM and check-out is by 12:00 PM (noon). If you need early check-in or late check-out, just send us a message and we'll check if the unit is available for you!";
  }
  if (q.includes("pet") || q.includes("dog") || q.includes("cat")) {
    return "As much as we love pets, the Shore Residences building administration strictly prohibits pets inside the towers.";
  }
  if (q.includes("park") || q.includes("car")) {
    return "Yes, there is pay parking available in the building basement and outdoor open lots (around ₱50 for the first 4 hours, and ₱300 for overnight parking).";
  }
  return "We're here to help! Feel free to check our available units and live calendar in the booking section above, or tap 'Chat with Staff' to message our team directly.";
}

function listenToChatUpdates() {
  if (chatUnsubscribe) chatUnsubscribe();

  const chatRef = doc(db, "guest-chats", chatId);
  chatUnsubscribe = onSnapshot(chatRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (data.status === "human_active") {
      staffActive = true;
      if (currentMode === "staff") {
        updateStaffBanner();
        const headerStatus = document.getElementById("chat-header-status");
        if (headerStatus) {
          headerStatus.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span> Staff Active`;
        }
      }
    }

    if (data.messages && Array.isArray(data.messages)) {
      const latestMsg = data.messages[data.messages.length - 1];
      if (latestMsg && (latestMsg.sender === "staff" || latestMsg.sender === "host") && !latestMsg.renderedInClient) {
        appendMessage(latestMsg.sender, latestMsg.text);
        latestMsg.renderedInClient = true;
        staffActive = true;

        if (currentMode !== "staff") {
          switchToStaffMode(false);
        } else {
          updateStaffBanner();
        }
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
      <div class="bg-charcoal text-white p-3 rounded-2xl rounded-tr-none shadow-sm max-w-[85%] text-xs leading-relaxed">
        ${escapeHtml(text)}
      </div>
    `;
  } else if (sender === "host" || sender === "staff") {
    msgDiv.className = "flex gap-2.5 items-start";
    msgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold shadow-xs">
        <i class="fas fa-user-friends text-xs"></i>
      </div>
      <div class="bg-amber-50/70 p-3 rounded-2xl rounded-tl-none shadow-xs border border-yellow/30 text-charcoal max-w-[85%]">
        <div class="text-[10px] text-yellow-darker font-bold tracking-wide uppercase mb-1 flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> Manila Prime Staff
        </div>
        <div class="text-xs text-gray-800 leading-relaxed">${escapeHtml(text)}</div>
      </div>
    `;
  } else if (sender === "system") {
    msgDiv.className = "flex justify-center my-1";
    msgDiv.innerHTML = `
      <div class="bg-amber-50 text-amber-900 border border-amber-200 text-xs px-3.5 py-1.5 rounded-full text-center font-medium shadow-2xs">
        ${text}
      </div>
    `;
  } else {
    // Manila Prime Chat Assistant
    msgDiv.className = "flex gap-2.5 items-start";
    msgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-yellow text-charcoal flex items-center justify-center text-xs shrink-0 font-bold shadow-xs">
        MP
      </div>
      <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-xs border border-gray-100 text-gray-800 max-w-[85%]">
        <div class="text-[10px] text-gray-400 font-semibold mb-1">Manila Prime Chat Assistant</div>
        <div class="text-xs text-gray-800 leading-relaxed">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
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

export async function requestStaff(initialQuery = "") {
  if (initialQuery) {
    switchToStaffMode(false);
    await notifyStaff(initialQuery);
  } else {
    switchToStaffMode(true);
  }
}

export { requestStaff as requestHumanHost };
