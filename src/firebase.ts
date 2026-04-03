/**
 * Firebase initialization for the application.
 * Currently unused as the app is local-first, but kept for future hosting/sync needs.
 */
import { initializeApp } from 'firebase/app';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
