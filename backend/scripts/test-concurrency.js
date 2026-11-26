
const eventId = `evt_concurrent_${Date.now()}`;

const payload = {
  eventId,
  type: 'order.created',
  data: {
    orderId: 'ORD-CONCURRENT-001',
    customerId: 'CUS-42',
    simulate: 'ok',
  },
};

async function sendWebhook() {
  const response = await fetch(
    'http://localhost:3001/api/webhooks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();

  return {
    status: response.status,
    duplicate: result.duplicate,
  };
}

async function runTest() {
  console.log('Sending 50 simultaneous requests...');

  const results = await Promise.all(
    Array.from({ length: 50 }, () => sendWebhook()),
  );

  const accepted = results.filter(
    (result) => result.status === 202,
  ).length;

  const newEvents = results.filter(
    (result) => result.duplicate === false,
  ).length;

  const duplicates = results.filter(
    (result) => result.duplicate === true,
  ).length;

  console.log('Total requests:', results.length);
  console.log('Accepted:', accepted);
  console.log('New events:', newEvents);
  console.log('Duplicates:', duplicates);

  if (accepted === 50 && newEvents === 1 && duplicates === 49) {
    console.log('SUCCESS: Duplicate protection working!');
  } else {
    console.log('FAILED: Unexpected results');
  }
}

runTest().catch(console.error);
