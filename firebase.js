// ============================================================
//  La Dolorosa — firebase.js
//  Configuración de Firebase y helper de autenticación anónima
// ============================================================

import { initializeApp }    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase }      from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAcmywgX6l4x_dTnmA1c_CbtAh7LfSx4vg',
  authDomain:        'la-dolorosa-68870.firebaseapp.com',
  databaseURL:       'https://la-dolorosa-68870-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'la-dolorosa-68870',
  storageBucket:     'la-dolorosa-68870.firebasestorage.app',
  messagingSenderId: '387013198617',
  appId:             '1:387013198617:web:91910b92149292fe913b88'
};

const app  = initializeApp(firebaseConfig);
export const db   = getDatabase(app);
export const auth = getAuth(app);
export const signInAnon = () => signInAnonymously(auth);
