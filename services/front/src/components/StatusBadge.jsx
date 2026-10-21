import { useEffect, useState } from 'react';
import { getHealth } from '../api.js';

const STYLES = {
  ok: { dot: 'bg-emerald-500', text: 'Service de paiement : disponible' },
  down: { dot: 'bg-red-500', text: 'Service de paiement : indisponible' },
  unknown: { dot: 'bg-slate-400', text: 'Service de paiement : vérification…' },
};

export default function StatusBadge() {
  const [status, setStatus] = useState('unknown');

  useEffect(() => {
    let active = true;
    const check = async () => {
      const s = await getHealth();
      if (active) setStatus(s);
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const s = STYLES[status];
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-slate-200" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
      <span>{s.text}</span>
    </div>
  );
}
