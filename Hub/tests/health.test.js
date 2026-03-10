// ============================================================
// Health Endpoint Unit Tests
// ============================================================
// Tests GET /api/health from system.js. Uses a lightweight
// Express app with mocked managers (no full server startup).
// ============================================================

const express = require('express');
const http = require('http');

describe('GET /api/health', () => {
  let app;
  let server;
  let baseUrl;

  beforeAll((done) => {
    app = express();
    app.use(express.json());

    // Mock managers
    const mockDeviceManager = {
      getAll: jest.fn(() => [
        {
          id: 'mirror', ip: '192.168.0.201', online: true,
          status: { version: '2.9.0', freeHeap: 30000 }
        },
        {
          id: 'lamp', ip: '192.168.0.202', online: false,
          status: { version: '1.5.0', freeHeap: 28000 }
        }
      ])
    };

    const mockAudioManager = { active: false };
    const mockCircadianManager = { enabled: true };
    const mockNotificationManager = { weatherConfig: { enabled: false } };

    app.set('deviceManager', mockDeviceManager);
    app.set('audioManager', mockAudioManager);
    app.set('circadianManager', mockCircadianManager);
    app.set('notificationManager', mockNotificationManager);

    // Mount system routes at /api (same as server.js)
    const systemRoutes = require('../src/api/system');
    app.use('/api', systemRoutes);

    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  async function fetchHealth() {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    return { status: res.status, body };
  }

  // ---- Status & Structure ----

  test('responds with 200', async () => {
    const { status } = await fetchHealth();
    expect(status).toBe(200);
  });

  test('returns status "ok"', async () => {
    const { body } = await fetchHealth();
    expect(body.status).toBe('ok');
  });

  test('response has all top-level keys', async () => {
    const { body } = await fetchHealth();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['status', 'uptime', 'memory', 'devices', 'services', 'timestamp'])
    );
  });

  // ---- Uptime ----

  test('includes uptime as a positive number', async () => {
    const { body } = await fetchHealth();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  // ---- Memory ----

  test('includes memory stats with rss, heapUsed, heapTotal', async () => {
    const { body } = await fetchHealth();
    expect(body.memory).toBeDefined();
    expect(typeof body.memory.rss).toBe('number');
    expect(typeof body.memory.heapUsed).toBe('number');
    expect(typeof body.memory.heapTotal).toBe('number');
  });

  // ---- Devices ----

  test('reports correct total and online device counts', async () => {
    const { body } = await fetchHealth();
    expect(body.devices.total).toBe(2);
    expect(body.devices.online).toBe(1);
  });

  test('lists only online devices', async () => {
    const { body } = await fetchHealth();
    expect(body.devices.list).toHaveLength(1);
    expect(body.devices.list[0].id).toBe('mirror');
  });

  test('online device entry includes id, ip, version, heap', async () => {
    const { body } = await fetchHealth();
    const dev = body.devices.list[0];
    expect(dev.id).toBe('mirror');
    expect(dev.ip).toBe('192.168.0.201');
    expect(dev.version).toBe('2.9.0');
    expect(dev.heap).toBe(30000);
  });

  // ---- Services ----

  test('reports service statuses correctly', async () => {
    const { body } = await fetchHealth();
    expect(body.services.audio).toBe(false);
    expect(body.services.circadian).toBe(true);
    expect(body.services.weather).toBe(false);
  });

  // ---- Timestamp ----

  test('includes a valid ISO timestamp', async () => {
    const { body } = await fetchHealth();
    expect(body.timestamp).toBeDefined();
    const date = new Date(body.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });
});
