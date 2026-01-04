import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VoiceProvider } from './contexts/VoiceContext'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VoiceProvider>
      <App />
    </VoiceProvider>
  </React.StrictMode>
)
