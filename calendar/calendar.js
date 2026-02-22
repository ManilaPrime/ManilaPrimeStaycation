let bookings = [];

async function loadBookings(unitId) {
  // cache-bust to avoid stale Vercel/CDN responses
  const res = await fetch(`/data/${unitId}.json?v=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load /data/${unitId}.json`);
  bookings = await res.json();
}

function applyBookedStyles() {
  // Your generated buttons have data-date; target them
  document.querySelectorAll("#calendar-days [data-date]").forEach(dayEl => {
    const dateStr = dayEl.getAttribute("data-date");
    if (!dateStr) return;

    const date = new Date(dateStr);

    const isBooked = bookings.some(b => {
      const start = new Date(b.start);
      const end = new Date(b.end);
      // Airbnb checkout day should NOT be blocked
      return date >= start && date < end;
    });

    if (isBooked) {
      dayEl.classList.add("booked");
      dayEl.disabled = true;
    } else {
      dayEl.classList.remove("booked");
      // don't force-enable if your own logic wants it disabled (past dates, etc.)
    }
  });
}

// Call this after your calendar grid is generated or regenerated
async function refreshCalendarBlocking(unitId) {
  await loadBookings(unitId);
  applyBookedStyles();
}
