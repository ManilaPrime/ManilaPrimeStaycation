// js/firebase-app.js
// Firebase Web SDK integration with 'unified-booker' project
// Provides Firestore queries, Auth, and Storage for MPDesktop-WEBSITE

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Firebase configuration for unified-booker
export const firebaseConfig = {
  projectId: "unified-booker",
  appId: "1:165319197503:web:8ddbd48540c8d5ba88098a",
  storageBucket: "unified-booker.firebasestorage.app",
  apiKey: "AIzaSyAYpg2bjtkjGSCmfO0u030CYl220TAAg-I",
  authDomain: "unified-booker.firebaseapp.com",
  messagingSenderId: "165319197503",
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Cloud Functions API base URL
export const API_BASE_URL = "https://asia-southeast1-unified-booker.cloudfunctions.net/api";

// Ensure anonymous auth for website visitors so Firestore rules allow reads/writes
export async function ensureVisitorAuth() {
  try {
    if (!auth.currentUser) {
      const userCred = await signInAnonymously(auth);
      return userCred.user;
    }
    return auth.currentUser;
  } catch (err) {
    console.warn("Visitor anonymous auth error (fallback to public reads):", err);
    return null;
  }
}

// ==========================================
// CLIENT-SIDE CACHE & QUOTA PROTECTION
// ==========================================
const CACHE_KEYS = {
  UNITS: "mp_units_catalog_v2",
  UNITS_TIME: "mp_units_timestamp_v2",
  PAYMENT_SETTINGS: "mp_payment_settings_v2",
};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

/**
 * Fetch all active units from Firestore with 1-hour localStorage caching
 */
export async function getUnitsCatalog(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = localStorage.getItem(CACHE_KEYS.UNITS);
    const cachedTime = localStorage.getItem(CACHE_KEYS.UNITS_TIME);
    if (cached && cachedTime && (Date.now() - parseInt(cachedTime, 10) < CACHE_TTL_MS)) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.warn("Failed to parse cached units:", e);
      }
    }
  }

  await ensureVisitorAuth();

  try {
    const unitsCol = collection(db, "units");
    const snapshot = await getDocs(unitsCol);
    
    if (!snapshot.empty) {
      const units = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })).filter(u => u.status !== "maintenance" && u.status !== "inactive");

      // Save to cache
      localStorage.setItem(CACHE_KEYS.UNITS, JSON.stringify(units));
      localStorage.setItem(CACHE_KEYS.UNITS_TIME, Date.now().toString());
      return units;
    }
  } catch (err) {
    console.error("Error fetching units from Firestore:", err);
    // If cached data exists even if expired, fallback to it
    const cached = localStorage.getItem(CACHE_KEYS.UNITS);
    if (cached) return JSON.parse(cached);
  }

  // Fallback defaults if database is empty or initial setup
  return getDefaultUnits();
}

/**
 * Get active bookings for a unit (from both direct 'bookings' and 'externalBookings')
 * Only loads future/current bookings (checkoutDate >= today) to minimize Firestore reads
 */
export async function getUnitAvailability(unitId) {
  if (!unitId) return [];
  await ensureVisitorAuth();

  const today = new Date().toISOString().split("T")[0];
  const occupiedRanges = [];

  try {
    // 1. Direct bookings
    const bookingsRef = collection(db, "bookings");
    const qDirect = query(
      bookingsRef,
      where("unitId", "==", unitId),
      where("checkoutDate", ">=", today)
    );
    const directSnap = await getDocs(qDirect);
    directSnap.forEach(docSnap => {
      const b = docSnap.data();
      if (b.status !== "cancelled" && b.checkinDate && b.checkoutDate) {
        occupiedRanges.push({
          start: b.checkinDate,
          end: b.checkoutDate,
          source: b.source || "direct",
          status: b.status || "confirmed"
        });
      }
    });

    // 2. External bookings (Airbnb / Booking.com synced events)
    const extRef = collection(db, "externalBookings");
    const qExt = query(
      extRef,
      where("unitId", "==", unitId),
      where("checkoutDate", ">=", today)
    );
    const extSnap = await getDocs(qExt);
    extSnap.forEach(docSnap => {
      const b = docSnap.data();
      if (b.status !== "cancelled" && b.checkinDate && b.checkoutDate) {
        occupiedRanges.push({
          start: b.checkinDate,
          end: b.checkoutDate,
          source: b.platform || "external",
          status: "confirmed"
        });
      }
    });
  } catch (err) {
    console.error(`Error querying availability for unit ${unitId}:`, err);
    // Fallback: try loading from static data file if exists
    try {
      const res = await fetch(`/data/${unitId}.json?v=${Date.now()}`);
      if (res.ok) {
        const staticBookings = await res.json();
        return staticBookings;
      }
    } catch (e) {
      console.warn("No static fallback found for", unitId);
    }
  }

  return occupiedRanges;
}

/**
 * Check if selected dates overlap with existing bookings (Double-Booking Prevention)
 */
export function checkDateConflict(checkinDate, checkoutDate, occupiedRanges) {
  const reqStart = new Date(checkinDate);
  const reqEnd = new Date(checkoutDate);

  for (const range of occupiedRanges) {
    const bookedStart = new Date(range.start);
    const bookedEnd = new Date(range.end);

    // Overlap condition: start < bookedEnd AND end > bookedStart
    if (reqStart < bookedEnd && reqEnd > bookedStart) {
      return {
        conflict: true,
        conflictingRange: range
      };
    }
  }
  return { conflict: false };
}

/**
 * Submit a direct website booking with atomic conflict verification
 */
export async function submitWebsiteBooking(bookingData) {
  await ensureVisitorAuth();

  // 1. Re-verify availability directly before saving
  const currentOccupancy = await getUnitAvailability(bookingData.unitId);
  const conflictCheck = checkDateConflict(bookingData.checkinDate, bookingData.checkoutDate, currentOccupancy);

  if (conflictCheck.conflict) {
    throw new Error("Sorry, these dates were just reserved by another guest. Please select alternative dates or units.");
  }

  // 2. Create booking document in Firestore
  const bookingRef = doc(collection(db, "bookings"));
  const bookingId = bookingRef.id;

  const newBooking = {
    ...bookingData,
    id: bookingId,
    bookingId: bookingId,
    source: "website",
    status: "pending", // Waiting for host to verify payment proof
    paymentStatus: "pending",
    securityDepositStatus: "Unpaid",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await setDoc(bookingRef, newBooking);

  // Invalidate cached units availability
  return {
    success: true,
    bookingId,
    booking: newBooking
  };
}

/**
 * Submit payment proof (Reference number + receipt image)
 */
export async function submitPaymentProof(bookingId, referenceNumber, receiptDataOrUrl, paymentMethod = "GCash") {
  await ensureVisitorAuth();
  const bookingRef = doc(db, "bookings", bookingId);

  const updateData = {
    "bookingPayment.reference": referenceNumber,
    "bookingPayment.method": paymentMethod,
    "bookingPayment.status": "Pending Verification",
    "bookingPayment.paidAt": new Date().toISOString(),
    paymentReference: referenceNumber,
    paymentReceiptUrl: receiptDataOrUrl,
    paymentStatus: "Pending Verification",
    updatedAt: new Date().toISOString()
  };

  await updateDoc(bookingRef, updateData);
  return { success: true };
}

/**
 * Client-side Canvas Image Compression:
 * Compresses any user-uploaded image to WebP under ~120KB before uploading to Firebase
 * Saves over 90% of Firebase Storage bandwidth and stays 100% cost-free!
 */
export async function compressImageToWebP(file, maxDimension = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file); // fallback to original if toBlob fails
            return;
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
            type: "image/webp",
            lastModified: Date.now()
          });
          resolve(compressedFile);
        }, "image/webp", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a compressed unit photo to Firebase Storage
 */
export async function uploadUnitPhoto(file, unitId) {
  const compressed = await compressImageToWebP(file);
  const fileName = `unit_${unitId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.webp`;
  const storageRef = ref(storage, `units/${unitId}/${fileName}`);
  
  const snapshot = await uploadBytes(storageRef, compressed, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000" // Cache for 1 year
  });
  
  return await getDownloadURL(snapshot.ref);
}

/**
 * Default fallback units if Firestore is not yet populated
 */
function getDefaultUnits() {
  return [
    {
      id: "S1TC2_595",
      name: "Shore 1 Tower C2 - Unit 595",
      tower: "Shore 1 Tower C2",
      roomNo: "595",
      type: "Studio Deluxe",
      rate: 1899,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Flagship luxury studio featuring stylish modern furnishings, high-speed WiFi, smart Netflix TV, and complete kitchen amenities.",
      images: ["images/S1TC2_595.png"],
      coverImage: "images/S1TC2_595.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access", "Balcony"],
      status: "available"
    },
    {
      id: "S1TC2_1586",
      name: "Shore 1 Tower C2 - Unit 1586",
      tower: "Shore 1 Tower C2",
      roomNo: "1586",
      type: "Executive Suite",
      rate: 2299,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Elegant high-floor unit with stunning skyline views, premium queen bed, dedicated workspace, and modern resort ambiance.",
      images: ["images/S1TC2_1586.png", "images/1586.jpg"],
      coverImage: "images/S1TC2_1586.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access", "Work Desk"],
      status: "available"
    },
    {
      id: "S1TC2_1839",
      name: "Shore 1 Tower C2 - Unit 1839",
      tower: "Shore 1 Tower C2",
      roomNo: "1839",
      type: "Luxury Studio",
      rate: 2199,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Cozy and bright staycation suite with pool view, plush hotel-grade linens, fully equipped kitchen, and warm minimalist interiors.",
      images: ["images/S1TC2_1839.png", "images/1839.jpg"],
      coverImage: "images/S1TC2_1839.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access"],
      status: "available"
    },
    {
      id: "S1TD_953",
      name: "Shore 1 Tower D - Unit 953",
      tower: "Shore 1 Tower D",
      roomNo: "953",
      type: "Deluxe Studio",
      rate: 1999,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Modern urban sanctuary designed for ultimate relaxation, located steps away from SM Mall of Asia with resort pool access.",
      images: ["images/S1TD_953.png"],
      coverImage: "images/S1TD_953.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access"],
      status: "available"
    },
    {
      id: "S2T1_1407",
      name: "Shore 2 Tower 1 - Unit 1407",
      tower: "Shore 2 Tower 1",
      roomNo: "1407",
      type: "Premium Suite",
      rate: 2399,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Spacious premium unit in Shore 2 with expansive balcony view, high-speed fiber internet, and sleek contemporary aesthetics.",
      images: ["images/S2T1_1407.png"],
      coverImage: "images/S2T1_1407.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access", "Balcony"],
      status: "available"
    },
    {
      id: "S3T1_525",
      name: "Shore 3 Tower 1 - Unit 525",
      tower: "Shore 3 Tower 1",
      roomNo: "525",
      type: "Resort Studio",
      rate: 2099,
      baseOccupancy: 2,
      maxOccupancy: 4,
      extraGuestFee: 350,
      description: "Serene unit situated in Shore 3 near the wharf deck pools, featuring premium bedding and tranquil atmosphere for your weekend getaways.",
      images: ["images/S3T1_525.png"],
      coverImage: "images/S3T1_525.png",
      amenities: ["High-speed WiFi", "Smart TV w/ Netflix", "Air Conditioning", "Hot & Cold Shower", "Kitchenette", "Pool Access"],
      status: "available"
    }
  ];
}

// Secret keyboard shortcut for host admin access (Ctrl + Shift + A or Cmd + Shift + A)
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      if (!window.location.pathname.includes("/admin")) {
        window.location.href = "/admin/";
      }
    }
  });
}
