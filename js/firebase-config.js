import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
  Timestamp,
  collectionGroup
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
  authDomain: 'guideone-a6ee4.firebaseapp.com',
  databaseURL: 'https://guideone-a6ee4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'guideone-a6ee4',
  storageBucket: 'guideone-a6ee4.firebasestorage.app',
  messagingSenderId: '239656505483',
  appId: '1:239656505483:web:287895cbc2757f512fc48e',
  measurementId: 'G-M3NN4BYR4S'
};

let appInstance = null;
let authInstance = null;
let dbInstance = null;

try {
  if (!getApps().length) {
    appInstance = initializeApp(firebaseConfig);
  } else {
    appInstance = getApp();
  }
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
} catch (error) {
  console.error('Firebase SDK Initialization Error:', error);
}

export const app = appInstance;
export const auth = authInstance;
export const db = dbInstance;

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
  Timestamp,
  collectionGroup
};
