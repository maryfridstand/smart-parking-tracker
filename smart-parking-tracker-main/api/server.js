// Smart Parking API
// POST   /api/cars          <- the IoT camera reports a plate that entered
// GET    /api/cars          <- the dashboard pulls the current state
// DELETE /api/cars/:plate   <- "release car" button: car leaves, we bill it
// GET    /api/health        <- used by the Docker healthcheck

const express = require("express");
const { createClient } = require("redis");

const PORT = Number(process.env.PORT || 3000);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CAPACITY = Number(process.env.CAPACITY || 10);
const PRICE_PER_HOUR = Number(process.env.PRICE_PER_HOUR || 12);

// Redis keys
const PARKED = "parked"; // sorted set: member = plate, score = entry time (ms)
const HISTORY = "history"; // list of JSON exit records, newest first
const TOTAL_ENTRIES = "stats:totalEntries";
const REVENUE = "stats:revenue";

const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("Redis error:", err.message));

const app = express();
app.use(express.json());

// Express 4 doesn't catch errors thrown in async handlers, so wrap them.
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// Price = every started hour costs PRICE_PER_HOUR (minimum one hour).
function calcPrice(enteredAt, now = Date.now()) {
  const hours = Math.max(1, Math.ceil((now - enteredAt) / 3_600_000));
  return hours * PRICE_PER_HOUR;
}

// Accept plates like 12-345-67, 123-45-678, ABC1234. Stored upper-case.
function normalizePlate(raw) {
  if (typeof raw !== "string") return null;
  const plate = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{4,12}$/.test(plate) ? plate : null;
}

app.get("/api/health", wrap(async (_req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}));

app.post("/api/cars", wrap(async (req, res) => {
  const plate = normalizePlate(req.body?.plate);
  if (!plate) return res.status(400).json({ error: "Invalid or missing plate" });

  if ((await redis.zScore(PARKED, plate)) !== null) {
    return res.status(409).json({ error: `${plate} is already parked` });
  }
  if ((await redis.zCard(PARKED)) >= CAPACITY) {
    return res.status(503).json({ error: "Parking lot is full" });
  }

  const enteredAt = Date.now();
  await redis.multi().zAdd(PARKED, { score: enteredAt, value: plate }).incr(TOTAL_ENTRIES).exec();
  console.log(`IN  ${plate}`);
  res.status(201).json({ plate, enteredAt });
}));

app.get("/api/cars", wrap(async (_req, res) => {
  const now = Date.now();
  const [parked, totalEntries, revenue, history] = await Promise.all([
    redis.zRangeWithScores(PARKED, 0, -1),
    redis.get(TOTAL_ENTRIES),
    redis.get(REVENUE),
    redis.lRange(HISTORY, 0, 9),
  ]);

  res.json({
    capacity: CAPACITY,
    count: parked.length,
    pricePerHour: PRICE_PER_HOUR,
    totalEntries: Number(totalEntries || 0),
    revenue: Number(revenue || 0),
    cars: parked.map(({ value, score }) => ({
      plate: value,
      enteredAt: score,
      currentPrice: calcPrice(score, now),
    })),
    history: history.map((h) => JSON.parse(h)),
  });
}));

app.delete("/api/cars/:plate", wrap(async (req, res) => {
  const plate = normalizePlate(req.params.plate);
  const enteredAt = plate && (await redis.zScore(PARKED, plate));
  if (enteredAt == null) return res.status(404).json({ error: "Car not found" });

  const leftAt = Date.now();
  const price = calcPrice(enteredAt, leftAt);
  const record = { plate, enteredAt, leftAt, price };

  await redis
    .multi()
    .zRem(PARKED, plate)
    .incrBy(REVENUE, price)
    .lPush(HISTORY, JSON.stringify(record))
    .lTrim(HISTORY, 0, 49)
    .exec();

  console.log(`OUT ${plate} paid ${price}`);
  res.json(record);
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await redis.connect();
  app.listen(PORT, () => console.log(`API listening on :${PORT} (capacity ${CAPACITY})`));
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
