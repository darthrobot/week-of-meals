// Data storage. With a Firebase config, data lives in Firestore under the
// signed-in user (and is cached on the device so the app works offline).
// Without one, everything stays in this browser's localStorage.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc
} from "firebase/firestore";

export function hasCloud() {
  return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function cloudStore(h) {
  const app = initializeApp(firebaseConfig);
  // No popup/redirect resolver: email sign-in only, which also works inside the Android app.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  let fs;
  try {
    fs = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  let uid = null, unsubs = [];
  const base = () => "users/" + uid;
  const fail = (e) => h.onError(e);

  onAuthStateChanged(auth, (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    uid = user ? user.uid : null;
    h.onUser(user ? { email: user.email } : null);
    if (!user) return;
    unsubs.push(onSnapshot(collection(fs, base() + "/meals"),
      (s) => h.onMeals(s.docs.map((d) => ({ id: d.id, ...d.data() }))), fail));
    unsubs.push(onSnapshot(doc(fs, base() + "/state/plan"),
      (d) => h.onPlan(d.exists() ? d.data().days || {} : {}), fail));
    unsubs.push(onSnapshot(doc(fs, base() + "/state/list"), (d) => {
      const v = d.exists() ? d.data() : {};
      h.onList({ checked: v.checked || {}, extras: v.extras || [] });
    }, fail));
  });

  // Writes are not awaited: Firestore applies them locally right away and
  // sends them when the device is back online.
  return {
    mode: "cloud",
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
    reset: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    saveMeal(m) { const { id, ...body } = m; setDoc(doc(fs, base() + "/meals/" + id), body).catch(fail); },
    deleteMeal(id) { deleteDoc(doc(fs, base() + "/meals/" + id)).catch(fail); },
    savePlan(days) { setDoc(doc(fs, base() + "/state/plan"), { days }).catch(fail); },
    saveList(list) { setDoc(doc(fs, base() + "/state/list"), list).catch(fail); }
  };
}

export function localStore(h) {
  const KEY = "wom-data";
  let data = { meals: [], plan: {}, list: { checked: {}, extras: [] } };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v) data = { meals: v.meals || [], plan: v.plan || {}, list: v.list || { checked: {}, extras: [] } };
  } catch (e) {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };

  queueMicrotask(() => {
    h.onUser({ email: null, local: true });
    h.onMeals(data.meals); h.onPlan(data.plan); h.onList(data.list);
  });

  return {
    mode: "local",
    saveMeal(m) {
      const i = data.meals.findIndex((x) => x.id === m.id);
      data.meals = i < 0 ? data.meals.concat(m) : data.meals.map((x) => (x.id === m.id ? m : x));
      persist(); h.onMeals(data.meals);
    },
    deleteMeal(id) { data.meals = data.meals.filter((m) => m.id !== id); persist(); h.onMeals(data.meals); },
    savePlan(days) { data.plan = days; persist(); },
    saveList(list) { data.list = list; persist(); }
  };
}
