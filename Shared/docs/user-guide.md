# Revamp Hub - User Guide

Central control hub for Charlie's Mirror (clock) and Charlie's Lamp LED systems.
The Hub runs on Node.js and provides a PWA interface with Catppuccin Mocha dark theme
and glassmorphism card design.

---

## Getting Started

### Prerequisites

- Node.js 18+ (tested on v24)
- Both ESP8266 devices on the local network
  - Charlie's Mirror: `192.168.0.201` (mirror.local)
  - Charlie's Lamp: `192.168.0.202` (lamp.local)

### Installation

```bash
cd Hub
npm install
npm start
```

The Hub starts on **http://localhost:3000**. Open it in a browser to access the PWA.
You can install the PWA to your home screen on mobile or desktop for an app-like
experience.

### Configuration

Edit `Hub/config.json` to change the port, device addresses, polling intervals, or
audio settings. The default configuration ships ready to use with both devices.

---

## Device Setup

Each device runs its own firmware and connects to the Hub automatically. The Hub polls
devices at the interval defined in `config.json` (default: 10 seconds) and updates
their online/offline status in real time via WebSocket.

Devices report their capabilities (color, patterns, music, ambient, notify, animations,
morse, ntp, oled) in their `/api/status` response. The Hub UI adapts accordingly --
features like morse code only appear for devices that support them.

---

## PWA Features

### Device Cards

Each device appears as a glassmorphism card showing its name, online status, current
pattern, and brightness. Cards update in real time over WebSocket.

### Patterns

Select from the device's available LED patterns. Each device has its own pattern list
organized into categories:

- **Standard**: Solid Color, Rainbow, Fire, Breathe, Comet, Sparkle, etc.
- **Music Reactive**: Beat Pulse/Glow, Spectrum Ring/Strip, Beat Chase/Color Pulse
- **Ambient**: Daylight (circadian), Sunrise, Fireplace, Ocean, Forest

Tap a pattern name to activate it on the device.

### Brightness

Use the brightness slider or up/down buttons on each device card. Brightness uses
adaptive step sizes: step 1 for values 0-49, step 5 for 50-99, step 10 for 100-255.

The "All Devices" section lets you control brightness across every online device at
once.

### Colors

Use the color picker to set a custom RGB color on any device. The device switches
to its Solid Color pattern automatically. You can also set colors on all devices
simultaneously via the all-devices controls.

### Morse Code (Lamp Only)

The Lamp supports morse code output on its LED strips. Enter text (A-Z, 0-9),
set the WPM speed, choose a color, and optionally enable looping. The morse encoder
uses ITU-standard timing.

### Scenes

Scenes save the current state of all devices (pattern, brightness, color) and let you
restore that state with a single tap. You can:

- **Create** a scene by naming it and capturing current device states
- **Activate** a scene to restore all saved device states
- **Schedule** a scene to activate at a specific time using cron expressions
- **Delete** scenes you no longer need

Scenes are stored in `Hub/scenes.json`.

### Music Reactive

The Hub captures system audio via FFmpeg, runs FFT analysis and beat detection, then
broadcasts 8-byte UDP packets to all devices on port 4210. When music mode is active:

1. Open the Music section in the PWA
2. Start audio capture (requires FFmpeg and Stereo Mix enabled on Windows)
3. Set a music-reactive pattern on your devices
4. Adjust sensitivity as needed

The PWA displays a real-time spectrum visualizer showing the audio frequency data.

### Ambient / Circadian

The ambient system provides environment-aware lighting:

- **Daylight Mode**: Automatically adjusts color temperature based on time of day
  (warm in morning/evening, cool midday). The Hub calculates Kelvin values and sends
  them to devices every 60 seconds.
- **Sunrise Alarm**: Schedule a wake-up time and the Sunrise pattern activates 30
  minutes before, gradually ramping up brightness and warmth.
- **Fireplace / Ocean / Forest**: Standalone ambient patterns that run directly on
  the devices.

### Notifications

External services can trigger LED notifications via webhook:

```
POST http://localhost:3000/api/notify?key=YOUR_API_KEY
```

Notification features:

- **Profiles**: Pre-configured notification styles (alert, info, success) with color,
  effect (flash/pulse/strobe), and duration settings
- **Weather Integration**: Optional OpenWeatherMap integration for weather-triggered
  notifications
- **LED Overlay**: Notifications overlay on top of the current pattern and auto-revert
  when finished. A priority system prevents low-priority notifications from
  interrupting high-priority ones.

### Animations

The animation designer lets you create custom keyframe animations:

- **Keyframe Editor**: Define color, brightness, and pattern at each keyframe with
  timing control
- **Timeline**: Visual timeline showing keyframe positions and interpolation
- **Preview**: Test animations before uploading to devices
- **Storage**: Saved animations persist in `Hub/animations.json`
- **Upload & Play**: Push animations to devices and control playback (play/pause/stop)

The Clock supports up to 12 keyframes; the Lamp supports up to 28.

### Device Groups

Create named groups of devices to control multiple devices together. Groups support
all the same operations as individual devices (pattern, brightness, color).

### Timer

Set a countdown timer to automatically change device states after a specified
duration. Useful for sleep timers or timed lighting changes.

---

## API Reference

The Hub exposes a REST API at `http://localhost:3000/api/`. All POST endpoints accept
JSON bodies.

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices with status |
| GET | `/api/devices/:id/status` | Get single device status |
| GET | `/api/devices/:id/patterns` | List device patterns |
| POST | `/api/devices/:id/pattern` | Set pattern `{ id }` |
| POST | `/api/devices/:id/brightness` | Set brightness `{ value }` or `{ dir }` |
| POST | `/api/devices/:id/color` | Set color `{ r, g, b }` |
| POST | `/api/devices/:id/morse` | Send morse `{ text, wpm, loop, r, g, b }` |
| POST | `/api/devices/:id/restart` | Restart device |
| POST | `/api/devices/all/pattern` | Set pattern on all devices |
| POST | `/api/devices/all/brightness` | Set brightness on all devices |
| POST | `/api/devices/all/color` | Set color on all devices |
| POST | `/api/devices/all/restart` | Restart all devices |

### Scenes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scenes` | List all scenes |
| POST | `/api/scenes` | Create scene `{ name, devices }` |
| POST | `/api/scenes/:name/activate` | Activate a scene |
| DELETE | `/api/scenes/:name` | Delete a scene |

### Audio

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audio/status` | Audio capture status |
| POST | `/api/audio/start` | Start audio capture |
| POST | `/api/audio/stop` | Stop audio capture |

### Circadian

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/circadian/status` | Circadian service status |
| POST | `/api/circadian/start` | Start circadian mode |
| POST | `/api/circadian/stop` | Stop circadian mode |
| POST | `/api/circadian/alarm` | Set sunrise alarm `{ hour, minute }` |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/notify` | Trigger notification (webhook) |
| GET | `/api/notifications/profiles` | List profiles |
| GET | `/api/notifications/history` | Notification history |

### Animations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/animations` | List saved animations |
| POST | `/api/animations` | Save animation |
| GET | `/api/animations/status` | Playback status |
| POST | `/api/animations/:name/upload` | Upload to device |
| POST | `/api/animations/:name/play` | Start playback |
| POST | `/api/animations/:name/stop` | Stop playback |
| DELETE | `/api/animations/:name` | Delete animation |

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create group |
| DELETE | `/api/groups/:name` | Delete group |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/system/health` | Health check |
| GET | `/api/system/backup` | Download config backup |
| POST | `/api/system/restore` | Restore config from backup |

---

## Troubleshooting

### Device shows as offline

- Verify the device is powered on and connected to WiFi
- Check the device IP matches `config.json` (mirror: 192.168.0.201, lamp: 192.168.0.202)
- Try pinging the device: `ping 192.168.0.201`
- The Hub retries with exponential backoff up to `maxBackoff` (default: 60s)

### PWA not updating after Hub changes

The PWA uses a network-first service worker strategy. If stale content persists:
- Hard refresh the browser (Ctrl+Shift+R)
- Clear the browser cache and service worker registration
- The service worker version is bumped with each release

### Music reactive mode has no audio

- FFmpeg must be installed and the path set in `config.json`
- Windows: Enable "Stereo Mix" in Sound Settings > Recording Devices
- Start audio capture from the Music section in the PWA before setting music patterns

### OTA firmware upload fails

- Both devices use host port 48266 for OTA. Upload to one device at a time.
- Ensure the device is online and reachable before starting OTA
- The device will restart automatically after a successful upload

### Sunrise alarm does not trigger

- The alarm checks within a 2-minute window to avoid timer drift misses
- Verify the circadian service is running (check `/api/circadian/status`)
- The Sunrise pattern activates 30 minutes before the configured wake time

### WebSocket disconnects

The PWA automatically reconnects when the WebSocket drops. If updates stop
appearing, check that the Hub process is still running. The reconnect uses
exponential backoff with a `setTimeout`-based approach to prevent duplicate
connections.
