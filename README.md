# Maracas

A Feather nRF52840 Sense inside a maraca streams its accelerometer and gyro readings over Bluetooth LE. A small Node app connects to it and shows the data live.

```
firmware/maracas/maracas.ino   Arduino sketch for the Feather Sense
client/server.js               Node BLE client + tiny web server
client/index.html              live view (served at http://localhost:3000)
```

## Firmware

Open `firmware/maracas/maracas.ino` in the Arduino IDE with the Adafruit nRF52 board package and these libraries installed:

- Adafruit LSM6DS
- Adafruit Unified Sensor

Flash it to the Feather Sense. It advertises as `Maracas`. If you have a pair, change `DEVICE_NAME` to `Maracas L` / `Maracas R` so you can tell them apart. The client connects to every device whose name starts with `Maracas`.

Each sample is one line of text over the Nordic UART service, sent 50 times a second:

```
<millis> <ax> <ay> <az> <gx> <gy> <gz>
```

Acceleration is in m/s², gyro in rad/s.

## Client

```bash
cd client
npm install
npm start
```

Then open http://localhost:3000.

**On macOS, run it from Terminal.app (or iTerm).** The first time, macOS asks to let the terminal use Bluetooth. Allow it, or turn it on under System Settings → Privacy & Security → Bluetooth. Without that permission macOS kills node as soon as it touches Bluetooth (the error is `Abort trap: 6`).

Options:

- `MARACAS_NAME=Foo npm start` connects to devices whose name starts with something else
- `PORT=8080 npm start` serves the web page on a different port

`shake` is the total acceleration minus gravity, so it reads about 0 at rest and goes up the harder the maraca is shaken.
