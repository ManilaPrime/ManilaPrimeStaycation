function renderCalendar() {
  document.querySelectorAll(".calendar-day").forEach(dayEl => {
    const dateStr = dayEl.dataset.date

    if (!dateStr) return

    const date = new Date(dateStr)

    const isBooked = bookings.some(b => {
      const start = new Date(b.start)
      const end = new Date(b.end)

      // Airbnb checkout day should NOT be blocked
      return date >= start && date < end
    })

    if (isBooked) {
      dayEl.classList.add("booked")
    } else {
      dayEl.classList.remove("booked")
    }
  })
}
