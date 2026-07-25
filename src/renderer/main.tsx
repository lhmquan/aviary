import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { UiFeedbackProvider } from './components/UiFeedback'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UiFeedbackProvider>
      <App />
    </UiFeedbackProvider>
  </React.StrictMode>
)
