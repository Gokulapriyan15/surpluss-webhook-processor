
'use client';

import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  message: string;
  service: string;
  timestamp: string;
}

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function checkBackend() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;

        const response = await fetch(`${apiUrl}/health`);

        if (!response.ok) {
          throw new Error('Backend health check failed');
        }

        const data: HealthResponse = await response.json();
        setHealth(data);
      } catch {
        setError('Unable to connect to the backend');
      } finally {
        setLoading(false);
      }
    }

    checkBackend();
  }, []);

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900">
          Surpluss Webhook Processor
        </h1>

        <p className="mt-2 text-gray-600">
          Reliable Webhook Processing System
        </p>

        <div className="mt-8 rounded-xl bg-white p-6 shadow">
          <h2 className="text-xl font-semibold text-gray-900">
            Backend Connection
          </h2>

          {loading && (
            <p className="mt-4 text-gray-500">
              Checking backend connection...
            </p>
          )}

          {error && (
            <p className="mt-4 text-red-600">{error}</p>
          )}

          {health && (
            <div className="mt-4 space-y-2">
              <p className="text-green-600 font-semibold">
                Connected successfully
              </p>

              <p className="text-gray-700">
                Status: {health.status}
              </p>

              <p className="text-gray-700">
                Message: {health.message}
              </p>

              <p className="text-gray-500 text-sm">
                {health.timestamp}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
