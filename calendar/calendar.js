let currentUnit = null
let bookings = []

async function loadCalendar(unit) {
  currentUnit = unit

  try {
    const res = await fetch(`/data/${unit}.json`)

    if (!res.ok) {
      console.warn("No calendar found for", unit)
      bookings = []
    } else {
      bookings = await res.json()
    }

    console.log("Loaded bookings:", bookings)

    renderCalendar()

  } catch (err) {
    console.error("Calendar load failed:", err)
    bookings = []
    renderCalendar()
  }
}

function renderCalendar() {
  // 🔥 THIS connects to your existing calendar UI

  // Example logic:
  // loop over bookings
  // mark days as red/booked

  // You already have a render function —
  // just inject bookings into it

  console.log("Render calendar with:", bookings)
}

document.querySelectorAll(".property-selector").forEach(btn => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".property-selector")
      .forEach(b => b.classList.remove("active"))

    btn.classList.add("active")

    const unit = btn.dataset.property
    loadCalendar(unit)
  })
})


// Load default property on page open
const defaultBtn = document.querySelector(".property-selector.active")
if (defaultBtn) {
  loadCalendar(defaultBtn.dataset.property)
}
