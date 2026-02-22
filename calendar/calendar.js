// /calendar/calendar.js

const bookingCache = {}; // unitId -> bookings[]

async function loadBookings(unitId) {
  const res = await fetch(`/data/${unitId}.json?v=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load /data/${unitId}.json`);
  const bookings = await res.json();

  // basic sanity: ensure it's an array of {start,end}
  if (!Array.isArray(bookings)) throw new Error("Bookings JSON is not an array");
  return bookings;
}

window.getBookingsForUnit = async function (unitId) {
  if (!unitId) return [];
  if (!bookingCache[unitId]) {
    bookingCache[unitId] = await loadBookings(unitId);
  }
  return bookingCache[unitId];
};

// if you want a manual refresh after sync:
window.refreshBookingsForUnit = async function (unitId) {
  bookingCache[unitId] = await loadBookings(unitId);
  return bookingCache[unitId];
};
