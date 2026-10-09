import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  addDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

// ─────────────────────────────────────────────────────────────
// CONFIGURATION VALIDATION
// Throw clear error naming any missing required environment variable
// ─────────────────────────────────────────────────────────────
const requiredVars = [
  ['VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY],
  ['VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN],
  ['VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID],
  ['VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID],
];

const missingVars = requiredVars
  .filter(([_, val]) => !val)
  .map(([name]) => name);

if (missingVars.length > 0) {
  throw new Error(
    `Missing required Firebase environment variable(s): ${missingVars.join(', ')}. ` +
    `Ensure these are defined in .env.local or your hosting environment.`
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize App once (guard with getApps() so hot reload does not re-initialize)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Export db and auth
export const db = getFirestore(app);
export const auth = getAuth(app);

// ─────────────────────────────────────────────────────────────
// ANONYMOUS AUTHENTICATION
// Memoize in-flight promise so concurrent callers share it
// ─────────────────────────────────────────────────────────────
let anonAuthPromise = null;

export async function ensureAnonAuth() {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  if (anonAuthPromise) {
    return anonAuthPromise;
  }

  anonAuthPromise = (async () => {
    try {
      if (browserLocalPersistence) {
        try {
          await setPersistence(auth, browserLocalPersistence);
        } catch (pErr) {
          console.warn('Firebase setPersistence warning:', pErr);
        }
      }
      const cred = await signInAnonymously(auth);
      return cred.user.uid;
    } finally {
      anonAuthPromise = null;
    }
  })();

  return anonAuthPromise;
}

export function isFirebaseConfigured() {
  return true;
}

export function getFirestoreDb() {
  return db;
}

// ─────────────────────────────────────────────────────────────
// CONFIDENTIALITY FILTER
// Ensures cost, floor, margin, mode, or assist data never reach Firestore
// ─────────────────────────────────────────────────────────────
const FORBIDDEN_KEYS = new Set([
  'cost_price',
  'cost',
  'min_price',
  'floor',
  'floor_price',
  'min_acceptable_price',
  'mode',
  'margin',
  'margin_pct',
  'unit_profit',
  'total_profit',
  'assist',
  'economics',
  'suggestion',
]);

function sanitizeData(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (!FORBIDDEN_KEYS.has(key.toLowerCase())) {
      clean[key] = value;
    }
  }
  return clean;
}

// ─────────────────────────────────────────────────────────────
// ROOM OPERATIONS
// ─────────────────────────────────────────────────────────────

export function subscribeToRoom(roomToken, onData, onError) {
  const roomRef = doc(db, 'rooms', roomToken);
  return onSnapshot(
    roomRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData({ id: snapshot.id, ...snapshot.data() });
      } else {
        onData(null);
      }
    },
    (err) => {
      console.error('Room subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export async function createOrUpdateRoom(roomToken, data) {
  const clean = sanitizeData(data);
  const roomRef = doc(db, 'rooms', roomToken);
  await setDoc(roomRef, clean, { merge: true });
}

export async function updateRoom(roomToken, data) {
  const clean = sanitizeData(data);
  const roomRef = doc(db, 'rooms', roomToken);
  await updateDoc(roomRef, clean);
}

// ─────────────────────────────────────────────────────────────
// MESSAGES OPERATIONS
// ─────────────────────────────────────────────────────────────

export function subscribeToMessages(roomToken, onData, onError) {
  const messagesRef = collection(db, 'rooms', roomToken, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      onData(messages);
    },
    (err) => {
      console.error('Messages subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export async function sendMessage(roomToken, { sender, text, offerPrice, offerQuantity }) {
  if (!text || !text.trim()) return;

  const messagesRef = collection(db, 'rooms', roomToken, 'messages');
  const messageData = sanitizeData({
    sender, // 'buyer' | 'seller'
    text: text.trim(),
    createdAt: serverTimestamp(),
    offerPrice: offerPrice ? Number(offerPrice) : null,
    offerQuantity: offerQuantity ? Number(offerQuantity) : null,
  });

  return await addDoc(messagesRef, messageData);
}

// ─────────────────────────────────────────────────────────────
// PRESENCE & TYPING INDICATORS
// ─────────────────────────────────────────────────────────────

export function subscribeToPresence(roomToken, onData, onError) {
  const presenceRef = doc(db, 'rooms', roomToken, 'meta', 'presence');
  return onSnapshot(
    presenceRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data());
      } else {
        onData({ buyerOnline: false, sellerOnline: false });
      }
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function setPresence(roomToken, role, isOnline) {
  const presenceRef = doc(db, 'rooms', roomToken, 'meta', 'presence');
  const field = role === 'seller' ? 'sellerOnline' : 'buyerOnline';
  const lastActiveField = role === 'seller' ? 'sellerLastActive' : 'buyerLastActive';
  await setDoc(
    presenceRef,
    {
      [field]: isOnline,
      [lastActiveField]: serverTimestamp(),
    },
    { merge: true }
  );
}

export function subscribeToTyping(roomToken, onData, onError) {
  const typingRef = doc(db, 'rooms', roomToken, 'meta', 'typing');
  return onSnapshot(
    typingRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data());
      } else {
        onData({ buyerTyping: false, sellerTyping: false });
      }
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function setTyping(roomToken, role, isTyping) {
  const typingRef = doc(db, 'rooms', roomToken, 'meta', 'typing');
  const field = role === 'seller' ? 'sellerTyping' : 'buyerTyping';
  await setDoc(
    typingRef,
    {
      [field]: isTyping,
    },
    { merge: true }
  );
}
