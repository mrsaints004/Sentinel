const { spawn } = require("child_process");
const path = require("path");

const PORT = process.env.PORT || 3000;

// Start Next.js dashboard
const dashboard = spawn("npx", ["next", "start", "-p", PORT], {
  cwd: path.join(__dirname, "dashboard"),
  stdio: "inherit",
  env: { ...process.env },
});

// Start Telegram bot + agent
const agent = spawn("npx", ["ts-node", "agent/telegram.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: { ...process.env, PORT: "0" }, // PORT=0 disables the HTTP API server since dashboard handles it
});

dashboard.on("exit", (code) => {
  console.error(`Dashboard exited with code ${code}`);
  process.exit(code || 1);
});

agent.on("exit", (code) => {
  console.error(`Agent exited with code ${code}`);
});

process.on("SIGTERM", () => {
  dashboard.kill();
  agent.kill();
  process.exit(0);
});
