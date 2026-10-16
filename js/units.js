// js/units.js
// Handles dynamic rendering of units, tower filters, and unit detail modals

import { getUnitsCatalog } from "./firebase-app.js";

let allUnits = [];
let currentFilter = "all";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initUnitsSection());
} else {
  initUnitsSection();
}

export async function initUnitsSection() {
  const container = document.getElementById("units-list");
  if (!container) return;

  // Show loading skeleton
  container.innerHTML = `
    <div class="col-span-full py-16 text-center">
      <div class="inline-block animate-spin rounded-full h-10 w-10 border-4 border-yellow border-t-transparent"></div>
      <p class="mt-4 text-gray-500 font-medium">Loading luxury units...</p>
    </div>
  `;

  try {
    allUnits = await getUnitsCatalog();
    renderUnits();
    setupTowerFilters();
    populateBookingUnitDropdown();
  } catch (error) {
    console.error("Failed to render units:", error);
    container.innerHTML = `
      <div class="col-span-full py-10 text-center text-red-500">
        <p>Could not load units at this moment. Please refresh the page.</p>
      </div>
    `;
  }
}

function renderUnits() {
  const container = document.getElementById("units-list");
  const countEl = document.getElementById("shown-count");
  const totalEl = document.getElementById("total-count");

  if (!container) return;

  let filtered = allUnits;
  if (currentFilter !== "all") {
    filtered = allUnits.filter(u => {
      const tower = (u.tower || u.name || "").toLowerCase();
      return tower.includes(currentFilter.toLowerCase());
    });
  }

  if (countEl) countEl.textContent = filtered.length;
  if (totalEl) totalEl.textContent = allUnits.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-gray-500">
        <i class="fas fa-building text-4xl mb-3 text-gray-300"></i>
        <p class="text-lg">No units found in this category.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(unit => {
    const coverImg = unit.coverImage || (unit.images && unit.images[0]) || "images/living_room.jpg";
    const amenities = unit.amenities || ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Pool Access"];
    const rateFormatted = (unit.rate || 1899).toLocaleString();

    return `
      <article class="unit-card bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col border border-gray-100 group" data-unit-id="${unit.id}">
        <!-- Image Container -->
        <div class="relative aspect-[4/3] overflow-hidden bg-gray-100">
          <img 
            loading="lazy" 
            src="${coverImg}" 
            alt="${unit.name}" 
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onerror="this.src='images/living_room.jpg'"
          />
          <div class="absolute top-3 left-3">
            <span class="bg-charcoal/80 backdrop-blur-md text-white text-xs font-medium px-3 py-1 rounded-full uppercase tracking-wider">
              ${unit.type || "Studio"}
            </span>
          </div>
          <div class="absolute bottom-3 right-3">
            <span class="bg-yellow text-charcoal font-bold text-sm px-3 py-1 rounded-lg shadow">
              ₱${rateFormatted} <span class="text-xs font-normal">/ night</span>
            </span>
          </div>
        </div>

        <!-- Content -->
        <div class="p-6 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-2 text-xs text-yellow-dark font-medium mb-1">
              <i class="fas fa-map-marker-alt"></i>
              <span>${unit.tower || "Shore Residences, Pasay"}</span>
            </div>
            <h3 class="text-xl font-bold font-serif text-charcoal mb-2 hover:text-yellow-dark transition-colors">
              ${unit.name}
            </h3>
            <p class="text-sm text-gray-600 line-clamp-2 mb-4">
              ${unit.description || "Premium staycation unit with modern amenities and resort access."}
            </p>

            <!-- Amenities Badges -->
            <div class="flex flex-wrap gap-1.5 mb-6">
              ${amenities.slice(0, 4).map(a => `
                <span class="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-md flex items-center gap-1">
                  <i class="fas fa-check text-yellow-dark text-[10px]"></i> ${a}
                </span>
              `).join("")}
              ${amenities.length > 4 ? `
                <span class="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-md">
                  +${amenities.length - 4} more
                </span>
              ` : ""}
            </div>
          </div>

          <!-- Bottom Actions -->
          <div class="pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <div class="text-xs text-gray-500 flex items-center gap-1">
              <i class="fas fa-user-friends text-yellow-dark"></i>
              <span>Max ${unit.maxOccupancy || 4} Guests</span>
            </div>
            <div class="flex items-center gap-2">
              <button 
                type="button" 
                class="view-unit-btn px-3 py-2 rounded-lg border border-gray-300 hover:border-yellow text-gray-700 hover:text-charcoal text-xs font-medium transition-colors"
                data-id="${unit.id}"
              >
                View
              </button>
              <button 
                type="button" 
                class="book-unit-btn px-4 py-2 rounded-lg bg-yellow hover:bg-yellow-dark text-charcoal text-xs font-bold transition-all shadow-sm hover:shadow"
                data-id="${unit.id}"
              >
                Book Now
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // Attach event listeners for View and Book buttons
  container.querySelectorAll(".view-unit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const unitId = btn.getAttribute("data-id");
      const unit = allUnits.find(u => u.id === unitId);
      if (unit) openUnitModal(unit);
    });
  });

  container.querySelectorAll(".book-unit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const unitId = btn.getAttribute("data-id");
      selectUnitForBooking(unitId);
    });
  });
}

function setupTowerFilters() {
  const filterButtons = document.querySelectorAll(".tower-filter-btn");
  if (!filterButtons.length) return;

  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      filterButtons.forEach(b => {
        b.classList.remove("bg-charcoal", "text-white");
        b.classList.add("bg-gray-100", "text-gray-700");
      });
      btn.classList.remove("bg-gray-100", "text-gray-700");
      btn.classList.add("bg-charcoal", "text-white");

      currentFilter = btn.getAttribute("data-filter") || "all";
      renderUnits();
    });
  });
}

function populateBookingUnitDropdown() {
  const dropdown = document.getElementById("booking-unit-select");
  if (!dropdown) return;

  dropdown.innerHTML = allUnits.map(unit => `
    <option value="${unit.id}" data-rate="${unit.rate || 1899}">
      ${unit.name} (₱${(unit.rate || 1899).toLocaleString()}/night)
    </option>
  `).join("");
}

export function selectUnitForBooking(unitId) {
  const bookingSection = document.getElementById("booking");
  const dropdown = document.getElementById("booking-unit-select");
  
  if (dropdown && unitId) {
    dropdown.value = unitId;
    dropdown.dispatchEvent(new Event("change"));
  }

  // Also trigger custom event so calendar updates
  window.dispatchEvent(new CustomEvent("mp:unitSelected", { detail: { unitId } }));

  if (bookingSection) {
    bookingSection.scrollIntoView({ behavior: "smooth" });
  }
}

/**
 * Open Rich Modal with Unit Photos, Amenities, and Details
 */
export function openUnitModal(unit) {
  let modal = document.getElementById("unit-detail-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "unit-detail-modal";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-300";
    document.body.appendChild(modal);
  }

  const images = (unit.images && unit.images.length > 0) 
    ? unit.images 
    : [unit.coverImage || "images/living_room.jpg"];
  const amenities = unit.amenities || ["WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot Shower", "Kitchenette", "Pool Access"];

  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scaleIn">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-white z-10">
        <div>
          <span class="text-xs font-bold text-yellow-dark tracking-wider uppercase">${unit.tower || "Shore Residences"}</span>
          <h2 class="text-2xl font-serif font-bold text-charcoal">${unit.name}</h2>
        </div>
        <button id="close-unit-modal-btn" class="text-gray-400 hover:text-charcoal p-2 rounded-full hover:bg-gray-100 transition-colors text-2xl leading-none">
          &times;
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-6 md:p-8 overflow-y-auto space-y-6 flex-1">
        <!-- Main Image & Thumbnails -->
        <div>
          <div class="aspect-[16/9] w-full rounded-2xl overflow-hidden bg-gray-100 mb-3 shadow-inner">
            <img id="modal-active-img" src="${images[0]}" alt="${unit.name}" class="w-full h-full object-cover transition-all duration-300" />
          </div>
          ${images.length > 1 ? `
            <div class="flex gap-2 overflow-x-auto pb-2">
              ${images.map((img, idx) => `
                <button type="button" class="modal-thumb-btn w-20 h-16 rounded-lg overflow-hidden border-2 ${idx === 0 ? "border-yellow" : "border-transparent"} shrink-0" data-src="${img}">
                  <img src="${img}" class="w-full h-full object-cover" />
                </button>
              `).join("")}
            </div>
          ` : ""}
        </div>

        <!-- Key Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-2xl text-center">
          <div>
            <span class="text-xs text-gray-500 block">Nightly Rate</span>
            <span class="text-lg font-bold text-charcoal">₱${(unit.rate || 1899).toLocaleString()}</span>
          </div>
          <div>
            <span class="text-xs text-gray-500 block">Max Guests</span>
            <span class="text-lg font-bold text-charcoal">${unit.maxOccupancy || 4} Guests</span>
          </div>
          <div>
            <span class="text-xs text-gray-500 block">Check-in</span>
            <span class="text-lg font-bold text-charcoal">2:00 PM</span>
          </div>
          <div>
            <span class="text-xs text-gray-500 block">Check-out</span>
            <span class="text-lg font-bold text-charcoal">12:00 PM</span>
          </div>
        </div>

        <!-- Description -->
        <div>
          <h4 class="font-bold text-charcoal mb-2">About this unit</h4>
          <p class="text-gray-600 leading-relaxed text-sm md:text-base">
            ${unit.description || "Experience premier comfort and relaxation in our modern furnished unit located in the heart of Pasay City, steps away from SM Mall of Asia and entertainment centers."}
          </p>
        </div>

        <!-- Amenities -->
        <div>
          <h4 class="font-bold text-charcoal mb-3">Amenities & Features</h4>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            ${amenities.map(a => `
              <div class="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 p-2.5 rounded-xl">
                <i class="fas fa-check-circle text-yellow-dark text-sm"></i>
                <span>${a}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-100 flex items-center justify-between bg-gray-50">
        <div>
          <span class="text-xs text-gray-500">Starting from</span>
          <div class="text-2xl font-bold font-serif text-charcoal">
            ₱${(unit.rate || 1899).toLocaleString()} <span class="text-sm font-sans font-normal text-gray-500">/ night</span>
          </div>
        </div>
        <button 
          id="modal-book-now-btn" 
          class="bg-yellow hover:bg-yellow-dark text-charcoal font-bold py-3 px-8 rounded-full shadow-md hover:shadow-lg transition-all"
        >
          Book This Unit
        </button>
      </div>
    </div>
  `;

  // Handlers
  modal.querySelector("#close-unit-modal-btn").onclick = () => closeUnitModal();
  modal.onclick = (e) => {
    if (e.target === modal) closeUnitModal();
  };

  const activeImg = modal.querySelector("#modal-active-img");
  modal.querySelectorAll(".modal-thumb-btn").forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll(".modal-thumb-btn").forEach(b => b.classList.remove("border-yellow"));
      btn.classList.add("border-yellow");
      activeImg.src = btn.getAttribute("data-src");
    };
  });

  modal.querySelector("#modal-book-now-btn").onclick = () => {
    closeUnitModal();
    selectUnitForBooking(unit.id);
  };

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

export function closeUnitModal() {
  const modal = document.getElementById("unit-detail-modal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "";
  }
}
