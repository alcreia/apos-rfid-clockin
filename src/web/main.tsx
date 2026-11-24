import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Kiosk from './Kiosk.js';
import Dev from './Dev.js';
import './styles.css';

const isDev = window.location.pathname.startsWith('/dev');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isDev ? <Dev /> : <Kiosk />}</React.StrictMode>,
);
