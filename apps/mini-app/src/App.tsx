import { useState } from 'react'
import { getReadiness } from './api'
import './App.css'
function App() {
  const [status, setStatus] = useState('Проверка ещё не выполнена')
  const [pending, setPending] = useState(false)
  async function check() {
    setPending(true)
    try {
      const result = await getReadiness(AbortSignal.timeout(5000))
      setStatus(result.status === 'ok' ? 'API готово к работе' : 'Зависимости API недоступны')
    } catch { setStatus('Не удалось связаться с API') }
    finally { setPending(false) }
  }
  return <main>
    <h1>Openfacto</h1>
    <p>Технический каркас платформы. Продуктовые функции ещё не подключены.</p>
    <button type="button" disabled={pending} onClick={() => { void check() }}>
      {pending ? 'Проверка…' : 'Проверить API'}
    </button>
    <p role="status" aria-live="polite">{status}</p>
  </main>
}
export default App
