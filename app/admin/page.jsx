'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiPost, formatDate } from '@/lib/api';
import { Loading, ErrorBox } from '@/components/States';

export default function AdminPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [includeDisabled, setIncludeDisabled] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [exportLimit, setExportLimit] = useState('');

  async function loadStatus() {
    setLoading(true);
    setError(null);
    const res = await apiGet('/cache/status');
    setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setStatus(res.data);
  }

  useEffect(() => { loadStatus(); }, []);

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await apiPost('/cache/sync', { includeDisabled });
    setSyncing(false);
    if (!res.ok) { setError(res.error); return; }
    setSyncResult(res.data);
    loadStatus();
  }

  async function runExport() {
    setExporting(true);
    setExportResult(null);
    const limit = exportLimit ? Number(exportLimit) : undefined;
    const res = await apiGet('/catalog.csv', limit ? { limit } : {});
    setExporting(false);
    if (!res.ok) { setError(res.error); return; }
    setExportResult(res.data);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Cache &amp; catalog admin</h1>
          <p className="text-sm muted mt-1">
            Trigger catalog sync, inspect last-sync stats, and generate the CSV product catalog.
          </p>
        </div>
        <span className="chip">wcities control plane</span>
      </header>

      {loading ? <Loading /> : null}
      {!loading && error ? <ErrorBox error={error} /> : null}

      <div className="card p-5">
        <h2 className="font-semibold mb-2">Last sync</h2>
        {status?.last_sync ? (
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Finished at" value={formatDate(status.last_sync.finished_at)} />
            <Stat label="Suppliers" value={status.last_sync.suppliers} />
            <Stat label="Products" value={status.last_sync.products} />
            <Stat label="Elapsed" value={`${status.last_sync.elapsed_seconds}s`} />
            <Stat label="CSV path" value={status.last_sync.csv_path} small />
            <Stat label="Cache dir" value={status.cache_dir} small />
          </dl>
        ) : <p className="text-sm text-slate-500">No prior sync recorded.</p>}

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeDisabled} onChange={(e) => setIncludeDisabled(e.target.checked)} />
            Include disabled products
          </label>
          <button className="btn-primary" onClick={runSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Run sync now'}
          </button>
        </div>
        {syncResult ? (
          <pre className="mt-3 text-xs bg-slate-50 p-3 rounded overflow-x-auto">{JSON.stringify(syncResult, null, 2)}</pre>
        ) : null}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold mb-2">Catalog CSV export</h2>
        <p className="text-sm text-slate-500 mb-3">
          Two ways: &ldquo;Generate CSV&rdquo; calls the JSON stats endpoint so you can see row counts; &ldquo;Download CSV&rdquo; streams the file straight from the PHP <code className="bg-slate-100 px-1 rounded">catalog.php</code> helper.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Row limit (blank = all)</label>
            <input className="input w-36" type="number" value={exportLimit} onChange={(e) => setExportLimit(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={runExport} disabled={exporting}>
            {exporting ? 'Generating…' : 'Generate CSV (stats)'}
          </button>
          <a
            className="btn-secondary"
            target="_blank"
            rel="noreferrer"
            href={`/api/catalog${exportLimit ? '?limit=' + encodeURIComponent(exportLimit) : ''}`}
          >
            Download CSV
          </a>
          <a
            className="btn-secondary"
            target="_blank"
            rel="noreferrer"
            href={`/api/catalog?fresh=1${exportLimit ? '&limit=' + encodeURIComponent(exportLimit) : ''}`}
          >
            Sync & download
          </a>
        </div>
        {exportResult ? (
          <pre className="mt-3 text-xs bg-slate-50 p-3 rounded overflow-x-auto">{JSON.stringify(exportResult, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, small = false }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={'font-medium ' + (small ? 'text-xs break-all' : 'text-sm')}>{String(value ?? '—')}</dd>
    </div>
  );
}
