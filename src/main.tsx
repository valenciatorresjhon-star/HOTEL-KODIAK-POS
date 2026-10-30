import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ignorar errores de websocket de desarrollo para evitar bloqueos del flujo de la aplicación
window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message || event.reason || "");

  if (
    message.includes("WebSocket closed without opened") ||
    message.includes("failed to connect to websocket") ||
    message.includes("vite")
  ) {
    console.warn("Error de websocket de desarrollo ignorado:", message);
    event.preventDefault();
    return;
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

