// Connects to the maracas over BLE (Nordic UART Service), prints the
// incoming samples and pushes them to a live web page at http://localhost:3000
//
//   npm start
//
// Set MARACAS_NAME to change which device names are picked up (prefix match).

const http = require("http");
const fs = require("fs");
const path = require("path");
const noble = require("@abandonware/noble");

const NAME_PREFIX = process.env.MARACAS_NAME || "Maracas";
const PORT = Number(process.env.PORT) || 3000;

// noble wants UUIDs lowercase without dashes
const UART_SERVICE_UUID = "6e400001b5a3f393e0a9e50e24dcca9e";
const UART_TX_UUID = "6e400003b5a3f393e0a9e50e24dcca9e"; // device -> us (notify)

const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// Web page + server-sent events
// ---------------------------------------------------------------------------

const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

http
  .createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);
      // tell the new page which maracas are already connected
      for (const name of connected.values()) {
        res.write(`event: status\ndata: ${JSON.stringify({ name, connected: true })}\n\n`);
      }
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`live view: http://localhost:${PORT}`));

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// "<millis> <ax> <ay> <az> <gx> <gy> <gz>"
function parseLine(line) {
  const v = line.trim().split(/\s+/).map(Number);
  if (v.length !== 7 || v.some(Number.isNaN)) return null;
  const [t, ax, ay, az, gx, gy, gz] = v;
  // how hard it's being shaken: total acceleration minus gravity
  const shake = Math.abs(Math.hypot(ax, ay, az) - GRAVITY);
  return { t, ax, ay, az, gx, gy, gz, shake };
}

// ---------------------------------------------------------------------------
// Bluetooth
// ---------------------------------------------------------------------------

const connected = new Map(); // peripheral id -> name
const connecting = new Set();

function startScanning() {
  noble.startScanningAsync([], true).catch((err) => console.error("scan failed:", err.message));
}

noble.on("stateChange", (state) => {
  console.log(`bluetooth: ${state}`);
  if (state === "poweredOn") {
    console.log(`scanning for "${NAME_PREFIX}*"...`);
    startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on("discover", async (peripheral) => {
  const name = peripheral.advertisement.localName;
  if (!name || !name.startsWith(NAME_PREFIX)) return;
  if (connected.has(peripheral.id) || connecting.has(peripheral.id)) return;

  connecting.add(peripheral.id);
  console.log(`found ${name} (${peripheral.id}), connecting...`);

  // connecting is more reliable with scanning stopped
  await noble.stopScanningAsync();

  try {
    await connect(peripheral, name);
  } catch (err) {
    console.error(`${name}: ${err.message}`);
    peripheral.disconnect();
  } finally {
    connecting.delete(peripheral.id);
    // keep looking for the other maraca (and for this one if it failed)
    startScanning();
  }
});

async function connect(peripheral, name) {
  await peripheral.connectAsync();

  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
    [UART_SERVICE_UUID],
    [UART_TX_UUID]
  );
  const tx = characteristics[0];
  if (!tx) throw new Error("UART TX characteristic not found");

  // BLE packets are small, so a line can arrive split across several
  // notifications (or several lines in one). Buffer until newline.
  let pending = "";
  tx.on("data", (data) => {
    pending += data.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      const sample = parseLine(line);
      if (!sample) continue;
      console.log(
        `${name.padEnd(12)} ` +
          `acc ${fmt(sample.ax)} ${fmt(sample.ay)} ${fmt(sample.az)}  ` +
          `gyro ${fmt(sample.gx)} ${fmt(sample.gy)} ${fmt(sample.gz)}  ` +
          `shake ${fmt(sample.shake)}`
      );
      broadcast("sample", { name, ...sample });
    }
  });

  peripheral.once("disconnect", () => {
    console.log(`${name} disconnected`);
    connected.delete(peripheral.id);
    broadcast("status", { name, connected: false });
    startScanning();
  });

  await tx.subscribeAsync();

  connected.set(peripheral.id, name);
  broadcast("status", { name, connected: true });
  console.log(`${name} connected, streaming`);
}

function fmt(n) {
  return n.toFixed(2).padStart(7);
}

process.on("SIGINT", async () => {
  console.log("\ndisconnecting...");
  await noble.stopScanningAsync().catch(() => {});
  for (const p of Object.values(noble._peripherals || {})) {
    if (p.state === "connected") await p.disconnectAsync().catch(() => {});
  }
  process.exit(0);
});
