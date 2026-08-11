import { renderToString } from 'react-dom/server';
import App from './App.tsx';

export function render() {
  return renderToString(<App />);
}
