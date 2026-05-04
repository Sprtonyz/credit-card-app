import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: 'AIzaSyD5bGuDs4WD6vFL2nU06vzCSlHPU9GQIjY',
  authDomain: 'credit-card-app-96107.firebaseapp.com',
  databaseURL: 'https://credit-card-app-96107-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'credit-card-app-96107',
  storageBucket: 'credit-card-app-96107.firebasestorage.app',
  messagingSenderId: '57274156390',
  appId: '1:57274156390:web:c16a3dd07bca3534d234a7',
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, app };
