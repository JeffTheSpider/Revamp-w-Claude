// ============================================================
// Circadian Manager
// ============================================================
// Calculates time-of-day color temperature (Kelvin) and sends
// it to devices running the "daylight" pattern. Also handles
// sunrise alarm scheduling.
//
// Circadian curve:
//   0:00-6:00  = 2700K (warm night)
//   6:00-8:00  = 2700->5000K (morning warmup)
//   8:00-12:00 = 5000->6500K (brightening)
//   12:00-16:00 = 6500->5000K (afternoon)
//   16:00-21:00 = 5000->2700K (evening)
//   21:00-24:00 = 2700K (warm night)
// ============================================================

const EventEmitter = require('events');

class CircadianManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.dm = deviceManager;
    this.enabled = false;
    this.timer = null;
    this.currentKelvin = 4000;
    this.sunriseAlarms = []; // { hour, minute, deviceIds }
  }

  // Calculate Kelvin for current time
  getCircadianKelvin() {
    const now = new Date();
    const totalMin = now.getHours() * 60 + now.getMinutes();

    if (totalMin < 360) return 2700;                                    // 0:00-6:00
    if (totalMin < 480) return 2700 + Math.round((totalMin - 360) * 2300 / 120);   // 6:00-8:00
    if (totalMin < 720) return 5000 + Math.round((totalMin - 480) * 1500 / 240);   // 8:00-12:00
    if (totalMin < 960) return 6500 - Math.round((totalMin - 720) * 1500 / 240);   // 12:00-16:00
    if (totalMin < 1260) return 5000 - Math.round((totalMin - 960) * 2300 / 300);  // 16:00-21:00
    return 2700;                                                         // 21:00-24:00
  }

  // Start the circadian update loop (sends Kelvin every 60s)
  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.currentKelvin = this.getCircadianKelvin();
    this._sendKelvinToDevices();
    this.timer = setInterval(() => this._tick(), 60000);
    console.log(`[Circadian] Started (current: ${this.currentKelvin}K)`);
    this.emit('started');
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log('[Circadian] Stopped');
    this.emit('stopped');
  }

  _tick() {
    const newKelvin = this.getCircadianKelvin();
    if (newKelvin !== this.currentKelvin) {
      this.currentKelvin = newKelvin;
      this._sendKelvinToDevices();
      this.emit('kelvinUpdate', newKelvin);
    }
    this._checkSunriseAlarms();
  }

  // Send current Kelvin to all online devices that have "ambient" capability
  async _sendKelvinToDevices() {
    const devices = this.dm.getAll(); // Returns array of device objects
    for (const dev of devices) {
      if (!dev.online) continue;
      if (!dev.capabilities || !dev.capabilities.includes('ambient')) continue;
      // Only send to devices currently in daylight mode
      if (dev.status && dev.status.mode === 'daylight') {
        try {
          await this.dm.sendCommand(dev.id, '/api/kelvin', { value: this.currentKelvin });
        } catch (e) {
          // Silently skip — device may have changed mode
        }
      }
    }
  }

  // Schedule a sunrise alarm
  setSunriseAlarm(hour, minute, deviceIds = []) {
    // Remove existing alarm at same time
    this.sunriseAlarms = this.sunriseAlarms.filter(
      a => a.hour !== hour || a.minute !== minute
    );
    this.sunriseAlarms.push({ hour, minute, deviceIds, triggered: false });
    console.log(`[Circadian] Sunrise alarm set for ${hour}:${String(minute).padStart(2, '0')}`);
    this.emit('alarmSet', { hour, minute, deviceIds });
    return true;
  }

  removeSunriseAlarm(hour, minute) {
    const before = this.sunriseAlarms.length;
    this.sunriseAlarms = this.sunriseAlarms.filter(
      a => a.hour !== hour || a.minute !== minute
    );
    return this.sunriseAlarms.length < before;
  }

  // Check and trigger sunrise alarms (activate sunrise pattern 30min before)
  _checkSunriseAlarms() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const alarm of this.sunriseAlarms) {
      const alarmMin = alarm.hour * 60 + alarm.minute;
      // Trigger 30 minutes before the target wake time
      const triggerMin = alarmMin - 30;
      const adjustedTrigger = triggerMin < 0 ? triggerMin + 1440 : triggerMin;

      // Use 2-minute window to avoid missing trigger due to timer drift
      if (nowMin >= adjustedTrigger && nowMin < adjustedTrigger + 2 && !alarm.triggered) {
        alarm.triggered = true;
        this._triggerSunrise(alarm);
      }
      // Reset triggered flag after the alarm window passes (5 min after wake time)
      if (nowMin > (alarmMin + 5) % 1440 && alarm.triggered) {
        alarm.triggered = false;
      }
    }
  }

  async _triggerSunrise(alarm) {
    console.log(`[Circadian] Triggering sunrise alarm for ${alarm.hour}:${String(alarm.minute).padStart(2, '0')}`);
    const allDevices = this.dm.getAll(); // Returns array
    const targets = alarm.deviceIds.length > 0 ? alarm.deviceIds : allDevices.filter(d => d.online).map(d => d.id);
    for (const id of targets) {
      try {
        await this.dm.sendCommand(id, '/api/pattern', { id: 'sunrise' });
      } catch (e) {
        console.error(`[Circadian] Failed to trigger sunrise on ${id}:`, e.message);
      }
    }
    this.emit('sunriseTriggered', alarm);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      currentKelvin: this.enabled ? this.currentKelvin : null,
      alarms: this.sunriseAlarms.map(a => ({
        time: `${a.hour}:${String(a.minute).padStart(2, '0')}`,
        devices: a.deviceIds
      }))
    };
  }
}

module.exports = CircadianManager;
