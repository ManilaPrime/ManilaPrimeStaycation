// js/booking.js
// Live Availability Calendar, Double-Booking Prevention, and Option A Payment Flow

import { 
  getUnitsCatalog, 
  getUnitAvailability, 
  checkDateConflict, 
  submitWebsiteBooking, 
  submitPaymentProof,
  compressImageToWebP
} from "./firebase-app.js";

let selectedUnit = null;
let occupiedDates = []; // [{start, end, source}]
let checkInDate = null;
let checkOutDate = null;
let selectedDates = [];

let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initBookingSection());
} else {
  initBookingSection();
}

// Listen for external unit selections (e.g. from units list or AI chat)
window.addEventListener("mp:unitSelected", async (e) => {
  const unitId = e.detail?.unitId;
  if (!unitId) return;

  const units = await getUnitsCatalog();
  const found = units.find(u => u.id === unitId);
  if (found) {
    onUnitChanged(found);
  }
});

export async function initBookingSection() {
  const units = await getUnitsCatalog();
  const unitSelect = document.getElementById("booking-unit-select");
  if (!unitSelect) return;

  // Initialize with first unit or previously selected unit
  if (units.length > 0) {
    unitSelect.innerHTML = units.map((u, i) => `
      <option value="${u.id}" ${i === 0 ? "selected" : ""}>
        ${u.name} — ₱${(u.rate || 1899).toLocaleString()}/night
      </option>
    `).join("");

    onUnitChanged(units[0]);
  }

  unitSelect.addEventListener("change", () => {
    const unitId = unitSelect.value;
    const found = units.find(u => u.id === unitId);
    if (found) onUnitChanged(found);
  });

  // Calendar month buttons
  const prevBtn = document.getElementById("cal-prev-month");
  const nextBtn = document.getElementById("cal-next-month");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      calendarMonth--;
      if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
      }
      renderCalendar();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      calendarMonth++;
      if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
      }
      renderCalendar();
    });
  }

  // Adult / Children count change updates pricing
  const adultsInput = document.getElementById("booking-adults");
  const childrenInput = document.getElementById("booking-children");
  if (adultsInput) adultsInput.addEventListener("input", updatePriceBreakdown);
  if (childrenInput) childrenInput.addEventListener("input", updatePriceBreakdown);

  // Booking Form Submission
  const bookingForm = document.getElementById("direct-booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", handleBookingSubmission);
  }

  // Payment Proof Form Submission
  const paymentProofForm = document.getElementById("payment-proof-form");
  if (paymentProofForm) {
    paymentProofForm.addEventListener("submit", handlePaymentProofSubmission);
  }
}

async function onUnitChanged(unit) {
  selectedUnit = unit;
  checkInDate = null;
  checkOutDate = null;
  selectedDates = [];

  const unitNameEl = document.getElementById("cal-selected-unit-name");
  const unitRateEl = document.getElementById("cal-selected-unit-rate");
  if (unitNameEl) unitNameEl.textContent = unit.name;
  if (unitRateEl) unitRateEl.textContent = `₱${(unit.rate || 1899).toLocaleString()} / night`;

  // Fetch occupied dates for this unit (direct + airbnb/external)
  showCalendarLoading(true);
  occupiedDates = await getUnitAvailability(unit.id);
  showCalendarLoading(false);

  renderCalendar();
  updatePriceBreakdown();
}

function showCalendarLoading(isLoading) {
  const loadingOverlay = document.getElementById("cal-loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.display = isLoading ? "flex" : "none";
  }
}

export function renderCalendar() {
  const monthTitle = document.getElementById("cal-month-title");
  const daysContainer = document.getElementById("cal-days-grid");
  if (!monthTitle || !daysContainer) return;

  monthTitle.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;
  daysContainer.innerHTML = "";

  const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
  const totalDaysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];

  // Empty slots before 1st of the month
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "h-11 sm:h-12";
    daysContainer.appendChild(emptyCell);
  }

  // Days in month
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayBtn = document.createElement("button");
    dayBtn.type = "button";
    dayBtn.textContent = day;
    dayBtn.setAttribute("data-date", dateStr);

    const isPast = dateStr < todayStr;
    const isBooked = isDateBooked(dateStr);
    const isSelected = selectedDates.includes(dateStr);
    const isCheckIn = dateStr === checkInDate;
    const isCheckOut = dateStr === checkOutDate;

    let baseClass = "h-11 sm:h-12 w-full rounded-xl text-sm font-semibold transition-all duration-200 flex flex-col items-center justify-center relative ";

    if (isPast) {
      dayBtn.className = baseClass + "text-gray-300 bg-gray-50 cursor-not-allowed";
      dayBtn.disabled = true;
    } else if (isBooked) {
      dayBtn.className = baseClass + "text-red-400 bg-red-50/70 border border-red-100 cursor-not-allowed";
      dayBtn.disabled = true;
      dayBtn.title = "Already booked / unavailable";
      dayBtn.innerHTML = `<span>${day}</span><span class="text-[9px] text-red-500 font-bold uppercase tracking-tighter">Booked</span>`;
    } else if (isCheckIn || isCheckOut) {
      dayBtn.className = baseClass + "bg-charcoal text-yellow shadow-md scale-105 z-10 font-bold";
      dayBtn.innerHTML = `<span>${day}</span><span class="text-[9px] text-yellow-light">${isCheckIn ? "Check-in" : "Check-out"}</span>`;
    } else if (isSelected) {
      dayBtn.className = baseClass + "bg-yellow text-charcoal font-bold shadow-sm";
    } else {
      dayBtn.className = baseClass + "text-charcoal bg-white hover:bg-yellow-light/60 border border-gray-100 shadow-sm";
      dayBtn.addEventListener("click", () => handleDateClick(dateStr));
    }

    daysContainer.appendChild(dayBtn);
  }
}

function isDateBooked(dateStr) {
  const current = new Date(dateStr);
  return occupiedDates.some(range => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    // Guest leaves on end date morning, so start <= current < end is blocked
    return current >= start && current < end;
  });
}

function handleDateClick(dateStr) {
  if (!checkInDate) {
    // Pick check-in
    checkInDate = dateStr;
    checkOutDate = null;
    selectedDates = [dateStr];
  } else if (!checkOutDate && dateStr > checkInDate) {
    // Check if any date in between is already booked
    const conflict = checkDateConflict(checkInDate, dateStr, occupiedDates);
    if (conflict.conflict) {
      alert("Selected range includes dates that are already booked. Please choose a different checkout date.");
      return;
    }

    checkOutDate = dateStr;

    // Fill all dates between checkIn and checkOut
    selectedDates = [];
    let cur = new Date(checkInDate);
    const end = new Date(checkOutDate);
    while (cur <= end) {
      selectedDates.push(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    // Reset selection to clicked date
    checkInDate = dateStr;
    checkOutDate = null;
    selectedDates = [dateStr];
  }

  renderCalendar();
  updatePriceBreakdown();
}

function updatePriceBreakdown() {
  const summaryBox = document.getElementById("booking-summary-box");
  const checkinDisplay = document.getElementById("summary-checkin");
  const checkoutDisplay = document.getElementById("summary-checkout");
  const nightsDisplay = document.getElementById("summary-nights");
  const baseRateDisplay = document.getElementById("summary-base-rate");
  const extraGuestDisplay = document.getElementById("summary-extra-guests");
  const totalAmountDisplay = document.getElementById("summary-total-amount");

  if (!selectedUnit || !checkInDate || !checkOutDate) {
    if (summaryBox) summaryBox.classList.add("hidden");
    return;
  }

  const checkin = new Date(checkInDate);
  const checkout = new Date(checkOutDate);
  const nights = Math.max(1, Math.round((checkout - checkin) / (1000 * 60 * 60 * 24)));

  const adults = parseInt(document.getElementById("booking-adults")?.value || "2", 10);
  const children = parseInt(document.getElementById("booking-children")?.value || "0", 10);
  const totalGuests = adults + children;

  const baseOccupancy = selectedUnit.baseOccupancy || 2;
  const extraGuestFee = selectedUnit.extraGuestFee || 350;
  const extraGuestsCount = Math.max(0, totalGuests - baseOccupancy);
  const totalExtraGuestCost = extraGuestsCount * extraGuestFee * nights;

  const baseCost = nights * (selectedUnit.rate || 1899);
  const totalCost = baseCost + totalExtraGuestCost;

  if (summaryBox) summaryBox.classList.remove("hidden");
  if (checkinDisplay) checkinDisplay.textContent = formatDateNice(checkin);
  if (checkoutDisplay) checkoutDisplay.textContent = formatDateNice(checkout);
  if (nightsDisplay) nightsDisplay.textContent = `${nights} night${nights > 1 ? "s" : ""}`;
  if (baseRateDisplay) baseRateDisplay.textContent = `₱${baseCost.toLocaleString()}`;
  if (extraGuestDisplay) {
    extraGuestDisplay.textContent = extraGuestsCount > 0 
      ? `+₱${totalExtraGuestCost.toLocaleString()} (${extraGuestsCount} extra)` 
      : "₱0";
  }
  if (totalAmountDisplay) totalAmountDisplay.textContent = `₱${totalCost.toLocaleString()}`;
}

function formatDateNice(dateObj) {
  return dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

/**
 * Handle direct booking form submission
 */
async function handleBookingSubmission(e) {
  e.preventDefault();

  if (!selectedUnit) {
    alert("Please select a unit to book.");
    return;
  }
  if (!checkInDate || !checkOutDate) {
    alert("Please select both check-in and check-out dates on the calendar.");
    return;
  }

  const submitBtn = document.getElementById("submit-booking-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Holding your dates...`;
  }

  try {
    const firstName = document.getElementById("booking-first-name").value.trim();
    const lastName = document.getElementById("booking-last-name").value.trim();
    const email = document.getElementById("booking-email").value.trim();
    const phone = document.getElementById("booking-phone").value.trim();
    const adults = parseInt(document.getElementById("booking-adults").value, 10) || 2;
    const children = parseInt(document.getElementById("booking-children").value, 10) || 0;
    const specialRequests = document.getElementById("booking-requests")?.value.trim() || "";

    const checkin = new Date(checkInDate);
    const checkout = new Date(checkOutDate);
    const totalNights = Math.max(1, Math.round((checkout - checkin) / (1000 * 60 * 60 * 24)));
    const baseOccupancy = selectedUnit.baseOccupancy || 2;
    const extraFee = selectedUnit.extraGuestFee || 350;
    const extraGuests = Math.max(0, (adults + children) - baseOccupancy);
    const totalAmount = (totalNights * (selectedUnit.rate || 1899)) + (extraGuests * extraFee * totalNights);

    const bookingPayload = {
      unitId: selectedUnit.id,
      unitName: selectedUnit.name,
      guestFirstName: firstName,
      guestLastName: lastName,
      guestEmail: email,
      guestPhone: phone,
      checkinDate: checkInDate,
      checkoutDate: checkOutDate,
      adults,
      children,
      nightlyRate: selectedUnit.rate || 1899,
      totalAmount,
      specialRequests
    };

    const res = await submitWebsiteBooking(bookingPayload);

    // Switch view to Step 2: Payment Instructions
    showPaymentStep(res.bookingId, bookingPayload);

  } catch (err) {
    console.error("Booking submission error:", err);
    alert(err.message || "Failed to submit booking. Please try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Continue to Payment`;
    }
  }
}

/**
 * Step 2: Show Option A Payment Instructions
 */
function showPaymentStep(bookingId, booking) {
  const bookingStep = document.getElementById("booking-step-form");
  const paymentStep = document.getElementById("booking-step-payment");

  if (bookingStep) bookingStep.classList.add("hidden");
  if (paymentStep) {
    paymentStep.classList.remove("hidden");
    paymentStep.scrollIntoView({ behavior: "smooth" });
  }

  // Populate reference & amounts
  const refDisplay = document.getElementById("payment-booking-ref");
  const amountDisplay = document.getElementById("payment-total-amount");
  const unitDisplay = document.getElementById("payment-unit-name");
  const datesDisplay = document.getElementById("payment-dates");
  const hiddenIdInput = document.getElementById("payment-booking-id");

  if (refDisplay) refDisplay.textContent = bookingId;
  if (amountDisplay) amountDisplay.textContent = `₱${booking.totalAmount.toLocaleString()}`;
  if (unitDisplay) unitDisplay.textContent = booking.unitName;
  if (datesDisplay) datesDisplay.textContent = `${booking.checkinDate} to ${booking.checkoutDate}`;
  if (hiddenIdInput) hiddenIdInput.value = bookingId;
}

/**
 * Handle Payment Proof Submission (Option A)
 */
async function handlePaymentProofSubmission(e) {
  e.preventDefault();

  const bookingId = document.getElementById("payment-booking-id").value;
  const refNumber = document.getElementById("payment-ref-number").value.trim();
  const fileInput = document.getElementById("payment-receipt-file");
  const submitBtn = document.getElementById("submit-proof-btn");

  if (!refNumber) {
    alert("Please provide the transaction reference number from your payment receipt.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Submitting Payment Reference...`;
  }

  try {
    let receiptDataUrl = null;

    if (fileInput && fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      // Compress in-browser using Canvas to WebP
      const compressed = await compressImageToWebP(file, 1024, 0.8);
      receiptDataUrl = await readFileAsBase64(compressed);
    }

    await submitPaymentProof(bookingId, refNumber, receiptDataUrl);

    // Show Success screen
    const paymentStep = document.getElementById("booking-step-payment");
    const successStep = document.getElementById("booking-step-success");
    if (paymentStep) paymentStep.classList.add("hidden");
    if (successStep) {
      successStep.classList.remove("hidden");
      successStep.scrollIntoView({ behavior: "smooth" });
    }

  } catch (err) {
    console.error("Payment proof submission error:", err);
    alert("Failed to submit payment proof: " + err.message);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Submit Payment Reference`;
    }
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
