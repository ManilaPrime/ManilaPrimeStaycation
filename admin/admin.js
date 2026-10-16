// admin/admin.js
// Manila Prime Staycation Staff Dashboard

import { 
  db, 
  auth, 
  storage, 
  compressImageToWebP 
} from "/js/firebase-app.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Global state
let currentAdminUser = null;
let currentUnitsList = [];
let currentBookingsList = [];
let currentChatsList = [];
let activeChatId = null;
let activeProofBooking = null;

// Temporary gallery images for the unit modal currently being edited
let modalUnitImages = [];
let modalCoverImage = "";

// Initialize safely whether DOM is already ready or still loading
function initAdmin() {
  console.log("[MP Admin] Initializing Admin Portal...");
  try { setupAuthListeners(); } catch(e) { console.error("[MP Admin] setupAuthListeners error:", e); }
  try { setupTabNavigation(); } catch(e) { console.error("[MP Admin] setupTabNavigation error:", e); }
  try { setupUnitModalEvents(); } catch(e) { console.error("[MP Admin] setupUnitModalEvents error:", e); }
  try { setupBookingEvents(); } catch(e) { console.error("[MP Admin] setupBookingEvents error:", e); }
  try { setupLiveChatEvents(); } catch(e) { console.error("[MP Admin] setupLiveChatEvents error:", e); }
  try { setupPaymentSettingsEvents(); } catch(e) { console.error("[MP Admin] setupPaymentSettingsEvents error:", e); }
  console.log("[MP Admin] Admin Portal initialization complete.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  // DOM is already parsed (common with deferred module scripts)
  initAdmin();
}

// ========================================================
// 1. AUTHENTICATION GATE
// ========================================================
function setupAuthListeners() {
  const authGate = document.getElementById("auth-gate");
  const adminApp = document.getElementById("admin-app");
  const userEmailDisplay = document.getElementById("admin-user-email");
  const loginForm = document.getElementById("login-form");
  const errorMsg = document.getElementById("login-error-msg");
  const successMsg = document.getElementById("login-success-msg");
  const logoutBtn = document.getElementById("logout-btn");
  const submitBtn = document.getElementById("login-submit-btn");
  const forgotBtn = document.getElementById("forgot-password-btn");
  const toggleAuthModeBtn = document.getElementById("toggle-auth-mode-btn");
  const confirmPasswordGroup = document.getElementById("confirm-password-group");
  const formModeTitle = document.getElementById("form-mode-title");

  let isRegisterMode = false;

  function showDashboard(user) {
    console.log("[MP Admin] Entering dashboard for:", user?.email);
    currentAdminUser = user;
    if (authGate) {
      authGate.classList.add("hidden");
      authGate.classList.remove("flex");
      authGate.style.display = "none";
    }
    if (adminApp) {
      adminApp.classList.remove("hidden");
      adminApp.classList.add("flex");
      adminApp.style.display = "flex";
    }
    if (userEmailDisplay) {
      userEmailDisplay.textContent = user?.email || "Admin";
    }

    try { loadUnits(); } catch(e) { console.error("loadUnits error:", e); }
    try { listenToBookings(); } catch(e) { console.error("listenToBookings error:", e); }
    try { listenToLiveChats(); } catch(e) { console.error("listenToLiveChats error:", e); }
    try { loadPaymentSettings(); } catch(e) { console.error("loadPaymentSettings error:", e); }
  }

  function showLogin(errText, successText) {
    currentAdminUser = null;
    if (authGate) {
      authGate.classList.remove("hidden");
      authGate.classList.add("flex");
      authGate.style.display = "flex";
    }
    if (adminApp) {
      adminApp.classList.add("hidden");
      adminApp.classList.remove("flex");
      adminApp.style.display = "none";
    }

    if (errorMsg) {
      if (errText) {
        errorMsg.innerHTML = `<i class="fas fa-exclamation-circle shrink-0 mt-0.5"></i> <span>${errText}</span>`;
        errorMsg.classList.remove("hidden");
        errorMsg.style.display = "flex";
      } else {
        errorMsg.classList.add("hidden");
        errorMsg.style.display = "none";
      }
    }

    if (successMsg) {
      if (successText) {
        successMsg.innerHTML = `<i class="fas fa-check-circle shrink-0 mt-0.5"></i> <span>${successText}</span>`;
        successMsg.classList.remove("hidden");
        successMsg.style.display = "flex";
      } else {
        successMsg.classList.add("hidden");
        successMsg.style.display = "none";
      }
    }
  }

  // Toggle between Sign In and Register Mode
  if (toggleAuthModeBtn) {
    toggleAuthModeBtn.onclick = (e) => {
      e.preventDefault();
      isRegisterMode = !isRegisterMode;
      showLogin(); // clear error/success messages

      if (isRegisterMode) {
        if (confirmPasswordGroup) confirmPasswordGroup.classList.remove("hidden");
        if (submitBtn) submitBtn.textContent = "Create Account & Enter Dashboard";
        if (formModeTitle) formModeTitle.textContent = "Create Staff Account";
        toggleAuthModeBtn.textContent = "Already have an account? Sign In";
      } else {
        if (confirmPasswordGroup) confirmPasswordGroup.classList.add("hidden");
        if (submitBtn) submitBtn.textContent = "Sign In to Dashboard";
        if (formModeTitle) formModeTitle.textContent = "Staff Dashboard";
        toggleAuthModeBtn.textContent = "First time here? Create Staff Account";
      }
    };
  }

  // Monitor auth state
  onAuthStateChanged(auth, (user) => {
    console.log("[MP Admin] onAuthStateChanged:", user ? `${user.email} (anon: ${user.isAnonymous})` : "none");
    if (user && !user.isAnonymous && user.email) {
      showDashboard(user);
    } else {
      // Don't wipe active error message if one is showing
      if (errorMsg && !errorMsg.classList.contains("hidden")) {
        showLogin(errorMsg.innerText);
      } else {
        showLogin();
      }
    }
  });

  // Handle Form Submission
  async function handleSubmit(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const email = document.getElementById("login-email")?.value.trim();
    const password = document.getElementById("login-password")?.value;
    const confirmPassword = document.getElementById("login-confirm-password")?.value;

    showLogin(); // clear previous alerts

    if (!email || !password) {
      showLogin("Please enter both email address and password.");
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        showLogin("Passwords do not match. Please re-enter.");
        return;
      }
      if (password.length < 6) {
        showLogin("Password must be at least 6 characters long.");
        return;
      }
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> ${isRegisterMode ? "Creating Account..." : "Verifying Credentials..."}`;

    try {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (pErr) {
        console.warn("Could not set local persistence:", pErr);
      }

      // If an anonymous visitor session is active, sign out first
      if (auth.currentUser && auth.currentUser.isAnonymous) {
        try { await signOut(auth); } catch (_) {}
      }

      let userCred;
      if (isRegisterMode) {
        userCred = await createUserWithEmailAndPassword(auth, email, password);
        showToast("Staff account created successfully!", "success");
      } else {
        userCred = await signInWithEmailAndPassword(auth, email, password);
        showToast("Welcome to Manila Prime Admin!", "success");
      }

      showDashboard(userCred.user);
    } catch (err) {
      console.error("[MP Admin] Login/Register error:", err);
      let friendly = err.message || "Authentication failed.";
      if (
        err.code === "auth/invalid-credential" || 
        err.code === "auth/wrong-password" || 
        err.code === "auth/user-not-found" ||
        err.code === "auth/invalid-login-credentials"
      ) {
        friendly = "Incorrect email or password. If you forgot your password, click 'Forgot Password?'.";
      } else if (err.code === "auth/email-already-in-use") {
        friendly = "This email is already registered. Please switch to 'Sign In' or use 'Forgot Password?'.";
      } else if (err.code === "auth/invalid-email") {
        friendly = "Please enter a valid email address.";
      } else if (err.code === "auth/weak-password") {
        friendly = "Password is too weak. Please use at least 6 characters.";
      } else if (err.code === "auth/too-many-requests") {
        friendly = "Too many failed attempts. Please wait a few minutes before trying again.";
      } else if (err.code === "auth/network-request-failed") {
        friendly = "Network error connecting to Firebase. Please check your internet connection.";
      }
      showLogin(friendly);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isRegisterMode ? "Create Account & Enter Dashboard" : "Sign In to Dashboard";
    }
  }

  if (loginForm) {
    loginForm.onsubmit = handleSubmit;
  }
  if (submitBtn) {
    submitBtn.onclick = handleSubmit;
  }

  // Forgot password
  if (forgotBtn) {
    forgotBtn.onclick = async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email")?.value.trim();
      if (!email) {
        showLogin("Please type your email address above, then click 'Forgot Password?'.");
        document.getElementById("login-email")?.focus();
        return;
      }

      forgotBtn.disabled = true;
      forgotBtn.textContent = "Sending link...";
      try {
        await sendPasswordResetEmail(auth, email);
        showLogin(null, `A password reset link was sent to ${email}. Check your email inbox/spam folder to reset your password.`);
        showToast("Reset link sent!", "info");
      } catch (err) {
        console.error("Password reset error:", err);
        showLogin("Could not send password reset: " + (err.message || "Please check the email."));
      } finally {
        forgotBtn.disabled = false;
        forgotBtn.textContent = "Forgot Password?";
      }
    };
  }

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      if (confirm("Are you sure you want to sign out?")) {
        await signOut(auth);
        showLogin();
        location.reload();
      }
    };
  }
}

// ========================================================
// 2. TAB NAVIGATION
// ========================================================
function setupTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab-btn");
  const contents = document.querySelectorAll(".tab-content");
  const pageTitle = document.getElementById("page-title");
  const topActionBtn = document.getElementById("top-action-btn");

  tabs.forEach(tab => {
    tab.onclick = () => {
      const targetId = tab.getAttribute("data-tab");

      tabs.forEach(t => {
        t.classList.remove("bg-yellow", "text-charcoal", "active");
        t.classList.add("text-gray-300");
      });
      tab.classList.add("bg-yellow", "text-charcoal", "active");
      tab.classList.remove("text-gray-300");

      contents.forEach(c => c.classList.add("hidden"));
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.remove("hidden");

      // Update titles and header button
      if (targetId === "tab-units") {
        pageTitle.textContent = "Units & Photo Management";
        topActionBtn.classList.remove("hidden");
        topActionBtn.innerHTML = `<i class="fas fa-plus"></i> Add New Unit`;
        topActionBtn.onclick = () => openUnitEditModal(null);
      } else if (targetId === "tab-bookings") {
        pageTitle.textContent = "Bookings & Payment Approvals";
        topActionBtn.classList.add("hidden");
      } else if (targetId === "tab-chats") {
        pageTitle.textContent = "Live Guest Support & AI Chats";
        topActionBtn.classList.add("hidden");
      } else if (targetId === "tab-settings") {
        pageTitle.textContent = "Payment QR & Bank Details";
        topActionBtn.classList.add("hidden");
      }
    };
  });

  // Top Action default
  if (topActionBtn) {
    topActionBtn.onclick = () => openUnitEditModal(null);
  }
}

// ========================================================
// 3. UNITS & PHOTO MANAGEMENT (CRUD + WebP Canvas Compression)
// ========================================================
async function loadUnits() {
  const grid = document.getElementById("admin-units-grid");
  if (!grid) return;

  grid.innerHTML = `
    <div class="col-span-full py-12 text-center text-gray-400">
      <i class="fas fa-spinner fa-spin text-2xl text-yellow mb-2"></i>
      <p class="text-xs">Loading units from Firestore...</p>
    </div>
  `;

  try {
    const snap = await getDocs(collection(db, "units"));
    currentUnitsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (currentUnitsList.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center bg-white rounded-2xl border border-dashed border-gray-300 p-8">
          <i class="fas fa-building text-4xl text-gray-300 mb-3"></i>
          <h3 class="font-bold text-gray-700">No units setup yet</h3>
          <p class="text-xs text-gray-400 mt-1 mb-4">Click below to add your first staycation unit.</p>
          <button class="bg-yellow hover:bg-yellow-dark text-charcoal text-xs font-bold px-4 py-2 rounded-xl shadow" onclick="document.getElementById('top-action-btn').click()">
            + Add First Unit
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = currentUnitsList.map(unit => {
      const cover = unit.coverImage || (unit.images && unit.images[0]) || "/images/living_room.jpg";
      const isAvailable = unit.status !== "maintenance" && unit.status !== "inactive";

      return `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
          <!-- Image -->
          <div class="relative aspect-[16/10] bg-gray-100 overflow-hidden">
            <img src="${cover}" alt="${unit.name}" class="w-full h-full object-cover" onerror="this.src='/images/living_room.jpg'" />
            <div class="absolute top-3 left-3">
              <span class="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${isAvailable ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}">
                ${unit.status || 'available'}
              </span>
            </div>
            <div class="absolute bottom-3 right-3 bg-charcoal/80 backdrop-blur-sm text-yellow font-bold text-xs px-2.5 py-1 rounded-lg">
              ₱${(unit.rate || 1899).toLocaleString()} / night
            </div>
          </div>

          <!-- Body -->
          <div class="p-5 flex-1 flex flex-col justify-between">
            <div>
              <span class="text-[11px] text-gray-400 font-semibold uppercase block mb-1">${unit.tower || "Shore Residences"}</span>
              <h3 class="font-bold text-charcoal text-lg mb-2">${unit.name}</h3>
              <div class="flex items-center gap-3 text-xs text-gray-500 mb-4">
                <span><i class="fas fa-users text-yellow-dark mr-1"></i> Max ${unit.maxOccupancy || 4} guests</span>
                <span><i class="fas fa-images text-yellow-dark mr-1"></i> ${(unit.images || []).length} photos</span>
              </div>
            </div>

            <!-- Card Actions -->
            <div class="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
              <button 
                class="edit-unit-btn px-3 py-1.5 rounded-lg border border-gray-200 hover:border-yellow text-xs font-semibold text-charcoal transition-colors flex items-center gap-1.5"
                data-id="${unit.id}"
              >
                <i class="fas fa-edit text-yellow-dark"></i> Edit Details & Photos
              </button>
              <button 
                class="delete-unit-btn text-gray-400 hover:text-red-500 p-2 rounded-lg text-xs transition-colors"
                data-id="${unit.id}"
                title="Delete unit"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Attach card action listeners
    grid.querySelectorAll(".edit-unit-btn").forEach(btn => {
      btn.onclick = () => {
        const unitId = btn.getAttribute("data-id");
        const found = currentUnitsList.find(u => u.id === unitId);
        openUnitEditModal(found);
      };
    });

    grid.querySelectorAll(".delete-unit-btn").forEach(btn => {
      btn.onclick = async () => {
        const unitId = btn.getAttribute("data-id");
        if (confirm("Are you sure you want to delete this unit? This cannot be undone.")) {
          try {
            await deleteDoc(doc(db, "units", unitId));
            showToast("Unit deleted successfully", "success");
            loadUnits();
          } catch (e) {
            alert("Error deleting unit: " + e.message);
          }
        }
      };
    });

  } catch (err) {
    console.error("Error loading units:", err);
    grid.innerHTML = `<div class="col-span-full py-10 text-center text-red-500 text-xs">Error loading units: ${err.message}</div>`;
  }
}

function setupUnitModalEvents() {
  const modal = document.getElementById("unit-modal");
  const closeBtn = document.getElementById("close-unit-modal-btn");
  const cancelBtn = document.getElementById("cancel-unit-modal-btn");
  const form = document.getElementById("unit-form");
  const imgUploader = document.getElementById("form-image-uploader");

  closeBtn.onclick = () => modal.classList.add("hidden");
  cancelBtn.onclick = () => modal.classList.add("hidden");

  // In-Browser WebP Image Compression and Upload Handler
  imgUploader.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    showToast(`Optimizing & uploading ${files.length} photo(s)...`, "info");

    for (const file of files) {
      try {
        // 1. In-browser Canvas compression to WebP (scales to max 1280px, quality 0.82)
        const compressedBlob = await compressImageToWebP(file, 1280, 0.82);

        // 2. Upload to Firebase Storage with long-term cache headers
        const fileName = `unit_img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.webp`;
        const storageReference = ref(storage, `units/${fileName}`);

        const snapshot = await uploadBytes(storageReference, compressedBlob, {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000"
        });

        const downloadUrl = await getDownloadURL(snapshot.ref);
        modalUnitImages.push(downloadUrl);
        if (!modalCoverImage) modalCoverImage = downloadUrl;

        renderModalGallery();
        showToast("Photo uploaded successfully (WebP optimized)!", "success");
      } catch (err) {
        console.error("Image upload failed, fallback to base64 preview:", err);
        // Fallback: convert to base64 data url if Storage rules/network are restricted
        const reader = new FileReader();
        reader.onload = () => {
          modalUnitImages.push(reader.result);
          if (!modalCoverImage) modalCoverImage = reader.result;
          renderModalGallery();
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // Form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("save-unit-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving to Firestore...";

    try {
      const unitId = document.getElementById("form-unit-id").value || ("unit_" + Date.now());
      const name = document.getElementById("form-unit-name").value.trim();
      const tower = document.getElementById("form-unit-tower").value.trim();
      const rate = parseFloat(document.getElementById("form-unit-rate").value) || 1899;
      const type = document.getElementById("form-unit-type").value.trim();
      const baseOcc = parseInt(document.getElementById("form-unit-base-occ").value, 10) || 2;
      const maxOcc = parseInt(document.getElementById("form-unit-max-occ").value, 10) || 4;
      const desc = document.getElementById("form-unit-desc").value.trim();
      const status = document.getElementById("form-unit-status").value;
      const airbnbIcal = document.getElementById("form-unit-airbnb-ical").value.trim();
      const amenitiesRaw = document.getElementById("form-unit-amenities").value;

      const amenities = amenitiesRaw.split(",")
        .map(a => a.trim())
        .filter(Boolean);

      const unitPayload = {
        name,
        tower,
        rate,
        type,
        baseOccupancy: baseOcc,
        maxOccupancy: maxOcc,
        extraGuestFee: 350,
        description: desc,
        status,
        amenities,
        images: modalUnitImages,
        coverImage: modalCoverImage || (modalUnitImages[0] || ""),
        calendars: {
          airbnb: airbnbIcal || ""
        },
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, "units", unitId), unitPayload, { merge: true });

      // Invalidate website catalog cache
      localStorage.removeItem("mp_units_catalog_v2");
      localStorage.removeItem("mp_units_timestamp_v2");

      showToast("Unit saved successfully!", "success");
      modal.classList.add("hidden");
      loadUnits();
    } catch (err) {
      console.error("Save unit error:", err);
      alert("Failed to save unit: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Unit";
    }
  };
}

function openUnitEditModal(unit) {
  const modal = document.getElementById("unit-modal");
  const title = document.getElementById("unit-modal-title");

  if (unit) {
    title.textContent = `Edit Unit: ${unit.name}`;
    document.getElementById("form-unit-id").value = unit.id;
    document.getElementById("form-unit-name").value = unit.name || "";
    document.getElementById("form-unit-tower").value = unit.tower || "";
    document.getElementById("form-unit-rate").value = unit.rate || 1899;
    document.getElementById("form-unit-type").value = unit.type || "Studio Deluxe";
    document.getElementById("form-unit-base-occ").value = unit.baseOccupancy || 2;
    document.getElementById("form-unit-max-occ").value = unit.maxOccupancy || 4;
    document.getElementById("form-unit-desc").value = unit.description || "";
    document.getElementById("form-unit-status").value = unit.status || "available";
    document.getElementById("form-unit-airbnb-ical").value = unit.calendars?.airbnb || "";
    document.getElementById("form-unit-amenities").value = (unit.amenities || []).join(", ");

    modalUnitImages = [...(unit.images || [])];
    modalCoverImage = unit.coverImage || (modalUnitImages[0] || "");
  } else {
    title.textContent = "Add New Unit";
    document.getElementById("unit-form").reset();
    document.getElementById("form-unit-id").value = "";
    document.getElementById("form-unit-status").value = "available";
    modalUnitImages = [];
    modalCoverImage = "";
  }

  renderModalGallery();
  modal.classList.remove("hidden");
}

function renderModalGallery() {
  const container = document.getElementById("unit-images-gallery");
  if (!container) return;

  if (modalUnitImages.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-6 text-center text-gray-400 text-xs">
        <i class="fas fa-image text-2xl mb-1 text-gray-300"></i>
        <p>No photos uploaded yet. Click "Upload Photos" above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = modalUnitImages.map((src, idx) => {
    const isCover = src === modalCoverImage;
    return `
      <div class="relative aspect-square rounded-xl overflow-hidden group bg-gray-100 border-2 ${isCover ? 'border-yellow shadow-md' : 'border-transparent'}">
        <img src="${src}" class="w-full h-full object-cover" />
        ${isCover ? '<span class="absolute top-1 left-1 bg-yellow text-charcoal text-[9px] font-bold px-1.5 py-0.5 rounded shadow">Cover</span>' : ''}
        
        <!-- Hover actions -->
        <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          ${!isCover ? `
            <button type="button" class="set-cover-btn p-1.5 bg-yellow text-charcoal rounded-lg text-xs" title="Make Cover Photo" data-index="${idx}">
              <i class="fas fa-star"></i>
            </button>
          ` : ''}
          <button type="button" class="del-photo-btn p-1.5 bg-red-500 text-white rounded-lg text-xs" title="Remove Photo" data-index="${idx}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".set-cover-btn").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      modalCoverImage = modalUnitImages[idx];
      renderModalGallery();
    };
  });

  container.querySelectorAll(".del-photo-btn").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      modalUnitImages.splice(idx, 1);
      if (modalCoverImage === modalUnitImages[idx]) {
        modalCoverImage = modalUnitImages[0] || "";
      }
      renderModalGallery();
    };
  });
}

// ========================================================
// 4. BOOKINGS & OPTION A PAYMENT APPROVAL
// ========================================================
function listenToBookings() {
  const bookingsRef = collection(db, "bookings");
  onSnapshot(bookingsRef, (snap) => {
    currentBookingsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count pending
    const pendingCount = currentBookingsList.filter(b => 
      b.status === "pending" || b.paymentStatus === "Pending Verification" || b.paymentStatus === "pending"
    ).length;

    const badge = document.getElementById("badge-pending-count");
    if (badge) {
      if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    renderBookingsTable();
  }, (err) => {
    console.warn("Bookings listener error:", err);
  });
}

function setupBookingEvents() {
  const filterBtns = document.querySelectorAll(".booking-filter-btn");
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => {
        b.classList.remove("bg-charcoal", "text-white", "active");
        b.classList.add("bg-gray-200", "text-gray-700");
      });
      btn.classList.add("bg-charcoal", "text-white", "active");
      btn.classList.remove("bg-gray-200", "text-gray-700");

      renderBookingsTable(btn.getAttribute("data-filter"));
    };
  });

  // Proof inspection modal buttons
  const proofModal = document.getElementById("proof-inspect-modal");
  const closeProofBtn = document.getElementById("close-proof-modal-btn");
  const approveProofBtn = document.getElementById("proof-approve-booking-btn");
  const cancelProofBtn = document.getElementById("proof-cancel-booking-btn");

  closeProofBtn.onclick = () => proofModal.classList.add("hidden");

  approveProofBtn.onclick = async () => {
    if (!activeProofBooking) return;
    approveProofBtn.disabled = true;
    try {
      await updateDoc(doc(db, "bookings", activeProofBooking.id), {
        status: "confirmed",
        paymentStatus: "Paid",
        "bookingPayment.status": "Paid",
        updatedAt: serverTimestamp()
      });
      showToast("Booking Approved and Marked Paid!", "success");
      proofModal.classList.add("hidden");
    } catch (e) {
      alert("Approval error: " + e.message);
    } finally {
      approveProofBtn.disabled = false;
    }
  };

  cancelProofBtn.onclick = async () => {
    if (!activeProofBooking) return;
    if (confirm("Are you sure you want to decline this booking? Dates will be freed up.")) {
      try {
        await updateDoc(doc(db, "bookings", activeProofBooking.id), {
          status: "cancelled",
          paymentStatus: "Cancelled",
          updatedAt: serverTimestamp()
        });
        showToast("Booking has been cancelled.", "info");
        proofModal.classList.add("hidden");
      } catch (e) {
        alert("Cancellation error: " + e.message);
      }
    }
  };
}

function renderBookingsTable(filter = "all") {
  const tbody = document.getElementById("admin-bookings-table-body");
  if (!tbody) return;

  let filtered = currentBookingsList;
  if (filter === "pending") {
    filtered = currentBookingsList.filter(b => b.status === "pending" || b.paymentStatus === "pending" || b.paymentStatus === "Pending Verification");
  } else if (filter === "confirmed") {
    filtered = currentBookingsList.filter(b => b.status === "confirmed");
  } else if (filter === "cancelled") {
    filtered = currentBookingsList.filter(b => b.status === "cancelled");
  }

  // Sort by createdAt desc
  filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="py-12 text-center text-gray-400 text-xs">
          No bookings found in this view.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(b => {
    const isPending = b.status === "pending" || b.paymentStatus === "Pending Verification";
    const refNum = b.paymentReference || b.bookingPayment?.reference || "N/A";
    const hasProofImg = Boolean(b.paymentReceiptUrl);

    return `
      <tr class="hover:bg-gray-50/70 transition-colors">
        <td class="py-3 px-4 font-mono font-bold text-xs text-charcoal">
          <div>${b.id ? b.id.substring(0, 10) + '...' : 'N/A'}</div>
          <span class="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mt-1 uppercase tracking-wide">
            <i class="fas fa-globe text-[9px]"></i> ${b.source || 'website'}
          </span>
        </td>
        <td class="py-3 px-4 font-semibold text-charcoal text-xs">
          ${b.unitName || b.unitId || "Unit"}
        </td>
        <td class="py-3 px-4 text-xs">
          <span class="font-bold block">${b.guestFirstName || ""} ${b.guestLastName || ""}</span>
          <span class="text-gray-400 text-[11px]">${b.guestPhone || b.guestEmail || ""}</span>
        </td>
        <td class="py-3 px-4 text-xs font-mono">
          ${b.checkinDate} &rarr; ${b.checkoutDate}
        </td>
        <td class="py-3 px-4 text-xs font-bold text-charcoal">
          ₱${(b.totalAmount || 0).toLocaleString()}
        </td>
        <td class="py-3 px-4 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] bg-gray-100 px-2 py-0.5 rounded">${refNum}</span>
            ${hasProofImg ? `
              <button class="inspect-proof-btn text-yellow-dark hover:text-yellow-darker text-sm" data-id="${b.id}" title="View Receipt Screenshot">
                <i class="fas fa-file-invoice"></i>
              </button>
            ` : ''}
          </div>
        </td>
        <td class="py-3 px-4 text-xs">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
            b.status === 'confirmed' ? 'bg-green-100 text-green-700' :
            b.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
            'bg-yellow-light text-yellow-darker'
          }">
            ${b.status || 'pending'}
          </span>
        </td>
        <td class="py-3 px-4 text-right text-xs">
          ${isPending ? `
            <button class="quick-approve-btn bg-green-500 hover:bg-green-600 text-white font-bold px-2.5 py-1 rounded-lg mr-1 text-[11px] shadow-sm" data-id="${b.id}">
              Approve
            </button>
          ` : ''}
          <button class="view-booking-details-btn text-gray-400 hover:text-charcoal p-1 text-sm" data-id="${b.id}">
            <i class="fas fa-ellipsis-v"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".inspect-proof-btn").forEach(btn => {
    btn.onclick = () => {
      const bId = btn.getAttribute("data-id");
      const found = currentBookingsList.find(b => b.id === bId);
      if (found) openProofModal(found);
    };
  });

  tbody.querySelectorAll(".quick-approve-btn").forEach(btn => {
    btn.onclick = async () => {
      const bId = btn.getAttribute("data-id");
      try {
        await updateDoc(doc(db, "bookings", bId), {
          status: "confirmed",
          paymentStatus: "Paid",
          "bookingPayment.status": "Paid",
          updatedAt: serverTimestamp()
        });
        showToast("Booking Approved!", "success");
      } catch (e) {
        alert("Approval failed: " + e.message);
      }
    };
  });
}

function openProofModal(booking) {
  activeProofBooking = booking;
  const modal = document.getElementById("proof-inspect-modal");
  const refDisplay = document.getElementById("proof-modal-ref");
  const imgDisplay = document.getElementById("proof-modal-img");

  refDisplay.textContent = `Ref: ${booking.paymentReference || booking.bookingPayment?.reference || "None submitted"}`;
  imgDisplay.src = booking.paymentReceiptUrl || "/mp.png";

  modal.classList.remove("hidden");
}

// ========================================================
// 5. LIVE GUEST CHATS HUB
// ========================================================
function listenToLiveChats() {
  const chatsRef = collection(db, "guest-chats");
  onSnapshot(chatsRef, (snap) => {
    currentChatsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const needsHumanCount = currentChatsList.filter(c => c.status === "needs_human").length;
    const badge = document.getElementById("badge-live-chat-count");
    if (badge) {
      if (needsHumanCount > 0) {
        badge.textContent = needsHumanCount;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    renderChatList();
  }, (err) => {
    console.warn("Live chat listener error:", err);
  });
}

function setupLiveChatEvents() {
  const replyForm = document.getElementById("admin-chat-reply-form");
  const replyInput = document.getElementById("admin-reply-input");

  replyForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = replyInput.value.trim();
    if (!text || !activeChatId) return;

    replyInput.value = "";
    try {
      const chatRef = doc(db, "guest-chats", activeChatId);
      await setDoc(chatRef, {
        status: "human_active",
        lastSender: "staff",
        lastMessage: text,
        updatedAt: serverTimestamp(),
        messages: arrayUnion({
          sender: "staff",
          text,
          timestamp: new Date().toISOString()
        })
      }, { merge: true });

      showToast("Reply sent to guest!", "success");
    } catch (e) {
      alert("Error sending reply: " + e.message);
    }
  };
}

function renderChatList() {
  const listContainer = document.getElementById("admin-chat-list");
  const countEl = document.getElementById("chat-count");
  if (!listContainer) return;

  if (countEl) countEl.textContent = currentChatsList.length;

  if (currentChatsList.length === 0) {
    listContainer.innerHTML = `
      <div class="py-12 text-center text-gray-400 text-xs p-4">
        No active conversations yet.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = currentChatsList.map(c => {
    const isNeedsHuman = c.status === "needs_human";
    const isActive = c.id === activeChatId;

    return `
      <div class="p-3.5 cursor-pointer hover:bg-gray-100 transition-colors ${isActive ? 'bg-yellow-light/40 border-l-4 border-yellow' : ''} chat-item-btn" data-id="${c.id}">
        <div class="flex items-center justify-between mb-1">
          <span class="font-bold text-xs text-charcoal truncate">Guest (${c.id.substring(c.id.length - 5)})</span>
          ${isNeedsHuman ? `
            <span class="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">Needs Staff</span>
          ` : `
            <span class="text-[10px] text-gray-400">${c.status === 'needs_human' ? 'Needs Staff' : c.status === 'human_active' ? 'Staff Active' : 'Chat Assistant'}</span>
          `}
        </div>
        <p class="text-xs text-gray-500 line-clamp-1">${c.lastMessage || 'Started conversation'}</p>
      </div>
    `;
  }).join("");

  listContainer.querySelectorAll(".chat-item-btn").forEach(item => {
    item.onclick = () => {
      const id = item.getAttribute("data-id");
      openActiveChat(id);
    };
  });
}

function openActiveChat(chatId) {
  activeChatId = chatId;
  renderChatList();

  const chat = currentChatsList.find(c => c.id === chatId);
  const header = document.getElementById("admin-chat-header");
  const messagesBox = document.getElementById("admin-chat-messages");
  const replyForm = document.getElementById("admin-chat-reply-form");

  if (!chat) return;

  header.innerHTML = `
    <div>
      <h3 class="font-bold text-sm text-charcoal">Conversation: ${chat.id}</h3>
      <span class="text-[11px] text-gray-500">Status: <strong class="uppercase text-yellow-dark">${chat.status}</strong></span>
    </div>
    <div class="flex items-center gap-2">
      <button class="resolve-chat-btn text-xs bg-gray-100 hover:bg-green-100 hover:text-green-700 text-gray-600 px-3 py-1 rounded-lg transition-colors" data-id="${chat.id}">
        <i class="fas fa-check mr-1"></i> Mark Resolved
      </button>
    </div>
  `;

  header.querySelector(".resolve-chat-btn").onclick = async () => {
    await updateDoc(doc(db, "guest-chats", chatId), { status: "resolved", updatedAt: serverTimestamp() });
    showToast("Chat marked as resolved", "info");
  };

  const messages = chat.messages || [];
  if (messages.length === 0) {
    messagesBox.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs">No messages yet.</div>`;
  } else {
    messagesBox.innerHTML = messages.map(m => {
      const isStaff = m.sender === "staff" || m.sender === "host";
      const isUser = m.sender === "user";
      return `
        <div class="flex ${isStaff ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[75%] p-3 rounded-2xl text-xs ${
            isStaff ? 'bg-yellow text-charcoal font-medium rounded-tr-none' :
            isUser ? 'bg-charcoal text-white rounded-tl-none' :
            'bg-white border border-gray-200 text-gray-700'
          }">
            <div class="text-[9px] uppercase tracking-wider mb-1 opacity-70">
              ${isStaff ? 'Manila Prime Staff (You)' : isUser ? 'Guest' : 'Chat Assistant'}
            </div>
            ${m.text}
          </div>
        </div>
      `;
    }).join("");
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  replyForm.classList.remove("hidden");
  document.getElementById("admin-reply-input")?.focus();
}

// ========================================================
// 6. PAYMENT SETTINGS (OPTION A)
// ========================================================
async function loadPaymentSettings() {
  try {
    const docSnap = await getDoc(doc(db, "config", "paymentSettings"));
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById("set-gcash-name").value = data.gcashName || "";
      document.getElementById("set-gcash-number").value = data.gcashNumber || "";
      document.getElementById("set-bank-name").value = data.bankName || "";
      document.getElementById("set-bank-number").value = data.bankNumber || "";

      if (data.qrImageUrl) {
        const preview = document.getElementById("qr-preview-container");
        const img = document.getElementById("qr-preview-img");
        img.src = data.qrImageUrl;
        preview.classList.remove("hidden");
      }
    }
  } catch (err) {
    console.warn("Could not load payment settings:", err);
  }
}

function setupPaymentSettingsEvents() {
  const form = document.getElementById("payment-settings-form");
  const qrInput = document.getElementById("set-qr-file");
  let qrBase64OrUrl = "";

  qrInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const compressed = await compressImageToWebP(file, 800, 0.85);
      const storageReference = ref(storage, `config/payment_qr.webp`);
      const snapshot = await uploadBytes(storageReference, compressed, { contentType: "image/webp" });
      qrBase64OrUrl = await getDownloadURL(snapshot.ref);

      const preview = document.getElementById("qr-preview-container");
      const img = document.getElementById("qr-preview-img");
      img.src = qrBase64OrUrl;
      preview.classList.remove("hidden");
      showToast("QR Code image optimized & uploaded!", "success");
    } catch (err) {
      console.warn("Storage upload failed, using local base64:", err);
      const reader = new FileReader();
      reader.onload = () => {
        qrBase64OrUrl = reader.result;
        const preview = document.getElementById("qr-preview-container");
        const img = document.getElementById("qr-preview-img");
        img.src = qrBase64OrUrl;
        preview.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const gcashName = document.getElementById("set-gcash-name").value.trim();
    const gcashNumber = document.getElementById("set-gcash-number").value.trim();
    const bankName = document.getElementById("set-bank-name").value.trim();
    const bankNumber = document.getElementById("set-bank-number").value.trim();

    try {
      const payload = {
        gcashName,
        gcashNumber,
        bankName,
        bankNumber,
        updatedAt: serverTimestamp()
      };
      if (qrBase64OrUrl) payload.qrImageUrl = qrBase64OrUrl;

      await setDoc(doc(db, "config", "paymentSettings"), payload, { merge: true });
      showToast("Payment Settings updated successfully!", "success");
    } catch (err) {
      alert("Error saving payment settings: " + err.message);
    }
  };
}

// ========================================================
// UTILS
// ========================================================
function showToast(message, type = "info") {
  const toast = document.getElementById("admin-toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");
  if (!toast) return;

  text.textContent = message;
  icon.className = type === "success" ? "fas fa-check-circle text-green-400" :
                   type === "error" ? "fas fa-exclamation-circle text-red-400" :
                   "fas fa-info-circle text-yellow";

  toast.classList.remove("translate-y-16", "opacity-0", "pointer-events-none");
  setTimeout(() => {
    toast.classList.add("translate-y-16", "opacity-0", "pointer-events-none");
  }, 3500);
}
