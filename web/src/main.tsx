import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  // R3F 8 schedules canvas teardown 500 ms after unmount. StrictMode's development
  // effect replay can tear down a newly mounted walkthrough and stop its frame loop.
  <App />,
)
