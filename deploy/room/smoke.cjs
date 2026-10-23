// Two-client smoke test for the collab room. Usage: node smoke.cjs <url>
const { io } = require("socket.io-client");
const url = process.argv[2] || "http://127.0.0.1:3002";
const room = "smoke-" + Date.now();
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
setTimeout(() => fail("timeout"), 15000);
const a = io(url, { transports: ["websocket"] });
const b = io(url, { transports: ["websocket"] });
let aFirst = false, bGotUser = false;
a.on("init-room", () => a.emit("join-room", room));
a.on("first-in-room", () => { aFirst = true; b.emit("join-room", room); });
a.on("new-user", () => { bGotUser = true; });
a.on("room-user-change", (ids) => {
  if (ids.length === 2) a.emit("server-broadcast", room, new Uint8Array([1, 2, 3]).buffer, new Uint8Array([9]));
});
b.on("init-room", () => {});
b.on("client-broadcast", (data, iv) => {
  if (!aFirst || !bGotUser) fail("order: first-in-room=" + aFirst + " new-user=" + bGotUser);
  if (new Uint8Array(data).length !== 3) fail("payload size");
  console.log("PASS: join, first-in-room, new-user, room-user-change, broadcast delivered");
  a.close(); b.close(); process.exit(0);
});
