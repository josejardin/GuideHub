import { initializeApp } from 'firebase/app';
import { 
 getFirestore, 
 collection, 
 getDocs, 
 deleteDoc, 
 doc 
} from 'firebase/firestore';
import dotenv from 'dotenv';

dotenv.config();


const firebaseConfig = {
 apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk",
 authDomain: process.env.FIREBASE_AUTH_DOMAIN || "guideone-a6ee4.firebaseapp.com",
 projectId: process.env.FIREBASE_PROJECT_ID || "guideone-a6ee4",
 storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "guideone-a6ee4.firebasestorage.app",
 messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "239656505483",
 appId: process.env.FIREBASE_APP_ID || "1:239656505483:web:287895cbc2757f512fc48e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);


const collectionsToPurge = [
 "appointments",
 "referrals",
 "cases",
 "otpVerifications",
 "auditLogs"
];

async function purgeCollection(collectionName) {
 const colRef = collection(db, collectionName);
 const snapshot = await getDocs(colRef);
 
 if (snapshot.empty) {
 console.log(`ℹ Collection [${collectionName}] is already empty.`);
 return;
 }

 let deletedCount = 0;
 for (const docSnap of snapshot.docs) {
 
 if (collectionName === "cases") {
 const notesRef = collection(db, `cases/${docSnap.id}/notes`);
 const notesSnap = await getDocs(notesRef);
 for (const noteDoc of notesSnap.docs) {
 await deleteDoc(doc(db, `cases/${docSnap.id}/notes`, noteDoc.id));
 }
 }

 await deleteDoc(doc(db, collectionName, docSnap.id));
 deletedCount++;
 }
 
 console.log(` Cleared [${collectionName}]: ${deletedCount} document(s) deleted.`);
}

async function runCleanup() {
 console.log("====================================================");
 console.log(" Purging Dummy Bookings, Referrals, and Test Data...");
 console.log(" Preserving all accounts in [users] collection...");
 console.log("====================================================");

 for (const colName of collectionsToPurge) {
 try {
 await purgeCollection(colName);
 } catch (err) {
 console.error(` Error clearing [${colName}]:`, err.message);
 }
 }

 console.log("====================================================");
 console.log(" Database cleaned! Your website is now fresh.");
 console.log("====================================================");
 process.exit(0);
}

runCleanup();